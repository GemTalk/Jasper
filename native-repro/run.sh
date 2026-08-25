#!/usr/bin/env bash
#
# Usage: native-repro/run.sh <gemstone-version>
#
# One command for the GemStone core team: installs (if needed) and starts a
# fresh test stone for <gemstone-version>, compiles
# gci_nb_poll_after_logout.cpp against that install's own headers, and runs
# it. See docs/explanation/gci-nb-poll-crash-repro.md for what this is
# reproducing and what each outcome means.
#
# Requires: a C++17 compiler (c++) on PATH. Linux and macOS only -- this
# reuses Jasper's own bash-based GemStone provisioning, which the Windows
# leg only runs inside WSL. On Windows, follow the manual build/run steps in
# this repro's own header comment instead.
#
# Example:
#   native-repro/run.sh 3.7.5

set -euo pipefail

VERSION="${1:?Usage: $0 <gemstone-version>}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Installing (if needed) and starting a GemStone $VERSION test stone..."
# gs-test-server.sh (via gs-config.sh) resolves its install/download
# directories as $(pwd)/tmp/gemstone -- it must run from client/, or it
# treats the repo root as its own separate, uncached install tree.
(cd "$REPO_ROOT/client" && bin/gs-test-server.sh --start "$VERSION")

echo
echo "==> Building the repro..."
set -a
# shellcheck source=/dev/null
source "$REPO_ROOT/client/.env.test"
# shellcheck disable=SC2034
# Read directly by libgcits (via getenv) once exported below, not by
# anything else in this script.
GEMSTONE_GLOBAL_DIR="$VITE_GEMSTONE_GLOBAL_DIR"
set +a

EXTRA_LIBS=()
[ "$(uname -s)" = "Linux" ] && EXTRA_LIBS=(-ldl)

BINARY="$(mktemp -d)/gci-nb-poll-repro"
c++ -std=c++17 \
  -I "$(dirname "$VITE_GEMSTONE_GLOBAL_DIR")/include" \
  "$REPO_ROOT/native-repro/gci_nb_poll_after_logout.cpp" \
  -o "$BINARY" "${EXTRA_LIBS[@]}"

echo
echo "==> Running against GemStone $VERSION..."
echo

set +e
"$BINARY"
result=$?
set -e

echo
if [ "$result" -ge 128 ]; then
  echo "*** Crashed (signal $((result - 128))) -- the repro reproduced. ***"
elif [ "$result" -eq 0 ]; then
  echo "*** Exited cleanly -- see the printed message above for what happened. ***"
else
  echo "*** Exited with code $result (unexpected -- see output above). ***"
fi

echo
echo "Stone left running for a re-run or inspection. Stop it with:"
echo "  (cd client && bin/gs-test-server.sh --stop $VERSION)"

exit "$result"
