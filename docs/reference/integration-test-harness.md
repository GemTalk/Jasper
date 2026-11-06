# Integration test harness (`useIntegrationTest`)

Lookup for someone about to write a stone-dependent test. See [integration test isolation](../explanation/integration-test-isolation.md) for why the harness is shaped this way.

## What it provides

Call `useIntegrationTest(callback, options?)` at the top of a `describe` block. The `callback` receives a `GciTestContext`:

| Field                            | What it is                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `gciLibrary`                     | The loaded `GciLibrary` instance for this suite.                                                                        |
| `session`                        | The current session — an opaque koffi handle. Do not compare it with `toEqual` (see "Failure modes" below); use `toBe`. |
| `login(options?)`                | Logs in again, optionally as a different `user`. Re-invokes `callback` with the fresh context.                          |
| `logout()`                       | Logs out the current session and clears it. Returns the now-invalid session handle.                                     |
| `withTransientSession(callback)` | Runs `callback` against a second, independent session, then always logs it out.                                         |

`options` accepts:

| Option           | What it is                                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowedCommits` | How many `System commitTransaction`s this suite's tests — and the production code they exercise — perform. Default `0` (no commits allowed at all). See "The commit invariant" below for when it does and doesn't apply, and the [explanation doc](../explanation/integration-test-isolation.md) for why. |
| `sessions`       | How many sessions this suite has logged in on the stone at once: its own plus any second session a test logs in. Default `1`. See "The session gate" below.                                                                                                                                               |

The `callback` fires once **per login**, not once per file: at the end of `beforeAll`, and again any time a test calls `login()` (including the automatic re-login after a test calls `logout()`). Capture the fields you need into variables your tests read, and expect those variables to be reassigned across a file that logs in more than once.

A `login()` from _inside_ a test gets a session of its own, which starts outside the transaction `beforeEach` opened and carries none of the nested levels opened within it. The harness re-opens both on the new session unconditionally, so the rest of the test keeps whatever commit budget the suite declared — zero included.

## Hook order

| Hook         | Does, in order                                                                                                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `beforeAll`  | Set `GEMSTONE_GLOBAL_DIR` → fail if the test stone's plugin isn't this checkout's → book the file's sessions with the session gate → load the GCI library → login → report its serial to the gate → **arm the commit guard** → `resetNonTransactionalSessionState` → fire `callback` |
| `beforeEach` | Poison check (fail fast if a previous test's cleanup failed) → auto re-login if a prior test called `logout()` → `beginTransaction` → open the `allowedCommits` level budget (a no-op at `0`) → `resetNonTransactionalSessionState`                                                  |
| `afterEach`  | **assert the commit guard is still armed** → read the transaction level and unwind every level → `resetNonTransactionalSessionState` → the budget floor check (skipped at `allowedCommits: 0`)                                                                                       |
| `afterAll`   | logout → **fail if a login was never reported to the gate** → give the booking back → restore `GEMSTONE_GLOBAL_DIR`                                                                                                                                                                  |

## `login({ user })` and `withTransientSession`

Use `login({ user: 'SystemUser' })` to re-authenticate as a different identity on the _same_ shared session — this re-fires `callback`.

Use `withTransientSession` when a test needs a second, independent session (e.g. to verify one session's cache doesn't leak into another's). It does **not**:

- accept a `user` override — it always logs in as the harness's default user;
- touch the shared `session` the harness manages;
- re-fire `callback`.

## The session gate

The test stone takes only 10 sessions at once (the gate asks the stone for its `StnMaxSessions` when the run starts). Before logging in, each file books the sessions it will use and waits, first come first served, until the stone has room, so a login is never refused for want of a slot (`sessionGate.globalSetup.ts`). Each `useIntegrationTest` call books its `sessions` option: the most sessions its suite has logged in at once. Most suites need 1, the default. A gem that has logged out but not yet left the stone still takes a slot, and the gate counts it as taken, but not against its file's booking.

For that, the gate has to know which sessions on the stone are whose, so **every login a test makes must be reported to it**, including logins made by app code the test calls:

- a second session: `reportedTransientLogin(session)`, never `session.transientLogin(...)`, which lint rejects in tests;
- a `SessionManager` the test builds: wrap it in `reportingLoginsOf(...)`, which also reports the logins it makes for itself, such as the one that ends a stopped run's gem;
- any other login: `reportLogin(own)`, which also reports its logout, or `reportRefusedLogin()` for a login that is meant to fail, but only when the stone itself refused it (`deniedByStone(err)`: a wrong user or password). That uses up a login serial; a login that never reached the stone, to an unknown stone or NetLDI, does not.

A reported session's serial is kept: `reportedSerialOf(own)` answers it without asking the stone again.

The harness's own `login()` and `withTransientSession` report for you.

## The commit invariant

Every session the harness creates — the shared one and any `withTransientSession` one — is armed with GemStone's own commit guard before it is handed to a test. A commit attempted by a test, or by the production code it exercises, fails at the commit site with `TransactionError 2249`, naming the harness in the error. There is currently **no opt-out** for those sessions: a test cannot commit on a session the harness handed it.

The guard is session-scoped, so it binds only the sessions the harness creates. Anything that reaches the stone through a session of its own is unarmed and _can_ commit to the shared stone. This is enforced using linter rules, but in case a test that spawns one is required, it owns the cleanup itself; the harness's transaction-abort cannot reach it.

Arming must be the harness's own doing. GemStone reports whether the call was the one that disabled commits, and the harness treats "they were already disabled" as a hard failure — by that point the invariant technically holds, but for a reason the harness did not establish (a `UserProfile` with `disableCommits`, a stone mid-restore). That is intentional: a whole matrix pass running under a guard the harness didn't arm is worse than a loud stop that makes the environment explain itself.

Declaring `allowedCommits` (see the options table above) opens that many levels of `System beginNestedTransaction` in `beforeEach`, plus one level of headroom, so a `System commitTransaction` performed by the test — or by the production code it exercises — lands in one of those nested levels instead of the harness's root transaction; `afterEach` then unwinds every level at once, discarding the nested commit along with everything else. This is the only way to let a test observe a real committed path rather than only ever the failure branch of committing code — but it is a candidate for a committing test, not a default fix for every one. See [integration test isolation](../explanation/integration-test-isolation.md) for the cases it doesn't cover and the zero-vs-`N` discontinuity in how the floor check is enforced.

**Aborts spend the budget too.** What the option buys is nested transaction levels, and GemStone collapses one whether the level was committed or aborted — the level counter is all the teardown check can see, so a `System abortTransaction` from the test or from the code under test spends budget exactly like a commit and, at the floor, fails with the same message. Count aborts in the number. Better still, avoid them in a budgeted suite: under nesting an abort unwinds only the innermost level, so a test written to observe "what survives an abort" is observing a nested level's rollback, not the repository's.

## Failure modes you'll actually hit

- **"this file logged in N session(s) it never reported"**: a login the gate was never told about, from the test or from app code it called, named by the test that was running when it appeared. Report it as above.
- **"this file had N sessions logged in at once, but booked M"**: the suite needs a bigger booking. The message gives the `sessions` value to pass.
- **"the session watching the test stone failed"**: the gate's own session on the stone ended mid-run, for instance because the stone was restarted. Every file still waiting on the gate fails with it, and so does the run. Restart the run once the stone is back.
- **"N login(s) came and went between two looks at the stone"**, at the end of the run: the same, for a login too short for the gate to see. Each is listed with the known serials either side of it (when each was seen or reported, in seconds into the run), the files running then, and the refusals reported near it, with what each was matched to. A refused login whose refusal was reported more than 2 s from it shows up here, as does a login from outside the test run.
- **The setup banner**: if no stone is reachable, `beforeAll` fails with a banner pointing at `npm run test:server:start`, prepended to the underlying login/library-load error.
- **`sessionCleanupFailed` poisoning the file**: if `afterEach` cleanup fails — including the commit-guard-still-armed check — every remaining test in that file fails fast in `beforeEach` rather than running against a session in an unknown state. Look at the _first_ failure in the file; it's the real one.
- **Session/oop identity**: `session` and any oop values are koffi pointer wrappers with no enumerable properties. `toEqual` treats any two of them as equal regardless of the underlying native pointer — compare with `toBe` when the assertion is about _which_ session or oop a call received, or wrap the argument in `sameObject(...)` (`client/src/__tests__/support/sameObject.ts`) inside `toHaveBeenCalledWith`.

## Running it

- `npm run test:server:start` / `:list` / `:stop` — provision, inspect, and tear down the test stone.
- `npm run test:server:check-plugin` — check that the test stone's server plugin is this checkout's.
- `npm run test:server:install-plugin` / `:uninstall-plugin` — install this checkout's server plugin into the test stone, or remove it.
- `npx vitest run <file>` from `client/` — run a single integration test file.
- CI runs the suite twice per matrix cell: once against a bare stone, once after installing the Jasper Server Plugin. See `.claude/rules/client/tests.md` for gating a test to one pass.
- Every run of the `default` project starts with that plugin check (`client/src/__tests__/serverPluginMatch.globalSetup.ts`). A plugin that isn't this checkout's is left alone, since it may be someone's work in progress, and every integration suite fails with the reason; unit tests still run. Install this checkout's with `test:server:install-plugin`. A plugin with no record of which it is gets replaced with this checkout's automatically. Either install commits into the stone, so on a stone shared by several worktrees it changes the plugin the others test against.
