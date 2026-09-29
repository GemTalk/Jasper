import { describe, it, expect } from 'vitest';
import { hasRealCommentExpr, isRealClassComment } from '../classCommentPresence';
import { getClassesWithCategory } from '../getClassesWithCategory';
import { setClassComment } from '../setClassComment';
import { vi } from 'vitest';
import type { QueryExecutor } from '../types';

/**
 * The one rule for "does this class carry a REAL comment?", asked in two
 * languages. The three callers must agree, or the 📖 button on a class row
 * promises a document that opens empty — or withholds itself over a comment that
 * is really there.
 */
describe('isRealClassComment', () => {
  it.each([
    ['ordinary text', 'A widget.'],
    ['text with surrounding space', '  A widget.  '],
    ['a single non-space character', 'x'],
  ])('counts %s as a comment', (_what, text) => {
    expect(isRealClassComment(text)).toBe(true);
  });

  // insert-final-newline can leave one of these behind after the text is deleted,
  // and a comment of pure whitespace is no more readable than none.
  it.each([
    ['empty', ''],
    ['a lone newline', '\n'],
    ['spaces and tabs', '  \t '],
    ['CRLF', '\r\n'],
  ])('counts %s as no comment', (_what, text) => {
    expect(isRealClassComment(text)).toBe(false);
  });
});

describe('hasRealCommentExpr', () => {
  it('reads the extra-dict key rather than the synthesising accessor', () => {
    const code = hasRealCommentExpr('cls');
    expect(code).toContain('cls _extraDictAt: #comment');
    // `Class>>comment` never answers nil or empty, so it cannot answer this.
    expect(code).not.toContain('cls comment');
  });

  it('treats a missing key as no comment', () => {
    expect(hasRealCommentExpr('v')).toContain('ifNil: [false]');
  });

  // An unanswerable question is not a comment: a class that has gone, or a stone
  // that refuses the read, must not propagate out of a per-class loop.
  it('answers false rather than raising', () => {
    expect(hasRealCommentExpr('v')).toContain('on: Error do: [:e | false]');
  });

  it('is what the Explorer builds its commented-classes set from', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    getClassesWithCategory(execute, 1);
    expect(execute.mock.calls[0][0]).toContain(hasRealCommentExpr('v'));
  });
});

/**
 * The two spellings have to agree, or a comment saved through the editor and the
 * same comment read back off the stone would disagree about whether it exists.
 */
describe('the two spellings agree on the whitespace rule', () => {
  it.each(['', '\n', '  \t '])('treats %j as no comment on both sides', (text) => {
    expect(isRealClassComment(text)).toBe(false);
    // The Smalltalk side's test for the same thing: any non-separator character.
    expect(hasRealCommentExpr('v')).toContain('detect: [:ch | ch isSeparator not]');
    // And the save path acts on it — an empty comment removes the key.
    const execute = vi.fn<QueryExecutor>(() => '');
    setClassComment(execute, 'Foo', text);
    expect(execute.mock.calls[0][0]).toContain('_extraDictRemoveKey: #comment');
  });
});
