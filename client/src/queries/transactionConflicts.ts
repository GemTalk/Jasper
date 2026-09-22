// `System transactionConflicts` — what GemStone refused a commit over.
//
// The dictionary it answers holds `#commitResult` plus one Association per kind
// of conflict detected, each value an Array of the objects that collided
// (Programming Guide 3.7 §9.2, "Transaction Conflicts", Table 9.1).
//
// Read it BEFORE anything else touches the transaction: "Conflict sets are
// cleared at the beginning of a commit or abort and thus can be examined until
// the next commit, continue, or abort."
import { QueryExecutor } from './types';

/**
 * How many conflicting objects to name per kind.
 *
 * A write-write conflict on an indexed collection can list thousands. The first
 * handful identify the collision; the rest are a round trip's worth of string
 * that nothing reads. `total` still carries the real count.
 */
export const CONFLICT_OBJECT_LIMIT = 25;

/**
 * How much of each conflicting object's `printString` to bring back. Enough to
 * recognize the object at a glance; the report names the expression that shows
 * the whole of it in a live session.
 */
export const CONFLICT_PRINT_STRING_LIMIT = 100;

/** The workspace expression that turns an OOP in the report back into its object. */
export function objectForOopExpression(oop: string): string {
  return `Object _objectForOop: ${oop}`;
}

export interface ConflictingObject {
  /** `asOop printString` — what `Object _objectForOop:` takes. */
  oop: string;
  className: string;
  /**
   * `printString`, abbreviated to {@link CONFLICT_PRINT_STRING_LIMIT}, or
   * undefined when the object had none to give (its `printOn:` raised, or the
   * stone answered an empty string).
   */
  printString?: string;
}

export interface ConflictCategory {
  /** GemStone's own key, e.g. `Write-Write`, `Write-Dependency`. */
  key: string;
  /** How many objects conflicted — may exceed `objects.length`, see {@link CONFLICT_OBJECT_LIMIT}. */
  total: number;
  objects: ConflictingObject[];
  /**
   * Set instead of `objects` when the value was not a collection. Table 9.1's
   * `#'Synchronized-Commit'` is documented as "details of the synchronized
   * commit failure" rather than an Array, so the shape is not guaranteed.
   */
  text?: string;
}

export interface TransactionConflicts {
  /** `#commitResult`, unquoted — `failure`, `rcFailure`, … — or undefined if absent. */
  commitResult: string | undefined;
  categories: ConflictCategory[];
}

/**
 * The `#commitResult` symbols, worded for someone who has just been refused.
 * Verbatim meanings are in Programming Guide 3.7 §9.2.
 */
const COMMIT_RESULT_EXPLANATIONS: Record<string, string> = {
  readOnly: 'there was nothing to commit',
  success: 'the commit succeeded',
  failure: 'the commit conflicted with another session',
  rcFailure: "replaying this transaction's changes to reduced-conflict objects failed",
  retryFailure:
    'the commit failed, and the attempt before it failed to replay reduced-conflict changes',
  retryLimitExceeded: 'the commit used up its retry attempts (GemStone allows 15)',
  dependencyFailure: 'another session changed an index covering an object this transaction changed',
  commitDisallowed: 'commits are disallowed for this session',
  symbolFailure: 'a Symbol this transaction created could not be committed',
  lockFailure: 'a lock held by another session blocked the commit',
};

/** The plain-English gloss for a `#commitResult`, or undefined for one we have no wording for. */
export function describeCommitResult(commitResult: string | undefined): string | undefined {
  return commitResult ? COMMIT_RESULT_EXPLANATIONS[commitResult] : undefined;
}

