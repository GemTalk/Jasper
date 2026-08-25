# `GciTsNbPoll` crash after logout: hypothesis and repro

## Problem

Polling a non-blocking GCI call on a session that was logged out while the
call was still in flight crashes the whole process (`SIGSEGV`) instead of
returning an error. Seen on CI (`Worker exited unexpectedly`) and reproduced
locally against a real GemStone stone, both in Node (via koffi) and in a
standalone C++ program with no Node/koffi involved — same crash, same offset
inside `libgcits`, so the bug is in `libgcits` itself, not in FFI marshalling.

Only reproduces on GemStone 3.7.0+. Older libraries poll the raw socket
instead (`GciTsSocket` + `poll`/`WSAPoll`) — a different code path this does
not exercise.

## Hypothesis

`GciTsNbPoll` does not validate its session argument before dereferencing
the outstanding call's state. `GciTsNbPoll`'s own doc comment in
`vendor/gci-headers/3.7.2/gcits.hf` promises `-1 - error, (invalid session,
no NB call in progress, peer disconnected)`, and `gcierr.ht` defines a
general `GCI_ERR_BAD_SESSION_ID` (4100) for exactly this case — so by its
documented contract this should be a clean error, not a crash. Whether the
gap is in `GciTsNbPoll` itself, or in what `GciTsLogout` leaves behind
client-side, is still open.

Both repros below do the same three calls: log in, start a non-blocking
call, log out while it's still outstanding, then poll it.

## Node repro

`client/src/gciLibrary/__tests__/gciNbPollAfterLogout.integration.test.ts`.
Talks to the raw `GciTsXxx` bindings on `GciLibrary` directly (not through
any higher-level helper), so nothing hides the crash.

```sh
npm run test:server:start                 # or a specific version, see below
cd client
npx vitest run --project default src/gciLibrary/__tests__/gciNbPollAfterLogout.integration.test.ts
```

- **Crashes / reports `Worker exited unexpectedly`:** repro reproduced.
- **Skipped, reason `GciTsNbPoll is not exported before GemStone 3.7.0`:**
  expected — this version uses the socket-fallback path instead.
- **Passes and logs `GciTsNbPoll on a logged-out session returned: ...`:**
  this version's `GciTsNbPoll` handled it gracefully — a data point against
  the hypothesis for that version, worth a closer look.

Against a specific version:

```sh
npm run test:server:start --workspace client 3.7.5     # or any version in client/.gemstone-integration-releases.json
```

## C++ repro

`native-repro/gci_nb_poll_after_logout.cpp`. No Jasper tooling, Node, or
koffi — just `libgcits`, loaded at runtime (`dlopen`/`LoadLibrary`) with each
`GciTsXxx` symbol resolved individually (`dlsym`/`GetProcAddress`), so no
import library is needed on Windows and `#include "gcits.hf"` is only for
its type/constant definitions.

One command, on Linux or macOS, with nothing pre-installed — installs
GemStone if needed, starts a fresh test stone, builds, and runs:

```sh
native-repro/run.sh 3.7.5    # any version, e.g. one of your own release branches
```

Stops the stone afterward with `(cd client && bin/gs-test-server.sh --stop 3.7.5)`.
This reuses Jasper's own bash-based provisioning, so it's Linux/macOS only.

- **Segfaults:** repro reproduced (exit 139 / `SIGSEGV` on POSIX).
- **Prints `GciTsNbPoll is not exported by this library`:** expected on
  pre-3.7.0 — nothing to repro there.
- **Prints `GciTsNbPoll on a logged-out session returned: ...`:** this
  build handled it gracefully — a data point against the hypothesis, worth
  a closer look.
