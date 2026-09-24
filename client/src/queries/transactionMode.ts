// GemStone's three transaction modes, and the state that decides what a session
// can do in each. Read against a live session by the query functions below; the
// predicates under them are pure, so the UI can decide what to enable without a
// round trip.
//
// Everything here was checked against live 3.6.2 and 3.7.5 stones — see the
// comments on `canCommit` and `canBegin`, which record where the observed
// behaviour differs from the obvious reading of the documentation.
//
// `getTransactionMode`, `isInTransaction` and `getGemAutoServiceSigAbort` have no
// caller in the extension — `getTransactionState` answers for both halves in one
// round trip. They are the single-fact probes the live-stone suite asks its
// questions with, and are kept for that.
import { QueryExecutor } from './types';

/**
 * The three modes a session can be in, as `System transactionMode` answers them.
 *
 * - `autoBegin` — a new transaction starts automatically after every commit or
 *   abort, so the session is always inside one. GemStone's default, and what
 *   Jasper did unconditionally before this existed. The cost is that an idle
 *   session holds a commit record open, which holds back the repository's reclaim.
 * - `manualBegin` — commit and abort leave the session *outside* a transaction;
 *   it takes an explicit begin to get back in. While outside, the stone sends a
 *   SigAbort when it wants its commit record back — see {@link setGemAutoServiceSigAbort}.
 * - `transactionless` — the session is never inside a transaction at all, where a
 *   `manualBegin` one can be, and the gem services any SigAbort itself with no
 *   client-side help. The cheapest mode for the repository, but its view can move
 *   at any moment, so what it shows may change under the reader: meant for a
 *   session left idle, not for reading something that needs to stay still.
 */
export const TRANSACTION_MODES = ['autoBegin', 'manualBegin', 'transactionless'] as const;

export type TransactionMode = (typeof TRANSACTION_MODES)[number];

/** GemStone raises this when a primitive that requires a transaction runs outside one. */
export const ERR_NOT_IN_TRANSACTION = 2030;

/**
 * `ABORT_ERR_GemAutoAbort` — reported on the first GCI call after the gem
 * serviced a SigAbort on the session's behalf (see {@link setGemAutoServiceSigAbort}).
 * It is not a failure: it says "your view moved", and the call that reports it
 * did not run. Its sibling `ABORT_ERR_GemAutoLostOt` (3008) says the same thing
 * about a LostOt.
 */
export const ERR_GEM_AUTO_ABORT = 3007;
export const ERR_GEM_AUTO_LOST_OT = 3008;

/** `printString` of a Boolean, or `undefined` for anything else. */
function parseBoolean(text: string): boolean | undefined {
  return text === 'true' ? true : text === 'false' ? false : undefined;
}

/** Whether `value` is one of the three modes GemStone recognizes. */
export function isTransactionMode(value: string): value is TransactionMode {
  return (TRANSACTION_MODES as readonly string[]).includes(value);
}

/**
 * The session's current mode, or `undefined` when the stone answered something
 * this doesn't recognize.
 *
 * `asString` rather than `printString`: the latter answers `#'autoBegin'`, quotes
 * and all, which would have to be unwrapped here for no gain.
 */
export function getTransactionMode(execute: QueryExecutor): TransactionMode | undefined {
  const answer = execute('System transactionMode asString').trim();
  return isTransactionMode(answer) ? answer : undefined;
}

/**
 * Put the session into `mode`. **This aborts the current transaction** — every
 * uncommitted change in it is discarded — so callers must have said so and had
 * the user agree first.
 *
 * Answers the mode the stone reports afterwards rather than the one asked for,
 * so a caller never caches a mode the switch did not actually reach.
 */
export function setTransactionMode(
  execute: QueryExecutor,
  mode: TransactionMode,
): TransactionMode | undefined {
  const answer = execute(
    `System transactionMode: #${mode}. System transactionMode asString`,
  ).trim();
  return isTransactionMode(answer) ? answer : undefined;
}

