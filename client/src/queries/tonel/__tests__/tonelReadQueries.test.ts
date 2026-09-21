// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement.
//
// Unit tests for the query that parses Tonel text into a class description.
// These pin the emitted Smalltalk, not its whitespace.
//
// The escaping cases are the ones that matter: the argument to this query is a
// whole Tonel FILE, embedded in a doit as a string literal. It is the largest and
// least constrained thing this feature ever sends to the stone.
import { describe, it, expect, vi } from 'vitest';

import { readTonelClass, TONEL_NO_ROWAN, TONEL_ERROR_PREFIX } from '../readTonelClass';

const TONEL = `Class {\n\t#name : 'Widget'\n}\n`;

const exec = (result = 'NAME\t6\nWidget\n') => vi.fn().mockReturnValue(result);
const codeOf = (fn: ReturnType<typeof exec>): string => fn.mock.calls[0][0] as string;
const codeFor = (tonel = TONEL): string => {
  const e = exec();
  readTonelClass(e, tonel);
  return codeOf(e);
};

describe('readTonelClass', () => {
  it('assembles the throwaway project, package and reader visitor', () => {
    const code = codeFor();
    expect(code).toContain('RwResolvedProjectV2');
    expect(code).toContain('addLoadComponentNamed:');
    expect(code).toContain('addPackageNamed:');
    expect(code).toContain('RwRepositoryResolvedProjectTonelReaderVisitorV2');
    expect(code).toContain('currentProjectDefinition:');
    expect(code).toContain('_packageConvention:');
  });

  it('parses from a stream, never from a file', () => {
    // Rowan's public entry (`readClassFile:`) takes a PATH and does
    // `file asFileReference readStreamDo:`. The Tonel text is on the user's
    // machine, not the gem's host, so the file path route would need the gem to
    // write a temp file somewhere it can write. Driving RwTonelParser directly on
    // a ReadStream needs no filesystem at all, and was verified on a live stone.
    const code = codeFor();
    expect(code).toContain('RwTonelParser');
    expect(code).toContain('ReadStream on:');
    expect(code).not.toContain('asFileReference');
    expect(code).not.toContain('GsFile');
  });

  it('resolves the Rowan classes through the reach-through', () => {
    const code = codeFor();
    expect(code).toContain('rwLookup :=');
    expect(code).toContain("rwLookup value: #'RwTonelParser'");
  });

  it('doubles single quotes in the Tonel text', () => {
    // A Tonel file is FULL of single quotes — every header value is quoted, and
    // method source is full of string literals. Getting this wrong does not fail
    // safe: it produces a doit that still compiles and means something else.
    const code = codeFor(`Class {\n\t#name : 'Widget'\n}\n`);
    expect(code).toContain("#name : ''Widget''");
  });

  it('survives text containing brackets, tabs and newlines', () => {
    const gnarly = `Class {\n\t#name : 'X'\n}\n\n{ #category : 'a' }\nX >> m [\n\t^'it''s [bracketed]'\n]\n`;
    const code = codeFor(gnarly);
    expect(code).toContain("^''it''''s [bracketed]''");
  });

  it('answers the no-rowan sentinel rather than raising', () => {
    expect(codeFor()).toContain(TONEL_NO_ROWAN);
    expect(readTonelClass(exec(TONEL_NO_ROWAN), TONEL)).toEqual({
      ok: false,
      error: 'Rowan is not reachable from this session',
      line: 1,
    });
  });

  it('reports the line the parse failed on, not line 1', () => {
    // A parse failure with no line is nearly useless on a 500-line class file: the
    // developer is told the file is broken and left to find where. Rowan's own
    // reader enriches the error the same way, from the stream position.
    const text = `Class {\n\t#name : 'X'\n}\n\n{ #category : 'a' }\nX >> m [\n\t^1\n]\n`;
    const positionOfLine6 = text.indexOf('X >> m');
    const result = readTonelClass(
      exec(`${TONEL_ERROR_PREFIX}${positionOfLine6}\tInvalid class name`),
      text,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.line).toBe(6);
    expect(result.error).toBe('Invalid class name');
  });

  it('falls back to line 1 when the stone reports no position', () => {
    const result = readTonelClass(exec(`${TONEL_ERROR_PREFIX}\tsomething broke`), TONEL);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.line).toBe(1);
    expect(result.error).toBe('something broke');
  });

  it('asks the parser where it stopped', () => {
    // The position has to come from the stone: only it knows how far the parser got.
    expect(codeFor()).toContain('position');
  });

  it('answers an error sentinel rather than raising', () => {
    expect(codeFor()).toContain('on: Error do:');
    expect(readTonelClass(exec(`${TONEL_ERROR_PREFIX}\tbad header`), TONEL)).toEqual({
      ok: false,
      error: 'bad header',
      line: 1,
    });
  });

  it('decodes a successful answer into a class description', () => {
    const wire =
      'NAME\t6\nWidget\n' +
      'SUPER\t6\nObject\n' +
      'TYPE\t6\nnormal\n' +
      'CATEGORY\t7\nWidgets\n' +
      'COMMENT\t0\n\n' +
      'IVARS\t4\nsize\n' +
      'CVARS\t0\n\n' +
      'CIVARS\t0\n\n' +
      'POOLS\t0\n\n' +
      'IMETHOD\t21\nsize\naccessing\n\t^size\n';
    const result = readTonelClass(exec(wire), TONEL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tonelClass.name).toBe('Widget');
    expect(result.tonelClass.instVars).toEqual(['size']);
    expect(result.tonelClass.methods).toEqual([
      { isMeta: false, selector: 'size', category: 'accessing', source: '\t^size' },
    ]);
  });

  it('reports a decode failure as an error rather than throwing', () => {
    // The caller is a menu command. A malformed answer must become a reported
    // failure, not an unhandled exception.
    const result = readTonelClass(exec('NAME\t999\nWidget\n'), TONEL);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/truncat/i);
    expect(result.line).toBe(1);
  });
});
