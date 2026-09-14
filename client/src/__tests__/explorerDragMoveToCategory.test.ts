import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller pulls in browserQueries; stub only what the drop path touches.
vi.mock('../browserQueries', () => ({
  recategorizeMethod: vi.fn(() => 'ok'),
  getClassEnvironments: vi.fn(() => []),
  defaultQueryExecutorUsing: vi.fn(() => () => ''),
}));
// The undo recorder's method-slot capture — mocked so the flow records without a stone (#434).
vi.mock('../undo/queries/methodSlotQueries', () => ({ captureMethodSlots: vi.fn() }));

import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import { captureMethodSlots } from '../undo/queries/methodSlotQueries';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../undo/undoStack';
import { ExplorerController } from '../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../sessionManager';
import {
  _resetAutoCommitStateForTests,
  registerSessionAutoCommit,
} from '../autoCommit/autoCommitState';
import { autoCommitAfterWrite, setAutoCommitFailureHandler } from '../autoCommit/autoCommitRunner';

/**
 * Dropping methods on a method category.
 *
 * The case with teeth is a target category that exists only in the CLIENT overlay — the
 * Explorer's "+ new category" leaves the stone untouched until something is filed there, so
 * the drop is what makes it real. The controller does not special-case that: the query
 * creates the category when it is missing, so the drop looks the same either way. What the
 * controller must get right is which methods it moves, and that a refused move is reported
 * rather than swallowed.
 */

const payload = (selector: string, category: string, isMeta = false) => ({
  selector,
  isMeta,
  category,
  className: 'UndoDemoAccount2',
  dictName: 'UserGlobals',
  dictIndex: 3,
});

const COMMIT_OK = { success: true, err: { number: 0, message: '' } };
let commit = vi.fn(() => COMMIT_OK);
const armableSession = {
  id: 1,
  get gci() {
    return { GciTsCommit: commit };
  },
  handle: {},
} as unknown as ActiveSession;

// `null` means "no selected session" — passing `undefined` would trigger the default.
function makeController(session: ActiveSession | null = armableSession) {
  const sessionManager = {
    getSelectedSession: () => session ?? undefined,
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  const reload = vi
    .spyOn(ctl as unknown as { reloadIfCurrent: () => void }, 'reloadIfCurrent')
    .mockImplementation(() => {});
  return { ctl, reload };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
  _resetAutoCommitStateForTests();
  setAutoCommitFailureHandler(undefined);
  commit = vi.fn(() => COMMIT_OK);
  vi.mocked(queries.recategorizeMethod).mockReturnValue('ok');
  // The slot's captured state carries the CATEGORY: the source category on the way in, the
  // target on the way out.
  captureCalls = 0;
  vi.mocked(captureMethodSlots).mockImplementation((_e, slots) => {
    captureCalls += 1;
    return slots.map((slot) => ({
      exists: true,
      source: `${slot.selector}\n\t^1`,
      category: captureCalls === 1 ? 'computing' : 'accessing',
    }));
  });
});

let captureCalls = 0;

