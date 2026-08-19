import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import {
  PREVIEW_PAGE_BYTES,
  applyRenameMethod,
  startRenameMethodPreview,
} from '../queries/previewRenameMethod';
import {
  captureClassHistory,
  commitHistoryRevert,
  discardPendingCapture,
  recordReverseRename,
  refactoringUndoStatus,
  startUndoRefactoringPreview,
  pageUndoRefactoringPreview,
  applyUndoRefactoring,
  clearUndoRefactoringPreview,
  clearRefactoringUndo,
} from '../queries/previewUndoRefactoring';
import {
  parseUndoStatus,
  parseUndoStartPreview,
  parseUndoPage,
  parseApplyResult,
} from '../undoRefactoringPreview';
import { startExtractMethodPreview, applyExtractMethod } from '../queries/previewExtractMethod';
import {
  startExtractTemporaryPreview,
  applyExtractTemporary,
} from '../queries/previewExtractTemporary';
import { startInlineMethodPreview, applyInlineMethod } from '../queries/previewInlineMethod';
import {
  startInlineTemporaryPreview,
  applyInlineTemporary,
} from '../queries/previewInlineTemporary';
import { startMoveMethodPreview, applyMoveMethod } from '../queries/previewMoveMethod';
import { startPushMethodPreview, applyPushMethod } from '../queries/previewPushMethod';
import {
  startRenameTemporaryPreview,
  applyRenameTemporary,
} from '../queries/previewRenameTemporary';
import {
  startChangeSignaturePreview,
  applyChangeSignature,
} from '../queries/previewChangeSignature';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { fileInEngineTestsExpr } from './support/refactoring';

