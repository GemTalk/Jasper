# CI research: slowness and flakes (Health Check workflow)

Researched 2026-11-12 from GitHub Actions data (`gh api`), not inference.
Window: all 1,000 Health Check runs, 2026-09-10 to 2026-11-12 (run numbers 1904 to 2902, contiguous).
Scope: Health Check only. Other workflows got a shallow pass (see the end).

## Update 2026-11-13: merged PRs and fresh runs

Sources: 168 PRs merged since Sep 10 (`gh pr list --state merged`, bodies of the fix PRs, files per PR), plus 67 new Health Check runs (run numbers above 2902, up to Nov 13 14:17). Raw data in `docs/ci-research-2026-11-data/update-2026-11-13.tar.gz`. Runs on `npapagna/wip/*` and `throwaway/*` branches are deliberate experiments; they are counted separately where it matters.

### Fixes that landed since the research window began

| PR (merged) | What it changes | Effect seen in CI data |
|---|---|---|
| #894 (Nov 11) | `rowanLoad` uses a mocked git instead of real repos (flake #5) | 0 failures since Nov 3. Only 2 days of data. |
| #865 (Nov 6) | Test files book stone sessions in a session gate (flake #8) | Login-limit failures fell from 15 jobs before to 1 after, on `main`/queue (Nov 11, queue run of PR #885), plus 1 on a throwaway branch. |
| #884 (Nov 11) | Merge queue skips tests a PR run already passed, and retries a failing client test once | 7 of 13 queue runs since took 0.3 to 0.9 min (skipped). The retry (`VITEST_RETRY: 1`) cannot rescue the gate teardown failure (see below). |
| #919 (Nov 12) | `lintSupplyChain` runs once in Lint & Format, not in every leg (flake #10, slowest-files table) | One more timeout on Nov 12 13:08, before the merge. None after. |
| #917 (Nov 12) | macOS disk-image fixture built once per file (about 45 s per pass saved, per its body) | No macOS data after the merge yet. |
| #914 (Nov 12) | Session gate logs in on first booking, so unit tests need no stone | Gate teardown failures continue after it (Nov 13 14:17). |
| #882 (Nov 11) | CI tests GemStone 3.7.6; fixes a refused logout leaving its session running | Adds a leg (ubuntu and windows 3.7.6). 3.7.6 legs appear in the new failures. |
| #926 (open) | Mounts the dmg at a folder Jasper picks (`-mountpoint`) and retries `hdiutil create` | Its body names the root cause of flake #7: hdiutil sorts attach lines as text, so "disk10" sorts before "disk9", and the last line is `/dev/disk9s1 Apple_APFS` with no mount point. That explanation is the PR author's; I have not verified it. It matches the log evidence (the last line in the failures). |

### Still failing after the fixes (new data, 27 failed legs)

- Gate teardown, all tests green but the step fails: 12 of 27 failed legs (10 on real branches). Two messages: "login(s) came and went... no file reported them" and, after #914, "N login(s) from test workers were never reported to the gate, outside any file's booking". It is now the top failure in the new data. It also failed 3 of the 13 queue runs, and the retry from #884 does not help, since it happens at teardown.
- Still seen: `activeSession` (several tests, ubuntu and macOS), `forceStopSurfaces` (windows, macOS), `forceStop` (windows, also "expected 2397 to be less than 2000"), `sunitRunNb` ("session is busy", windows, on `main`), `transcriptSink` (`expected 2366 to be +0`, ubuntu on `main`).
- New: `browserQueries` "Transient login failed: ... missing LGC_CALL_FINISH_RPC_LOGIN, missing nbEnd after nbLo..." on ubuntu 3.7.5 (`main`, Nov 12 22:23) and windows 3.7.2 (Nov 13).
- Unparsed: 5 Windows legs with no `FAIL` line and no gate message (not examined).

### CI has been getting slower, not just slow (correction)

The window medians above hide a trend. Median "Run tests (without server plugin)" and leg time of green legs, by ISO week:

| Week | ubuntu tests step | ubuntu leg | windows tests step | windows leg |
|---|---|---|---|---|
| 37 | 75 s | 3.6 min | 120 s | 7.2 min |
| 40 | 93 s | 4.1 | 135 s | 7.5 |
| 43 | 104 s | 4.5 | 152 s | 8.2 |
| 44 | 129 s | 5.2 | 177 s | 9.1 |
| 45 | 155 s | 6.7 | 198 s | 10.5 |
| 46 | 152 s | 6.5 | 197 s | 10.4 |