describe('ExplorerController.dragMoveToCategory', () => {
  it('moves the method into a category that exists only in the client overlay', async () => {
    // `accessing` here is a "+"-button category with no server existence — the exact shape
    // that used to answer classErrMethCatNotFound.
    const { ctl, reload } = makeController();

    await ctl.dragMoveToCategory([payload('udBalanceValue', 'accessing-renamed')], 'accessing');

    expect(queries.recategorizeMethod).toHaveBeenCalledWith(
      expect.anything(),
      'UndoDemoAccount2',
      false,
      'udBalanceValue',
      'accessing',
      3,
    );
    expect(reload).toHaveBeenCalledWith('UndoDemoAccount2', 3);
    // The notice carries Undo now, so it takes a button argument.
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("Moved #udBalanceValue to 'accessing'"),
      'Undo',
    );
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('moves several at once and says how many', async () => {
    const { ctl } = makeController();

    await ctl.dragMoveToCategory(
      [payload('one', 'computing'), payload('two', 'printing')],
      'accessing',
    );

    expect(queries.recategorizeMethod).toHaveBeenCalledTimes(2);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("Moved 2 methods to 'accessing'"),
      'Undo',
    );
  });

  it('skips a method already in the target category', async () => {
    const { ctl, reload } = makeController();

    await ctl.dragMoveToCategory([payload('one', 'accessing')], 'accessing');

    expect(queries.recategorizeMethod).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps the class side on the class side', async () => {
    const { ctl } = makeController();

    await ctl.dragMoveToCategory([payload('make', 'instance creation', true)], 'building');

    expect(queries.recategorizeMethod).toHaveBeenCalledWith(
      expect.anything(),
      'UndoDemoAccount2',
      true,
      'make',
      'building',
      3,
    );
  });

  it('reports a move the stone refused, and does not claim success', async () => {
    const { ctl, reload } = makeController();
    vi.mocked(queries.recategorizeMethod).mockImplementation(() => {
      throw new Error('classErrMethCatNotFound');
    });

    await ctl.dragMoveToCategory([payload('one', 'computing')], 'accessing');

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('classErrMethCatNotFound'),
    );
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('does nothing without a selected session', async () => {
    const { ctl } = makeController(null);

    await ctl.dragMoveToCategory([payload('one', 'computing')], 'accessing');

    expect(queries.recategorizeMethod).not.toHaveBeenCalled();
  });

  it('records the move, so the methods can go back to the category they came from', async () => {
    // The user dragged once, so it is ONE entry -- and its reversal is the ordinary
    // method-edit one, because a captured slot carries its category as well as its source.
    const { ctl } = makeController();

    await ctl.dragMoveToCategory([payload('udBalanceValue', 'computing')], 'accessing');

    expect(undoStackDepth(1)).toBe(1);
    const entry = peekUndoEntry(1);
    expect(entry).toMatchObject({
      kind: 'methodEdit',
      label: "Move UndoDemoAccount2>>#udBalanceValue to 'accessing'",
    });
    expect(entry?.kind === 'methodEdit' && entry.before[0].category).toBe('computing');
    expect(entry?.kind === 'methodEdit' && entry.after[0].category).toBe('accessing');
  });

  it('records a multi-method drop as one entry, and counts them in the label', async () => {
    const { ctl } = makeController();

    await ctl.dragMoveToCategory(
      [payload('one', 'computing'), payload('two', 'printing')],
      'accessing',
    );

    expect(undoStackDepth(1)).toBe(1);
    expect(peekUndoEntry(1)?.label).toBe("Move 2 methods to 'accessing'");
  });

  it('records nothing when the move failed', async () => {
    const { ctl } = makeController();
    vi.mocked(queries.recategorizeMethod).mockImplementation(() => {
      throw new Error('classErrMethCatNotFound');
    });

    await ctl.dragMoveToCategory([payload('one', 'computing')], 'accessing');

    expect(undoStackDepth(1)).toBe(0);
  });

  it('records nothing when every dragged method is already in the target', async () => {
    const { ctl } = makeController();

    await ctl.dragMoveToCategory([payload('one', 'accessing')], 'accessing');

    expect(undoStackDepth(1)).toBe(0);
  });
});

/**
 * One drag is one commit on an auto-commit session (issue #254).
 *
 * The grouping is not invented here: this drop already records ONE undo entry because the
 * user dragged once, and the commit follows the same line. Per-row commits would put a
 * half-moved selection in the repository if one of them were refused.
 *
 * `browserQueries` is mocked, so the real `writing` wrapper never runs — the stub calls
 * `autoCommitAfterWrite` the way the real query does, which is what the deferred region has
 * to coalesce.
 */
describe('dragMoveToCategory and auto-commit', () => {
  const writeThrough = () =>
    vi.mocked(queries.recategorizeMethod).mockImplementation(() => {
      autoCommitAfterWrite(armableSession);
      return 'ok';
    });

  it('commits ONCE for a drag that moved several methods', async () => {
    registerSessionAutoCommit(1, true);
    writeThrough();
    const { ctl } = makeController();

    await ctl.dragMoveToCategory(
      [payload('one', 'accessing'), payload('two', 'accessing'), payload('three', 'accessing')],
      'computing',
    );

    expect(queries.recategorizeMethod).toHaveBeenCalledTimes(3);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('commits nothing when the move came apart part-way', async () => {
    registerSessionAutoCommit(1, true);
    let first = true;
    vi.mocked(queries.recategorizeMethod).mockImplementation(() => {
      if (first) {
        first = false;
        autoCommitAfterWrite(armableSession);
        return 'ok';
      }
      throw new Error('classErrMethCatNotFound');
    });
    const { ctl } = makeController();

    await ctl.dragMoveToCategory(
      [payload('one', 'accessing'), payload('two', 'accessing')],
      'computing',
    );

    // The controller reports the failure rather than rethrowing, but the deferred region saw
    // it come apart, so a half-moved selection stays out of the repository.
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits nothing on a session that never armed it', async () => {
    writeThrough();
    const { ctl } = makeController();

    await ctl.dragMoveToCategory([payload('one', 'accessing')], 'computing');

    expect(commit).not.toHaveBeenCalled();
  });

  it('commits nothing when the drag moved nothing', async () => {
    registerSessionAutoCommit(1, true);
    writeThrough();
    const { ctl } = makeController();

    await ctl.dragMoveToCategory([payload('one', 'accessing')], 'accessing');

    expect(commit).not.toHaveBeenCalled();
  });
});
