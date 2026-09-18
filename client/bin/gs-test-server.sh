#!/usr/bin/env bash
set -euo pipefail

# Usage: ./gs-test-server.sh <command> [version] [name] [--extent <extent>]
#
# Top-level entry point for managing the integration-test GemStone instance.
# Delegates to the individual gs-*.sh scripts.
#
# Arguments:
#   command   Action to perform: --list, --start, or --stop
#   version   GemStone version; defaults to the oldest integration release
#             in .gemstone-integration-releases.json
#   name      Instance name; defaults to 'jasper-test'
#   --extent  (--start only) Pristine extent to start from; default
#             extent0.dbf. `npm run test:server:start:rowan3` wraps the rowan3
#             invocation, which is what the Tonel file out/in suites need.

SCRIPT_DIR="$(dirname "$0")"
COMMAND="${1:-}"
VERSION="${2:-$("$SCRIPT_DIR/gemstone-integration-versions.js" --oldest)}"
NAME="${3:-jasper-test}"
# Anything after the positional arguments is passed through to gs-test-setup.sh
# (notably --extent), so this stays a thin front door rather than a second place
# that has to learn every option.
[[ $# -gt 3 ]] && shift 3 || shift $#

case "$COMMAND" in
  --list)  "$SCRIPT_DIR/gs-list.sh" "$VERSION" || true ;;
  --start) "$SCRIPT_DIR/gs-test-setup.sh" "$VERSION" "$NAME" "$@";;
  --stop)  "$SCRIPT_DIR/gs-stop.sh" "$VERSION" "$NAME" ;;
  *)
    cat >&2 <<EOF
Usage: $0 <command> [version] [name]

  version defaults to the oldest integration release; name defaults to 'jasper-test'.

  --list [version]         List all running GemStone processes for the test stone.
  --start [version] [name] [--extent <extent>]
                           Install GemStone (if needed) and start a fresh test stone.
  --stop [version] [name]  Stop the test stone's NetLDI and Stone processes.
EOF
    exit 1 ;;
esac