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
 * Some scenarios were migrated to the integration test harness, which runs in CI
 * over the release matrix. What remains here are tests which migrate instances because
 * they require a real commit.
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
});
