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
import {
  analyzeInstVar,
  startInstVarPreview,
  applyInstVar,
} from '../../refactoring/queries/previewInstVar';
import { PREVIEW_PAGE_BYTES } from '../../refactoring/queries/previewRenameMethod';
import {
  parseAnalysis,
  parseStartPreview,
  parseApplyResult,
} from '../../refactoring/instVarRefactorPreview';

/**
 * On-demand GCI e2e for the add / remove instance-variable (V1) refactoring, over the
 * real GCI transport (`npm run test:gci`). Drives the actual client query builders +
 * parsers against a live stone: add an ivar and confirm the class carries it; remove one
 * that methods use and confirm those methods are reported and dropped.
 *
 * Guarded on the refactoring engine being installed (the queries reference the in-stone
 * `GsInstVarRefactoring`); the tests skip with a reason otherwise. The non-committing tests are
 * transient (they roll back with `System abortTransaction` in a `finally`); the two committing
 * tests (migrate instances / delete history) instead remove the class they created — and commit
 * that removal — in their `finally`, since an abort cannot undo a commit. All Smalltalk is
 * ASCII-only for 3.6.x.
 */
describe('add / remove instance variable (gci e2e)', () => {
  let gci: GciLibrary;
  let session: ActiveSession;
  let enginePresent = false;

  const exec = (code: string): string => q.executeFetchString(session, code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const BASE = 'GciIvBase';
  const SUB = 'GciIvSub';

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

  const defineFixture = (): void => {
    q.compileClassDefinition(
      session,
      `Object subclass: '${BASE}' instVarNames: #(count other) classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session,
      `${BASE} subclass: '${SUB}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session, BASE, false, 'accessing', 'combine\n\t^ count + other');
    q.compileMethod(session, SUB, false, 'accessing', 'doubleCount\n\t^ count * 2');
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
        '(System myUserProfile symbolList objectNamed: #GsInstVarRefactoring) notNil printString',
      ).trim() === 'true';
  });

  afterAll(() => {
    if (session?.handle) gci.GciTsLogout(session.handle);
    gci?.close();
  });

  it('adds an instance variable and versions the subtree', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();

      const analysis = parseAnalysis(
        await analyzeInstVar(asyncExec, 'add', BASE, 'tally', userIndex()),
      );
      expect(analysis.decline).toBeNull();
      expect(analysis.affectedCount).toBe(2); // base + sub

      const start = parseStartPreview(
        await startInstVarPreview(
          asyncExec,
          'add',
          BASE,
          'tally',
          'gci-iv-add',
          PREVIEW_PAGE_BYTES,
          userIndex(),
        ),
      );
      const result = parseApplyResult(
        await applyInstVar(asyncExec, 'gci-iv-add', [], null, false, false),
      );
      expect(start.total).toBe(2);
      expect(result.failed).toEqual([]);
      expect(result.committed).toBe(false);

      expect(hasIvar(BASE, 'tally')).toBe(true);
    } finally {
      exec('System abortTransaction');
    }
  });

  it('removes an instance variable, reporting and dropping the methods that used it', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();

      const start = parseStartPreview(
        await startInstVarPreview(
          asyncExec,
          'remove',
          BASE,
          'count',
          'gci-iv-remove',
          PREVIEW_PAGE_BYTES,
          userIndex(),
        ),
      );
      expect(start.outOfScope.willNotRecompile.map((m) => m.selector)).toEqual(
        expect.arrayContaining(['combine', 'doubleCount']),
      );

      const result = parseApplyResult(
        await applyInstVar(asyncExec, 'gci-iv-remove', [], null, false, false),
      );
      expect(result.failed).toEqual([]);
      expect(result.dropped.map((m) => m.selector)).toEqual(
        expect.arrayContaining(['combine', 'doubleCount']),
      );

      expect(hasIvar(BASE, 'count')).toBe(false);
      expect(includesSelector(BASE, 'combine')).toBe(false);
      expect(includesSelector(BASE, 'getOther')).toBe(false); // never existed
    } finally {
      exec('System abortTransaction');
    }
  });

  it('declines adding a duplicate instance variable', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();

      const analysis = parseAnalysis(
        await analyzeInstVar(asyncExec, 'add', BASE, 'count', userIndex()),
      );
      expect(analysis.decline).toBeTruthy();
    } finally {
      exec('System abortTransaction');
    }
  });

  // The committing paths (migrate instances / delete history) can only be verified end to end
  // here: the engine commits the structural change first (migrateInstancesTo: needs a clean
  // transaction), so an abort-isolated unit/SUnit test cannot observe them. Each test is
  // self-cleaning — it removes the committed class (and any persisted instance) and commits that
  // removal in `finally`, leaving no residue — since `System abortTransaction` cannot undo a commit.

  it('migrates existing instances onto the new version and commits when migrate is requested', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    const CLS = 'GciIvMig';
    try {
      q.compileClassDefinition(
        session,
        `Object subclass: '${CLS}' instVarNames: #(x) classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );
      // A persisted instance of the old version, so migrateInstancesTo: has something on disk to move.
      exec(`UserGlobals at: #GciIvMigInst put: ${CLS} new. System commitTransaction`);

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
          `UserGlobals removeKey: #${CLS} ifAbsent: []. System commitTransaction`,
      );
    }
  });

  it('deletes prior versions from the class history and commits when delete-history is requested', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    const CLS = 'GciIvHist';
    try {
      q.compileClassDefinition(
        session,
        `Object subclass: '${CLS}' instVarNames: #(x) classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );
      exec('System commitTransaction'); // commit the original version so applying bumps history to 2

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
      exec(`UserGlobals removeKey: #${CLS} ifAbsent: []. System commitTransaction`);
    }
  });
});
