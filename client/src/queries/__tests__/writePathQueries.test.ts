import { describe, it, expect, vi } from 'vitest';
import { QueryExecutor } from '../types';

import { compileMethod } from '../compileMethod';
import { compileClassDefinition } from '../compileClassDefinition';
import { setClassComment } from '../setClassComment';
import { deleteMethod } from '../deleteMethod';
import { recategorizeMethod } from '../recategorizeMethod';
import { recategorizeClass } from '../recategorizeClass';
import { copyMethodToClass } from '../copyMethodToClass';
import { renameCategory } from '../renameCategory';
import { deleteClass } from '../deleteClass';
import { moveClass } from '../moveClass';
import { addDictionary } from '../addDictionary';
import { removeDictionary } from '../removeDictionary';
import { moveDictionaryUp } from '../moveDictionaryUp';
import { moveDictionaryDown } from '../moveDictionaryDown';
import { setBreakAtStepPoint } from '../setBreakAtStepPoint';
import { clearBreakAtStepPoint } from '../clearBreakAtStepPoint';
import { clearAllBreaks } from '../clearAllBreaks';

describe('compileMethod', () => {
  it('uses Behavior>>compileMethod:dictionaries:category:environmentId:', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Compiled: Array >> foo');
    compileMethod(execute, 'Array', false, 'accessing', 'foo\n  ^ 42');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('compileMethod:');
    expect(code).toContain("category: 'accessing'");
    expect(code).toContain('dictionaries: System myUserProfile symbolList');
    expect(code).toContain('environmentId: 0');
  });

  it("uses target = 'base class' for class-side compiles", () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    compileMethod(execute, 'Array', true, 'creation', 'new\n  ^ super new');
    expect(execute.mock.calls[0][0]).toContain('target := base class');
  });

  it("uses target = 'base' for instance-side compiles", () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    compileMethod(execute, 'Array', false, 'acc', 'foo');
    expect(execute.mock.calls[0][0]).toContain('target := base');
    expect(execute.mock.calls[0][0]).not.toContain('target := base class');
  });

  it('scopes lookup to a dictionary when dict is provided', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    compileMethod(execute, 'Foo', false, 'cat', 'x', 0, 'UserGlobals');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("objectNamed: #'UserGlobals'");
    expect(code).toContain("at: #'Foo' ifAbsent: [nil]");
  });

  it('returns "Class not found" guard when the class lookup yields nil', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    compileMethod(execute, 'Nope', false, 'cat', 'x');
    expect(execute.mock.calls[0][0]).toContain("base ifNil: [^ 'Class not found: Nope']");
  });

  it('escapes single quotes in class name, category, and source', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    compileMethod(execute, "Foo'", true, "cat's", "foo\n  ^ 'hi'");
    const code = execute.mock.calls[0][0];
    expect(code).toContain("#'Foo'''"); // className in Smalltalk symbol
    expect(code).toContain("category: 'cat''s'");
    expect(code).toContain("'foo\n  ^ ''hi'''");
  });
});

describe('compileClassDefinition', () => {
  it('wraps source in `(source) name` so the result is the class name as a String', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Foo');
    const result = compileClassDefinition(execute, "Object subclass: 'Foo'");
    expect(result).toBe('Foo');
    expect(execute.mock.calls[0][0]).toBe("(Object subclass: 'Foo') name");
  });
});

describe('setClassComment', () => {
  it('sets comment and returns a confirmation', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Comment set: Foo');
    expect(setClassComment(execute, 'Foo', 'hi')).toBe('Comment set: Foo');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("cls comment: 'hi'");
  });

  it('escapes quotes in class name and comment', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    setClassComment(execute, "Foo'", "it's a comment");
    const code = execute.mock.calls[0][0];
    expect(code).toContain("#'Foo'''");
    expect(code).toContain("comment: 'it''s a comment'");
  });

  it('scopes lookup when dict is provided', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    setClassComment(execute, 'Foo', 'x', 2);
    expect(execute.mock.calls[0][0]).toContain('symbolList at: 2');
  });
});

