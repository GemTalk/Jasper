#!/usr/bin/env bash
set -euo pipefail

# Usage: ./gs-create-test-env-file.sh <version> <name> [--remote]
#          [--gci-library-path <path>] [--global-dir <path>]
#
# Writes .env.test with the connection details for the running GemStone
# instance. Vite loads this file automatically when running tests, making
# the variables available to the test suite as process.env.VITE_GEMSTONE_*.
#
# Arguments:
#   version              GemStone version (e.g. 3.7.5)
#   name                 Instance name used when the stone was started
#   --remote             Write a stone/gem NRS reachable from outside this
#                        machine's own network stack: this machine's own IP
#                        instead of 'localhost', and NetLDI's actual bound
#                        port instead of its symbolic name. Needed when the
#                        test runner connects from across a network boundary
#                        (e.g. native Windows reaching into the WSL guest
#                        this script ran in), where neither 'localhost' nor
#                        NetLDI's name-based lookup (via /etc/services)
#                        resolves.
#   --gci-library-path   Write this instead of the (WSL-native) GCI DLL path
#                        gs-config.sh would otherwise compute -- e.g. the
#                        native Windows path for that same cross-boundary
#                        test runner, which this script has no way to know.
#   --global-dir         Write this instead of the (WSL-native) lock/log
#                        directory gs-config.sh would otherwise compute, for
#                        the same reason.

USAGE_MESSAGE="Usage: $0 <version> <name> [--remote] [--gci-library-path <path>] [--global-dir <path>]"
# shellcheck disable=SC2034
# This variable is read by gs-config.sh when sourced below
VERSION="${1:?$USAGE_MESSAGE}"
# shellcheck disable=SC2034
# This variable is read by gs-config.sh when sourced below
NAME="${2:?$USAGE_MESSAGE}"
shift 2

remote_flag=""
gci_library_path_to_use=""
gemstone_global_dir_to_use=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote)
      remote_flag=1
      shift
      ;;
    --gci-library-path)
      gci_library_path_to_use="${2:?$USAGE_MESSAGE}"
      shift 2
      ;;
    --global-dir)
      gemstone_global_dir_to_use="${2:?$USAGE_MESSAGE}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "$USAGE_MESSAGE" >&2
      exit 1
      ;;
  esac
done

# shellcheck source=gs-config.sh
source "$(dirname "$0")/gs-config.sh"

if [[ -n "$remote_flag" ]]; then
  # gs-info.py prints "<ip> <port>" on one line: this machine's own address
  # and NetLDI's actual bound port, both reachable from outside this
  # machine's own network stack (unlike 'localhost' and NetLDI's name).
  info=$("$GS_SCRIPTS_DIR/gs-info.py" "$LDI_NAME")
  read -r host netldi_locator <<< "$info"
else
  host="localhost"
  netldi_locator="$LDI_NAME"
fi

# Default to gs-config.sh's real values when --gci-library-path/--global-dir
# weren't given.
gci_library_path_to_use="${gci_library_path_to_use:-$GCI_LIBRARY_PATH}"
gemstone_global_dir_to_use="${gemstone_global_dir_to_use:-$GEMSTONE_GLOBAL_DIR}"

# Values are single-quoted so the .env parser preserves special characters in
# NRS strings (e.g. '!' and '#' which shells and some parsers treat as special).
#
# Write to client/ (one level up from bin/) rather than $(pwd): Vite resolves
# .env.test relative to the project root (client/), so the path must be fixed
# regardless of where the caller runs this script from.
cat << EOF > "$(dirname "$0")/../.env.test"
VITE_GEMSTONE_STONE_NRS='!tcp@${host}#server!${STONE_NAME}'
VITE_GEMSTONE_GEM_NRS='!tcp@${host}#netldi:${netldi_locator}#task!gemnetobject'
VITE_GEMSTONE_USER='${GS_USERNAME}'
VITE_GEMSTONE_PASSWORD='${GS_PASSWORD}'
VITE_GEMSTONE_GCI_LIBRARY_PATH='${gci_library_path_to_use}'
VITE_GEMSTONE_GLOBAL_DIR='${gemstone_global_dir_to_use}'
VITE_GEMSTONE_VERSION='${VERSION}'
EOF