/**
 * Automatic GCI integration test for UNDOING a refactoring (#434), over the real GCI
 * transport and through the same query builders and parsers the extension uses.
 *
 * Layers:
 *  1. The engine's GS SUnit suite (GsRefactoringUndoTest), filed in and run in-stone.
 *  2. One apply-then-undo round trip per undoable refactoring, each asserting the
 *     WHOLE class is back where it started — every selector on BOTH sides, each with
 *     its source and its category, including the methods the refactoring had no
 *     reason to touch. Those last ones are the point: no change set mentions them, so
 *     nothing else would catch their loss.
 *  3. The behaviour around the record: the status probe, drift as a warning rather
 *     than a refusal, per-change deselection, a clean undo consuming the entry, and
 *     the safety rule that a refactoring which reshapes a class records nothing.
 *
 * Gated via the shared server-plugin feature gate. Fully transient: the harness aborts
 * each test, so the fixture classes and every applied change roll back and nothing is
 * committed. All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('undo a refactoring (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  // Distinctive names so no refactoring here can reach a same-named method elsewhere in
  // the image, and every scope stays #class.
  const CLS = 'UndoItAccount';
  const OTHER = 'UndoItLedger';
  const SUB = 'UndoItSavings';

  const defineFixture = (): void => {
    const def = (name: string, sup: string, ivars: string): void => {
      q.compileClassDefinition(
        session(),
        `${sup} subclass: '${name}' instVarNames: #(${ivars}) classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );
    };
    // `undoSpare` is read by nothing on purpose: pushing an instance variable DOWN is declined
    // when the parent's own methods still use it, so a push-down test needs one that is free to
    // move. `balance` is deliberately not that -- undoBalance reads it.
    def(CLS, 'Object', "'balance' 'undoSpare'");
    def(OTHER, 'Object', "'balance'");
    def(SUB, CLS, '');
    q.compileMethod(session(), CLS, false, 'computing', 'undoTotal\n\t^ 40 + 2');
    q.compileMethod(
      session(),
      CLS,
      false,
      'printing',
      "undoReport\n\t^ 'total is ', self undoTotal printString",
    );
    q.compileMethod(session(), CLS, false, 'fixture', "undoUntouched\n\t^ 'kept'");
    q.compileMethod(session(), CLS, false, 'accessing', 'undoBalance\n\t^ balance');
    q.compileMethod(session(), CLS, false, 'computing', 'undoPure\n\t^ 7 * 6');
    q.compileMethod(session(), CLS, true, 'fixture', "undoAlsoUntouched\n\t^ 'class side'");
    q.compileMethod(session(), OTHER, false, 'fixture', 'undoLedgerOwn\n\t^ 1');
    q.compileMethod(session(), SUB, false, 'fixture', 'undoSavingsOwn\n\t^ 2');
  };

  /** Every selector on both sides of `cls`, each with its source and category, as a
   *  sorted list of `side|selector|category|source` lines. Comparing two of these is
   *  the whole-class assertion an undo has to survive. */
  const snapshot = (cls: string): string[] => {
    const raw = exec(`| ws add |
ws := WriteStream on: String new.
add := [:behavior :side |
  behavior selectors asSortedCollection do: [:sel | | m |
    m := behavior compiledMethodAt: sel environmentId: 0 otherwise: nil.
    ws nextPutAll: side; nextPutAll: '|'; nextPutAll: sel asString;
       nextPutAll: '|'; nextPutAll: ((behavior categoryOfSelector: sel environmentId: 0) ifNil: ['?']) asString;
       nextPutAll: '|'; nextPutAll: (m isNil ifTrue: ['<none>'] ifFalse: [m sourceString]);
       nextPutAll: '<<>>']].
add value: ${cls} value: 'inst'.
add value: ${cls} class value: 'meta'.
ws contents`);
    return raw
      .split('<<>>')
      .filter((s) => s.trim().length > 0)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .sort();
  };

  const definesSelector = (cls: string, selector: string, meta = false): boolean =>
    exec(
      `((${cls}${meta ? ' class' : ''}) compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) notNil printString`,
    ).trim() === 'true';

  const ownInstVarNames = (cls: string): string[] => {
    const raw = exec(`(${cls} instVarNames collect: [:e | e asString]) printString`);
    return [...raw.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  };

  const offsetOf = (cls: string, selector: string, text: string): number =>
    parseInt(
      exec(
        `((${cls} compiledMethodAt: #'${selector}') sourceString indexOfSubCollection: '${text}') printString`,
      ).trim(),
      10,
    );

  const undoStatus = (): ReturnType<typeof parseUndoStatus> =>
    parseUndoStatus(refactoringUndoStatus((code) => exec(code)));

  /** Run the whole undo through the client path: probe, preview (loading EVERY page,
   *  so pagination is exercised), apply, drop the preview. */
  const undoEverything = async (
    deselect: (changes: ReturnType<typeof parseUndoPage>['changes']) => string[] = () => [],
  ): Promise<{ applied: number; failed: unknown[]; label: string; drifted: number }> => {
    const token = `undo-it-${Math.random().toString(36).slice(2)}`;
    const start = parseUndoStartPreview(
      await startUndoRefactoringPreview(asyncExec, token, PREVIEW_PAGE_BYTES),
    );
    const changes = [...start.page.changes];
    let offset = start.page.nextOffset;
    let done = start.page.done;
    while (!done) {
      const page = parseUndoPage(
        await pageUndoRefactoringPreview(asyncExec, token, offset, PREVIEW_PAGE_BYTES),
      );
      changes.push(...page.changes);
      offset = page.nextOffset;
      done = page.done;
    }
    expect(changes).toHaveLength(start.total);
    const result = parseApplyResult(
      await applyUndoRefactoring(asyncExec, token, deselect(changes)),
    );
    clearUndoRefactoringPreview((code) => exec(code), token);
    return { ...result, label: start.label, drifted: start.drifted };
  };

  it('reports undo-engine availability matching the shared refactoring probe', () => {
    const present =
      exec(
        '(System myUserProfile symbolList objectNamed: #GsRefactoringUndo) notNil printString',
      ).trim() === 'true';
    expect(present).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  // Generous timeout: this files in the whole (growing) engine-tests.gs payload and runs
  // a full SUnit suite in-stone over the GCI transport.
  it('runs the undo GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInEngineTestsExpr()}
r := (System myUserProfile symbolList objectNamed: #GsRefactoringUndoTest) suite run.
(r failures size + r errors size) printString`;

    expect(exec(code).trim()).toBe('0');
  }, 120_000);

  it('has nothing to undo in a fresh session', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    clearRefactoringUndo((code) => exec(code));

    expect(undoStatus().available).toBe(false);
  });

  it('undoes a rename method, restoring the whole class including its senders', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    const before = snapshot(CLS);

    const token = 'undo-rename';
    await startRenameMethodPreview(
      asyncExec,
      CLS,
      'undoTotal',
      ['undoSum'],
      [],
      { kind: 'class' },
      token,
      PREVIEW_PAGE_BYTES,
    );
    const applied = parseApplyResult(
      await applyRenameMethod(asyncExec, token, [], 'Rename #undoTotal to #undoSum'),
    );
    expect(applied.failed).toHaveLength(0);
    expect(definesSelector(CLS, 'undoSum')).toBe(true);
    expect(definesSelector(CLS, 'undoTotal')).toBe(false);

    // The client is told, in the apply's own answer, that an undo was recorded.
    expect(undoStatus()).toMatchObject({
      available: true,
      label: 'Rename #undoTotal to #undoSum',
      engine: 'GsRenameMethodRefactoring',
    });

    const undone = await undoEverything();
    expect(undone.failed).toHaveLength(0);
    expect(undone.label).toBe('Rename #undoTotal to #undoSum');
    expect(snapshot(CLS)).toEqual(before);
  }, 60_000);

  it('uses the record up once a clean undo has run', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();

    const token = 'undo-once';
    await startRenameMethodPreview(
      asyncExec,
      CLS,
      'undoTotal',
      ['undoSum'],
      [],
      { kind: 'class' },
      token,
      PREVIEW_PAGE_BYTES,
    );
    await applyRenameMethod(asyncExec, token, [], 'Rename #undoTotal to #undoSum');
    expect(undoStatus().available).toBe(true);

    await undoEverything();

    expect(undoStatus().available).toBe(false);
  }, 60_000);

  it('warns about a method edited since the refactoring, and still undoes it', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();

    const token = 'undo-drift';
    await startRenameMethodPreview(
      asyncExec,
      CLS,
      'undoTotal',
      ['undoSum'],
      [],
      { kind: 'class' },
      token,
      PREVIEW_PAGE_BYTES,
    );
    await applyRenameMethod(asyncExec, token, [], 'Rename #undoTotal to #undoSum');

    // Edit the renamed method after the fact.
    q.compileMethod(session(), CLS, false, 'computing', 'undoSum\n\t^ 999');

    const previewToken = 'undo-drift-preview';
    const start = parseUndoStartPreview(
      await startUndoRefactoringPreview(asyncExec, previewToken, PREVIEW_PAGE_BYTES),
    );
    clearUndoRefactoringPreview((code) => exec(code), previewToken);
    expect(start.drifted).toBeGreaterThan(0);
    expect(start.page.changes.some((c) => (c.warning ?? '').includes('Edited since'))).toBe(true);

    // Warned, not refused.
    const undone = await undoEverything();
    expect(undone.failed).toHaveLength(0);
    expect(definesSelector(CLS, 'undoTotal')).toBe(true);
    expect(definesSelector(CLS, 'undoSum')).toBe(false);
  }, 60_000);

  it('leaves a deselected change alone and keeps the record for another go', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();

    const token = 'undo-partial';
    await startRenameMethodPreview(
      asyncExec,
      CLS,
      'undoTotal',
      ['undoSum'],
      [],
      { kind: 'class' },
      token,
      PREVIEW_PAGE_BYTES,
    );
    await applyRenameMethod(asyncExec, token, [], 'Rename #undoTotal to #undoSum');

    // Keep the new selector: deselect the change that would delete it.
    const undone = await undoEverything((changes) =>
      changes.filter((c) => c.kind === 'methodRemove').map((c) => c.id),
    );
    expect(undone.failed).toHaveLength(0);
    expect(definesSelector(CLS, 'undoTotal')).toBe(true);
    expect(definesSelector(CLS, 'undoSum')).toBe(true);
    // A partial undo is not used up.
    expect(undoStatus().available).toBe(true);
  }, 60_000);

  it('undoes an extract method, removing the extracted method and restoring the original', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    const before = snapshot(CLS);

    const start = offsetOf(CLS, 'undoTotal', '40 + 2');
    const token = 'undo-extract-method';
    await startExtractMethodPreview(
      asyncExec,
      CLS,
      'undoTotal',
      false,
      start,
      start + '40 + 2'.length - 1,
      'undoAnswer',
      false,
      token,
      PREVIEW_PAGE_BYTES,
    );
    await applyExtractMethod(asyncExec, token, [], 'Extract method #undoAnswer');
    expect(definesSelector(CLS, 'undoAnswer')).toBe(true);

    expect((await undoEverything()).failed).toHaveLength(0);
    expect(definesSelector(CLS, 'undoAnswer')).toBe(false);
    expect(snapshot(CLS)).toEqual(before);
  }, 60_000);

  it('undoes an inline method, bringing the deleted method back with its category', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    const before = snapshot(CLS);

    const token = 'undo-inline-method';
    await startInlineMethodPreview(
      asyncExec,
      CLS,
      'undoReport',
      false,
      offsetOf(CLS, 'undoReport', 'undoTotal printString'),
      token,
      PREVIEW_PAGE_BYTES,
    );
    await applyInlineMethod(asyncExec, token, [], 'Inline #undoTotal');
    // Inlining the last sender deletes the target.
    expect(definesSelector(CLS, 'undoTotal')).toBe(false);

    expect((await undoEverything()).failed).toHaveLength(0);
    expect(definesSelector(CLS, 'undoTotal')).toBe(true);
    // The whole-class comparison covers the CATEGORY too — a restored method landing in
    // 'as yet unclassified' would fail here.
    expect(snapshot(CLS)).toEqual(before);
  }, 60_000);

  it('undoes a move method, restoring both the source and the target class', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    const beforeSource = snapshot(CLS);
    const beforeTarget = snapshot(OTHER);

    const token = 'undo-move';
    await startMoveMethodPreview(
      asyncExec,
      CLS,
      ['undoPure'],
      false,
      OTHER,
      false,
      token,
      PREVIEW_PAGE_BYTES,
    );
    await applyMoveMethod(asyncExec, token, [], `Move #undoPure to ${OTHER}`);
    expect(definesSelector(OTHER, 'undoPure')).toBe(true);
    expect(definesSelector(CLS, 'undoPure')).toBe(false);

    expect((await undoEverything()).failed).toHaveLength(0);
    expect(snapshot(CLS)).toEqual(beforeSource);
    expect(snapshot(OTHER)).toEqual(beforeTarget);
  }, 60_000);

  it('undoes a push up, restoring both the subclass and the superclass', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    q.compileMethod(session(), SUB, false, 'computing', 'undoSavingsPure\n\t^ 3');
    const beforeParent = snapshot(CLS);
    const beforeChild = snapshot(SUB);

    const token = 'undo-push-up';
    await startPushMethodPreview(
      asyncExec,
      'up',
      SUB,
      ['undoSavingsPure'],
      false,
      token,
      PREVIEW_PAGE_BYTES,
    );
    await applyPushMethod(asyncExec, 'up', token, [], `Push up from ${SUB}`);
    expect(definesSelector(CLS, 'undoSavingsPure')).toBe(true);

    expect((await undoEverything()).failed).toHaveLength(0);
    expect(snapshot(CLS)).toEqual(beforeParent);
    expect(snapshot(SUB)).toEqual(beforeChild);
  }, 60_000);

  it('undoes a push down, restoring both the superclass and the subclass', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    const beforeParent = snapshot(CLS);
    const beforeChild = snapshot(SUB);

    const token = 'undo-push-down';
    await startPushMethodPreview(
      asyncExec,
      'down',
      CLS,
      ['undoPure'],
      false,
      token,
      PREVIEW_PAGE_BYTES,
    );
    await applyPushMethod(asyncExec, 'down', token, [], `Push down from ${CLS}`);
    expect(definesSelector(SUB, 'undoPure')).toBe(true);

    expect((await undoEverything()).failed).toHaveLength(0);
    expect(snapshot(CLS)).toEqual(beforeParent);
    expect(snapshot(SUB)).toEqual(beforeChild);
  }, 60_000);

  it('undoes a change signature, restoring the implementor and its sender', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    q.compileMethod(session(), CLS, false, 'computing', 'undoScaleBy: aNumber\n\t^ 42 * aNumber');
    q.compileMethod(session(), CLS, false, 'computing', 'undoUseScale\n\t^ self undoScaleBy: 2');
    const before = snapshot(CLS);

    const token = 'undo-change-signature';
    await startChangeSignaturePreview(
      asyncExec,
      CLS,
      'undoScaleBy:',
      ['undoTimes:'],
      [1],
      ['aNumber'],
      [''],
      { kind: 'class' },
      token,
      PREVIEW_PAGE_BYTES,
      false,
    );
    await applyChangeSignature(
      asyncExec,
      token,
      [],
      'Change signature #undoScaleBy: to #undoTimes:',
    );
    expect(definesSelector(CLS, 'undoTimes:')).toBe(true);

    expect((await undoEverything()).failed).toHaveLength(0);
    expect(snapshot(CLS)).toEqual(before);
  }, 60_000);

  it('undoes a rename temporary', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    q.compileMethod(
      session(),
      CLS,
      false,
      'computing',
      'undoWithTemp\n\t| t |\n\tt := 3.\n\t^ t + 1',
    );
    const before = snapshot(CLS);

    const token = 'undo-rename-temp';
    await startRenameTemporaryPreview(
      asyncExec,
      CLS,
      'undoWithTemp',
      false,
      't',
      'count',
      offsetOf(CLS, 'undoWithTemp', 't := 3'),
      token,
      PREVIEW_PAGE_BYTES,
    );
    await applyRenameTemporary(asyncExec, token, "Rename temporary 't' to 'count'");
    expect(exec(`(${CLS} compiledMethodAt: #undoWithTemp) sourceString`)).toContain('count');

    expect((await undoEverything()).failed).toHaveLength(0);
    expect(snapshot(CLS)).toEqual(before);
  }, 60_000);

  it('undoes an extract temporary', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    const before = snapshot(CLS);

    const start = offsetOf(CLS, 'undoPure', '7 * 6');
    const token = 'undo-extract-temp';
    await startExtractTemporaryPreview(
      asyncExec,
      CLS,
      'undoPure',
      false,
      start,
      start + '7 * 6'.length - 1,
      'product',
      false,
      token,
      PREVIEW_PAGE_BYTES,
    );
    await applyExtractTemporary(asyncExec, token, "Extract temporary 'product'");
    expect(exec(`(${CLS} compiledMethodAt: #undoPure) sourceString`)).toContain('product');

    expect((await undoEverything()).failed).toHaveLength(0);
    expect(snapshot(CLS)).toEqual(before);
  }, 60_000);

  it('undoes an inline temporary', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    q.compileMethod(
      session(),
      CLS,
      false,
      'computing',
      'undoInlineMe\n\t| tOnce |\n\ttOnce := 5.\n\t^ tOnce + 1',
    );
    const before = snapshot(CLS);

    const token = 'undo-inline-temp';
    await startInlineTemporaryPreview(
      asyncExec,
      CLS,
      'undoInlineMe',
      false,
      offsetOf(CLS, 'undoInlineMe', 'tOnce := 5'),
      token,
      PREVIEW_PAGE_BYTES,
    );
    await applyInlineTemporary(asyncExec, token, "Inline temporary 'tOnce'");
    expect(exec(`(${CLS} compiledMethodAt: #undoInlineMe) sourceString`)).not.toContain(
      'tOnce := 5',
    );

    expect((await undoEverything()).failed).toHaveLength(0);
    expect(snapshot(CLS)).toEqual(before);
  }, 60_000);

  it('undoes a class-side rename without disturbing the instance side', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    q.compileMethod(session(), CLS, true, 'instance creation', 'undoMake\n\t^ self new');
    const before = snapshot(CLS);

    const token = 'undo-meta-rename';
    await startRenameMethodPreview(
      asyncExec,
      CLS,
      'undoMake',
      ['undoBuild'],
      [],
      { kind: 'class' },
      token,
      PREVIEW_PAGE_BYTES,
    );
    await applyRenameMethod(asyncExec, token, [], 'Rename #undoMake to #undoBuild');
    expect(definesSelector(CLS, 'undoBuild', true)).toBe(true);

    expect((await undoEverything()).failed).toHaveLength(0);
    expect(snapshot(CLS)).toEqual(before);
  }, 60_000);

  it('records nothing for a refactoring that reshapes a class', (ctx) => {
    // The safety rule for this tier: class shape is not reversible here, so no entry is
    // recorded rather than a half-undo being offered. Asserted at the engine's own seam,
    // over a change set holding a class-definition edit.
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    clearRefactoringUndo((code) => exec(code));

    const answer = exec(`| undoCls cs |
undoCls := System myUserProfile symbolList objectNamed: #GsRefactoringUndo.
cs := (System myUserProfile symbolList objectNamed: #GsRefactoringChangeSet) new.
cs addMethodRecompileInDictionary: nil className: 'Object' isMeta: false
   selector: 'foo' category: 'x' oldSource: 'foo ^1' newSource: 'foo ^2'.
cs addClassDefinitionEditInDictionary: nil className: 'Object' oldSource: 'a' newSource: 'b'.
(undoCls slotsTouchedIn: cs deselected: #()) isNil printString`);

    expect(answer.trim()).toBe('true');
    expect(undoStatus().available).toBe(false);
  });

  // ---------------------------------------------------------------------------------------
  // Reversing a RENAME (#434). These entries are not a recorded inverse: the reversal is the
  // same rename engine run the other way, so the checks are "is the name back, and did the
  // work I did after the rename survive" rather than "is the change set inverted".
  // ---------------------------------------------------------------------------------------

  const RENAMED = 'UndoItRenamedAccount';

  it('reverses a class rename, putting the name back', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    // Rename it for real, engine-side (the client's rename flow is UI; the engine is the part
    // under test here).
    exec(`(GsRenameClassRefactoring class: ${CLS} renameTo: '${RENAMED}' scope: #wholeSystem)
      applyDeselected: #()`);
    expect(exec(`(UserGlobals at: #'${RENAMED}' ifAbsent: [nil]) notNil printString`).trim()).toBe(
      'true',
    );

    recordReverseRename(
      (code) => exec(code),
      'classRename',
      RENAMED,
      RENAMED,
      CLS,
      `Rename class ${CLS} to ${RENAMED}`,
      'GsRenameClassRefactoring',
      { kind: 'wholeSystem' },
    );

    const status = undoStatus();
    expect(status.available).toBe(true);
    expect(status.mechanism).toBe('mirror');

    const undone = await undoEverything();
    expect(undone.failed).toHaveLength(0);
    expect(exec(`(UserGlobals at: #'${CLS}' ifAbsent: [nil]) notNil printString`).trim()).toBe(
      'true',
    );
    expect(exec(`(UserGlobals at: #'${RENAMED}' ifAbsent: [nil]) isNil printString`).trim()).toBe(
      'true',
    );
  }, 60_000);

  it('carries work written after the rename through the reversal', async (ctx) => {
    // The compensation for not being a rollback, and the reason renaming back beats a
    // class-history revert here: a rename copies methods forward, so a method added after the
    // rename survives — a history revert would have discarded it.
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    exec(`(GsRenameClassRefactoring class: ${CLS} renameTo: '${RENAMED}' scope: #wholeSystem)
      applyDeselected: #()`);
    q.compileMethod(session(), RENAMED, false, 'after', 'undoWrittenLater\n\t^ 123');

    recordReverseRename(
      (code) => exec(code),
      'classRename',
      RENAMED,
      RENAMED,
      CLS,
      `Rename class ${CLS} to ${RENAMED}`,
      'GsRenameClassRefactoring',
      { kind: 'wholeSystem' },
    );
    expect((await undoEverything()).failed).toHaveLength(0);

    expect(definesSelector(CLS, 'undoWrittenLater')).toBe(true);
    // And the untouched originals came through both renames too.
    expect(definesSelector(CLS, 'undoUntouched')).toBe(true);
    expect(definesSelector(CLS, 'undoAlsoUntouched', true)).toBe(true);
  }, 60_000);

  it('previews a reverse rename as the reverse rename own change set', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    exec(`(GsRenameClassRefactoring class: ${CLS} renameTo: '${RENAMED}' scope: #wholeSystem)
      applyDeselected: #()`);
    recordReverseRename(
      (code) => exec(code),
      'classRename',
      RENAMED,
      RENAMED,
      CLS,
      `Rename class ${CLS} to ${RENAMED}`,
      'GsRenameClassRefactoring',
      { kind: 'wholeSystem' },
    );

    const token = 'undo-rev-preview';
    const start = parseUndoStartPreview(
      await startUndoRefactoringPreview(asyncExec, token, PREVIEW_PAGE_BYTES),
    );
    clearUndoRefactoringPreview((code) => exec(code), token);

    expect(start.mechanism).toBe('mirror');
    // Class-shape rows the change-set path never produces — the preview must render them.
    const rename = start.page.changes.find((c) => c.kind === 'classRename');
    expect(rename).toBeDefined();
    expect(rename?.newName).toBe(CLS);
    expect(rename?.selector).toBeNull();
    // A reverse rename derives its rows from the stone as it is now, so nothing is drifted.
    expect(start.drifted).toBe(0);
  }, 60_000);

  it('reverses a renamed instance variable', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    exec(`(GsRenameInstanceVariableRefactoring class: ${CLS} renameInstVar: 'balance' to: 'undoFunds')
      applyDeselected: #()`);
    expect(ownInstVarNames(CLS)).toContain('undoFunds');

    recordReverseRename(
      (code) => exec(code),
      'instVarRename',
      CLS,
      'undoFunds',
      'balance',
      `Rename instance variable balance to undoFunds in ${CLS}`,
      'GsRenameInstanceVariableRefactoring',
    );
    expect((await undoEverything()).failed).toHaveLength(0);

    expect(ownInstVarNames(CLS)).toContain('balance');
    expect(ownInstVarNames(CLS)).not.toContain('undoFunds');
    // The accessor that reads it recompiled both ways and still names the variable.
    expect(exec(`(${CLS} compiledMethodAt: #undoBalance) sourceString`)).toContain('balance');
  }, 60_000);

  it('refuses, with a reason, when the old name has been taken by something else', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    exec(`(GsRenameClassRefactoring class: ${CLS} renameTo: '${RENAMED}' scope: #wholeSystem)
      applyDeselected: #()`);
    // Something new takes the old name. Reversing would have to clobber it.
    q.compileClassDefinition(
      session(),
      `Object subclass: '${CLS}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session(), CLS, false, 'fixture', 'undoIAmTheNewOne\n\t^ true');

    recordReverseRename(
      (code) => exec(code),
      'classRename',
      RENAMED,
      RENAMED,
      CLS,
      `Rename class ${CLS} to ${RENAMED}`,
      'GsRenameClassRefactoring',
      { kind: 'wholeSystem' },
    );

    // The preview refuses up front rather than opening over a reversal that would fail.
    await expect(
      startUndoRefactoringPreview(asyncExec, 'undo-collide', PREVIEW_PAGE_BYTES).then(
        parseUndoStartPreview,
      ),
    ).rejects.toThrow(/already in use|Cannot rename back/);

    // Nothing was clobbered.
    expect(definesSelector(CLS, 'undoIAmTheNewOne')).toBe(true);
    expect(exec(`(UserGlobals at: #'${RENAMED}' ifAbsent: [nil]) notNil printString`).trim()).toBe(
      'true',
    );
  }, 60_000);

  // ---- instance-variable add / remove, reversed by the opposite operation -----------------

  const applyInstVarOp = (op: 'add' | 'remove', cls: string, ivar: string): void => {
    exec(`(GsInstVarRefactoring class: ${cls} ${op}InstVar: '${ivar}')
      applyDeselected: #() options: nil migrate: false deleteHistory: false`);
  };

  it('reverses an added instance variable by taking it back out', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    applyInstVarOp('add', CLS, 'undoExtra');
    expect(ownInstVarNames(CLS)).toContain('undoExtra');

    recordReverseRename(
      (code) => exec(code),
      'instVarAdd',
      CLS,
      'undoExtra',
      'undoExtra',
      `Add undoExtra to ${CLS}`,
      'GsInstVarRefactoring',
    );
    expect(undoStatus().mechanism).toBe('mirror');

    expect((await undoEverything()).failed).toHaveLength(0);
    expect(ownInstVarNames(CLS)).not.toContain('undoExtra');
    // The variables and methods that were always there survived both reshapes.
    expect(ownInstVarNames(CLS)).toContain('balance');
    expect(definesSelector(CLS, 'undoUntouched')).toBe(true);
    expect(definesSelector(CLS, 'undoAlsoUntouched', true)).toBe(true);
  }, 60_000);

  it('reverses a removed instance variable by declaring it again', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    // `balance` is read by undoBalance, so removing it drops that method — which is exactly the
    // loss the reversal cannot undo, and which the caveat warns about.
    applyInstVarOp('remove', CLS, 'balance');
    expect(ownInstVarNames(CLS)).not.toContain('balance');

    recordReverseRename(
      (code) => exec(code),
      'instVarRemove',
      CLS,
      'balance',
      'balance',
      `Remove balance from ${CLS}`,
      'GsInstVarRefactoring',
    );
    expect((await undoEverything()).failed).toHaveLength(0);

    expect(ownInstVarNames(CLS)).toContain('balance');
    // Honest about the limit: the accessor the removal dropped does NOT come back.
    expect(definesSelector(CLS, 'undoBalance')).toBe(false);
    // Everything the removal did not touch is still here.
    expect(definesSelector(CLS, 'undoUntouched')).toBe(true);
  }, 60_000);

  it('reports the all-or-nothing deselection and the methods a reversal would delete', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    applyInstVarOp('add', CLS, 'undoExtra');
    q.compileMethod(session(), CLS, false, 'after', 'undoUsesExtra\n\t^ undoExtra');

    recordReverseRename(
      (code) => exec(code),
      'instVarAdd',
      CLS,
      'undoExtra',
      'undoExtra',
      `Add undoExtra to ${CLS}`,
      'GsInstVarRefactoring',
    );

    const token = 'undo-ivar-preview';
    const start = parseUndoStartPreview(
      await startUndoRefactoringPreview(asyncExec, token, PREVIEW_PAGE_BYTES),
    );
    clearUndoRefactoringPreview((code) => exec(code), token);

    expect(start.reverseKind).toBe('instVarAdd');
    // The engine ignores deselection here, so the panel must disable the boxes.
    expect(start.deselection).toBe('ignored');
    // And it can say how many methods taking the variable back out will delete.
    expect(start.dropCount).toBeGreaterThan(0);
  }, 60_000);

  it('refuses to reverse an add when the variable is already gone', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    recordReverseRename(
      (code) => exec(code),
      'instVarAdd',
      CLS,
      'undoNeverAdded',
      'undoNeverAdded',
      `Add undoNeverAdded to ${CLS}`,
      'GsInstVarRefactoring',
    );

    await expect(
      startUndoRefactoringPreview(asyncExec, 'undo-ivar-gone', PREVIEW_PAGE_BYTES).then(
        parseUndoStartPreview,
      ),
    ).rejects.toThrow(/nothing to take back out/);
  }, 60_000);

  // ---------------------------------------------------------------------------------------
  // The class reshapes with no opposite operation (#434) -- reversed by returning every class
  // the refactoring reshaped to the version it had BEFORE it, then unbinding whatever the
  // refactoring created.
  //
  // These caught a real defect on the way in: the restore path passed the CURRENT superclass to
  // makeNewVersionOf:, so reverting across a re-parenting kept the wrong parent -- and unbinding
  // the created parent afterwards would have left the class pointing at an unbound class. Fixed in
  // GsRenameClassRefactoring>>superclassForShapeSource:of:; these are the regression guard.
  // ---------------------------------------------------------------------------------------

  const capture = (root: string): string => captureClassHistory((code) => exec(code), root);
  const commitRevert = (label: string, engine: string, created: string[] = []): string =>
    commitHistoryRevert((code) => exec(code), label, engine, created);

  const superclassOf = (cls: string): string => exec(`${cls} superclass name asString`).trim();

  it('returns a pushed-down instance variable to its pre-refactoring state', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    const before = ownInstVarNames(CLS).slice().sort();
    expect(capture(CLS)).toBe('ok');
    exec(`(GsInstVarStructureRefactoring class: ${CLS} pushDownInstVar: 'undoSpare')
      applyDeselected: #()`);
    expect(commitRevert(`Push down undoSpare from ${CLS}`, 'GsInstVarStructureRefactoring')).toBe(
      'ok',
    );

    expect(ownInstVarNames(CLS)).not.toContain('undoSpare');
    expect(ownInstVarNames(SUB)).toContain('undoSpare');
    expect(undoStatus().mechanism).toBe('historyRevert');

    expect((await undoEverything()).failed).toHaveLength(0);

    expect(ownInstVarNames(CLS).slice().sort()).toEqual(before);
    expect(ownInstVarNames(SUB)).not.toContain('undoSpare');
    // The methods came back with the shape — the whole point of reverting rather than
    // re-declaring the class by hand.
    expect(definesSelector(CLS, 'undoUntouched')).toBe(true);
    expect(definesSelector(CLS, 'undoAlsoUntouched', true)).toBe(true);
    expect(definesSelector(SUB, 'undoSavingsOwn')).toBe(true);
  }, 60_000);

  it('reverts the subtree top-down, so a subclass lands on its restored parent', async (ctx) => {
    // The ordering trap: a child reverted before its parent would be re-parented onto a version
    // the parent is about to supersede. If that happened, the subclass would no longer be a
    // subclass of the restored parent.
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    capture(CLS);
    exec(`(GsInstVarStructureRefactoring class: ${CLS} pushDownInstVar: 'undoSpare')
      applyDeselected: #()`);
    commitRevert('Push down undoSpare', 'GsInstVarStructureRefactoring');
    expect((await undoEverything()).failed).toHaveLength(0);

    expect(superclassOf(SUB)).toBe(CLS);
  }, 60_000);

  it('names the methods the revert will discard, and discards exactly those', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    capture(CLS);
    exec(`(GsInstVarStructureRefactoring class: ${CLS} pushDownInstVar: 'undoSpare')
      applyDeselected: #()`);
    commitRevert('Push down undoSpare', 'GsInstVarStructureRefactoring');

    // Written AFTER the refactoring — the pre-refactoring state does not include it.
    q.compileMethod(session(), CLS, false, 'after', 'undoWrittenAfter\n\t^ 7');

    const token = 'undo-revert-preview';
    const start = parseUndoStartPreview(
      await startUndoRefactoringPreview(asyncExec, token, PREVIEW_PAGE_BYTES),
    );
    clearUndoRefactoringPreview((code) => exec(code), token);

    expect(start.mechanism).toBe('historyRevert');
    // All-or-nothing, so the panel disables the rows.
    expect(start.deselection).toBe('ignored');
    // The count is surfaced, and the row names the method itself.
    expect(start.dropCount).toBeGreaterThan(0);
    const warned = start.page.changes.find((c) => (c.warning ?? '').includes('undoWrittenAfter'));
    expect(warned).toBeDefined();
    expect(warned?.warning).toContain('pre-refactoring state DISCARDS');

    expect((await undoEverything()).failed).toHaveLength(0);
    // As warned.
    expect(definesSelector(CLS, 'undoWrittenAfter')).toBe(false);
    // And the pre-refactoring methods are all still here.
    expect(definesSelector(CLS, 'undoUntouched')).toBe(true);
  }, 60_000);

  it('previews a revert as a definition diff per reshaped class', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    capture(CLS);
    exec(`(GsInstVarStructureRefactoring class: ${CLS} pushDownInstVar: 'undoSpare')
      applyDeselected: #()`);
    commitRevert('Push down undoSpare', 'GsInstVarStructureRefactoring');

    const token = 'undo-revert-diff';
    const start = parseUndoStartPreview(
      await startUndoRefactoringPreview(asyncExec, token, PREVIEW_PAGE_BYTES),
    );
    clearUndoRefactoringPreview((code) => exec(code), token);

    const edit = start.page.changes.find((c) => c.kind === 'classDefinitionEdit');
    expect(edit).toBeDefined();
    // A real diff: what the class is now on the left, what reverting restores on the right.
    expect(edit?.oldSource).not.toBe(edit?.newSource);
    expect(edit?.newSource).toContain('undoSpare');
  }, 60_000);

  it('unbinds the class an extract-superclass created', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    const EXTRACTED = 'UndoItAbstractAccount';
    const originalParent = superclassOf(CLS);

    capture(CLS);
    exec(`(GsExtractSuperclassRefactoring
        class: ${CLS}
        insertSuperclassNamed: '${EXTRACTED}'
        inDictionary: UserGlobals) applyDeselected: #()`);
    commitRevert(`Insert superclass ${EXTRACTED} above ${CLS}`, 'GsExtractSuperclassRefactoring', [
      EXTRACTED,
    ]);

    expect(superclassOf(CLS)).toBe(EXTRACTED);

    const token = 'undo-extract-preview';
    const start = parseUndoStartPreview(
      await startUndoRefactoringPreview(asyncExec, token, PREVIEW_PAGE_BYTES),
    );
    clearUndoRefactoringPreview((code) => exec(code), token);
    // The created class has no earlier version to revert to, so the reversal unbinds it.
    expect(start.page.changes.some((c) => c.kind === 'classRemove')).toBe(true);

    expect((await undoEverything()).failed).toHaveLength(0);

    expect(superclassOf(CLS)).toBe(originalParent);
    expect(exec(`(UserGlobals at: #'${EXTRACTED}' ifAbsent: [nil]) isNil printString`).trim()).toBe(
      'true',
    );
    expect(definesSelector(CLS, 'undoUntouched')).toBe(true);
  }, 60_000);

  it('reverses a split class, restoring the source and unbinding the component', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    const COMPONENT = 'UndoItBalanceHolder';
    const before = ownInstVarNames(CLS).slice().sort();

    capture(CLS);
    exec(`(GsSplitClassRefactoring
        class: ${CLS}
        splitIntoClassNamed: '${COMPONENT}'
        extractingInstVars: #('balance')
        inDictionary: UserGlobals) applyDeselected: #()`);
    commitRevert(`Split ${CLS} into ${COMPONENT}`, 'GsSplitClassRefactoring', [COMPONENT]);

    expect(
      exec(`(UserGlobals at: #'${COMPONENT}' ifAbsent: [nil]) notNil printString`).trim(),
    ).toBe('true');

    expect((await undoEverything()).failed).toHaveLength(0);

    expect(ownInstVarNames(CLS).slice().sort()).toEqual(before);
    expect(exec(`(UserGlobals at: #'${COMPONENT}' ifAbsent: [nil]) isNil printString`).trim()).toBe(
      'true',
    );
    expect(definesSelector(CLS, 'undoUntouched')).toBe(true);
  }, 60_000);

  it('records nothing when the capture was discarded, so a failed reshape offers no undo', (ctx) => {
    // The pending-capture lifecycle, from the client side: a cancel / error / partial reshape
    // drops the capture, and promoting it afterwards must refuse rather than record an undo
    // against a state the capture does not describe.
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    defineFixture();
    clearRefactoringUndo((code) => exec(code));

    expect(capture(CLS)).toBe('ok');
    expect(discardPendingCapture((code) => exec(code))).toBe('ok');
    expect(commitRevert('Push down undoSpare', 'GsInstVarStructureRefactoring')).toBe(
      'nothing captured',
    );
    expect(undoStatus().available).toBe(false);
  });

  it('refuses to promote a capture that was never taken', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    clearRefactoringUndo((code) => exec(code));
    discardPendingCapture((code) => exec(code));

    expect(commitRevert('x', 'GsInstVarStructureRefactoring')).toBe('nothing captured');
    expect(undoStatus().available).toBe(false);
  });
});
