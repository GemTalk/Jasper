#!/usr/bin/env bash
#
# Fails if any job in .github/workflows/*.yml has no timeout-minutes, except
# jobs that call a reusable workflow (see the loop below). Without one, a
# hang inherits GitHub's 360-minute default instead of failing fast.
#
# Requires yq (mikefarah, Go): https://github.com/mikefarah/yq. Preinstalled
# on GitHub-hosted runners, so CI needs no setup step. Running this locally
# requires installing it yourself (e.g. `brew install yq` on macOS) — see
# https://github.com/mikefarah/yq#install for other platforms.

set -euo pipefail

if ! command -v yq >/dev/null 2>&1; then
    echo "error: yq is required but not installed on this machine." >&2
    echo "Install it from https://github.com/mikefarah/yq#install (e.g. \`brew install yq\` on macOS), then re-run." >&2
    exit 1
fi

missing=0

for file in .github/workflows/*.yml .github/workflows/*.yaml; do
    [ -e "$file" ] || continue

    # Capture yq's output into a variable instead of piping straight into
    # the loop with `< <(yq ...)`. Process substitution runs yq in a
    # subshell whose exit status the parent shell never checks, so a
    # crashing/erroring yq would just produce no output — the loop would
    # read zero lines and this script would report a clean pass instead of
    # failing. `jobs=$(yq ...)` is a plain assignment, so its exit status
    # is yq's exit status, and set -e (above) aborts the script right here
    # if yq fails.
    #
    # Jobs that call a reusable workflow (`uses:`) are skipped: GitHub does
    # not allow timeout-minutes on them, so their timeouts live on the
    # called workflow's own jobs. This loop checks those only for local
    # (`./`) workflows; a remote one's jobs are not checked at all.
    jobs=$(yq eval '.jobs // {} | to_entries | .[] | select(.value["timeout-minutes"] == null and .value.uses == null) | .key' "$file")

    # A here-string (`<<<`) always feeds the loop one line, even when
    # $jobs is empty — so without this guard, a file with no missing
    # timeouts would still make the loop run once with job="", falsely
    # reporting a job with no name.
    [ -z "$jobs" ] && continue

    while IFS= read -r job; do
        missing=1
        echo "  - $file: job \"$job\" has no timeout-minutes"
    done <<< "$jobs"
done

if [ "$missing" -eq 1 ]; then
    echo
    echo "Add timeout-minutes to each job above so a hang fails fast instead of running for GitHub's 360-minute default." >&2
    exit 1
fi

echo "timeout-minutes set on every job."
