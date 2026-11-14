# CI handoff: slowness and flakes (as of 2026-11-13)

Read this first. The full evidence is in [ci-research-2026-11.md](ci-research-2026-11.md). Raw data is in `ci-research-2026-11-data/` (see "Where the data is" at the end).

Scope: the Health Check workflow only, Sep 10 to Nov 13 2026.

## In one minute

1. **CI legs got about 60% slower since September.** An Ubuntu leg went from 3.6 to 6.5 minutes. A Windows leg went from 7.2 to 10.4. A run lasts as long as its slowest leg, so recent runs should take about 11 minutes (the first measurement, over the whole window, was 8.8). I measured leg times for the recent period, not run wall time.
2. **The big step happened Oct 28 to 30.** Several new GemStone integration test files appeared, adding about 170 seconds of test time per leg. The PRs that added them look like #809 and #821 (correlation, not proven).
3. **Windows is the slowest leg in about 92% of runs.** Tests run twice per leg (without and with the server plugin), so every test file is paid for twice.
4. **About 16% of `main` pushes and 23% of merge-queue runs failed** in the window. Most failures are flaky tests, not real bugs.
5. **Several flakes were fixed this week** (see "What already got fixed"). The ones that remain are mostly the GemStone stop/logout/session tests and the session gate teardown.

## What is validated (checked against GitHub data or code)

Each item below was measured from run, job, step or log data, or read in the code.

- **Run and leg timings**: all 1,000 runs in the window, 20,291 jobs, step durations per job. Wall time, queue time and leg time numbers are measured, not estimated.
- **No job hit its timeout.** Of 143 cancelled legs that ran close to their limit, none logged "exceeded the maximum execution time".
- **Queue time is not a problem.** Median 3 s. One job in a hundred waited 5 to 8 minutes, and the worst waited 35 minutes.
- **The weekly slowdown trend** and the **Oct 28 to 30 step**: measured from step durations of green legs. The new test files that appear between a green log of Oct 28 and one of Oct 30 are measured.
- **The failure catalogue**: 250 failed legs in the first window and 27 in the Nov 12 to 13 update were downloaded and read. Failing test names, first error lines and dates are from the logs.
- **Four flake causes confirmed in code or commits**:
  - `activeSession` and `forceStopSurfaces` fail in a 15 s `vi.waitFor` waiting for the stone to deregister a stopped gem. A timeout bump on Oct 29 did not fix it (20 of 29 failures came after it).
  - `rowanLoad` ran real git clones in a 20 s test. It was replaced by a mocked git on Nov 10 and 11, and has not failed since Nov 3.
  - `versionExtract` runs a real `hdiutil attach` and throws when the last output line has no mount point (`versionManager.ts:613`).
  - `lintSupplyChain` spawns `node` and `npm` per case. It takes 51 s on Windows against 14 s on Ubuntu.
- **The skipped-tests report crash**: 23 of 25 failures are `TypeError ... localeCompare` from `scripts/summarize-skipped-tests.mjs:60`.
- **Merge queue skipping works**: 7 of 13 queue runs after #884 finished in under a minute.
- **Login-limit failures dropped** after #865: 15 jobs before, 1 after on `main` or the queue.

## What is NOT validated

Treat everything in this section as a lead, not a finding.

### A. Root causes I never found

| Flake | What is known | What is missing |
|---|---|---|
| `sunitRunNb` ("session is busy", break 6003) | The error text and dates | Why the session is still busy. No code read. |
| `transcriptSink` (`expected 2366 to be +0`, cascades) | The error text and dates | Cause of the failing assertion. Cascade tests ("a previous test's cleanup failed") inflate the counts. |
| `forceStop`, `stopSlowGem` | Error text and dates | Cause. No code read. |
| `activeSession`, `forceStopSurfaces` | They wait 15 s for the stone to deregister a gem and sometimes it does not | **Why** the stone is slow or never deregisters. A longer timeout did not help. |
| Session gate teardown ("login(s) ... never reported") | It fails the step after all tests pass. It is now the top failure (12 of 27 recent failed legs). | Which code logs in without reporting, and why only sometimes. It also defeats the merge queue's retry. |
| `browserQueries` "missing LGC_CALL_FINISH_RPC_LOGIN" | Two occurrences, Nov 12 and 13 | Everything else. New, unexamined. |
| Windows WSL setup failures | apt 404, DNS failure, WSL timeout, "action has timed out" (7 jobs) | Whether they are runner/network luck or something we can harden. |
| Linux `gs-test-server.sh` exit 3 | 8 jobs, all on Oct 20 | Cause. (A glibc fix `428d2793` merged Oct 20, which fits, but I did not confirm.) |
| 5 Windows legs (Nov 12 to 13) | They failed in the test step | They have no test failure line and no gate message. Not read. |

