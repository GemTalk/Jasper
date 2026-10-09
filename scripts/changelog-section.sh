#!/usr/bin/env bash
#
# Prints the CHANGELOG.md body for one released version, and fails if that
# version has no *dated* section yet.
#
# Run twice by the release workflow, which is the reason it is a script rather
# than an inline awk: once as a guard before the approval gate, throwing the
# output away, and once to supply the GitHub Release notes. Both therefore get
# the same answer to "which text belongs to this version" — a changelog that
# would produce unusable notes fails before the approval gate, instead of one
# step after the tag has been created.
#
# A dated heading is not enough: this also requires the section to have a
# body.
#
# Usage: scripts/changelog-section.sh <version>      # e.g. 1.8.15

set -euo pipefail

if [ "$#" -ne 1 ]; then
    echo "usage: $0 <version>   e.g. $0 1.8.15" >&2
    exit 2
fi

version="$1"
changelog="${CHANGELOG_PATH:-CHANGELOG.md}"

if [ ! -f "$changelog" ]; then
    echo "error: $changelog not found (run from the repo root)." >&2
    exit 2
fi

# Headings are `## [X.Y.Z] - YYYY-MM-DD`, so on a heading line $2 is the
# bracketed version and $3 is the literal "-". Requiring $3 is what
# distinguishes a promoted section from `## [Unreleased]`, which has no date.
section=$(awk -v want="$version" '
    /^## \[/ {
        if (inside) exit          # next version heading ends the section
        v = $2
        gsub(/^\[|\]$/, "", v)
        if (v == want && $3 == "-") { inside = 1; next }
    }
    inside { print }
' "$changelog")

if [ -z "$section" ]; then
    echo "error: $changelog has no dated '## [$version] - <date>' section." >&2
    echo "Promote the [Unreleased] section to '## [$version] - $(date -u +%Y-%m-%d)' and merge that before releasing." >&2
    exit 1
fi

printf '%s\n' "$section"