// Record-per-line, tab-separated: R = commitResult, K = a conflict kind and its
// object count, O = one conflicting object under the K above it, T = a non-Array
// value rendered as text.
//
// `printString` runs application code, inside a doit, on objects two sessions are
// fighting over — so it is guarded the way `getGlobalsForDictionary` guards its
// own: a raise degrades that one object to its oop and class rather than losing
// the report, the result is cut to CONFLICT_PRINT_STRING_LIMIT, and separators are
// flattened so one object cannot spill across the line format. What it can still
// cost is time, on an object whose printOn: walks a large collection; that is the
// same bargain every printString in this codebase makes, and it is only ever paid
// on a commit that has already been refused.
const CONFLICTS_CODE = `| conflicts stream |
conflicts := System transactionConflicts.
stream := WriteStream on: Unicode7 new.
stream nextPutAll: 'R'; tab;
  nextPutAll: (conflicts at: #commitResult ifAbsent: [nil]) asString; lf.
conflicts keysAndValuesDo: [:key :value |
  key == #commitResult ifFalse: [
    (value isKindOf: Collection)
      ifTrue: [ | shown |
        shown := 0.
        stream nextPutAll: 'K'; tab; nextPutAll: key asString; tab;
          nextPutAll: value size printString; lf.
        value do: [:each |
          shown := shown + 1.
          shown <= ${CONFLICT_OBJECT_LIMIT} ifTrue: [ | ps |
            ps := [ | t |
              t := each printString.
              t size > ${CONFLICT_PRINT_STRING_LIMIT}
                ifTrue: [t := (t copyFrom: 1 to: ${CONFLICT_PRINT_STRING_LIMIT}), '...'].
              t collect: [:c | c isSeparator ifTrue: [$ ] ifFalse: [c]]]
                on: Error do: [:ex | ''].
            stream nextPutAll: 'O'; tab;
              nextPutAll: each asOop printString; tab;
              nextPutAll: each class name asString; tab;
              nextPutAll: ps; lf]]]
      ifFalse: [ | txt |
        txt := [value printString] on: Error do: [:ex | '<printString failed>'].
        txt := txt collect: [:c | c isSeparator ifTrue: [$ ] ifFalse: [c]].
        txt size > 200 ifTrue: [txt := (txt copyFrom: 1 to: 200), '...'].
        stream nextPutAll: 'K'; tab; nextPutAll: key asString; tab; nextPutAll: '0'; lf.
        stream nextPutAll: 'T'; tab; nextPutAll: txt; lf]]].
conflicts := nil.
stream contents`;

/**
 * Read the conflict set left by the commit that was just refused.
 *
 * The doit drops its own reference before answering: "If you save a reference to
 * the conflict set, be sure to clear this reference to avoid making the conflict
 * set persistent" (§9.2).
 */
export function transactionConflicts(execute: QueryExecutor): TransactionConflicts {
  return parseTransactionConflicts(execute(CONFLICTS_CODE));
}

/** Exported for tests: the pure half of {@link transactionConflicts}. */
export function parseTransactionConflicts(raw: string): TransactionConflicts {
  let commitResult: string | undefined;
  const categories: ConflictCategory[] = [];
  for (const line of raw.split('\n')) {
    const [tag, ...rest] = line.split('\t');
    const last = categories[categories.length - 1];
    if (tag === 'R') {
      const value = (rest[0] ?? '').trim();
      commitResult = value && value !== 'nil' ? value : undefined;
    } else if (tag === 'K') {
      const total = Number(rest[1]);
      categories.push({
        key: rest[0] ?? '',
        total: Number.isFinite(total) ? total : 0,
        objects: [],
      });
    } else if (tag === 'O' && last) {
      // Rejoined from field 3 on: an abbreviated printString may hold tabs.
      const printString = rest.slice(2).join('\t').trim();
      last.objects.push({
        oop: rest[0] ?? '',
        className: rest[1] ?? '',
        ...(printString ? { printString } : {}),
      });
    } else if (tag === 'T' && last) {
      // Rejoined rather than `rest[0]`: a rendered value may contain tabs.
      last.text = rest.join('\t');
    }
  }
  return { commitResult, categories };
}

/** `2 objects` / `1 object`, so the caller does not have to count characters. */
function objectCount(n: number): string {
  return `${n} object${n === 1 ? '' : 's'}`;
}

