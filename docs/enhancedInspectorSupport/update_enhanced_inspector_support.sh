#!/bin/bash
#
#
# Updates the payload .gs files (in resources/enhancedInspector/) from the
# project checkouts in $ROWAN_PROJECTS_HOME. Run this script to pick up the
# latest enhanced inspector support files when the projects have been updated.
#
# The following four projects must be cloned into $ROWAN_PROJECTS_HOME:
#   gt4gemstone            github.com/feenkcom/gt4gemstone
#   gtoolkit-remote        github.com/feenkcom/gtoolkit-remote
#   gtoolkit-wireencoding  github.com/feenkcom/gtoolkit-wireencoding
#   RemoteServiceReplication  github.com/GemTalk/RemoteServiceReplication
#
# REQUIREMENTS:
#   $ROWAN_PROJECTS_HOME  Directory containing the four project checkouts above
#
# USAGE:
#   ./update_enhanced_inspector_support.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Payload .gs files live in resources/enhancedInspector/ so they ship in the VSIX.
PAYLOAD_DIR="$SCRIPT_DIR/../../resources/enhancedInspector"
mkdir -p "$PAYLOAD_DIR"

if [ -z "$ROWAN_PROJECTS_HOME" ]; then
    echo "Error: ROWAN_PROJECTS_HOME is not set."
    exit 1
fi

# Verify all four project directories are present
missing_projects=()
for project in gt4gemstone gtoolkit-wireencoding gtoolkit-remote RemoteServiceReplication; do
    [ ! -d "$ROWAN_PROJECTS_HOME/$project" ] && missing_projects+=("$project")
done

if [ ${#missing_projects[@]} -gt 0 ]; then
    echo "Cannot update: the following project directories were not found in $ROWAN_PROJECTS_HOME:"
    for p in "${missing_projects[@]}"; do
        echo "  $p"
    done
    echo ""
    echo "Clone the missing projects into \$ROWAN_PROJECTS_HOME before running this script:"
    echo "  gt4gemstone            github.com/feenkcom/gt4gemstone"
    echo "  gtoolkit-remote        github.com/feenkcom/gtoolkit-remote"
    echo "  gtoolkit-wireencoding  github.com/feenkcom/gtoolkit-wireencoding"
    echo "  RemoteServiceReplication  github.com/GemTalk/RemoteServiceReplication"
    exit 1
fi

# Before running this script, pull the latest from each of the four repos:
#   git -C "$ROWAN_PROJECTS_HOME/gt4gemstone" pull
#   git -C "$ROWAN_PROJECTS_HOME/gtoolkit-wireencoding" pull
#   git -C "$ROWAN_PROJECTS_HOME/gtoolkit-remote" pull
#   git -C "$ROWAN_PROJECTS_HOME/RemoteServiceReplication" pull



# Warn and confirm before overwriting
existing=()
for f in Announcements.gs RemoteServiceReplication.gs STON.gs patch-gemstone.gs \
         gtoolkit-wireencoding.gs gt4gemstone.gs gtoolkit-remote.gs; do
    [ -f "$PAYLOAD_DIR/$f" ] && existing+=("$f")
done

if [ ${#existing[@]} -gt 0 ]; then
    echo "Warning: the following files will be overwritten in $PAYLOAD_DIR:"
    for f in "${existing[@]}"; do
        echo "  $f"
    done
    echo ""
    read -rp "Continue? [y/N] " answer
    case "$answer" in
        [yY]*) ;;
        *) echo "Aborted."; exit 0 ;;
    esac
fi

# Copy the src-gs files
cp "$ROWAN_PROJECTS_HOME/gt4gemstone/src-gs/Announcements.gs"        "$PAYLOAD_DIR/"
cp "$ROWAN_PROJECTS_HOME/RemoteServiceReplication/src-gs/bootstrapRSR.gs"  "$PAYLOAD_DIR/RemoteServiceReplication.gs"
cp "$ROWAN_PROJECTS_HOME/gt4gemstone/src-gs/STON.gs"                  "$PAYLOAD_DIR/"
cp "$ROWAN_PROJECTS_HOME/gt4gemstone/src-gs/patch-gemstone.gs"        "$PAYLOAD_DIR/"
cp "$ROWAN_PROJECTS_HOME/gtoolkit-wireencoding/src-gs/gtoolkit-wireencoding.gs" "$PAYLOAD_DIR/"
cp "$ROWAN_PROJECTS_HOME/gt4gemstone/src-gs/gt4gemstone.gs"           "$PAYLOAD_DIR/"
cp "$ROWAN_PROJECTS_HOME/gtoolkit-remote/src-gs/gtoolkit-remote.gs"   "$PAYLOAD_DIR/"

# Re-apply Jasper's post-processing to the freshly-copied upstream files:
#   - per-file attribution headers (origin repo + MIT license)
#   - class placement rewrite from Globals to Published
# These transforms are deterministic and idempotent; they MUST run on every
# update or the refreshed files would revert to pristine upstream (Globals,
# no headers). See apply_jasper_transforms.sh.
echo ""
echo "Applying Jasper transforms (attribution headers + Globals->Published)..."
"$SCRIPT_DIR/apply_jasper_transforms.sh" "$PAYLOAD_DIR"

echo ""
echo "Update complete. Files written to $PAYLOAD_DIR"
echo "Run the \"Install Server Support (Enhanced Inspector + Refactoring)\" command"
echo "(gemstone.installServerSupport) in the extension to load these into a stone."
