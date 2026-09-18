#!/usr/bin/env bash
set -euo pipefail

# Usage: ./gs-reset-extent.sh <version> [extent]
#
# Restores the extent to the pristine copy shipped with GemStone, discarding
# any data from previous runs. Called by gs-test-setup.sh before each test
# run so tests always start from a known, clean state.
#
# The stone must not be running when this script is called.
#
# Arguments:
#   version   GemStone version (e.g. 3.7.5)
#   extent    Which pristine extent to copy from ${GEMSTONE}/bin, e.g.
#             extent0.rowan3.dbf. Defaults to extent0.dbf, the base image.
#
# Whichever pristine extent is chosen, it always lands as data/extent0.dbf:
# that is the name the stone's configuration reads, and which copy it came from
# is this script's business alone.
#
# Not every release ships every extent. 3.7.5 ships extent0.dbf,
# extent0.rowan.dbf, extent0.rowan3.dbf and extent0.seaside.dbf; the 3.6.x
# tarballs ship only extent0.dbf and extent0.seaside.dbf — so a rowan3 3.6.x
# stone cannot be built at all, and asking for one fails here with that said
# plainly rather than further down in a confusing way.

# shellcheck disable=SC2034
VERSION="${1:?Usage: $0 <version> [extent]}"
EXTENT="${2:-extent0.dbf}"

# shellcheck source=gs-config.sh
source "$(dirname "$0")/gs-config.sh"

gs_require_install

SOURCE_EXTENT="${GEMSTONE}/bin/${EXTENT}"
if [[ ! -f "$SOURCE_EXTENT" ]]; then
  echo "GemStone ${VERSION} does not ship ${EXTENT} (looked in ${GEMSTONE}/bin)." >&2
  echo "Available extents:" >&2
  ls -1 "${GEMSTONE}/bin"/extent*.dbf 2>/dev/null | sed 's|.*/|  |' >&2 || echo "  (none)" >&2
  exit 1
fi

# copydbf requires the destination not to exist.
rm -f "${GEMSTONE_DATA_DIR}/extent0.dbf"
copydbf "$SOURCE_EXTENT" "${GEMSTONE_DATA_DIR}/extent0.dbf"
chmod 600 "${GEMSTONE_DATA_DIR}/extent0.dbf"
