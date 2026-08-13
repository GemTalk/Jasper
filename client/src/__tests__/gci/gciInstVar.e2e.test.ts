import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock vscode since browserQueries → gciLog → vscode.
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
import { startInstVarPreview, applyInstVar } from '../../refactoring/queries/previewInstVar';
import { PREVIEW_PAGE_BYTES } from '../../refactoring/queries/previewRenameMethod';
import { parseStartPreview, parseApplyResult } from '../../refactoring/instVarRefactorPreview';

/**
 * On-demand GCI e2e for the COMMITTING paths of the add / remove instance-variable (V1)
 * refactoring, over the real GCI transport (`npm run test:gci`).
 *
 * WHY THIS IS STILL AN on-demand gci SUITE: every scenario the harness can host has moved to
 * the automatic integration suite, which runs in CI across the release matrix — see
 * `refactoring/__tests__/refactoringInstVar.integration.test.ts` (add, remove + selective
 * copy-forward, partial apply without abort, shadowed-temporary prediction, decline duplicate,
 * decline a name a subclass declares, plus the engine's GS SUnit suite). What remains here are the
 * scenarios on which the ENGINE commits — migrate instances, delete history, and (added for PR
 * #392 finding #10) an add-with-accessors that migrates, whose accessors must be committed
 * ATOMICALLY with the reshape so a later abort cannot strand them:
 * `GsInstVarRefactoring>>applyDeselected:options:migrate:deleteHistory:` calls
 * `commitStructuralThenMigrate:` once the structural apply has succeeded, whenever `migrate` or
 * `deleteHistory` is requested, because `migrateInstancesTo:` needs a clean transaction.
 * `useIntegrationTest` aborts after every test
 * to keep tests isolated, and an abort cannot undo a commit, so these can only move once the CI
 * migration settles a commit-and-compensate story for the harness (a transient session, or a
 * test that commits its own cleanup). That is a policy call about the harness's "never commit"
 * invariant, not a technical blocker. Note the discriminator is what the PRODUCTION code does,
 * not what the test does: a test that merely commits its own fixture belongs in the harness.
 *
 * Guarded on the refactoring engine being installed (the queries reference the in-stone
 * `GsInstVarRefactoring`); the tests skip, with a reason, otherwise. Each test is self-cleaning
 * — it removes the committed class (and any persisted instance) and commits that removal in
 * `finally`, leaving no residue. All Smalltalk is ASCII-only for 3.6.x.
 */
