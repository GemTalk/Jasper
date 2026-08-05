import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock vscode since browserQueries -> gciLog -> vscode.
vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';
import { ActiveSession } from '../../sessionManager';
import { GemStoneLogin } from '../../loginTypes';
import * as q from '../../browserQueries';
import {
  startInstVarStructurePreview,
  applyInstVarStructure,
} from '../../refactoring/queries/previewInstVarStructure';
import { PREVIEW_PAGE_BYTES } from '../../refactoring/queries/previewRenameMethod';
import { parseStartPreview, parseApplyResult } from '../../refactoring/instVarStructurePreview';

/**
 * On-demand GCI end-to-end test (`npm run test:gci`) for the one instance-variable structure
 * scenario that COMMITS: pushing an ivar up with instance migration requested.
 *
 * WHY THIS IS STILL AN on-demand gci SUITE: every transient scenario this file used to cover
 * (push up, push down, convert temporary, moving a simple accessor along) now lives in
 * `refactoring/__tests__/refactoringInstVarStructure.integration.test.ts`, which runs in CI
 * across the release matrix and asserts a superset. What remains is the migrate-instances path:
 * the engine commits the structural change first (migrateInstancesTo: needs a clean
 * transaction), and `useIntegrationTest` aborts after every test — an abort cannot undo a
 * commit. Moving it needs a commit-and-compensate story for the harness, which is a policy
 * decision about its "never commit" invariant rather than a technical blocker.
 *
 * GUARDED on the engine being loaded: on a bare stone the test skips, with a reason. It is
 * self-cleaning — it removes the committed fixture classes and the persisted instance, and
 * commits that removal, in `finally`. All emitted Smalltalk is ASCII-only for 3.6.x.
 */
describe('instance-variable structure, committing path (gci e2e)', () => {
  let gci: GciLibrary;
  let session: ActiveSession;
  let enginePresent = false;

  const exec = (code: string): string => q.executeFetchString(session, code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const BASE = 'VsE2eBase';
  const MID = 'VsE2eMid';
  const LEAF = 'VsE2eLeaf';

  const defineFixture = (): void => {
    q.compileClassDefinition(
      session,
      `Object subclass: '${BASE}' instVarNames: #('shared') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session,
      `${BASE} subclass: '${MID}' instVarNames: #('mid' 'pushable') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session,
      `${MID} subclass: '${LEAF}' instVarNames: #('leaf') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session, MID, false, 'accessing', 'midM\n\t^mid');
    q.compileMethod(session, LEAF, false, 'accessing', 'leafM\n\t^leaf');
  };

  const ownIvars = (cls: string): string =>
    exec(`(${cls} instVarNames collect: [:e | e asString]) printString`);

  const definesSelector = (cls: string, selector: string): boolean =>
    exec(
      `(${cls} compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) notNil printString`,
    ).trim() === 'true';

  // Remove the fixture classes (+ the migrate-test instance) and COMMIT, since
  // `System abortTransaction` cannot undo a commit. Best-effort; safe when they don't exist.
  //
  // Must end in a String: executeFetchString sends #encodeAsUTF8 to whatever the code evaluates
  // to, and `System commitTransaction` answers the System class, which does not understand it.
  const removeFixtureAndCommit = (): void => {
    exec(
      `#(#VsE2eInst #${LEAF} #${MID} #${BASE}) do: [:s | UserGlobals removeKey: s ifAbsent: []]. ` +
        "System commitTransaction. 'ok'",
    );
  };

  beforeAll(() => {
    gci = new GciLibrary(GCI_LIBRARY_PATH);
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = {
      id: 1,
      gci,
      handle: login.session,
      login: { label: 'Test' } as GemStoneLogin,
      stoneVersion: '3.7.5',
    };
    enginePresent =
      exec(
        '(System myUserProfile symbolList objectNamed: #GsInstVarStructureRefactoring) notNil printString',
      ).trim() === 'true';
  });

  afterAll(() => {
    if (session?.handle) gci.GciTsLogout(session.handle);
    gci?.close();
  });

  it('migrates existing instances to the new version and commits (opt-in)', async (ctx) => {
    if (!enginePresent)
      return ctx.skip('GsInstVarStructureRefactoring is not installed on this stone');

    try {
      // The fixture + a live instance must be COMMITTED before migrating: migrateInstancesTo:
      // needs a clean transaction and already-persistent instances.
      defineFixture();
      exec("System commitTransaction. 'ok'");
      exec(`UserGlobals at: #VsE2eInst put: ${LEAF} new. System commitTransaction. 'ok'`);

      parseStartPreview(
        await startInstVarStructurePreview(
          asyncExec,
          'pushUp',
          LEAF,
          'leaf',
          'vs-e2e-mig',
          PREVIEW_PAGE_BYTES,
        ),
      );
      // migrateInstances: true (removeOldFromHistory: false) → the one path that commits.
      const result = parseApplyResult(
        await applyInstVarStructure(asyncExec, 'vs-e2e-mig', true, false),
      );

      expect(result.failed).toEqual([]);
      expect(result.committed).toBe(true);
      expect(result.migratedFailures).toBe(0);
      expect(ownIvars(MID)).toContain("'leaf'");
      // The instance was migrated onto the new LEAF version (the name now resolves to it).
      expect(exec(`((UserGlobals at: #VsE2eInst) class == ${LEAF}) printString`).trim()).toBe(
        'true',
      );
      // Instance migration re-versions LEAF and MID; their methods must survive the reshape.
      expect(definesSelector(LEAF, 'leafM')).toBe(true);
      expect(definesSelector(MID, 'midM')).toBe(true);
    } finally {
      removeFixtureAndCommit();
    }
  });
});