/**
 * The conflict kinds and their sizes on one line, for a toast:
 * `Write-Write on 2 objects, Write-Dependency on 1 object`.
 *
 * Empty when GemStone reported a refusal with no conflict keys — which happens,
 * so callers must have wording that does not depend on this.
 */
export function conflictSummary(conflicts: TransactionConflicts): string {
  return conflicts.categories
    .map((c) => (c.text ? `${c.key} (${c.text})` : `${c.key} on ${objectCount(c.total)}`))
    .join(', ');
}

// "You must abort the transaction in order to get a new snapshot view of the
// repository and, along with it, an empty read set and an empty write set. A
// subsequent attempt to run your code and commit can succeed." — §9.2. Repeating
// the commit cannot work, so the advice rides along with every refusal.
const ADVICE = 'Abort for a fresh view, then try again.';

/**
 * One sentence saying why the commit was refused and what to do — shared by the
 * toast and by the MCP tool's reply, so the two cannot describe the same refusal
 * differently.
 *
 * `undefined` means the conflict set could not be read; the refusal is still
 * worded, just without naming what collided.
 */
export function conflictReason(conflicts: TransactionConflicts | undefined): string {
  const parts: string[] = [];
  // `#failure` glosses as "conflicted with another session", which is what the
  // conflict kinds below say in more detail — so it is dropped rather than
  // printed twice.
  const gloss =
    conflicts && conflicts.commitResult !== 'failure'
      ? describeCommitResult(conflicts.commitResult)
      : undefined;
  if (gloss) parts.push(gloss);
  const summary = conflicts ? conflictSummary(conflicts) : '';
  if (summary) parts.push(summary);
  if (parts.length === 0) {
    parts.push('another session committed a change this transaction also made');
  }
  return `${parts.join('. ')}. ${ADVICE}`;
}

/** Whether there is anything in `conflicts` worth showing beyond {@link conflictReason}. */
export function hasConflictDetail(conflicts: TransactionConflicts): boolean {
  return conflicts.categories.length > 0 || !!conflicts.commitResult;
}

/**
 * The full conflict set, for the output channel — every kind, and every object
 * the stone named up to {@link CONFLICT_OBJECT_LIMIT}.
 *
 * Each object is one line: its oop, its class, and as much of its `printString`
 * as came back — enough to recognize `aSymbolDictionary( name: #'UserGlobals' )`
 * without leaving the log. The oop and class columns are padded to a common
 * width, because the point of the block is being able to run an eye down it.
 * `Object _objectForOop:` is named once, over the first oop in the report, so it
 * is both the instruction and something to paste.
 */
export function conflictReport(conflicts: TransactionConflicts): string {
  const lines: string[] = [];
  const gloss = describeCommitResult(conflicts.commitResult);
  if (conflicts.commitResult) {
    lines.push(`commitResult: ${conflicts.commitResult}${gloss ? ` — ${gloss}` : ''}`);
  }

  const named = conflicts.categories.flatMap((c) => c.objects);
  if (named.length > 0) {
    lines.push(`Inspect one in a workspace: ${objectForOopExpression(named[0].oop)}`);
  }
  const oopWidth = Math.max(0, ...named.map((o) => o.oop.length));
  const classWidth = Math.max(0, ...named.map((o) => o.className.length));

  for (const category of conflicts.categories) {
    lines.push('');
    if (category.text) {
      lines.push(`${category.key} — ${category.text}`);
      continue;
    }
    lines.push(`${category.key} — ${objectCount(category.total)}`);
    for (const object of category.objects) {
      const columns = [object.oop.padEnd(oopWidth), object.className.padEnd(classWidth)];
      if (object.printString) columns.push(object.printString);
      lines.push(`  ${columns.join('  ').trimEnd()}`);
    }
    const withheld = category.total - category.objects.length;
    if (withheld > 0) lines.push(`  … and ${objectCount(withheld)} not listed`);
  }
  return lines.join('\n');
}
