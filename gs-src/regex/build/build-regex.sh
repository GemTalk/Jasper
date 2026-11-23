#!/bin/bash
#
# Build the payloads that install Jasper's regular-expression support into a stone.
#
# Run it whenever anything under gs-src/regex/ changes, and commit the regenerated
# resources/regex/*.gs with it. It writes, in the order GsRegexLoader files them in:
#
#   regex-core.gs     the vendored GLASS Regex library, adapted for GemStone by
#                     adapt-glass-regex.js (which audits every change it makes)
#   engine.gs         Jasper's own classes: GsRegex and GsRegexSourceSearch
#   manifest.gs       expected classes and method counts, for the loader's check
#   regex-loader.gs   GsRegexLoader itself, into UserGlobals (a load-time tool)
#
# and, for tests only (not shipped; see .vscodeignore):
#
#   regex-tests.gs    the library's own tests (adapted the same way) and Jasper's,
#                     into UserGlobals so an ordinary user can file them in
#
# Usage (from anywhere): gs-src/regex/build/build-regex.sh
set -euo pipefail

REPO="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC="$REPO/gs-src/regex"
BUILD="$SRC/build"
CONVERTER="$REPO/gs-src/refactoring/build/tonel-to-gs.js"
GENERATED="$BUILD/generated-header.gs"
OUT="$REPO/resources/regex"
DICT="GsRegexLibrary"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$OUT"

echo "1/5 adapt the vendored library (audited)"
node "$BUILD/adapt-glass-regex.js" "$SRC/vendor/glass-regex" "$STAGE"

echo "2/5 library -> regex-core.gs"
node "$CONVERTER" --dict "$DICT" --header "$BUILD/regex-provenance-header.gs" \
  --out "$OUT/regex-core.gs" "$STAGE/Regex-Core"

echo "3/5 Jasper's classes -> engine.gs"
node "$CONVERTER" --dict "$DICT" --header "$GENERATED" --out "$OUT/engine.gs" "$SRC/engine"

echo "4/5 load manifest -> manifest.gs"
node "$CONVERTER" --dict "$DICT" --manifest "$OUT/manifest.gs" \
  --manifest-key GsRegexManifest --manifest-build gs-src/regex/build/build-regex.sh \
  "$STAGE/Regex-Core" "$SRC/engine"

echo "5/5 loader class -> regex-loader.gs (into UserGlobals)"
node "$CONVERTER" --dict UserGlobals --header "$GENERATED" --out "$OUT/regex-loader.gs" "$SRC/loader"

echo "+ tests (test-only) -> regex-tests.gs"
node "$CONVERTER" --dict UserGlobals --header "$BUILD/regex-provenance-header.gs" \
  --out "$OUT/regex-tests.gs" "$STAGE/Regex-Tests-Core" "$SRC/tests"

echo "Done. Payloads in $OUT:"
ls -1 "$OUT"
