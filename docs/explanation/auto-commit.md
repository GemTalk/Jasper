# Auto-commit: why it fires where it does, and what it does to Undo and Abort

Background for [#254](https://github.com/GemTalk/Jasper/issues/254). Worth reading before adding a
hook, moving one, or writing an operation that recovers by aborting.

The feature itself is small — commit after a change — and almost all of the design is in the two
questions that follow from it: **what does "after a change" actually mean**, and **what does a
committed change do to the ways back out**.

## The state is per session, and lives in a module

A transaction belongs to a session, so "commit everything I do" can only mean "commit everything
*this* session does". Two sessions against the same stone can sensibly want different answers — one
driving a long refactoring it means to abort as a unit, one poking at objects it wants persisted —
and a window-wide switch could not give them one. `gemstone.autoCommit.enableForNewSessions` seeds
what a *new* session starts at and nothing more.

The state lives in a module (`client/src/autoCommit/autoCommitState.ts`) rather than a service
threaded through constructors, for the same reason the undo stack does: the write path that has to
consult it is `browserQueries`, a module of free functions taking a session, with nowhere to hang an
injected object. That module and the runner beside it are deliberately free of `vscode` — the write
path calls into them on every mutation, and pulling the workbench into `browserQueries` would break
the tests that mock almost none of it. Telling the user about a failure is therefore a *registered*
handler, installed by the extension at activation.

## Where it fires — and the one place it deliberately does not

These hooks, chosen to be the places an operation *finishes*:

| Hook | Covers |
| --- | --- |
| the `writing` wrapper in `browserQueries`' write-path section | method compiles, class edits, comments, categories, dictionary edits — everything the Explorer, the browsers, the editors and the MCP tools reach the stone through |
| `codeExecutor` after a completed execution | Do It, Display It, Inspect It |
| `smalltalkNotebookController` / MCP `execute_code` | a doit by another route, unless it raised (its error comes back as an answer, not a throw); a cell that stopped in the debugger commits as the Debugger row says |
| the GemStone Debugger | a run that halted and was then resumed or stepped to the end, together with everything done while it was halted (see *Holds* below) |
| the basic Inspector | an expression in its evaluation pane; a slot edited or reverted |
| `notifyRefactoringApplied` | all fifteen refactorings |
| `undoRefactoringCommand` | an undo of a refactoring, when it reversed every change |
| `runWithAutoCommitDeferred` closing | a file-in (`.gs` or Tonel `.st`), an editor save, adding a class variable with its accessors, each undo reverser's writes, and the Explorer's multi-row actions — removing a class subtree or several methods, a drag that moves or copies several methods, a drag that refiles several classes |

Writes made through a raw query executor rather than `browserQueries` never pass through `writing`,
so they never say they wrote. The undo reversers are the case in point; they run their writes in
`runRawWritesWithAutoCommit`, which treats the region as owing a commit whenever its writes return.

**Not** at the GCI round trip, which is what "commit every time you go to the server" would literally
mean. Jasper reads the stone constantly — every tree expansion, every completion, every hover — and a
commit behind each of those would double the round trips on a session that had changed nothing. The
write-path section already exists and already draws the line between a read and a write, so that is
where the hook goes.

**Not** at the refactoring engine's apply, and this is the load-bearing exclusion. A refactoring can
stop at its first failure and strand a partly-reshaped class, and the panels recover from that by
offering to **abort the transaction**. A commit landing inside the apply silently disarms that
button: the abort then rewinds to a repository that already holds the wreckage. So the commit waits
for `notifyRefactoringApplied`, which runs after the apply has landed and the panel has closed — the
abort window shut — and which is the one point every refactoring passes through.

**Not** when a breakpoint is set, cleared, enabled or disabled. A breakpoint is per-gem state that a
commit does not persist, so the only thing a commit there could do is commit the user's *other*
pending work, at a moment they chose only to set a breakpoint.

## Deferral: the operations that are only correct as a whole

`runWithAutoCommitDeferred` (and its synchronous twin) holds commits back across an operation, then
commits once. Three properties matter:

- **It commits once, not per write.** A file-in of forty methods is one change, not forty.
- **A failure commits nothing.** The caller's own rollback — an abort, a retry — is left the
  transaction it expects. An operation that reports its errors rather than throwing passes the
  region a test of its answer: a file-in with any error, or a pick cancelled part-way, commits
  nothing, and so does an undo or a multi-row action where any one write failed. When part of it
  landed, its notice says so, and that the next change would commit it.
- **While commits are held, notices say "not committed".** A change made under a halted debugger
  is not committed yet, so `commitStateNote` answers the not-committed wording whenever the session
  is paused, not only when auto-commit is off.
- **It nests.** An inner region borrows the outer one's commit, so a file-in that reaches
  `fileInClass` through `fileInFile` still commits once. An inner region that fails is
  remembered: the outer one then commits nothing either, so a debugger Terminated under another
  halted one is not committed when the second run finishes.

The rule for a new caller: **if the operation has an all-or-nothing contract, recovers by aborting,
or is one user gesture that writes several times, it runs deferred.** The third case has a ready-made
answer to "which writes belong together": the undo recording already groups them, and a drag that
records one undo entry is a drag that should make one commit. If it is one change that either lands
or does not, it does not need to.

**Wrap the writes, never a panel.** Suspension is per session, so a region open across a webview
holds back every save the user makes while it is up, and loses them if the operation then fails.
So an undo defers only its reverser's writes, after the plan panel has been answered; a file-in
asks every Tonel dictionary question before its region opens; and a drag that moves methods to
another class opens no region at all, since each of its preview panels is its own approved apply.

## Holds: the two places commits wait on purpose

`holdAutoCommit` is the one deliberate exception to that rule, for a state where *any* commit would
persist half-done work, whoever asked for it:

- **A debugger holding a halted run.** The run's work so far is in the transaction, so an expression
  evaluated in a frame, a variable edit, or a save in another editor commits nothing while it is
  halted. When the run finishes, one commit takes all of it; Terminate commits none of it and says
  the next change would.
- **An instance-variable refactoring whose apply failed.** From the failure until its panel closes,
  nothing commits, so the panel's **Abort** still has the partial reshape to take back. If you
  saved anything while the panel was up, the Abort asks first, since it discards that too. After
  an abort, commits resume; closed without one, nothing is committed and the notice says so.

## What a commit does to Undo (nothing) and to Abort (everything)

This is the question worth being sure about, and the answer falls out of how Jasper's undo already
works. **Undo is a forward operation**: it reverses a change by making the opposite one — recompiling
the earlier source, renaming back, binding an earlier class version — not by rolling the transaction
back. Nothing in the undo stack depends on the change being uncommitted, so a committed change is
exactly as undoable as one that is not. Each reverser defers its own writes, so a reversal touching
several methods commits once, and one that lands only in part commits nothing; that is the only
thing auto-commit changes about it.

**Abort is a different story, and it is the whole reason this feature needs a visible state.**
With auto-commit on, Abort no longer takes a change back — the change is in the repository. That is
not a defect to be fixed, it is what the user asked for; but a user who does not know the state is on
will reach for Abort and find nothing to abort. Hence:

- **the session's own row in the Logins view**, which says the state in words — `· auto-commit ON`,
  `· auto-commit off`, `· auto-commit FAILED`;
- **a red `!` badge at the row's right edge when a commit has failed**, and nothing in the other two
  states. Failure is the state the user must not miss, and the badge survives a narrow sidebar: the
  description is the first thing VS Code truncates, and a login label like
  `DataCurator on gs64stone_375 (localhost)` fills the row on its own at any ordinary width. The
  row's icon is never coloured — it says which session is selected, and a tinted triangle read as
  noise;
- **a button on the row** whose icon is the state — `$(sync-ignored)` off, `$(sync)` on, `$(error)`
  failed — whose click is the switch, or on a failed row opens the ways to resolve it;
- **the same words and button on the session row in the Databases panel**, the words coloured amber
  on and red failed, which mirrors the
  tree's session actions on purpose: a session is a session, and someone who found this in one place
  should not have to wonder whether the other place can do it;
- a tooltip on that row, its auto-commit sentence amber on and red failed, and a turn-on notice, that
  both say Abort will not take a change back;
- a prompt before arming over a transaction that already holds uncommitted work, because the next
  change would commit all of it.

**The row, and not the status bar.** A status-bar item can only ever speak for one session, and this
is a per-session feature: the state belongs to a transaction, two sessions can hold different
answers, and the display has to be able to show both at once. Putting it on the row also puts the
switch where the state is, so reading it and changing it are one gesture apart.

**Why the button costs three commands.** A contributed menu entry's icon is fixed text in the
manifest, so one command could offer the click but could never show the state.
`gemstone.autoCommit.turnOn` / `turnOff` / `recover` differ only in icon and title; each is gated on
one state in the row's `contextValue` (`gemstoneSession`, `gemstoneSessionAutoCommitOn`,
`gemstoneSessionAutoCommitFailed`, written by `sessionContextValue`), so exactly one is ever on the
row and they all land in the same handler. It is the bargain the `undoLast`/`revertLast` pair
already strikes. Note the consequence for every OTHER entry on that row: they match the family with
the prefix `=~ /^gemstoneSession/` rather than one value with `==`, and a new entry that uses `==`
will silently vanish whenever auto-commit is on.