/**
 * Whether the session is inside a transaction right now, or `undefined` when the
 * stone answered something unrecognized.
 *
 * This — not the mode — is what decides whether a commit can succeed, so it is
 * read alongside the mode everywhere the mode is read.
 */
export function isInTransaction(execute: QueryExecutor): boolean | undefined {
  return parseBoolean(execute('System inTransaction printString').trim());
}

/** Read the mode and the in-transaction flag together, in one round trip. */
export function getTransactionState(execute: QueryExecutor): {
  mode: TransactionMode | undefined;
  inTransaction: boolean | undefined;
} {
  const answer = execute(
    "System transactionMode asString, ' ', System inTransaction printString",
  ).trim();
  const [modeText = '', inTransactionText = ''] = answer.split(/\s+/);
  return {
    mode: isTransactionMode(modeText) ? modeText : undefined,
    inTransaction: parseBoolean(inTransactionText),
  };
}

/**
 * Arm (or disarm) the gem's own SigAbort servicing.
 *
 * With it on and the mode `manualBegin`, the gem answers any SigAbort itself
 * while it sits idle waiting for the next GCI command, and reports
 * {@link ERR_GEM_AUTO_ABORT} on the following call to say the view moved. Without
 * it, a session sitting outside a transaction that does not answer within
 * `STN_GEM_ABORT_TIMEOUT` (60 s by default) is forcibly aborted by the stone —
 * error 3031, every object cache reinitialized.
 *
 * Under `transactionless` the gem does this unconditionally, whatever this is
 * set to, so arming it there changes nothing and costs nothing.
 *
 * The option applies only where `System clientIsRemote` is true. Jasper logs in
 * through a netldi `gemnetobject` task, which qualifies (verified on 3.6.2 and
 * 3.7.5), so this is Jasper's whole SigAbort story — no polling thread needed.
 */
export function setGemAutoServiceSigAbort(execute: QueryExecutor, enabled: boolean): void {
  execute(
    `System gemConfigurationAt: #GemAutoServiceSigAbort put: ${enabled}. 'GemAutoServiceSigAbort set'`,
  );
}

/** Whether the gem is currently servicing SigAborts on the session's behalf. */
export function getGemAutoServiceSigAbort(execute: QueryExecutor): boolean | undefined {
  return parseBoolean(
    execute('(System gemConfigurationAt: #GemAutoServiceSigAbort) printString').trim(),
  );
}

/**
 * Smalltalk that refreshes the session's view by aborting, but only when the
 * abort would discard nothing the user would miss.
 *
 * Jasper's background refreshes (the MCP tools, mostly) abort to pull in commits
 * landed by other processes, because the GCI pins a session's read view until it
 * aborts or commits. Two things make an abort unsafe:
 *
 *  - uncommitted changes — it would discard them; and
 *  - being inside a `manualBegin` transaction — the abort would end a transaction
 *    the user explicitly began, and under manualBegin nothing starts another one.
 *
 * Under `autoBegin` the second case cannot bite: the abort immediately opens a
 * fresh transaction. Under `transactionless` there is nothing to end.
 *
 * Answers `'refreshed'` or `'skipped: …'` so the caller can report which happened.
 */
export const VIEW_REFRESH_CODE = `(System needsCommit
  or: [System transactionMode == #manualBegin and: [System inTransaction]])
    ifTrue: [System needsCommit
      ifTrue: ['skipped: uncommitted changes present']
      ifFalse: ['skipped: session is inside a manual transaction']]
    ifFalse: [System abortTransaction. 'refreshed']`;

// ── Pure enablement rules ────────────────────────────────────────────────────
//
// Jadeite for Dolphin states these in terms of the mode (`JadePresenter class >>
// isCommitEnabled` and friends). Stated in terms of `inTransaction` they come out
// shorter and, on two live stones, strictly more accurate — see each one.