describe('deleteMethod', () => {
  it('removes the selector and returns confirmation', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Deleted: Array >> size');
    expect(deleteMethod(execute, 'Array', false, 'size')).toBe('Deleted: Array >> size');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("target removeSelector: #'size'");
  });

  it('returns "Selector not found" when the selector is missing', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    deleteMethod(execute, 'Array', false, 'missing');
    expect(execute.mock.calls[0][0]).toContain('includesSelector:');
    expect(execute.mock.calls[0][0]).toContain("'Selector not found: '");
  });

  it('uses base class for class-side deletes', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    deleteMethod(execute, 'Array', true, 'new');
    expect(execute.mock.calls[0][0]).toContain('target := base class');
  });
});

describe('recategorizeMethod', () => {
  it('sends moveMethod:toCategory: with escaped args', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    recategorizeMethod(execute, 'Array', false, 'size', "it's new");
    const code = execute.mock.calls[0][0];
    expect(code).toContain("moveMethod: #'size'");
    expect(code).toContain("toCategory: 'it''s new'");
  });

  it('scopes the receiver to a SymbolList index when a dict is given', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    recategorizeMethod(execute, 'object', false, 'size', 'cat', 1);
    const code = execute.mock.calls[0][0];
    expect(code).toContain("(System myUserProfile symbolList at: 1) at: #'object' ifAbsent: [nil]");
  });
});

describe('renameCategory', () => {
  it('sends renameCategory:to: with escaped args', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    renameCategory(execute, 'Array', false, 'old', 'new');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("renameCategory: 'old' to: 'new'");
  });
});

describe('deleteClass', () => {
  it('scopes to a dict by index when given a number', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Deleted class: Foo');
    expect(deleteClass(execute, 1, 'Foo')).toBe('Deleted class: Foo');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('symbolList at: 1');
    expect(code).toContain("removeKey: #'Foo' ifAbsent: [nil]");
  });

  it('scopes to a dict by name when given a string', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    deleteClass(execute, 'UserGlobals', 'Foo');
    expect(execute.mock.calls[0][0]).toContain("objectNamed: #'UserGlobals'");
  });

  it('returns "Class not found" when the dict lacks the key', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    deleteClass(execute, 1, 'Foo');
    expect(execute.mock.calls[0][0]).toContain("'Class not found: Foo'");
  });
});

describe('moveClass', () => {
  it('moves a class between dicts and reports', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Moved class: Foo');
    expect(moveClass(execute, 1, 2, 'Foo')).toBe('Moved class: Foo');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('symbolList at: 1');
    expect(code).toContain('symbolList at: 2');
    expect(code).toContain('destDict at:');
  });

  it('returns "Class not found in source" if src dict lacks the key', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    moveClass(execute, 1, 2, 'Foo');
    expect(execute.mock.calls[0][0]).toContain('Class not found in source dictionary');
  });
});

describe('addDictionary', () => {
  it('creates a new SymbolDictionary and appends it to the symbolList', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Added dictionary: MyDict');
    expect(addDictionary(execute, 'MyDict')).toBe('Added dictionary: MyDict');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('SymbolDictionary new');
    expect(code).toContain("dict name: #'MyDict'");
    expect(code).toContain('symbolList add: dict');
  });
});

describe('removeDictionary', () => {
  it('removes by index when given a number', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Removed dictionary: X');
    expect(removeDictionary(execute, 3)).toBe('Removed dictionary: X');
    expect(execute.mock.calls[0][0]).toContain('symbolList at: 3');
  });

  it('removes by name when given a string', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    removeDictionary(execute, 'MyDict');
    expect(execute.mock.calls[0][0]).toContain("objectNamed: #'MyDict'");
  });

  it('returns "Dictionary not found" when lookup yields nil', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    removeDictionary(execute, 'Bogus');
    expect(execute.mock.calls[0][0]).toContain("'Dictionary not found'");
  });
});