The Databases panel needs **one** id for the same button, because it is a webview and picks its own
glyph when it draws the row — so it uses the state-reading `gemstone.autoCommit.toggle`. Two things
that panel does need: the status on the wire in `SessionInfo` (the button's icon IS the state, and a
row that had to ask afterwards would flash the wrong glyph on every repaint), and
`gemstone.autoCommit.toggle` on its `SESSION_COMMANDS` allow-list, without which the button would
draw and silently do nothing. It also redraws on `onAutoCommitChanged`, since toggling auto-commit
changes no session and no process and fires none of the events the panel already watches.

That is also why the row speaks in **both** directions rather than only when armed. As one display
among several, silence for "off" was fine; as the only one, it is not — a row that says nothing does
not read as "off", it reads as a row that has not been told.

Note the places Abort is still exactly what it was: inside a deferred region, and under a hold. A
halted debugger, and an instance-variable panel offering Abort after a failed apply, have had
nothing committed under them.

## The `failed` state, and why it is not just `off`

A commit that fails is nearly always a conflict with another session, and the next write would hit
the same conflict. Retrying per keystroke would fail every time and bury the message, so auto-commit
stops — but it does **not** fall back to `off`, which would say the user turned it off. `failed` is a
third state: armed, and not committing. The row gets its red `!` badge, and the prompt offers the three
things that are actually useful — abort, read the conflict report, or turn it off. The row's error
button brings that prompt back; **Toggle Auto-Commit** (palette or right-click) simply turns it off,
as its name says, and its notice warns that the transaction still conflicts until it is aborted. A manual commit or
abort that lands settles the transaction, as do the instance-variable panel's Abort, Claude's
`commit` and `abort` tools, a Begin, and a transaction-mode switch that replaced the session's
view; auto-commit then resumes on its own.

