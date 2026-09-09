/**
 * Jasper's undo stack (issue #434).
 *
 * One bounded stack per session, held in the extension rather than in the stone. That
 * placement is the design decision the rest of the undo work hangs off:
 *
 *  - a method edit, a class edit, a class comment, a class variable, a method category and a
 *    symbol-list dictionary can then be undone on ANY stone, with no server-side install —
 *    the reversal is plain `compileMethod:` / `removeSelector:`, `comment:`,
 *    `addClassVarName:` / `removeClassVarName:`, `renameCategory:to:`,
 *    `insertDictionary:at:`, or binding a class version back into its dictionary;
 *  - a refactoring, whose reversal genuinely has to happen server-side, is just one
 *    KIND of entry pointing at the record the engine already keeps.
 *
 * So the generic layer owns the stack and the refactoring engine extends it, rather than
 * the stack living inside the engine and everything else having to reach through it.
 *
 * Per session, because an entry describes work done in one session's transaction and
 * means nothing in another's. Bounded, because every method save and every comment save now
 * records one, and an unbounded stack would hold every source string and every comment of a
 * long editing session alive.
 *
 * The stack is process-local and deliberately not persisted: it is discarded on logout
 * (see `clearUndoStack`), matching the session-scoped record the refactoring engine keeps
 * in SessionTemps.
 *
 * Entries LEAVING the stack is its own event (`onUndoEntriesReleased`), because for two kinds
 * of entry the stack is not the only thing holding state: a class edit and a dictionary
 * removal each pin an object in the stone's SessionTemps, and dropping the entry does not
 * release it. See `releaseStash.ts`.
 */
import { NewUndoEntry, UndoEntry } from './undoTypes';

/** Why entries left the stack. Only `cleared` says the SESSION's whole record is gone, which
 *  is what lets a release listener sweep up state no surviving entry can name. */
export type UndoReleaseReason = 'evicted' | 'spent' | 'dropped' | 'cleared';

/** Told when entries LEAVE the stack, so whatever an entry was holding can be let go. */
export type UndoReleaseListener = (
  sessionId: number,
  released: UndoEntry[],
  reason: UndoReleaseReason,
) => void;

/** How many entries a session keeps. Deep enough that a normal editing burst stays
 *  fully reversible; shallow enough that the retained source never adds up to much. */
export const MAX_UNDO_DEPTH = 25;

const stacks = new Map<number, UndoEntry[]>();
const listeners = new Set<() => void>();
const releaseListeners = new Set<UndoReleaseListener>();
let nextId = 1;

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* a listener that throws must not break the edit that triggered it */
    }
  }
}

function released(sessionId: number, entries: UndoEntry[], reason: UndoReleaseReason): void {
  if (entries.length === 0 && reason !== 'cleared') return;
  for (const listener of releaseListeners) {
    try {
      listener(sessionId, entries, reason);
    } catch {
      /* a listener that throws must not break the edit that triggered it */
    }
  }
}

/**
 * Run `listener` whenever entries leave a session's stack. Answers a disposer.
 *
 * The stack itself holds nothing but plain data, but two kinds of entry PIN an object in the
 * stone: a class edit stashes the version bound before it, and a dictionary removal stashes
 * the dictionary. Neither is released by the entry going away — SessionTemps is not the
 * stack's to know about — so an eviction or a clear would otherwise leave those objects held
 * for the rest of the session with no entry left that could ever use them. This is the hook
 * `releaseStash.ts` uses to let them go; see there for why it is a hook rather than the stack
 * doing it itself.
 */
export function onUndoEntriesReleased(listener: UndoReleaseListener): () => void {
  releaseListeners.add(listener);
  return () => releaseListeners.delete(listener);
}

function stackFor(sessionId: number): UndoEntry[] {
  let stack = stacks.get(sessionId);
  if (!stack) {
    stack = [];
    stacks.set(sessionId, stack);
  }
  return stack;
}

/** Run `listener` whenever any session's stack changes. Answers a disposer. */
export function onUndoStackChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Record something undoable. Answers the stored entry, with its assigned id.
 *
 * A `refactoring` entry displaces any earlier one, because the stone keeps exactly ONE
 * refactoring undo: a second applied refactoring overwrites the first server-side, so
 * leaving the first on the client stack would offer an undo that no longer exists.
 * Method-edit entries have no such limit — their state is right here.
 */
export function pushUndoEntry(entry: NewUndoEntry): UndoEntry {
  const stack = stackFor(entry.sessionId);
  const gone: UndoEntry[] = [];
  if (entry.kind === 'refactoring') {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i].kind === 'refactoring') gone.push(...stack.splice(i, 1));
    }
  }
  const stored = { ...entry, id: nextId };
  nextId += 1;
  stack.push(stored);
  while (stack.length > MAX_UNDO_DEPTH) {
    const evicted = stack.shift();
    if (evicted) gone.push(evicted);
  }
  released(entry.sessionId, gone, 'evicted');
  notify();
  return stored;
}

/** The entry an undo would reverse next, without removing it. */
export function peekUndoEntry(sessionId: number | undefined): UndoEntry | undefined {
  if (sessionId === undefined) return undefined;
  const stack = stacks.get(sessionId);
  return stack && stack.length > 0 ? stack[stack.length - 1] : undefined;
}

/** Take the top entry off. Callers pop only once they have decided to act on it. */
export function popUndoEntry(sessionId: number): UndoEntry | undefined {
  const stack = stacks.get(sessionId);
  if (!stack || stack.length === 0) return undefined;
  const entry = stack.pop();
  if (entry) released(sessionId, [entry], 'spent');
  notify();
  return entry;
}

/** Forget one entry wherever it sits — for a record the stone turns out no longer to
 *  hold, which would otherwise offer an undo that cannot run. */
export function dropUndoEntry(sessionId: number, id: number): void {
  const stack = stacks.get(sessionId);
  if (!stack) return;
  const at = stack.findIndex((e) => e.id === id);
  if (at < 0) return;
  released(sessionId, stack.splice(at, 1), 'dropped');
  notify();
}

/** Forget everything this session recorded — on logout, and on an abort, which rewinds
 *  the stone underneath every entry and leaves them all describing a state that is gone. */
export function clearUndoStack(sessionId: number): void {
  const stack = stacks.get(sessionId) ?? [];
  stacks.delete(sessionId);
  // Announced even for an empty stack, and this is the one reason `released` lets a
  // zero-entry call through: a `cleared` is also how anything stashed by a recording that
  // never made it onto the stack -- an edit that failed after its capture -- gets let go.
  released(sessionId, stack, 'cleared');
  if (stack.length === 0) return;
  notify();
}

export function undoStackDepth(sessionId: number | undefined): number {
  if (sessionId === undefined) return 0;
  return stacks.get(sessionId)?.length ?? 0;
}

/** Test seam: drop every stack and every listener. */
export function resetUndoStacks(): void {
  stacks.clear();
  listeners.clear();
  releaseListeners.clear();
  nextId = 1;
}
