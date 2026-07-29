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
  startMoveMethodPreview,
  applyMoveMethod,
} from '../../refactoring/queries/previewMoveMethod';
import { PREVIEW_PAGE_BYTES } from '../../refactoring/queries/previewRenameMethod';
import { parseStartPreview, parseApplyResult } from '../../refactoring/moveMethodPreview';

/**
 * On-demand GCI e2e for the move-method (M6) refactoring, over the real GCI transport
 * (`npm run test:gci`). Drives the actual client query builders + parsers against a
 * live stone: compile a source and target class, move a method, and confirm the stone
 * relocated it (added on the target, removed from the source).
 *
 * Guarded on the refactoring engine being installed in the connected stone — the tests
 * skip (with a reason) when it isn't, since the move queries reference the in-stone
 * `GsMoveMethodRefactoring`. Fully transient: every test rolls back with
 * `System abortTransaction` in a `finally`, so neither the fixtures nor the move are
 * ever committed. All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('move method (gci e2e)', () => {
  let gci: GciLibrary;
  let session: ActiveSession;
  let enginePresent = false;

  const exec = (code: string): string => q.executeFetchString(session, code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const SOURCE = 'GciMmSource';
  const TARGET = 'GciMmTarget';

  const userIndex = (): number =>
    parseInt(
      exec(
        `| sl d | sl := System myUserProfile symbolList. ` +
          `d := sl detect: [:x | x name = #'UserGlobals'] ifNone: [nil]. ` +
          `(d ifNil: [0] ifNotNil: [sl indexOf: d]) printString`,
      ),
      10,
    );

  const includesSelector = (cls: string, sel: string): boolean =>
    exec(`(${cls} includesSelector: #${sel}) printString`).trim() === 'true';

  const defineFixture = (): void => {
    q.compileClassDefinition(
      session,
      `Object subclass: '${SOURCE}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session,
      `Object subclass: '${TARGET}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session, SOURCE, false, 'accessing', 'gciPure\n\t^ 40 + 2');
    q.compileMethod(session, SOURCE, false, 'accessing', 'gciSuper\n\t^ super hash');
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
        '(System myUserProfile symbolList objectNamed: #GsMoveMethodRefactoring) notNil printString',
      ).trim() === 'true';
  });

  afterAll(() => {
    if (session?.handle) gci.GciTsLogout(session.handle);
    gci?.close();
  });

  it('relocates an instance method to another class and removes it from the source', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();

      const start = parseStartPreview(
        await startMoveMethodPreview(
          asyncExec,
          SOURCE,
          ['gciPure'],
          false,
          TARGET,
          false,
          'gci-mm-move',
          PREVIEW_PAGE_BYTES,
          userIndex(),
        ),
      );
      expect(start.total).toBe(2);
      expect(start.movableCount).toBe(1);

      const result = parseApplyResult(await applyMoveMethod(asyncExec, 'gci-mm-move', []));
      expect(result.applied).toBe(2);
      expect(result.failed).toEqual([]);

      expect(includesSelector(TARGET, 'gciPure')).toBe(true);
      expect(includesSelector(SOURCE, 'gciPure')).toBe(false);
    } finally {
      // Evaluate to a String: executeFetchString sends #encodeAsUTF8 to the result, which
      // the System class (the value of `System abortTransaction`) does not understand.
      exec("System abortTransaction. 'ok'");
    }
  });

  it('declines a super-sending method and moves nothing', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();

      const start = parseStartPreview(
        await startMoveMethodPreview(
          asyncExec,
          SOURCE,
          ['gciSuper'],
          false,
          TARGET,
          false,
          'gci-mm-super',
          PREVIEW_PAGE_BYTES,
          userIndex(),
        ),
      );
      expect(start.movableCount).toBe(0);
      expect(start.skippedMethods.map((s) => s.selector)).toContain('gciSuper');

      expect(includesSelector(SOURCE, 'gciSuper')).toBe(true);
      expect(includesSelector(TARGET, 'gciSuper')).toBe(false);
    } finally {
      // Evaluate to a String: executeFetchString sends #encodeAsUTF8 to the result, which
      // the System class (the value of `System abortTransaction`) does not understand.
      exec("System abortTransaction. 'ok'");
    }
  });
});
