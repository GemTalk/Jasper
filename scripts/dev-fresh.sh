#!/usr/bin/env bash
#
# Launch the extension in a fresh, isolated editor window — none of your
# personal settings, extensions, or login keychain. Loads Jasper from this
# working copy (whatever branch is checked out).
#
# By default the GemStone install root (gemstone.rootPath) is isolated to an
# empty throwaway dir, so the window opens in a clean, brand-new-user state:
# no servers you've downloaded, no stones. Pass --keep-installs (or run
# `npm run dev:fresh:keep-installs`) to reuse your real ~/Documents/GemStone so
# you can connect to existing installs.
#
# We deliberately isolate ONLY gemstone.rootPath and leave HOME untouched, so
# ~/.jasper and ~/.claude.json still resolve to your real home. Reasoning: the
# common case is opening a Claude Code CLI in the integrated terminal to work
# against this fresh window, and isolating HOME would (a) log that CLI out
# (Claude Code keeps auth in ~/.claude.json) and (b) skip Jasper's MCP
# registration entirely — Jasper only writes its MCP entry into an *existing*
# ~/.claude.json, so a throwaway home means no auto-configured jasper MCP. For
# now, keeping the CLI logged in with the MCP server auto-configured is more
# useful than a perfectly pristine home. We may revisit this later (e.g. an
# opt-in --isolate-home flag) if a true brand-new-machine repro is needed.
#
# Usage:
#   npm run dev:fresh                          # clean state, empty workspace
#   npm run dev:fresh -- /path/to/dir          # clean state, open a folder
#   npm run dev:fresh:keep-installs            # reuse your real installs
#   npm run dev:fresh -- --keep-installs /dir  # reuse installs + open a folder
#
# For live reload, run `npm run watch` in another terminal, then reload the
# dev window (Cmd+R / "Developer: Reload Window") after edits.
set -euo pipefail

cd "$(dirname "$0")/.."

# Parse args (order-independent): the --keep-installs flag (also settable via
# JASPER_DEV_KEEP_INSTALLS=1) and an optional workspace folder.
KEEP_INSTALLS="${JASPER_DEV_KEEP_INSTALLS:-}"
WORKSPACE_ARG=""
for arg in "$@"; do
  case "$arg" in
    --keep-installs) KEEP_INSTALLS=1 ;;
    *) WORKSPACE_ARG="$arg" ;;
  esac
done

# Pick an editor CLI: VSCodium, then VS Code (and their Insiders builds).
EDITOR_CLI=""
for c in codium code codium-insiders code-insiders; do
  if command -v "$c" >/dev/null 2>&1; then EDITOR_CLI="$c"; break; fi
done
if [ -z "$EDITOR_CLI" ]; then
  echo "No editor CLI (codium/code) on PATH." >&2
  echo "In VS Code/VSCodium: Cmd+Shift+P -> 'Shell Command: Install ... command in PATH'." >&2
  exit 1
fi

# Build the extension if it isn't compiled yet (skip when using `npm run watch`).
if [ ! -f client/out/extension.js ]; then
  echo "client/out not built - compiling (use 'npm run watch' for live reload)..."
  npm run compile:fresh --workspace client
fi

# Warn (don't block) if the compiled bundle looks older than the TypeScript
# sources - dev:fresh does NOT rebuild an existing client/out, so a stale
# build would launch silently. mtime heuristic; see CONTRIBUTING for caveats.
newer="$(find client/src server/src -name '*.ts' -newer client/out/extension.js -print -quit 2>/dev/null)"
if [ -n "$newer" ]; then
  bold="$(tput bold 2>/dev/null || true)"
  yellow="$(tput setaf 3 2>/dev/null || true)"
  reset="$(tput sgr0 2>/dev/null || true)"
  echo ""
  echo "${bold}${yellow}##########################################################${reset}"
  echo "${bold}${yellow}#  ⚠️  WARNING: client/out may be STALE                   #${reset}"
  echo "${bold}${yellow}##########################################################${reset}"
  echo "${bold}${yellow}#${reset} $newer is newer than the compiled bundle."
  echo "${bold}${yellow}#${reset} Run 'npm run watch' (live), 'npm run compile:client',"
  echo "${bold}${yellow}#${reset} or 'npm run compile:clean && npm run compile' to force a clean rebuild."
  echo ""
fi

PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/jasper-dev.XXXXXX")"
WORKSPACE="${WORKSPACE_ARG:-$(mktemp -d "${TMPDIR:-/tmp}/jasper-ws.XXXXXX")}"

# Seed gemstone.rootPath into the throwaway profile's User settings (VS Code
# reads <user-data-dir>/User/settings.json). Writing it here keeps your own
# workspace folder untouched and always applies, regardless of the workspace.
USER_SETTINGS_DIR="$PROFILE/user-data/User"
mkdir -p "$USER_SETTINGS_DIR"
if [ -n "$KEEP_INSTALLS" ]; then
  INSTALLS_DESC="reusing your real installs (~/Documents/GemStone)"
else
  GEMSTONE_ROOT="$PROFILE/gemstone-root"
  mkdir -p "$GEMSTONE_ROOT"
  printf '{\n  "gemstone.rootPath": "%s"\n}\n' "$GEMSTONE_ROOT" > "$USER_SETTINGS_DIR/settings.json"
  INSTALLS_DESC="isolated empty root ($GEMSTONE_ROOT) - use --keep-installs to reuse your real installs"
fi

echo "Launching $EDITOR_CLI with a fresh profile:"
echo "  extension : $PWD (branch $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?'))"
echo "  profile   : $PROFILE   (throwaway - no personal settings/extensions/keychain)"
echo "  workspace : $WORKSPACE"
echo "  installs  : $INSTALLS_DESC"

exec "$EDITOR_CLI" \
  --extensionDevelopmentPath="$PWD" \
  --user-data-dir="$PROFILE/user-data" \
  --extensions-dir="$PROFILE/extensions" \
  --password-store=basic \
  --disable-workspace-trust \
  --new-window \
  "$WORKSPACE"
