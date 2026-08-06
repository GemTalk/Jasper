#!/bin/bash
#
# apply_jasper_transforms.sh
#
# Post-processing applied to the vendored Enhanced Inspector .gs files after
# they are copied from upstream by update_enhanced_inspector_support.sh. Two
# deterministic transforms, both safe to re-run:
#
#   1. Prepend a per-file attribution header (origin repo, upstream source
#      path, MIT license) -- required because we vendor third-party code.
#   2. Rewrite class placement into the dedicated `GsEnhancedInspector`
#      dictionary (from upstream's `Globals`, or from the older `Published`
#      placement this project used before). The Enhanced Inspector installer
#      creates `GsEnhancedInspector` and shares it into every user's symbol list
#      (the same isolation the refactoring engine uses with `GsRefactoring`), so
#      the whole payload can be removed cleanly by dropping that one dictionary
#      instead of hunting commingled classes out of the shared `Published`.
#
# Idempotent: the header is added only when its sentinel is absent, and the
# placement substitution matches nothing once already retargeted. Run either
# standalone (re-applies to the vendored payload files) or from
# update_enhanced_inspector_support.sh after it refreshes the files from upstream.
#
# The payload .gs files live in resources/enhancedInspector/ (two levels up from
# this script), so they ship in the packaged VSIX; docs/ does not.
#
# USAGE:
#   ./apply_jasper_transforms.sh [target-dir]   # defaults to the payload dir

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${1:-$SCRIPT_DIR/../../resources/enhancedInspector}"

SENTINEL="! Jasper Enhanced Inspector vendored source"

apply_one() {
    local file="$1" origin="$2" src="$3" holder="$4"
    local path="$TARGET_DIR/$file"
    if [ ! -f "$path" ]; then
        echo "  skip (missing): $file"
        return 0
    fi

    # 1. Class placement -> the dedicated GsEnhancedInspector dictionary.
    #    Accepts upstream's `Globals` or this project's earlier `Published`
    #    placement; idempotent once already retargeted.
    sed -i -E 's/inDictionary: (Globals|Published)/inDictionary: GsEnhancedInspector/g' "$path"

    # Refresh the stale placement note in an already-headered file (the header
    # itself is only prepended when the sentinel is absent, below).
    sed -i 's/! class placement from Globals to Published\./! class placement from Globals to the dedicated GsEnhancedInspector dictionary./' "$path"

    # 2. Prepend the attribution header unless it is already present
    if ! head -1 "$path" | grep -qF "$SENTINEL"; then
        local tmp
        tmp="$(mktemp)"
        {
            echo "$SENTINEL"
            echo "! ----------------------------------------------------------------------------"
            echo "! Origin : $origin"
            echo "! Source : $src"
            echo "! License: MIT - Copyright (c) $holder. See LICENSE in the origin repository."
            echo "!"
            echo "! Vendored into Jasper and filed into the stone by the Enhanced Inspector"
            echo "! installer. DO NOT EDIT BY HAND - regenerated from upstream by"
            echo "! update_enhanced_inspector_support.sh, which re-applies this header and rewrites"
            echo "! class placement from Globals to the dedicated GsEnhancedInspector dictionary."
            echo "! ----------------------------------------------------------------------------"
            cat "$path"
        } > "$tmp"
        mv "$tmp" "$path"
    fi
    echo "  transformed: $file"
}

echo "Applying Jasper transforms in $TARGET_DIR ..."
# file | origin repo URL | upstream source path | copyright holder
while IFS='|' read -r file origin src holder; do
    [ -z "$file" ] && continue
    apply_one "$file" "$origin" "$src" "$holder"
done <<'EOF'
Announcements.gs|https://github.com/feenkcom/gt4gemstone|src-gs/Announcements.gs|feenk gmbh
RemoteServiceReplication.gs|https://github.com/GemTalk/RemoteServiceReplication|src-gs/bootstrapRSR.gs|GemTalk Systems, Inc
STON.gs|https://github.com/feenkcom/gt4gemstone|src-gs/STON.gs|feenk gmbh
patch-gemstone.gs|https://github.com/feenkcom/gt4gemstone|src-gs/patch-gemstone.gs|feenk gmbh
gtoolkit-wireencoding.gs|https://github.com/feenkcom/gtoolkit-wireencoding|src-gs/gtoolkit-wireencoding.gs|feenk gmbh
gt4gemstone.gs|https://github.com/feenkcom/gt4gemstone|src-gs/gt4gemstone.gs|feenk gmbh
gtoolkit-remote.gs|https://github.com/feenkcom/gtoolkit-remote|src-gs/gtoolkit-remote.gs|feenk gmbh
EOF
echo "Done."