/**
 * Whether Commit can succeed.
 *
 * Exactly `inTransaction`: outside a transaction GemStone raises
 * {@link ERR_NOT_IN_TRANSACTION} from `commitTransaction` in every mode, and
 * inside one the commit is attempted in every mode. Under `autoBegin` the session
 * is always inside a transaction, so this is always true there — which is where
 * it agrees with Jadeite's `autoBegin or: [manualBegin and: [inTransaction]]`.
 *
 * Where it deliberately disagrees: a `transactionless` session that has been put
 * inside a transaction by an explicit begin *can* commit (verified on 3.6.2 and
 * 3.7.5 — the write lands and survives), and Jadeite's rule would refuse to let
 * the user commit work the stone would have accepted.
 *
 * An unknown transaction state (`undefined` — the probe failed, or the stone
 * answered something unrecognized) leaves Commit enabled: a failed probe is not
 * evidence that a commit would fail, and taking a working button away on no
 * evidence is worse than letting the stone say no.
 *
 * What this does NOT answer is whether the session holds uncommitted work. A
 * session outside a transaction can still have written — GemStone allows the
 * write and `System needsCommit` reports it; only `commitTransaction` raises
 * {@link ERR_NOT_IN_TRANSACTION}. `needsCommit` stays the question to ask before
 * discarding anything.
 */
export function canCommit(inTransaction: boolean | undefined): boolean {
  return inTransaction !== false;
}

/**
 * Whether Begin Transaction is worth offering.
 *
 * `manualBegin` and outside a transaction — Jadeite's rule, kept as-is.
 * `autoBegin` never qualifies because the session is never outside a transaction.
 *
 * `transactionless` is excluded deliberately rather than incidentally: a begin
 * there does work (it really does enter a transaction), but the mode exists to
 * cost the repository nothing, and a transaction entered under it pins a commit
 * record the gem has already been told to give back on demand. A user who wants
 * to write should switch to `manualBegin`, which is one click away.
 */
export function canBegin(
  mode: TransactionMode | undefined,
  inTransaction: boolean | undefined,
): boolean {
  return mode === 'manualBegin' && inTransaction === false;
}

// ── Display ──────────────────────────────────────────────────────────────────

/** The mode under the name GemStone's own documentation uses. */
export function modeLabel(mode: TransactionMode | undefined): string {
  switch (mode) {
    case 'autoBegin':
      return 'Auto-Begin';
    case 'manualBegin':
      return 'Manual';
    case 'transactionless':
      return 'Transactionless';
    default:
      return 'Unknown';
  }
}

/**
 * One line of transaction state, for a status bar or a tree row.
 *
 * The in-transaction half is spelled out only under `manualBegin`, where it
 * genuinely varies. Under `autoBegin` the session is always in a transaction and
 * under `transactionless` it is normally not, so repeating it there would be
 * three words that never change.
 */
export function transactionStateLabel(
  mode: TransactionMode | undefined,
  inTransaction: boolean | undefined,
): string {
  if (mode === 'manualBegin') {
    if (inTransaction === true) return 'Manual · in transaction';
    if (inTransaction === false) return 'Manual · not in transaction';
    return 'Manual';
  }
  // A transactionless session that has been walked into a transaction is a state
  // worth naming: it is not what the mode implies, and it changes what Commit does.
  if (mode === 'transactionless' && inTransaction === true) {
    return 'Transactionless · in transaction';
  }
  return modeLabel(mode);
}

/** A sentence explaining what the current mode means, for a tooltip. */
export function modeDescription(mode: TransactionMode | undefined): string {
  switch (mode) {
    case 'autoBegin':
      return 'A new transaction starts automatically after every commit or abort, so this session is always inside one. Convenient, but an idle session holds a commit record open and holds back the repository’s reclaim.';
    case 'manualBegin':
      return 'Commit and abort leave this session outside a transaction; Begin Transaction puts it back in. Nothing can be committed while it is outside one.';
    case 'transactionless':
      return 'This session is not in a transaction and cannot commit until one is begun by hand. The cheapest mode for the repository — but its view can move at any moment, so what you are looking at may change under you. Good for a session left idle; not for reading something you need to stay still.';
    default:
      return 'This session’s transaction mode could not be read from the stone.';
  }
}
