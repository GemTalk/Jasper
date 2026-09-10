import { vendoredRevisions, declaredFunctions, type DeclaredFunction } from './headerDeclarations';
import { compareGemStoneVersions } from '../gemStoneVersion.js';

/**
 * Derives the header-gated half of the GCI optional-functions registry from the
 * vendored `gcits.hf` snapshots, and renders it as the TypeScript module
 * `optionalFunctions.generated.ts`. Driven by
 * `scripts/generate-gci-optional-functions.mjs`.
 *
 * This reads `vendor/`, which `.vscodeignore:37` excludes from the packaged
 * `.vsix` — it has no production caller by design. Importing it from shipped
 * code would break packaging. The *generated* module it writes is ordinary
 * shipped code; this one only produces it.
 */

/** A symbol the headers themselves gate, and the reason they gate it. */
export interface DerivedEntry {
  name: string;
  /** Oldest vendored revision declaring it, when that isn't the oldest revision. */
  addedIn?: string;
  /** Declared inside `#if defined(FLG_UNIX)` in every revision that declares it. */
  absentOn?: 'win32';
}

/** Anything the renderer can emit as a bare object key. */
const JS_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const EXPORT_NAME = 'HEADER_DERIVED_OPTIONAL_FUNCTIONS';

function fail(message: string): never {
  throw new Error(`optionalFunctionsFromHeaders: ${message}`);
}

/**
 * Orders by effective floor (oldest first), then by name. A no-`addedIn` entry
 * floors at the oldest revision — it *is* declared from that snapshot onward.
 *
 * The name tie-break is a raw `<`/`>` comparison rather than `localeCompare`,
 * whose collation depends on the ICU data the running Node was built with: CI
 * diff-checks this file, so an ordering that varies by machine would fail there
 * for a developer who regenerated it correctly.
 */