describe('instance-variable refactoring, committing paths (gci e2e)', () => {
  let gci: GciLibrary;
  let session: ActiveSession;
  let enginePresent = false;

  // NB: `executeFetchString` sends #encodeAsUTF8 to whatever the code evaluates to, so every
  // `exec` here must end in a String. `System commitTransaction` answers the System class,
  // which does not understand it — hence the trailing `. 'ok'` on the mutating calls below.
  const exec = (code: string): string => q.executeFetchString(session, code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const userIndex = (): number =>
    parseInt(
      exec(
        `| sl d | sl := System myUserProfile symbolList. ` +
          `d := sl detect: [:x | x name = #'UserGlobals'] ifNone: [nil]. ` +
          `(d ifNil: [0] ifNotNil: [sl indexOf: d]) printString`,
      ),
      10,
    );

  const hasIvar = (cls: string, name: string): boolean =>
    exec(`(${cls} instVarNames includes: #${name}) printString`).trim() === 'true';
  const includesSelector = (cls: string, sel: string): boolean =>
    exec(`(${cls} includesSelector: #${sel}) printString`).trim() === 'true';

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
        '(System myUserProfile symbolList objectNamed: #GsInstVarRefactoring) notNil printString',
      ).trim() === 'true';
  });

  afterAll(() => {
    if (session?.handle) gci.GciTsLogout(session.handle);
    gci?.close();
  });

  // The committing paths (migrate instances / delete history) can only be verified end to end
  // here: the engine commits the structural change first (migrateInstancesTo: needs a clean
  // transaction), so an abort-isolated unit/SUnit test cannot observe them.

  it('migrates existing instances onto the new version and commits when migrate is requested', async (ctx) => {
    if (!enginePresent) return ctx.skip('GsInstVarRefactoring is not installed on this stone');

    const CLS = 'GciIvMig';
    try {
      q.compileClassDefinition(
        session,
        `Object subclass: '${CLS}' instVarNames: #(x) classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );
      // A persisted instance of the old version, so migrateInstancesTo: has something on disk to move.
      exec(`UserGlobals at: #GciIvMigInst put: ${CLS} new. System commitTransaction. 'ok'`);

      parseStartPreview(
        await startInstVarPreview(
          asyncExec,
          'add',
          CLS,
          'y',
          'gci-iv-migrate',
          PREVIEW_PAGE_BYTES,
          userIndex(),
        ),
      );
      const result = parseApplyResult(
        await applyInstVar(asyncExec, 'gci-iv-migrate', [], null, true, false),
      );

      expect(result.failed).toEqual([]);
      expect(result.committed).toBe(true);
      expect(hasIvar(CLS, 'y')).toBe(true);
      // The same persisted object is now an instance of the new version and carries the new ivar.
      expect(exec(`((UserGlobals at: #GciIvMigInst) class == ${CLS}) printString`).trim()).toBe(
        'true',
      );
      expect(
        exec(
          `((UserGlobals at: #GciIvMigInst) class instVarNames includes: #y) printString`,
        ).trim(),
      ).toBe('true');
    } finally {
      exec(
        `UserGlobals removeKey: #GciIvMigInst ifAbsent: []. ` +
          `UserGlobals removeKey: #${CLS} ifAbsent: []. System commitTransaction. 'ok'`,
      );
    }
  });

  it('deletes prior versions from the class history and commits when delete-history is requested', async (ctx) => {
    if (!enginePresent) return ctx.skip('GsInstVarRefactoring is not installed on this stone');

    const CLS = 'GciIvHist';
    try {
      q.compileClassDefinition(
        session,
        `Object subclass: '${CLS}' instVarNames: #(x) classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );
      exec("System commitTransaction. 'ok'"); // commit the original version so history bumps to 2

      parseStartPreview(
        await startInstVarPreview(
          asyncExec,
          'add',
          CLS,
          'z',
          'gci-iv-history',
          PREVIEW_PAGE_BYTES,
          userIndex(),
        ),
      );
      const result = parseApplyResult(
        await applyInstVar(asyncExec, 'gci-iv-history', [], null, false, true),
      );

      expect(result.failed).toEqual([]);
      expect(result.committed).toBe(true);
      expect(hasIvar(CLS, 'z')).toBe(true);
      // The prior version was pruned: only the current version remains in the history.
      expect(exec(`${CLS} classHistory size printString`).trim()).toBe('1');
    } finally {
      exec(`UserGlobals removeKey: #${CLS} ifAbsent: []. System commitTransaction. 'ok'`);
    }
  });

  // Accessors requested with a COMMITTING add are compiled inside the same transaction as the
  // reshape, so they are committed with it and cannot be stranded. Pre-fix, accessor generation
  // ran AFTER the commit (a separate, uncommitted step), so a later abort silently dropped them
  // while the committed ivar stayed. Only a real commit + abort can observe this — hence gci.
  it('keeps the committed accessors after a later abort when an add migrates instances', async (ctx) => {
    if (!enginePresent) return ctx.skip('GsInstVarRefactoring is not installed on this stone');

    const CLS = 'GciIvAccMig';
    try {
      q.compileClassDefinition(
        session,
        `Object subclass: '${CLS}' instVarNames: #(x) classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );
      // A persisted instance so migrate has something to move (and the migrate path commits).
      exec(`UserGlobals at: #GciIvAccMigInst put: ${CLS} new. System commitTransaction. 'ok'`);

      parseStartPreview(
        await startInstVarPreview(
          asyncExec,
          'add',
          CLS,
          'y',
          'gci-iv-acc-mig',
          PREVIEW_PAGE_BYTES,
          userIndex(),
        ),
      );
      const result = parseApplyResult(
        await applyInstVar(asyncExec, 'gci-iv-acc-mig', [], null, true, false, [
          { selector: 'y', source: 'y\n\t^y' },
          { selector: 'y:', source: 'y: aValue\n\ty := aValue' },
        ]),
      );

      expect(result.failed).toEqual([]);
      expect(result.committed).toBe(true);
      expect(hasIvar(CLS, 'y')).toBe(true);
      expect(includesSelector(CLS, 'y')).toBe(true);
      expect(includesSelector(CLS, 'y:')).toBe(true);

      // The fix's guarantee: because the accessors committed WITH the reshape, an abort at a later
      // transaction boundary cannot drop them.
      exec("System abortTransaction. 'ok'");

      expect(hasIvar(CLS, 'y')).toBe(true);
      expect(includesSelector(CLS, 'y')).toBe(true); // getter survived the abort
      expect(includesSelector(CLS, 'y:')).toBe(true); // setter survived the abort
    } finally {
      exec(
        `UserGlobals removeKey: #GciIvAccMigInst ifAbsent: []. ` +
          `UserGlobals removeKey: #${CLS} ifAbsent: []. System commitTransaction. 'ok'`,
      );
    }
  });

  it('commits nothing when an accessor cannot compile, even with migrate requested', async (ctx) => {
    if (!enginePresent) return ctx.skip('GsInstVarRefactoring is not installed on this stone');

    const CLS = 'GciIvAccFail';
    try {
      q.compileClassDefinition(
        session,
        `Object subclass: '${CLS}' instVarNames: #(x) classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );
      exec(`UserGlobals at: #GciIvAccFailInst put: ${CLS} new. System commitTransaction. 'ok'`);

      parseStartPreview(
        await startInstVarPreview(
          asyncExec,
          'add',
          CLS,
          'y',
          'gci-iv-acc-fail',
          PREVIEW_PAGE_BYTES,
          userIndex(),
        ),
      );
      const result = parseApplyResult(
        await applyInstVar(asyncExec, 'gci-iv-acc-fail', [], null, true, false, [
          { selector: 'y', source: 'y\n\t^ )( will not compile' },
        ]),
      );

      // The bad accessor lands in `failed`, which holds the commit back: nothing is committed, so
      // an abort rolls the whole reshape back — the add and its accessors are all-or-nothing.
      expect(result.failed.length).toBeGreaterThan(0);
      expect(result.committed).toBe(false);

      exec("System abortTransaction. 'ok'");

      expect(hasIvar(CLS, 'y')).toBe(false); // structural add was never committed
      expect(includesSelector(CLS, 'y')).toBe(false); // and the accessor never installed
    } finally {
      exec(
        `UserGlobals removeKey: #GciIvAccFailInst ifAbsent: []. ` +
          `UserGlobals removeKey: #${CLS} ifAbsent: []. System commitTransaction. 'ok'`,
      );
    }
  });
});
