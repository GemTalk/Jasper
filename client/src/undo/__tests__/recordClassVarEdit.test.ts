import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({ defaultQueryExecutorUsing: vi.fn(() => () => '') }));
vi.mock('../queries/classVarQueries', () => ({ captureClassVar: vi.fn() }));
vi.mock('../queries/methodSlotQueries', () => ({ captureMethodSlots: vi.fn() }));

import { captureClassVar } from '../queries/classVarQueries';
import { captureMethodSlots } from '../queries/methodSlotQueries';
import { beginClassVarAdd } from '../recordClassVarEdit';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../undoStack';
import { MethodSlot, MethodSlotState } from '../undoTypes';
import type { ActiveSession } from '../../sessionManager';

/**
 * The class-variable recorder (#434).
 *
 * The rule specific to this one: the ACCESSORS are captured with the variable, because the
 * Explorer generates them as part of the same action. The state is re-read on commit rather
 * than assumed, since the accessor step SKIPS any selector the class already implements —
 * the stone is the only thing that knows which of them are actually new.
 */

const session = { id: 1 } as ActiveSession;
const slot = { dict: 7, className: 'Account', varName: 'Registry' };

const accessor = (selector: string): MethodSlot => ({
  dict: 7,
  className: 'Account',
  isMeta: true,
  selector,
  environmentId: 0,
});
const accessors = [accessor('registry'), accessor('registry:')];

const present = (source: string): MethodSlotState => ({
  exists: true,
  source,
  category: 'accessing',
});
const absent: MethodSlotState = { exists: false, source: null, category: null };

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
});

describe('beginClassVarAdd', () => {
  it('records the declaration and the accessors the add created', () => {
    vi.mocked(captureClassVar)
      .mockReturnValueOnce({ defined: false })
      .mockReturnValueOnce({ defined: true });
    vi.mocked(captureMethodSlots)
      .mockReturnValueOnce([absent, absent])
      .mockReturnValueOnce([
        present('registry\n\t^Registry'),
        present('registry: v\n\tRegistry := v'),
      ]);

    const entry = beginClassVarAdd(session, slot, accessors)?.commit(
      'Add class variable Registry to Account',
    );

    expect(entry).toMatchObject({
      kind: 'classVarEdit',
      label: 'Add class variable Registry to Account',
      before: { defined: false },
      after: { defined: true },
      accessorSlots: accessors,
    });
    expect(peekUndoEntry(session.id)).toBe(entry);
  });

  it('keeps the pre-add state of an accessor that already existed, so undo leaves it alone', () => {
    const handWritten = present('registry\n\t^self hand written');
    vi.mocked(captureClassVar)
      .mockReturnValueOnce({ defined: false })
      .mockReturnValueOnce({ defined: true });
    vi.mocked(captureMethodSlots)
      .mockReturnValueOnce([handWritten, absent])
      .mockReturnValueOnce([handWritten, present('registry: v\n\tRegistry := v')]);

    const entry = beginClassVarAdd(session, slot, accessors)?.commit('Add class variable');

    expect(entry?.kind === 'classVarEdit' && entry.accessorBefore[0]).toEqual(handWritten);
    expect(entry?.kind === 'classVarEdit' && entry.accessorAfter[0]).toEqual(handWritten);
  });

  it('records the add on its own when no accessors were asked for', () => {
    vi.mocked(captureClassVar)
      .mockReturnValueOnce({ defined: false })
      .mockReturnValueOnce({ defined: true });
    vi.mocked(captureMethodSlots).mockReturnValue([]);

    const entry = beginClassVarAdd(session, slot, [])?.commit('Add class variable');

    expect(entry?.kind === 'classVarEdit' && entry.accessorSlots).toEqual([]);
  });

  it('records nothing when the add changed nothing', () => {
    vi.mocked(captureClassVar).mockReturnValue({ defined: true });
    vi.mocked(captureMethodSlots).mockReturnValue([]);

    expect(beginClassVarAdd(session, slot, [])?.commit('Add class variable')).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('records nothing — and does not throw — when the capture fails', () => {
    vi.mocked(captureClassVar).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(beginClassVarAdd(session, slot, [])).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('records nothing when the accessor capture answers the wrong number of states', () => {
    vi.mocked(captureClassVar).mockReturnValue({ defined: false });
    vi.mocked(captureMethodSlots).mockReturnValue([absent]);

    expect(beginClassVarAdd(session, slot, accessors)).toBeUndefined();
  });

  it('records nothing when the result cannot be read back', () => {
    vi.mocked(captureClassVar)
      .mockReturnValueOnce({ defined: false })
      .mockImplementationOnce(() => {
        throw new Error('session busy');
      });
    vi.mocked(captureMethodSlots).mockReturnValue([]);

    expect(beginClassVarAdd(session, slot, [])?.commit('Add class variable')).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });
});
