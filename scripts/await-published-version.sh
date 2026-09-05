#!/usr/bin/env bash
#
# Waits until a published version is actually queryable on both registries.
#
# Both publish CLIs print success as soon as the *upload* is accepted; the
# version then takes anywhere from ~2 to ~22 minutes to appear in a gallery
# query, and the two registries are independent — either can lead. A release
# is not done when the CLI says so, so the pipeline waits here rather than
# leaving a human to poll by hand (see docs/how-to/publishing-a-release.md).
#
# Exits 0 once both registries report the version, non-zero on timeout. Both
# CLIs are repo devDependencies, so this runs them via `npx --no-install`:
# nothing is fetched from the network beyond the two registry queries.
#
# Usage: scripts/await-published-version.sh <version>
# Env:   NAMESPACE (default gemtalksystems), EXTENSION (default gemstone-ide),
#        TIMEOUT_SECONDS (default 1800), POLL_INTERVAL_SECONDS (default 30)

set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "usage: $0 <version>   e.g. $0 1.8.15" >&2
    exit 2
fi

version="$1"
namespace="${NAMESPACE:-gemtalksystems}"
extension="${EXTENSION:-gemstone-ide}"
timeout_seconds="${TIMEOUT_SECONDS:-1800}"
poll_interval="${POLL_INTERVAL_SECONDS:-30}"

# Open VSX's extension metadata carries an `allVersions` map keyed by version
# string, so membership is one request and needs no ordering assumption. A
# version whose upload landed but is not yet active is absent from it — which
# is exactly the "already published, but currently isn't active" state.
openvsx_has_version() {
    curl -sf --max-time 30 "https://open-vsx.org/api/${namespace}/${extension}" 2>/dev/null |
        jq -e --arg v "$version" '.allVersions | has($v)' >/dev/null 2>&1
}

marketplace_has_version() {
    npx --no-install @vscode/vsce show "${namespace}.${extension}" --json 2>/dev/null |
        jq -e --arg v "$version" '[.versions[].version] | index($v) != null' >/dev/null 2>&1
}

deadline=$(($(date +%s) + timeout_seconds))
openvsx_live=0
marketplace_live=0

echo "Waiting for ${namespace}.${extension} ${version} to become queryable on both registries"
echo "(timeout ${timeout_seconds}s, polling every ${poll_interval}s)."

while true; do
    [ "$openvsx_live" -eq 1 ] || if openvsx_has_version; then
        openvsx_live=1
        echo "  Open VSX: ${version} is live."
    fi

    [ "$marketplace_live" -eq 1 ] || if marketplace_has_version; then
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
        [ "$openvsx_live" -eq 1 ] || echo "  Open VSX: still not serving ${version}." >&2
        [ "$marketplace_live" -eq 1 ] || echo "  Marketplace: still not serving ${version}." >&2
        echo >&2
        echo "The upload was already accepted, so this is propagation, not a failed publish:" >&2
        echo "re-running the publish step is not the fix. Check the registries by hand before" >&2
        echo "doing anything else — see docs/how-to/publishing-a-release.md." >&2
        exit 1
    fi

    remaining=$((deadline - now))
    echo "  ...still waiting (${remaining}s left; open-vsx=${openvsx_live} marketplace=${marketplace_live})"
    sleep "$poll_interval"
done
