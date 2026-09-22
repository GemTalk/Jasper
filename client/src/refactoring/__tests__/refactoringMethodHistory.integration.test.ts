import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { installMethodHistory } from '../../methodHistory/methodHistoryServer';
import { parseMethodHistory } from '../../methodHistory/methodHistoryModel';
import {
  startRenameMethodPreview,
  applyRenameMethod,
  PREVIEW_PAGE_BYTES,
} from '../queries/previewRenameMethod';
import { parseStartPreview, parseApplyResult } from '../renameMethodPreview';
import {
  startRenameTemporaryPreview,
  applyRenameTemporary,
} from '../queries/previewRenameTemporary';
import { startRenameInstVarPreview, applyRenameInstVar } from '../queries/previewRenameInstVar';
import {
  parseStartPreview as parseTempStartPreview,
  parseApplyResult as parseTempApplyResult,
} from '../renameTemporaryPreview';

/**
 * Method history must be the record of what happened to a method, not the record of what was typed
 * into an editor.
 *
 * Editing a method by hand goes through the client's compileMethod query, which brackets the compile
 * with JasperMethodHistory (`client/src/queries/compileMethod.ts`). A refactoring does not: the
 * whole change set is applied server-side by the engine, which compiles through
 * GsRefactoringEnvironment — a path that touches no history. So a method recompiled by a refactoring
 * gains no version, and its history silently stops at the last hand edit.
 *
 * It is worse than a gap. The two compile paths do not even produce the same KIND of string: a
 * method Jasper compiled answers a `Unicode7` from #sourceString, one the engine recompiled answers
 * a plain `String`. JasperMethodHistory's read compares the recorded source against the installed
 * one to decide which version is current, and on 3.6.x that cross-kind `=` raises ArgumentError
 * 2718, 'String argument disallowed in Unicode comparison'. So after a refactoring the method's
 * history does not merely stop — it cannot be opened at all. A fix that only seeds history has to
 * settle the string kind too, or the history stays unreadable.
 *
 * Two refactorings are driven here rather than one, because the issue asks for each to be checked
 * rather than assumed to share a path:
 *
 *  - **rename method**, which has both shapes of recompile in one apply — the implementor whose
 *    selector changes, and the sender whose body is rewritten in place;
 *  - **rename temporary**, the method-local engine, which recompiles exactly ONE method under its
 *    own unchanged selector — the simplest possible "this method changed" case.
 *
 * Both go through `GsRefactoringEnvironment`, so both are expected to fail the same way; asserting
 * it is what turns that expectation into a fact. A fix is done when every test in this file passes.
 * See the "refactoring that recompiles a method doesn't add to that method's history" item in
 * https://github.com/GemTalk/Jasper/issues/622.
 *
 * Gated on the refactoring engine being present, so a bare stone skips the body but stays green.
 * Fully transient: the useIntegrationTest harness aborts each test, so the fixture class, the
 * recorded history and the applied refactoring are all rolled back. All emitted Smalltalk is
 * ASCII-only for the 3.6.x matrix.
 */
