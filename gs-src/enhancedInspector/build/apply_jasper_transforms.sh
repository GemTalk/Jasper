#!/bin/bash
#
# apply_jasper_transforms.sh
#
# Post-processing applied to the vendored Enhanced Inspector .gs files after
# they are copied from upstream by update_enhanced_inspector_support.sh. Three
# deterministic transforms, all safe to re-run:
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
#   3. Rewrite the extension-method categories Rowan would otherwise claim, so
#      the payload also files in on a Rowan extent. See transform 1b below.
#
# Idempotent: the header is added only when its sentinel is absent, and the
# placement substitution matches nothing once already retargeted. Run either
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
# Prefix for rewritten extension categories; matches the dictionary the payload is
# filed into, so the uninstall sweep has one unambiguous anchor.
CATEGORY_PREFIX="GsEnhancedInspector-"

# In-place edit WITHOUT `sed -i`, whose argument GNU and BSD sed disagree about:
# BSD reads the next argument as a backup suffix, so `sed -i -E …` silently drops
# extended-regex mode (turning a group into literal parens, which can make a
# transform match the wrong lines rather than none) and leaves a stray `<file>-E`.
# Piping to a temp file and writing it back behaves identically on both.
#
# The result is written back with `cat >`, NOT `mv`: mktemp creates 0600 files, so
# moving one into place would leave the payload unreadable to anyone but its owner
# — and the gem reads these files server-side, so a gem running as another OS user
# would then fail the `gemCanRead` check with a "cannot read the payload" install
# error. Redirecting into the existing file keeps its mode.
edit_in_place() {
    local path="$1" tmp
    shift
    tmp="$(mktemp)"
    "$@" "$path" > "$tmp"
    cat "$tmp" > "$path"
    rm -f "$tmp"
}

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
    edit_in_place "$path" sed -E 's/inDictionary: (Globals|Published)/inDictionary: GsEnhancedInspector/g'

    # 1b. Extension-method categories -> the `GsEnhancedInspector-` prefix, so the
    #     payload also files in on a Rowan-enabled extent (extent0.rowan3.dbf).
    #     Rowan reads a leading `*` as "extension method belonging to package
    #     <rest of the category>" and either files our method into ITS package of
    #     that name (against ITS same-named class, which already has the selector
    #     -> "Duplicate definition") or, when no such package exists, refuses the
    #     compile on a class whose package follows the RowanHybrid convention
    #     ("does not map to a known package"). Without the `*` Rowan just adds the
    #     method to the class's own package, on both conventions.
    #
    #     The `*ston-…`/`*STON-…`/`*Announcements-…` categories are EXEMPT: those
    #     land only on kernel classes whose selectors Rowan already owns, and it
    #     keeps its own packaging for those and requires the category to stay
    #     `*<that package>` — prefixing them fails with "does not follow the
    #     expected package convention".
    #
    #     Also the anchor the uninstall sweep matches these methods by; see
    #     ENHANCED_INSPECTOR_CATEGORY_PREFIX in enhancedInspectorInstall.ts.
    edit_in_place "$path" sed -E "/^category: '\*([Ss][Tt][Oo][Nn]|[Aa]nnouncements)/! s/^category: '\*/category: '${CATEGORY_PREFIX}/"

    # Refresh the stale placement note in an already-headered file (the header
    # itself is only prepended when the sentinel is absent, below).
    edit_in_place "$path" sed 's/! class placement from Globals to Published\./! class placement from Globals to the dedicated GsEnhancedInspector dictionary./'

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
        # `cat >` rather than `mv`, to keep the file's mode -- see edit_in_place.
        cat "$tmp" > "$path"
        rm -f "$tmp"
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
