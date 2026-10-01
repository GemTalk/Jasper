import { describe, it, expect } from 'vitest';
import { parseTonelDocument } from '../tonelParser';
import { TopazRegion } from '../../topaz/topazParser';

/**
 * Characterization tests for how `findMethodEnd` walks a method body looking for
 * its closing bracket. They pin the behaviour that was in place when the scan was
 * moved off its hand-rolled character loop and onto the lexer, so the move could
 * be shown to change nothing: every test here passed before that change and must
 * keep passing after it.
 *
 * The shape of each case is the shape of the original bug. A quirk goes in the
 * FIRST method's body, and the assertion is that the SECOND method still parses
 * at its real line numbers — because a scanner that misreads the quirk does not
 * fail loudly, it runs the first method's region on to the end of the file and
 * takes every method below it along. Folding, the symbol index, code lenses, the
 * breadcrumb, Ctrl+T and the System Browser's cursor mapping all read these
 * regions, so they go wrong together and silently.
 */
function twoMethods(firstBody: string): TopazRegion[] {
  const text = [
    "Extension { #name : 'Object' }",
    '',
    "{ #category : 'scanning' }",
    'Object >> first [',
    firstBody,
    ']',
    '',
    "{ #category : 'scanning' }",
    'Object >> second [',
    '\t^ 2',
    ']',
    '',
  ].join('\n');
  return parseTonelDocument(text);
}

/** The line numbers `twoMethods` produces when the first body is a single line. */
const SINGLE_LINE_BODY = {
  firstStart: 3,
  firstClosingBracket: 5,
  secondStart: 8,
  secondClosingBracket: 10,
};

function methodsOf(regions: TopazRegion[]) {
  return regions.filter((r) => r.kind === 'smalltalk-method');
}

describe('findMethodEnd: a character literal is data, not a delimiter', () => {
  const cases: Array<{ name: string; body: string }> = [
    { name: "$' opens no string", body: "\t^ self topazQuote: $'" },
    { name: '$" opens no comment', body: '\t^ self out: $"' },
    { name: '$[ opens no block', body: '\t^ self isOpenBracket: $[' },
    { name: '$] closes no block', body: '\t^ self isCloseBracket: $]' },
    { name: '$$ quotes the escape character itself', body: '\t^ self dollar: $$' },
    { name: '$ quotes a space', body: '\t^ self space: $ ' },
    { name: 'several character literals in one line', body: '\t^ x copyReplaceAll: $. with: $_' },
  ];

  for (const c of cases) {
    it(`${c.name}, so the method below still parses`, () => {
      const methods = methodsOf(twoMethods(c.body));
      expect(methods).toHaveLength(2);
      expect(methods[0].closingBracketLine).toBe(SINGLE_LINE_BODY.firstClosingBracket);
      expect(methods[1].startLine).toBe(SINGLE_LINE_BODY.secondStart);
      expect(methods[1].closingBracketLine).toBe(SINGLE_LINE_BODY.secondClosingBracket);
    });
  }
});

describe('findMethodEnd: quoting constructs are consumed whole', () => {
  const cases: Array<{ name: string; body: string }> = [
    { name: 'a string containing a bracket', body: "\t^ 'a ] inside a string'" },
    { name: 'a comment containing a bracket', body: '\t"a ] inside a comment" ^ 1' },
    { name: 'a string with a doubled-quote escape', body: "\t^ 'it''s ] fine'" },
    { name: 'a comment containing an apostrophe', body: '\t"it\'s ] fine" ^ 1' },
    { name: 'a string containing a comment delimiter', body: '\t^ \'say "] hi" now\'' },
    { name: 'a quoted symbol containing a bracket', body: "\t^ #'odd ] symbol'" },
    { name: 'a byte array literal', body: '\t^ #[1 2 3]' },
    { name: 'a literal array containing a bracket character', body: '\t^ #($[ $])' },
  ];

  for (const c of cases) {
    it(`${c.name} does not end the method early`, () => {
      const methods = methodsOf(twoMethods(c.body));
      expect(methods).toHaveLength(2);
      expect(methods[0].closingBracketLine).toBe(SINGLE_LINE_BODY.firstClosingBracket);
      expect(methods[1].startLine).toBe(SINGLE_LINE_BODY.secondStart);
    });
  }
});

describe('findMethodEnd: state carries across lines', () => {
  it('a string spanning lines does not end the method early', () => {
    const methods = methodsOf(twoMethods("\t^ 'line one ]\nline two'"));
    expect(methods).toHaveLength(2);
    // The body is two lines, so everything below shifts down by one.
    expect(methods[0].closingBracketLine).toBe(SINGLE_LINE_BODY.firstClosingBracket + 1);
    expect(methods[1].startLine).toBe(SINGLE_LINE_BODY.secondStart + 1);
  });

  it('a comment spanning lines does not end the method early', () => {
    const methods = methodsOf(twoMethods('\t"line one ]\nline two" ^ 1'));
    expect(methods).toHaveLength(2);
    expect(methods[0].closingBracketLine).toBe(SINGLE_LINE_BODY.firstClosingBracket + 1);
    expect(methods[1].startLine).toBe(SINGLE_LINE_BODY.secondStart + 1);
  });
});

describe('findMethodEnd: real brackets still count', () => {
  it('a nested block does not end the method at its inner bracket', () => {
    const methods = methodsOf(twoMethods('\t^ coll detect: [:e | e > 2] ifNone: [nil]'));
    expect(methods).toHaveLength(2);
    expect(methods[0].closingBracketLine).toBe(SINGLE_LINE_BODY.firstClosingBracket);
  });

  it('a block spanning lines ends the method at the outer bracket', () => {
    const methods = methodsOf(twoMethods('\tcoll do: [:e |\n\t\te printNl].\n\t^ self'));
    expect(methods).toHaveLength(2);
    expect(methods[0].closingBracketLine).toBe(SINGLE_LINE_BODY.firstClosingBracket + 2);
    expect(methods[1].startLine).toBe(SINGLE_LINE_BODY.secondStart + 2);
  });

  it('falls back to the last line when the bracket is never closed', () => {
    // A half-typed method is an ordinary thing for the parser to be handed, so
    // it must yield a region rather than throwing or returning nothing.
    const text = [
      "Extension { #name : 'Object' }",
      '',
      "{ #category : 'scanning' }",
      'Object >> unclosed [',
      '\t^ 1',
    ].join('\n');
    const methods = methodsOf(parseTonelDocument(text));
    expect(methods).toHaveLength(1);
    expect(methods[0].closingBracketLine).toBe(text.split('\n').length - 1);
  });

  it('keeps the body text of the method it closed', () => {
    const methods = methodsOf(twoMethods("\t^ self topazQuote: $'"));
    expect(methods[0].text).toContain("$'");
    expect(methods[0].text).not.toContain('second');
  });
});
