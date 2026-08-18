# Integration test harness (`useIntegrationTest`)

Lookup for someone about to write a stone-dependent test. See [integration test isolation](../explanation/integration-test-isolation.md) for why the harness is shaped this way.

## What it provides

Call `useIntegrationTest(callback)` at the top of a `describe` block. The `callback` receives a `GciTestContext`:

| Field                            | What it is                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `gciLibrary`                     | The loaded `GciLibrary` instance for this suite.                                                                        |
| `session`                        | The current session — an opaque koffi handle. Do not compare it with `toEqual` (see "Failure modes" below); use `toBe`. |
| `login(options?)`                | Logs in again, optionally as a different `user`. Re-invokes `callback` with the fresh context.                          |
| `logout()`                       | Logs out the current session and clears it. Returns the now-invalid session handle.                                     |
| `withTransientSession(callback)` | Runs `callback` against a second, independent session, then always logs it out.                                         |

The `callback` fires once **per login**, not once per file: at the end of `beforeAll`, and again any time a test calls `login()` (including the automatic re-login after a test calls `logout()`). Capture the fields you need into variables your tests read, and expect those variables to be reassigned across a file that logs in more than once.

A `login()` from _inside_ a test gets a session of its own, which starts outside the transaction `beforeEach` opened and carries none of the nested levels opened within it. Under `commitStrategy: 'nested'` the harness re-opens both on the new session, so the rest of the test keeps the commit budget the part before the logout ran under. Under the default strategy it doesn't need to: that session is in autoBegin mode, so the teardown abort still discards its work.

## Hook order

| Hook         | Does, in order                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `beforeAll`  | Set `GEMSTONE_GLOBAL_DIR` → load the GCI library → login → **arm the commit guard** → `resetNonTransactionalSessionState` → fire `callback` |
| `beforeEach` | Poison check (fail fast if a previous test's cleanup failed) → auto re-login if a prior test called `logout()` → `beginTransaction` → under `'nested'`, open the level budget → `resetNonTransactionalSessionState` |
| `afterEach`  | **assert the commit guard is still armed** → `abortTransaction` (one per open level under `'nested'`) → `resetNonTransactionalSessionState` → under `'nested'`, the budget check                                    |
| `afterAll`   | logout → close the library → restore `GEMSTONE_GLOBAL_DIR`                                                                                  |

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

### Escape hatches

#### `commitStrategy: 'nested'` — let a test's commit land, then discard it anyway

```ts
useIntegrationTest(callback, { commitStrategy: 'nested', commitDepth: N });
```

Opens `N` levels of `System beginNestedTransaction` in `beforeEach`, after the existing
`beginTransaction`. A `System commitTransaction` performed by the test — or by the production code
it exercises — lands in one of those nested levels instead of the harness's root transaction. In
`afterEach`, the transaction level is read _before_ the existing abort runs, then that many
`System abortTransaction`s unwind every level at once, discarding the nested commit along with
everything else. This is the only strategy that lets a test observe a real committed path rather
than only ever the failure branch of committing code.

**Where `N` comes from.** `commitDepth` is required, with no default: count every commit the test
_and_ the System-under-test perform, one nested level each — it is a property of the fixture, not
of the harness, so it cannot be guessed generically. Provision one level of headroom above that
exact count. The minimum is therefore `1` — a test that commits nothing, plus its headroom. A
`commitDepth` below that, or one that isn't a whole number, describes a budget that cannot be
opened, and is refused where the suite declares it rather than at any test's teardown.

**The teardown guard rail.** After the abort, if the transaction level fell to _at or below_
`floorLevel` (the level right after opening, minus `commitDepth`), the harness throws naming the
budget and the observed level, telling the author to raise `commitDepth`. `floorLevel` is
re-derived every time the budget is opened, so a mid-test re-login is policed against its own
session rather than the one it replaced.

**This strategy is a candidate for a committing test, not a default fix for every one.** Check a
test against these before reaching for it:

- A _second session or gem_ must observe the committed state — nothing written inside a nested
  transaction is visible outside the session that opened it.
- The production code's commit path depends on data being _genuinely_ persisted, not just
  nested-committed — a nested commit only promotes an object as far as the parent transaction,
  never into the repository, so code that scans the repository for a prior version finds nothing.
  If unsure whether this applies, spike it first in a throwaway test before writing the real one:
  the failure mode when it's wrong can be silent (a green `committed: true` next to an unnoticed
  residue commit), not an obviously wrong number.
- The test needs to **destroy or replace the whole repository** — a different problem a nested
  transaction has nothing to do with.

## Failure modes you'll actually hit

- **The setup banner**: if no stone is reachable, `beforeAll` fails with a banner pointing at `npm run test:server:start`, prepended to the underlying login/library-load error.
- **`sessionCleanupFailed` poisoning the file**: if `afterEach` cleanup fails — including the commit-guard-still-armed check — every remaining test in that file fails fast in `beforeEach` rather than running against a session in an unknown state. Look at the _first_ failure in the file; it's the real one.
- **Session/oop identity**: `session` and any oop values are koffi pointer wrappers with no enumerable properties. `toEqual` treats any two of them as equal regardless of the underlying native pointer — compare with `toBe` when the assertion is about _which_ session or oop a call received.

## Running it

- `npm run test:server:start` / `:list` / `:stop` — provision, inspect, and tear down the test stone.
- `npx vitest run <file>` from `client/` — run a single integration test file.
- CI runs the suite twice per matrix cell: once against a bare stone, once after installing the Jasper Server Plugin. See `.claude/rules/client/tests.md` for gating a test to one pass.
