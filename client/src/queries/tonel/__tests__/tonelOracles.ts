// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement.
//
// How the Tonel file-out suites judge output. Test support, not shipped code.
//
// The reference corpus
// ---------------------
// "The corpus", throughout this feature's code, tests and plan, means exactly one
// thing: the Tonel source tree GemStone ships with a rowan3 extent, at
//
//     $GEMSTONE/projects/gemstoneBaseImage/rowan/src/<package>/<Class>.class.st
//
// It is the base image's own kernel source — Object, Array, Message and the rest —
// written out in Tonel by `RwModificationTonelWriterVisitorV2`: the very class
// this feature drives. That is what makes it a reference rather than a fixture.
// Nobody wrote it for us, it cannot drift from the writer, and it covers shapes
// no hand-built fixture would think to include.
//
// Three counts appear and they are not in conflict:
//
//   720 files   — `*.class.st` on disk.
//   718 classes — distinct class names. Two names appear TWICE, under
//                 GemStone-RowanV2-Tools and GemStone-RowanV3-Tools
//                 (`GsRowanImageTool`, `GsTopazRowanTool`); the image holds the
//                 V3 one. This is why reference files are located by package and
//                 never by class name.
//   649 usable  — classes that actually resolve in a session's symbol list. The
//                 other 69 (`IndentingStream`, `StackSegment`, `SimpleBlock`, …)
//                 are in the source tree but not reachable by name, so a file-out
//                 cannot be asked for them at all. Tests report them as skips.
//
// What the corpus is NOT is a statement of what Jasper should write — see the
// next section.
//
// Why three oracles instead of one file diff
// -------------------------------------------
// The obvious test is "diff our file against the shipped `.class.st`". It is the
// wrong test. The reference corpus is a PACKAGE-PARTITIONED export: a class's
// methods are split across its own `.class.st` and other packages'
// `.extension.st` files. Jasper's file-out is CLASS-COMPLETE — every method a
// user can see, in one file — because a Jasper user has no notion of a Rowan
// package. Measured across the 649 resolvable corpus classes, ours carries 13,400
// methods the shipped file does not, by design. A whole-file diff therefore fails
// on 627 of them while telling us nothing.
//
// What a whole-file diff was really checking splits cleanly into three oracles.
// They are referred to by these names throughout the feature's tests and in the
// plan, so that "the header oracle failed" names one thing:
//
//   header oracle                — `headerOf`: the header must match the shipped
//                                  reference byte for byte (649/649 in the spike).
//   method-fidelity oracle       — `methodBlocksOf`: every method the shipped
//                                  reference carries must appear verbatim in ours
//                                  (0 missing, 0 altered).
//   selector-completeness oracle — `declarationsOf`: the file's selectors must
//                                  equal what the Explorer shows for the class.
//   method-order oracle          — `declarationSequenceOf`: the methods the
//                                  shipped reference carries must appear in OUR
//                                  file in the same relative order.
//
// The method-order oracle exists because the other three cannot see order at all:
// `methodBlocksOf` is a keyed map and `declarationsOf` sorts. Order is not
// cosmetic here — these files go into git, so an unstable or merely different
// order turns every subsequent diff into noise.
//
// The first two judge against the shipped corpus; the third judges against the
// live image. Only the third states the actual product requirement, and the
// corpus cannot express it at all.

