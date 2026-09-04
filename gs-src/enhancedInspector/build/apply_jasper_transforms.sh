#!/bin/bash
#
# apply_jasper_transforms.sh
#
# Post-processing applied to the vendored Enhanced Inspector .gs files after
# they are copied from upstream by update_enhanced_inspector_support.sh. Two
# deterministic transforms, both safe to re-run:
#
#   1. Write a per-file attribution header (origin repo, upstream source path,
#      upstream project, MIT copyright holders) -- required because we vendor
#      third-party code. Any header a previous run wrote is replaced, so a
#      correction to the attribution table at the bottom of this script reaches
#      the already-committed payload files.
#   2. Rewrite class placement into the dedicated `GsEnhancedInspector`
#      dictionary (from upstream's `Globals`, or from the older `Published`
#      placement this project used before). The Enhanced Inspector installer
#      creates `GsEnhancedInspector` and shares it into every user's symbol list
#      (the same isolation the refactoring engine uses with `GsRefactoring`), so
#      the whole payload can be removed cleanly by dropping that one dictionary
#      instead of hunting commingled classes out of the shared `Published`.
#
# Idempotent: the header is regenerated from the table below rather than
# appended to, and the placement substitution matches nothing once already
# retargeted -- so re-running is a no-op unless the table changed. Run either
# standalone (re-applies to the vendored payload files) or from
# update_enhanced_inspector_support.sh after it refreshes the files from upstream.
#
# The payload .gs files live in resources/enhancedInspector/ (this script sits
# at gs-src/enhancedInspector/build/, so the repo root is three levels up and
# resources/enhancedInspector/ is two levels down from there), so they ship in
# the packaged VSIX; docs/ does not.
#
# USAGE:
#   ./apply_jasper_transforms.sh [target-dir]   # defaults to the payload dir

set -e
REPO="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TARGET_DIR="${1:-$REPO/resources/enhancedInspector}"

SENTINEL="! Jasper Enhanced Inspector vendored source"
DASHES="! ----------------------------------------------------------------------------"

# Emit the attribution header for one file on stdout.
#   $1 origin repo URL   $2 upstream source path within it
#   $3 upstream project (or "-" when it is the origin repo itself)
#   $4 copyright line(s), ";"-separated when a file has more than one holder
emit_header() {
    local origin="$1" src="$2" upstream="$3" copyrights="$4"
    echo "$SENTINEL"
    echo "$DASHES"
    echo "! Origin  : $origin"
    echo "! Source  : $src"
    if [ "$upstream" != "-" ]; then
        echo "! Upstream: $upstream"
    fi
    local first=1 c
    # Files exported out of one repo but owned by another (Announcements, STON)
    # carry more than one notice; print the rest as continuation lines.
    while IFS= read -r c; do
        [ -z "$c" ] && continue
        if [ "$first" = 1 ]; then
            echo "! License : MIT - $c"
            first=0
        else
            echo "!           MIT - $c"
        fi
    done <<< "$(echo "$copyrights" | tr ';' '\n' | sed -E 's/^ +//; s/ +$//')"
    echo "!           Full MIT notice and permission text: THIRD-PARTY.md and"
    echo "!           NOTICE at the root of https://github.com/GemTalk/Jasper"
    echo "!"
    echo "! Vendored into Jasper and filed into the stone by the Enhanced Inspector"
    echo "! installer. DO NOT EDIT BY HAND - regenerated from upstream by"
    echo "! update_enhanced_inspector_support.sh, which re-applies this header and rewrites"
    echo "! class placement from Globals to the dedicated GsEnhancedInspector dictionary."
    echo "$DASHES"
}

