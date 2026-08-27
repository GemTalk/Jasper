import { describe, it, expect, vi, type Mock } from 'vitest';

// Only `readdirSync` is faked, and only where a test asks for it: the real
// `vendor/gci-headers/` tree still backs every other assertion in this file.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, readdirSync: vi.fn(actual.readdirSync) };
});

import * as fs from 'fs';
import { parseDeclarations, vendoredRevisions, declaredFunctions } from '../headerDeclarations';

/** One `readdirSync` result, for the next call only. */
function nextDirectoryListing(entries: { name: string; isDirectory: boolean }[]): void {
  // Cast past the overloads of `readdirSync`: the mock only ever stands in for
  // the `withFileTypes: true` one, which is the only call the module makes.
  (fs.readdirSync as unknown as Mock).mockReturnValueOnce(
    entries.map(({ name, isDirectory }) => ({ name, isDirectory: () => isDirectory })),
  );
}

/**
 * Parsing behavior against small inline fixtures — not restating the real
 * snapshot. The real-snapshot assertions at the bottom exist so a genuine
 * regression against `vendor/gci-headers/` still fails a test in this file.
 */
describe('parseDeclarations (inline fixtures)', () => {
  it('parses a single-line declaration', () => {
    const source = `EXTERN_GCI_DEC(int) GciTsSocket(GciSession sess, GciErrSType *err) GCI_WEAK;`;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsSocket']);
    expect(declared.get('GciTsSocket')).toEqual({ unixOnly: false });
  });

  it('parses a multi-line declaration whose name is not on the EXTERN_GCI_DEC line', () => {
    const source = `
      EXTERN_GCI_DEC(GciSession)
      GciTsLogin(
        const char *StoneNameNrs,
        const char *HostUserId
      ) GCI_WEAK;
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsLogin']);
  });

  it('marks a declaration inside #if defined(FLG_UNIX) as unixOnly', () => {
    const source = `
      #if defined(FLG_UNIX)
      EXTERN_GCI_DEC(int) GciTsNbLoginFinished(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsNbLoginFinished')).toEqual({ unixOnly: true });
  });

  it('does not mark a declaration inside an unrelated #if as unixOnly', () => {
    const source = `
      #if defined(FLG_MSWIN32)
      EXTERN_GCI_DEC(int) GciTsWindowsOnlyThing(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsWindowsOnlyThing')).toEqual({ unixOnly: false });
  });

  it('tracks FLG_UNIX two #if frames deep', () => {
    const source = `
      #if defined(FLG_SOMETHING_ELSE)
      #if defined(FLG_UNIX)
      EXTERN_GCI_DEC(int) GciTsNested(GciSession sess) GCI_WEAK;
      #endif
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsNested')).toEqual({ unixOnly: true });
  });

  it('ignores parentheses in the return type and in a trailing block comment', () => {
    const source = `
      /* a comment with (parens) inside */
      EXTERN_GCI_DEC(char*) GciTsEncrypt(const char* password) GCI_WEAK; /* trailing (comment) */
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsEncrypt']);
  });

  it('tracks #ifdef FLG_UNIX, not just #if defined(FLG_UNIX)', () => {
    const source = `
      #ifdef FLG_UNIX
      EXTERN_GCI_DEC(int) GciTsIfdefGuarded(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsIfdefGuarded')).toEqual({ unixOnly: true });
  });

  it('keeps the FLG_UNIX frame across a nested #ifdef/#endif pair', () => {
    const source = `
      #if defined(FLG_UNIX)
      #ifdef FLG_DEBUG
      EXTERN_GCI_DEC(int) GciTsNestedInDebug(GciSession sess) GCI_WEAK;
      #endif
      EXTERN_GCI_DEC(int) GciTsAfterNestedEndif(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsNestedInDebug')).toEqual({ unixOnly: true });
    expect(declared.get('GciTsAfterNestedEndif')).toEqual({ unixOnly: true });
  });

  it('ignores a declaration commented out with //', () => {
    const source = `
      // EXTERN_GCI_DEC(int) GciTsRetired(GciSession sess) GCI_WEAK;
      EXTERN_GCI_DEC(int) GciTsLive(GciSession sess) GCI_WEAK;
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsLive']);
  });

  it('ignores a // comment trailing a declaration', () => {
    const source = `
      EXTERN_GCI_DEC(int) GciTsTrailing(GciSession sess) GCI_WEAK; // see (note) below
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsTrailing']);
  });

  it('does not treat the #else of an unrelated #if as UNIX-only', () => {
    const source = `
      #if defined(FLG_SOMETHING_ELSE)
      EXTERN_GCI_DEC(int) GciTsThen(GciSession sess) GCI_WEAK;
      #else
      EXTERN_GCI_DEC(int) GciTsOtherwise(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsThen')).toEqual({ unixOnly: false });
    expect(declared.get('GciTsOtherwise')).toEqual({ unixOnly: false });
  });

  it('leaves the #else of #if defined(FLG_UNIX) outside the UNIX region', () => {
    const source = `
      #if defined(FLG_UNIX)
      EXTERN_GCI_DEC(int) GciTsUnixBranch(GciSession sess) GCI_WEAK;
      #else
      EXTERN_GCI_DEC(int) GciTsWindowsBranch(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsUnixBranch')).toEqual({ unixOnly: true });
    expect(declared.get('GciTsWindowsBranch')).toEqual({ unixOnly: false });
  });

  it('tracks FLG_UNIX arriving on an #elif, and leaving on the next one', () => {
    const source = `
      #if defined(FLG_SOMETHING_ELSE)
      EXTERN_GCI_DEC(int) GciTsFirstBranch(GciSession sess) GCI_WEAK;
      #elif defined(FLG_UNIX)
      EXTERN_GCI_DEC(int) GciTsUnixElif(GciSession sess) GCI_WEAK;
      #elif defined(FLG_MSWIN32)
      EXTERN_GCI_DEC(int) GciTsWindowsElif(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsFirstBranch')).toEqual({ unixOnly: false });
    expect(declared.get('GciTsUnixElif')).toEqual({ unixOnly: true });
    expect(declared.get('GciTsWindowsElif')).toEqual({ unixOnly: false });
  });

  it('reads #if !defined(FLG_UNIX) as the non-UNIX branch, and its #else as UNIX', () => {
    const source = `
      #if !defined(FLG_UNIX)
      EXTERN_GCI_DEC(int) GciTsNotUnix(GciSession sess) GCI_WEAK;
      #else
      EXTERN_GCI_DEC(int) GciTsElseIsUnix(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsNotUnix')).toEqual({ unixOnly: false });
    expect(declared.get('GciTsElseIsUnix')).toEqual({ unixOnly: true });
  });

  it('reads the #else of #ifndef FLG_UNIX as UNIX-only', () => {
    const source = `
      #ifndef FLG_UNIX
      EXTERN_GCI_DEC(int) GciTsGuardedOut(GciSession sess) GCI_WEAK;
      #else
      EXTERN_GCI_DEC(int) GciTsGuardedIn(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsGuardedOut')).toEqual({ unixOnly: false });
    expect(declared.get('GciTsGuardedIn')).toEqual({ unixOnly: true });
  });

  it('keeps a declaration whose argument list branches on the platform', () => {
    const source = `
      EXTERN_GCI_DEC(int) GciTsSplitArgs(
      #if defined(FLG_UNIX)
        int fd
      #else
        void *handle
      #endif
      ) GCI_WEAK;
      EXTERN_GCI_DEC(int) GciTsAfterSplit(GciSession sess) GCI_WEAK;
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsSplitArgs', 'GciTsAfterSplit']);
    // The declaration is not itself UNIX-only just because one argument is.
    expect(declared.get('GciTsSplitArgs')).toEqual({ unixOnly: false });
  });

  it('leaves the frame stack balanced across a declaration that opens and closes one', () => {
    const source = `
      #if defined(FLG_UNIX)
      EXTERN_GCI_DEC(int) GciTsGuarded(
      #ifdef FLG_DEBUG
        int fd
      #endif
      ) GCI_WEAK;
      #endif
      EXTERN_GCI_DEC(int) GciTsOutside(GciSession sess) GCI_WEAK;
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsGuarded')).toEqual({ unixOnly: true });
    expect(declared.get('GciTsOutside')).toEqual({ unixOnly: false });
  });

  it('keeps a // inside a block comment commentary rather than closing it early', () => {
    const source = `
      /* retired:
         // EXTERN_GCI_DEC(int) GciTsRetired(GciSession sess) GCI_WEAK;
      */
      EXTERN_GCI_DEC(int) GciTsLiveAfterBlock(GciSession sess) GCI_WEAK;
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsLiveAfterBlock']);
  });

  it('does not let a /* inside a // comment open a block comment', () => {
    const source = `
      // opens nothing: /*
      EXTERN_GCI_DEC(int) GciTsNotSwallowed(GciSession sess) GCI_WEAK;
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsNotSwallowed']);
  });

  it('ignores a declaration commented out across several lines with /* */', () => {
    const source = `
      /*
      EXTERN_GCI_DEC(GciSession) GciTsRetiredLogin(
        const char *StoneNameNrs
      ) GCI_WEAK;
      */
      EXTERN_GCI_DEC(int) GciTsStillHere(GciSession sess) GCI_WEAK;
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsStillHere']);
  });

  it('does not claim a declaration is UNIX-only when FLG_UNIX is only one arm of the condition', () => {
    const source = `
      #if defined(FLG_UNIX) || defined(FLG_MSWIN32)
      EXTERN_GCI_DEC(int) GciTsEitherPlatform(GciSession sess) GCI_WEAK;
      #endif
    `;
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/FLG_UNIX/);
  });

  it('rejects a compound condition rather than reading its #else as UNIX-only', () => {
    const source = `
      #if defined(FLG_SOLARIS) && !defined(FLG_UNIX)
      EXTERN_GCI_DEC(int) GciTsThen(GciSession sess) GCI_WEAK;
      #else
      EXTERN_GCI_DEC(int) GciTsOtherwise(GciSession sess) GCI_WEAK;
      #endif
    `;
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/FLG_UNIX/);
  });

  it('rejects a compound FLG_UNIX condition arriving on an #elif', () => {
    const source = `
      #if defined(FLG_SOMETHING_ELSE)
      EXTERN_GCI_DEC(int) GciTsFirst(GciSession sess) GCI_WEAK;
      #elif defined(FLG_UNIX) && defined(FLG_DEBUG)
      EXTERN_GCI_DEC(int) GciTsSecond(GciSession sess) GCI_WEAK;
      #endif
    `;
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/FLG_UNIX/);
  });

  it('does not treat FLG_UNIX_SOMETHING as FLG_UNIX', () => {
    const source = `
      #if defined(FLG_UNIX_SPECIAL)
      EXTERN_GCI_DEC(int) GciTsLookalike(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsLookalike')).toEqual({ unixOnly: false });
  });

  it('does not lose a declaration to a comment marker inside a string literal', () => {
    const source = `
      #define GCI_PATTERN "/*"
      EXTERN_GCI_DEC(int) GciTsAfterString(GciSession sess) GCI_WEAK;
      /* an ordinary comment */
      EXTERN_GCI_DEC(int) GciTsLater(GciSession sess) GCI_WEAK;
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsAfterString', 'GciTsLater']);
  });

  it('does not lose a declaration to a // inside a string literal', () => {
    const source = `
      #define GCI_DEFAULT_NRS "!tcp@localhost#server!//gemnetobject"
      EXTERN_GCI_DEC(int) GciTsAfterUrl(GciSession sess) GCI_WEAK;
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsAfterUrl']);
  });

  it('throws on an #if that is never closed', () => {
    const source = `
      #if defined(FLG_UNIX)
      EXTERN_GCI_DEC(int) GciTsUnclosed(GciSession sess) GCI_WEAK;
    `;
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/unclosed #if/);
  });

  it('throws on an #endif with no matching #if', () => {
    const source = `
      EXTERN_GCI_DEC(int) GciTsStray(GciSession sess) GCI_WEAK;
      #endif
    `;
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/#endif with no matching/);
  });

  it('throws on an #else with no matching #if', () => {
    const source = `
      #else
      EXTERN_GCI_DEC(int) GciTsStrayElse(GciSession sess) GCI_WEAK;
    `;
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/#else with no matching/);
  });

  it('throws on an #elif with no matching #if', () => {
    const source = `
      #elif defined(FLG_UNIX)
      EXTERN_GCI_DEC(int) GciTsStrayElif(GciSession sess) GCI_WEAK;
    `;
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/#elif with no matching/);
  });

  it('throws naming the symbol when the same function is declared twice', () => {
    const source = `
      #if defined(FLG_UNIX)
      EXTERN_GCI_DEC(int) GciTsTwice(GciSession sess) GCI_WEAK;
      #else
      EXTERN_GCI_DEC(int) GciTsTwice(GciSession sess, int mode) GCI_WEAK;
      #endif
    `;
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/GciTsTwice/);
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/declared more than once/);
  });

  it('throws when a declaration cannot be parsed (truncated file)', () => {
    const source = `EXTERN_GCI_DEC(int) GciTsTruncated(GciSession sess,`;
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/truncated/);
  });

  it('throws, quoting the text, on a complete statement it cannot parse', () => {
    const source = `EXTERN_GCI_DEC_EXTRA(int) GciTsUnexpectedMacro(GciSession sess) GCI_WEAK;`;
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/could not parse/);
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/GciTsUnexpectedMacro/);
  });

  it('throws rather than silently keeping one of two declarations sharing a line', () => {
    const source =
      `EXTERN_GCI_DEC(int) GciTsFirst(GciSession sess) GCI_WEAK; ` +
      `EXTERN_GCI_DEC(int) GciTsSecond(GciSession sess) GCI_WEAK;`;
    expect(() => parseDeclarations(source, 'fixture')).toThrow(
      /parsed 1 declarations but saw 2 EXTERN_GCI_DEC occurrences/,
    );
  });

  it('names the file and line of an unbalanced directive', () => {
    const source = `\n\n#endif\n`;
    expect(() => parseDeclarations(source, '3.7.5/gcits.hf')).toThrow(
      /in 3\.7\.5\/gcits\.hf at line 3/,
    );
  });
});

describe('parseDeclarations (real vendor/gci-headers snapshot)', () => {
  // An inventory tripwire, not a sort test: these ten names happen to sort the
  // same lexicographically, so ordering is covered separately below.
  it('finds exactly the 10 vendored revisions', () => {
    expect(vendoredRevisions()).toEqual([
      '3.6.2',
      '3.6.3',
      '3.6.4',
      '3.6.6',
      '3.6.8',
      '3.7.0',
      '3.7.1',
      '3.7.2',
      '3.7.4.1',
      '3.7.5',
    ]);
  });

  it('orders revisions numerically, not lexicographically', () => {
    // A vendored 3.10.x would sort before 3.7.x as a string. Faked rather than
    // vendored, because adding a header tree just to test ordering is too costly.
    const names = ['3.7.5', '3.10.0', '3.9.1', '3.7.4.1'];
    nextDirectoryListing(names.map((name) => ({ name, isDirectory: true })));

    expect(vendoredRevisions()).toEqual(['3.7.4.1', '3.7.5', '3.9.1', '3.10.0']);
  });

  it('ignores plain files sitting next to the revision directories', () => {
    nextDirectoryListing([
      { name: '3.7.5', isDirectory: true },
      { name: 'README.md', isDirectory: false },
    ]);

    expect(vendoredRevisions()).toEqual(['3.7.5']);
  });

  // Every revision, not just the endpoints: the parser's preprocessor handling
  // applies to all ten files, so a change that shifts one of the middle ones
  // should fail here rather than hide between 3.6.2 and 3.7.5.
  it.each([
    ['3.6.2', 90, 2],
    ['3.6.3', 90, 2],
    ['3.6.4', 90, 2],
    ['3.6.6', 90, 2],
    ['3.6.8', 90, 2],
    ['3.7.0', 93, 4],
    ['3.7.1', 98, 4],
    ['3.7.2', 104, 4],
    ['3.7.4.1', 106, 5],
    ['3.7.5', 106, 5],
  ])('parses %s into %i declarations, %i of them UNIX-only', (revision, total, unixOnly) => {
    const declared = declaredFunctions(revision);
    expect(declared.size).toBe(total);
    expect([...declared.values()].filter((decl) => decl.unixOnly)).toHaveLength(unixOnly);
  });

  it('never drops a symbol from one revision to the next', () => {
    const revisions = vendoredRevisions();
    for (let i = 1; i < revisions.length; i++) {
      const previous = [...declaredFunctions(revisions[i - 1]).keys()];
      const current = declaredFunctions(revisions[i]);
      const dropped = previous.filter((name) => !current.has(name));
      expect(dropped, `${revisions[i]} dropped symbols present in ${revisions[i - 1]}`).toEqual([]);
    }
  });

  // Named, not just counted, at both ends of the range: a misattribution that
  // moves a symbol in and another out keeps the count in the table above intact.
  it.each([
    ['3.6.2', ['GciTsNbLogin', 'GciTsNbLoginFinished']],
    [
      '3.7.5',
      [
        'GciTsDebugConnectToGem',
        'GciTsDebugStartDebugService',
        'GciTsNbLogin',
        'GciTsNbLoginFinished',
        'GciTsNbLogin_',
      ],
    ],
  ])('finds exactly the FLG_UNIX-only symbols of %s', (revision, expected) => {
    const unixOnly = [...declaredFunctions(revision).entries()]
      .filter(([, decl]) => decl.unixOnly)
      .map(([name]) => name)
      .sort();

    expect(unixOnly).toEqual(expected);
  });
});
