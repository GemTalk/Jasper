# Why CI is shaped the way it is

The decisions behind this repo's CI that the workflow files don't make obvious. What each job does is in the workflows themselves.

## The matrix tests what users vary

Health Check uses one matrix to cover the ways real installs differ:

- **Platform.** Users run Jasper on Linux, macOS and Windows, and the server setup differs on each (Windows runs it inside WSL).
- **GemStone version.** Users connect to old stones as well as new ones. The oldest supported version is where GCI API gaps show up, which is why the single macOS leg uses it.
- **With and without the Jasper Server Plugin.** The plugin is optional for users, so both paths must work. Each leg runs the suite twice rather than doubling the number of legs.
- **The Node floor.** Users on an older VS Code run Jasper on that version's bundled Node, which is older than the one in `.nvmrc`. One leg runs on the floor's Node to catch code that only works on the newer one.

## Packaging and the secret scan run on every PR

Both are release-time concerns, but a release is the worst place to find out about them. Registry versions are immutable, so a publish that goes wrong spends the version number for good. Open VSX runs its secret scan on its own servers *after* accepting the upload, so a hit there can't be retried. That rejected 1.7.6 and 1.8.3, and packaging on its own broke a release twice (issue #351). Running the same package-and-scan workflow on every PR makes the PR that causes the problem fail, not the next release. [Publishing a release](../how-to/publishing-a-release.md#the-secret-scan) has the detail on the scan.

## Concurrency is the constraint, not minutes

The repo is public, so GitHub's standard hosted runners cost nothing and have no minute cap. What is limited is concurrency: GitHub runs at most 5 macOS jobs at once across the whole GemTalk organization, shared with every other GemTalk repo. Matrix legs run in parallel, so another macOS leg barely makes a run longer on its own, but it reduces how many PRs, here or in other GemTalk repos, can run macOS CI at the same time. That is one reason macOS has a single leg. With few people pushing at once the limit matters less, and the legs could come back. The same reasoning is behind cancelling a PR's running CI when a new push arrives.

Also keep in mind that GitHub's Windows runners can't run Linux Docker containers, which rules out GemStone in Docker on the Windows legs.

## The merge queue doesn't re-prove what a PR run already proved

A PR reaches the merge queue only after its own run passed, so the queue run only has to show the PR still works with whatever landed on `main` since. When nothing has, the queue's merge commit has exactly the same files as the one the PR run tested, and git gives both the same tree hash. A green PR run records that hash, and a queue run that finds a matching record from a GemTalk/Jasper run of the same PR skips the tests. A queue run that skipped says so in a notice under its run graph, naming the PR run it trusted, so its green check isn't mistaken for a full run.

Anything less certain runs the tests:

- no record, or an expired one;
- a PR run that has since failed, or hasn't finished. "Finished" means the whole run, including the skipped-tests report that comes after `ci-complete`, so a PR queued before that report finishes gets a full run;
- an API error or timeout.

Anyone with write access is trusted here: a PR's run executes the PR's own copy of the workflow, so it could record a hash it never tested. The PR-number match only stops one PR's run from vouching for another.

`main` itself is never skipped: the run on every push there is the full matrix, and the release accepts only that run's `ci-complete`, never the queue's, which lands on the same commit and finishes first. That push run is also the only check of what the tree hash can't see, such as a new runner image, a changed repo variable or a different GemStone download, so a red run on `main` needs looking into, not just a re-run.

To inspect a record by hand: the record is an artifact named `tested-tree-<hash>` on the PR run, kept for 14 days. `git rev-parse '<commit>^{tree}'` gives a commit's hash, and `gh api "repos/GemTalk/Jasper/actions/artifacts?name=tested-tree-<hash>"` lists the runs that recorded it.

When the queue does run the tests, a failing client test is tried once more before it fails the run. Only that test is repeated, with its `beforeEach`/`afterEach` but not its file's `beforeAll`, so a flake that leaves the shared session busy fails its retry too. The server and MCP suites don't retry: they write no report, so a retry there would hide its flake. Without that, a flake ejects the PR and restarts all its jobs, and most queue failures are flakes. Only the queue retries, so PR runs still show every flake, and a test that needed its retry is listed in the run's annotations and job summary so it still gets fixed.

## The skipped-tests report doesn't fail the build yet

Some tests skip themselves when their prerequisites are missing, and CI can't provide all of them. It has no Rowan or Grail extent, for example, and as of November 2026 the Tonel integration tests skip too. The report lists the tests skipped in every leg, meaning no CI run ever executes them. It is report-only because failing on it today would block every PR on gaps in the CI environment, not on the change being tested. The goal is to get the list to zero and then make it a gate.