### B. Claims that rest on someone else's word

- **The hdiutil cause** (flake #7). PR #926's description says hdiutil sorts lines as text, so "disk10" sorts before "disk9". It matches the log lines I saw, but I did not reproduce it. #926 is still open.
- **#917's "saves about 45 s per pass"** is the PR author's number. I have no macOS runs after its merge.
- **The session limit of 10** (#865's description). My log data shows the gate using 9, which is consistent, but I did not check the stone configuration.

### C. Correlations, not proof

- **#809 and #821 caused the Oct 28 to 30 slowdown.** Evidence: new files appear in a green log between the two dates, and those PRs touched them. I compared one log per day and did not revert or bisect anything. Other PRs that landed those days could also add time.
- **Why macOS legs caught up with Windows** was checked with one log per platform per week (30 logs). `versionExtract` (macOS only) and the stop tests running slower on macOS explain most of it. Why the stop tests are slower on macOS than on Windows is not known. One log per week is noisy.
- **Other slowdown contributors** (GemStone 3.7.6 legs from Nov 6, the extra tests from #890 on Nov 11) were not separated out.
- **Why the integration tests are slow**: I read only `stopSlowGem` and `transcriptSink`, and saw real `sleep`/`Delay` calls. I did not read the others.

### D. Too early to say whether a fix worked

| Fix | Data after the merge |
|---|---|
| #894 (`rowanLoad`) | 2 days |
| #919 (`lintSupplyChain` once) | Under 1 day |
| #917 (macOS dmg once per file) | No macOS runs yet |
| #884 (queue skip and retry) | 13 queue runs. The retry rescued nothing I could see. |
| #914 (gate starts lazily) | Gate failures still appear on Nov 13 |

### E. Gaps in coverage and method

- **Flake definition is a judgment.** I counted a failure as a flake when it hit `main` or the merge queue, or passed on rerun with no code change. Failures that happen only on a PR with no rerun are unconfirmed either way.
- **Real bugs vs flakes**: I set aside `mcpPanel`, `classOrganizerSubclasses`, `classCacheAfterApply` and `clientDownload` as real PR bugs because every leg failed and none passed. I did not read those PRs to confirm.
- **Experiment branches are mixed in.** The first window's PR failure rate (18%) includes PRs and experiment pushes. Only `main` push (16%) and queue (23.5%) are clean. The Nov 12 to 13 update separates `wip/*` and `throwaway/*` branches.
- **My numbers differ from Eric's** in #894 ("13 logged hits" for `rowanLoad` vs my 19 failed jobs) and #884 ("25 failed queue legs" vs my 46 failed queue runs). Different windows and units (jobs vs runs). I did not reconcile them.
- **Per-test counts include cascades.** One root failure can fail several later tests in the same file. The failed-jobs column is the safer number.
- **Slowest tests**: sample of 8 green legs per platform. Vitest prints only files and tests of about 1 s or more. File times are per file, summed over both runs. They do not show which file bounds the wall time of the run (the critical path), because files run in parallel. I did not find the critical path.
- **Is the second test run needed?** Tests run twice per leg (without and with the server plugin). I measured the cost (about 100 to 160 s per run) but did not check what the second run catches that the first does not.
- **Cancelled legs**: 60 of 143 near-limit cancellations show "operation was canceled". The other 83 I did not classify further (probably superseded runs, not verified).
- **Queue time sample**: 300 green runs only.
- **Other workflows**: only a shallow look. The all-workflow listing is capped at the 1,000 newest runs. Not examined: 11 Dependabot update failures (minimatch, msal-node), 3 CodeQL `startup_failure`, the Package workflow, Branch Health, Windows Health Check.
- **Lint and install failures**: classified from error lines only. The `ESLint` errors are in PR code, not CI. The `ECONNRESET` and the TLS error on checkout are one-offs.

## What already got fixed (merged PRs)

| PR | Date | What it does | Flake or cost it targets |
|---|---|---|---|
| #894 | Nov 11 | `rowanLoad` tests use a mocked git | `rowanLoad` Windows timeouts |
| #865 | Nov 6 | Test files book stone sessions in a gate | Login-limit failures |
| #884 | Nov 11 | Queue skips tests a PR run already passed, retries a failing client test once | Queue ejections from flakes; queue wall time |
| #919 | Nov 12 | `lintSupplyChain` runs once, not per leg | Windows leg time, `lintSupplyChain` timeouts |
| #917 | Nov 12 | macOS disk image built once per file | macOS leg time |
| #914 | Nov 12 | Gate starts on first booking, unit tests need no stone | Developer experience (not a CI flake) |
| #882 | Nov 11 | Adds GemStone 3.7.6 to the matrix, fixes a refused logout | Coverage (adds legs and time) |
| #926 | open | Mounts the dmg at a chosen folder, retries `hdiutil create` | `versionExtract` macOS flake |

## Suggested next steps (my recommendation, in priority order)

1. **Fix the gate teardown failure.** It is the largest recent cause of red runs and the queue retry cannot help. Find which test worker logs in without reporting. The failure message names the login serial and worker process.
2. **Merge #926** to close the macOS dmg flake, then watch macOS runs for a week.
3. **Investigate the stone deregistration delay** behind `activeSession` and `forceStopSurfaces`. A longer wait will not fix it, so the stone or the test's assumption needs a look.
4. **Read the code of the not-yet-explained flakes** (`sunitRunNb`, `transcriptSink`, `forceStop`, `stopSlowGem`). They share the "session still busy after a stop" family, so one cause may explain several.
5. **Cut leg time.** Options to evaluate, none tested: run the second pass (with server plugin) only where it matters, trim the 10 to 20 s waits in the stop tests, shard the Windows leg. First measure the critical path of the vitest run.
6. **Re-measure in a week.** Re-run the same queries after #894, #919, #917 and #926 have time in the data. The scripts are in the data folder.

## How the numbers were made (so you can redo them)

- Runs: `gh api repos/GemTalk/Jasper/actions/workflows/279672347/runs` (Health Check).
- Jobs and steps: `gh api repos/GemTalk/Jasper/actions/runs/{id}/jobs?filter=all`.
- Logs: `gh api repos/GemTalk/Jasper/actions/jobs/{id}/logs`.
- Flake definition: a failure on `main` or the merge queue, or a pass on rerun with no code change.
- GitHub keeps logs for about 90 days. Logs from Sep 10 expire around Dec 9. The archive in the data folder is the only copy after that.

## Where the data is

In `docs/ci-research-2026-11-data/`:

- `raw-logs-and-jobs.tar.gz`: step timings for every run, the 250 failed-leg logs, 24 green-leg logs, other-failure and queue-time files.
- `update-2026-11-13.tar.gz`: the Nov 12 to 13 runs and logs, merged-PR lists and file lists, the Oct 28 vs Oct 30 log comparison.
- `fails.json`, `health_runs.tsv`, `merged-prs.tsv`, `filemed.json` and the other tables.
- `scripts/`: the Python, jq and shell scripts used. They use absolute scratchpad paths, so edit those first.

## Glossary

- **Leg**: one job of the Health Check matrix, one OS and GemStone version (for example "windows-latest 3.7.5").
- **Merge queue**: GitHub's queue that re-runs CI on a PR merged with the latest `main` before it lands.
- **Gate (session gate)**: the test harness piece from #865 that books stone sessions so tests do not exceed the stone's limit.
- **Stone**: the GemStone database server the integration tests log in to.
- **Gem**: a GemStone session process.
- **Rerun-green**: a run that failed, then passed on rerun with no code change.
