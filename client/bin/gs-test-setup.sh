#!/usr/bin/env bash
set -euo pipefail

# Usage: ./gs-test-setup.sh <version> <name> [gs-create-test-env-file.sh flags]
#
# Prepares a local GemStone instance for integration tests:
#   1. Installs GemStone if not already present.
#   2. Stops any previously running instance of the test stone (safe no-op if
#      nothing is running).
#   3. Starts a fresh Stone and NetLDI.
#   4. Writes .env.test with the connection details the test suite needs.
#
# Arguments:
#   version   GemStone version to install and start (e.g. 3.7.5)
#   name      Instance name; Stone and NetLDI names are derived from it
#   (any remaining arguments are forwarded as-is to gs-create-test-env-file.sh;
#   see its own usage comment)

SCRIPT_DIR="$(dirname "$0")"
USAGE_MESSAGE="Usage: $0 <version> <name> [gs-create-test-env-file.sh flags]"
VERSION="${1:?$USAGE_MESSAGE}"
NAME="${2:?$USAGE_MESSAGE}"
shift 2

"$SCRIPT_DIR/gs-install.sh" "$VERSION"
"$SCRIPT_DIR/gs-stop.sh" "$VERSION" "$NAME"
"$SCRIPT_DIR/gs-reset-extent.sh" "$VERSION"
"$SCRIPT_DIR/gs-start.sh" "$VERSION" "$NAME"
"$SCRIPT_DIR/gs-create-test-env-file.sh" "$VERSION" "$NAME" "$@"
