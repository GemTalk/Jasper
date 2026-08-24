/**
 * Jasper's undo stack (issue #434).
 *
 * One bounded stack per session, held in the extension rather than in the stone. That
 * placement is the design decision the rest of the undo work hangs off:
 *
 *  - a method edit can then be undone on ANY stone, with no server-side install — the
 *    reversal is plain `compileMethod:` / `removeSelector:`;
 *  - a refactoring, whose reversal genuinely has to happen server-side, is just one
 *    KIND of entry pointing at the record the engine already keeps.
 *
 * So the generic layer owns the stack and the refactoring engine extends it, rather than
 * the stack living inside the engine and everything else having to reach through it.
 *
 * Per session, because an entry describes work done in one session's transaction and
 * means nothing in another's. Bounded, because every method save now records one and an
 * unbounded stack would hold every source string of a long editing session alive.
 *
 * The stack is process-local and deliberately not persisted: it is discarded on logout
 * (see `clearUndoStack`), matching the session-scoped record the refactoring engine keeps
 * in SessionTemps.
 */
import { NewUndoEntry, UndoEntry } from './undoTypes';

/** How many entries a session keeps. Deep enough that a normal editing burst stays
 *  fully reversible; shallow enough that the retained source never adds up to much. */
export const MAX_UNDO_DEPTH = 25;

const stacks = new Map<number, UndoEntry[]>();
const listeners = new Set<() => void>();
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
  if (entry.kind === 'refactoring') {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i].kind === 'refactoring') stack.splice(i, 1);
    }
  }
  const stored = { ...entry, id: nextId };
  nextId += 1;
  stack.push(stored);
  while (stack.length > MAX_UNDO_DEPTH) stack.shift();
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
  stack.splice(at, 1);
  notify();
}

/** Forget everything this session recorded — on logout, and on an abort, which rewinds
 *  the stone underneath every entry and leaves them all describing a state that is gone. */
export function clearUndoStack(sessionId: number): void {
  const stack = stacks.get(sessionId);
  if (!stack || stack.length === 0) return;
  stacks.delete(sessionId);
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
  nextId = 1;
}
