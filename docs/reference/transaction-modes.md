# Transaction modes

GemStone gives every session one of three transaction modes. The mode decides
whether the session is inside a transaction, and therefore what Commit, Abort and
Begin Transaction do — so Jasper reads it, shows it, and lets you change it.

Everything below was verified against live **3.6.2** and **3.7.5** stones. Where
that disagrees with the obvious reading of the manuals, this document records what
the stone actually does, and `client/src/queries/__tests__/transactionMode.integration.test.ts`
pins it so a future release cannot change it quietly.

## The three modes

| Mode | After commit / abort | While the session sits idle |
| --- | --- | --- |
| `autoBegin` | A new transaction starts automatically, so the session is always inside one. | It holds a commit record open, which holds back the repository's reclaim. GemStone's default, and what Jasper did unconditionally before this existed. |
| `manualBegin` | The session is left **outside** a transaction. Begin Transaction puts it back in. | The stone sends a SigAbort. A gem that does not answer within `STN_GEM_ABORT_TIMEOUT` (60 s by default) is forcibly aborted — error 3031, every object cache reinitialized. Jasper arms the gem to answer for itself; see below. |
| `transactionless` | Never in a transaction. | The gem services any SigAbort itself, unconditionally. The cheapest mode for the repository — and the only one whose snapshot view is updated *automatically, at any time*, so the data it shows can be inconsistent. The manual intends it for idle sessions; treat "good for browsing" with care. |

The mode a session lands in at login is the stone's `STN_GEM_INITIAL_TRANSACTION_MODE`,
which accepts all three values — so Jasper reads the mode from the server at login
rather than assuming `autoBegin`, as every prior GemStone IDE does.

## What decides whether Commit works

