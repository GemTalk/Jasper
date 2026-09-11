import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({ defaultQueryExecutorUsing: vi.fn(() => () => '') }));

import { registerStashRelease } from '../releaseStash';
import { newStashKey, releaseStashKeys, resetStashKeys } from '../queries/classSlotQueries';
import {
  clearUndoStack,
  dropUndoEntry,
  MAX_UNDO_DEPTH,
  popUndoEntry,
  pushUndoEntry,
  resetUndoStacks,
} from '../undoStack';
import type { NewUndoEntry } from '../undoTypes';
import type { ActiveSession, SessionManager } from '../../sessionManager';

vi.mock('../queries/classSlotQueries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../queries/classSlotQueries')>();
  return { ...actual, releaseStashKeys: vi.fn() };
});

/**
 * Releasing what an undo entry pinned in the stone (#434).
 *
 * The claim under test is the one the 25-entry cap depends on: a class edit and a dictionary
 * removal each hold an object in SessionTemps, and SessionTemps is not released by the entry
 * going away. Without this the pin count tracks every class edit and dictionary removal of
 * the session — and an abort makes it worse, since it clears the stack while temp object
 * memory survives, leaving the whole set unreachable AND still held.
 */

const session = { id: 1 } as ActiveSession;
const sessions = {
  getSession: (id: number) => (id === 1 ? session : undefined),
} as unknown as SessionManager;

const classEdit = (stashKeys: (string | null)[], sessionId = 1): NewUndoEntry => ({
  kind: 'classEdit',
  sessionId,
  label: 'Remove class Account',
  slots: [],
  before: [],
  after: [],
  stashKeys,
});

const dictionaryEdit = (stashKey: string | null): NewUndoEntry => ({
  kind: 'dictionaryEdit',
  sessionId: 1,
  label: 'Remove dictionary Reports',
  before: { present: true, name: 'Reports', index: 2 },
  after: { present: false, name: 'Reports', index: 2 },
  stashKey,
});

const methodEdit = (label: string): NewUndoEntry => ({
  kind: 'methodEdit',
  sessionId: 1,
  label,
  slots: [],
  before: [],
  after: [],
});

const releasedKeys = (): string[][] =>
  vi.mocked(releaseStashKeys).mock.calls.map((call) => call[1]);

let dispose: { dispose(): void };

beforeEach(() => {
  vi.clearAllMocks();
  resetUndoStacks();
  resetStashKeys();
  dispose = registerStashRelease(sessions);
});

describe('releasing the stash as entries leave the stack', () => {
  it('lets go of the class version an evicted entry was holding', () => {
    // The case the cap does not cover on its own: remove a class, then edit enough methods
    // to push the entry off the end. Nothing can ever use that version again.
    pushUndoEntry(classEdit(['JasperUndoStash_1']));
    for (let i = 0; i < MAX_UNDO_DEPTH; i += 1) pushUndoEntry(methodEdit(`edit ${i}`));

    expect(releasedKeys()).toEqual([['JasperUndoStash_1']]);
  });

  it('lets go once a reversal has spent the entry', () => {
    pushUndoEntry(classEdit(['JasperUndoStash_1', 'JasperUndoStash_2']));

    popUndoEntry(1);

    expect(releasedKeys()).toEqual([['JasperUndoStash_1', 'JasperUndoStash_2']]);
  });

  it('lets go of a dropped entry, and of a removed dictionary', () => {
    const entry = pushUndoEntry(dictionaryEdit('JasperUndoStash_7'));

    dropUndoEntry(1, entry.id);

    expect(releasedKeys()).toEqual([['JasperUndoStash_7']]);
  });

  it('skips a slot that never pinned anything, and kinds that pin nothing at all', () => {
    // A class being CREATED has no earlier version, so its key was never written; a method
    // edit keeps its whole "before" on the client. Neither is worth a round trip.
    pushUndoEntry(classEdit([null]));
    popUndoEntry(1);
    pushUndoEntry(dictionaryEdit(null));
    popUndoEntry(1);
    pushUndoEntry(methodEdit('Save Account>>#balance'));
    popUndoEntry(1);

    expect(releaseStashKeys).not.toHaveBeenCalled();
  });

  it('releases everything the session stashed on a clear, including what never reached an entry', () => {
    // An abort is the case that motivates this. `clearUndoStack` drops every entry, but
    // SessionTemps survives the abort — so a key issued by a capture whose edit then failed,
    // and which no entry names, is only reachable through the issued-key registry.
    const onStack = newStashKey(1);
    const abandoned = newStashKey(1);
    pushUndoEntry(classEdit([onStack]));

    clearUndoStack(1);

    expect(releasedKeys()).toEqual([[onStack, abandoned]]);
  });

  it('runs no doit for a session that has gone away', () => {
    // The logout path: the stack is cleared BECAUSE the session went, and its SessionTemps
    // went with it. There are keys to release and no session left to ask — and they are
    // forgotten anyway, so the registry does not grow across a session's whole lifetime.
    const key = newStashKey(2);
    pushUndoEntry(classEdit([key], 2));

    clearUndoStack(2);

    expect(releaseStashKeys).not.toHaveBeenCalled();
    clearUndoStack(2);
    expect(releaseStashKeys).not.toHaveBeenCalled();
  });

  it('releases a key only once, however the entry left', () => {
    const key = newStashKey(1);
    const entry = pushUndoEntry(classEdit([key]));

    dropUndoEntry(1, entry.id);
    clearUndoStack(1);

    expect(releasedKeys()).toEqual([[key]]);
  });

  it('never lets a failed release break the edit that triggered it', () => {
    vi.mocked(releaseStashKeys).mockImplementation(() => {
      throw new Error('session busy');
    });
    pushUndoEntry(classEdit(['JasperUndoStash_1']));

    expect(() => popUndoEntry(1)).not.toThrow();
  });

  it('stops releasing once it is disposed', () => {
    dispose.dispose();

    pushUndoEntry(classEdit(['JasperUndoStash_1']));
    popUndoEntry(1);

    expect(releaseStashKeys).not.toHaveBeenCalled();
  });
});
