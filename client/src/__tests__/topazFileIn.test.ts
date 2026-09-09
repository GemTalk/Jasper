import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { ActiveSession } from '../sessionManager';
import { BrowserQueryError } from '../browserQueries';
import {
  parseTopazDocument,
  fileInClass,
  parseFileStructure,
  fileInChangedRegions,
} from '../topazFileIn';
import * as queries from '../browserQueries';

vi.mock('../browserQueries', () => ({
  BrowserQueryError: class BrowserQueryError extends Error {
    constructor(
      message: string,
      public readonly gciErrorNumber: number = 0,
    ) {
      super(message);
    }
  },
  compileClassDefinition: vi.fn(),
  compileMethod: vi.fn(() => 1000n),
  deleteMethod: vi.fn(),
}));

function createMockSession(): ActiveSession {
  return {
    id: 1,
    gci: {} as ActiveSession['gci'],
    handle: {},
    login: {
      label: 'Test',
      version: '3.7.2',
      gem_host: 'localhost',
      stone: 'gs64stone',
      gs_user: 'DataCurator',
      gs_password: '',
      netldi: 'gs64ldi',
      host_user: '',
      host_password: '',
    },
    stoneVersion: '3.7.2',
  };
}

describe('parseTopazDocument', () => {
  it('parses method regions with class names', () => {
    const text = `method: MyClass
selector
  ^ 42
%`;
    const regions = parseTopazDocument(text);
    const methods = regions.filter((r) => r.kind === 'smalltalk-method');
    expect(methods).toHaveLength(1);
    expect(methods[0].className).toBe('MyClass');
    expect(methods[0].command).toBe('method');
    expect(methods[0].text).toContain('selector');
  });

  it('parses classmethod regions', () => {
    const text = `classmethod: MyClass
new
  ^ super new initialize
%`;
    const regions = parseTopazDocument(text);
    const methods = regions.filter((r) => r.kind === 'smalltalk-method');
    expect(methods).toHaveLength(1);
    expect(methods[0].command).toBe('classmethod');
    expect(methods[0].className).toBe('MyClass');
  });

  it('parses run/doit blocks as code regions', () => {
    const text = `run
Object subclass: 'MyClass'
  instVarNames: #()
  classVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals.
%`;
    const regions = parseTopazDocument(text);
    const code = regions.filter((r) => r.kind === 'smalltalk-code');
    expect(code).toHaveLength(1);
    expect(code[0].text).toContain("subclass: 'MyClass'");
  });

  it('identifies topaz regions including category commands', () => {
    const text = `! comment
category: 'accessing'
method: MyClass
foo
  ^ 1
%`;
    const regions = parseTopazDocument(text);
    const topaz = regions.filter((r) => r.kind === 'topaz');
    expect(topaz).toHaveLength(1);
    expect(topaz[0].text).toContain("category: 'accessing'");
  });

  it('parses a complete fileOutClass output', () => {
    const text = `! Class definition
run
Object subclass: 'MyClass'
  instVarNames: #(name)
  classVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals.
true
%
! ------------------- Class methods for MyClass
category: 'creation'
classmethod: MyClass
new
  ^ super new initialize
%
! ------------------- Instance methods for MyClass
category: 'accessing'
method: MyClass
name
  ^ name
%
category: 'accessing'
method: MyClass
name: aString
  name := aString
%`;
    const regions = parseTopazDocument(text);
    const methods = regions.filter((r) => r.kind === 'smalltalk-method');
    const code = regions.filter((r) => r.kind === 'smalltalk-code');
    expect(code).toHaveLength(1);
    expect(methods).toHaveLength(3);
    expect(methods[0].command).toBe('classmethod');
    expect(methods[1].command).toBe('method');
    expect(methods[2].command).toBe('method');
  });
});

