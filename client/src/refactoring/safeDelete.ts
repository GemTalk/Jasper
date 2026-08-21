/**
 * Safe delete: the question asked before a method, class, instance variable or class
 * variable is removed.
 *
 * Deleting used to be unguarded — a modal every time, whatever the target, and you found
 * out from a doesNotUnderstand or a failed recompile that something still needed it. Here
 * the reference scan comes first, and the answer decides the interaction:
 *
 *   - nothing references the target → no question at all; the caller deletes and announces
 *     it afterwards, so an unasked deletion is still visible;
 *   - something does → a confirmation that says how many and which — one line per
 *     referencing class — can show them, and only then offers to remove anyway. Opening one
 *     of those references abandons the deletion: the user went to look at code, which is not
 *     an answer to the question, and the question should not chase them there.
 *
 * References are a confirmation rather than a refusal on purpose: deleting a referenced
 * thing is sometimes exactly the intent (the callers are going too), and refusing outright
 * would take away something the Explorer can do today. What the guard changes is that you
 * are told first.
 *
 * The scans themselves live with the queries — sendersOf, referencesToClassInDict,
 * methodsAccessingInstVar, methodsAccessingClassVar — so this module is pure decision, and
 * unit-tests without a stone.
 */
import * as vscode from 'vscode';
import { MethodSearchResult } from '../queries/methodSearch';
import { showMethodResults } from '../methodResultsPicker';

export type SafeDeleteKind = 'method' | 'class' | 'instance variable' | 'class variable';

/** What is about to be deleted, and everything known about why it might not be safe. */
export interface SafeDeleteTarget {
  kind: SafeDeleteKind;
  /** How the target reads after its kind: `#at: from Array`, `Doomed from UserGlobals`,
   *  `balance from Account`. */
  label: string;
  /** Methods that still reference the target. Empty means nothing does — the whole point
   *  of the guard. Callers exclude references that go away WITH the target (a recursive
   *  self-send, a doomed subclass's method), which are not reasons to ask. */
  references: MethodSearchResult[];
  /** Non-method reasons this deletion takes more with it than the target — the subclasses
   *  that go with a class. Presence forces a confirmation, but there is nothing to browse. */
  blockers?: string[];
  /** Heading for the blocker line. */
  blockerLead?: string;
  /** An extra line for the confirmation, e.g. the not-committed-yet reminder. */
  note?: string;
  /** Why the reference scan could not answer. Set means we do not KNOW the target is
   *  unreferenced, so the deletion is confirmed rather than assumed safe. */
  scanFailed?: string;
  /** Label for the confirm button; defaults to `Remove Anyway` when something is in the
   *  way and `Remove` when the only reason to ask is that we could not check. */
  confirmLabel?: string;
}

/** What the guard decided. `silent` means nothing was in the way and no question was
 *  asked — the caller deletes and then calls announceSilentDelete. */
export type SafeDeleteDecision = 'silent' | 'confirmed' | 'cancelled';

const SHOW_REFERENCES = 'Show References…';

/** How many blockers to name before summarising the rest. */
const NAMED_BLOCKER_LIMIT = 8;

/** How many receivers to give a line of their own before summarising the rest. */
const NAMED_RECEIVER_LIMIT = 8;

/** How many selectors to name on one receiver's line before summarising that line. */
const NAMED_SELECTOR_LIMIT = 6;

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

function listing(items: string[]): string {
  const shown = items.slice(0, NAMED_BLOCKER_LIMIT);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(', ')}, …(+${rest} more)` : shown.join(', ');
}

/** The referencing methods as one line per receiver, the receiver named once however many
 *  of its methods are involved:
 *
 *      Account >> #balance, #deposit:
 *      Account class >> #resetCount
 *      Savings >> #accrue
 *
 *  Removing an instance or class variable usually hits several methods of the SAME class,
 *  so repeating the class name on every entry was most of the text and made the list hard
 *  to scan. A class and its metaclass are different receivers and stay on separate lines —
 *  `Account >> #x` and `Account class >> #x` are different methods.
 *
 *  Receivers are ordered by name, instance side before class side, so the same reference
 *  set always reads the same way. A superclass, or any class outside the target's own
 *  hierarchy, is just another receiver and likewise appears once: senders of a method and
 *  references to a class can come from anywhere in the image. (A VARIABLE's accessors
 *  cannot come from a superclass — the scan starts at the class that declares it and walks
 *  down — so those lists only ever name that class and its subclasses.) */