describe('method history across a refactoring (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const CLS = 'RMHItFixture';

  /** A class with an implementor of `movePointX:y:`, a caller that sends it, a method with a
   *  temporary to rename, a method that READS the instance variable, and one that touches nothing —
   *  each already carrying a hand-edit history, so the only question below is whether the
   *  refactoring ADDS to it. The last two are for the class-re-versioning case: one method the
   *  rename rewrites, and one it merely carries across. */
  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${CLS}' instVarNames: #(count) classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(
      session(),
      CLS,
      false,
      'moving',
      'movePointX: x y: y\n\t^Array with: x with: y',
    );
    q.compileMethod(session(), CLS, false, 'moving', 'caller\n\t^self movePointX: 1 y: 2');
    q.compileMethod(session(), CLS, false, 'moving', 'local\n\t| t |\n\tt := 1.\n\t^t + t');
    // Reads the instance variable, so renaming it rewrites THIS method and no other.
    q.compileMethod(session(), CLS, false, 'accessing', 'readsIvar\n\t^ count + 1');
    // Touches nothing the ivar rename rewrites — the control for the copy-forward guard.
    q.compileMethod(session(), CLS, false, 'accessing', 'untouched\n\t^ 42');
  };

  const historyOf = (selector: string) =>
    parseMethodHistory(q.getMethodHistory(session(), CLS, selector, false));

  /** The versions the history really holds — a method with no history still answers one synthetic
   *  `notInHistory` row standing for what is installed now. */
  const recorded = (selector: string) => historyOf(selector).filter((v) => !v.notInHistory);

  /** The class of a method's #sourceString, which is what the history read compares on. */
  const sourceKind = (selector: string): string =>
    exec(
      `(${CLS} compiledMethodAt: #'${selector}' environmentId: 0) sourceString class name`,
    ).trim();

  const installedSource = (selector: string): string =>
    exec(`(${CLS} compiledMethodAt: #'${selector}' environmentId: 0) sourceString`);

  /** Rename `movePointX:y:` to `moveY:x:` across the whole system, previewing then applying. */
  const renameMovePoint = async (token: string): Promise<void> => {
    const start = parseStartPreview(
      await startRenameMethodPreview(
        asyncExec,
        CLS,
        'movePointX:y:',
        ['moveY:', 'x:'],
        [2, 1],
        { kind: 'wholeSystem' },
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );
    expect(start.total).toBeGreaterThanOrEqual(2);
    const result = parseApplyResult(await applyRenameMethod(asyncExec, token, [], 'test undo'));
    expect(result.failed).toEqual([]);
  };

  /** Rename the temporary `t` to `sum` in `local` — one method recompiled, selector unchanged. */
  const renameLocalTemp = async (token: string): Promise<void> => {
    const offset = installedSource('local').indexOf('t :=') + 1;
    const start = parseTempStartPreview(
      await startRenameTemporaryPreview(
        asyncExec,
        CLS,
        'local',
        false,
        't',
        'sum',
        offset,
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );
    expect(start.total).toBe(1);
    const result = parseTempApplyResult(await applyRenameTemporary(asyncExec, token, 'test undo'));
    expect(result.failed).toEqual([]);
  };

  /** Rename the instance variable `count` to `total`, previewing then applying. */
  const renameIvar = async (token: string): Promise<void> => {
    const exec2 = (code: string): string => exec(code);
    startRenameInstVarPreview(exec2, CLS, 'count', 'total', token);
    applyRenameInstVar(exec2, token, []);
  };

  // ── a refactoring that RE-VERSIONS the class ───────────────────────────────

  /**
   * The gap the first cut of this fix left. An instance-variable rename does not route through
   * GsRefactoringUndo at all — it calls its own applyForToken:, as every class-reshaping engine does
   * — so hooking the undo recorder reached only the nine method-level refactorings. The issue names
   * this one explicitly ("an inst-var rename that rewrites it"), so it is pinned here.
   */
  describe('rename instance variable', () => {
    it('records the rewritten body of the method that read the variable', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      const before = recorded('readsIvar').length;
      await renameIvar(`rmhit-ivar-${CLS}`);

      const after = recorded('readsIvar');
      expect(installedSource('readsIvar')).toContain('total + 1');
      expect(after.length).toBe(before + 1);
      expect(after[0].source).toContain('total + 1');
    });

    it('keeps the pre-refactoring source available to go back to', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      await renameIvar(`rmhit-ivar-back-${CLS}`);

      expect(recorded('readsIvar').map((v) => v.source)).toContainEqual(
        expect.stringContaining('count + 1'),
      );
    });

    it('does not stamp a version onto every method the re-version carried across', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      const before = recorded('untouched').length;
      await renameIvar(`rmhit-ivar-quiet-${CLS}`);

      // A new class version starts with an empty method dictionary, so EVERY method comes through
      // the copy-forward — including ones the rename did not rewrite. Recording those would turn one
      // rename into a version on every method of the class.
      expect(installedSource('untouched')).toContain('^ 42');
      expect(recorded('untouched').length).toBe(before);
    });

    it('still opens the history of a method it carried across untouched', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      await renameIvar(`rmhit-ivar-open-${CLS}`);

      expect(() => historyOf('untouched')).not.toThrow();
      expect(() => historyOf('readsIvar')).not.toThrow();
    });
  });

  // ── the two compile paths install different kinds of string, on purpose ───

  /**
   * These pin the DIAGNOSIS, not a wanted change: the two paths really do install different string
   * classes, and that is left alone.
   *
   * Making the engine promote its source to Unicode would touch every engine compile — class rename,
   * split, extract, all of them — to satisfy one comparison, and the engine already assumes the kinds
   * can differ (GsRefactoringUndo>>source:matches: exists for exactly this pair, and says so). The fix
   * is therefore in the COMPARISON: JasperMethodHistory compares sources character by character, so
   * any mismatch of kind is safe, not just this one. These tests exist so the difference is not
   * mistaken for the bug and "fixed" at the compile end later.
   */
  describe('the kind of string each compile path installs', () => {
    it('is Unicode7 for a method Jasper compiled', (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      expect(sourceKind('caller')).toBe('Unicode7');
    });

    it('is a byte String for a method the refactoring engine recompiled', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      await renameMovePoint(`rmhit-kind-sender-${CLS}`);

      expect(sourceKind('caller')).toBe('String');
    });

    it('differs between the two paths for the same class', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      await renameLocalTemp(`rmhit-kind-temp-${CLS}`);

      // `local` went through the engine, `caller` did not — one class, two kinds, and the history of
      // both still opens. That is the invariant the fix actually rests on.
      expect([sourceKind('local'), sourceKind('caller')]).toEqual(['String', 'Unicode7']);
      expect(() => historyOf('local')).not.toThrow();
      expect(() => historyOf('caller')).not.toThrow();
    });
  });

  // ── the history must still open ────────────────────────────────────────────

  describe('opening the history of a method a refactoring recompiled', () => {
    it('does not raise for a sender a rename method rewrote', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      await renameMovePoint(`rmhit-open-sender-${CLS}`);

      expect(() => historyOf('caller')).not.toThrow();
    });

    it('does not raise for the implementor a rename method moved', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      await renameMovePoint(`rmhit-open-impl-${CLS}`);

      expect(() => historyOf('moveY:x:')).not.toThrow();
    });

    it('does not raise for a method a rename temporary rewrote', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      await renameLocalTemp(`rmhit-open-temp-${CLS}`);

      expect(() => historyOf('local')).not.toThrow();
    });

    it('does not raise for a method the refactoring did NOT touch', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      await renameLocalTemp(`rmhit-open-untouched-${CLS}`);

      // The control: an untouched method's history is readable before and after, so a failure
      // above is the refactoring's doing and not something the fixture broke.
      expect(() => historyOf('caller')).not.toThrow();
    });
  });

  // ── the history must gain the version the refactoring compiled ─────────────

  describe('rename method', () => {
    it('records the rewritten body of a sender it recompiled', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      const before = recorded('caller').length;
      await renameMovePoint(`rmhit-sender-${CLS}`);

      const after = recorded('caller');
      expect(installedSource('caller')).toContain('moveY: 2 x: 1');
      expect(after.length).toBe(before + 1);
      expect(after[0].source).toContain('moveY: 2 x: 1');
    });

    it('keeps the pre-refactoring source of that sender available to go back to', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      await renameMovePoint(`rmhit-back-${CLS}`);

      expect(recorded('caller').map((v) => v.source)).toContainEqual(
        expect.stringContaining('movePointX: 1 y: 2'),
      );
    });

    it('flags the version it just compiled as the current one', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      await renameMovePoint(`rmhit-current-${CLS}`);

      // Not `notInHistory`: the installed source must BE one of the recorded versions, which is
      // what makes Revert-to-previous meaningful after a refactoring.
      const current = historyOf('caller').find((v) => v.isCurrent);
      expect(current?.notInHistory).not.toBe(true);
      expect(current?.source).toContain('moveY: 2 x: 1');
    });

    it('records the renamed implementor under its new selector', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      await renameMovePoint(`rmhit-impl-${CLS}`);

      const versions = recorded('moveY:x:');
      expect(versions.length).toBeGreaterThanOrEqual(1);
      expect(versions[0].source).toContain('moveY: y x: x');
    });

    it('leaves the history of a method it did not recompile alone', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      const before = recorded('local').length;
      await renameMovePoint(`rmhit-untouched-${CLS}`);

      // The control on the other side: history must not grow for a method nothing happened to.
      expect(recorded('local').length).toBe(before);
    });
  });

  describe('rename temporary', () => {
    it('records the rewritten body of the one method it recompiled', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      const before = recorded('local').length;
      await renameLocalTemp(`rmhit-temp-${CLS}`);

      const after = recorded('local');
      expect(installedSource('local')).toContain('sum := 1');
      expect(after.length).toBe(before + 1);
      expect(after[0].source).toContain('sum := 1');
    });

    it('keeps the pre-refactoring source available to go back to', async (ctx) => {
      requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
      installMethodHistory(session());
      defineFixture();

      await renameLocalTemp(`rmhit-temp-back-${CLS}`);

      expect(recorded('local').map((v) => v.source)).toContainEqual(
        expect.stringContaining('t := 1'),
      );
    });
  });
});