describe('fileInClass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (queries.compileClassDefinition as ReturnType<typeof vi.fn>).mockImplementation(() => {});
    (queries.compileMethod as ReturnType<typeof vi.fn>).mockReturnValue(1000n);
  });

  it('compiles class definition from doit block', () => {
    const text = `run
Object subclass: 'MyClass'
  instVarNames: #()
  classVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals.
true
%`;
    const session = createMockSession();
    const result = fileInClass(session, text);

    expect(result.success).toBe(true);
    expect(result.compiledClassDef).toBe(true);
    expect(queries.compileClassDefinition).toHaveBeenCalledWith(
      session,
      expect.stringContaining("subclass: 'MyClass'"),
    );
  });

  it('compiles instance methods with correct category', () => {
    const text = `category: 'accessing'
method: MyClass
name
  ^ name
%`;
    const session = createMockSession();
    const result = fileInClass(session, text);

    expect(result.success).toBe(true);
    expect(result.compiledMethods).toBe(1);
    expect(queries.compileMethod).toHaveBeenCalledWith(
      session,
      'MyClass',
      false,
      'accessing',
      expect.stringContaining('name'),
      0,
    );
  });

  it("compiles into Bob''s methods, un-doubling the quote as topaz wrote it", () => {
    const text = `category: 'Bob''s methods'
method: MyClass
name
  ^ name
%`;
    const session = createMockSession();

    fileInClass(session, text);

    expect(queries.compileMethod).toHaveBeenCalledWith(
      session,
      'MyClass',
      false,
      "Bob's methods",
      expect.stringContaining('name'),
      0,
    );
  });

  it('compiles class methods with isMeta=true', () => {
    const text = `category: 'creation'
classmethod: MyClass
new
  ^ super new initialize
%`;
    const session = createMockSession();
    const result = fileInClass(session, text);

    expect(result.success).toBe(true);
    expect(result.compiledMethods).toBe(1);
    expect(queries.compileMethod).toHaveBeenCalledWith(
      session,
      'MyClass',
      true,
      'creation',
      expect.stringContaining('new'),
      0,
    );
  });

  it('tracks category changes across multiple method groups', () => {
    const text = `category: 'accessing'
method: MyClass
name
  ^ name
%
category: 'printing'
method: MyClass
printOn: aStream
  aStream nextPutAll: name
%`;
    const session = createMockSession();
    fileInClass(session, text);

    const mockCompile = queries.compileMethod as ReturnType<typeof vi.fn>;
    expect(mockCompile).toHaveBeenCalledTimes(2);
    // First method: 'accessing'
    expect(mockCompile.mock.calls[0][3]).toBe('accessing');
    // Second method: 'printing'
    expect(mockCompile.mock.calls[1][3]).toBe('printing');
  });

  it('uses default category when none specified', () => {
    const text = `method: MyClass
foo
  ^ 42
%`;
    const session = createMockSession();
    fileInClass(session, text);

    expect(queries.compileMethod).toHaveBeenCalledWith(
      session,
      'MyClass',
      false,
      'as yet unclassified',
      expect.any(String),
      0,
    );
  });

  it('returns errors with line numbers on compilation failure', () => {
    const mockCompile = queries.compileMethod as ReturnType<typeof vi.fn>;
    mockCompile.mockImplementation(() => {
      throw new BrowserQueryError('Syntax error', 1001);
    });

    const text = `category: 'accessing'
method: MyClass
badMethod
  ^ 1 +
%`;
    const session = createMockSession();
    const result = fileInClass(session, text);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toBe('Syntax error');
    expect(result.errors[0].line).toBe(2); // 0-based line of method body
    expect(result.errors[0].className).toBe('MyClass');
  });

  it('continues compiling after a method fails (partial success)', () => {
    const mockCompile = queries.compileMethod as ReturnType<typeof vi.fn>;
    mockCompile.mockImplementationOnce(() => {
      throw new BrowserQueryError('Error in first', 1001);
    });
    mockCompile.mockReturnValueOnce(1000n);

    const text = `category: 'accessing'
method: MyClass
bad
  ^ 1 +
%
method: MyClass
good
  ^ 42
%`;
    const session = createMockSession();
    const result = fileInClass(session, text);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.compiledMethods).toBe(1);
  });

  it('records error when method region has no class name', () => {
    // Unusual but possible if someone edits the method: line
    const text = `method:
foo
  ^ 42
%`;
    const session = createMockSession();
    const result = fileInClass(session, text);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('missing class name');
  });

  it('handles empty file gracefully', () => {
    const session = createMockSession();
    const result = fileInClass(session, '');

    expect(result.success).toBe(true);
    expect(result.compiledMethods).toBe(0);
    expect(result.compiledClassDef).toBe(false);
  });

  it('ignores non-class-definition doit blocks', () => {
    const text = `run
true
%`;
    const session = createMockSession();
    const result = fileInClass(session, text);

    expect(result.success).toBe(true);
    expect(result.compiledClassDef).toBe(false);
    expect(queries.compileClassDefinition).not.toHaveBeenCalled();
  });

  it('passes environmentId to compileMethod', () => {
    const text = `method: MyClass
foo
  ^ 42
%`;
    const session = createMockSession();
    fileInClass(session, text, 2);

    expect(queries.compileMethod).toHaveBeenCalledWith(
      session,
      'MyClass',
      false,
      'as yet unclassified',
      expect.any(String),
      2,
    );
  });

  it('compiles a complete class with definition and methods', () => {
    const text = `run
Object subclass: 'MyClass'
  instVarNames: #(name)
  classVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals.
true
%
category: 'creation'
classmethod: MyClass
new
  ^ super new initialize
%
category: 'accessing'
method: MyClass
name
  ^ name
%
method: MyClass
name: aString
  name := aString
%`;
    const session = createMockSession();
    const result = fileInClass(session, text);

    expect(result.success).toBe(true);
    expect(result.compiledClassDef).toBe(true);
    expect(result.compiledMethods).toBe(3);
    expect(result.deletedMethods).toBe(0);
    expect(queries.compileClassDefinition).toHaveBeenCalledTimes(1);
    expect(queries.compileMethod).toHaveBeenCalledTimes(3);
  });
});