function byFloorThenName(oldestRevision: string) {
  const floorOf = (entry: DerivedEntry) => entry.addedIn ?? oldestRevision;
  return (a: DerivedEntry, b: DerivedEntry) =>
    compareGemStoneVersions(floorOf(a), floorOf(b)) ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/**
 * Every symbol declared in at least one vendored revision — the universe the
 * derivation reasons over, since a symbol missing from a revision is a fact
 * about that symbol, not an absence from the set.
 */
function namesDeclaredAnywhere(
  revisions: string[],
  declarations: Map<string, Map<string, DeclaredFunction>>,
): Set<string> {
  const names = new Set<string>();
  for (const revision of revisions) {
    for (const name of declarations.get(revision)!.keys()) names.add(name);
  }
  return names;
}

/**
 * The header-gated symbols of `root`, in emission order, with the revisions
 * they were derived from.
 *
 * Returning the revisions rather than letting the caller re-read them keeps a
 * generated file's caption and its entries from describing two different trees.
 *
 * Throws rather than returning a confident, wrong registry whenever the headers
 * say something this schema cannot express — see the guards below. Each is a
 * shape that has never occurred across the vendored revisions; the day one
 * does, the answer is to extend the schema, not to let the generator guess.
 */
export function deriveOptionalFunctions(root?: string): {
  entries: DerivedEntry[];
  revisions: string[];
} {
  const revisions = vendoredRevisions(root);
  if (revisions.length === 0) fail('no vendored revisions found — nothing to derive from.');

  const declarations = new Map(
    revisions.map((revision) => [revision, declaredFunctions(revision, root)]),
  );
  const newest = revisions[revisions.length - 1];

  const entries: DerivedEntry[] = [];
  for (const name of namesDeclaredAnywhere(revisions, declarations)) {
    const declaringRevisions = revisions.filter((revision) =>
      declarations.get(revision)!.has(name),
    );

    // A removal inside the vendored range. `removedIn` is a sentinel for a
    // release deliberately not vendored, so it cannot name this one, and
    // treating the symbol as merely optional would claim the newest library
    // still exports it.
    if (!declaringRevisions.includes(newest)) {
      fail(
        `${name} is declared in ${declaringRevisions.join(', ')} but not in the newest revision ` +
          `${newest} — a removal inside the vendored range, which the registry cannot express.`,
      );
    }

    // `addedIn` means "and every release after", so the declaring revisions
    // must be a suffix. A symbol that came, went and came back has no floor.
    const suffix = revisions.slice(revisions.length - declaringRevisions.length);
    if (declaringRevisions.join() !== suffix.join()) {
      fail(
        `${name} is declared in ${declaringRevisions.join(', ')}, which is not a contiguous run ` +
          `ending at ${newest} — no single addedIn floor describes it.`,
      );
    }

    const unixOnlyIn = declaringRevisions.filter(
      (revision) => declarations.get(revision)!.get(name)!.unixOnly,
    );
    // `absentOn` is unconditional, so it cannot say "Unix-only from 3.7.2 on".
    if (unixOnlyIn.length > 0 && unixOnlyIn.length !== declaringRevisions.length) {
      fail(
        `${name} sits inside #if defined(FLG_UNIX) in ${unixOnlyIn.join(', ')} but not in ` +
          `${declaringRevisions.filter((revision) => !unixOnlyIn.includes(revision)).join(', ')} — ` +
          `absentOn applies to every revision that declares a symbol.`,
      );
    }

    const addedIn =
      declaringRevisions.length < revisions.length ? declaringRevisions[0] : undefined;
    const absentOn = unixOnlyIn.length > 0 ? ('win32' as const) : undefined;
    if (addedIn === undefined && absentOn === undefined) continue; // Not gated: required everywhere.

    entries.push({ name, ...(addedIn && { addedIn }), ...(absentOn && { absentOn }) });
  }

  entries.sort(byFloorThenName(revisions[0]));
  return { entries, revisions };
}

/** The `{ addedIn: '3.7.0', absentOn: 'win32' }` half of one entry's line. */
function renderReason({ addedIn, absentOn }: DerivedEntry): string {
  const fields = [
    ...(addedIn ? [`addedIn: '${addedIn}'`] : []),
    ...(absentOn ? [`absentOn: '${absentOn}'`] : []),
  ];
  return `{ ${fields.join(', ')} }`;
}

/**
 * The generated module's source, given what `deriveOptionalFunctions` found.
 *
 * Pure — no filesystem — so the banner, the grouping and the ordering are
 * testable without a header tree. Line endings are hard-coded `\n` rather than
 * `os.EOL`: `.gitattributes` pins the working tree to LF, and CI diff-checks
 * this file.
 */
export function renderOptionalFunctionsModule(
  entries: DerivedEntry[],
  revisions: string[],
): string {
  if (revisions.length === 0) fail('cannot render a module without the revisions it came from.');
  const oldest = revisions[0];
  const newest = revisions[revisions.length - 1];

  const lines = [
    '/*',
    ' * GENERATED FILE — DO NOT EDIT BY HAND.',
    ' *',
    ' * Produced from the vendored GCI headers by',
    ' * `npm run generate:gci-optional-functions`. CI reruns that script and fails',
    ' * on any diff, so an edit here is reverted rather than kept.',
    ' *',
    ' * A symbol lands here when the headers themselves gate it: declared in only a',
    ' * suffix of the vendored revisions (`addedIn`, its oldest declaring revision),',
    " * or declared inside `#if defined(FLG_UNIX)` (`absentOn: 'win32'`). One",
    ' * declared unconditionally in every revision is required, not optional, and is',
    ' * omitted. Removal is not derivable — every vendored snapshot predates it — so',
    ' * `removedIn` entries are hand-written in `optionalFunctions.ts`.',
    ' *',
    ` * Derived from ${revisions.length} vendored revision(s), ${oldest} through ${newest}.`,
    ' */',
    '',
    `export const ${EXPORT_NAME} = {`,
  ];

  // `as const` below is load-bearing, not decoration: without it `absentOn`
  // widens to `string` and the `satisfies` in optionalFunctions.ts fails.
  let previousFloor: string | undefined;
  for (const entry of entries) {
    const floor = entry.addedIn ?? oldest;
    if (floor !== previousFloor) {
      if (previousFloor !== undefined) lines.push('');
      lines.push(
        entry.addedIn
          ? `  // Added in ${entry.addedIn}.`
          : '  // Declared in every vendored revision, inside `#if defined(FLG_UNIX)`.',
      );
      previousFloor = floor;
    }
    // Not reachable from `deriveOptionalFunctions` — the header parser only
    // ever yields `[A-Za-z_][A-Za-z0-9_]*` — but this is the point where a name
    // becomes syntax, so a caller assembling entries by hand is stopped here
    // rather than handed a module that does not parse.
    if (!JS_IDENTIFIER_RE.test(entry.name)) {
      fail(`${entry.name} is not a bare JavaScript identifier — the module would not parse.`);
    }
    lines.push(`  ${entry.name}: ${renderReason(entry)},`);
  }

  lines.push('} as const;', '');
  return lines.join('\n');
}
