import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpSession } from '../mcpSession';
import { registerTools } from '../tools';

function createMockSession(): McpSession {
  return {
    executeFetchString: vi.fn(() => ''),
    logout: vi.fn(),
  } as unknown as McpSession;
}

interface ToolRegistration {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (
    args: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}

function createMockServer() {
  const tools: ToolRegistration[] = [];
  return {
    tool: vi.fn(
      (
        name: string,
        description: string,
        schema: Record<string, unknown>,
        handler: ToolRegistration['handler'],
      ) => {
        tools.push({ name, description, schema, handler });
      },
    ),
    getTools: () => tools,
    getTool: (name: string) => tools.find((t) => t.name === name),
  };
}

describe('tools', () => {
  let session: McpSession;
  let server: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    session = createMockSession();
    server = createMockServer();
    registerTools(server as unknown as Parameters<typeof registerTools>[0], session);
  });

  it('registers all expected tools in alphabetical order', () => {
    const toolNames = server.getTools().map((t) => t.name);
    const expected = [
      'abort',
      'add_dictionary',
      'commit',
      'compile_class_definition',
      'compile_method',
      'compile_python',
      'delete_class',
      'delete_method',
      'describe_class',
      'describe_test_failure',
      'eval_python',
      'execute_code',
      'export_class_source',
      'find_implementors',
      'find_references_to',
      'find_senders',
      'get_class_definition',
      'get_class_hierarchy',
      'get_method_source',
      'list_all_classes',
      'list_classes',
      'list_dictionaries',
      'list_dictionary_entries',
      'list_failing_tests',
      'list_methods',
      'list_test_classes',
      'refresh',
      'remove_dictionary',
      'run_test_class',
      'run_test_method',
      'search_method_source',
      'set_class_comment',
      'status',
    ];
    expect(toolNames).toEqual(expected);
  });

