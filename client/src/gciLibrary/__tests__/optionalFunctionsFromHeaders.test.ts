import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  deriveOptionalFunctions,
  renderOptionalFunctionsModule,
  type DerivedEntry,
} from '../optionalFunctionsFromHeaders';

/**
 * Fixture header trees rather than the vendored ones, for everything except the
 * committed generated file itself (which CI diff-checks against `vendor/`).
 * The vendored snapshots are ten well-behaved revisions; the shapes that matter
 * here — a symbol that comes and goes, one that changes platform gate midway —
 * have never occurred there and cannot be staged in them.
 *
 * Real directories on disk, in the style of `headerDeclarations.test.ts`: the
 * code under test reads `fs` through `headerDeclarations`, and faking that
 * would stub out the very readdir-and-parse path being exercised.
 */
const temporaryRoots: string[] = [];

/** A `<revision>/gcits.hf` per entry. Revision names must parse as GemStone versions. */
function headersRootWith(sources: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gci-derive-'));
  temporaryRoots.push(root);
  for (const [revision, source] of Object.entries(sources)) {
    fs.mkdirSync(path.join(root, revision));
    fs.writeFileSync(path.join(root, revision, 'gcits.hf'), source);
  }
  return root;
}

afterAll(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
});

const declares = (...names: string[]): string =>
  names.map((name) => `EXTERN_GCI_DEC(int) ${name}(GciSession sess) GCI_WEAK;`).join('\n');

const unixOnly = (...names: string[]): string =>
  `#if defined(FLG_UNIX)\n${declares(...names)}\n#endif`;

function messageFrom(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the call to throw, but it returned normally');
}

const entriesOf = (root: string): DerivedEntry[] => deriveOptionalFunctions(root).entries;

describe('deriveOptionalFunctions', () => {
  it('omits a symbol every revision declares unconditionally', () => {
    const root = headersRootWith({
      '3.6.2': declares('GciTsCommit'),
      '3.7.5': declares('GciTsCommit'),
    });

    expect(entriesOf(root)).toEqual([]);
  });

  it('floors a symbol at the oldest revision declaring it', () => {
    const root = headersRootWith({
      '3.6.2': declares('GciTsCommit'),
      '3.7.0': declares('GciTsCommit', 'GciTsNbPoll'),
      '3.7.5': declares('GciTsCommit', 'GciTsNbPoll'),
    });

    expect(entriesOf(root)).toEqual([{ name: 'GciTsNbPoll', addedIn: '3.7.0' }]);
  });

  it('marks a symbol declared inside #if FLG_UNIX everywhere as absent on win32', () => {
    const root = headersRootWith({
      '3.6.2': unixOnly('GciTsNbLogin'),
      '3.7.5': unixOnly('GciTsNbLogin'),
    });

    expect(entriesOf(root)).toEqual([{ name: 'GciTsNbLogin', absentOn: 'win32' }]);
  });

  it('sets both fields for a symbol added late and Unix-only from then on', () => {
    const root = headersRootWith({
      '3.6.2': declares('GciTsCommit'),
      '3.7.0': `${declares('GciTsCommit')}\n${unixOnly('GciTsDebugConnectToGem')}`,
      '3.7.5': `${declares('GciTsCommit')}\n${unixOnly('GciTsDebugConnectToGem')}`,
    });

    expect(entriesOf(root)).toEqual([
      { name: 'GciTsDebugConnectToGem', addedIn: '3.7.0', absentOn: 'win32' },
    ]);
  });

  it('reports the revisions it derived from, oldest first', () => {
    const root = headersRootWith({
      '3.10.0': declares('GciTsCommit'),
      '3.7.5': declares('GciTsCommit'),
    });

    expect(deriveOptionalFunctions(root).revisions).toEqual(['3.7.5', '3.10.0']);
  });

  // Effective floor first, name second. Ordering is what the CI diff check
  // compares, so it has to be a property of the headers alone — never of the
  // order the parser happened to see the names in, nor of the machine's locale.
  it('orders by effective floor, then by name', () => {
    const root = headersRootWith({
      '3.6.2': `${declares('GciTsCommit')}\n${unixOnly('GciTsNbLoginFinished', 'GciTsNbLogin')}`,
      '3.7.0': `${declares('GciTsCommit', 'GciTsNbPoll', 'GciTsAbort')}\n${unixOnly('GciTsNbLoginFinished', 'GciTsNbLogin')}`,
      '3.7.5': `${declares('GciTsCommit', 'GciTsNbPoll', 'GciTsAbort', 'GciTsFetchGbjInfo')}\n${unixOnly('GciTsNbLoginFinished', 'GciTsNbLogin')}`,
    });

    expect(entriesOf(root).map((entry) => entry.name)).toEqual([
      'GciTsNbLogin', // floor 3.6.2 (no addedIn): declared from the oldest snapshot on
      'GciTsNbLoginFinished',
      'GciTsAbort', // floor 3.7.0, alphabetically before GciTsNbPoll
      'GciTsNbPoll',
      'GciTsFetchGbjInfo', // floor 3.7.5
    ]);
  });

  describe('refuses to derive a registry the schema cannot express', () => {
    it('when a symbol is gone from the newest revision', () => {
      const root = headersRootWith({
        '3.6.2': declares('GciTsRetired'),
        '3.7.5': declares('GciTsCommit'),
      });

      expect(messageFrom(() => deriveOptionalFunctions(root))).toContain(
        'GciTsRetired is declared in 3.6.2 but not in the newest revision 3.7.5',
      );
    });

    it('when a symbol is declared, dropped, then declared again', () => {
      const root = headersRootWith({
        '3.6.2': declares('GciTsFlaky'),
        '3.7.0': declares('GciTsCommit'),
        '3.7.5': declares('GciTsFlaky'),
      });

      expect(messageFrom(() => deriveOptionalFunctions(root))).toContain(
        'GciTsFlaky is declared in 3.6.2, 3.7.5, which is not a contiguous run',
      );
    });

    it('when a symbol is Unix-only in some declaring revisions but not others', () => {
      const root = headersRootWith({
        '3.6.2': declares('GciTsMoved'),
        '3.7.5': unixOnly('GciTsMoved'),
      });

      expect(messageFrom(() => deriveOptionalFunctions(root))).toContain(
        'GciTsMoved sits inside #if defined(FLG_UNIX) in 3.7.5 but not in 3.6.2',
      );
    });

    it('when the root holds no revisions at all', () => {
      const root = headersRootWith({});

      expect(messageFrom(() => deriveOptionalFunctions(root))).toContain(
        'no vendored revisions found',
      );
    });
  });
});

