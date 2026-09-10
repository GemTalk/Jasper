import { describe, it, expect } from 'vitest';
import { DocumentManager } from '../../utils/documentManager';
import { formatDocument, isFormattableDocument } from '../formatting';
import { FormatterSettings, DEFAULT_SETTINGS } from '../formatterSettings';
import { detectFormat } from '../../utils/workspaceIndex';

function format(source: string, overrides: Partial<FormatterSettings> = {}): string {
  const dm = new DocumentManager();
  const doc = dm.update('test://test', 1, source);
  const settings = { ...DEFAULT_SETTINGS, ...overrides };
  const edits = formatDocument(doc, settings);
  if (edits.length === 0) return source;
  return edits[0].newText;
}

// ── Baseline tests (default settings) ───────────────────────

describe('AST Formatter', () => {
  describe('method formatting', () => {
    it('formats a unary method with blank line', () => {
      const input = 'method: Foo\nfoo   ^self\n%';
      const result = format(input);
      expect(result).toBe('method: Foo\nfoo\n\n  ^self\n%');
    });

    it('formats a binary method with blank line', () => {
      const input = 'method: Foo\n+ other   ^self\n%';
      const result = format(input);
      expect(result).toBe('method: Foo\n+ other\n\n  ^self\n%');
    });

    it('formats a keyword method pattern with blank line', () => {
      const input = 'method: Foo\nat: index put: value ^self\n%';
      const result = format(input);
      expect(result).toBe('method: Foo\nat: index put: value\n\n  ^self\n%');
    });

    it('formats method comment after pattern then blank line', () => {
      const input = 'method: Foo\nfoo "This is a comment" ^self\n%';
      const result = format(input);
      expect(result).toBe('method: Foo\nfoo\n  "This is a comment"\n\n  ^self\n%');
    });

    it('formats method comment with temporaries', () => {
      const input = 'method: Foo\nfoo "A comment" | x | x := 1. ^x\n%';
      const result = format(input);
      expect(result).toBe('method: Foo\nfoo\n  "A comment"\n\n  | x |\n  x := 1.\n  ^x\n%');
    });

    it('formats method without comment', () => {
      const input = 'method: Foo\nfoo | x | x := 1. ^x\n%';
      const result = format(input);
      expect(result).toBe('method: Foo\nfoo\n\n  | x |\n  x := 1.\n  ^x\n%');
    });
  });

  describe('statements', () => {
    it('terminates statements with period', () => {
      const input = 'run\nx := 1.\ny := 2\n%';
      const result = format(input);
      expect(result).toBe('run\nx := 1.\ny := 2.\n%');
    });

    it('does not terminate return with period', () => {
      const input = 'method: Foo\nfoo ^42\n%';
      const result = format(input);
      expect(result).toBe('method: Foo\nfoo\n\n  ^42\n%');
    });
  });

  describe('temporaries', () => {
    it('formats method temporaries', () => {
      const input = 'method: Foo\nfoo |x  y  z| ^x\n%';
      const result = format(input);
      expect(result).toBe('method: Foo\nfoo\n\n  | x y z |\n  ^x\n%');
    });
  });

  describe('binary operators', () => {
    it('spaces around binary operators', () => {
      const input = 'run\n1+2\n%';
      const result = format(input);
      expect(result).toBe('run\n1 + 2.\n%');
    });

    it('spaces around comma operator', () => {
      const input = 'run\na,b\n%';
      const result = format(input);
      expect(result).toBe('run\na , b.\n%');
    });
  });

  describe('keyword messages', () => {
    it('keeps single keyword inline', () => {
      const input = 'run\nArray new: 5\n%';
      const result = format(input);
      expect(result).toBe('run\nArray new: 5.\n%');
    });

    it('puts each keyword on new line for multi-keyword', () => {
      const input = "run\nself at: 1 put: 'value'\n%";
      const result = format(input);
      expect(result).toBe("run\nself\n  at: 1\n  put: 'value'.\n%");
    });

    it('indents multi-keyword inside method body', () => {
      const input = "method: Foo\nfoo self at: 1 put: 'v'\n%";
      const result = format(input);
      expect(result).toBe("method: Foo\nfoo\n\n  self\n    at: 1\n    put: 'v'.\n%");
    });
  });

  describe('ifTrue:ifFalse: block-arg formatting', () => {
    // Tier 1: trivial blocks (variable or literal) — all on one line
    it('keeps trivial blocks inline (variables)', () => {
      const input = 'run\ncondition ifTrue: [x] ifFalse: [y]\n%';
      const result = format(input);
      expect(result).toBe('run\ncondition ifTrue: [x] ifFalse: [y].\n%');
    });

    it('keeps trivial blocks inline (literals)', () => {
      const input = 'run\ncondition ifTrue: [42] ifFalse: [nil]\n%';
      const result = format(input);
      expect(result).toBe('run\ncondition ifTrue: [42] ifFalse: [nil].\n%');
    });

    it('keeps trivial blocks inline with empty block', () => {
      const input = 'run\ncondition ifTrue: [x] ifFalse: []\n%';
      const result = format(input);
      expect(result).toBe('run\ncondition ifTrue: [x] ifFalse: [].\n%');
    });

    // Tier 2: single-statement blocks — keyword per line, blocks inline
    it('formats single-statement blocks with keyword per line', () => {
      const input = 'run\ncondition ifTrue: [self doA] ifFalse: [self doB]\n%';
      const result = format(input);
      expect(result).toBe('run\ncondition\n  ifTrue: [self doA]\n  ifFalse: [self doB].\n%');
    });

    it('formats single-assignment blocks with keyword per line', () => {
      const input = 'run\ncondition ifTrue: [x := 1] ifFalse: [y := 2]\n%';
      const result = format(input);
      expect(result).toBe('run\ncondition\n  ifTrue: [x := 1]\n  ifFalse: [y := 2].\n%');
    });

    it('formats mixed trivial and single-statement as tier 2', () => {
      const input = 'run\ncondition ifTrue: [x] ifFalse: [self doB]\n%';
      const result = format(input);
      expect(result).toBe('run\ncondition\n  ifTrue: [x]\n  ifFalse: [self doB].\n%');
    });

    // Tier 3: bracket-flow — complex blocks
    it('formats multi-statement blocks with bracket-flow', () => {
      const input = 'run\ncondition ifTrue: [x := 1. y := 2] ifFalse: [z := 3]\n%';
      const result = format(input);
      expect(result).toBe(
        'run\ncondition ifTrue: [\n  x := 1.\n  y := 2.\n] ifFalse: [\n  z := 3.\n].\n%',
      );
    });

    it('formats bracket-flow inside method body', () => {
      const input = 'method: Foo\nfoo condition ifTrue: [x := 1. y := 2] ifFalse: [z := 3]\n%';
      const result = format(input);
      expect(result).toBe(
        'method: Foo\nfoo\n\n  condition ifTrue: [\n    x := 1.\n    y := 2.\n  ] ifFalse: [\n    z := 3.\n  ].\n%',
      );
    });

    it('formats blocks with temporaries as bracket-flow', () => {
      const input = 'run\ncondition ifTrue: [| x | x := 1] ifFalse: [y]\n%';
      const result = format(input);
      expect(result).toBe('run\ncondition ifTrue: [| x |\n  x := 1.\n] ifFalse: [\n  y.\n].\n%');
    });

    it('falls back to bracket-flow when single statement is multi-line', () => {
      const input =
        "run\ncondition ifTrue: [self at: 1 put: 'v'] ifFalse: [self at: 2 put: 'w']\n%";
      const result = format(input);
      expect(result).toContain('ifTrue: [');
      expect(result).toContain('] ifFalse: [');
    });

    // Other control-flow selectors get the same treatment
    it('applies tiers to ifNil:ifNotNil:', () => {
      const input = 'run\nvalue ifNil: [0] ifNotNil: [value]\n%';
      const result = format(input);
      expect(result).toBe('run\nvalue ifNil: [0] ifNotNil: [value].\n%');
    });

    it('applies bracket-flow to ifNotNil:ifNil:', () => {
      const input = 'run\nvalue ifNotNil: [x := 1. y := 2] ifNil: [z := 3]\n%';
      const result = format(input);
      expect(result).toBe(
        'run\nvalue ifNotNil: [\n  x := 1.\n  y := 2.\n] ifNil: [\n  z := 3.\n].\n%',
      );
    });

    // Non-block args still use existing multi-keyword logic
    it('non-block args use standard multi-keyword formatting', () => {
      const input = "run\nself at: 1 put: 'value'\n%";
      const result = format(input);
      expect(result).toBe("run\nself\n  at: 1\n  put: 'value'.\n%");
    });
  });

  describe('blocks', () => {
    it('formats empty block', () => {
      const input = 'run\n[]\n%';
      const result = format(input);
      expect(result).toBe('run\n[].\n%');
    });

    it('formats block with statements', () => {
      const input = 'run\n[x := 1. y := 2]\n%';
      const result = format(input);
      expect(result).toBe('run\n[\n  x := 1.\n  y := 2.\n].\n%');
    });

    it('formats block with parameters', () => {
      const input = 'run\n[:a :b | a + b]\n%';
      const result = format(input);
      expect(result).toBe('run\n[:a :b |\n  a + b.\n].\n%');
    });

    it('formats block with temporaries', () => {
      const input = 'run\n[| x | x := 1. x]\n%';
      const result = format(input);
      expect(result).toBe('run\n[| x |\n  x := 1.\n  x.\n].\n%');
    });

    it('closing bracket at same indent as opening line', () => {
      const input = 'method: Foo\nfoo 1 timesRepeat: [x := 1. y := 2]\n%';
      const result = format(input);
      expect(result).toBe(
        'method: Foo\nfoo\n\n  1 timesRepeat: [\n    x := 1.\n    y := 2.\n  ].\n%',
      );
    });

    it('keeps simple block inline', () => {
      const input = 'run\n[42]\n%';
      const result = format(input);
      expect(result).toBe('run\n[42].\n%');
    });
  });

  describe('topaz preservation', () => {
    it('preserves topaz command lines', () => {
      const input = 'login\nrun\nx := 1\n%\ncommit\nlogout';
      const result = format(input);
      expect(result).toBe('login\nrun\nx := 1.\n%\ncommit\nlogout');
    });
  });

  describe('blank line collapsing', () => {
    it('collapses multiple blank lines to one', () => {
      const input = 'login\n\n\n\nrun\nx := 1\n%\nlogout';
      const result = format(input);
      expect(result).toBe('login\n\nrun\nx := 1.\n%\nlogout');
    });

    it('preserves a single blank line', () => {
      const input = 'login\n\nrun\nx := 1\n%\nlogout';
      const result = format(input);
      expect(result).toBe('login\n\nrun\nx := 1.\n%\nlogout');
    });

    it('collapses blank lines between topaz commands', () => {
      const input = 'login\nrun\nx := 1\n%\n\n\ncommit\nlogout';
      const result = format(input);
      expect(result).toBe('login\nrun\nx := 1.\n%\n\ncommit\nlogout');
    });
  });

  describe('cascades', () => {
    it('formats cascade messages', () => {
      const input = 'run\nself add: 1; add: 2; yourself\n%';
      const result = format(input);
      expect(result).toBe('run\nself add: 1;\n  add: 2;\n  yourself.\n%');
    });
  });

  describe('assignment', () => {
    it('formats assignment with spacing', () => {
      const input = 'run\nx:=5\n%';
      const result = format(input);
      expect(result).toBe('run\nx := 5.\n%');
    });
  });

  describe('literals', () => {
    it('formats array literal', () => {
      const input = "run\n#(1  'two'  three)\n%";
      const result = format(input);
      expect(result).toBe("run\n#(1 'two' three).\n%");
    });

    it('formats symbol literal', () => {
      const input = 'run\n#foo\n%';
      const result = format(input);
      expect(result).toBe('run\n#foo.\n%');
    });
  });

  describe('env specifier preservation', () => {
    it('preserves env specifier on a unary message', () => {
      const input = 'run\n3 @env2:squared\n%';
      const result = format(input);
      expect(result).toBe('run\n3 @env2:squared.\n%');
    });

    it('preserves env specifier on a binary message', () => {
      const input = 'run\n2 @env1:+ 3\n%';
      const result = format(input);
      expect(result).toBe('run\n2 @env1:+ 3.\n%');
    });

    it('preserves env specifier on a keyword message', () => {
      const input = 'run\nTranscript @env0:show: 2\n%';
      const result = format(input);
      expect(result).toBe('run\nTranscript @env0:show: 2.\n%');
    });

    it('preserves env specifiers on the BNF docstring example', () => {
      const input = 'run\nTranscript @env0:show: 2 @env1:+ 3 @env2:squared\n%';
      const result = format(input);
      expect(result).toBe('run\nTranscript @env0:show: 2 @env1:+ 3 @env2:squared.\n%');
    });
  });
});

