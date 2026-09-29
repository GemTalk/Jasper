/**
 * What an undo is about to do, worked out BEFORE it does it.
 *
 * Every undo now shows the user a list of what it will change and waits for them to accept it
 * (#396 review). Before that, a refactoring's undo opened a preview panel while every other kind
 * asked a yes/no naming only the change as a whole -- so "Undo" meant two different experiences
 * depending on machinery the user has no reason to know about. Adding an instance variable and
 * adding a class variable are sibling commands off the same menu; their undos looked nothing alike.
 *
 * A plan is a PURE function of the recorded entry. It runs no queries and touches no stone state:
 * everything it describes was captured when the change was made, which is also what the reversal
 * itself works from. That keeps the panel honest -- it shows the reversal's own inputs rather than
 * a second, independently-derived guess -- and keeps this module trivially testable.
 *
 * Rows are NOT individually selectable. The local reversers apply a plan whole: taking a class
 * variable away but leaving its accessors, or restoring half a method set, produces states none of
 * them are written to reach. The panel shows every row ticked and fixed, which is the same
 * all-or-nothing the refactoring engine already reports for most of its own reversals.
 */
import {
  UndoEntry,
  MethodEditUndoEntry,
  ClassEditUndoEntry,
  ClassCommentUndoEntry,
  ClassVarEditUndoEntry,
  MethodCategoryUndoEntry,
  ClassCategoryUndoEntry,
  DictionaryUndoEntry,
  MethodSlot,
  undoVerb,
} from './undoTypes';
import { qualifiedClassName as qualify } from '../refactoring/qualifiedClassName';

/** One thing the reversal will do. */
export interface UndoPlanRow {
  /** Stable within a plan, for the DOM. */
  id: string;
  /** The verb, lower case: `restore`, `remove`, `rebind earlier version`. */
  action: string;
  /** What it acts on: `Shadowed class >> registry`, `Shadowed`, `DictionaryB`. */
  target: string;
  /** A second line when the row needs one -- what the value goes back to, or what it costs. */
  detail?: string;
}

export interface UndoPlan {
  /** `Undo` or `Revert` -- from {@link undoVerb}, the one home for that distinction, so the
   *  panel's heading and button cannot drift from the tooltip and the Actions pane button. */
  verb: 'Undo' | 'Revert';
  /** The recorded label, already dictionary-qualified by whoever recorded it. */
  label: string;
  /** What this reversal leaves behind or cannot put back. Shown above the rows. */
  note?: string;
  rows: UndoPlanRow[];
}

/**
 * How a dictionary reference is turned into a name for a row, supplied by the caller.
 *
 * The plan stays PURE -- it runs no queries -- but a slot records its dictionary as a SymbolList
 * index as often as a name, and an index means nothing to a reader. The dispatcher, which has the
 * session, passes the lookup in. Undefined answers leave the row unqualified rather than wrong.
 */
export type DictNameLookup = (dict: number | string | undefined) => string | undefined;

/** `Foo (Dict) >> #bar`, or `Foo (Dict) class >> #bar` for the meta side. */
function methodTarget(slot: MethodSlot, dictNameFor?: DictNameLookup): string {
  const cls = qualify(slot.className, dictNameFor?.(slot.dict));
  return `${cls}${slot.isMeta ? ' class' : ''} >> #${slot.selector}`;
}

function planMethodEdit(e: MethodEditUndoEntry, d?: DictNameLookup): UndoPlan {
  return {
    verb: undoVerb(e),
    label: e.label,
    rows: e.slots.map((slot, i) => {
      const had = e.before[i]?.exists === true;
      return {
        id: `m${i}`,
        action: had ? 'restore' : 'remove',
        target: methodTarget(slot, d),
        detail: had
          ? `back to its source as of before the change${
              e.before[i]?.category ? `, in ${e.before[i]?.category}` : ''
            }`
          : 'it did not exist before the change',
      };
    }),
  };
}

function planClassEdit(e: ClassEditUndoEntry, d?: DictNameLookup): UndoPlan {
  // A class edit is a REVERT and is named as such: GemStone re-versions a class rather than
  // rolling it back, so binding the earlier version leaves anything written since behind.
  const leavesBehind = e.slots.some((_, i) => e.before[i]?.bound === true && e.after[i]?.bound);
  return {
    verb: undoVerb(e),
    label: e.label,
    note: leavesBehind
      ? 'Binds the earlier version of the class again. The class history grows rather than ' +
        'shrinking, so anything written on the newer version since is left behind.'
      : undefined,
    rows: e.slots.map((slot, i) => {
      const had = e.before[i]?.bound === true;
      return {
        id: `c${i}`,
        action: had ? 'rebind earlier version' : 'remove',
        target: qualify(slot.className, d?.(slot.dict)),
        detail: had ? undefined : 'it was not bound before the change',
      };
    }),
  };
}

