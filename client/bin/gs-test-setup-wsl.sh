#!/usr/bin/env bash
set -euo pipefail

# Usage: ./gs-test-setup-wsl.sh <version> <name> <gci-library-path> <global-dir> <shared-download-dir>
#
# Installs and starts GemStone inside this WSL guest, and writes a
# .env.test the native Windows test run can connect into remotely
# (gs-test-setup.sh's `--remote` flag). Must run as root (the distro's
# default user): GemStone itself can't, so this creates an unprivileged
# user first and does everything else as that user.
#
# Arguments:
#   version              GemStone version to install and start (e.g. 3.7.5)
#   name                 Instance name; Stone and NetLDI names are derived from it
#   gci-library-path     Native Windows GCI DLL path for .env.test; this WSL
#                        guest has no way to know it
#   global-dir           Native Windows lock/log directory for .env.test, for
#                        the same reason
#   shared-download-dir  Native checkout's client/tmp/downloads, translated to
#                        its /mnt/... path; the server download is symlinked
#                        in from here so this leg shares the same
#                        actions/cache entry as the Linux legs instead of
#                        re-downloading every run

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
USAGE_MESSAGE="Usage: $0 <version> <name> <gci-library-path> <global-dir> <shared-download-dir>"
VERSION="${1:?$USAGE_MESSAGE}"
NAME="${2:?$USAGE_MESSAGE}"
GCI_LIBRARY_PATH_OVERRIDE="${3:?$USAGE_MESSAGE}"
GEMSTONE_GLOBAL_DIR_OVERRIDE="${4:?$USAGE_MESSAGE}"
SHARED_DOWNLOAD_DIR="${5:?$USAGE_MESSAGE}"

# startnetldi's guest mode (used by gs-start.sh) refuses to run as root.
id -u gsuser >/dev/null 2>&1 || useradd -m -s /bin/bash gsuser
gsuser_home=$(getent passwd gsuser | cut -d: -f6)

# gs-install.sh extracts into $(pwd)/tmp/gemstone/, and GemStone's stone
# process needs real POSIX locks/shared memory: run from gsuser's own
# filesystem, not wherever this script itself was invoked from (the
# checkout's DrvFs mount), which was slow enough over thousands of small
# files to look hung.
work_dir="$gsuser_home/gemstone-ci"
mkdir -p "$work_dir"
chown gsuser "$work_dir"

# Only the download itself is symlinked back onto the DrvFs-mounted
# checkout, not the extraction target above: it's a single archive file, a
# sequential copy across the DrvFs bridge rather than the many-small-files
# pattern that made extracting there slow. This lets gs-install.sh's
# existing archive-already-exists check share the actions/cache entry the
# Linux legs populate (or populate it, on a cache miss), instead of
# downloading fresh into this guest on every run.
mkdir -p "$SHARED_DOWNLOAD_DIR" "$work_dir/tmp"
ln -sfn "$SHARED_DOWNLOAD_DIR" "$work_dir/tmp/downloads"
chown -R gsuser "$work_dir/tmp"

# No Node is installed in this distro, so a plain `npm` would resolve
# through WSL's Windows-PATH interop to the *Windows* npm, which can't run
# "./bin/*.sh" -- call gs-test-setup.sh directly instead. --gci-library-path
# and --global-dir are just forwarded on through it to
# gs-create-test-env-file.sh, unread by anything in between; see that
# script's own usage comment for what they're for.
su gsuser -c "cd '$work_dir' && '$SCRIPT_DIR/gs-test-setup.sh' '$VERSION' '$NAME' --remote --gci-library-path '$GCI_LIBRARY_PATH_OVERRIDE' --global-dir '$GEMSTONE_GLOBAL_DIR_OVERRIDE'"