describe('renderOptionalFunctionsModule', () => {
  const entries: DerivedEntry[] = [
    { name: 'GciTsNbLogin', absentOn: 'win32' },
    { name: 'GciTsNbPoll', addedIn: '3.7.0' },
    { name: 'GciTsNbLogin_', addedIn: '3.7.0', absentOn: 'win32' },
  ];
  const revisions = ['3.6.2', '3.7.0', '3.7.5'];
  const rendered = renderOptionalFunctionsModule(entries, revisions);

  it('warns that the file is generated, and names the script that regenerates it', () => {
    expect(rendered).toContain('GENERATED FILE — DO NOT EDIT BY HAND.');
    expect(rendered).toContain('npm run generate:gci-optional-functions');
  });

  it('captions the tree it was derived from', () => {
    expect(rendered).toContain('Derived from 3 vendored revision(s), 3.6.2 through 3.7.5.');
  });

  it('emits every entry, and nothing but the fields a DerivedEntry carries', () => {
    expect(rendered).toContain("  GciTsNbLogin: { absentOn: 'win32' },");
    expect(rendered).toContain("  GciTsNbPoll: { addedIn: '3.7.0' },");
    expect(rendered).toContain("  GciTsNbLogin_: { addedIn: '3.7.0', absentOn: 'win32' },");

    const fields = [...rendered.matchAll(/^ {2}\w+: \{ (.*) \},$/gm)]
      .flatMap((match) => match[1].split(', '))
      .map((field) => field.split(':')[0]);
    expect([...new Set(fields)].sort()).toEqual(['absentOn', 'addedIn']);
  });

  it('groups entries under their floor', () => {
    expect(rendered).toContain(
      '  // Declared in every vendored revision, inside `#if defined(FLG_UNIX)`.',
    );
    expect(rendered).toContain('  // Added in 3.7.0.');
  });

  // `as const` is what keeps `absentOn` at the literal type `'win32'`. Widened
  // to `string`, the `satisfies Record<string, GciAbsenceReason>` in
  // optionalFunctions.ts stops compiling.
  it('closes the object with `as const`', () => {
    expect(rendered).toContain('} as const;');
  });

  // A value import here doesn't fail a test — it kills `npm run lint` outright.
  // eslint.config.mjs type-strips this module at config load; an unresolvable or
  // non-strippable specifier (headerDeclarations.ts uses __dirname) fails config
  // resolution, so ESLint dies rather than reporting.
  it('emits no imports', () => {
    expect(rendered).not.toMatch(/^\s*import\b/m);
  });

  // The generated file is committed and diff-checked, so re-rendering the same
  // derivation has to produce the same bytes — including line endings, which
  // are LF here whatever the host platform's `os.EOL` says.
  it('is byte-identical when rendered again', () => {
    expect(renderOptionalFunctionsModule(entries, revisions)).toBe(rendered);
    expect(rendered).not.toContain('\r');
    expect(rendered.endsWith('\n')).toBe(true);
  });

  it('refuses a name that is not a bare identifier', () => {
    expect(
      messageFrom(() => renderOptionalFunctionsModule([{ name: 'Gci-Ts' }], revisions)),
    ).toContain('Gci-Ts is not a bare JavaScript identifier');
  });

  it('refuses to caption a render with no revisions', () => {
    expect(messageFrom(() => renderOptionalFunctionsModule(entries, []))).toContain(
      'cannot render a module without the revisions it came from',
    );
  });
});