export function groupReferencesByReceiver(references: MethodSearchResult[]): string[] {
  const byReceiver = new Map<string, { receiver: string; selectors: string[] }>();
  for (const r of references) {
    const receiver = `${r.className}${r.isMeta ? ' class' : ''}`;
    const key = `${r.className}|${r.isMeta}`;
    const group = byReceiver.get(key) ?? { receiver, selectors: [] };
    // A receiver can legitimately repeat a selector across environments; the caller
    // dedupes, but don't render a duplicate if one slips through.
    if (!group.selectors.includes(r.selector)) group.selectors.push(r.selector);
    byReceiver.set(key, group);
  }

  const groups = [...byReceiver.values()].sort((a, b) => a.receiver.localeCompare(b.receiver));
  const shown = groups.slice(0, NAMED_RECEIVER_LIMIT);
  const restReceivers = groups.length - shown.length;

  const lines = shown.map(({ receiver, selectors }) => {
    const named = selectors.slice(0, NAMED_SELECTOR_LIMIT);
    const rest = selectors.length - named.length;
    const tail = rest > 0 ? `, …(+${rest} more)` : '';
    return `${receiver} >> ${named.map((sel) => `#${sel}`).join(', ')}${tail}`;
  });
  if (restReceivers > 0) {
    lines.push(`…(+${restReceivers} more ${plural(restReceivers, 'class', 'classes')})`);
  }
  return lines;
}

function detailFor(target: SafeDeleteTarget): string {
  const lines: string[] = [];
  if (target.scanFailed) {
    lines.push(`Could not check what references it: ${target.scanFailed}`);
  }
  if (target.references.length > 0) {
    const n = target.references.length;
    lines.push(
      `${n} ${plural(n, 'method', 'methods')} still ${plural(n, 'references', 'reference')} it:`,
    );
    // One line per referencing class, so the block reads as a list rather than a paragraph.
    lines.push(groupReferencesByReceiver(target.references).join('\n'));
  }
  if (target.blockers && target.blockers.length > 0) {
    lines.push(`${target.blockerLead ?? 'Also removed'}: ${listing(target.blockers)}`);
  }
  if (target.note) lines.push(target.note);
  return lines.join('\n\n');
}

function nothingInTheWay(target: SafeDeleteTarget): boolean {
  return (
    target.references.length === 0 &&
    !(target.blockers && target.blockers.length > 0) &&
    !target.scanFailed
  );
}

/** Decide whether the deletion goes ahead, asking only when something might break. */
export async function decideSafeDelete(
  sessionId: number,
  target: SafeDeleteTarget,
): Promise<SafeDeleteDecision> {
  if (nothingInTheWay(target)) return 'silent';

  const confirmLabel =
    target.confirmLabel ?? (target.references.length > 0 ? 'Remove Anyway' : 'Remove');
  const buttons = target.references.length > 0 ? [SHOW_REFERENCES, confirmLabel] : [confirmLabel];
  const message = `Remove ${target.kind} ${target.label}?`;
  const detail = detailFor(target);

  // Browsing is a detour, and how it ends decides whether the question comes back. OPENING
  // one of the references means the user has gone to read that method — they are somewhere
  // else now, doing something other than deleting, so re-raising a modal over the code they
  // just asked to see would be an interruption, and one whose default action is
  // destructive. Closing the list without opening anything is the opposite: they looked at
  // the list, learned what it said, and are still deciding — so ask again.
  for (;;) {
    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true, detail },
      ...buttons,
    );
    if (choice === SHOW_REFERENCES) {
      const opened = await showMethodResults(
        sessionId,
        target.references,
        `References to ${target.kind} ${target.label}`,
      );
      if (opened) return 'cancelled';
      continue;
    }
    return choice === confirmLabel ? 'confirmed' : 'cancelled';
  }
}

/** Report a deletion the user was never asked about, so it does not happen invisibly.
 *  Only for the `silent` decision — a confirmed deletion already had the user's attention. */
export function announceSilentDelete(target: SafeDeleteTarget): void {
  void vscode.window.showInformationMessage(
    `Removed ${target.kind} ${target.label} — nothing referenced it.`,
  );
}

/** Drop the rows two scans (or two environments) both found. Method rows are identified by
 *  class, side and selector — the same key the Senders / Implementors commands dedupe on. */
export function dedupeMethodResults(results: MethodSearchResult[]): MethodSearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = `${r.className}|${r.isMeta}|${r.selector}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
