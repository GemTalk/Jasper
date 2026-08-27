import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseDeclarations, vendoredRevisions, declaredFunctions } from '../headerDeclarations';

/**
 * A throwaway headers root laid out as `vendoredRevisions` expects. Real
 * directories rather than a faked `readdirSync`: the mock had to be primed
 * per-call, which left a queued value to leak into whichever shuffled test ran
 * next, and it stubbed out the very readdir-and-filter behavior under test.
 */
const temporaryRoots: string[] = [];

function headersRootContaining(entries: { name: string; isDirectory: boolean }[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gci-headers-'));
  temporaryRoots.push(root);
  for (const { name, isDirectory } of entries) {
    const entryPath = path.join(root, name);
    if (isDirectory) fs.mkdirSync(entryPath);
    else fs.writeFileSync(entryPath, '');
  }
  return root;
}

afterAll(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
});

/**
 * The message of the error a call throws. Assertions about several parts of one
 * message read against a single failure this way, rather than re-running the
 * parse once per `toThrow` pattern.
 */
function messageFrom(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the call to throw, but it returned normally');
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

  it('throws for a declaration behind a platform condition it cannot classify', () => {
    // `FLG_MSWIN32` is a real vendor flag this parser has no rule for: silently
    // recording `unixOnly: false` here would claim the declaration is available
    // everywhere, when it may only be available on Windows.
    const source = `
      #if defined(FLG_MSWIN32)
      EXTERN_GCI_DEC(int) GciTsWindowsOnlyThing(GciSession sess) GCI_WEAK;
      #endif
    `;
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/FLG_MSWIN32/);
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
      #if defined(SOME_UNRELATED_FLAG)
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
      #if defined(SOME_UNRELATED_FLAG)
      EXTERN_GCI_DEC(int) GciTsFirstBranch(GciSession sess) GCI_WEAK;
      #elif defined(FLG_UNIX)
      EXTERN_GCI_DEC(int) GciTsUnixElif(GciSession sess) GCI_WEAK;
      #elif defined(SOME_OTHER_UNRELATED_FLAG)
      EXTERN_GCI_DEC(int) GciTsLeavesElif(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsFirstBranch')).toEqual({ unixOnly: false });
    expect(declared.get('GciTsUnixElif')).toEqual({ unixOnly: true });
    expect(declared.get('GciTsLeavesElif')).toEqual({ unixOnly: false });
  });

  it('reads the #elif of #if !defined(FLG_UNIX) as UNIX-only', () => {
    // Reaching the #elif means the #if was false, and the #if being false *is*
    // FLG_UNIX being defined — so the #elif branch is UNIX-only regardless of
    // what its own condition says.
    const source = `
      #if !defined(FLG_UNIX)
      EXTERN_GCI_DEC(int) GciTsNonUnixBranch(GciSession sess) GCI_WEAK;
      #elif defined(FLG_SOLARIS)
      EXTERN_GCI_DEC(int) GciTsSolarisBranch(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsNonUnixBranch')).toEqual({ unixOnly: false });
    expect(declared.get('GciTsSolarisBranch')).toEqual({ unixOnly: true });
  });

  it('carries the FLG_UNIX constraint of an early branch past an #elif to the #else', () => {
    const source = `
      #if !defined(FLG_UNIX)
      EXTERN_GCI_DEC(int) GciTsNonUnix(GciSession sess) GCI_WEAK;
      #elif defined(FLG_SOLARIS)
      EXTERN_GCI_DEC(int) GciTsSolaris(GciSession sess) GCI_WEAK;
      #else
      EXTERN_GCI_DEC(int) GciTsRemainder(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsRemainder')).toEqual({ unixOnly: true });
  });

  it('leaves the #else after an #elif alone when no branch excluded FLG_UNIX', () => {
    const source = `
      #if defined(SOME_UNRELATED_FLAG)
      EXTERN_GCI_DEC(int) GciTsFirst(GciSession sess) GCI_WEAK;
      #elif defined(FLG_UNIX)
      EXTERN_GCI_DEC(int) GciTsUnix(GciSession sess) GCI_WEAK;
      #else
      EXTERN_GCI_DEC(int) GciTsNeither(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsFirst')).toEqual({ unixOnly: false });
    expect(declared.get('GciTsUnix')).toEqual({ unixOnly: true });
    expect(declared.get('GciTsNeither')).toEqual({ unixOnly: false });
  });

  it('keeps an #elif chain nested inside a FLG_UNIX frame UNIX-only throughout', () => {
    const source = `
      #if defined(FLG_UNIX)
      #if defined(FLG_SOLARIS)
      EXTERN_GCI_DEC(int) GciTsUnixSolaris(GciSession sess) GCI_WEAK;
      #elif defined(FLG_LINUX)
      EXTERN_GCI_DEC(int) GciTsUnixLinux(GciSession sess) GCI_WEAK;
      #else
      EXTERN_GCI_DEC(int) GciTsUnixOther(GciSession sess) GCI_WEAK;
      #endif
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsUnixSolaris')).toEqual({ unixOnly: true });
    expect(declared.get('GciTsUnixLinux')).toEqual({ unixOnly: true });
    expect(declared.get('GciTsUnixOther')).toEqual({ unixOnly: true });
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

  it('carries the constraint of an #ifndef FLG_UNIX through to a later #elif', () => {
    const source = `
      #ifndef FLG_UNIX
      EXTERN_GCI_DEC(int) GciTsNoUnix(GciSession sess) GCI_WEAK;
      #elif defined(FLG_SOLARIS)
      EXTERN_GCI_DEC(int) GciTsSolarisOnUnix(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsNoUnix')).toEqual({ unixOnly: false });
    expect(declared.get('GciTsSolarisOnUnix')).toEqual({ unixOnly: true });
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

  it('keeps a UNIX-only declaration UNIX-only when its argument list branches', () => {
    // The snapshot is taken where the declaration starts, so the #else inside
    // its argument list must not walk the classification back to non-UNIX.
    const source = `
      #if defined(FLG_UNIX)
      EXTERN_GCI_DEC(int) GciTsUnixSplitArgs(
      #if defined(FLG_SOLARIS)
        int fd
      #else
        int handle
      #endif
      ) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsUnixSplitArgs')).toEqual({ unixOnly: true });
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

  it('ignores a declaration retired behind #if 0', () => {
    const source = `
      #if 0
      EXTERN_GCI_DEC(int) GciTsRetiredByIfZero(GciSession sess) GCI_WEAK;
      #endif
      EXTERN_GCI_DEC(int) GciTsStillBound(GciSession sess) GCI_WEAK;
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsStillBound']);
  });

  it('keeps the #else of #if 0 and drops the #else of #if 1', () => {
    const source = `
      #if 0
      EXTERN_GCI_DEC(int) GciTsDeadThen(GciSession sess) GCI_WEAK;
      #else
      EXTERN_GCI_DEC(int) GciTsLiveElse(GciSession sess) GCI_WEAK;
      #endif
      #if 1
      EXTERN_GCI_DEC(int) GciTsLiveThen(GciSession sess) GCI_WEAK;
      #else
      EXTERN_GCI_DEC(int) GciTsDeadElse(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsLiveElse', 'GciTsLiveThen']);
  });

  it('reads the #elif of #if 0 as live, because falling past #if 0 is possible', () => {
    const source = `
      #if 0
      EXTERN_GCI_DEC(int) GciTsDeadFirst(GciSession sess) GCI_WEAK;
      #elif defined(SOME_UNRELATED_FLAG)
      EXTERN_GCI_DEC(int) GciTsReachableElif(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsReachableElif']);
  });

  it('reads every branch after #if 1 as unreachable', () => {
    const source = `
      #if 1
      EXTERN_GCI_DEC(int) GciTsTaken(GciSession sess) GCI_WEAK;
      #elif defined(FLG_MSWIN32)
      EXTERN_GCI_DEC(int) GciTsUnreachableElif(GciSession sess) GCI_WEAK;
      #else
      EXTERN_GCI_DEC(int) GciTsUnreachableElse(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsTaken']);
  });

  it('keeps a #if 0 region dead inside a live FLG_UNIX frame', () => {
    const source = `
      #if defined(FLG_UNIX)
      #if 0
      EXTERN_GCI_DEC(int) GciTsDeadInsideUnix(GciSession sess) GCI_WEAK;
      #endif
      EXTERN_GCI_DEC(int) GciTsLiveInsideUnix(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsLiveInsideUnix']);
    expect(declared.get('GciTsLiveInsideUnix')).toEqual({ unixOnly: true });
  });

  it('does not report a half-retired declaration behind #if 0 as truncated', () => {
    const source = `
      #if 0
      EXTERN_GCI_DEC(int) GciTsHalfRetired(GciSession sess,
      #endif
      EXTERN_GCI_DEC(int) GciTsIntact(GciSession sess) GCI_WEAK;
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect([...declared.keys()]).toEqual(['GciTsIntact']);
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
      EXTERN_GCI_DEC(int) GciTsCompoundThen(GciSession sess) GCI_WEAK;
      #else
      EXTERN_GCI_DEC(int) GciTsCompoundOtherwise(GciSession sess) GCI_WEAK;
      #endif
    `;
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/FLG_UNIX/);
  });

  it('names the file and line of a FLG_UNIX condition it cannot classify', () => {
    // Empty unclassifiable regions (like the real, harmless FLG_MSWIN32 block in
    // gcits.hf) do not throw on their own — only a declaration landing inside one
    // does, so this fixture needs one to exercise the error.
    const source =
      `#ifndef GCITS_HF\n#if defined(FLG_UNIX) || defined(FLG_MSWIN32)\n` +
      `EXTERN_GCI_DEC(int) GciTsAmbiguous(GciSession sess) GCI_WEAK;\n#endif\n#endif\n`;
    const message = messageFrom(() => parseDeclarations(source, '3.7.5/gcits.hf'));
    expect(message).toMatch(/in 3\.7\.5\/gcits\.hf at line 2/);
    expect(message).toMatch(/defined\(FLG_UNIX\) \|\| defined\(FLG_MSWIN32\)/);
  });

  it('rejects a compound FLG_UNIX condition arriving on an #elif', () => {
    const source = `
      #if defined(SOME_UNRELATED_FLAG)
      EXTERN_GCI_DEC(int) GciTsCompoundElifFirst(GciSession sess) GCI_WEAK;
      #elif defined(FLG_UNIX) && defined(FLG_DEBUG)
      EXTERN_GCI_DEC(int) GciTsCompoundElifSecond(GciSession sess) GCI_WEAK;
      #endif
    `;
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/FLG_UNIX/);
  });

  it('does not treat FLG_UNIX_SOMETHING as FLG_UNIX', () => {
    // A lookalike must not be silently read as the literal FLG_UNIX token —
    // it should be flagged as its own unrecognized platform flag instead.
    const source = `
      #if defined(FLG_UNIX_SPECIAL)
      EXTERN_GCI_DEC(int) GciTsLookalike(GciSession sess) GCI_WEAK;
      #endif
    `;
    const message = messageFrom(() => parseDeclarations(source, 'fixture'));
    expect(message).toMatch(/FLG_UNIX_SPECIAL/);
  });

  it('reads #if defined FLG_UNIX without parentheses', () => {
    const source = `
      #if defined FLG_UNIX
      EXTERN_GCI_DEC(int) GciTsBareDefined(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsBareDefined')).toEqual({ unixOnly: true });
  });

  it('reads #if !defined FLG_UNIX without parentheses, and its #else as UNIX', () => {
    const source = `
      #if !defined FLG_UNIX
      EXTERN_GCI_DEC(int) GciTsBareNotDefined(GciSession sess) GCI_WEAK;
      #else
      EXTERN_GCI_DEC(int) GciTsBareElse(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsBareNotDefined')).toEqual({ unixOnly: false });
    expect(declared.get('GciTsBareElse')).toEqual({ unixOnly: true });
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

  it('parses a file with CRLF line endings', () => {
    // Works today only because every directive is matched against a trimmed
    // line. The headers are a third-party drop, so one CRLF-normalized vendor
    // release should fail here rather than in a binding-coverage test.
    const source = [
      '#if defined(FLG_UNIX)',
      'EXTERN_GCI_DEC(int) GciTsCrlfUnix(GciSession sess) GCI_WEAK;',
      '#else',
      'EXTERN_GCI_DEC(int) GciTsCrlfOther(',
      '  GciSession sess',
      ') GCI_WEAK;',
      '#endif',
    ].join('\r\n');

    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsCrlfUnix')).toEqual({ unixOnly: true });
    expect(declared.get('GciTsCrlfOther')).toEqual({ unixOnly: false });
  });

  it('reads a FLG_UNIX condition however it is spaced', () => {
    const source = `
      #if defined ( FLG_UNIX )
      EXTERN_GCI_DEC(int) GciTsSpacedCondition(GciSession sess) GCI_WEAK;
      #endif
    `;
    const declared = parseDeclarations(source, 'fixture');
    expect(declared.get('GciTsSpacedCondition')).toEqual({ unixOnly: true });
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
    const message = messageFrom(() => parseDeclarations(source, 'fixture'));
    expect(message).toMatch(/GciTsTwice/);
    expect(message).toMatch(/declared more than once/);
  });

  it('throws when a declaration cannot be parsed (truncated file)', () => {
    const source = `EXTERN_GCI_DEC(int) GciTsTruncated(GciSession sess,`;
    expect(() => parseDeclarations(source, 'fixture')).toThrow(/truncated/);
  });

  it('throws, quoting the text, on a complete statement it cannot parse', () => {
    const source = `EXTERN_GCI_DEC_EXTRA(int) GciTsUnexpectedMacro(GciSession sess) GCI_WEAK;`;
    const message = messageFrom(() => parseDeclarations(source, 'fixture'));
    expect(message).toMatch(/could not parse/);
    expect(message).toMatch(/GciTsUnexpectedMacro/);
  });

  it('points at the return type when a parenthesised one defeats the declaration pattern', () => {
    const source = `EXTERN_GCI_DEC(void (*)(int)) GciTsCallback(int code) GCI_WEAK;`;
    const message = messageFrom(() => parseDeclarations(source, 'fixture'));
    expect(message).toMatch(/could not parse/);
    expect(message).toMatch(/return type/);
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

describe('vendoredRevisions', () => {
  // An inventory tripwire against the real tree, not a sort test: these ten
  // names happen to sort the same lexicographically, so ordering is covered
  // separately below.
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
    // A vendored 3.10.x would sort before 3.7.x as a string. A fixture tree
    // rather than a vendored one, because adding ten thousand lines of headers
    // just to test ordering is too costly.
    const names = ['3.7.5', '3.10.0', '3.9.1', '3.7.4.1'];
    const root = headersRootContaining(names.map((name) => ({ name, isDirectory: true })));

    expect(vendoredRevisions(root)).toEqual(['3.7.4.1', '3.7.5', '3.9.1', '3.10.0']);
  });

  it('ignores plain files sitting next to the revision directories', () => {
    const root = headersRootContaining([
      { name: '3.7.5', isDirectory: true },
      { name: 'README.md', isDirectory: false },
    ]);

    expect(vendoredRevisions(root)).toEqual(['3.7.5']);
  });
});

describe('parseDeclarations (real vendor/gci-headers snapshot)', () => {
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

describe('declaredFunctions', () => {
  it('names the missing revision, and the revisions that are vendored, when there is no header', () => {
    const message = messageFrom(() => declaredFunctions('9.9.9'));
    expect(message).toMatch(/9\.9\.9/);
    expect(message).toContain('3.7.5');
  });
});