function planClassComment(e: ClassCommentUndoEntry, d?: DictNameLookup): UndoPlan {
  return {
    verb: undoVerb(e),
    label: e.label,
    rows: [
      {
        id: 'comment',
        action: 'restore comment',
        target: qualify(e.slot.className, d?.(e.slot.dict)),
        detail: e.before.length === 0 ? 'back to empty' : 'back to its earlier text',
      },
    ],
  };
}

function planClassVarEdit(e: ClassVarEditUndoEntry, d?: DictNameLookup): UndoPlan {
  // Accessors first, then the declaration -- the order the reversal itself uses, so the class
  // never holds a method reading a class variable it no longer declares.
  const rows: UndoPlanRow[] = e.accessorSlots.map((slot, i) => {
    const had = e.accessorBefore[i]?.exists === true;
    return {
      id: `a${i}`,
      action: had ? 'restore' : 'remove',
      target: methodTarget(slot, d),
      detail: had ? 'it existed before the change and is put back' : undefined,
    };
  });
  const declared = e.before.defined;
  rows.push({
    id: 'var',
    action: declared ? 'restore class variable' : 'remove class variable',
    target: `${qualify(e.slot.className, d?.(e.slot.dict))}  ${e.slot.varName}`,
  });
  return { verb: undoVerb(e), label: e.label, rows };
}

function planMethodCategory(e: MethodCategoryUndoEntry, d?: DictNameLookup): UndoPlan {
  const cls = qualify(e.slot.className, d?.(e.slot.dict));
  const side = e.slot.isMeta ? `${cls} class` : cls;
  return {
    verb: undoVerb(e),
    label: e.label,
    rows: [
      {
        id: 'cat',
        action: e.before === null ? 'remove category' : `rename category back to ${e.before}`,
        target: `${side}  ${e.after}`,
      },
    ],
  };
}

function planClassCategory(e: ClassCategoryUndoEntry, d?: DictNameLookup): UndoPlan {
  return {
    verb: undoVerb(e),
    label: e.label,
    rows: e.changes.map((c, i) => ({
      id: `cc${i}`,
      action: c.before === null ? 'clear category' : `set category back to ${c.before}`,
      target: qualify(c.className, d?.(e.dict)),
    })),
  };
}

function planDictionary(e: DictionaryUndoEntry): UndoPlan {
  if (!e.before.present) {
    return {
      verb: undoVerb(e),
      label: e.label,
      note:
        'Takes the dictionary off the symbol list again. Anything it holds goes out of reach ' +
        'of an unqualified name.',
      rows: [{ id: 'd', action: 'remove from the symbol list', target: e.after.name }],
    };
  }
  const renamed = e.before.name !== e.after.name;
  return {
    verb: undoVerb(e),
    label: e.label,
    rows: [
      {
        id: 'd',
        action: renamed ? `rename back to ${e.before.name}` : 'put back on the symbol list',
        target: e.after.name,
        detail: renamed ? undefined : `at position ${e.before.index}, where it was`,
      },
    ],
  };
}

/**
 * The plan for an entry, or undefined for a kind that has a preview of its own.
 *
 * A REFACTORING is the one such kind: its reversal lives in the stone, can span dozens of methods
 * across a hierarchy, and is paged from the server rather than derived from anything the client
 * holds. It already opens a panel, so it already matches; this covers every other kind.
 */
export function planUndo(entry: UndoEntry, dictNameFor?: DictNameLookup): UndoPlan | undefined {
  switch (entry.kind) {
    case 'methodEdit':
      return planMethodEdit(entry, dictNameFor);
    case 'classEdit':
      return planClassEdit(entry, dictNameFor);
    case 'classComment':
      return planClassComment(entry, dictNameFor);
    case 'classVarEdit':
      return planClassVarEdit(entry, dictNameFor);
    case 'methodCategoryEdit':
      return planMethodCategory(entry, dictNameFor);
    case 'classCategoryEdit':
      return planClassCategory(entry, dictNameFor);
    case 'dictionaryEdit':
      return planDictionary(entry);
    case 'refactoring':
      return undefined;
  }
}
