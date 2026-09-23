#!/usr/bin/env bash
set -euo pipefail

# Usage: ./gs-test-setup.sh <version> <name> [--extent <extent>]
#          [gs-create-test-env-file.sh flags]
#
# Prepares a local GemStone instance for integration tests:
#   1. Installs GemStone if not already present.
#   2. Stops any previously running instance of the test stone (safe no-op if
#      nothing is running).
#   3. Resets the extent to a pristine copy.
#   4. Starts a fresh Stone and NetLDI.
#   5. Writes .env.test with the connection details the test suite needs.
#
# Arguments:
#   version    GemStone version to install and start (e.g. 3.7.5)
#   name       Instance name; Stone and NetLDI names are derived from it
#   --extent   Which pristine extent to start from (default extent0.dbf). Use
#              extent0.rowan3.dbf for a rowan3 stone — the configuration the
#              Tonel file out/in feature requires; see
#              src/queries/tonel/tonelCapability.ts.
#   (any remaining arguments are forwarded as-is to gs-create-test-env-file.sh;
#   see its own usage comment)
#
# NOTE: there is one .env.test, and step 5 rewrites it every time. Starting a
# second instance therefore REPOINTS THE WHOLE SUITE at the instance started
# most recently — it does not run two tiers side by side. That is deliberate
# (one env file is the existing design), but it means "run the rowan3 tier" is
# "start the rowan3 stone, run the suite", not something that happens alongside
# the default stone. The final line prints which stone .env.test now names, so
# the repoint is never silent.

SCRIPT_DIR="$(dirname "$0")"
USAGE_MESSAGE="Usage: $0 <version> <name> [--extent <extent>] [gs-create-test-env-file.sh flags]"
VERSION="${1:?$USAGE_MESSAGE}"
NAME="${2:?$USAGE_MESSAGE}"
shift 2

EXTENT="extent0.dbf"
ENV_FILE_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --extent)
      EXTENT="${2:?$USAGE_MESSAGE}"
      shift 2
      ;;
    *)
      ENV_FILE_ARGS+=("$1")
      shift
      ;;
  esac
done

"$SCRIPT_DIR/gs-install.sh" "$VERSION"
"$SCRIPT_DIR/gs-stop.sh" "$VERSION" "$NAME"
"$SCRIPT_DIR/gs-reset-extent.sh" "$VERSION" "$EXTENT"
"$SCRIPT_DIR/gs-start.sh" "$VERSION" "$NAME"
"$SCRIPT_DIR/gs-create-test-env-file.sh" "$VERSION" "$NAME" ${ENV_FILE_ARGS+"${ENV_FILE_ARGS[@]}"}

echo ".env.test now points at ${NAME}-${VERSION}-gs64-stone (extent: ${EXTENT})."
