import { describe, it, expect, vi } from 'vitest';

// The parser is pure, but its module pulls in browserQueries (for the compile-path
// file-in that lives alongside it), which reaches `vscode` through gciLog.
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { parseTopazScript, FileInStep } from '../topazFileIn';

/**
 * Reading a Topaz file into the steps that file it in (issue #539).
 *
 * The parser is the whole risk in a file-in: a directive it drops is code that
 * silently does not arrive, and `category:` / `set compile_env:` are *state* that has
 * to reach the method chunks below them. Everything here is pure text, so the whole
 * of what a file will do is asserted without a stone.
 */

const kinds = (steps: FileInStep[]): string[] => steps.map((s) => s.kind);
const only = <K extends FileInStep['kind']>(
  steps: FileInStep[],
  kind: K,
): Extract<FileInStep, { kind: K }>[] =>
  steps.filter((s): s is Extract<FileInStep, { kind: K }> => s.kind === kind);

describe('parseTopazScript', () => {
  it('ignores the header a file-out writes', () => {
    const steps = parseTopazScript(
      [
        'fileformat utf8',
        '!',
        '! From GemStone/S 64 Bit 3.7.5',
        '! On 09/02/2026, 10:00:00',
        '!',
      ].join('\n'),
    );

    expect(steps).toEqual([]);
  });

  it('reads a run/doit chunk as code to execute', () => {
    const steps = parseTopazScript(
      ['expectvalue /Class', 'doit', "Object subclass: 'Animal'", '  instVarNames: #()', '%'].join(
        '\n',
      ),
    );

    expect(kinds(steps)).toEqual(['execute']);
    expect(only(steps, 'execute')[0].code).toBe("Object subclass: 'Animal'\n  instVarNames: #()");
  });

  it('carries the category above a method down onto it', () => {
    const steps = parseTopazScript(
      ["category: 'accessing'", 'method: Animal', 'name', '\t^name', '%'].join('\n'),
    );

    const method = only(steps, 'method')[0];
    expect(method.className).toBe('Animal');
    expect(method.isMeta).toBe(false);
    expect(method.category).toBe('accessing');
    expect(method.source).toBe('name\n\t^name');
  });

  it('reads classmethod as the class side', () => {
    const steps = parseTopazScript(
      ["category: 'instance creation'", 'classmethod: Animal', 'new', '\t^super new', '%'].join(
        '\n',
      ),
    );

    expect(only(steps, 'method')[0].isMeta).toBe(true);
  });

  it('keeps a category in force until the next one', () => {
    const steps = parseTopazScript(
      [
        "category: 'accessing'",
        'method: Animal',
        'name',
        '%',
        'method: Animal',
        'age',
        '%',
        "category: 'printing'",
        'method: Animal',
        'printOn: aStream',
        '%',
      ].join('\n'),
    );

    expect(only(steps, 'method').map((m) => m.category)).toEqual([
      'accessing',
      'accessing',
      'printing',
    ]);
  });

  it('un-doubles the quotes in a category name', () => {
    const steps = parseTopazScript(
      ["category: 'Bob''s methods'", 'method: Animal', 'name', '%'].join('\n'),
    );

    expect(only(steps, 'method')[0].category).toBe("Bob's methods");
  });

  it('defaults an uncategorised method the way GemStone does', () => {
    const steps = parseTopazScript(['method: Animal', 'name', '%'].join('\n'));

    expect(only(steps, 'method')[0].category).toBe('as yet unclassified');
  });

  it('applies set compile_env to the methods below it', () => {
    const steps = parseTopazScript(
      [
        'set compile_env: 0',
        'method: Animal',
        'inBase',
        '%',
        'set compile_env: 1',
        'method: Animal',
        'inSession',
        '%',
      ].join('\n'),
    );

    expect(only(steps, 'method').map((m) => m.environmentId)).toEqual([0, 1]);
  });

  it('reads removeAllMethods and removeAllClassMethods, keeping the sides apart', () => {
    const steps = parseTopazScript(
      ['removeAllMethods Animal', 'removeAllClassMethods Animal'].join('\n'),
    );

    expect(only(steps, 'removeAllMethods')).toEqual([
      { kind: 'removeAllMethods', className: 'Animal', isMeta: false, line: 0 },
      { kind: 'removeAllMethods', className: 'Animal', isMeta: true, line: 1 },
    ]);
  });

  it('reads an input line as the file it names', () => {
    const steps = parseTopazScript(['input Animal.gs', 'input Dog.gs'].join('\n'));

    expect(only(steps, 'input').map((s) => s.file)).toEqual(['Animal.gs', 'Dog.gs']);
  });

  it('reports a directive it does not recognise instead of dropping it', () => {
    const steps = parseTopazScript(['wibble the frobnicator', 'lo'].join('\n'));

    // `lo` is topaz's abbreviation for `login`; abbreviations are deliberately not
    // expanded, so a shortened command surfaces as something to look at rather than
    // being guessed at and mistaken for another.
    expect(only(steps, 'unsupported').map((s) => s.directive)).toEqual([
      'wibble the frobnicator',
      'lo',
    ]);
  });

  describe('a hand-written .tpz script', () => {
    it('recognises the connection preamble as topaz s own, not as code', () => {
      const steps = parseTopazScript(
        [
          'set gemstone gs64stone',
          'set user DataCurator password swordfish',
          'set gemnetid !tcp@localhost#netldi:1234#task!gemnetobject',
          'login',
          'display oops',
          'omit resultcheck',
          'output push /tmp/run.out',
        ].join('\n'),
      );

      expect(kinds(steps)).toEqual(Array(7).fill('sessionCommand'));
      // None of them is a transaction boundary, so nothing has to be said about
      // committing on their account.
      expect(only(steps, 'sessionCommand').every((s) => !s.transaction)).toBe(true);
    });

    it('marks commit and abort apart from the rest — not running those changes the outcome', () => {
      const steps = parseTopazScript(['commit', 'abort', 'begin', 'logout'].join('\n'));

      expect(
        only(steps, 'sessionCommand').map((s) => `${s.directive}:${String(s.transaction)}`),
      ).toEqual(['commit:true', 'abort:true', 'begin:true', 'logout:false']);
    });

    it('reads exit and quit as the end of the script', () => {
      const steps = parseTopazScript(['doit', "Object subclass: 'Animal'", '%', 'exit'].join('\n'));

      expect(kinds(steps)).toEqual(['execute', 'stop']);
    });

    it('still runs the run chunks between the preamble and the exit', () => {
      const steps = parseTopazScript(
        [
          'set gemstone gs64stone',
          'login',
          'run',
          '| ws |',
          'ws := WriteStream on: String new.',
          '^ws contents',
          '%',
          'commit',
          'logout',
          'exit',
        ].join('\n'),
      );

      expect(kinds(steps)).toEqual([
        'sessionCommand',
        'sessionCommand',
        'execute',
        'sessionCommand',
        'sessionCommand',
        'stop',
      ]);
      // The chunk keeps its `^` — discarding the value is the runner's job, and it
      // has to survive a non-local return to do it.
      expect(only(steps, 'execute')[0].code).toContain('^ws contents');
    });

    it('treats any other `set` as topaz environment, but never set compile_env', () => {
      const steps = parseTopazScript(
        ['set editorname vi', 'set compile_env: 2', 'method: Animal', 'name', '%'].join('\n'),
      );

      expect(kinds(steps)).toEqual(['sessionCommand', 'method']);
      expect(only(steps, 'method')[0].environmentId).toBe(2);
    });
  });

  it('numbers every step by the line it came from, counting from zero', () => {
    const steps = parseTopazScript(
      ['fileformat utf8', 'doit', "Object subclass: 'Animal'", '%', 'removeAllMethods Animal'].join(
        '\n',
      ),
    );

    expect(steps.map((s) => s.line)).toEqual([2, 4]);
  });

  it('flags a method chunk that names no class rather than compiling into nowhere', () => {
    const steps = parseTopazScript(['method:', 'name', '%'].join('\n'));

    expect(kinds(steps)).toEqual(['unsupported']);
  });

  it('reads a whole class file-out in order', () => {
    // The shape GemStone's own `fileOutClass` produces.
    const steps = parseTopazScript(
      [
        'set compile_env: 0',
        '! ------------------- Class definition for Animal',
        'expectvalue /Class',
        'doit',
        "Object subclass: 'Animal'",
        '%',
        'expectvalue /Class',
        'doit',
        "Animal comment: 'An animal.'",
        '%',
        '',
        '! ------------------- Remove existing behavior from Animal',
        'removeAllMethods Animal',
        'removeAllClassMethods Animal',
        '! ------------------- Class methods for Animal',
        'set compile_env: 0',
        "category: 'instance creation'",
        'classmethod: Animal',
        'new',
        '%',
        '! ------------------- Instance methods for Animal',
        'set compile_env: 0',
        "category: 'accessing'",
        'method: Animal',
        'name',
        '%',
      ].join('\n'),
    );

    expect(kinds(steps)).toEqual([
      'execute',
      'execute',
      'removeAllMethods',
      'removeAllMethods',
      'method',
      'method',
    ]);
  });
});
