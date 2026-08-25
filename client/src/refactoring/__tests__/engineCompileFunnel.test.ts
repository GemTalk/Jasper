import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Guards the invariant the engines' compile-failure reporting rests on: every method the
// refactoring engines compile goes through ONE helper, so no site can forget to look at what
// `compileMethod:dictionaries:category:` answers.
//
// That selector reports a compile failure in its RETURN VALUE and does not signal, so an
// unchecked send reads as success while the method is never installed — silently dropping a
// method from a new class version, or (push-up) deleting it from its source class after the
// compile onto the superclass failed. Routing every engine through
// `GsRefactoringEnvironment>>compileFailureFor:into:category:` fixed that, but nothing in the
// language stops a NEW engine from sending `compileMethod:` directly and reopening the hole —
// and the reopened hole is invisible: the refactoring still reports success.
//
// So the invariant is checked here rather than left to review. This is a source-level test
// (no stone needed): it reads the engine sources and counts sends outside comments.
//
// __dirname is client/src/refactoring/__tests__, so the repo root is four levels up.
const ENGINE_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'gs-src',
  'refactoring',
  'engine',
);

/** The one method allowed to send it, and the file it lives in. */
const FUNNEL_FILE = 'GsRefactoringEnvironment.class.st';
const FUNNEL_METHOD = 'compileFailureFor: source into: aBehavior category: aCategory';

/**
 * Strip Smalltalk comments from source, leaving string literals intact.
 *
 * Needed because the engines *discuss* `compileMethod:` at length in their doc-comments —
 * a plain grep reports a dozen hits that are prose, not sends, which would make this test
 * either permanently red or (if the threshold were padded to accommodate them) blind to a
 * real regression.
 *
 * Smalltalk quoting: `"…"` is a comment and `'…'` a string literal; each doubles its own
 * delimiter to escape it. A comment can contain apostrophes and a string can contain double
 * quotes, so the two must be tracked together in one pass rather than stripped separately.
 */
const stripComments = (source: string): string => {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "'") {
      // A string literal: copy it verbatim, including any doubled '' escapes.
      out += ch;
      i++;
      while (i < source.length) {
        if (source[i] === "'") {
          out += source[i];
          i++;
          if (source[i] === "'") {
            out += source[i];
            i++;
            continue;
          }
          break;
        }
        out += source[i];
        i++;
      }
      continue;
    }
    if (ch === '"') {
      // A comment: drop it, honouring doubled "" escapes.
      i++;
      while (i < source.length) {
        if (source[i] === '"') {
          i++;
          if (source[i] === '"') {
            i++;
            continue;
          }
          break;
        }
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
};

const engineFiles = (): string[] =>
  fs
    .readdirSync(ENGINE_DIR)
    .filter((f) => f.endsWith('.class.st'))
    .sort();

describe('refactoring engine compile funnel', () => {
  it('has engine sources to check', () => {
    // A wrong ENGINE_DIR would make every assertion below vacuously true.
    expect(engineFiles().length).toBeGreaterThan(10);
  });

  it('sends compileMethod: from exactly one place in the whole engine tree', () => {
    const senders: string[] = [];
    for (const file of engineFiles()) {
      const code = stripComments(fs.readFileSync(path.join(ENGINE_DIR, file), 'utf-8'));
      const hits = code.match(/compileMethod:/g)?.length ?? 0;
      for (let n = 0; n < hits; n++) senders.push(file);
    }

    expect(senders).toEqual([FUNNEL_FILE]);
  });

  it('places that one send inside the checked helper', () => {
    const source = fs.readFileSync(path.join(ENGINE_DIR, FUNNEL_FILE), 'utf-8');
    const method = source.split(`GsRefactoringEnvironment >> ${FUNNEL_METHOD} [`)[1];
    expect(method, `${FUNNEL_METHOD} not found in ${FUNNEL_FILE}`).toBeDefined();

    // Up to the method's closing bracket at column 0.
    const body = method.split('\n]')[0];
    expect(stripComments(body)).toContain('compileMethod:');
  });

  it('strips comments without swallowing string literals', () => {
    // Pins the parser this test's verdict depends on: a bug that stripped too much would
    // silently drop real sends and report green.
    expect(stripComments('a "comment" b')).toBe('a  b');
    expect(stripComments("a 'lit' b")).toBe("a 'lit' b");
    expect(stripComments('a "he said ""hi""" b')).toBe('a  b');
    expect(stripComments("a 'it''s' b")).toBe("a 'it''s' b");
    // The cases that make one-pass tracking necessary:
    expect(stripComments('a "don\'t" b')).toBe('a  b');
    expect(stripComments('a \'say "hi"\' b')).toBe('a \'say "hi"\' b');
  });
});