describe('parseFileStructure', () => {
  it('parses class definition and methods with categories', () => {
    const text = `run
Object subclass: 'MyClass'
  instVarNames: #(name)
%
category: 'accessing'
method: MyClass
name
  ^ name
%
category: 'printing'
method: MyClass
printOn: aStream
  aStream nextPutAll: name
%`;
    const parsed = parseFileStructure(text);
    expect(parsed.classDef).toBeDefined();
    expect(parsed.classDef!.text).toContain("subclass: 'MyClass'");
    expect(parsed.methods).toHaveLength(2);
    expect(parsed.methods[0].key.selector).toBe('name');
    expect(parsed.methods[0].category).toBe('accessing');
    expect(parsed.methods[1].key.selector).toBe('printOn: aStream');
    expect(parsed.methods[1].category).toBe('printing');
  });

  it("reads Bob''s methods as one category, not as Bob", () => {
    // Topaz doubles an embedded quote. This reader, fileInClass and
    // parseTopazScript all go through parseCategoryDirective, so a category name
    // cannot mean one thing to the class mirror and another to File In.
    const text = `category: 'Bob''s methods'
method: MyClass
name
  ^ name
%`;
    expect(parseFileStructure(text).methods[0].category).toBe("Bob's methods");
  });

  it('distinguishes instance and class methods', () => {
    const text = `classmethod: MyClass
new
  ^ super new
%
method: MyClass
foo
  ^ 42
%`;
    const parsed = parseFileStructure(text);
    expect(parsed.methods).toHaveLength(2);
    expect(parsed.methods[0].key.isMeta).toBe(true);
    expect(parsed.methods[1].key.isMeta).toBe(false);
  });
});

