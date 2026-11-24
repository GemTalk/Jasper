import { QueryExecutor } from '../../queries/types';
import { classLookupExpr } from '../../queries/util';

export interface StartingMethod {
  isMeta: boolean;
  selector: string;
}

export interface StartingPoints {
  className: string;
  /** The methods no other method of the class sends to: where a reader, or another class, starts. */
  starts: StartingMethod[];
  /** Every method is called from inside (all in cycles), so `starts` holds the least-called instead. */
  noneUncalled: boolean;
}

/**
 * Find where reading a class starts. Answers undefined when no such class exists.
 *
 * A method counts as called when another method of the class sends it to `self` (same side), or
 * to `self new` / `self basicNew` on the class side (instance side). The stone reports where each
 * send's selector starts (`_sourceOffsetsOfSends`) but not its receiver, so the word before it is
 * read from the source. A selector merely shared with the class (`slots size` in a class that
 * implements `size`) is not a call, and a `super` send goes to the superclass. A cascade's later
 * parts (`self a; b`) are missed, so such a method can be listed as a start when it is not one.
 */
export function startingPoints(
  execute: QueryExecutor,
  className: string,
  dictName?: string,
): StartingPoints | undefined {
  const raw = execute(`| cls ws |
cls := ${classLookupExpr(className, dictName)}.
(cls isNil or: [cls isBehavior not]) ifTrue: ['NOTFOUND'] ifFalse: [
  | sides impl wordBefore |
  ws := WriteStream on: Unicode7 new.
  ws nextPutAll: 'C'; tab; nextPutAll: cls name; lf.
  sides := Array with: cls with: cls class.
  impl := sides collect: [:beh | beh selectors asIdentitySet].
  "The identifier ending at or before end, skipping blanks and comments, and where it starts."
  wordBefore := [:src :end | | i j |
    i := end.
    [i >= 1 and: [(src at: i) isSeparator]] whileTrue: [i := i - 1].
    [i >= 1 and: [(src at: i) = $"]] whileTrue: [
      i := i - 1.
      [i >= 1 and: [(src at: i) ~= $"]] whileTrue: [i := i - 1].
      i := i - 1.
      [i >= 1 and: [(src at: i) isSeparator]] whileTrue: [i := i - 1]].
    j := i.
    [j >= 1 and: [(src at: j) isAlphaNumeric or: [(src at: j) = $_]]] whileTrue: [j := j - 1].
    Array with: (j < i ifTrue: [src copyFrom: j + 1 to: i] ifFalse: ['']) with: j].
  1 to: 2 do: [:i | | beh side |
    beh := sides at: i.
    side := (i - 1) printString.
    beh selectors asSortedCollection do: [:sel | | m src offsets |
      m := beh compiledMethodAt: sel.
      ws nextPutAll: 'M'; tab; nextPutAll: side; tab; nextPutAll: sel; lf.
      src := m sourceString.
      offsets := m _sourceOffsetsOfSends.
      1 to: offsets size by: 2 do: [:k | | sent before target |
        sent := offsets at: k + 1.
        before := wordBefore value: src value: (offsets at: k) - 1.
        target := (before at: 1) = 'self'
          ifTrue: [i]
          ifFalse: [(i = 2 and: [#('new' 'basicNew') includes: (before at: 1)])
            ifTrue: [(#('self' 'super') includes: ((wordBefore value: src value: (before at: 2)) at: 1))
              ifTrue: [1] ifFalse: [0]]
            ifFalse: [0]].
        (target > 0 and: [(impl at: target) includes: sent]) ifTrue: [
          ws nextPutAll: 'S'; tab; nextPutAll: side; tab; nextPutAll: sel; tab;
            nextPutAll: (target - 1) printString; tab; nextPutAll: sent; lf]]]].
  ws contents]`);
  if (raw.trim() === 'NOTFOUND') return undefined;
  return parseStartingPoints(raw);
}

/** How a method list names a row it notes: see methodNotesFromStartingPoints. */
export function methodNoteKey(className: string, isMeta: boolean, selector: string): string {
  return `${className}${isMeta ? ' class' : ''}>>${selector}`;
}

export interface MethodNote {
  /** Shown after the row's dictionary name. */
  text: string;
  /** Shown on hovering the note. */
  tip: string;
}

/** Notes for a method list's rows: the class's starting points read "no senders in <Class>".
 *  Nothing when every method has a sender in the class, since then none is where reading starts. */
export function startingPointNotes(found: StartingPoints): Map<string, MethodNote> {
  if (found.noneUncalled) return new Map();
  const c = found.className;
  const note: MethodNote = {
    text: `no senders in ${c}`,
    tip: `Only called from outside ${c}, if at all. A good place to start reading.`,
  };
  return new Map(found.starts.map((m) => [methodNoteKey(c, m.isMeta, m.selector), note]));
}

export function parseStartingPoints(raw: string): StartingPoints {
  let className = '';
  const methods: StartingMethod[] = [];
  const callers = new Map<string, Set<string>>();
  const key = (isMeta: boolean, selector: string) => `${isMeta ? 1 : 0} ${selector}`;
  for (const line of raw.split('\n')) {
    const f = line.split('\t');
    if (f[0] === 'C') {
      className = f[1];
    } else if (f[0] === 'M') {
      methods.push({ isMeta: f[1] === '1', selector: f[2] });
    } else if (f[0] === 'S') {
      // A method's sends come with it, so a callee later in the listing is not known yet.
      const from = key(f[1] === '1', f[2]);
      const to = key(f[3] === '1', f[4]);
      if (from === to) continue;
      if (!callers.has(to)) callers.set(to, new Set());
      callers.get(to)!.add(from);
    }
  }
  const count = (m: StartingMethod) => callers.get(key(m.isMeta, m.selector))?.size ?? 0;
  const uncalled = methods.filter((m) => count(m) === 0);
  if (uncalled.length > 0 || methods.length === 0) {
    return { className, starts: uncalled, noneUncalled: false };
  }
  const fewest = Math.min(...methods.map(count));
  return { className, starts: methods.filter((m) => count(m) === fewest), noneUncalled: true };
}