// ── Settings-specific tests ─────────────────────────────────

describe('Formatter Settings', () => {
  describe('spacesInsideParens', () => {
    it('no spaces inside parens by default', () => {
      const input = 'run\n(1 + 2) size\n%';
      expect(format(input)).toContain('(1 + 2) size');
    });

    it('adds spaces inside parens when enabled', () => {
      const input = 'run\n(1 + 2) size\n%';
      expect(format(input, { spacesInsideParens: true })).toContain('( 1 + 2 ) size');
    });
  });

  describe('spacesInsideBrackets', () => {
    it('no spaces inside brackets for inline block by default', () => {
      const input = 'run\n[42]\n%';
      expect(format(input)).toContain('[42]');
    });

    it('adds spaces inside brackets for inline block when enabled', () => {
      const input = 'run\n[42]\n%';
      expect(format(input, { spacesInsideBrackets: true })).toContain('[ 42 ]');
    });
  });

  describe('spacesInsideBraces', () => {
    it('no spaces inside braces by default', () => {
      const input = 'run\n{1. 2. 3}\n%';
      expect(format(input)).toContain('{1. 2. 3}');
    });

    it('adds spaces inside braces when enabled', () => {
      const input = 'run\n{1. 2. 3}\n%';
      expect(format(input, { spacesInsideBraces: true })).toContain('{ 1. 2. 3 }');
    });
  });

  describe('spacesAroundAssignment', () => {
    it('spaces around assignment by default', () => {
      const input = 'run\nx:=5\n%';
      expect(format(input)).toContain('x := 5');
    });

    it('removes spaces around assignment when disabled', () => {
      const input = 'run\nx := 5\n%';
      expect(format(input, { spacesAroundAssignment: false })).toContain('x:=5');
    });
  });

  describe('spacesAroundBinarySelectors', () => {
    it('spaces around binary selectors by default', () => {
      const input = 'run\n1+2\n%';
      expect(format(input)).toContain('1 + 2');
    });

    it('removes spaces around binary selectors when disabled', () => {
      const input = 'run\n1 + 2\n%';
      expect(format(input, { spacesAroundBinarySelectors: false })).toContain('1 +2');
    });
  });

  describe('spaceAfterCaret', () => {
    it('no space after caret by default', () => {
      const input = 'method: Foo\nfoo ^ 42\n%';
      expect(format(input)).toContain('^42');
    });

    it('adds space after caret when enabled', () => {
      const input = 'method: Foo\nfoo ^42\n%';
      expect(format(input, { spaceAfterCaret: true })).toContain('^ 42');
    });
  });

  describe('blankLineAfterMethodPattern', () => {
    it('inserts blank line after method pattern by default', () => {
      const input = 'method: Foo\nfoo ^42\n%';
      expect(format(input)).toBe('method: Foo\nfoo\n\n  ^42\n%');
    });

    it('omits blank line when disabled', () => {
      const input = 'method: Foo\nfoo ^42\n%';
      expect(format(input, { blankLineAfterMethodPattern: false })).toBe(
        'method: Foo\nfoo\n  ^42\n%',
      );
    });
  });

  describe('multiKeywordThreshold', () => {
    it('splits 2-keyword message by default (threshold=2)', () => {
      const input = "run\nself at: 1 put: 'v'\n%";
      const result = format(input);
      expect(result).toBe("run\nself\n  at: 1\n  put: 'v'.\n%");
    });

    it('keeps 2-keyword message inline when threshold is 3', () => {
      const input = "run\nself at: 1 put: 'v'\n%";
      const result = format(input, { multiKeywordThreshold: 3 });
      expect(result).toBe("run\nself at: 1 put: 'v'.\n%");
    });
  });

  describe('continuationIndent', () => {
    it('uses 2-space continuation indent by default', () => {
      const input = "run\nself at: 1 put: 'v'\n%";
      const result = format(input);
      expect(result).toContain('  at: 1');
    });

    it('uses custom continuation indent', () => {
      const input = "run\nself at: 1 put: 'v'\n%";
      const result = format(input, { continuationIndent: 4 });
      expect(result).toContain('    at: 1');
      expect(result).toContain("    put: 'v'");
    });
  });

  describe('tabSize', () => {
    it('uses 2-space indent by default', () => {
      const input = 'method: Foo\nfoo | x | ^x\n%';
      const result = format(input);
      expect(result).toContain('  | x |');
    });

    it('uses 4-space indent when configured', () => {
      const input = 'method: Foo\nfoo | x | ^x\n%';
      const result = format(input, { tabSize: 4 });
      expect(result).toContain('    | x |');
    });
  });

  describe('insertSpaces', () => {
    it('uses tab indentation when insertSpaces is false', () => {
      const input = 'method: Foo\nfoo | x | ^x\n%';
      const result = format(input, { insertSpaces: false });
      expect(result).toContain('\t| x |');
    });
  });

  describe('removeUnnecessaryParens', () => {
    // Unary left-to-right: (obj foo) bar → obj foo bar
    it('removes parens around unary receiver of unary', () => {
      const input = 'run\n(obj foo) bar\n%';
      expect(format(input)).toContain('obj foo bar');
    });

    // Binary left-to-right: (a + b) + c → a + b + c
    it('removes parens around binary left-to-right', () => {
      const input = 'run\n(a + b) + c\n%';
      expect(format(input)).toContain('a + b + c');
    });

    // (a + b) * c → a + b * c (all binary same precedence, left-to-right)
    it('removes parens around binary left operand with different operator', () => {
      const input = 'run\n(a + b) * c\n%';
      expect(format(input)).toContain('a + b * c');
    });

    // Unary binds tighter than binary: (a size) + b → a size + b
    it('removes parens around unary in binary receiver', () => {
      const input = 'run\n(a size) + b\n%';
      expect(format(input)).toContain('a size + b');
    });

    // Binary arg: a + (b size) → a + b size (unary binds tighter)
    it('removes parens around unary in binary argument', () => {
      const input = 'run\na + (b size)\n%';
      expect(format(input)).toContain('a + b size');
    });

    // Keyword arg: self foo: (a + b) → self foo: a + b
    it('removes parens around binary in keyword argument', () => {
      const input = 'run\nself foo: (a + b)\n%';
      expect(format(input)).toContain('self foo: a + b');
    });

    // Keyword receiver: (a + b) ifTrue: [x] → a + b ifTrue: [x]
    it('removes parens around binary receiver of keyword', () => {
      const input = 'run\n(a + b) ifTrue: [x]\n%';
      expect(format(input)).toContain('a + b ifTrue: [x]');
    });

    // Standalone: (x) → x
    it('removes parens around simple primary', () => {
      const input = 'run\n(x)\n%';
      expect(format(input)).toBe('run\nx.\n%');
    });

    // NECESSARY parens — must NOT be removed

    // a + (b + c) — changes grouping
    it('keeps parens for binary right operand with binary', () => {
      const input = 'run\na + (b + c)\n%';
      expect(format(input)).toContain('a + (b + c)');
    });

    // (a + b) size — unary binds tighter, would change to a + (b size)
    it('keeps parens when binary receiver gets unary message', () => {
      const input = 'run\n(a + b) size\n%';
      expect(format(input)).toContain('(a + b) size');
    });

    // (self foo: x) + b — keyword result in binary context
    it('keeps parens around keyword in binary receiver', () => {
      const input = 'run\n(self foo: x) + b\n%';
      expect(format(input)).toContain('(self foo: x) + b');
    });

    // self foo: (self bar: x) — nested keyword
    it('keeps parens around keyword in keyword argument', () => {
      const input = 'run\nself foo: (self bar: x)\n%';
      expect(format(input)).toContain('self foo: (self bar: x)');
    });

    // (self foo: x) ifTrue: [y] — keyword in keyword receiver
    it('keeps parens around keyword in keyword receiver', () => {
      const input = 'run\n(self foo: x) ifTrue: [y]\n%';
      expect(format(input)).toContain('(self foo: x) ifTrue: [y]');
    });

    // Cascades need parens
    it('keeps parens around cascades with outer messages', () => {
      const input = 'run\n(self add: 1; yourself) size\n%';
      expect(format(input)).toContain('(self add: 1;\n');
    });

    // Disabled setting
    it('preserves all parens when setting is disabled', () => {
      const input = 'run\n(a + b) + c\n%';
      expect(format(input, { removeUnnecessaryParens: false })).toContain('(a + b) + c');
    });
  });
});

