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

The `callback` fires once **per login**, not once per file: at the end of `beforeAll`, and again any time a test calls `login()` (including the automatic re-login after a test calls `logout()`). Capture the fields you need into variables your tests read, and expect those variables to be reassigned across a file that logs in more than once.

A `login()` from _inside_ a test gets a session of its own, which starts outside the transaction `beforeEach` opened and carries none of the nested levels opened within it. The harness re-opens both on the new session unconditionally, so the rest of the test keeps whatever commit budget the suite declared — zero included.

## Hook order

| Hook         | Does, in order                                                                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beforeAll`  | Set `GEMSTONE_GLOBAL_DIR` → load the GCI library → login → **arm the commit guard** → `resetNonTransactionalSessionState` → fire `callback`                                                                                         |
| `beforeEach` | Poison check (fail fast if a previous test's cleanup failed) → auto re-login if a prior test called `logout()` → `beginTransaction` → open the `allowedCommits` level budget (a no-op at `0`) → `resetNonTransactionalSessionState` |
| `afterEach`  | **assert the commit guard is still armed** → read the transaction level and unwind every level → `resetNonTransactionalSessionState` → the budget floor check (skipped at `allowedCommits: 0`)                                      |
| `afterAll`   | logout → close the library → restore `GEMSTONE_GLOBAL_DIR`                                                                                                                                                                          |

## `login({ user })` and `withTransientSession`

Use `login({ user: 'SystemUser' })` to re-authenticate as a different identity on the _same_ shared session — this re-fires `callback`.

Use `withTransientSession` when a test needs a second, independent session (e.g. to verify one session's cache doesn't leak into another's). It does **not**:

- accept a `user` override — it always logs in as the harness's default user;
- touch the shared `session` the harness manages;
- re-fire `callback`.

## The commit invariant

Every session the harness creates — the shared one and any `withTransientSession` one — is armed with GemStone's own commit guard before it is handed to a test. A commit attempted by a test, or by the production code it exercises, fails at the commit site with `TransactionError 2249`, naming the harness in the error. There is currently **no opt-out** for those sessions: a test cannot commit on a session the harness handed it.

The guard is session-scoped, so it binds only the sessions the harness creates. Anything that reaches the stone through a session of its own is unarmed and _can_ commit to the shared stone. A test that spawns one owns the cleanup itself; the harness's transaction-abort cannot reach it.

Arming must be the harness's own doing. GemStone reports whether the call was the one that disabled commits, and the harness treats "they were already disabled" as a hard failure — by that point the invariant technically holds, but for a reason the harness did not establish (a `UserProfile` with `disableCommits`, a stone mid-restore). That is intentional: a whole matrix pass running under a guard the harness didn't arm is worse than a loud stop that makes the environment explain itself.

Declaring `allowedCommits` (see the options table above) opens that many levels of `System beginNestedTransaction` in `beforeEach`, plus one level of headroom, so a `System commitTransaction` performed by the test — or by the production code it exercises — lands in one of those nested levels instead of the harness's root transaction; `afterEach` then unwinds every level at once, discarding the nested commit along with everything else. This is the only way to let a test observe a real committed path rather than only ever the failure branch of committing code — but it is a candidate for a committing test, not a default fix for every one. See [integration test isolation](../explanation/integration-test-isolation.md) for the cases it doesn't cover and the zero-vs-`N` discontinuity in how the floor check is enforced.

**Aborts spend the budget too.** What the option buys is nested transaction levels, and GemStone collapses one whether the level was committed or aborted — the level counter is all the teardown check can see, so a `System abortTransaction` from the test or from the code under test spends budget exactly like a commit and, at the floor, fails with the same message. Count aborts in the number. Better still, avoid them in a budgeted suite: under nesting an abort unwinds only the innermost level, so a test written to observe "what survives an abort" is observing a nested level's rollback, not the repository's.

## Failure modes you'll actually hit

- **The setup banner**: if no stone is reachable, `beforeAll` fails with a banner pointing at `npm run test:server:start`, prepended to the underlying login/library-load error.
- **`sessionCleanupFailed` poisoning the file**: if `afterEach` cleanup fails — including the commit-guard-still-armed check — every remaining test in that file fails fast in `beforeEach` rather than running against a session in an unknown state. Look at the _first_ failure in the file; it's the real one.
- **Session/oop identity**: `session` and any oop values are koffi pointer wrappers with no enumerable properties. `toEqual` treats any two of them as equal regardless of the underlying native pointer — compare with `toBe` when the assertion is about _which_ session or oop a call received.

## Running it

- `npm run test:server:start` / `:list` / `:stop` — provision, inspect, and tear down the test stone.
- `npx vitest run <file>` from `client/` — run a single integration test file.
- CI runs the suite twice per matrix cell: once against a bare stone, once after installing the Jasper Server Plugin. See `.claude/rules/client/tests.md` for gating a test to one pass.
