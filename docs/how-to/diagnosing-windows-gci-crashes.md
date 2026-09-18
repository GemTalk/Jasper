# Diagnosing Windows GCI crashes in CI

A native GCI crash on Windows (an SEH exception inside `gcits.dll`,
e.g. `GciWindowsExceptionFilter called ...`) doesn't fail a test directly.
It kills a vitest fork worker, and vitest only reports that as a generic
`[vitest-pool]: Worker forks emitted error` / `Worker exited unexpectedly`,
with no indication of what actually crashed.

GemStone's own exception filter writes the real call stack to a
`%TEMP%\GCI*.tmp` file when this happens. The `health-check` workflow's
`Collect GCI crash dumps` / `Upload GCI crash dumps` steps
(`.github/workflows/health-check.yml`) copy that file into the workspace
and upload it as a build artifact on every Windows run, whether the job
fails, is cancelled, or times out.

To find the real stack trace:

1. Open the failed `health-check` run in GitHub Actions.
2. Download the `gci-crash-dumps-<platform>-<gemstone-version>` artifact
   for the failing matrix leg (it's only present if a dump file existed).
3. Read the `.tmp` file inside; it contains GemStone's native call stack at
   the point of the crash.

If no artifact is present, the crash didn't leave a dump (or wasn't a native
GCI crash), so the generic vitest error is the only signal available.