describe('fileInChangedRegions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (queries.compileClassDefinition as ReturnType<typeof vi.fn>).mockImplementation(() => {});
    (queries.compileMethod as ReturnType<typeof vi.fn>).mockReturnValue(1000n);
    (queries.deleteMethod as ReturnType<typeof vi.fn>).mockImplementation(() => {});
  });

  it('falls back to full fileInClass when oldContent is undefined', () => {
    const text = `method: MyClass
foo
  ^ 42
%`;
    const session = createMockSession();
    const result = fileInChangedRegions(session, undefined, text);

    expect(result.success).toBe(true);
    expect(result.compiledMethods).toBe(1);
    expect(queries.compileMethod).toHaveBeenCalledTimes(1);
  });

  it('skips compilation when nothing changed', () => {
    const text = `category: 'accessing'
method: MyClass
name
  ^ name
%`;
    const session = createMockSession();
    const result = fileInChangedRegions(session, text, text);

    expect(result.success).toBe(true);
    expect(result.compiledMethods).toBe(0);
    expect(result.compiledClassDef).toBe(false);
    expect(queries.compileMethod).not.toHaveBeenCalled();
  });

  it('only compiles the changed method', () => {
    const oldText = `category: 'accessing'
method: MyClass
name
  ^ name
%
method: MyClass
age
  ^ age
%`;
    const newText = `category: 'accessing'
method: MyClass
name
  ^ name asUppercase
%
method: MyClass
age
  ^ age
%`;
    const session = createMockSession();
    const result = fileInChangedRegions(session, oldText, newText);

    expect(result.success).toBe(true);
    expect(result.compiledMethods).toBe(1);
    expect(queries.compileMethod).toHaveBeenCalledTimes(1);
    expect(queries.compileMethod).toHaveBeenCalledWith(
      session,
      'MyClass',
      false,
      'accessing',
      expect.stringContaining('asUppercase'),
      0,
    );
  });

  it('compiles method when category changes', () => {
    const oldText = `category: 'accessing'
method: MyClass
name
  ^ name
%`;
    const newText = `category: 'getters'
method: MyClass
name
  ^ name
%`;
    const session = createMockSession();
    const result = fileInChangedRegions(session, oldText, newText);

    expect(result.success).toBe(true);
    expect(result.compiledMethods).toBe(1);
    expect(queries.compileMethod).toHaveBeenCalledWith(
      session,
      'MyClass',
      false,
      'getters',
      expect.any(String),
      0,
    );
  });

  it('deletes methods removed from file when no errors', () => {
    const oldText = `category: 'accessing'
method: MyClass
name
  ^ name
%
method: MyClass
age
  ^ age
%`;
    const newText = `category: 'accessing'
method: MyClass
name
  ^ name
%`;
    const session = createMockSession();
    const result = fileInChangedRegions(session, oldText, newText);

    expect(result.success).toBe(true);
    expect(result.deletedMethods).toBe(1);
    expect(queries.deleteMethod).toHaveBeenCalledWith(session, 'MyClass', false, 'age');
  });

  it('does not delete methods when there are compilation errors', () => {
    (queries.compileMethod as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new BrowserQueryError('Syntax error', 1001);
    });

    const oldText = `category: 'accessing'
method: MyClass
name
  ^ name
%
method: MyClass
age
  ^ age
%`;
    // Change 'name' method (will fail) and remove 'age' method
    const newText = `category: 'accessing'
method: MyClass
name
  ^ 1 +
%`;
    const session = createMockSession();
    const result = fileInChangedRegions(session, oldText, newText);

    expect(result.success).toBe(false);
    expect(result.deletedMethods).toBe(0);
    expect(queries.deleteMethod).not.toHaveBeenCalled();
  });

  it('compiles new class definition when changed', () => {
    const oldText = `run
Object subclass: 'MyClass'
  instVarNames: #()
%`;
    const newText = `run
Object subclass: 'MyClass'
  instVarNames: #(name)
%`;
    const session = createMockSession();
    const result = fileInChangedRegions(session, oldText, newText);

    expect(result.success).toBe(true);
    expect(result.compiledClassDef).toBe(true);
    expect(queries.compileClassDefinition).toHaveBeenCalledTimes(1);
  });

  it('skips class definition when unchanged', () => {
    const classDef = `run
Object subclass: 'MyClass'
  instVarNames: #()
%`;
    const oldText = `${classDef}
method: MyClass
foo
  ^ 1
%`;
    const newText = `${classDef}
method: MyClass
foo
  ^ 2
%`;
    const session = createMockSession();
    fileInChangedRegions(session, oldText, newText);

    expect(queries.compileClassDefinition).not.toHaveBeenCalled();
  });
});
