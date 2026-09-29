/**
 * Where the Explorer lands after a method is MOVED.
 *
 * A move can cross dictionaries, so "stay where the method went" is the whole point: dropping a
 * method onto a class in DictionaryB and being returned to DictionaryA is the bug, not a
 * cosmetic wobble — the user is then looking at the decoy class of the same name (#396).
 *
 * The move path reveals through `revealClass` rather than `refreshAfterClassReshape`, so it
 * needs its own claim on the activation that the closing preview panel causes. It had none, and
 * nothing here covered it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getClassesWithCategory: vi.fn(() => []),
  getClassEnvironments: vi.fn(() => []),
  getDictionaryNames: vi.fn(() => ['DictionaryA', 'DictionaryB']),
  getDefinedInstVarCounts: vi.fn(() => new Map()),
  getDefinedClassVarCounts: vi.fn(() => new Map()),
  getClassHierarchy: vi.fn(() => []),
  getClassDescendantNames: vi.fn(() => []),
  getMethodInstVarAccess: vi.fn(() => []),
  isKernelClass: vi.fn(() => false),
}));
vi.mock('../../refactoring/moveMethodCommand', () => ({ moveMethod: vi.fn() }));

import * as vscode from 'vscode';
import { getClassesWithCategory } from '../../browserQueries';
import { moveMethod } from '../../refactoring/moveMethodCommand';
import { ExplorerController } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

const DEST = 'DictionaryB';
const DEST_INDEX = 2;
const TARGET = 'ShadowedSub';

function makeController() {
  const session = { id: 1, rbSupportAvailable: true } as unknown as ActiveSession;
  const ctl = new ExplorerController({
    getSelectedSession: () => session,
  } as unknown as SessionManager);
  const view = () => ({
    reveal: vi.fn(async () => {}),
    selection: [],
    description: '',
    visible: true,
  });
  ctl.setViews({
    dict: view(),
    category: view(),
    klass: view(),
    hierarchy: view(),
    method: view(),
  } as never);
  // The user is showing DictionaryB and drops onto a class row there.
  ctl.state.dictName = DEST;
  ctl.state.dictIndex = DEST_INDEX;
  return ctl;
}

/** One dragged instance-side method, from a class in DictionaryA. */
const payload = {
  selector: 'pureCompute',
  isMeta: false,
  category: 'fixture',
  className: 'Mover',
  dictName: 'DictionaryA',
  dictIndex: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getClassesWithCategory).mockReturnValue([
    { className: TARGET, category: 'fixture' },
  ] as never);
  vi.mocked(moveMethod).mockResolvedValue({
    applied: 2,
    moved: ['pureCompute'],
    targetClass: TARGET,
    toMeta: false,
  });
});

describe('ExplorerController.dragMoveToClass — where it leaves the tree', () => {
  it('leaves the Explorer on the dictionary the method was moved INTO', async () => {
    const ctl = makeController();

    await ctl.dragMoveToClass([payload] as never, TARGET);

    expect(ctl.state.dictName).toBe(DEST);
    expect(ctl.state.dictIndex).toBe(DEST_INDEX);
    expect(ctl.state.className).toBe(TARGET);
  });

  it('ignores the activation the closing preview panel causes', async () => {
    // The panel resolves and disposes itself, which surfaces whatever tab was beside it. Without
    // a claim the follow moves the tree onto THAT tab's class — which for a move out of
    // DictionaryA is the decoy the user was dragging away from.
    const ctl = makeController();

    await ctl.dragMoveToClass([payload] as never, TARGET);
    await ctl.syncToEditor(vscode.Uri.parse('gemstone://1/DictionaryA/Mover/definition?dict=1'));

    expect(ctl.state.dictName).toBe(DEST);
    expect(ctl.state.className).toBe(TARGET);
  });

  it('spends that claim once, so the next real editor click still navigates', async () => {
    const ctl = makeController();
    vi.mocked(getClassesWithCategory).mockReturnValue([
      { className: TARGET, category: 'fixture' },
      { className: 'Other', category: 'fixture' },
    ] as never);
    const other = vscode.Uri.parse(`gemstone://1/${DEST}/Other/definition?dict=2`);

    await ctl.dragMoveToClass([payload] as never, TARGET);
    await ctl.syncToEditor(other); // swallowed: the panel closing
    expect(ctl.state.className).toBe(TARGET);

    await ctl.syncToEditor(other); // a real click
    expect(ctl.state.className).toBe('Other');
  });

  it('claims nothing when the move was cancelled, so no later click is swallowed', async () => {
    // moveMethod answers undefined on a cancel or a decline. No panel applied, nothing revealed,
    // and a claim made anyway would eat the user's next click for a second.
    const ctl = makeController();
    vi.mocked(moveMethod).mockResolvedValue(undefined);
    vi.mocked(getClassesWithCategory).mockReturnValue([
      { className: TARGET, category: 'fixture' },
      { className: 'Other', category: 'fixture' },
    ] as never);
    const other = vscode.Uri.parse(`gemstone://1/${DEST}/Other/definition?dict=2`);

    await ctl.dragMoveToClass([payload] as never, TARGET);
    await ctl.syncToEditor(other);

    expect(ctl.state.className).toBe('Other');
  });
});
