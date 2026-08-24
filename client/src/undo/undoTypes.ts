/**
 * The vocabulary of Jasper's undo stack — deliberately free of any refactoring
 * concept (issue #434).
 *
 * The stack is generic: an entry says WHAT was done and HOW to reverse it, and the
 * reversers are looked up by `kind`. Saving a method, adding one, and deleting one
 * are all the same shape — a set of METHOD SLOTS whose state before the action was
 * captured — so they share one kind and one reverser. A refactoring is the other
 * kind, and it is the only one that reaches into the refactoring engine.
 *
 * Nothing here imports vscode or a GCI session, so the planning rules in
 * `methodSlotPlan.ts` can be unit-tested as plain data.
 */

/**
 * One addressable method: a class (or its metaclass) and a selector.
 *
 * `dict` scopes the class lookup to a SymbolList index or dictionary name, exactly as
 * every other method-level query does, so the same class name in two dictionaries
 * still resolves to the one that was edited.
 */
export interface MethodSlot {
  dict?: number | string;
  className: string;
  isMeta: boolean;
  selector: string;
  /** Always 0 today: see `recordMethodEdit` for why a non-default environment records
   *  no undo rather than a reversal it cannot perform. */
  environmentId: number;
}

/** What a slot held at a point in time. A class that will not resolve, or a selector
 *  the class does not implement, reads as `exists: false` — which is exactly what the
 *  reversal planner needs to hear. */
export interface MethodSlotState {
  exists: boolean;
  source: string | null;
  category: string | null;
}

/** The three things reversing a method edit can ask for. `restore` puts back a method
 *  that is gone, `recompile` rewrites one that changed, `remove` takes away one that
 *  was created. */
export type MethodSlotOpKind = 'restore' | 'recompile' | 'remove';

export interface MethodSlotOp {
  kind: MethodSlotOpKind;
  slot: MethodSlot;
  /** The source and category to put back. Null for `remove`, which needs neither. */
  source: string | null;
  category: string | null;
}

interface UndoEntryBase {
  /** Monotonic within the process, for logging and for identifying an entry across a
   *  refresh without comparing contents. */
  id: number;
  /** The session this entry belongs to. An entry is only ever offered to the session
   *  that made it — another session's stone state has nothing to do with it. */
  sessionId: number;
  /** What to call it in the UI: "Save UndoDemo>>#total", "Delete UndoDemo>>#total". */
  label: string;
}

/** An edit to one or more method slots, reversed by putting the slots back the way
 *  they were. Created methods, saved methods and deleted methods are all this. */
export interface MethodEditUndoEntry extends UndoEntryBase {
  kind: 'methodEdit';
  slots: MethodSlot[];
  /** State captured immediately BEFORE the edit — the target of the reversal. */
  before: MethodSlotState[];
  /** State the edit left behind, as the recording site knew it. Compared against the
   *  live state at undo time to spot a slot someone has changed since. */
  after: MethodSlotState[];
}

/** An applied refactoring, reversed by the refactoring engine's own recorded undo.
 *  The client entry is a POINTER: the record itself lives in the stone's SessionTemps,
 *  which is also the only place that can execute it. */
export interface RefactoringUndoEntry extends UndoEntryBase {
  kind: 'refactoring';
  /** The stone-side entry's sequence number, so a client entry left over from a record
   *  the stone has since replaced can be recognised and dropped. */
  sequence: number;
}

export type UndoEntry = MethodEditUndoEntry | RefactoringUndoEntry;

/** An entry as a recording site supplies it, before the stack assigns its id. Written as
 *  a union of Omits rather than `Omit<UndoEntry, 'id'>`, which would flatten the union
 *  into a single object type and lose every kind-specific field. */
export type NewUndoEntry = Omit<MethodEditUndoEntry, 'id'> | Omit<RefactoringUndoEntry, 'id'>;

/** How a slot reads in a message: `Account>>#balance`, `Account class>>#new`. */
export function slotLabel(slot: MethodSlot): string {
  return `${slot.className}${slot.isMeta ? ' class' : ''}>>#${slot.selector}`;
}
