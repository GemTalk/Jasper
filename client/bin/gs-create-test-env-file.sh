#!/usr/bin/env bash
set -euo pipefail

# Usage: ./gs-create-test-env-file.sh <version> <name>
#
# Writes .env.test with the connection details for the running GemStone
# instance. Vite loads this file automatically when running tests, making
# the variables available to the test suite as process.env.VITE_GEMSTONE_*.
#
# Arguments:
#   version   GemStone version (e.g. 3.7.5)
#   name      Instance name used when the stone was started

# shellcheck disable=SC2034
# This variable is read by gs-config.sh when sourced below
VERSION="${1:?Usage: $0 <version> <name>}"
# shellcheck disable=SC2034
# This variable is read by gs-config.sh when sourced below
NAME="${2:?Usage: $0 <version> <name>}"

# shellcheck source=gs-config.sh
source "$(dirname "$0")/gs-config.sh"

# Values are single-quoted so the .env parser preserves special characters in
# NRS strings (e.g. '!' and '#' which shells and some parsers treat as special).
#
# Write to client/ (one level up from bin/) rather than $(pwd): Vite resolves
# .env.test relative to the project root (client/), so the path must be fixed
# regardless of where the caller runs this script from.
cat << EOF > "$(dirname "$0")/../.env.test"
VITE_GEMSTONE_STONE_NRS='!tcp@localhost#server!${STONE_NAME}'
VITE_GEMSTONE_GEM_NRS='!tcp@localhost#netldi:${LDI_NAME}#task!gemnetobject'
VITE_GEMSTONE_USER='${GS_USERNAME}'
VITE_GEMSTONE_PASSWORD='${GS_PASSWORD}'
VITE_GEMSTONE_GCI_LIBRARY_PATH='${GCI_LIBRARY_PATH}'
VITE_GEMSTONE_GLOBAL_DIR='${GEMSTONE_GLOBAL_DIR}'
VITE_GEMSTONE_VERSION='${VERSION}'
EOF
