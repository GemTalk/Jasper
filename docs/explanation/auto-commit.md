# Auto-commit: why it fires where it does, and what it does to Undo and Abort

Background for [#254](https://github.com/GemTalk/Jasper/issues/254). Worth reading before adding a
hook, moving one, or writing an operation that recovers by aborting.

The feature itself is small — commit after a change — and almost all of the design is in the two
questions that follow from it: **where does "after a change" actually mean**, and **what does a
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

Five hooks, chosen to be the places an operation *finishes*:

| Hook | Covers |
| --- | --- |
| the `writing` wrapper in `browserQueries`' write-path section | method compiles, class edits, comments, categories, dictionary edits, breakpoints — everything the Explorer, the browsers, the editors and the MCP tools reach the stone through |
| `codeExecutor` after a completed execution | Do It, Display It, Inspect It |
| `smalltalkNotebookController` / MCP `execute_code` | a doit by another route |
| `notifyRefactoringApplied` | all fifteen refactorings |
| `runWithAutoCommitDeferred` closing | a file-in, an editor save, an undo, and the Explorer's
multi-row actions — removing a class subtree, a drag that moves or copies several methods,
a drag that refiles several classes |

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

## Deferral: the operations that are only correct as a whole

`runWithAutoCommitDeferred` (and its synchronous twin) holds commits back across an operation, then
commits once. Three properties matter:

- **It commits once, not per write.** A file-in of forty methods is one change, not forty.
- **A failure commits nothing.** The caller's own rollback — the refactoring panel's abort, a retry —
  is left the transaction it expects.
- **It nests.** An inner region borrows the outer one's commit, so a file-in that reaches
  `fileInClass` through `fileInFile` still commits once.

The rule for a new caller: **if the operation has an all-or-nothing contract, recovers by aborting,
or is one user gesture that writes several times, it runs deferred.** The third case has a ready-made
answer to "which writes belong together": the undo recording already groups them, and a drag that
records one undo entry is a drag that should make one commit. If it is one change that either lands
or does not, it does not need to.

## What a commit does to Undo (nothing) and to Abort (everything)

This is the question worth being sure about, and the answer falls out of how Jasper's undo already
works. **Undo is a forward operation**: it reverses a change by making the opposite one — recompiling
the earlier source, renaming back, binding an earlier class version — not by rolling the transaction
back. Nothing in the undo stack depends on the change being uncommitted, so a committed change is
exactly as undoable as one that is not. `undoLastCommand` runs deferred so that a reversal touching
several methods commits once; that is the only thing auto-commit changes about it.

**Abort is a different story, and it is the whole reason this feature needs a visible indicator.**
With auto-commit on, Abort no longer takes a change back — the change is in the repository. That is
not a defect to be fixed, it is what the user asked for; but a user who does not know the state is on
will reach for Abort and find nothing to abort. Hence:

- the status-bar indicator, coloured, always visible with a session, saying the state in words;
- the same answer on the session's row in the Logins view, which is where a *second* session's state
  can be read;
- a tooltip and a turn-on notice that both say Abort will not take a change back;
- a prompt before arming over a transaction that already holds uncommitted work, because the next
  change would commit all of it.

Note the one place Abort is still exactly what it was: inside a deferred region. A refactoring panel
offering Abort has had nothing committed under it.

## The `failed` state, and why it is not just `off`

A commit that fails is nearly always a conflict with another session, and the next write would hit
the same conflict. Retrying per keystroke would fail every time and bury the message, so auto-commit
stops — but it does **not** fall back to `off`, which would say the user turned it off. `failed` is a
third state: armed, and not committing. The indicator goes red, and the prompt offers the three
things that are actually useful — abort, read the conflict report, or turn it off. A manual commit or
abort that lands settles the transaction, and auto-commit resumes on its own.

Jadeite draws the same three-state distinction, with the same abort-or-see-the-conflicts choice, and
for the same reasons; the vocabulary here is deliberately close to it.

## What it assumes about transaction mode

Auto-commit assumes the ordinary manual transaction mode a Jasper session logs in to. Transaction
mode being visible and settable is separate work
([#256](https://github.com/GemTalk/Jasper/issues/256)); when that lands, the two will need to agree
about what auto-commit means in a mode where the session is not in a transaction to begin with.