Jadeite draws the same three-state distinction, with the same abort-or-see-the-conflicts choice, and
for the same reasons; the vocabulary here is deliberately close to it.

## It needs Auto-Begin

Auto-commit only works in Auto-Begin, GemStone's default transaction mode, where a commit starts
the next transaction at once. In Manual and Transactionless, checked on 3.6.2 and 3.7.5:

- a commit leaves the session **outside** a transaction;
- outside one, a change still lands, but a commit is refused with error 2030;
- a Begin **throws that change away** (pinned in `transactionMode.integration.test.ts`).

So in either mode auto-commit would strand every change after at most one commit. Beginning a new
transaction after each commit would only turn Manual into Auto-Begin behind the user's back, which
defeats the reason they chose it. Instead:

- turning auto-commit on outside Auto-Begin is refused, with a button that switches the mode to
  Auto-Begin (the switch still asks before its abort) and then turns auto-commit on;
- a session that leaves Auto-Begin (the mode switch, or code that sets the mode) has auto-commit
  turned off, and the switch's confirmation says so first;
- a new session that logs in outside Auto-Begin starts off, whatever the default says, and its
  row's tooltip explains why;
- should a commit still be refused with 2030, auto-commit turns off and says the session is not in
  a transaction, rather than going to `failed` and blaming a conflict.