describe('moveDictionaryUp / moveDictionaryDown', () => {
  it('moveDictionaryUp swaps with the previous slot', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    moveDictionaryUp(execute, 3);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('3 > 1 ifTrue:');
    expect(code).toContain('sl at: 3 - 1');
  });

  it('moveDictionaryDown swaps with the next slot', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    moveDictionaryDown(execute, 1);
    const code = execute.mock.calls[0][0];
    expect(code).toContain('1 < sl size ifTrue:');
    expect(code).toContain('sl at: 1 + 1');
  });
});

describe('breakpoint ops', () => {
  it('setBreakAtStepPoint composes the setBreakAtStepPoint: send', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    setBreakAtStepPoint(execute, 'Array', false, 'size', 3);
    const code = execute.mock.calls[0][0];
    expect(code).toContain("compiledMethodAt: #'size'");
    expect(code).toContain('setBreakAtStepPoint: 3');
  });

  it('clearBreakAtStepPoint composes the clearBreakAtStepPoint: send', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    clearBreakAtStepPoint(execute, 'Array', false, 'size', 3);
    expect(execute.mock.calls[0][0]).toContain('clearBreakAtStepPoint: 3');
  });

  it('clearAllBreaks composes the clearAllBreaks send', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    clearAllBreaks(execute, 'Array', false, 'size');
    expect(execute.mock.calls[0][0]).toContain('clearAllBreaks');
  });

  it('handles class-side breakpoints via the "Class class" receiver', () => {
    const execute = vi.fn<QueryExecutor>(() => 'ok');
    setBreakAtStepPoint(execute, 'Array', true, 'new', 2);
    expect(execute.mock.calls[0][0]).toContain('Array class compiledMethodAt:');
  });
});

describe('recategorizeClass', () => {
  it('sets the class category via Class>>category:', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Recategorized: Array');
    recategorizeClass(execute, 'Array', 'Collections');
    expect(execute.mock.calls[0][0]).toContain("cls category: 'Collections'");
  });

  it('guards against a missing class', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    recategorizeClass(execute, 'Nope', 'Cat');
    expect(execute.mock.calls[0][0]).toContain("cls ifNil: [^ 'Class not found: Nope']");
  });

  it('escapes the class name and category', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    recategorizeClass(execute, "Fo'o", "Ca't");
    const code = execute.mock.calls[0][0];
    expect(code).toContain("#'Fo''o'");
    expect(code).toContain("category: 'Ca''t'");
  });

  it('scopes the lookup to a dictionary index when given', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    recategorizeClass(execute, 'Array', 'Cat', 2);
    expect(execute.mock.calls[0][0]).toContain('symbolList at: 2');
  });
});

describe('copyMethodToClass', () => {
  it('reads the source method and category and compiles it into the target', () => {
    const execute = vi.fn<QueryExecutor>(() => 'Copied: Set >> name');
    copyMethodToClass(execute, 'Array', 'Set', false, 'name');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("compiledMethodAt: #'name'");
    expect(code).toContain("categoryOfSelector: #'name'");
    expect(code).toContain('compileMethod: source');
    expect(code).toContain('category: (category ifNil:');
  });

  it('guards against missing source and target classes', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    copyMethodToClass(execute, 'Src', 'Dst', false, 'sel');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("^ 'Source class not found: Src'");
    expect(code).toContain("^ 'Target class not found: Dst'");
  });

  it('copies class-side methods via the "Class class" receiver on both sides', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    copyMethodToClass(execute, 'Array', 'Set', true, 'new');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('srcRecv := src class');
    expect(code).toContain('tgtRecv := target class');
  });

  it('reads from the given environment when non-zero', () => {
    const execute = vi.fn<QueryExecutor>(() => '');
    copyMethodToClass(execute, 'Array', 'Set', false, 'name', 1);
    const code = execute.mock.calls[0][0];
    expect(code).toContain("compiledMethodAt: #'name' environmentId: 1");
    expect(code).toContain('environmentId: 1');
  });
});