apply_one() {
    local file="$1" origin="$2" src="$3" upstream="$4" copyrights="$5"
    local path="$TARGET_DIR/$file"
    if [ ! -f "$path" ]; then
        echo "  skip (missing): $file"
        return 0
    fi

    # 1. Class placement -> the dedicated GsEnhancedInspector dictionary.
    #    Accepts upstream's `Globals` or this project's earlier `Published`
    #    placement; idempotent once already retargeted.
    sed -i -E 's/inDictionary: (Globals|Published)/inDictionary: GsEnhancedInspector/g' "$path"

    # 2. (Re-)write the attribution header. Any header this script wrote before
    #    is stripped first -- the block runs from the sentinel on line 1 through
    #    the second dashed rule -- so corrections to the table below (a copyright
    #    holder, an upstream project) propagate on the next run instead of being
    #    skipped because a stale header happened to be present.
    local tmp body
    tmp="$(mktemp)"
    body="$(mktemp)"
    if head -1 "$path" | grep -qF "$SENTINEL"; then
        # Drop line 1 (the sentinel) and everything up to the second dashed
        # rule; print the payload that follows.
        awk -v dashes="$DASHES" '
            stripped { print; next }
            NR == 1 { next }
            $0 == dashes { if (++seen == 2) stripped = 1; next }
            { next }
        ' "$path" > "$body"
        # A header missing its closing rule would strip the whole file, and the
        # payload is only recoverable from git -- refuse instead.
        if [ ! -s "$body" ]; then
            rm -f "$tmp" "$body"
            echo "  ERROR: $file starts with the Jasper header sentinel but has no" >&2
            echo "         closing rule; stripping it would empty the file. Fix the" >&2
            echo "         header (or restore the file from git) and re-run." >&2
            return 1
        fi
    else
        cat "$path" > "$body"
    fi
    {
        emit_header "$origin" "$src" "$upstream" "$copyrights"
        cat "$body"
    } > "$tmp"
    mv "$tmp" "$path"
    rm -f "$body"
    echo "  transformed: $file"
}

echo "Applying Jasper transforms in $TARGET_DIR ..."
# The copyright lines below are quoted from each *upstream project's* LICENSE
# exactly as written there -- "feenk" (not "feenk gmbh"), "GemTalk Systems" (not
# "GemTalk Systems, Inc"), and an individual for gtoolkit-remote. Announcements
# and STON are exports of other projects that gt4gemstone writes into its own
# src-gs/, so their notices are not feenk's. See THIRD-PARTY.md.
# file | origin repo URL | upstream source path | upstream project | copyright line(s)
while IFS='|' read -r file origin src upstream copyrights; do
    [ -z "$file" ] && continue
    apply_one "$file" "$origin" "$src" "$upstream" "$copyrights"
done <<'EOF'
Announcements.gs|https://github.com/feenkcom/gt4gemstone|src-gs/Announcements.gs|https://github.com/GemTalk/Announcements|Copyright (c) 2020-2021 GemTalk Systems
RemoteServiceReplication.gs|https://github.com/GemTalk/RemoteServiceReplication|src-gs/bootstrapRSR.gs|-|Copyright (c) 2017-2024 GemTalk Systems
STON.gs|https://github.com/feenkcom/gt4gemstone|src-gs/STON.gs|https://github.com/svenvc/ston (GemStone port: GemTalk/Rowan)|Copyright (C) 2012 Sven Van Caekenberghe; Copyright (c) 2018 Dale Henrichs (Rowan port)
patch-gemstone.gs|https://github.com/feenkcom/gt4gemstone|src-gs/patch-gemstone.gs|-|Copyright (c) 2021 feenk
gtoolkit-wireencoding.gs|https://github.com/feenkcom/gtoolkit-wireencoding|src-gs/gtoolkit-wireencoding.gs|-|Copyright (c) 2024 feenk
gt4gemstone.gs|https://github.com/feenkcom/gt4gemstone|src-gs/gt4gemstone.gs|-|Copyright (c) 2021 feenk
gtoolkit-remote.gs|https://github.com/feenkcom/gtoolkit-remote|src-gs/gtoolkit-remote.gs|-|Copyright (c) 2019 Juraj Kubelka
EOF
echo "Done."
