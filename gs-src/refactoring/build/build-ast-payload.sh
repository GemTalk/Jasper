#!/bin/bash
#
# Build the vendored AST substrate .gs payload the refactoring engine loads.
#
# Turns the verbatim Tonel under gs-src/refactoring/vendor/rowanv3-ast/ into the
# single topaz-chunk file resources/refactoring/ast-core.gs that a stone files
# in. Run this whenever the vendored source changes; commit the regenerated
# ast-core.gs alongside it.
#
# Pipeline: copy the verbatim Tonel to a temp dir, apply the one documented
# adaptation there (never to the vendored files), then run tonel-to-gs.js. The
# adaptation is audited -- the build FAILS if the expected number of sites
# drifts, so a re-vendor that introduces a new Rowan dependency is caught here
# rather than silently shipped.
#
# Kernel extension methods (AST-Kernel-Core) are emitted with --gate-extensions:
# each is compiled only if the target class does not already define it
# (includesSelector:), so a rowan3 extent -- which ships this same family -- keeps
# its own copies instead of having them overwritten.
#
# The one adaptation (applied verbatim -> adapted):
#   `Rowan globalNamed: X` -> `System myUserProfile symbolList objectNamed: X`
#   Reason: the AST loads on a bare, non-Rowan stone where `Rowan` is undefined;
#   resolving the global via the session symbol list is behaviour-preserving.
#   Occurs once in AST-Core (RBProgramNode class>>formatterClass, a dead branch)
#   and twice in AST-Tests-Core (RBFormatterTests).
#
# Usage (from anywhere -- paths resolve relative to this script):
#   gs-src/refactoring/build/build-ast-payload.sh [--dict DICT] [--tests-out PATH]
#
# Outputs:
#   resources/refactoring/ast-core.gs        (engine substrate; ships in VSIX)
#   <tests-out>/ast-tests.gs                 (only with --tests-out; dev/CI only,
#                                             not shipped)
set -euo pipefail

REPO="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BUILD="$REPO/gs-src/refactoring/build"
VENDOR="$REPO/gs-src/refactoring/vendor/rowanv3-ast"
CONVERTER="$BUILD/tonel-to-gs.js"
HEADER="$BUILD/ast-provenance-header.gs"
OUT="$REPO/resources/refactoring"
# GsRefactoring is the dedicated, isolated symbol dictionary the loader creates
# and parks at the end of the symbol list for normal use (so it does not shadow
# base/kernel or Rowan classes). Keeping the engine here rather than in
# Published/UserGlobals keeps it out of other code and lets it be shared across
# users independently. The loader (GsRefactoringLoader) creates the dict before
# this payload files in, and moves it to the FRONT for the duration of the
# file-in -- the chunk directives below name their class as a bareword, which on
# a rowan3 extent would otherwise resolve to RowanKernel's RB class instead of
# ours. See GsRefactoringLoader>>withDictionaryFirstDo:.
DICT="GsRefactoring"
TESTS_OUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dict) DICT="$2"; shift 2 ;;
    --tests-out) TESTS_OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -r "$VENDOR/AST-Core" "$VENDOR/AST-Kernel-Core" "$VENDOR/AST-Tests-Core" "$STAGE/"
chmod -R u+w "$STAGE"   # release-tree sources are read-only; the stage must be writable

# Apply + audit the de-Rowan adaptation. EXPECTED counts guard against drift.
apply_adaptations() {
  local dir="$1" expected="$2"
  python3 - "$dir" "$expected" <<'PY'
import sys, os, re
root, expected = sys.argv[1], int(sys.argv[2])
find = "Rowan globalNamed:"
repl = "System myUserProfile symbolList objectNamed:"
total = 0
for dp, _, files in os.walk(root):
    for f in files:
        if not (f.endswith('.class.st') or f.endswith('.extension.st')):
            continue
        p = os.path.join(dp, f)
        s = open(p).read()
        n = s.count(find)
        if n:
            open(p, 'w').write(s.replace(find, repl))
            for i, line in enumerate(s.splitlines(), 1):
                if find in line:
                    print(f"  adapt {os.path.relpath(p, root)}:{i}: Rowan globalNamed: -> symbolList objectNamed:")
            total += n
if total != expected:
    sys.exit(f"ERROR: expected {expected} 'Rowan globalNamed:' adaptation(s), found {total}. "
             "Upstream changed -- review before shipping.")
print(f"  ({total} adaptation(s) applied in {os.path.basename(root)})")
PY
}

echo "Adapting engine (AST-Core + AST-Kernel-Core)..."
apply_adaptations "$STAGE/AST-Core" 1
apply_adaptations "$STAGE/AST-Kernel-Core" 0

mkdir -p "$OUT"
node "$CONVERTER" --dict "$DICT" --header "$HEADER" --gate-extensions \
  --out "$OUT/ast-core.gs" "$STAGE/AST-Core" "$STAGE/AST-Kernel-Core"

if [ -n "$TESTS_OUT" ]; then
  echo "Adapting tests (AST-Tests-Core)..."
  apply_adaptations "$STAGE/AST-Tests-Core" 2
  mkdir -p "$TESTS_OUT"
  node "$CONVERTER" --dict "$DICT" --header "$HEADER" \
    --out "$TESTS_OUT/ast-tests.gs" "$STAGE/AST-Tests-Core"
fi

echo "Done. Engine payload: $OUT/ast-core.gs"