/** Start of a method block: a category pragma alone on its line. */
const METHOD_BLOCK = /^\{ #category : '(?:[^']|'')*' \}$/gm;

/**
 * The full method declaration in a block, as one line.
 *
 * It must span LINES, not stop at the first. Rowan writes a long keyword
 * declaration across several lines, and `Array class` really does define both
 *
 *     byteSubclass:classVars:classInstVars:poolDictionaries:inDictionary:
 *       inClassHistory:description:isInvariant:
 *     byteSubclass:classVars:classInstVars:poolDictionaries:inDictionary:
 *       newVersionOf:description:options:
 *
 * whose first lines are identical. Keying on the first line alone made those two
 * distinct methods collide — which reported false duplicates, and worse, let a
 * genuinely doubled method hide behind a Map entry. Internal whitespace is
 * collapsed so the key does not depend on how the writer wrapped it.
 */
function declarationIn(block: string): string {
  const afterPragma = block.indexOf('\n');
  if (afterPragma < 0) return '';
  // The declaration ends at the ` [` that opens the body. The writer emits
  // `<< ' [' << methodBody`, so the body may begin on the same line or the next;
  // either way ` [` is the terminator, and a declaration never contains one.
  const open = block.indexOf(' [', afterPragma);
  const text = open < 0 ? block.slice(afterPragma + 1) : block.slice(afterPragma + 1, open);
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Everything before the first method — the comment, if any, and the
 * `Class { … }` / `Extension { … }` block.
 *
 * Anchored to a category pragma at the START of a line, so a category literal
 * inside a method body cannot truncate the header and make two different files
 * compare equal.
 *
 * Blank lines at the boundary are normalized to a single newline, here and in
 * {@link methodBlocksOf}, because that whitespace belongs to neither side: it is
 * the separator between them. Everything INSIDE a header or a method block stays
 * exact, which is where drift would actually matter.
 */
export function headerOf(tonel: string): string {
  METHOD_BLOCK.lastIndex = 0;
  const first = METHOD_BLOCK.exec(tonel);
  const header = first === null ? tonel : tonel.slice(0, first.index);
  return header.replace(/\n+$/, '\n');
}

/**
 * Every method block, keyed by its declaration (`Widget class >> make`), with
 * the block kept verbatim — pragma line, declaration, body and closing `]`.
 *
 * Verbatim is the point: this is the method-fidelity oracle, so any whitespace or
 * line-ending drift in method emission has to show up as an inequality.
 */
export function methodBlocksOf(tonel: string): Map<string, string> {
  const blocks = new Map<string, string>();
  METHOD_BLOCK.lastIndex = 0;
  const starts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = METHOD_BLOCK.exec(tonel)) !== null) starts.push(match.index);

  for (let i = 0; i < starts.length; i++) {
    const block = tonel.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : tonel.length);
    const declaration = declarationIn(block);
    if (declaration.length > 0) blocks.set(declaration, block.replace(/\n+$/, '\n'));
  }
  return blocks;
}

/**
 * Declarations that appear MORE THAN ONCE — the duplicate oracle.
 *
 * This exists because its absence hid a real bug. `methodBlocksOf` answers a Map,
 * and `declarationsOf` sorts: both silently collapse a file that emits the same
 * method twice, so every comparison built on them passed while the file-out was
 * writing each method of a Rowan-loaded class twice over. A Map cannot see a
 * duplicate; only counting can.
 */
export function duplicateDeclarationsOf(tonel: string): string[] {
  const seen = new Map<string, number>();
  METHOD_BLOCK.lastIndex = 0;
  const starts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = METHOD_BLOCK.exec(tonel)) !== null) starts.push(match.index);
  for (let i = 0; i < starts.length; i++) {
    const declaration = declarationIn(
      tonel.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : tonel.length),
    );
    if (declaration.length > 0) seen.set(declaration, (seen.get(declaration) ?? 0) + 1);
  }
  return [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([d]) => d)
    .sort();
}

/**
 * Every method declaration in FILE order, ONE ENTRY PER BLOCK — the method-order
 * oracle.
 *
 * Deliberately unsorted, and deliberately NOT the keys of {@link methodBlocksOf}:
 * that is a Map, so reading its keys would collapse a doubled method and make
 * this blind to duplication in exactly the way the rest of these helpers were.
 * A caller comparing this against the image's selector count depends on it
 * counting blocks, not distinct names.
 */
export function declarationSequenceOf(tonel: string): string[] {
  const out: string[] = [];
  METHOD_BLOCK.lastIndex = 0;
  const starts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = METHOD_BLOCK.exec(tonel)) !== null) starts.push(match.index);
  for (let i = 0; i < starts.length; i++) {
    const declaration = declarationIn(
      tonel.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : tonel.length),
    );
    if (declaration.length > 0) out.push(declaration);
  }
  return out;
}

/** Selector names in a Tonel file, split by side — the selector-completeness oracle. */
export interface TonelDeclarations {
  instance: string[];
  meta: string[];
}

/** Reduce `Widget >> at: k put: v` to the selector `at:put:`. */
function selectorOf(declaration: string): string {
  const afterArrow = declaration.slice(declaration.indexOf('>>') + 2).trim();
  const keywords = afterArrow.match(/[A-Za-z_][A-Za-z0-9_]*:/g);
  if (keywords !== null) return keywords.join('');
  const binary = afterArrow.match(/^[+\-*/<>=~&|@%?,]{1,2}/);
  if (binary !== null) return binary[0];
  return afterArrow.split(/\s+/)[0];
}

/** The selectors a Tonel file defines, each side sorted. */
export function declarationsOf(tonel: string): TonelDeclarations {
  const instance: string[] = [];
  const meta: string[] = [];
  for (const declaration of methodBlocksOf(tonel).keys()) {
    (/ class\s*>>/.test(declaration) ? meta : instance).push(selectorOf(declaration));
  }
  return { instance: instance.sort(), meta: meta.sort() };
}
