#!/usr/bin/env bash
#
# Reports whether one registry is serving a version yet.
#
# Deliberately narrow, because the public read APIs are narrow. Neither
# registry exposes a review/scan state to an unauthenticated caller: Open VSX's
# per-version endpoint answers 404 `Extension not found` for a version that was
# never uploaded AND for one that landed but has not been activated yet, with
# nothing in the body to tell them apart (it carries no `reviewStatus` field).
# So this script answers the only question it honestly can — is the version
# visible — and callers must not infer "not published" from `absent`.
#
# The state that actually distinguishes "landed but inactive" from "never
# uploaded" is only observable from a publish attempt, whose error message says
# so; scripts/publish-to-registry.sh is where that is interpreted.
#
# Prints exactly one of:
#   visible   the registry serves this version now
#   absent    the registry does not serve it (never uploaded, or not yet active)
#   unknown   the query itself failed (network, rate limit, bad JSON)
#
# Exits 0 whenever it produced a state, 2 on usage error. `unknown` is not a
# failure: a flaky query must not be read as a missing release.
#
# Usage: scripts/registry-state.sh <marketplace|openvsx> <version>
# Env:   NAMESPACE (default gemtalksystems), EXTENSION (default gemstone-ide)

set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "usage: $0 <marketplace|openvsx> <version>" >&2
    exit 2
fi

registry="$1"
version="$2"
namespace="${NAMESPACE:-gemtalksystems}"
extension="${EXTENSION:-gemstone-ide}"

case "$registry" in
    openvsx)
        # A single request for the exact version. 200 means the version row is
        # active and downloadable; 404 means it is not being served, for either
        # of the two reasons above.
        body=$(curl -s --max-time 30 -w '\n%{http_code}' \
            "https://open-vsx.org/api/${namespace}/${extension}/${version}" 2>/dev/null) || {
            echo unknown
            exit 0
        }
        code=$(printf '%s' "$body" | tail -1)
        case "$code" in
            200)
                # Guard against a 200 carrying an error document.
                if printf '%s' "$body" | sed '$d' | jq -e '.error // empty' >/dev/null 2>&1; then
                    echo absent
                else
                    echo visible
                fi
                ;;
            404) echo absent ;;
            *) echo unknown ;;
        esac
        ;;
    marketplace)
        # vsce reads the gallery API, which omits a version until it has
        # finished validating. --json keeps this parseable rather than
        # scraping the table `vsce show` prints by default.
        if ! json=$(npx --no-install @vscode/vsce show "${namespace}.${extension}" --json 2>/dev/null); then
            echo unknown
            exit 0
        fi
        if printf '%s' "$json" | jq -e --arg v "$version" \
            '[.versions[].version] | index($v) != null' >/dev/null 2>&1; then
            echo visible
        else
            echo absent
        fi
        ;;
    *)
        echo "error: unknown registry '$registry' (expected marketplace or openvsx)." >&2
        exit 2
        ;;
esac