`System commitTransaction` raises **2030** (`ImproperOperation`, "not inside of a
transaction") exactly when the session is outside a transaction — in every mode.
So Jasper's rule is `System inTransaction`, not the mode:

```ts
canCommit(inTransaction)          // inTransaction !== false
canBegin(mode, inTransaction)     // mode === 'manualBegin' && inTransaction === false
// Abort is always available, in every mode.
```

**What 2030 does *not* mean is that nothing was written.** GemStone lets a session
outside a transaction modify objects exactly as it would inside one — it refuses
only the commit (the Programming Guide says so under "Reading and Writing Outside
of Transactions", and `System needsCommit` duly answers `true`). So `canCommit` is
the wrong question to ask before discarding anything; `System needsCommit` is the
right one, and Jasper asks it before every abort, mode switch and logout. A
`manualBegin` session that has written outside a transaction is warned at logout
like any other — only the dialog's **Commit & Logout** button is dropped, because
that is the one thing that could only fail.

Under `autoBegin` the session is always inside a transaction, so `canCommit` is
always true there — which is where this agrees with Jadeite for Dolphin's
mode-shaped rule (`autoBegin or: [manualBegin and: [inTransaction]]`).

**Where it deliberately disagrees:** under `transactionless`, an explicit
`System beginTransaction` really does enter a transaction, and a commit from
inside it is accepted and lands. The mode's name and the manual both suggest
otherwise; both stones say it works. Jadeite's rule would refuse to let the user
commit work the stone would have taken, so Jasper's rule follows the session's
state rather than its mode.

Begin is still **not offered** under `transactionless`, and that is a product
decision rather than a technical one: the mode exists to pin no commit record, and
a transaction opened under it pins one the gem has already been told to give back
on demand. Switching to `manualBegin` first is one click away.

An unknown transaction state — the probe failed, or the stone answered something
unrecognized — leaves Commit enabled and Begin hidden. A failed probe is not
evidence that a commit would fail, and taking a working button away on no evidence
is worse than letting the stone say no.

## Surviving SigAbort

A session sitting outside a transaction pins a commit record the stone wants back.
Jadeite for Dolphin answers with a background process that aborts on a 10-second
timer. Jasper does not need one: `GemAutoServiceSigAbort` is a runtime gem
configuration option that makes the gem service the signal itself whenever it is
idle waiting for the next GCI command.

Jasper arms it the moment it sees a session **in** `manualBegin` — not only when
the user switches modes from inside Jasper. A stone whose
`STN_GEM_INITIAL_TRANSACTION_MODE` is `manualBegin` hands the session out in that
mode at login, outside a transaction from its first moment, and another tool
sharing the session can move it there behind Jasper's back; both are covered
because the arming hangs off the state *read*, not off the mode *switch*:

```smalltalk
System gemConfigurationAt: #GemAutoServiceSigAbort put: true
```

It is never disarmed. GemStone raises the auto-service errors only in
`manualBegin`, and an `autoBegin` session is never outside a transaction for the
stone to signal, so leaving it armed after a switch back is inert.

The next GCI call then reports **3007** (`ABORT_ERR_GemAutoAbort`), or **3008**
(`ABORT_ERR_GemAutoLostOt`) for a LostOt. Neither is a failure: the call did not
run, and the session's view moved forward to the newest committed state.
`explainGciError` in `client/src/gciLibraryError.ts` rewords both so they read
that way rather than as "a TransactionBacklog occurred" — and says plainly that
what the gem serviced was an abort, so any writes the session was holding went
with it. The same function names **Begin Transaction** when the stone raises 2030,
which is the failure a `manualBegin` session meets on its first save.

The one caveat is that the option applies only where `System clientIsRemote` is
true. Jasper logs in through a netldi `gemnetobject` task, which qualifies — the
integration suite asserts this, because a linked login would not, and that is the
case that would need the `GciTsWaitForEvent` thread this design avoids.

`DelayAutoServiceSigAbort` exists to make 3007 delivery testable, but it only
*delays* the delivery of a signal the stone still has to send — which takes a
commit-record backlog, hundreds of commits from a second session, and a stone
config this suite does not control. That end-to-end test is deliberately not in
the default suite; what is covered is that the option arms, that the session is a
remote client, and that 3007/3008 are classified as a refreshed view.

## A commit the stone refuses

A commit can fail two ways, and GemStone reports them differently. GemBuilder for
C's own `GciCommit` example draws the line:

```c
if ( ! GciCommit()) {
  if (GciErr(&errInfo)) { /* an error */ } else { /* a concurrency conflict */ }
}
```

No error number means the commit was **refused** — another session committed over
an object this transaction touched. `GciTsCommit` is the same call ("implemented
in client library as message send", `gcits.hf`), so `isCommitConflict` in
`client/src/commitFailure.ts` reads it the same way: `err.number` of 0, or an
out-struct the GCI never filled in, is a refusal.

That distinction is the whole reason the wording differs. A refusal is not a
malfunction, and repeating it cannot work — "You must abort the transaction in
order to get a new snapshot view of the repository and, along with it, an empty
read set and an empty write set" (Programming Guide §9.2) — so every refusal
carries that advice.

`System transactionConflicts` says what collided: `#commitResult` plus one
Association per kind of conflict, each value an Array of the objects
(Table 9.1 — `Write-Write`, `Write-Dependency`, `Write-ReadLock`, `Rc-Write-Write`
and the rest). `client/src/queries/transactionConflicts.ts` reads it. Three
constraints shape that query:

- **Read it before anything else touches the transaction.** "Conflict sets are
  cleared at the beginning of a commit or abort and thus can be examined until the
  next commit, continue, or abort."
- **Send the conflicting objects nothing but `asOop` and `class name`.**
  `printString` would run application code inside the doit, on the objects two
  sessions are fighting over.
- **Drop the reference before answering.** "If you save a reference to the
  conflict set, be sure to clear this reference to avoid making the conflict set
  persistent."

Only the first `CONFLICT_OBJECT_LIMIT` objects per kind come back; a conflict on
an indexed collection can name thousands, and the stone's own count is reported
either way.

A genuine refusal cannot be reproduced in the integration suite: it needs a second
session to really commit, and the harness arms GemStone's commit guard on every
session it opens. What the live suite does cover is that the doit compiles and
parses on each stone in the matrix, and that a *guarded* commit — which leaves
error 2249 — is classified as an error rather than a conflict.

## Refreshing a view without losing anything

GemStone's GCI pins a session's read view until it aborts or commits, so a commit
landed by another process is invisible until this session does one. Jasper's
background reads (the MCP tools) abort to pull those in — but only when the abort
would discard nothing. `VIEW_REFRESH_CODE` in `client/src/queries/transactionMode.ts`
is the single piece of Smalltalk that decides, and it stands down twice:

- the session holds uncommitted changes — the abort would discard them;
- the session is inside a `manualBegin` transaction — the abort would end a
  transaction the user opened by hand, and under `manualBegin` nothing would start
  another one.

Under `autoBegin` the second case cannot bite, because the abort immediately opens
the next transaction. Under `transactionless` there is nothing to end.

## Where it shows up in Jasper

- **Status bar** (left) — the selected session's state, with a filled circle when
  a commit can land, a hollow one when it cannot, and an eye for `transactionless`.
  Clicking it changes the mode.
- **Logins & Sessions** — each session row says its mode beside its number, and its
  hover explains what the mode means and what the session can do right now.
- **Databases & Versions** — the same string on the same sessions, so the two
  surfaces cannot describe one session differently.
- **Begin Transaction** and **Commit** appear only on a session that can use them.
  That is decided per row (in the row's `contextValue`) rather than by a context
  key, so in multiple-session mode each row answers for itself.
- Switching modes **aborts** — GemStone does that as part of switching and there is
  no way to ask it not to — so the confirmation says so, names how much is at
  stake, and on confirm runs the same refresh cascade an abort runs.
- **A refused Commit names what collided** — `Commit refused — Write-Write on 2
  objects. Abort for a fresh view, then try again.` — with **Show Conflicts** on
  the toast, which writes every conflicting object's OOP and class to the
  **GemStone GCI** output channel. The MCP `commit` tool answers with the same
  wording and the same list, through the same shared query.
- **Claude's tools count too.** The in-window MCP `commit`, `abort` and
  `execute_code` tools move the same session the rows are drawn from, so they tell
  `SessionManager` to re-read the state afterwards. Without that, a commit from
  Claude leaves a `manualBegin` row offering the one button that now raises 2030.
