# Integration test isolation

Background for [the harness reference](../reference/integration-test-harness.md): why `useIntegrationTest` is shaped the way it is. Worth reading before touching the commit guard or adding a new escape hatch.

## The setting

Integration tests run against one shared GemStone stone. Test _files_ run in parallel Vitest workers, each with its own login. CI runs the suite twice per matrix cell — bare, then with the Jasper Server Plugin installed — resetting the extent between matrix _cells_, but **not** between those two passes within a cell. Anything that survives the bare pass is still there for the plugin pass.

## Why transaction-abort is the isolation mechanism, and where it's weaker than it reads

`useIntegrationTest` wraps every test in a transaction that is always aborted, so a test's database changes never leak into the next one — as long as nothing commits. Three things make that promise weaker than it sounds:

1. **A commit promotes the session's entire transaction**, not just the change under test. One committing line inside an otherwise-unrelated test call promotes everything staged in that transaction.
2. **Committed data is global and durable.** It's visible to every other worker against the shared stone, and to the second CI pass, until something explicitly cleans it up.
3. **The invariant binds a session, not a test.** "Every test aborts" only holds if nothing in that test's session ever commits — including production code the test merely exercises. A single committing call anywhere in the session's lifetime breaks the guarantee for every test that shares it.

## Why the guard is armed at the session level, and why it's irreversible

The commit guard (`System disableCommitsWithReason:`) is armed once per session — in `login()` and in `withTransientSession()` — rather than per test, because the property it enforces ("this session never commits") is a session-level property, not a per-test one. There is no `enableCommits`; the only way out is `logout`. That's deliberate: a reversible guard would need to be re-armed after every operation that might have cleared it, which is exactly the kind of per-test bookkeeping the harness is trying to make unnecessary. Arming once, unconditionally, for the life of the session removes the whole category of "did we forget to re-arm" bugs.

## Why nested transactions, where a committing test fits it

A guard that always refuses commits leaves a real gap: a test that exercises a SUT whose behavior
depends on a commit actually succeeding cannot be written at all under the bare guard — it needs
some other mechanism to exist before it can be written, for the subset of committing tests that
mechanism actually covers. See the harness reference's ["nested" escape
hatch](../reference/integration-test-harness.md#commitstrategy-nested--let-a-tests-commit-land-then-discard-it-anyway)
for the mechanism itself and the cases it does not cover.

Containment is GemStone's own transaction machinery, not something the harness builds. Committing a
nested transaction promotes its changes one level up, to the parent transaction, and no further: they
reach the repository only if every level above commits too, ending in a top-level commit — the exact
commit the guard refuses. The two mechanisms compose. The nested levels catch a test's commit, the
guard makes sure it can never climb out of them, and the harness's existing abort discards the whole
chain however the test exited.

Two things follow. A session's uncommitted chain is invisible to every other session, so parallel
workers against the shared stone need no coordinating. And nothing survives the abort to find
afterward.

**Relationship to the commit guard.** The guard from the section above is what turns a
budget overrun into a loud, safe failure instead of silent corruption: a nested-transaction test whose
commits spill past its `commitDepth` budget lands in the session's real root transaction, exactly like
any other commit on a harness session, and hits the same `TransactionError 2249` the guard always
raises.
