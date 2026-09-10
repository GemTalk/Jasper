#!/usr/bin/env bash
#
# Publishes an already-built .vsix to one registry, and decides what the
# outcome actually means.
#
# The decision is the point of this script. Both registries are immutable per
# (publisher, name, version): a version number, once taken, can never be
# reused — even deleting a version leaves the identity reserved. So a re-run
# after a partial failure must treat "this version is already there" as
# success rather than as an error, or the only way out of a half-finished
# release is to burn the next version number too.
#
# `--skip-duplicate` gets that right for one of the two ways a version can
# already be there, and wrong for the other. ovsx's check is literally
#
#     err.message.endsWith('is already published.')      (ovsx/lib/publish.js)
#
# but a version that landed and has NOT been activated yet reports
#
#     ...is already published, but currently isn't active and therefore not visible.
#
# which does not match that suffix, so ovsx fails hard. That inactive window is
# the normal state for the first minutes after an upload — this repo has sat in
# it for over twenty minutes — so it is precisely the state a re-run meets, and
# precisely where --skip-duplicate stops working. Both spellings are treated as
# success here; the flag stays on as a backstop for the race between a state
# check and the upload.
#
# Prints one of `published`, `already-published`, `awaiting-activation` on
# success. Exits non-zero only when the version is genuinely not up.
#
# Usage: scripts/publish-to-registry.sh <marketplace|openvsx> <path-to-vsix>
# Env:   VSCE_PAT (marketplace) or OVSX_PAT (openvsx)

set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "usage: $0 <marketplace|openvsx> <path-to-vsix>" >&2
    exit 2
fi

registry="$1"
vsix="$2"

if [ ! -f "$vsix" ]; then
    echo "error: $vsix not found." >&2
    exit 2
fi

case "$registry" in
    marketplace) set -- npx --no-install @vscode/vsce publish --packagePath "$vsix" --skip-duplicate ;;
    openvsx) set -- npx --no-install ovsx publish --packagePath "$vsix" --skip-duplicate ;;
    *)
        echo "error: unknown registry '$registry' (expected marketplace or openvsx)." >&2
        exit 2
        ;;
esac

echo "Publishing $(basename "$vsix") to $registry..."

# Capture rather than stream so the message can be classified; echo it back
# either way, so the log still shows exactly what the CLI said.
set +e
output=$("$@" 2>&1)
status=$?
set -e

printf '%s\n' "$output"

if [ "$status" -eq 0 ]; then
    echo "result: published"
    exit 0
fi

# Order matters: the inactive message also contains "is already published",
# so the more specific case is tested first.
if printf '%s' "$output" | grep -qiF "isn't active and therefore not visible"; then
    echo "result: awaiting-activation" >&2
    echo "This version was already uploaded and is waiting for the registry to activate it." >&2
    echo "That is not a failure and re-publishing cannot fix it — the version is taken." >&2
    exit 0
fi

if printf '%s' "$output" | grep -qiE "is already published|already exists"; then
    echo "result: already-published" >&2
    echo "This version is already on $registry; nothing to do." >&2
    exit 0
fi

echo >&2
echo "error: publishing to $registry failed and the version is not up." >&2
echo "Both registries are immutable per version, so if any part of this upload landed," >&2
echo "this version number is spent: fix forward with the next patch version rather than" >&2
echo "retrying this one. See docs/how-to/publishing-a-release.md." >&2
exit "$status"
