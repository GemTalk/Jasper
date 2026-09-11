import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({ defaultQueryExecutorUsing: vi.fn(() => () => '') }));
vi.mock('../queries/dictionaryQueries', () => ({ captureDictionary: vi.fn() }));

import { captureDictionary } from '../queries/dictionaryQueries';
import {
  beginDictionaryRemoval,
  beginDictionaryRename,
  recordDictionaryAdd,
} from '../recordDictionaryEdit';
import { peekUndoEntry, resetUndoStacks, undoStackDepth } from '../undoStack';
import { resetStashKeys } from '../queries/classSlotQueries';
import type { ActiveSession } from '../../sessionManager';

/**
 * The symbol-list recorder (#434).
 *
 * Two rules with teeth. A REMOVAL must pin the dictionary in SessionTemps on the way in —
 * `symbolList remove:` unlists it without destroying it, but nothing else references it once
 * it is off the list. And POSITION is captured, not just presence: a symbol list is ordered
 * and name resolution walks it in order.
 */

const session = { id: 1 } as ActiveSession;

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
  resetStashKeys();
});

describe('beginDictionaryRemoval', () => {
  it('records the position and pins the dictionary in SessionTemps', () => {
    vi.mocked(captureDictionary).mockReturnValue({ present: true, name: 'Reports', index: 2 });

    const entry = beginDictionaryRemoval(session, 'Reports')?.commit();

    expect(entry).toMatchObject({
      kind: 'dictionaryEdit',
      label: 'Remove dictionary Reports',
      before: { present: true, name: 'Reports', index: 2 },
      after: { present: false, name: 'Reports' },
      stashKey: 'JasperUndoStash_1',
    });
    // The stash key is passed on the way IN — the capture after the removal would find
    // nothing to pin.
    expect(captureDictionary).toHaveBeenCalledWith(
      expect.anything(),
      'Reports',
      'JasperUndoStash_1',
    );
    expect(peekUndoEntry(session.id)).toBe(entry);
  });

  it('records nothing when there is no such dictionary on the symbol list', () => {
    vi.mocked(captureDictionary).mockReturnValue({ present: false, name: 'Reports', index: 0 });

    expect(beginDictionaryRemoval(session, 'Reports')).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('records nothing — and does not throw — when the symbol list cannot be read', () => {
    vi.mocked(captureDictionary).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(beginDictionaryRemoval(session, 'Reports')).toBeUndefined();
  });
});

describe('beginDictionaryRename', () => {
  it('records both names and keeps NO stash', () => {
    // The dictionary never leaves the symbol list, so the reversal finds it by its new name.
    vi.mocked(captureDictionary).mockReturnValue({ present: true, name: 'Reports', index: 2 });

    const entry = beginDictionaryRename(session, 'Reports')?.commit('Reporting');

    expect(entry).toMatchObject({
      kind: 'dictionaryEdit',
      label: 'Rename dictionary Reports to Reporting',
      before: { present: true, name: 'Reports', index: 2 },
      after: { present: true, name: 'Reporting', index: 2 },
      stashKey: null,
    });
    expect(captureDictionary).toHaveBeenCalledWith(expect.anything(), 'Reports', undefined);
  });

  it('records nothing when the name did not change', () => {
    vi.mocked(captureDictionary).mockReturnValue({ present: true, name: 'Reports', index: 2 });

    expect(beginDictionaryRename(session, 'Reports')?.commit('Reports')).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });
});

describe('recordDictionaryAdd', () => {
  it('records an absent `before`, which is what makes the reversal a removal', () => {
    vi.mocked(captureDictionary).mockReturnValue({ present: true, name: 'Reports', index: 4 });

    const entry = recordDictionaryAdd(session, 'Reports');

    expect(entry).toMatchObject({
      kind: 'dictionaryEdit',
      label: 'Create dictionary Reports',
      before: { present: false, name: 'Reports', index: 4 },
      after: { present: true, name: 'Reports', index: 4 },
      // No stash: nothing is being held for a later reversal.
      stashKey: null,
    });
    expect(peekUndoEntry(session.id)).toBe(entry);
  });

  it('reads the position AFTER the fact, since that is the only time it is knowable', () => {
    vi.mocked(captureDictionary).mockReturnValue({ present: true, name: 'Reports', index: 4 });

    recordDictionaryAdd(session, 'Reports');

    // No stash key is asked for, unlike a removal.
    expect(captureDictionary).toHaveBeenCalledWith(expect.anything(), 'Reports', undefined);
  });

  it('records nothing when the dictionary is not on the symbol list', () => {
    // A create that did not happen.
    vi.mocked(captureDictionary).mockReturnValue({ present: false, name: 'Reports', index: 0 });

    expect(recordDictionaryAdd(session, 'Reports')).toBeUndefined();
    expect(undoStackDepth(session.id)).toBe(0);
  });

  it('records nothing — and does not throw — when the symbol list cannot be read', () => {
    vi.mocked(captureDictionary).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(recordDictionaryAdd(session, 'Reports')).toBeUndefined();
  });
});
