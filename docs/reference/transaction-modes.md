# Transaction modes

GemStone gives every session one of three transaction modes. The mode decides
whether the session is inside a transaction, and therefore what Commit, Abort and
Begin Transaction do — so Jasper reads it, shows it, and lets you change it.

The mode and commit-enablement behaviour below was verified against live **3.6.2**
and **3.7.5** stones. Where that disagrees with the obvious reading of the manuals,
this document records what the stone actually does, and
`client/src/queries/__tests__/transactionMode.integration.test.ts` pins the mode
and commit-enablement behaviour so a future release cannot change it quietly.

## The three modes

| Mode | After commit / abort | While the session sits idle |
| --- | --- | --- |
| `autoBegin` | A new transaction starts automatically, so the session is always inside one. | It holds a commit record open, which holds back the repository's reclaim. GemStone's default, and what Jasper did unconditionally before this existed. |
| `manualBegin` | The session is left **outside** a transaction. Begin Transaction puts it back in. | The stone sends a SigAbort, and a gem that does not answer is forcibly aborted. Jasper arms the gem to answer for itself; see below. |
| `transactionless` | Outside a transaction, and nothing starts one. | The gem services any SigAbort itself, unconditionally. The cheapest mode for the repository — and the only one whose snapshot view is updated *automatically, at any time*, so the data it shows can be inconsistent. The manual intends it for idle sessions; treat "good for browsing" with care. |

The mode a session lands in at login is the stone's `STN_GEM_INITIAL_TRANSACTION_MODE`,
which accepts all three values — so Jasper reads the mode from the server at login
rather than assuming `autoBegin`, which every prior GemStone IDE does.

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
of Transactions", and `System needsCommit` duly answers `true`). So Jasper asks
`System needsCommit`, not `canCommit`, before every abort, mode switch and logout.

The one place the rule departs from Jadeite for Dolphin's mode-shaped one is
`transactionless`: an explicit `System beginTransaction` there really does enter a
transaction, and a commit from inside it lands — the mode's name and the manual
both suggest otherwise. Why Commit follows the state, why Begin is still not
offered in that mode, and why an unreadable state leaves Commit enabled are the
doc-comments on `canCommit` and `canBegin` in `client/src/queries/transactionMode.ts`.

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
stone to signal, so leaving it armed after a switch back is inert. What happens
without it, and the `System clientIsRemote` condition it depends on, are
`setGemAutoServiceSigAbort`'s doc-comment.

The next GCI call then reports **3007** (`ABORT_ERR_GemAutoAbort`), or **3008**
(`ABORT_ERR_GemAutoLostOt`) for a LostOt. Neither is a failure: the call did not
run, and the session's view moved forward to the newest committed state.
`explainGciError` in `client/src/gciLibraryError.ts` rewords both so they read
that way rather than as "a TransactionBacklog occurred" — and says plainly that
what the gem serviced was an abort, so any writes the session was holding went
with it. The same function names the way back in when the stone raises 2030.

## A commit the stone refuses

A commit can fail two ways, and GemStone reports them differently: an error, or a
**refusal** — another session committed over an object this transaction touched.
A refusal is not a malfunction, and repeating it cannot work — "You must abort the
transaction in order to get a new snapshot view of the repository" (Programming
Guide §9.2) — so Jasper words it as a refusal and every one carries that advice.

GemBuilder for C documents the older `GciCommit` as answering false with **no
error set**. `GciTsCommit` — the call Jasper actually makes — does not. Against a
live 3.7.5 stone with two sessions colliding on one `UserGlobals` entry, a
refusal arrives as:

```
number  2738   (ERR_TransactionError, vendor/gci-headers/*/gcierr.ht)
reason  commitConflicts
message a TransactionError occurred (error 2738), reason:commitConflicts, commit conflicts
```

Both shapes count as refusals. How they are told apart from an error — the
reason is matched, never the number — is the header of `client/src/commitFailure.ts`.

`System transactionConflicts` says what collided: `#commitResult` plus one
Association per kind of conflict (Table 9.1 — `Write-Write`, `Write-Dependency`,
`Write-ReadLock`, `Rc-Write-Write` and the rest), each naming the objects. The
refused-commit toast names the kinds; **Show Conflicts** puts each object's oop,
class and abbreviated `printString` in the output channel, with an
`Object _objectForOop:` line to paste into a workspace. The rules the query that
reads it has to follow — when it must run, how each `printString` is guarded, why
it drops its own reference — are in `client/src/queries/transactionConflicts.ts`.

## Refreshing a view without losing anything

GemStone's GCI pins a session's read view until it aborts or commits, so a commit
landed by another process is invisible until this session does one. Jasper's
background reads (the MCP tools) abort to pull those in — but only when the abort
would discard nothing: not while the session holds uncommitted changes, and not
while it is inside a transaction someone began by hand. `VIEW_REFRESH_CODE` in
`client/src/queries/transactionMode.ts` is the one piece of Smalltalk that decides.

## Where it shows up in Jasper

The user-facing side — status bar, session rows, the mode switch, the refused-commit
toast — is described in [the README](../../README.md#transaction-modes). Two pieces of
mechanism belong here rather than there:

- **Begin Transaction** and **Commit** appear only on a session that can use them.
  That is decided per row (in the row's `contextValue`) rather than by a context
  key, so in multiple-session mode each row answers for itself.
- **Claude's tools count too.** The in-window MCP `commit`, `abort` and
  `execute_code` tools move the same session the rows are drawn from, so they tell
  `SessionManager` to re-read the state afterwards. Without that, a commit from
  Claude leaves a `manualBegin` row offering the one button that now raises 2030.
