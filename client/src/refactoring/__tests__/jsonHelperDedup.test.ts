// Structural guard for RB catalog C1 (dedup of the engine's JSON helpers).
//
// Every Gs*Refactoring serializer used to carry a byte-identical copy of
// jsonQuote:/jsonEscape:/hex2:. C1 moved the one real implementation into
// GsRefactoringJson and turned the copies into one-line delegators. This test
// scans the engine source (no stone needed) and fails if a second real copy
// ever reappears -- i.e. it keeps the dedup deduped. It complements the engine
// SUnit (GsRefactoringJsonTest), which pins the escaper's *behavior*; this pins
// its *singularity*.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// __dirname = client/src/refactoring/__tests__ -> repo root is four levels up.
const engineDir = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'gs-src',
  'refactoring',
  'engine',
);
const HELPERS = ['jsonEscape:', 'jsonQuote:', 'hex2:'] as const;
const CANONICAL_TOKEN = 'GsRefactoringJson class';
const CANONICAL_FILE = 'GsRefactoringJson.class.st';

interface Def {
  file: string;
  classToken: string; // e.g. 'GsRenameMethodRefactoring' or 'GsRefactoringJson class'
  selector: string;
  isDelegator: boolean;
}

// A single-keyword method header in tonel: `<ClassToken> >> <selector> <arg> [`.
// Requiring the arg to be immediately followed by `[` excludes multi-keyword
// selectors like `jsonEscape:on:` (the stream form) and `jsonEscapeString:`.
const headerRe = /^(.+?) >> (jsonEscape:|jsonQuote:|hex2:) (\w+) \[\s*$/;

function collectDefs(): Def[] {
  const defs: Def[] = [];
  for (const f of fs.readdirSync(engineDir).filter((n) => n.endsWith('.class.st'))) {
    // Tolerate CRLF here rather than relying on .gitattributes' eol=lf: that
    // normalizes fresh checkouts, but not an already-checked-out working
    // copy, a hand-edited file, or a later narrowing of the pattern. A plain
    // split('\n')/'!== ]' would then undercount definitions instead of
    // failing loudly.
    const lines = fs.readFileSync(path.join(engineDir, f), 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = headerRe.exec(lines[i]);
      if (!m) continue;
      const bodyLines: string[] = [];
      let j = i + 1;
      for (; j < lines.length && lines[j].trim() !== ']'; j++) bodyLines.push(lines[j]);
      const body = bodyLines.join('\n').trim();
      defs.push({
        file: f,
        classToken: m[1],
        selector: m[2],
        isDelegator: /^\^\s*GsRefactoringJson\b/.test(body),
      });
      i = j;
    }
  }
  return defs;
}

const defs = collectDefs();

describe('C1 JSON-helper dedup: exactly one real copy, all others delegate', () => {
  it('finds at least one definition of each helper', () => {
    for (const sel of HELPERS) {
      expect(defs.filter((d) => d.selector === sel).length).toBeGreaterThan(0);
    }
  });

  it.each(HELPERS)(
    'has exactly one canonical (non-delegator) definition of %s, in GsRefactoringJson',
    (sel) => {
      const canon = defs.filter((d) => d.selector === sel && !d.isDelegator);
      expect(canon.map((d) => d.classToken)).toEqual([CANONICAL_TOKEN]);
      expect(canon[0].file).toBe(CANONICAL_FILE);
    },
  );

  it.each(HELPERS)('every non-canonical definition of %s is a one-line delegator', (sel) => {
    const others = defs.filter((d) => d.selector === sel && d.classToken !== CANONICAL_TOKEN);
    expect(others.length).toBeGreaterThan(0);
    for (const d of others) {
      expect(d.isDelegator, `${d.classToken} >> ${sel} in ${d.file} is not a delegator`).toBe(true);
    }
  });

  it('the dedup actually collapsed many copies (jsonEscape: delegated by >= 13 classes)', () => {
    const delegators = defs.filter((d) => d.selector === 'jsonEscape:' && d.isDelegator);
    expect(delegators.length).toBeGreaterThanOrEqual(13);
  });

  it('the differently-behaving 4th escaper jsonEscapeString: is left alone, not scanned as a helper', () => {
    const hasFourth = fs
      .readdirSync(engineDir)
      .some(
        (f) =>
          f.endsWith('.class.st') &&
          /jsonEscapeString:/.test(fs.readFileSync(path.join(engineDir, f), 'utf8')),
      );
    expect(hasFourth).toBe(true);
    expect(defs.some((d) => d.selector.startsWith('jsonEscapeString'))).toBe(false);
  });
});