Recent legs (Nov 12 and 13, n = 275 ubuntu, 165 windows, 27 macOS) have a median leg of 6.4, 10.7 and 10.8 min. That is above the 4.2, 7.7 and 6.6 min medians quoted in "Why CI is slow".

The step is dated. Daily ubuntu 3.7.5 tests step: Oct 26 to 28 about 117 s, Oct 30 150 s, then flat at 145 to 168 s. Comparing a green ubuntu 3.7.5 log from Oct 28 with one from Oct 30:

| File (both runs added) | Oct 28 | Oct 30 |
|---|---|---|
| `forceStop.integration` | absent | 54 s |
| `forceStopLogout.integration` | absent | 38 s |
| `conditionalBreakpointStop.integration` | absent | 33 s |
| `stoneSessions.integration` | absent | 18 s |
| `forceStopSurfaces.integration` | absent | 12 s |
| `transcriptSink.integration` | 9 s | 29 s |
| `activeSession.integration` | 4 s | 14 s |
| sum of files over 1 s | 332 s | 504 s |
| client tests passed (first run) | 12,005 | 12,351 |

Those files were touched by #809 (merged Oct 28 21:11, "Make every Stop behave the same...") and #821 (Oct 30, "See every session on a stone, and end one"), per the file lists of the merged PRs. The file times show the new files appearing between the two logs. That these two PRs caused it is a correlation from file lists and dates, not tested by reverting them. The same files make up most of the slowest-tests table and most of the flake list (#1, #4, #11).

Other additions since: GemStone 3.7.6 legs (Nov 6, adds two legs per run), and #890 "Run the Jasper tests that never ran in CI" (Nov 11, adds tests). Their per-leg cost was not isolated.

### Why macOS legs caught up with Windows

Daily medians (leg time): macOS 3.1 min on Sep 10, 6.5 on Oct 8, 7.8 on Oct 21 (Windows 7.9), 8.6 on Oct 28 (Windows 8.8), 9.5 on Oct 30 (Windows 9.5), 10.9 on Nov 12 (Windows 10.8). macOS's two test steps grew from about 1.0 min each (Sep 10) to about 4.6 (Nov 12), 4.6 times. Windows's grew from about 2 to 3.4, 1.8 times. So #809 did not cause the catch-up by itself.

To see which files did it, I took one green first-attempt `3.6.2` leg per platform per ISO week (30 logs, weeks 37 to 46, merge-queue runs and `wip/*` branches left out) and compared per-file time (both test runs added, files over 1 s only). One log per week is noisy.

