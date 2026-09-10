#!/usr/bin/env bash
#
# Waits until both registries are actually serving a version.
#
# Both publish CLIs report success as soon as the *upload* is accepted; the
# version then takes anywhere from ~2 to ~22 minutes to appear in a gallery
# query, and the two registries are independent — either can lead. A release
# is not done when the CLI says so, so this waits rather than leaving someone
# to poll by hand (see docs/how-to/publishing-a-release.md).
#
# This is a report, not a gate. By the time it runs, the GitHub Release, the
# tag and both uploads already exist, so a timeout here withholds nothing and
# fixes nothing — it only says the registries are slower than the budget.
#
# It uses scripts/registry-state.sh for both registries so the wait and the
# pre-publish check share one state model and cannot disagree about what
# "serving" means.
#
# Exits 0 once both are visible, 1 on timeout.
#
# Usage: scripts/await-published-version.sh <version>
# Env:   NAMESPACE, EXTENSION (passed through to registry-state.sh),
#        TIMEOUT_SECONDS (default 1800), POLL_INTERVAL_SECONDS (default 30)

set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "usage: $0 <version>   e.g. $0 1.9.1" >&2
    exit 2
fi

version="$1"
timeout_seconds="${TIMEOUT_SECONDS:-1800}"
poll_interval="${POLL_INTERVAL_SECONDS:-30}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

deadline=$(($(date +%s) + timeout_seconds))
openvsx_live=0
marketplace_live=0

echo "Waiting for ${version} to become queryable on both registries"
echo "(timeout ${timeout_seconds}s, polling every ${poll_interval}s)."

while true; do
    if [ "$openvsx_live" -eq 0 ] && [ "$(bash "$here/registry-state.sh" openvsx "$version")" = visible ]; then
        openvsx_live=1
        echo "  Open VSX: ${version} is live."
    fi

    if [ "$marketplace_live" -eq 0 ] && [ "$(bash "$here/registry-state.sh" marketplace "$version")" = visible ]; then
        marketplace_live=1
        echo "  Marketplace: ${version} is live."
    fi

    if [ "$openvsx_live" -eq 1 ] && [ "$marketplace_live" -eq 1 ]; then
        echo "Both registries are serving ${version}."
        exit 0
    fi

    now=$(date +%s)
    if [ "$now" -ge "$deadline" ]; then
        echo >&2
        echo "error: timed out after ${timeout_seconds}s waiting for ${version}." >&2
        [ "$openvsx_live" -eq 1 ] || echo "  Open VSX: not serving ${version} yet." >&2
        [ "$marketplace_live" -eq 1 ] || echo "  Marketplace: not serving ${version} yet." >&2
        echo >&2
        # Deliberately does not claim to know why. A registry that is not
        # serving the version may still be activating it, or may have rejected
        # it in a server-side scan, and nothing readable from here tells the
        # two apart — Open VSX answers the same 404 for both. Saying "this is
        # only propagation" would be a guess, and it is the wrong guess in the
        # case that actually matters.
        echo "The publish step reported the upload as accepted, so the version number is" >&2
        echo "already spent either way. What is NOT known from here is whether the registry" >&2
        echo "is still activating it or has rejected it — the public API answers the same" >&2
        echo "404 for both. Check the registry's own page before doing anything, and do not" >&2
        echo "re-publish this version: see docs/how-to/publishing-a-release.md." >&2
        exit 1
    fi

    remaining=$((deadline - now))
    echo "  ...still waiting (${remaining}s left; open-vsx=${openvsx_live} marketplace=${marketplace_live})"
    sleep "$poll_interval"
done
