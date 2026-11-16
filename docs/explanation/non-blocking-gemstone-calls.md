# Non-blocking GemStone calls: where the work stands and how to finish it

Jasper is moving its GemStone calls off the extension host thread, one feature at a time. This
explains why, what changes when a call stops blocking, which rules keep the moved code safe, what
has moved so far, and what is left.
Read it before you convert another feature, or before you add a GCI call that could take more
than a few milliseconds.

Status as of 2026-11-13, with `main` at `f93095ec`.

## Why

VS Code runs extensions in a separate Node.js process, the extension host, which "doesn't isolate
different extensions from each other"
([VS Code wiki](https://github.com/microsoft/vscode/wiki/Explain-extension-causes-high-cpu-load)).
A blocking GCI call such as `GciTsExecute` holds that thread until the gem answers. While it
waits, Jasper freezes, and so does every other extension in the window: Git, the language
servers, the file explorer. A slow query, a large class, or a gem busy with someone else's run
is enough to cause a visible freeze.

The goal: **no GCI call that waits on the gem runs on the extension host thread.**

## What changes when a call stops blocking

Making a call non-blocking is not a mechanical change. It removes a guarantee that blocking code
got for free, and most of the bugs found during this work came from losing it.

### The model

JavaScript runs one job at a time: "Each job is processed completely before any other job is
processed" ([MDN, JavaScript execution model](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop)).
A job ends when its code returns or reaches an `await` (or hands a callback to `.then`,
`setTimeout`, and so on). Only then does Node's event loop run the next one
([Node.js event loop](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick)).

- **Blocking code is one operation at a time.** A command that makes ten blocking GCI calls holds
  the thread for all ten. No click, provider, timer or logout can run in between, and the frozen
  UI can't even send a second request. Every multi-call operation is atomic as far as Jasper is
  concerned, without anyone writing code for it.
- **Non-blocking code yields at every wait.** Each `await` hands the thread back, and anything can
  run before the code resumes: another command, a VS Code provider, a tree event, a timer, a
  logout. Any state the code read before the wait may have changed after it, and another call
  may have reached the same session in the gap.

The smallest example is `GciLibrary.executeAndFetchStringAsync` (only tests call it). It makes two
non-blocking calls: it evaluates `code`, then sends `encodeAsUTF8` to the result. Between the two,
the event loop runs other jobs. If one of them starts a call on the same session, the encode is
refused, the query fails even though `code` succeeded, and the evaluated result can't be released,
so it stays exported until logout (its JSDoc; N15). The production executor,
`executeFetchStringAsync`, closes that gap on purpose: it sends `encodeAsUTF8` _blocking_, inside
`onReady`, right after collecting the result, so nothing can run in between.

### What can go wrong

Each of these happened, or was measured, during this work.

1. **Another call slips into an operation's gap.** Above: a two-call operation fails or leaks
   when a third call lands between its calls. Fix: keep the steps that must stay together in one
   job (blocking, inside `onReady`), or hold the session for the whole operation (remaining work,
   item 4).
2. **Updates get lost.** An operation that reads, then writes based on what it read, can have
   another write land between the two. Measured: the second write was lost (J17). Blocking code
   can't hit this. Edits need an operation-spanning lease before they move (principle 8).
3. **Refusals become reachable.** Blocking code never met a busy session from its own UI, because
   the UI was frozen. Now features overlap, and GemStone refuses the later call with #2203 (N4).
   Many features never expected a refusal: they cached it as the answer (#837), half-updated the
   view (#843, fixed by #864), or misbehaved in other ways (#839 to #842, #860 to #863). Every converted caller,
   and every blocking caller that can now run during an async one, must handle a refusal
   (principles 5 to 7).
4. **The world changes during the wait.** The user clicks another class, the selection moves, a
   refresh replaces the tree, or the session logs out. Code that resumes must check that its
   result still applies before showing it (#877's clicks check this, and drop a superseded
   click). After a logout, touching the handle can crash the extension host (N2, N3; principle 1).
5. **Global flags don't survive a wait.** A flag set before a call and reset after it leaks into
   every job that runs during the wait. `quietly()` sets a module-level `quiet` flag around a
   query, which is only correct because the query is blocking. Async queries need the option
   passed per call instead (J19).
6. **VS Code itself runs requests at the same time.** A diff reads both sides with `Promise.all`,
   and reloaded tabs read together. Before #918's queued executor, those reads refused each other.
7. **Cancelled work still needs cleaning up.** A run can be cancelled or superseded in the middle.
   Its result and process must still be released (N20; principle 9), and that clean-up can hold
   the session afterwards: queries queued behind a cancelled one are refused with "still
   cleaning up" (J18).
8. **Blocking calls land between async ones.** Until everything moves, a blocking call (Commit,
   a hover query) can run between two calls of an async operation, exactly like another async
   call would.
9. **Async is not automatically non-blocking.** Both executors still page large results with
   blocking `GciTsFetchBytes` calls, since GCI has no non-blocking fetch (N9). Async also costs
   latency per call: about 10 ms through nbRunner against 0.29 ms blocking (J8, J23).
10. **Errors escape.** A throw inside a `setTimeout` callback or a fire-and-forget promise never
    reaches the code that started the work. nbRunner had this: a poll after logout threw out of
    its timer (fixed in #748).
11. **UI events land in the gaps too.** Moving a tree's highlight back fires a selection event,
    and before #908 the Explorer read that event as a new click and dropped the user's real one
    (#876).

### Why a queue doesn't bring back one-at-a-time

The executor written for method search (#827) first put a per-session queue in front of its
queries, to keep the one-at-a-time behavior of blocking code. It didn't survive review:

1. **Parked requests waited silently.** A second search queued behind a long one showed no notice
   and no Cancel. Blocking code never had this state: either the UI was frozen, or the request
   ran. So search was changed to refuse while the session is busy, with a notice that offers Stop.
2. **Operations still interleaved at call boundaries.** A probe showed that the queue ordered
   calls, not operations, so a read-then-write could still lose a concurrent write (J17). With
   search refusing, nothing else used the queue either, so it was removed before merging.
3. **Cancelling the head didn't cancel what was behind it.** A query queued behind a cancelled
   one still ran (J18).

Looking back, the queue imitated the wrong thing. Blocking gives **one operation at a time, and
nothing else can even be asked meanwhile**. A queue gives **one call at a time, with other requests
parked behind it**.

A queue came back
later (#918), but only as an opt-in for short reads that VS Code fires together, where waiting a
few milliseconds is what the user expects. That is why the busy policy depends on the kind of
request (principle 5, "Contention categories").

## Where it stands

This section is a snapshot from 2026-11-13 and will go stale as work lands. Update it, or delete it
once the "Remaining work" list is the better guide.

**Already non-blocking**, through the non-blocking query executors described below:

| Feature                                                 | PR               |
| ------------------------------------------------------- | ---------------- |
| Search Method Source / Browse Methods Containing…       | #827             |
| Expanding a class row in the Explorer                   | #855             |
| Clicking a class or dictionary in the Explorer          | #864, #877, #908 |
| Opening method, class definition and class comment tabs | #918             |

**Supporting work already on `main`:**

- `ActiveSession` owns the GCI handle. After a successful logout every method throws, with no
  native call (#748).
- `ActiveSession.isBusy()` sees non-blocking calls and worker calls (#807).
- A logout that GemStone refuses is no longer ignored (#777, later reworked by #809), and
  shutdown never unloads the GCI library under a running worker call (#792).
- `GciTsNbPoll` and `GciTsNbResult` throw instead of crashing while a worker thread owns the
  session (#813).
- A cancelled run releases its process and result (#828).
- A refusal is never cached as the answer (#837). CodeLens counts that were refused recount once
  the session frees up (#912).

**Still blocking:** most queries. On `main`, production code binds the blocking
`defaultQueryExecutorUsing` about 156 times and the non-blocking executors 13 times (counted
with `grep`). The debugger (step, frame fetches; its Resume already runs on a worker thread), Commit, Abort and Begin, saves and
structural edits, hover, completion, CodeLens and the MCP server all still block.

## How a non-blocking call works today

Every non-blocking Smalltalk evaluation goes through `runNbCall` in `nbRunner.ts`:

1. Wait until the session is free, or refuse if it is busy.
2. Start the call with `GciTsNbExecute` or `GciTsNbPerform`.
3. Wait until the result is ready: `GciTsNbPoll` on 3.7+, socket readiness on 3.6.x.
4. Collect it with `GciTsNbResult`, in the caller's `onReady`.
5. If the user stops the run, send a soft break, drain the call, and clear or release what it
   left behind.

Past about 2 s, a run shows a progress notification with Cancel.

Queries reach it through one of three executors in `browserQueries.ts`:

| Executor                     | Shape                                          | On a busy session                                                                           |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `defaultQueryExecutorUsing`  | `QueryExecutor`, `(code) => string`            | Blocks the thread; refused if busy                                                          |
| `nbQueryExecutorUsing`       | `NbQueryExecutor`, `(code) => Promise<string>` | Refused, with the run-in-progress notice (Stop)                                             |
| `queuedNbQueryExecutorUsing` | `NbQueryExecutor`                              | Waits behind the session's earlier _queued_ queries; still refused by anything else running |

Use the queued one for reads that VS Code fires several at a time: both sides of a diff, tabs
reloaded together, Explorer rows and clicks that can land while a tab loads. Use the plain one
for a user-started query that should refuse instead of waiting behind another (Search Method
Source). `client/CLAUDE.md` says the same in its Queries paragraph.

The Explorer also keeps its own read queue (`inReadOrder` in `gemstoneExplorer.ts`). It orders
Explorer reads and lets a click that has been superseded skip its remaining reads. Whether it can
go now that the Explorer binds the queued executor is still open.

`executeFetchStringNb` is the original non-blocking executor (it predates #827), kept for its callers: Rowan load, the
Testing view, and the refactoring preview, apply and undo queries (about 60 calls). It caps results at 256 KB and doesn't release them. Merging it into
`executeFetchStringAsync` is #832.

### How stopping a run works

Since #809, every Stop behaves the same way:

1. One soft break (`GciTsBreak`). The gem answers it with Break 6003 when the run reaches a
   point where it can stop.
2. If the run hasn't ended after `STOP_WAITING_AFTER_MS` (1.5 s, `nbRunner.ts`), Jasper stops
   waiting and offers **Force Stop**: a second, transient login sends the run a signal that
   `on: Break` can't catch (`forceStop.ts`).
3. If Force Stop can't end the run either, Jasper offers to log the session out.

There is no hard break any more. Logout follows the same path: stop the run, Force Stop if
needed, log out, then end a leftover gem with `System stopSession:` (which needs the
SessionAccess privilege; without it, Jasper shows the command to run). A gem whose run resumes from a soft break keeps running
after its logout, so logging out alone doesn't end a run.

## Design principles

These hold for any GCI work, not only async conversions. Each one rests on a measurement or a
documented fact; see "Verified GCI facts" below.

1. **Never touch a logged-out handle.** `GciTsLogout` frees the session (N1). Any `GciTs*` call
   after that is undefined behavior, crashes included (N2). `ActiveSession` enforces this. Async
   code widens the window, because an awaited step can resume after a logout, so a loop must
   call `ActiveSession`'s methods on every pass, never a handle it captured at the start.

2. **Let GemStone refuse; don't crash.** While a call is in flight, GemStone refuses other calls
   on the session with #2203 within milliseconds and leaves the running call intact (N4; 22 of 24 methods probed). That
   refusal is safe. The dangerous cases are narrow: polling for or reading a result while a koffi
   worker owns the session (N3), which `ActiveSession` now refuses (#813).

3. **Prefer non-blocking (Nb) calls over koffi `.async`.** A `.async` call holds a thread from
   libuv's pool, which defaults to 4 threads (R2, R3). Four long
   `.async` calls stalled every `fs` call in the process for their full duration (R4, measured in
   Node, not inside VS Code). VS Code doesn't raise the pool size (R5). An Nb call holds no
   thread. Keep `.async` for bounded calls, and cap how many run at once if more of them appear.
   The `.async` calls today are `GciTsPerformAsync`, `GciTsContinueWithAsync` (Resume, the
   conditional-breakpoint loop and Transcript forwarding) and `GciTsClearStackAsync` (clearing a stopped process).

4. **Track per-session state by session id, not by `ActiveSession` object.** Integration tests
   wrap one login in many `ActiveSession` objects; keying state by object crashed
   `stepping.integration.test.ts` (J16). Production makes one object per login. #802 tracks the
   proper fix.

5. **Pick the busy policy by what the request is, not one global rule.** Waiting behind short
   work is what users expect; waiting silently behind an unbounded run is a bug. See
   "Contention categories" below. Whatever the policy, never wait silently: either show the wait
   with Cancel, or refuse with a notice.

6. **Fetch, then commit UI state.** Read everything a click or command needs before changing
   what the user sees. A refused read then leaves the UI as it was, instead of half-updated
   (#864). When a newer click supersedes a pending one, the newer one wins.

7. **Never cache a refusal as the answer.** "Session busy" is not "no senders" or "no instance
   variables" (#837). Cache only on success.

8. **A per-call queue doesn't make an operation atomic** ("Why a queue doesn't bring back
   one-at-a-time" above). Features that edit (saves, structural edits, refactorings, file-in)
   need an operation-spanning lease before they move to async. Reads don't. Refactorings are the
   exception that already moved: their queries run through `executeFetchStringNb` without a
   lease, so another call can land between the steps of an apply.

9. **Release what you export.** Every collected Nb result is added to the PureExportSet (N20),
   and the set is not reference-counted: one release drops an object for every holder. Release
   results and stopped processes on every path, failures included (#826 is the known leak).

10. **Move feature by feature, in small PRs.** Each PR converts one feature's queries (or a slice
    of them) and leaves `main` working. A shared helper gets a non-blocking twin until its last
    blocking caller moves. Follow `tsc` from the converted query and stop where the ripple meets a
    VS Code API that already accepts a promise (`readFile`, `getChildren`, providers).

11. **Test on 3.6.x and 3.7.x.** The crash cases differ by version (N3), and 3.6.x waits on the
    socket while 3.7+ uses `GciTsNbPoll`. The local default stone is 3.6.2, so it never runs the
    `GciTsNbPoll` path; CI runs the full matrix.

12. **Ship a big mechanical change as a codemod.** When a change touches many call sites (a new
    return shape, a renamed executor, a signature that goes async), write the transformation as a
    script (ts-morph or jscodeshift) and commit its output separately. Reviewers then read the
    script and spot-check the result instead of every changed line, and the change can be
    regenerated after a rebase instead of resolving conflicts by hand.

13. **Don't pre-empt a refusal GemStone gives safely.** A check that sees `isBusy()` and throws
    our own "Session is busy" before making a call that GemStone would refuse anyway (#2203, N4)
    hides the native error and duplicates GemStone's own rule. Make the call and reword the
    refusal for the user instead (`explainGciError` keeps the error number). The `refusedAsBusy`
    checks in `browserQueries.ts` (#809) pre-empt, with a Stop / Force Stop notice; they were
    kept on purpose. Don't add new ones.

14. **Never unload the GCI library.** Unloading it while a worker call is pending crashed the
    process (J6). #792 removed `GciLibrary.close()`: at shutdown the library stays loaded and the
    process exit frees it. Don't add an unload back.

## Contention categories

What a request should do on a busy session depends on what kind of request it is. This table
came from surveying every feature that calls GemStone, assuming all calls were async.

|     | Category               | Examples                                                                                               | Policy                                                                                        |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| A   | User runs (unbounded)  | Execute/Display/Inspect It, test runs, debugger Resume, Rowan load, Search Methods, MCP `execute_code` | Hold the session for the whole run. Refuse another A with the Stop notice                     |
| B   | Ordered edits          | Save/compile, structural edits, deletes, refactoring apply, file-in, breakpoint apply                  | First in, first out, one unit from undo capture through write (J17). Never refuse, never skip |
| C   | Transaction boundaries | Commit, abort, begin, mode switch                                                                      | Queue behind B; refuse while an A runs (a queued commit would commit the run ahead of it)     |
| D   | Navigation reads       | Explorer selection, editor-to-tree sync, Back/Forward, debugger frame select, Omni Search keystrokes   | Latest wins; commit UI state after the fetch                                                  |
| E   | Reads VS Code awaits   | `readFile`, `getChildren`, Go to Definition, class pickers                                             | Short queued wait; must see earlier writes                                                    |
| F   | Ambient reads          | Hover, completion, CodeLens, inlay hints, workspace symbols                                            | Drop when stale (CancellationToken), stay quiet, never queue behind A, never cache a refusal  |
| G   | Background upkeep      | Class sync, SUnit discovery, transcript drain, transaction-state refresh                               | Low priority, yields to user work; clean-ups never dropped                                    |
| H   | Priority / bypass      | Soft break, Force Stop, logout                                                                         | Outside the queue, or at its head                                                             |

Primitives these need, not built yet: a per-session lease spanning a unit of work; priority
lanes (H, then user work, then G); a per-request admission policy (wait, refuse, supersede,
coalesce, drop when cancelled); a visible queued state whose Cancel dequeues; and a per-call
quiet option that also silences nbRunner's busy notice (J19).

MCP requests aren't in the table. The original design had MCP tools wait a bounded time for a
busy session, then report busy, since an AI agent can retry but can't press Stop. `execute_code`
is a user run (A); its read-only tools fit no row cleanly yet.

## Remaining work

Roughly in the order it was planned. Nothing here has started.

0. **Measure freezes first.** Nothing defines "doesn't block" today, so there is no way to tell
   which feature to convert next, or when the work is done. Proposal: a
   `perf_hooks.monitorEventLoopDelay` monitor in dev builds and tests that flags any stall over a
   threshold, with what was running at the time. Reporting the same numbers through telemetry
   would show which freezes users actually hit.
1. **Latency before ambient reads move.** nbRunner polls once, then waits 10 ms, so a fast
   non-blocking query costs about 10 ms against 0.29 ms blocking (J8, J23). Fine for a click; too
   slow for hover or completion. Try a few `setImmediate` polls before the first timer, and
   measure first. The CPU cost of spinning during a long call is unmeasured.
2. **More E and D features**, one PR each, the same way as #855/#877/#918: Go to Definition,
   class pickers, the other tree views, Omni Search, debugger frame select. Category F (hover,
   completion, CodeLens) after item 1, with a quiet option.
3. **Let Explorer reads wait for a running search** instead of being refused (#831). This is
   the open policy question in "Open questions" below.
4. **An operation-spanning lease, before any B or C feature moves.** Commit followed by the
   conflict read must also hold one lease (risk 6 below). The earlier design was
   `exclusively(async () => …)`: one queue entry for an operation spanning several calls, with
   calls inside it skipping the queue.
5. **Debugger and DAP.** `@vscode/debugadapter` calls request handlers synchronously and drops
   their return values, so async handlers can overlap (R6). There is no design for this yet;
   write one before converting any debugger request.
6. **The remaining blocking calls:** debugger step and fetches (the GemStone Debugger's Resume
   already runs on a worker thread; the DAP debugger's doesn't),
   `GciTsFetchBytes` pages for large results, and Windows login (no Nb login there, N9).
7. **Windows coverage.** Login stays blocking on Windows (N9), and no test targets the
   Windows-specific paths on purpose. Add explicit test steps when a converted feature depends on
   them.
8. **The MCP server** shares `QueryExecutor`, so it moves with the last query features (wrap its
   sync executor in `Promise.resolve` until its tools move). See also "Long-term direction": it
   should go through `ActiveSession`, not `GciLibrary`.
9. **Delete the blocking `QueryExecutor`** once nothing binds it.

**Re-check these races when the matching feature moves.** An earlier attempt (#683, closed)
converted every query at once behind one seam. Small per-feature PRs replaced that approach, so
don't revive it. Its review flagged app-state races that could appear once calls yield (never
confirmed on the current code), and each needs
re-testing when its feature goes async:

- a class comment saved into the wrong class;
- stale step-point offsets in the debugger;
- Undo applied twice;
- a breakpoint added twice;
- duplicate globals panels.

**Open issues from this work** (all filed, none started):

- Leaks and session state: #826 (failed evaluations leave error objects exported), #933 (closing a
  debugger during another run leaves its process), #802 (state per `ActiveSession` object), #755
  (key draining by connection), #806 (nbRunner's liveness check never fires).
- Logout and stopping: #768 (a call started during logout), #770 (saving a method edited before
  logout), #773 (logout warns of uncommitted changes while Transcript streams), #780 (say why a
  logout stopped an Execute It), #916 (a stopped SUnit run ending in a raw Break error).
- Refusal handling: #812, #839, #840, #841, #842, #861, #862, #863, #930, #931, #932 (features
  that misbehave when a run refuses their read or run).
- Explorer clicks: #860, #905, #906, #907.
- CodeLens: #910, #911.
- Executors and conversions: #824 (Omni Search and MCP method-source search), #831, #832.
- Concurrency outside GCI: #934 (two class syncs on one session at once).

## Long-term direction

### Three layers

Today `GciLibrary` (`gciLibrary.ts`, about 3,600 lines) mixes two things: about 95 raw `GciTs*`
wrappers that mirror the C API (each answers `{ result, err }` or `{ success, err }`, with a
`GciError` struct the caller must check), and about 40 ergonomic methods (`execute`,
`executeAndFetchString`, `perform`, the user-globals and session-temps helpers, …) that already
throw `GciLibraryError`. That split is deliberate for now: new functions throw, and existing raw
wrappers were kept as they were, so that changing them could happen one function at a time.

The target is three layers:

1. **A private raw binding**, still one to one with the C API. It stays because the native facts
   in this doc were measured by calling raw functions, the cross-version registry is generated
   from the headers ([GCI cross-version compatibility](gci-version-compatibility.md)), and probes
   need the C behavior unfiltered. Nothing outside `GciLibrary` calls it.
2. **`GciLibrary`, JavaScript-shaped**: each call answers its result, or throws
   `GciLibraryError`. It stays synchronous. Calls whose answer _is_ a status, not an error, keep
   their own shape: `GciTsObjExists` (no error channel; answers `false` both for "missing" and
   for "refused", J11), `GciTsNbPoll` (1/0/-1), `GciTsFetchBytes` (-1), `GciTsCallInProgress`
   (misreports, N5).
3. **`ActiveSession`**, the only public way to use a session. It holds the ergonomic methods,
   the session state they need (the UTF-8 class cache keyed by handle, J14; the release policy),
   and every non-blocking call. The JavaScript shape of a non-blocking call is
   `await session.execute(…)`, which is where nbRunner's core moves (below).

### Errors

**Consolidate on `GciLibraryError`.** `BrowserQueryError` (`browserQueries.ts`) and
`DebuggableError` (private to `codeExecutor.ts`) both date from an early commit (`ceba68d1e`,
2026-02-16); `GciLibraryError` came five months later (#145, 2026-07-09). They were separate
efforts made before a general error existed, and all three carry the same core, a message and a
GCI error number, under three names (`gciErrorNumber`, `errorNumber`, `number`).
`isBusyRefusal` checks a `BrowserQueryError`'s number against #2203; `DebuggableError` also
carries `context` and a `cancelled` flag. Use `GciLibraryError` wherever possible.

**Some GCI errors are results, not failures.** An evaluation that raises an error hands back
its suspended process (`context`), its exception (`exceptionObj`) and its `args`. A Cancel
answers Break 6003, a busy session #2203, and a commit conflict `false` plus #2738. Callers
branch on all of these, so the thrown error must carry what they need. Today `GciLibraryError`
keeps only `message` and `number`.

**Release by default; keep on request.** Those error objects are exported, so the gem can't
garbage-collect them, and a process holds its whole stack. They stay in the gem's memory until
released or until logout (#826). Whether to keep them depends on the caller:

- Execute It and the debugger need `context` (and may want `exceptionObj`) to open the debugger.
  They ask to keep them, and get an error that holds them and owns releasing them once the
  debugger is done. `DebuggableError` does this today for `context` only.
- A failed tooltip, CodeLens or Explorer read has no use for them. The default releases them
  before throwing.

Three traps:

- The export set is not reference-counted (principle 9). If `args` holds an object the caller
  already had exported, releasing it pulls it out from under the caller. Release only what the
  error itself added.
- A release is refused while another call is in flight on the session (#2203). Release in the
  same job that collected the error, as `executeFetchStringAsync` does with its encode.
- Releasing the context, the exception and the args is the list agreed with GemTalk for #826.

### The handle must not escape

This is the one rule the rest depends on: **no code outside `ActiveSession` holds a raw session
handle.** Every guard (no call after logout, no poll under a worker, busy tracking) lives in
`ActiveSession`, and a raw handle bypasses all of them. Today it escapes in two places:
`SessionManager` logs in through `GciLibrary` and hands the handle to `ActiveSession`'s public
constructor, and about 70 integration test files build `ActiveSession`s from the raw harness
handle. Closing it needs:

- a session-level test fixture on top of `useIntegrationTest` that hands out an `ActiveSession`;
- the pass-throughs those tests still lack (`execute`, `executeAndFetchInteger`, …);
- then a private constructor with login factories, so no code can wrap a handle twice (which
  also fixes #802).

With `GciLibrary` internal and `ActiveSession` the only public API, `ActiveSession` and
`GciLibrary` could become a package that Jasper and other projects share. A package can't rely
on Jasper's UI to stop misuse, so `ActiveSession` itself must refuse what nbRunner and
`SessionManager` prevent today. What it already enforces: no call after logout, and no poll or
read under a worker (#813).

### The MCP server

Its direction is open, but it should use `ActiveSession` where possible and not rely on raw GCI
calls. Today `McpSession` (`mcp-server/src/mcpSession.ts`) creates and calls a `GciLibrary`
directly, so it has to move onto `ActiveSession` before the ergonomic methods can leave
`GciLibrary`. That is feasible: `activeSession.ts` doesn't import `vscode`.

### Migration

- Convert per function, following `tsc`, not all at once. Every `err.number !== 0` site changes
  control flow when its call starts throwing; `debugQueries.ts` alone has about 20.
- Use a codemod where the change is mechanical (principle 12).
- A branded `Oop` type and a typed session handle (instead of `unknown`) belong in the same pass.
  A `GciError` field once reached JavaScript as a `number`, not a `bigint` (J22).

### nbRunner into `ActiveSession`

`ActiveSession` should own all the GCI infrastructure that nbRunner holds today: busy tracking,
Nb runs, draining and collection. `ActiveSession` already duplicates nbRunner's busy state
(#807); that duplication is accepted until the move.

All of nbRunner's non-blocking operations share one core: wait until free, start
(`GciTsNbExecute` / `GciTsNbPerform`), wait until ready, collect (`GciTsNbResult`), and on a
stop, drain or clear. Only the start and the post-processing differ. Its code sorts into three
groups:

- **Can move as it is (GCI):** `pollNbResultReady`, `doPoll`, `beginNbCall`,
  `drainAbandonedCall`, `collectLate`, `resendSoftBreak`, `clearInBackground`,
  `whenSessionFree` / `ensureSessionFree`, `trackRun`, `holdSessionUntilSettled`, `stopCallsOn`,
  `forgetSession`, and the per-session maps (`live`, `draining`, `uncollected`, `clearing`,
  `logouts`).
- **Stays in Jasper (UI):** the progress notification, the "Stopping…" status bar item, the
  registered command handlers and the message text.
- **Needs a callback seam first (mixed):** `pollNbToCompletion`, `requestCancel`, `settle`,
  `stopWaiting`. Callbacks such as "slow call started", "stop requested" and "settled" let the
  UI stay in Jasper.

This inventory was taken on 2026-10-29; re-check it against `nbRunner.ts` before starting.

Moving nbRunner's GCI layer was estimated at 1.5 to 2.5 weeks over three PRs: the poll core;
draining and late collection; the busy gate and maps. The cost drivers: `activeSession.ts` must
not import `vscode`, but nbRunner logs through it, so moved code needs an injected logger; and
many files call `runNbCall`, so keep it as a thin UI wrapper. The UI (progress notification,
"Stopping…" status, messages) stays in Jasper behind callbacks.

## Parked ideas

Worth doing; not scheduled.

- **One readiness check.** `GciLibrary.isNbResultReady` treats a failed check as ready (J2) and
  takes the raw handle; nbRunner's `pollNbResultReady` answers 1/0/-1 through `ActiveSession`.
  Direction: one check on `ActiveSession` that throws on failure.
- **Encode as a second Nb call.** `executeFetchStringAsync` sends `encodeAsUTF8` blocking inside
  `onReady`, and pages the bytes blocking too. Switch only if a large result shows up as a stall.
- **Non-blocking Commit, Abort and Begin** by evaluating `System commitTransaction` and friends
  with Nb execute. It works on 3.6.2 but answers only `false` on a conflict, without error #2738
  (N13). Check 3.7.x first.
- **A cap on concurrent koffi `.async` calls** (principle 3), once more calls use `.async` or
  several sessions stream Transcript output at once.
- **A "working" signal between 1 s and nbRunner's 2 s notification.** NN/g: "For delays of more
  than 1 second, indicate to the user that the computer is working on the problem."
- **`debugQueries.ts` cleanup:** 20 ad-hoc `err.number !== 0` checks with four different outcomes,
  plus its own perform helpers. Candidates for `ActiveSession` methods.
- **The queued executor by default** for every non-blocking read, instead of opting in.
- **Fetching large results without blocking.** Paging with `GciTsFetchBytes` blocks (hazard 9),
  and GCI has no non-blocking fetch. One option is running the fetch on a koffi worker with
  `.async`, which conflicts with principle 3, so it needs the cap first. Don't switch the UTF-8
  fetch to `GciTsFetchChars`: it breaks decoding where a multi-byte character spans two pages.

## Open questions

- **Wait or refuse behind a user run?** The earlier design said commands wait visibly
  ("Waiting for <op>… [Cancel]"). Search Methods refuses instead, and as a result Explorer reads
  are refused for the whole search (J21, #831). Both agree on "never wait silently."
- **Priority lanes.** A plain queue puts a re-arm or a breakpoint clear that must run first
  behind queued queries. Category H and G work needs lanes.
- **Ping.** `SessionManager.ping` uses `GciTsFetchSize(OOP_NIL)`, which succeeds during a busy
  call (N19). The client library may answer it without reaching the gem, so ping may not detect a
  dead gem. Not probed against a killed gem.
- **3.7.x coverage.** N13 and N14 (commit conflicts through Nb) were measured on 3.6.2 only.
- **Logout with queued work.** Category H says logout rejects queued work. Whether queries
  waiting in `queuedNbQueryExecutorUsing` are rejected on logout, or reach a logged-out session
  and fail there, hasn't been checked.
- **Version floor.** `GciTsNbPoll` exists only on 3.7+. On 3.6.x Jasper waits on the socket
  instead, and 3.6.2's `GciTsNbResult` has its own crash case (N3). If 3.6.x support is ever
  dropped, that path can go, so avoid building more on it than needed.

## Risks

**Crash** (kills the extension host for every extension):

1. A GCI call after logout (N2). Async widens the window; principle 1 covers it.
2. Polling or reading a result while a worker owns the session (N3). Guarded by #813; every new
   `.async` call adds exposure.
3. `GciTsNbResult` on 3.6.2 and `GciTsNbPoll` on 3.7.x crash on a freed handle, so any new wait
   loop must go through `ActiveSession` on every pass.

**Freezing other extensions:**

4. koffi `.async` filling libuv's pool (principle 3).

**Correctness:**

5. Interleaved multi-step operations leak exported objects (N15), and one operation's release can
   drop an object another still holds (principle 9).
6. A commit's conflicts must be read before anything else aborts, commits or continues, or they
   are cleared. The transaction-state read in between is harmless (N14).
7. DAP requests overlap once handlers are async (R6).
8. `GciTsCallInProgress` answers 0 during an Nb call (N5), so it can't serve as a busy check; use
   `ActiveSession.isBusy()`.

**Performance:**

9. Naive async is about 100× slower per query: 34 ms against 0.29 ms, from a fixed 15 ms sleep
   in `GciLibrary.executeAndFetchStringAsync` (J8). A readiness-driven wait measured 0.08 ms.
   nbRunner's back-off is 10 ms (remaining work, item 1).

## Verifying native behavior and testing

Every fact in the next section came from the same practice. Keep it when adding a new
assumption about GCI.

- **Probe before relying on a native behavior.** The header and the manuals are often silent or
  wrong (N5). Write a throwaway script or integration test that calls the raw functions, run it
  against several versions, and record what it showed, with the date and versions. The test
  setup installs GemStone versions under `client/tmp/gemstone/` (3.6.1 to 3.7.5 locally).
- **See the test fail first.** Run a new test without the fix (or with the guard removed) and
  confirm it fails for the right reason. Several fixes here were checked by removing them and
  watching the crash come back.
- **Test the public contract, not the internals.** Exercise the executor or the `ActiveSession`
  method a caller uses, not a private queue or map, so the test survives the refactors above.
- **Known flakes and quirks:**
  - the local 3.6.2 stone can hit its login limit ("maximum number of users") on a full
    `npm test`; it isn't caused by your change;
  - cancel tests timed out at vitest's 5 s default on the 3.7.2 and 3.7.4.3 CI legs (about
    150 ms locally) and now set 30 s per test. Why CI was slow is unknown; one guess (not
    verified) is that a soft break sent before the gem starts the call gets lost.

## Verified GCI facts

Evidence key: **[H]** the vendored `gcits.hf` header; **[M]** measured with a throwaway probe
against a live stone (date, versions); **[D]** external docs; **[GT]** stated by the GemTalk GCI
team. The IDs are the ones used above.

| ID  | Fact                                                                                                                                                                                                                             | Evidence                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| N1  | `GciTsLogout` deallocates the session                                                                                                                                                                                            | [H] 3.6.2                                                                                        |
| N2  | Any `GciTs*` call on a logged-out handle is undefined behavior, crash included                                                                                                                                                   | [GT] 2026-10-09                                                                                  |
| N3  | `GciTsNbPoll` (3.7.2, 3.7.4.3, 3.7.5) and `GciTsNbResult` (3.6.2) crash (SIGSEGV) on a logged-out handle or one a koffi worker owns. 3.6.8 and 3.7.x `GciTsNbResult` answer #4100/#2203 instead                                  | [M] 2026-10-09                                                                                   |
| N4  | While an Nb call runs, is ready but uncollected, or a worker owns the session, other calls are refused with #2203 within 9 ms; the running call stays intact                                                                     | [M] 2026-10-07/08, 3.6.2, 3.7.5                                                                  |
| N5  | `GciTsCallInProgress` answers 0 during an Nb call (contradicting the header) and 1 while a worker owns the session                                                                                                               | [M] 3.6.2, 3.7.5; [GT] confirmed as a libgcits bug, 2026-10-23                                   |
| N6  | `GciTsLogout` is refused with #2203 while a worker owns the session                                                                                                                                                              | [M] 2026-10-07, re-measured 2026-10-15                                                           |
| N9  | The only Nb functions are Execute, Perform, Result, Login (Unix only), Logout and Poll (3.7+). No Nb Commit, Abort, Begin, Fetch or ContinueWith                                                                                 | [H] 3.6.2, 3.6.8, 3.7.5                                                                          |
| N11 | `GciTsBreak` "may be called while another C thread has a call in progress using the same GciSession"                                                                                                                             | [H] 3.6.2                                                                                        |
| N13 | Nb `System commitTransaction` on a write-write conflict answers `false`, and `System transactionConflicts` then holds the same set as after `GciTsCommit`, which also returns error #2738                                        | [M] 2026-10-15, 3.6.2                                                                            |
| N14 | The transaction-state doit between a failed commit and the conflict read does not clear the conflicts                                                                                                                            | [M] 2026-10-15, 3.6.2                                                                            |
| N15 | Overlapping `executeAndFetchStringAsync` with another Nb call leaves 2 objects exported                                                                                                                                          | [M] 2026-10-07, 3.6.2                                                                            |
| N16 | `GciTsLogout` during a running Nb call succeeds within 9 ms, and the gem leaves `System currentSessions` within 0.5 s. (#809 found that a gem resuming a soft break keeps running after its logout.)                             | [M] 2026-10-08/16, 3.6.2, 3.7.5                                                                  |
| N17 | A worker call that GemStone _refuses_ doesn't make polling or collecting on the main thread crash. So N3 needs a worker that actually owns the session                                                                           | [M] 2026-10-27, 3.6.1-3.6.6, 3.6.8, 3.7.2, 3.7.4.3, 3.7.5                                        |
| N18 | With no Nb call outstanding, `GciTsNbResult` and `GciTsNbPoll(0)` answer #2203 at once; the session stays usable                                                                                                                 | [M] 2026-10-28, 3.6.2, 3.7.5                                                                     |
| N19 | During an Nb call, `GciTsFetchSize(OOP_NIL)` succeeds while Commit, Abort and a second Nb execute get #2203; a soft break succeeds and the call answers 6003                                                                     | [M] 2026-10-30, 3.6.2                                                                            |
| N20 | `GciTsNbResult` adds its result to the PureExportSet; `GciTsReleaseObjs` removes it                                                                                                                                              | [M] 2026-10-30, 3.6.1-3.6.6, 3.6.8, 3.7.2, 3.7.4.3, 3.7.5; [D] GemBuilder for C 3.7, pp. 19, 347 |
| R1  | All extensions share one extension host, which doesn't isolate them                                                                                                                                                              | [D] VS Code wiki (linked in "Why")                                                               |
| R2  | libuv's thread pool defaults to 4 threads and backs async `fs`, `dns.lookup`, `zlib` and crypto                                                                                                                                  | [D] [Node CLI docs](https://nodejs.org/api/cli.html), `UV_THREADPOOL_SIZE`                       |
| R3  | koffi `.async` runs on that pool (`Napi::AsyncWorker`)                                                                                                                                                                           | koffi source `ffi.cc`; [D] [Node-API docs](https://nodejs.org/api/n-api.html)                    |
| R4  | 4 pending koffi `.async` calls block every `fs` call: `fs.readFile` took 1958 ms behind four 2 s calls, 1 ms behind three                                                                                                        | [M] 2026-10-15, Node 24.19.0, outside VS Code                                                    |
| R5  | VS Code does not set `UV_THREADPOOL_SIZE`                                                                                                                                                                                        | GitHub code search over `microsoft/vscode`, 0 results                                            |
| R6  | `@vscode/debugadapter` 1.68.0 calls request handlers synchronously and drops their return values                                                                                                                                 | its `debugSession.js` and `protocol.js`                                                          |
| J2  | `GciLibrary`'s readiness check treats a failed check as "ready"                                                                                                                                                                  | code                                                                                             |
| J6  | Unloading the GCI library while a `GciTsContinueWithAsync` worker call is pending crashes the process (exit 139, SIGSEGV); unloading when idle is fine                                                                           | [M] 2026-10-15, 3.6.2                                                                            |
| J8  | Per call for `(3 + 4) printString`: blocking 0.29 ms; `executeAndFetchStringAsync` 33.9 ms (15 ms sleep, twice); Nb execute with a `setImmediate` readiness loop 0.08 ms                                                         | [M] 2026-10-15, 3.6.2, 200 calls each                                                            |
| J16 | Integration tests wrap one handle in a fresh `ActiveSession` per call; keying state by object crashed tests                                                                                                                      | [M] 2026-10-19, 3.6.2                                                                            |
| J17 | Through a per-call queue, a read-then-write and a concurrent write ran as read, write, write: the second write was lost                                                                                                          | [M] 2026-10-30, 3.6.2                                                                            |
| J18 | Cancelling the query at the head of a per-session queue rejected it, and the query queued behind it still ran. Since #828, queued queries behind a cancelled one are refused with "A previous run is still cleaning up…" instead | [M] 2026-10-30 and 2026-11-12, 3.6.2                                                             |
| J19 | `quietly()` silences a refused blocking query but not a non-blocking one: nbRunner shows its busy notice regardless                                                                                                              | [M] 2026-10-30, 3.6.2                                                                            |
| J21 | Blocking Explorer queries are refused, with a notice, for the whole of a non-blocking search                                                                                                                                     | [M] 2026-10-30, 3.6.1-3.6.6, 3.6.8, 3.7.2, 3.7.4.3, 3.7.5                                        |
| J23 | An Explorer class row: three blocking queries 2.1 to 8.0 ms; one combined query 0.25 to 0.5 ms blocking, about 11 ms non-blocking (nbRunner's 10 ms back-off)                                                                    | [M] 2026-11-03, 3.6.2, 3.7.5                                                                     |