| What | macOS | Windows | Ubuntu |
|---|---|---|---|
| Week 37, listed files total | 160 s | 253 s | 119 s |
| Week 46, listed files total | 728 s | 623 s | 641 s |
| `versionExtract` (appears week 40, Sep 28 on) | 76 to 106 s | 0 | 5 s |
| `stopSlowGem` (appears week 43) | 64 to 70 s | 38 to 42 s | 64 to 70 s |
| `forceStop` (appears week 44, #809) | 50 to 58 s | 40 to 45 s | 51 to 60 s |
| `activeSession`, week 46 | 23 s | 16 s | 18 s |
| `lintSupplyChain`, weeks 37 to 45 | 14 to 28 s | 26 to 63 s | 9 to 21 s |

- In week 37 Windows led macOS by 92 s in the listed files, mostly Windows-only slowness: `lintSupplyChain` (34 s against 21), `registerUnregisterRoundTrip` (21 s against 0) and `rowanLoad` (13 s against 4).
- By week 46 macOS led Windows by 105 s. `versionExtract` (macOS only, real `hdiutil` and `cp`) accounts for 99 s of that. The stop tests (`stopSlowGem`, `forceStop`, `activeSession`) run slower on macOS than on Windows. Windows is still slower on `lintSupplyChain` (42 s against 0 on macOS) and `registerUnregisterRoundTrip`.
- `stopSlowGem` appears in week 43, before #809's merge (#776 also touched it). #809's files (`forceStop`, `forceStopLogout`, `conditionalBreakpointStop`, `forceStopSurfaces`) appear in week 44.
- The macOS `lintSupplyChain` value of 0 in week 46 is probably a sample taken after #919's merge. I did not check.
- Not found: why `stopSlowGem` and `forceStop` run slower on macOS than on Windows. The weekly "client vitest Duration" numbers from the same logs are single samples, so they are not quoted here.

## Method

- Runs: `actions/workflows/279672347/runs` (capped at 1,000 by the API; the window above is complete within the cap).
- Jobs and steps: `actions/runs/{id}/jobs?filter=all` for every run (20,291 jobs). 9 runs had zero jobs (cancelled before start).
- Failed matrix legs: 250 job logs downloaded, ANSI stripped, `FAIL` lines and first error extracted.
- Cancelled legs near their timeout: 143 logs checked for "exceeded the maximum execution time".
- Queue time: `created_at` to `started_at` for 5,706 jobs from 300 green runs.
- Slow tests: logs of 24 recent green legs (8 each of ubuntu 3.7.5, windows 3.7.5, macos 3.6.2). Vitest prints only files and tests of about 1 s or more. File times add up both runs per leg (without and with server plugin).
- Flake definition: a failure on `main` or the merge queue (code already passed on its PR), or a pass on rerun with no code change. PR-only failures with no rerun are unconfirmed either way.

## Why CI is slow

- Green PR run: median 8.8 min wall, p90 11.4. Merge queue median 9.1 (p90 12.2). Push median 8.7 (p90 11.2).
- Time before the matrix starts is about 0.2 min. Queue time per job: median 3 s (macOS 7 s), p99 309 to 506 s, max 2,125 s. Not a cause.
- Windows is the slowest leg in 322 of 340 green PR runs (macOS 18).
- Median leg time (green): ubuntu 4.2 min, macOS 3.6.2 6.6, windows 7.7 (p90 10.3).
- Tests run twice per leg ("without server plugin", "with server plugin"). Median per step: ubuntu 98 s and 107 s, macOS 151 s and 166 s, windows 143 s and 156 s.
  - Test steps are about 65% of a Windows leg and about 80% of macOS and Ubuntu legs.
- Windows overhead medians: Setup GemStone (WSL) 86 s, Install dependencies 24 s, Setup Node 17 s, Checkout 9 s, Compile 8 s, Cache 5 s.
- Runner hours: ubuntu success 410 h, windows success 530 h, macOS success 89 h. Cancelled legs (superseded runs) 199 h. Failed legs 20 h.
- 106 runs have attempt greater than 1. 83 runs went green only after a rerun. Each rerun costs about 9 min wall.
- Timeouts: none. Of 143 cancelled legs near their limit, 0 hit the maximum execution time (60 logs show "The operation was canceled").

## Failure rates

| Event | Failed / (green + failed) |
|---|---|
| main push | 23 / 140 (16%) |
| merge queue | 46 / 196 (23.5%) |
| PR | 94 / 510 (18%) |

69 failed runs were on merge queue or main.

Failed matrix legs by step: tests without plugin 124, with plugin 97, Install dependencies 12, Setup GemStone Linux 8, Setup GemStone Windows 7, others 2.

## Flake list

"Mq/main" and "rerun-green" count runs.

| # | Flake | Failed jobs | Window | Mq/main | Rerun-green | Notes |
|---|---|---|---|---|---|---|
| 1 | `activeSession.integration` (3 tests) | 29 | Oct 22 to Nov 11 | 17 | 8 | `expected true to be false`; ubuntu 20, windows 6, macOS 3 |
| 2 | `sunitRunNb.integration` | 17 | Sep 11 to Nov 11 | 9 | 4 | "session is busy", "GciTsNb operation in progress", break 6003 |
| 3 | `transcriptSink.integration` | 20 | Sep 24 to Nov 6 | 8 | 4 | assertions plus cascades ("a previous test's cleanup failed") |
| 4 | `forceStopSurfaces.integration` | 18 | Oct 30 to Nov 11 | 6 | 7 | "fails a save made during a run" (11 jobs), plus login limit |
| 5 | `rowanLoad` `updateGitRepo` | 19 | Sep 10 to Nov 3 | 6 | 5 | Windows only, 20 s timeout. Fixed Nov 10 and 11 (mocked git) |
| 6 | `registerUnregisterRoundTrip` | 12 | Sep 10 to Oct 27 | 3 | 2 | Windows only, 5 s timeout. Not seen since Oct 27 |
| 7 | `versionExtract` (macOS dmg) | 12 | Sep 28 to Nov 12 | 5 | 3 | `Failed to parse mount point from: /dev/disk9s1 Apple_APFS` (9 jobs), plus `cp` failure assertion |
| 8 | Stone login limit ("maximum number of users are already logged in") | 15 | Sep to Nov | 9 | n/a | across `forceStopSurfaces`, `gciLibrary`, `stoneSessions`, `conditionalBreakpointStop` |
| 9 | Session gate teardown (tests pass, step fails: "N login(s) came and went... no file reported them") | 9 | Nov 5 to Nov 12 | 3 | 3 | recent; plus 3 Windows `gciLibrary` "this file logged in 1 session(s) it never reported" |
| 10 | `lintSupplyChain` | 8 | Sep 14 to Oct 28 | 2 | 3 | Windows; mostly 5 s timeouts |
| 11 | `forceStop.integration` | 9 | Oct 27 to Nov 5 | 2 | 1 | "can stop the same session again" (3 jobs) |
| 12 | `stopSlowGem` (macOS) | 4 | Oct 21 to Nov 11 | 1 | 2 | Break error assertions |
| 13 | one-offs: `stepping`, `conditionalBreakpointStop`, `clearStoppedRun`, `fileInManager`, `rowanTreeProvider` | 1 to 3 each | | | | some cascade from #8 |

Infra flakes:

- Windows WSL setup, 7 jobs: apt 404 (2, Sep 24), DNS failure (1, Oct 14), WSL `ERROR_TIMEOUT` (2), "action has timed out" (2).
- Linux `gs-test-server.sh --start` exit 3: 8 jobs, all Oct 20 (3.6.2 and 3.6.8).
- 1 npm network failure on the npm pin step, 1 artifact finalize 403, 1 unhandled rejection in `smalltalkNotebookController` (Sep 28).

Excluded as real PR bugs or config breaks (every leg failed, never green): `mcpPanel` (Sep 15 to 16), `classOrganizerSubclasses` and `classCacheAfterApply` (Oct 15), `clientDownload` (Oct 14), 12 `ESTRICTALLOWSCRIPTS` install failures on dependabot PRs (Sep 22).

## Root causes

Verified:

- #1 and #4: failure is a `vi.waitFor` (15 s) waiting for the stone to deregister a stopped gem. Test comments say a loaded runner has taken longer than 4 s. A timeout bump (`107a13f3`, Oct 29) did not fix it: 20 of 29 `activeSession` failures came after it, latest Nov 11.
- #5: real git clones in a 20 s test were replaced with a mocked git (`07b1697f` Nov 10, `eb0cfdbe` Nov 11). Last failure Nov 3.
- #7: the test runs a real `hdiutil attach`. `client/src/manager/versionManager.ts:613` throws when the last output line has no `/Volumes/...` mount point.
- #10: each case spawns `node` and `npm` for real. Median file time 51 s on Windows against 14 s on Ubuntu.

Not verified (inference only or not examined): why #7 sometimes has no mount point; causes of #2, #3, #8, #9, #11, #12 and the WSL setup failures.

## Other failed jobs

- Skipped tests report, 26 failures: 23 are `TypeError: Cannot read properties of undefined (reading 'localeCompare')` from `scripts/summarize-skipped-tests.mjs:60` (an entry without `file`), 2 are `ENOENT test-results`, 1 is an artifact download failure. 19 of the 26 happened in an attempt with a failed matrix leg. Why `file` is missing is not verified.
- Lint & Format, 11 failures: 7 ESLint type errors in PR code (`await-thenable`, `no-misused-promises`), 3 `ESTRICTALLOWSCRIPTS`, 1 `ECONNRESET` in the signature audit.
- Verify vsce packaging, 3 failures: all `ESTRICTALLOWSCRIPTS`.
- Others: TLS certificate error on checkout (1), `actionlint` (1), `Betterleaks` secret scan (2).

## Slowest tests

Client suite wall per run (median): ubuntu 145 s, windows 201 s, macOS 277 s. Server and MCP workspaces take about 1 s each.

Slowest files (median, both runs per leg added):

| File | Windows | Ubuntu | macOS |
|---|---|---|---|
| `lintSupplyChain` | 51 s | 14 s | 28 s |
| `stopSlowGem.integration` | 42 s | 69 s | 70 s |
| `forceStop.integration` | 42 s | 56 s | 59 s |
| `forceStopLogout.integration` | 40 s | 39 s | 44 s |
| `conditionalBreakpointStop.integration` | 36 s | 35 s | 43 s |
| `gciLibrary` | 32 s | 29 s | 38 s |
| `transcriptSink.integration` | 30 s | 29 s | 31 s |
| `stoneSessions.integration` | 26 s | 20 s | 36 s |
| `versionExtract` | n/a | n/a | 93 s |

Slowest single tests (similar on every platform):

- `stopSlowGem`: 2 tests at about 20 s ("lets a slow tearDown finish after one press...", "leaves the session usable after a stop during a slow tearDown...").
- `transcriptSink`: "stopping while output streams..." about 20 s.
- `forceStop`: "says a run that catches every exception is still going..." about 19 s.
- `forceStopLogout`: 3 tests at 10 to 14 s.
- `versionExtract` (macOS): 4 tests at 18 to 19 s (real `hdiutil` and `cp`).
- `gciLibrary`: 13 tests at about 1.0 s each per run.

Why slow (from code): the GemStone integration tests wait for real on the stone (`sleep(3000)`, `sleep(250)` in `stopSlowGem`; `Delay forMilliseconds:` and `Delay forSeconds: 1` inside the stone in `transcriptSink`). `lintSupplyChain` and `versionExtract` start real subprocesses.

Session gate: the stone allows 9 sessions. A full run has about 100 grants, 3 to 5 waits, median total wait about 100 ms on Windows and Ubuntu. Not the bottleneck, though single waits reached 8 to 12 s in some runs.

## Other workflows (shallow pass)

The all-workflow listing is capped at the newest 1,000 runs, so it does not cover the whole window. Health Check is the bulk. Roadmap: 255 skipped, 62 cancelled. Push on main: 60 success. Dependabot updates: 11 failures (minimatch 6, msal-node 3), not examined. CodeQL: 3 `startup_failure`. Nothing slow found outside Health Check.

## Raw data

Kept in `docs/ci-research-2026-11-data/` (about 25 MB, committed):

- `health_runs.tsv`: id, run number, attempt, event, branch, conclusion, created, started, updated.
- `fails.json`: per failed matrix leg (250): run, attempt, leg, step, event, branch, failing tests with first error.
- `failstep.tsv`, `failed_legs.tsv`, `nearlimit.tsv`, `otherfail.tsv`, `glegs.tsv`, `allruns.tsv`, `agg.json`, `filemed.json`: derived tables.
- `scripts/`: the `.py`, `.jq` and fetch `.sh` scripts used (they expect a scratchpad dir with `jobs/`, `logs/` etc.; edit the paths).
- `raw-logs-and-jobs.tar.gz`: `jobs/` (step timings per run), `logs/` (250 failed-leg logs), `glogs/` (24 green-leg logs), `olog/` (non-matrix failures), `tlogs/` (near-limit cancelled legs), `q/` (queue times). Extract with `tar -xzf raw-logs-and-jobs.tar.gz -C <dir>`.

- `macos-vs-windows-weekly-logs.tar.gz`: 30 green-leg logs (`wk/`, one per platform per ISO week, with `picks.txt` giving the job ids) and 4 logs around #809 (`mac/`), used for the macOS vs Windows comparison. `weekly-file-times.json` holds the per-file times parsed from them.
- `dashboard-data/`: the three data files and the page (`index.html`) of the "CI time trends" dashboard artifact (private, claude.ai/artifact/XMiDvut5iZMYCG1ghSn2YP). `scripts/build_chart_data.py` makes the time-series files from `health_runs.tsv` and the `jobs/` archive. `scripts/build_file_data.py` makes the per-file and slowest-test files (`ci_files_weekly.json`, `ci_platform_diff.json`, `ci_slowest_tests.json`) from the weekly logs in `macos-vs-windows-weekly-logs.tar.gz`. Both take their paths as arguments.

Logs on GitHub expire after about 90 days, so the oldest runs cannot be re-fetched later. This archive preserves them.