// ── Which documents Format Document touches ─────────────────
//
// `gemstone://` method editors reach the formatter through the same pipeline as a
// Topaz file, but definition and comment editors must not — see
// isFormattableDocument. These cases pin one document kind each; the class-comment
// one is the regression that matters, because formatting prose destroys it.

describe('isFormattableDocument', () => {
  const METHOD_URI = 'gemstone://1/UserGlobals/V8Contact/instance/accessing/printOn:';
  const CLASS_METHOD_URI = 'gemstone://1/UserGlobals/V8Contact/class/instance%20creation/new';
  const DEFINITION_URI = 'gemstone://1/UserGlobals/V8Contact/definition';
  const DEFINITION_URI_5 = 'gemstone://1/UserGlobals/V8Contact/definition/V8Contact';
  const COMMENT_URI = 'gemstone://1/UserGlobals/V8Contact/comment';
  const COMMENT_URI_5 = 'gemstone://1/UserGlobals/V8Contact/comment/V8Contact%20comment';

  // Mirrors how the server builds a document: the format comes from the URI
  // (server.ts:165), which is exactly what makes every gemstone:// document
  // 'smalltalk' regardless of whether it holds a method, a definition or a comment.
  function doc(uri: string, text: string) {
    return new DocumentManager().update(uri, 1, text, detectFormat(uri));
  }

  it('formats an instance-side method editor', () => {
    const d = doc(METHOD_URI, "printOn: s s nextPutAll: 'Addr(', street, ', ', city, ')'");
    expect(isFormattableDocument(d)).toBe(true);
    expect(formatDocument(d, DEFAULT_SETTINGS)[0].newText).toBe(
      "printOn: s\n\n  s nextPutAll: 'Addr(' , street , ', ' , city , ')'.",
    );
  });

  it('formats a class-side method editor', () => {
    expect(isFormattableDocument(doc(CLASS_METHOD_URI, 'new ^super new init'))).toBe(true);
  });

  it('leaves a class-definition editor alone', () => {
    expect(isFormattableDocument(doc(DEFINITION_URI, 'Object subclass: #V8Contact'))).toBe(false);
    expect(isFormattableDocument(doc(DEFINITION_URI_5, 'Object subclass: #V8Contact'))).toBe(false);
  });

  it('leaves a class-comment editor alone, so prose is not reflowed as code', () => {
    // The guard that matters. Run through the formatter this text loses its paragraph
    // break and gains a line break at every sentence-ending period, because the parser
    // reads them as statement separators.
    const prose = 'An address. Holds a street and a city.\n\nSecond paragraph here.';
    for (const uri of [COMMENT_URI, COMMENT_URI_5]) {
      const d = doc(uri, prose);
      expect(isFormattableDocument(d)).toBe(false);
      // Confirm the damage is real, i.e. the guard is load-bearing rather than
      // defensive: bypassing it does mangle the comment.
      expect(formatDocument(d, DEFAULT_SETTINGS)[0].newText).not.toBe(prose);
    }
  });

  it('formats a Topaz file, unchanged from before', () => {
    expect(isFormattableDocument(doc('file:///x/foo.gs', 'method: Foo\nfoo ^self\n%'))).toBe(true);
  });

  it('leaves a Tonel file alone', () => {
    expect(isFormattableDocument(doc('file:///x/Foo.class.st', 'Class { #name : #Foo }'))).toBe(
      false,
    );
  });
});