  describe('execute_code', () => {
    it('executes Smalltalk code and returns result', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('7');
      const tool = server.getTool('execute_code')!;
      const result = await tool.handler({ code: '3 + 4' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('3 + 4');
      expect(code).toContain('printString');
      expect(result.content[0].text).toBe('7');
      expect(result.isError).toBeUndefined();
    });

    // Regression: the original wrapper was `(<code>) printString`, which only
    // accepts a single expression. A multi-statement body with temp
    // declarations like `| x | x := 42. x + 1` would error with
    // "expected start of a statement". Wrapping as a block (`[<code>] value`)
    // accepts both single expressions and statement sequences.
    it('block-wraps the code so multi-statement and temp-var bodies parse', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('43');
      const tool = server.getTool('execute_code')!;
      const result = await tool.handler({ code: '| x | x := 42. x + 1' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('[| x | x := 42. x + 1] value printString');
      expect(result.content[0].text).toBe('43');
    });

    // Stack-blowup guard: a runaway recursion in user code (e.g. dataclass
    // self-reference) shouldn't take the gem down. AlmostOutOfStack fires
    // before the hard overflow with ~30 frames of headroom; we catch it
    // with a minimal handler so the result is a clean string.
    it('wraps user code in an AlmostOutOfStack handler', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('ok');
      const tool = server.getTool('execute_code')!;
      await tool.handler({ code: '3 + 4' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('on: AlmostOutOfStack');
      expect(code).toContain('AlmostOutOfStack');
    });

    // Non-stack errors (DNU, ZeroDivide, etc.) still need to come back as a
    // diagnostic string rather than crashing the call.
    it('wraps user code in an AbstractException handler too', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('ok');
      const tool = server.getTool('execute_code')!;
      await tool.handler({ code: '3 + 4' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('on: AbstractException');
    });

    it('returns error on GCI failure', async () => {
      vi.mocked(session.executeFetchString).mockImplementation(() => {
        throw new Error('MessageNotUnderstood');
      });
      const tool = server.getTool('execute_code')!;
      const result = await tool.handler({ code: 'bad' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('MessageNotUnderstood');
    });
  });

  describe('get_class_definition', () => {
    it('fetches class definition using className definition', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Array subclass: ...');
      const tool = server.getTool('get_class_definition')!;
      const result = await tool.handler({ className: 'Array' });

      expect(session.executeFetchString).toHaveBeenCalledWith('Array definition');
      expect(result.content[0].text).toBe('Array subclass: ...');
    });
  });

  describe('get_method_source', () => {
    it('fetches instance-side method source', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('printOn: aStream ...');
      const tool = server.getTool('get_method_source')!;
      const result = await tool.handler({
        className: 'Array',
        isMeta: false,
        selector: 'printOn:',
      });

      expect(session.executeFetchString).toHaveBeenCalledWith(
        "(Array compiledMethodAt: #'printOn:') sourceString",
      );
      expect(result.content[0].text).toBe('printOn: aStream ...');
    });

    it('fetches class-side method source', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('new ...');
      const tool = server.getTool('get_method_source')!;
      await tool.handler({
        className: 'Array',
        isMeta: true,
        selector: 'new',
      });

      expect(session.executeFetchString).toHaveBeenCalledWith(
        "(Array class compiledMethodAt: #'new') sourceString",
      );
    });

    it('includes environmentId when specified', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('source');
      const tool = server.getTool('get_method_source')!;
      await tool.handler({
        className: 'Array',
        isMeta: false,
        selector: 'size',
        environmentId: 2,
      });

      expect(session.executeFetchString).toHaveBeenCalledWith(
        "(Array compiledMethodAt: #'size' environmentId: 2) sourceString",
      );
    });
  });

  describe('find_implementors', () => {
    it('calls ClassOrganizer implementorsOf:', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Globals\tArray\t0\tsize\taccessing\n');
      const tool = server.getTool('find_implementors')!;
      const result = await tool.handler({ selector: 'size' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("implementorsOf: #'size'");
      expect(result.content[0].text).toContain('Array');
    });

    // Round-2 change: with no environmentId, env 0 is searched first and
    // env 1 is tried as a fallback when env 0 is empty. The mock returns
    // empty for both, so the result is the combined "in environmentId 0
    // or 1" message and we observe both environmentIds in the executed
    // queries.
    it('auto-falls-back to env 1 when env 0 returns empty', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('find_implementors')!;
      const result = await tool.handler({ selector: 'nonexistent' });

      const calls = vi.mocked(session.executeFetchString).mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.includes('environmentId: 0'))).toBe(true);
      expect(calls.some((c) => c.includes('environmentId: 1'))).toBe(true);
      expect(result.content[0].text).toBe('No implementors found in environmentId 0 or 1.');
    });

    it('returns plain empty message when an explicit non-zero env is empty', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('find_implementors')!;
      const result = await tool.handler({ selector: 'nonexistent', environmentId: 1 });

      expect(result.content[0].text).toBe('No implementors found in environmentId 1.');
      // Explicit env scopes to that env only — no fallback path.
      expect(vi.mocked(session.executeFetchString).mock.calls).toHaveLength(1);
    });
  });

  describe('find_senders', () => {
    it('calls ClassOrganizer sendersOf:', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue(
        'Globals\tString\t0\tprintString\tprinting\n',
      );
      const tool = server.getTool('find_senders')!;
      const result = await tool.handler({ selector: 'printString' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("sendersOf: #'printString'");
      expect(result.content[0].text).toContain('String');
    });

    // Symmetric with find_implementors / find_references_to — uses the same
    // searchWithEnvFallback helper, so a refactor that breaks one would
    // silently break this without a guard.
    it('auto-falls-back to env 1 when env 0 returns empty', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('find_senders')!;
      const result = await tool.handler({ selector: 'nonexistent' });

      const calls = vi.mocked(session.executeFetchString).mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.includes('environmentId: 0'))).toBe(true);
      expect(calls.some((c) => c.includes('environmentId: 1'))).toBe(true);
      expect(result.content[0].text).toBe('No senders found in environmentId 0 or 1.');
    });
  });

  describe('get_class_hierarchy', () => {
    it('fetches superclasses and subclasses', async () => {
      const hierarchyResult =
        'Globals\tObject\tsuperclass\nGlobals\tCollection\tself\nGlobals\tBag\tsubclass\n';
      vi.mocked(session.executeFetchString).mockReturnValue(hierarchyResult);
      const tool = server.getTool('get_class_hierarchy')!;
      const result = await tool.handler({ className: 'Collection' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("objectNamed: #'Collection'");
      expect(result.content[0].text).toContain('Object');
      expect(result.content[0].text).toContain('Bag');
    });
  });

  describe('list_dictionaries', () => {
    it('returns dictionary names', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Globals\nUserGlobals\n');
      const tool = server.getTool('list_dictionaries')!;
      const result = await tool.handler({});

      expect(result.content[0].text).toBe('Globals\nUserGlobals');
    });
  });

  describe('add_dictionary', () => {
    it('creates a new SymbolDictionary and returns confirmation', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Added dictionary: MyDict');
      const result = await server.getTool('add_dictionary')!.handler({ dictionaryName: 'MyDict' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('SymbolDictionary new');
      expect(code).toContain("dict name: #'MyDict'");
      expect(result.content[0].text).toBe('Added dictionary: MyDict');
    });
  });

  describe('remove_dictionary', () => {
    it('removes by name and returns confirmation', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Removed dictionary: MyDict');
      const result = await server
        .getTool('remove_dictionary')!
        .handler({ dictionaryName: 'MyDict' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("objectNamed: #'MyDict'");
      expect(result.content[0].text).toBe('Removed dictionary: MyDict');
    });
  });

  describe('compile_class_definition', () => {
    it('evaluates the source and returns "Class: <name>"', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Foo');
      const result = await server.getTool('compile_class_definition')!.handler({
        source: "Object subclass: 'Foo' inDictionary: 'Globals'",
      });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("(Object subclass: 'Foo' inDictionary: 'Globals')");
      expect(result.content[0].text).toBe('Class: Foo');
    });
  });

  describe('delete_class', () => {
    it('scopes to the named dictionary', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Deleted class: Foo');
      const result = await server.getTool('delete_class')!.handler({
        className: 'Foo',
        dictionaryName: 'UserGlobals',
      });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("objectNamed: #'UserGlobals'");
      expect(code).toContain("removeKey: #'Foo'");
      expect(result.content[0].text).toBe('Deleted class: Foo');
    });
  });

  describe('delete_method', () => {
    it('removes the selector and returns confirmation', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Deleted: Array >> size');
      const result = await server.getTool('delete_method')!.handler({
        className: 'Array',
        isMeta: false,
        selector: 'size',
      });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("removeSelector: #'size'");
      expect(result.content[0].text).toBe('Deleted: Array >> size');
    });

    it('scopes to a dictionary when dictionaryName is given', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      await server.getTool('delete_method')!.handler({
        className: 'Foo',
        isMeta: false,
        selector: 'bar',
        dictionaryName: 'UserGlobals',
      });
      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("objectNamed: #'UserGlobals'");
    });
  });

  describe('set_class_comment', () => {
    it('sets the comment via the shared query', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Comment set: Foo');
      const result = await server.getTool('set_class_comment')!.handler({
        className: 'Foo',
        comment: 'hi',
      });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("cls comment: 'hi'");
      expect(result.content[0].text).toBe('Comment set: Foo');
    });
  });

  describe('describe_class', () => {
    it('defaults to first-match objectNamed: lookup', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue(
        '=== Definition ===\nObject subclass: #Foo\n',
      );
      const tool = server.getTool('describe_class')!;
      const result = await tool.handler({ className: 'Foo' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("objectNamed: #'Foo'");
      expect(code).toContain('=== Instance methods ===');
      expect(result.content[0].text).toContain('=== Definition ===');
    });

    it('scopes to a specific dictionary when dictionaryName is given', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('describe_class')!;
      await tool.handler({ className: 'Customer', dictionaryName: 'UserGlobals' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("objectNamed: #'UserGlobals'");
      expect(code).toContain("at: #'Customer' ifAbsent: [nil]");
    });
  });

  describe('export_class_source', () => {
    it('defaults to first-match objectNamed: lookup', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue("! Class\nObject subclass: 'Foo'\n");
      const tool = server.getTool('export_class_source')!;
      const result = await tool.handler({ className: 'Foo' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("objectNamed: #'Foo'");
      expect(code).toContain('fileOutClass');
      expect(result.content[0].text).toContain('Object subclass');
    });

    it('scopes to a specific dictionary when dictionaryName is given', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('export_class_source')!;
      await tool.handler({ className: 'Customer', dictionaryName: 'UserGlobals' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("objectNamed: #'UserGlobals'");
      expect(code).toContain("at: #'Customer' ifAbsent: [nil]");
    });
  });

  describe('find_references_to', () => {
    it('calls ClassOrganizer referencesToObject: with objectNamed: lookup', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Globals\tFoo\t0\tuse\tclient\n');
      const tool = server.getTool('find_references_to')!;
      const result = await tool.handler({ objectName: 'AllUsers' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('referencesToObject:');
      expect(code).toContain("objectNamed: #'AllUsers'");
      expect(result.content[0].text).toContain('Foo\tinstance\tuse\tclient');
    });

    it('auto-falls-back to env 1 when env 0 returns empty', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('find_references_to')!;
      const result = await tool.handler({ objectName: 'Unused' });

      const calls = vi.mocked(session.executeFetchString).mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.includes('environmentId: 0'))).toBe(true);
      expect(calls.some((c) => c.includes('environmentId: 1'))).toBe(true);
      expect(result.content[0].text).toBe('No references found in environmentId 0 or 1.');
    });
  });

  describe('list_all_classes', () => {
    it('emits dictIndex, dictName, className rows', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue(
        '1\tGlobals\tArray\n2\tUserGlobals\tMyClass\n',
      );
      const tool = server.getTool('list_all_classes')!;
      const result = await tool.handler({});

      expect(result.content[0].text).toBe('1\tGlobals\tArray\n2\tUserGlobals\tMyClass');
    });
  });

  describe('list_dictionary_entries', () => {
    it('emits kind, category, name rows for classes and globals', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('1\taccessing\tArray\n0\t\tMyVar\n');
      const tool = server.getTool('list_dictionary_entries')!;
      const result = await tool.handler({ dictionaryName: 'Globals' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("objectNamed: #'Globals'");
      expect(result.content[0].text).toBe('class\taccessing\tArray\nglobal\t\tMyVar');
    });

    it('reports empty/missing dictionary with a friendly message', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('list_dictionary_entries')!;
      const result = await tool.handler({ dictionaryName: 'NoSuchDict' });

      expect(result.content[0].text).toBe('Dictionary not found or empty: NoSuchDict');
    });
  });

  describe('list_classes', () => {
    it('lists classes in a dictionary by name', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Array\nString\n');
      const tool = server.getTool('list_classes')!;
      const result = await tool.handler({ dictionaryName: 'Globals' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("objectNamed: #'Globals'");
      expect(result.content[0].text).toBe('Array\nString');
    });

    it('escapes single quotes in dictionary name', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('list_classes')!;
      await tool.handler({ dictionaryName: "it's" });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("it''s");
    });

    it('reports empty/missing dictionary with a friendly message', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('list_classes')!;
      const result = await tool.handler({ dictionaryName: 'NoSuchDict' });

      expect(result.content[0].text).toBe('Dictionary not found or empty: NoSuchDict');
    });
  });

  describe('list_methods', () => {
    it('lists methods grouped by side and category', async () => {
      const methodList = 'instance\taccessing\tsize\nclass\tcreation\tnew\n';
      vi.mocked(session.executeFetchString).mockReturnValue(methodList);
      const tool = server.getTool('list_methods')!;
      const result = await tool.handler({ className: 'Array' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('Array');
      expect(code).toContain('categoryNames');
      expect(result.content[0].text).toContain('size');
      expect(result.content[0].text).toContain('new');
    });
  });

  describe('compile_method', () => {
    it('compiles an instance-side method', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Compiled successfully: Array >> size');
      const tool = server.getTool('compile_method')!;
      const result = await tool.handler({
        className: 'Array',
        isMeta: false,
        category: 'accessing',
        source: 'size\n  ^ self basicSize',
      });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('Array');
      expect(code).toContain('compileMethod:');
      expect(code).toContain('size');
      expect(code).toContain('accessing');
      expect(result.content[0].text).toContain('Compiled successfully');
    });

    it('compiles a class-side method (target := base class in the shared Smalltalk)', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Compiled');
      const tool = server.getTool('compile_method')!;
      await tool.handler({
        className: 'Array',
        isMeta: true,
        category: 'creation',
        source: 'withAll: aCollection\n  ^ self new addAll: aCollection; yourself',
      });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('target := base class');
    });

    it('escapes single quotes in source', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Compiled');
      const tool = server.getTool('compile_method')!;
      await tool.handler({
        className: 'MyClass',
        isMeta: false,
        category: 'test',
        source: "greeting\n  ^ 'Hello'",
      });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("''Hello''");
    });

    it('returns error on compile failure', async () => {
      vi.mocked(session.executeFetchString).mockImplementation(() => {
        throw new Error('Compile error: undefined variable x');
      });
      const tool = server.getTool('compile_method')!;
      const result = await tool.handler({
        className: 'Array',
        isMeta: false,
        category: 'test',
        source: 'bad\n  ^ x',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Compile error');
    });
  });

  describe('abort', () => {
    it('aborts the transaction', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Transaction aborted');
      const tool = server.getTool('abort')!;
      const result = await tool.handler({});

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('abortTransaction');
      expect(result.content[0].text).toBe('Transaction aborted');
    });
  });

  describe('commit', () => {
    it('commits the transaction', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('Transaction committed');
      const tool = server.getTool('commit')!;
      const result = await tool.handler({});

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('commitTransaction');
      expect(result.content[0].text).toBe('Transaction committed');
    });

    it('reports commit failure', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue(
        'Commit failed — possible conflict. Use abort to reset, then retry.',
      );
      const tool = server.getTool('commit')!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Commit failed');
    });
  });

  describe('search_method_source', () => {
    it('searches method source for a substring', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue(
        'Globals\tArray\t0\tprintOn:\tprinting\n',
      );
      const tool = server.getTool('search_method_source')!;
      const result = await tool.handler({ term: 'printString' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("substringSearch: 'printString'");
      expect(code).toContain('ignoreCase: true');
      expect(result.content[0].text).toContain('Array');
    });

    it('supports case-sensitive search', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('search_method_source')!;
      await tool.handler({ term: 'Foo', ignoreCase: false });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('ignoreCase: false');
    });

    it('returns fallback when no matches found', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('search_method_source')!;
      const result = await tool.handler({ term: 'xyznonexistent' });

      expect(result.content[0].text).toBe('No matches found.');
    });
  });

  describe('run_test_method', () => {
    it('runs a passing test and formats the result', async () => {
      // Shared query parses structured tab-separated output from Smalltalk
      vi.mocked(session.executeFetchString).mockReturnValue('passed\t\t12');
      const tool = server.getTool('run_test_method')!;
      const result = await tool.handler({ className: 'ArrayTest', selector: 'testSize' });

      // The actual run_test_method query should follow the auto-refresh call.
      const code = vi.mocked(session.executeFetchString).mock.calls.at(-1)![0];
      expect(code).toContain('ArrayTest');
      expect(code).toContain("selector: #'testSize'");
      expect(result.content[0].text).toContain('PASSED');
      expect(result.content[0].text).toContain('12ms');
    });

    it('returns failure details', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('failed\texpected 3 got 4\t5');
      const tool = server.getTool('run_test_method')!;
      const result = await tool.handler({ className: 'ArrayTest', selector: 'testBad' });

      expect(result.content[0].text).toContain('FAILED');
      expect(result.content[0].text).toContain('expected 3 got 4');
    });

    // Stale-transaction guard: the GCI pins read views to the session's
    // transaction snapshot, so a commit landed by another process (e.g.
    // install.sh) is invisible until this session aborts. Auto-refresh-if-clean
    // closes the gap silently when there's no uncommitted work to lose.
    it('issues an auto-refresh-if-clean before running the test', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('passed\t\t1');
      const tool = server.getTool('run_test_method')!;
      await tool.handler({ className: 'ArrayTest', selector: 'testSize' });

      const refreshCall = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(refreshCall).toContain('System needsCommit ifFalse:');
      expect(refreshCall).toContain('System abortTransaction');
    });
  });

  describe('run_test_class', () => {
    it('runs all tests in a class and returns formatted results', async () => {
      const output =
        'ArrayTest\ttestSize\tpassed\t\nArrayTest\ttestAt\tpassed\t\nArrayTest\ttestAdd\tpassed\t\n';
      vi.mocked(session.executeFetchString).mockReturnValue(output);
      const tool = server.getTool('run_test_class')!;
      const result = await tool.handler({ className: 'ArrayTest' });

      const code = vi.mocked(session.executeFetchString).mock.calls.at(-1)![0];
      expect(code).toContain('ArrayTest');
      expect(code).toContain('suite');
      expect(result.content[0].text).toContain('testSize');
      expect(result.content[0].text).toContain('PASSED');
    });

    it('reports failures and errors', async () => {
      const output = 'MyTest\ttestGood\tpassed\t\nMyTest\ttestBad\tfailed\texpected 1 got 2\n';
      vi.mocked(session.executeFetchString).mockReturnValue(output);
      const tool = server.getTool('run_test_class')!;
      const result = await tool.handler({ className: 'MyTest' });

      expect(result.content[0].text).toContain('FAILED');
      expect(result.content[0].text).toContain('expected 1 got 2');
    });

    it('issues an auto-refresh-if-clean before running the suite', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('run_test_class')!;
      await tool.handler({ className: 'ArrayTest' });

      const refreshCall = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(refreshCall).toContain('System needsCommit ifFalse:');
      expect(refreshCall).toContain('System abortTransaction');
    });
  });

  describe('eval_python', () => {
    it('runs the Grail eval pipeline via objectNamed: ModuleAst', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('3');
      const result = await server.getTool('eval_python')!.handler({ source: '1 + 2' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain("objectNamed: #'ModuleAst'");
      expect(code).toContain('evaluateSource: src');
      expect(result.content[0].text).toBe('3');
    });

    // When Grail isn't loaded the snippet's nil-branch produces the hint as
    // its result. The tool should pass it through verbatim — no special
    // error handling at the JS layer, just the agent-readable text.
    it('passes the "Grail not detected" hint through as the result text', async () => {
      const hint =
        'Grail (GemStone-Python) not detected: class ModuleAst not found in symbolList. ' +
        'Install Grail or activate it in this session before using the python tools.';
      vi.mocked(session.executeFetchString).mockReturnValue(hint);
      const result = await server.getTool('eval_python')!.handler({ source: 'x = 1' });

      expect(result.content[0].text).toContain('Grail (GemStone-Python) not detected');
      expect(result.isError).toBeUndefined();
    });
  });

  describe('compile_python', () => {
    it('runs the Grail transpile pipeline (parseSource + smalltalkSource)', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('x := 1');
      const result = await server.getTool('compile_python')!.handler({ source: 'x = 1' });

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('parseSource: src');
      expect(code).toContain('smalltalkSource');
      expect(result.content[0].text).toBe('x := 1');
    });
  });

  describe('describe_test_failure', () => {
    // For TestFailure (assertion failure) — should produce structured output
    // that names the exception class and the assertion's clean messageText
    // (which is "Assertion failed", separate from the printString blob the
    // old runTestMethod tool returned).
    it('formats TestFailure output with exceptionClass + messageText', async () => {
      vi.mocked(session.executeFetchString)
        .mockReturnValueOnce('ok') // refreshIfClean
        .mockReturnValueOnce(
          'status: failed\n' +
            'exceptionClass: TestFailure\n' +
            'errorNumber: 2751\n' +
            'messageText: Assertion failed\n' +
            'description: TestFailure: Assertion failed\n',
        );
      const tool = server.getTool('describe_test_failure')!;
      const result = await tool.handler({ className: 'ArrayTest', selector: 'testBad' });

      expect(result.content[0].text).toContain('status: failed');
      expect(result.content[0].text).toContain('exceptionClass: TestFailure');
      expect(result.content[0].text).toContain('errorNumber: 2751');
      expect(result.content[0].text).toContain('messageText: Assertion failed');
    });

    // For MessageNotUnderstood — must surface mnuReceiver and mnuSelector,
    // the highest-signal fields for diagnosing "missing method" errors.
    it('includes mnuReceiver and mnuSelector on MessageNotUnderstood', async () => {
      vi.mocked(session.executeFetchString)
        .mockReturnValueOnce('ok')
        .mockReturnValueOnce(
          'status: error\n' +
            'exceptionClass: MessageNotUnderstood\n' +
            'errorNumber: 2010\n' +
            'messageText: a Object class does not understand #foo\n' +
            'description: a Object class does not understand #foo\n' +
            'mnuReceiver: Object\n' +
            'mnuSelector: foo\n',
        );
      const tool = server.getTool('describe_test_failure')!;
      const result = await tool.handler({ className: 'ArrayTest', selector: 'testErrors' });

      expect(result.content[0].text).toContain('exceptionClass: MessageNotUnderstood');
      expect(result.content[0].text).toContain('mnuReceiver: Object');
      expect(result.content[0].text).toContain('mnuSelector: foo');
    });

    it('returns "PASSED" when the test re-run actually passed', async () => {
      vi.mocked(session.executeFetchString)
        .mockReturnValueOnce('ok')
        .mockReturnValueOnce('status: passed\n');
      const tool = server.getTool('describe_test_failure')!;
      const result = await tool.handler({ className: 'ArrayTest', selector: 'testGood' });

      expect(result.content[0].text).toBe('PASSED');
    });

    // Stack trace flows end to end: Smalltalk emits the sentinel + frames,
    // the parser splits on the sentinel, the formatter emits a "stackReport:"
    // header followed by the verbatim multi-line content. Frame newlines
    // must survive the round-trip.
    it('formats stackReport as a verbatim multi-line block under a header', async () => {
      vi.mocked(session.executeFetchString)
        .mockReturnValueOnce('ok')
        .mockReturnValueOnce(
          'status: failed\n' +
            'exceptionClass: TestFailure\n' +
            'errorNumber: 2751\n' +
            'messageText: Assertion failed\n' +
            'description: TestFailure: Assertion failed\n' +
            '--- stackReport ---\n' +
            'TestFailure (AbstractException) >> signal: @3 line 7  [GsNMethod 3523841]\n' +
            'JasperProbeTest >> testFails @3 line 1  [GsNMethod 1236251649]\n',
        );
      const tool = server.getTool('describe_test_failure')!;
      const result = await tool.handler({ className: 'ArrayTest', selector: 'testBad' });
      const text = result.content[0].text;

      expect(text).toContain('stackReport:');
      expect(text).toContain('TestFailure (AbstractException) >> signal:');
      expect(text).toContain('JasperProbeTest >> testFails');
      // Two frames separated by a newline must remain so.
      expect(text.match(/\n/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    });

    it('issues the gem-config toggle that enables stack capture', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('status: passed\n');
      const tool = server.getTool('describe_test_failure')!;
      await tool.handler({ className: 'ArrayTest', selector: 'testAny' });

      const queryCall = vi.mocked(session.executeFetchString).mock.calls.at(-1)![0];
      expect(queryCall).toContain('GemExceptionSignalCapturesStack');
      expect(queryCall).toContain('put: true');
      expect(queryCall).toContain('put: oldStackCfg');
      expect(queryCall).toContain('ensure:');
    });

    // Stale-transaction guard — same as the other test runners. A view
    // pinned to old committed state would let an agent debug a failure
    // that's already been fixed in the running stone.
    it('issues an auto-refresh-if-clean before re-running the test', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('status: passed\n');
      const tool = server.getTool('describe_test_failure')!;
      await tool.handler({ className: 'ArrayTest', selector: 'testAny' });

      const refreshCall = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(refreshCall).toContain('System needsCommit ifFalse:');
      expect(refreshCall).toContain('System abortTransaction');
    });

    // The Smalltalk side has to use AbstractException (not Exception) —
    // GemStone's exception hierarchy makes Exception a subclass, and
    // MessageNotUnderstood escapes past Exception in some contexts. Lock
    // this in so a future "simplification" doesn't regress to Exception
    // and silently swallow MNUs.
    it('catches AbstractException, not Exception (so MNUs do not escape)', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('status: passed\n');
      const tool = server.getTool('describe_test_failure')!;
      await tool.handler({ className: 'ArrayTest', selector: 'testAny' });

      const queryCall = vi.mocked(session.executeFetchString).mock.calls.at(-1)![0];
      expect(queryCall).toContain('on: AbstractException');
      expect(queryCall).not.toMatch(/on: Exception\b/);
    });

    // SUnit's framework swallows the exception — we have to bypass it.
    // The query must run setUp/perform/tearDown manually rather than
    // calling tc>>run.
    it('bypasses TestCase>>run by invoking setUp / perform / tearDown directly', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('status: passed\n');
      const tool = server.getTool('describe_test_failure')!;
      await tool.handler({ className: 'ArrayTest', selector: 'testAny' });

      const queryCall = vi.mocked(session.executeFetchString).mock.calls.at(-1)![0];
      expect(queryCall).toContain('tc setUp');
      expect(queryCall).toContain('tc perform:');
      expect(queryCall).toContain('tc tearDown');
    });
  });

  describe('list_failing_tests', () => {
    // The agent equivalent of `./run_tests.sh | grep failures`. Single
    // round-trip: iteration runs in Smalltalk so an N-class invocation is
    // one GCI call, not N. Auto-refresh-if-clean ensures results reflect
    // committed state.
    it('returns "All tests passed." when nothing failed', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('list_failing_tests')!;
      const result = await tool.handler({});

      expect(result.content[0].text).toBe('All tests passed.');
    });

    it('formats failures as STATUS\\tclass\\tselector\\tmessage', async () => {
      vi.mocked(session.executeFetchString)
        .mockReturnValueOnce('ok') // refreshIfClean response
        .mockReturnValueOnce(
          'MyTest\ttestBad\tfailed\texpected 1 got 2\nOther\ttestBoom\terror\tdivision by zero\n',
        );
      const tool = server.getTool('list_failing_tests')!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('FAILED\tMyTest\ttestBad\texpected 1 got 2');
      expect(result.content[0].text).toContain('ERROR\tOther\ttestBoom\tdivision by zero');
    });

    it('passes explicit classNames to the underlying query', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('list_failing_tests')!;
      await tool.handler({ classNames: ['ArrayTest', 'StringTest'] });

      // The query call (non-refresh one) must reference each requested name.
      const queryCall = vi.mocked(session.executeFetchString).mock.calls.at(-1)![0];
      expect(queryCall).toContain("objectNamed: #'ArrayTest'");
      expect(queryCall).toContain("objectNamed: #'StringTest'");
    });

    it('issues an auto-refresh-if-clean before the suite runs', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('list_failing_tests')!;
      await tool.handler({});

      const refreshCall = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(refreshCall).toContain('System needsCommit ifFalse:');
      expect(refreshCall).toContain('System abortTransaction');
    });
  });

  describe('list_test_classes', () => {
    it('returns dictName\\tclassName rows', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue(
        'UserGlobals\tArrayTest\nUserGlobals\tStringTest\n',
      );
      const tool = server.getTool('list_test_classes')!;
      const result = await tool.handler({});

      expect(result.content[0].text).toBe('UserGlobals\tArrayTest\nUserGlobals\tStringTest');
    });

    it('returns a friendly message when no TestCase subclasses are found', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('list_test_classes')!;
      const result = await tool.handler({});

      expect(result.content[0].text).toBe('No TestCase subclasses found.');
    });
  });

  describe('refresh', () => {
    it('refreshes the session view when no uncommitted changes are pending', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('refreshed');
      const tool = server.getTool('refresh')!;
      const result = await tool.handler({});

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('System needsCommit');
      expect(code).toContain('System abortTransaction');
      expect(result.content[0].text).toBe('refreshed');
    });

    it('skips when there are uncommitted changes, reporting back', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('skipped: uncommitted changes present');
      const tool = server.getTool('refresh')!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('skipped');
      expect(result.content[0].text).toContain('uncommitted changes');
    });
  });

  describe('status', () => {
    it('reports session information', async () => {
      const statusOutput =
        'User: DataCurator\nStone: gs64stone\nSession ID: 1\nTransaction: active\nUncommitted changes: no\nView: refreshed\n';
      vi.mocked(session.executeFetchString).mockReturnValue(statusOutput);
      const tool = server.getTool('status')!;
      const result = await tool.handler({});

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('myUserProfile');
      expect(code).toContain('stoneName');
      expect(code).toContain('inTransaction');
      expect(code).toContain('needsCommit');
      expect(result.content[0].text).toContain('DataCurator');
      expect(result.content[0].text).toContain('gs64stone');
    });

    // The snippet must auto-refresh-if-clean inline so the rest of the report
    // reflects committed state, and so a single status call also primes the
    // session for follow-up read tools. Skipping when needsCommit is true is
    // load-bearing: discarding uncommitted work silently would be far worse
    // than reporting slightly stale state.
    it('auto-refreshes the view inline (only when no uncommitted changes)', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('status')!;
      await tool.handler({});

      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];
      expect(code).toContain('System needsCommit');
      expect(code).toContain('System abortTransaction');
      expect(code).toContain('View: ');
      expect(code).toContain('stale');
      expect(code).toContain('refreshed');
    });

    // Regression: nextPutAll: sends do: to its argument. If any value passed
    // is a SmallInteger (as System stoneVersionReport was observed returning),
    // GemStone raises "SmallInteger does not understand #do:". Every value
    // must be coerced to a CharacterCollection first.
    it('coerces every streamed value to a CharacterCollection', async () => {
      vi.mocked(session.executeFetchString).mockReturnValue('');
      const tool = server.getTool('status')!;
      await tool.handler({});
      const code = vi.mocked(session.executeFetchString).mock.calls[0][0];

      // Each System-call result must be wrapped in asString or printString
      // so a non-String return (SmallInteger, Array, ...) doesn't blow up.
      expect(code).toMatch(/myUserProfile userId (asString|printString)/);
      expect(code).toMatch(/stoneName (asString|printString)/);
      expect(code).toMatch(/session printString/);
      expect(code).toContain('needsCommit');
      // stoneVersionReport returned a SmallInteger in 3.7.x (SmallInteger DNU
      // do:); modifiedObjects isn't defined on System class in that version
      // (System class DNU #modifiedObjects). Neither should be re-introduced.
      expect(code).not.toContain('stoneVersionReport');
      expect(code).not.toContain('modifiedObjects');
    });
  });
});
