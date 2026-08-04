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
  analyzeInstVarStructure,
  startInstVarStructurePreview,
  applyInstVarStructure,
} from '../../refactoring/queries/previewInstVarStructure';
import { PREVIEW_PAGE_BYTES } from '../../refactoring/queries/previewRenameMethod';
import {
  parseAnalysis,
  parseStartPreview,
  parseApplyResult,
} from '../../refactoring/instVarStructurePreview';

/**
 * On-demand GCI end-to-end test (`npm run test:gci`) for the instance-variable structure
 * refactorings (V2 push up, V3 push down, V5 convert temporary). Drives the real query
 * builders + parsers against a live stone over the GCI transport, then rolls everything
 * back.
 *
 * GUARDED on the engine being loaded: on a bare stone each test skips with a reason. Fully
 * transient — every test aborts the transaction in a `finally`, so the new class versions
 * and fixture classes never commit.
 */
describe('instance-variable structure (gci e2e)', () => {
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
    q.compileMethod(session, MID, false, 'accessing', 'compute\n\t| t |\n\tt := mid.\n\t^t');
    q.compileMethod(session, LEAF, false, 'accessing', 'leafM\n\t^leaf');
  };

  const ownIvars = (cls: string): string =>
    exec(`(${cls} instVarNames collect: [:e | e asString]) printString`);

  const definesSelector = (cls: string, selector: string): boolean =>
    exec(
      `(${cls} compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) notNil printString`,
    ).trim() === 'true';

  const abort = (): void => {
    // Must end in a String: executeFetchString sends #encodeAsUTF8 to whatever the code
    // evaluates to, and `System abortTransaction` answers the System class, which does not
    // understand it. Same idiom as the sibling gci suites.
    exec("System abortTransaction. 'ok'");
  };

  // Remove the fixture classes (+ any stray migrate-test instance) and COMMIT — used to clean
  // up the one test that must commit. Best-effort; safe to call when they don't exist.
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

  it('pushes an ivar up to the superclass, then rolls back', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();
      const analysis = parseAnalysis(
        await analyzeInstVarStructure(asyncExec, 'pushUp', LEAF, 'leaf'),
      );
      expect(analysis.decline).toBeNull();

      parseStartPreview(
        await startInstVarStructurePreview(
          asyncExec,
          'pushUp',
          LEAF,
          'leaf',
          'vs-e2e-up',
          PREVIEW_PAGE_BYTES,
        ),
      );
      const result = parseApplyResult(await applyInstVarStructure(asyncExec, 'vs-e2e-up'));

      expect(result.failed).toEqual([]);
      expect(ownIvars(MID)).toContain("'leaf'");
      expect(ownIvars(LEAF)).not.toContain("'leaf'");
    } finally {
      abort();
    }
  });

  it('pushes an ivar down into the subclasses, then rolls back', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();
      parseStartPreview(
        await startInstVarStructurePreview(
          asyncExec,
          'pushDown',
          MID,
          'pushable',
          'vs-e2e-down',
          PREVIEW_PAGE_BYTES,
        ),
      );
      const result = parseApplyResult(await applyInstVarStructure(asyncExec, 'vs-e2e-down'));

      expect(result.failed).toEqual([]);
      expect(ownIvars(LEAF)).toContain("'pushable'");
      expect(ownIvars(MID)).not.toContain("'pushable'");
    } finally {
      abort();
    }
  });

  it('moves a simple accessor up with the ivar, then rolls back', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();
      parseStartPreview(
        await startInstVarStructurePreview(
          asyncExec,
          'pushUp',
          MID,
          'mid',
          'vs-e2e-acc',
          PREVIEW_PAGE_BYTES,
          undefined,
          undefined,
          true,
        ),
      );
      // Accessor move alone never commits.
      const result = parseApplyResult(await applyInstVarStructure(asyncExec, 'vs-e2e-acc'));

      expect(result.failed).toEqual([]);
      expect(result.committed).toBe(false);
      expect(ownIvars(BASE)).toContain("'mid'");
      // midM (`^mid`) moved up to BASE; the non-accessor `compute` stayed on MID.
      expect(definesSelector(BASE, 'midM')).toBe(true);
      expect(definesSelector(MID, 'midM')).toBe(false);
      expect(definesSelector(MID, 'compute')).toBe(true);
    } finally {
      abort();
    }
  });

  it('converts a method temporary to an instance variable, then rolls back', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();
      parseStartPreview(
        await startInstVarStructurePreview(
          asyncExec,
          'convertTemp',
          MID,
          't',
          'vs-e2e-ct',
          PREVIEW_PAGE_BYTES,
          undefined,
          { selector: 'compute', isMeta: false, varName: 't' },
        ),
      );
      const result = parseApplyResult(await applyInstVarStructure(asyncExec, 'vs-e2e-ct'));

      expect(result.failed).toEqual([]);
      expect(ownIvars(MID)).toContain("'t'");
    } finally {
      abort();
    }
  });

  it('migrates existing instances to the new version and commits (opt-in)', async (ctx) => {
    if (!enginePresent) return ctx.skip();

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
    } finally {
      removeFixtureAndCommit();
    }
  });
});
