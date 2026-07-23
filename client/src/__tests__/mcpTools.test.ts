import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));
// browserQueries imports sessionManager (vscode) and gciLog (vscode).
// The vscode mock covers that; we mock the specific query functions we rely on.
vi.mock('../browserQueries', () => ({
  executeFetchString: vi.fn(() => ''),
  implementorsOf: vi.fn(() => [] as unknown[]),
  sendersOf: vi.fn(() => [] as unknown[]),
  referencesToObject: vi.fn(() => [] as unknown[]),
  getClassDefinition: vi.fn(() => ''),
  getClassHierarchy: vi.fn(() => [] as unknown[]),
  getMethodSource: vi.fn(() => ''),
  getMethodList: vi.fn(() => [] as unknown[]),
  getDictionaryNames: vi.fn(() => [] as string[]),
  getClassNames: vi.fn(() => [] as string[]),
  getDictionaryEntries: vi.fn(() => [] as unknown[]),
  getAllClassNames: vi.fn(() => [] as unknown[]),
  searchMethodSource: vi.fn(() => [] as unknown[]),
  describeClass: vi.fn(() => ''),
  fileOutClass: vi.fn(() => ''),
  compileMethod: vi.fn(() => ''),
  compileClassDefinition: vi.fn(() => ''),
  setClassComment: vi.fn(() => ''),
  deleteMethod: vi.fn(() => ''),
  deleteClass: vi.fn(() => ''),
  addDictionary: vi.fn(() => ''),
  removeDictionary: vi.fn(() => ''),
  BrowserQueryError: class BrowserQueryError extends Error {
    gciErrorNumber: number;
    constructor(msg: string, num = 0) {
      super(msg);
      this.gciErrorNumber = num;
    }
  },
}));
vi.mock('../sunitQueries', () => ({
  runTestMethod: vi.fn(() => ({
    className: '',
    selector: '',
    status: 'passed',
    message: '',
    durationMs: 0,
  })),
  runTestClass: vi.fn(() => []),
  runFailingTests: vi.fn(() => []),
  discoverTestClasses: vi.fn(() => [] as Array<{ dictName: string; className: string }>),
  describeTestFailure: vi.fn(() => ({ status: 'passed' })),
  SunitQueryError: class SunitQueryError extends Error {
    gciErrorNumber: number;
    constructor(msg: string, num = 0) {
      super(msg);
      this.gciErrorNumber = num;
    }
  },
}));
vi.mock('../pythonQueries', () => ({
  evalPython: vi.fn(() => ''),
  compilePython: vi.fn(() => ''),
}));

import * as queries from '../browserQueries';
import * as sunit from '../sunitQueries';
import * as python from '../pythonQueries';
import { registerMcpTools } from '../mcpTools';
import { ActiveSession } from '../sessionManager';

interface ToolRegistration {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
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
    getTool: (name: string) => tools.find((t) => t.name === name),
    getToolNames: () => tools.map((t) => t.name),
  };
}

function makeSession(): ActiveSession {
  return {
    id: 1,
    gci: {} as ActiveSession['gci'],
    handle: {},
    login: { label: 'DataCurator on gs64stone (localhost)' } as ActiveSession['login'],
    stoneVersion: '3.7.4',
  };
}

describe('registerMcpTools', () => {
  let server: ReturnType<typeof createMockServer>;
  let session: ActiveSession | undefined;

  beforeEach(() => {
    server = createMockServer();
    session = makeSession();
    registerMcpTools(server as unknown as Parameters<typeof registerMcpTools>[0], () => session);
    vi.clearAllMocks();
  });

  it('registers the expected tools in alphabetical order', () => {
    const names = server.getToolNames();
    expect(names).toEqual([
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
    ]);
  });

  describe('without an active session', () => {
    beforeEach(() => {
      session = undefined;
    });

    it('execute_code returns an error response', async () => {
      const result = await server.getTool('execute_code')!.handler({ code: '42' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/No active GemStone session/);
      expect(queries.executeFetchString).not.toHaveBeenCalled();
    });

    it('get_class_definition returns an error response', async () => {
      const result = await server.getTool('get_class_definition')!.handler({ className: 'Array' });
      expect(result.isError).toBe(true);
      expect(queries.getClassDefinition).not.toHaveBeenCalled();
    });

    it('abort returns an error response', async () => {
      const result = await server.getTool('abort')!.handler({});
      expect(result.isError).toBe(true);
      expect(queries.executeFetchString).not.toHaveBeenCalled();
    });
  });

  describe('with an active session', () => {
    it('execute_code wraps the code with printString', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('42');
      const result = await server.getTool('execute_code')!.handler({ code: '6 * 7' });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe('42');
      const codeArg = vi.mocked(queries.executeFetchString).mock.calls[0][1];
      expect(codeArg).toContain('6 * 7');
      expect(codeArg).toContain('printString');
    });

    // Regression: the original wrapper was `(<code>) printString`, which only
    // accepts a single expression. Multi-statement bodies with temp
    // declarations (`| x | x := 42. x + 1`) errored with "expected start of a
    // statement". Block-wrap accepts both shapes.
    it('execute_code block-wraps the input so multi-statement bodies parse', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('43');
      await server.getTool('execute_code')!.handler({ code: '| x | x := 42. x + 1' });

      const codeArg = vi.mocked(queries.executeFetchString).mock.calls[0][1];
      expect(codeArg).toContain('[| x | x := 42. x + 1] value printString');
    });

    // Stack-blowup guard: user code recursing past the stack limit (e.g.
    // dataclass self-reference) used to take the gem down. AlmostOutOfStack
    // is signaled with ~30 frames of headroom — a minimal handler unwinds
    // cleanly and returns a string the agent can read.
    it('execute_code wraps user code with an AlmostOutOfStack handler', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('ok');
      await server.getTool('execute_code')!.handler({ code: '1 + 1' });

      const codeArg = vi.mocked(queries.executeFetchString).mock.calls[0][1];
      expect(codeArg).toContain('on: AlmostOutOfStack');
    });

    it('execute_code wraps user code with an AbstractException handler', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('ok');
      await server.getTool('execute_code')!.handler({ code: '1 + 1' });

      const codeArg = vi.mocked(queries.executeFetchString).mock.calls[0][1];
      expect(codeArg).toContain('on: AbstractException');
    });

    it('get_class_definition delegates to queries.getClassDefinition', async () => {
      vi.mocked(queries.getClassDefinition).mockReturnValue('Array definition');
      const result = await server.getTool('get_class_definition')!.handler({ className: 'Array' });

      expect(queries.getClassDefinition).toHaveBeenCalledWith(session, 'Array');
      expect(result.content[0].text).toBe('Array definition');
    });

    it('find_implementors formats results as tab-separated lines', async () => {
      vi.mocked(queries.implementorsOf).mockReturnValue([
        {
          dictName: 'Globals',
          className: 'Array',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
        },
      ]);
      const result = await server.getTool('find_implementors')!.handler({ selector: 'size' });

      expect(queries.implementorsOf).toHaveBeenCalledWith(session, 'size', 0);
      expect(result.content[0].text).toContain('Globals\tArray\tinstance\tsize\taccessing');
    });

    // Default behavior (no environmentId) auto-falls-back to env 1 when env 0
    // is empty. The Python-heavy projects that drove this change have most
    // user code in env 1; the env-0-only default left agents staring at
    // "No implementors found" when the method existed all along.
    it('find_implementors auto-falls-back to env 1 when env 0 returns empty', async () => {
      vi.mocked(queries.implementorsOf).mockReturnValue([]);
      const result = await server.getTool('find_implementors')!.handler({ selector: 'xyz' });

      // Both envs were tried — env 0 first, then env 1 as fallback.
      expect(queries.implementorsOf).toHaveBeenCalledWith(session, 'xyz', 0);
      expect(queries.implementorsOf).toHaveBeenCalledWith(session, 'xyz', 1);
      expect(result.content[0].text).toBe('No implementors found in environmentId 0 or 1.');
    });

    it('find_implementors short-circuits when env 0 has results (no env-1 call)', async () => {
      vi.mocked(queries.implementorsOf).mockReturnValueOnce([
        {
          dictName: 'Globals',
          className: 'Array',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
        },
      ]);
      await server.getTool('find_implementors')!.handler({ selector: 'size' });

      // Only env 0 was searched — env 1 isn't a fallback when env 0 has results.
      expect(queries.implementorsOf).toHaveBeenCalledTimes(1);
      expect(queries.implementorsOf).toHaveBeenCalledWith(session, 'size', 0);
    });

    it('find_implementors gives a plain empty message when an explicit non-zero env is empty', async () => {
      vi.mocked(queries.implementorsOf).mockReturnValue([]);
      const result = await server
        .getTool('find_implementors')!
        .handler({ selector: 'xyz', environmentId: 1 });

      // Explicit env scopes to that env only — no fallback path.
      expect(queries.implementorsOf).toHaveBeenCalledTimes(1);
      expect(queries.implementorsOf).toHaveBeenCalledWith(session, 'xyz', 1);
      expect(result.content[0].text).toBe('No implementors found in environmentId 1.');
    });

    it('list_classes delegates to getClassNames with the dictionary name', async () => {
      vi.mocked(queries.getClassNames).mockReturnValue(['Array', 'String']);
      const result = await server
        .getTool('list_classes')!
        .handler({ dictionaryName: 'UserGlobals' });

      expect(queries.getClassNames).toHaveBeenCalledWith(session, 'UserGlobals');
      expect(result.content[0].text).toBe('Array\nString');
    });

    it('describe_class passes through the combined text and forwards dictionaryName', async () => {
      vi.mocked(queries.describeClass).mockReturnValue(
        '=== Definition ===\nObject subclass: #Foo\n',
      );
      const result = await server.getTool('describe_class')!.handler({ className: 'Foo' });

      expect(queries.describeClass).toHaveBeenCalledWith(session, 'Foo', undefined);
      expect(result.content[0].text).toContain('=== Definition ===');
    });

    it('describe_class scopes to a specific dictionary when provided', async () => {
      vi.mocked(queries.describeClass).mockReturnValue('');
      await server.getTool('describe_class')!.handler({
        className: 'Customer',
        dictionaryName: 'UserGlobals',
      });

      expect(queries.describeClass).toHaveBeenCalledWith(session, 'Customer', 'UserGlobals');
    });

    it('export_class_source delegates to fileOutClass', async () => {
      vi.mocked(queries.fileOutClass).mockReturnValue('! file-out source');
      const result = await server.getTool('export_class_source')!.handler({ className: 'Foo' });

      expect(queries.fileOutClass).toHaveBeenCalledWith(session, 'Foo', undefined);
      expect(result.content[0].text).toBe('! file-out source');
    });

    it('export_class_source scopes to a specific dictionary when provided', async () => {
      vi.mocked(queries.fileOutClass).mockReturnValue('');
      await server.getTool('export_class_source')!.handler({
        className: 'Customer',
        dictionaryName: 'UserGlobals',
      });

      expect(queries.fileOutClass).toHaveBeenCalledWith(session, 'Customer', 'UserGlobals');
    });

    it('find_references_to formats results and defaults environmentId to 0', async () => {
      vi.mocked(queries.referencesToObject).mockReturnValue([
        {
          dictName: 'Globals',
          className: 'Foo',
          isMeta: false,
          selector: 'use',
          category: 'client',
        },
      ]);
      const result = await server
        .getTool('find_references_to')!
        .handler({ objectName: 'AllUsers' });

      expect(queries.referencesToObject).toHaveBeenCalledWith(session, 'AllUsers', 0);
      expect(result.content[0].text).toContain('Globals\tFoo\tinstance\tuse\tclient');
    });

    it('find_references_to auto-falls-back to env 1 when env 0 returns empty', async () => {
      vi.mocked(queries.referencesToObject).mockReturnValue([]);
      const result = await server.getTool('find_references_to')!.handler({ objectName: 'Missing' });

      expect(queries.referencesToObject).toHaveBeenCalledWith(session, 'Missing', 0);
      expect(queries.referencesToObject).toHaveBeenCalledWith(session, 'Missing', 1);
      expect(result.content[0].text).toBe('No references found in environmentId 0 or 1.');
    });

    // Symmetric with find_implementors / find_references_to — same helper,
    // same fallback semantics. Without this assertion a refactor could
    // regress only the senders branch.
    it('find_senders auto-falls-back to env 1 when env 0 returns empty', async () => {
      vi.mocked(queries.sendersOf).mockReturnValue([]);
      const result = await server.getTool('find_senders')!.handler({ selector: 'unused' });

      expect(queries.sendersOf).toHaveBeenCalledWith(session, 'unused', 0);
      expect(queries.sendersOf).toHaveBeenCalledWith(session, 'unused', 1);
      expect(result.content[0].text).toBe('No senders found in environmentId 0 or 1.');
    });

    it('list_all_classes emits dictIndex\\tdictName\\tclassName rows', async () => {
      vi.mocked(queries.getAllClassNames).mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
        { dictIndex: 2, dictName: 'UserGlobals', className: 'MyClass' },
      ]);
      const result = await server.getTool('list_all_classes')!.handler({});

      expect(result.content[0].text).toBe('1\tGlobals\tArray\n2\tUserGlobals\tMyClass');
    });

    it('list_dictionary_entries emits kind\\tcategory\\tname rows', async () => {
      vi.mocked(queries.getDictionaryEntries).mockReturnValue([
        { isClass: true, category: 'accessing', name: 'Array' },
        { isClass: false, category: '', name: 'MyVar' },
      ]);
      const result = await server
        .getTool('list_dictionary_entries')!
        .handler({ dictionaryName: 'Globals' });

      expect(queries.getDictionaryEntries).toHaveBeenCalledWith(session, 'Globals');
      expect(result.content[0].text).toBe('class\taccessing\tArray\nglobal\t\tMyVar');
    });

    it('list_dictionary_entries reports empty dictionary with a friendly message', async () => {
      vi.mocked(queries.getDictionaryEntries).mockReturnValue([]);
      const result = await server
        .getTool('list_dictionary_entries')!
        .handler({ dictionaryName: 'NoSuchDict' });

      expect(result.content[0].text).toBe('Dictionary not found or empty: NoSuchDict');
    });

    it('list_classes reports unknown/empty dictionary', async () => {
      vi.mocked(queries.getClassNames).mockReturnValue([]);
      const result = await server.getTool('list_classes')!.handler({ dictionaryName: 'Missing' });

      expect(result.content[0].text).toBe('Dictionary not found or empty: Missing');
    });

    it('abort runs System abortTransaction', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('Transaction aborted');
      const result = await server.getTool('abort')!.handler({});

      const code = vi.mocked(queries.executeFetchString).mock.calls[0][1];
      expect(code).toContain('abortTransaction');
      expect(result.content[0].text).toBe('Transaction aborted');
    });

    it('commit runs System commitTransaction', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('Transaction committed');
      const result = await server.getTool('commit')!.handler({});

      const code = vi.mocked(queries.executeFetchString).mock.calls[0][1];
      expect(code).toContain('commitTransaction');
      expect(result.content[0].text).toBe('Transaction committed');
    });

    it('compile_method forwards args (escaping happens inside the shared query)', async () => {
      vi.mocked(queries.compileMethod).mockReturnValue('Compiled: MyClass >> greeting');
      await server.getTool('compile_method')!.handler({
        className: 'MyClass',
        isMeta: false,
        category: 'testing',
        source: "greeting\n  ^ 'Hello'",
      });

      expect(queries.compileMethod).toHaveBeenCalledWith(
        session,
        'MyClass',
        false,
        'testing',
        "greeting\n  ^ 'Hello'",
        0,
        undefined,
      );
    });

    it('add_dictionary / remove_dictionary / set_class_comment / delete_class / delete_method delegate to queries', async () => {
      vi.mocked(queries.addDictionary).mockReturnValue('Added dictionary: X');
      vi.mocked(queries.removeDictionary).mockReturnValue('Removed dictionary: X');
      vi.mocked(queries.setClassComment).mockReturnValue('Comment set: Foo');
      vi.mocked(queries.deleteClass).mockReturnValue('Deleted class: Foo');
      vi.mocked(queries.deleteMethod).mockReturnValue('Deleted: Foo >> bar');
      vi.mocked(queries.compileClassDefinition).mockReturnValue('Foo');

      const adr = await server.getTool('add_dictionary')!.handler({ dictionaryName: 'X' });
      expect(queries.addDictionary).toHaveBeenCalledWith(session, 'X');
      expect(adr.content[0].text).toBe('Added dictionary: X');

      const rmr = await server.getTool('remove_dictionary')!.handler({ dictionaryName: 'X' });
      expect(queries.removeDictionary).toHaveBeenCalledWith(session, 'X');
      expect(rmr.content[0].text).toBe('Removed dictionary: X');

      await server
        .getTool('set_class_comment')!
        .handler({ className: 'Foo', comment: 'hi', dictionaryName: 'Globals' });
      expect(queries.setClassComment).toHaveBeenCalledWith(session, 'Foo', 'hi', 'Globals');

      await server
        .getTool('delete_class')!
        .handler({ className: 'Foo', dictionaryName: 'UserGlobals' });
      expect(queries.deleteClass).toHaveBeenCalledWith(session, 'UserGlobals', 'Foo');

      await server
        .getTool('delete_method')!
        .handler({ className: 'Foo', isMeta: false, selector: 'bar' });
      expect(queries.deleteMethod).toHaveBeenCalledWith(session, 'Foo', false, 'bar', undefined);

      const ccd = await server
        .getTool('compile_class_definition')!
        .handler({ source: "Object subclass: 'Foo'" });
      expect(queries.compileClassDefinition).toHaveBeenCalledWith(
        session,
        "Object subclass: 'Foo'",
      );
      expect(ccd.content[0].text).toBe('Class: Foo');
    });

    it('run_test_method auto-discovers the dictionary and passes it through', async () => {
      vi.mocked(sunit.discoverTestClasses).mockReturnValue([
        { dictName: 'Globals', className: 'ArrayTest', testCount: 5 },
      ]);
      vi.mocked(sunit.runTestMethod).mockReturnValue({
        className: 'ArrayTest',
        selector: 'testSize',
        status: 'passed',
        message: '',
        durationMs: 3,
      });
      const result = await server.getTool('run_test_method')!.handler({
        className: 'ArrayTest',
        selector: 'testSize',
      });

      expect(sunit.runTestMethod).toHaveBeenCalledWith(session, 'ArrayTest', 'testSize', 'Globals');
      expect(result.content[0].text).toBe('PASSED (3ms)');
    });

    it('run_test_method uses an explicit dictionary without discovery', async () => {
      vi.mocked(sunit.runTestMethod).mockReturnValue({
        className: 'AnnouncerTest',
        selector: 'testFoo',
        status: 'passed',
        message: '',
        durationMs: 1,
      });
      await server.getTool('run_test_method')!.handler({
        className: 'AnnouncerTest',
        selector: 'testFoo',
        dictionary: 'UserGlobals',
      });

      expect(sunit.discoverTestClasses).not.toHaveBeenCalled();
      expect(sunit.runTestMethod).toHaveBeenCalledWith(
        session,
        'AnnouncerTest',
        'testFoo',
        'UserGlobals',
      );
    });

    it('run_test_method auto-refreshes the session view before running', async () => {
      vi.mocked(sunit.runTestMethod).mockReturnValue({
        className: 'ArrayTest',
        selector: 'testSize',
        status: 'passed',
        message: '',
        durationMs: 1,
      });
      await server.getTool('run_test_method')!.handler({
        className: 'ArrayTest',
        selector: 'testSize',
      });

      const refreshCall = vi.mocked(queries.executeFetchString).mock.calls[0][1];
      expect(refreshCall).toContain('System needsCommit ifFalse:');
      expect(refreshCall).toContain('System abortTransaction');
    });

    it('run_test_class auto-discovers the dictionary and formats results', async () => {
      vi.mocked(sunit.discoverTestClasses).mockReturnValue([
        { dictName: 'Globals', className: 'ArrayTest', testCount: 5 },
      ]);
      vi.mocked(sunit.runTestClass).mockReturnValue([
        {
          className: 'ArrayTest',
          selector: 'testSize',
          status: 'passed',
          message: '',
          durationMs: 0,
        },
        {
          className: 'ArrayTest',
          selector: 'testBad',
          status: 'failed',
          message: 'expected 1 got 2',
          durationMs: 0,
        },
      ]);
      const result = await server.getTool('run_test_class')!.handler({ className: 'ArrayTest' });

      expect(sunit.runTestClass).toHaveBeenCalledWith(session, 'ArrayTest', 'Globals');
      expect(result.content[0].text).toContain('PASSED: ArrayTest >> testSize');
      expect(result.content[0].text).toContain('FAILED: ArrayTest >> testBad');
      expect(result.content[0].text).toContain('expected 1 got 2');
    });

    it('run_test_class refuses to guess when a name is in multiple dictionaries', async () => {
      vi.mocked(sunit.discoverTestClasses).mockReturnValue([
        { dictName: 'UserGlobals', className: 'AnnouncerTest', testCount: 7 },
        { dictName: 'Globals', className: 'AnnouncerTest', testCount: 19 },
      ]);
      const result = await server
        .getTool('run_test_class')!
        .handler({ className: 'AnnouncerTest' });

      expect(sunit.runTestClass).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('UserGlobals');
      expect(result.content[0].text).toContain('Globals');
      expect(result.content[0].text).toContain('dictionary');
    });

    it('run_test_class reports when no such test class exists', async () => {
      vi.mocked(sunit.discoverTestClasses).mockReturnValue([]);
      const result = await server.getTool('run_test_class')!.handler({ className: 'NoSuchTest' });

      expect(sunit.runTestClass).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('No TestCase subclass named');
    });

    it('run_test_class auto-refreshes the session view before running', async () => {
      vi.mocked(sunit.runTestClass).mockReturnValue([]);
      await server.getTool('run_test_class')!.handler({ className: 'ArrayTest' });

      const refreshCall = vi.mocked(queries.executeFetchString).mock.calls[0][1];
      expect(refreshCall).toContain('System needsCommit ifFalse:');
      expect(refreshCall).toContain('System abortTransaction');
    });

    it('list_failing_tests returns "All tests passed." when nothing failed', async () => {
      vi.mocked(sunit.runFailingTests).mockReturnValue([]);
      const result = await server.getTool('list_failing_tests')!.handler({});

      expect(result.content[0].text).toBe('All tests passed.');
    });

    it('list_failing_tests formats failures and errors with status\\tclass\\tselector\\tmessage', async () => {
      vi.mocked(sunit.runFailingTests).mockReturnValue([
        {
          className: 'MyTest',
          selector: 'testBad',
          status: 'failed',
          message: 'expected 1 got 2',
          durationMs: 0,
        },
        {
          className: 'Other',
          selector: 'testBoom',
          status: 'error',
          message: 'division by zero',
          durationMs: 0,
        },
      ]);
      const result = await server.getTool('list_failing_tests')!.handler({});

      expect(result.content[0].text).toContain('FAILED\tMyTest\ttestBad\texpected 1 got 2');
      expect(result.content[0].text).toContain('ERROR\tOther\ttestBoom\tdivision by zero');
    });

    it('list_failing_tests forwards classNames to the underlying query', async () => {
      vi.mocked(sunit.runFailingTests).mockReturnValue([]);
      await server
        .getTool('list_failing_tests')!
        .handler({ classNames: ['ArrayTest', 'StringTest'] });

      // Third arg is `classNamePattern`, undefined when not passed.
      expect(sunit.runFailingTests).toHaveBeenCalledWith(
        session,
        ['ArrayTest', 'StringTest'],
        undefined,
      );
    });

    // Round-2 enhancement: glob-pattern filter (e.g. "Bytes*TestCase") is
    // forwarded to the shared query, which expands it server-side via
    // GemStone's `String match:` so we still hit the suite in one round-trip.
    it('list_failing_tests forwards classNamePattern to the underlying query', async () => {
      vi.mocked(sunit.runFailingTests).mockReturnValue([]);
      await server.getTool('list_failing_tests')!.handler({ classNamePattern: 'Bytes*TestCase' });

      expect(sunit.runFailingTests).toHaveBeenCalledWith(session, undefined, 'Bytes*TestCase');
    });

    it('list_failing_tests auto-refreshes the session view before the suite runs', async () => {
      vi.mocked(sunit.runFailingTests).mockReturnValue([]);
      await server.getTool('list_failing_tests')!.handler({});

      const refreshCall = vi.mocked(queries.executeFetchString).mock.calls[0][1];
      expect(refreshCall).toContain('System needsCommit ifFalse:');
      expect(refreshCall).toContain('System abortTransaction');
    });

    it('list_test_classes returns dictName\\tclassName rows', async () => {
      vi.mocked(sunit.discoverTestClasses).mockReturnValue([
        { dictName: 'UserGlobals', className: 'ArrayTest', testCount: 5 },
        { dictName: 'UserGlobals', className: 'StringTest', testCount: 8 },
      ]);
      const result = await server.getTool('list_test_classes')!.handler({});

      expect(result.content[0].text).toBe('UserGlobals\tArrayTest\nUserGlobals\tStringTest');
    });

    it('list_test_classes returns a friendly message when no TestCase subclasses are found', async () => {
      vi.mocked(sunit.discoverTestClasses).mockReturnValue([]);
      const result = await server.getTool('list_test_classes')!.handler({});

      expect(result.content[0].text).toBe('No TestCase subclasses found.');
    });

    it('eval_python delegates to python.evalPython with the source string', async () => {
      vi.mocked(python.evalPython).mockReturnValue('3');
      const result = await server.getTool('eval_python')!.handler({ source: '1 + 2' });

      expect(python.evalPython).toHaveBeenCalledWith(session, '1 + 2');
      expect(result.content[0].text).toBe('3');
    });

    // Tool registers unconditionally; the "Grail not loaded" message comes
    // back from the Smalltalk side as ordinary result text.
    it('eval_python passes the "Grail not detected" hint through verbatim', async () => {
      vi.mocked(python.evalPython).mockReturnValue(
        'Grail (GemStone-Python) not detected: class ModuleAst not found in symbolList. ...',
      );
      const result = await server.getTool('eval_python')!.handler({ source: 'x = 1' });

      expect(result.content[0].text).toContain('Grail (GemStone-Python) not detected');
      expect(result.isError).toBeUndefined();
    });

    it('compile_python delegates to python.compilePython with the source string', async () => {
      vi.mocked(python.compilePython).mockReturnValue('x := 1');
      const result = await server.getTool('compile_python')!.handler({ source: 'x = 1' });

      expect(python.compilePython).toHaveBeenCalledWith(session, 'x = 1');
      expect(result.content[0].text).toBe('x := 1');
    });

    it('describe_test_failure formats TestFailure output with exceptionClass + messageText', async () => {
      vi.mocked(sunit.describeTestFailure).mockReturnValue({
        status: 'failed',
        exceptionClass: 'TestFailure',
        errorNumber: 2751,
        messageText: 'Assertion failed',
        description: 'TestFailure: Assertion failed',
      });
      const result = await server
        .getTool('describe_test_failure')!
        .handler({ className: 'ArrayTest', selector: 'testBad' });

      expect(sunit.describeTestFailure).toHaveBeenCalledWith(session, 'ArrayTest', 'testBad');
      expect(result.content[0].text).toContain('exceptionClass: TestFailure');
      expect(result.content[0].text).toContain('messageText: Assertion failed');
      expect(result.content[0].text).toContain('errorNumber: 2751');
    });

    it('describe_test_failure surfaces mnuReceiver and mnuSelector for MessageNotUnderstood', async () => {
      vi.mocked(sunit.describeTestFailure).mockReturnValue({
        status: 'error',
        exceptionClass: 'MessageNotUnderstood',
        errorNumber: 2010,
        messageText: 'a Object class does not understand #foo',
        description: 'a Object class does not understand #foo',
        mnuReceiver: 'Object',
        mnuSelector: 'foo',
      });
      const result = await server
        .getTool('describe_test_failure')!
        .handler({ className: 'ArrayTest', selector: 'testErrors' });

      expect(result.content[0].text).toContain('mnuReceiver: Object');
      expect(result.content[0].text).toContain('mnuSelector: foo');
    });

    it('describe_test_failure returns "PASSED" when the re-run actually passed', async () => {
      vi.mocked(sunit.describeTestFailure).mockReturnValue({ status: 'passed' });
      const result = await server
        .getTool('describe_test_failure')!
        .handler({ className: 'ArrayTest', selector: 'testGood' });

      expect(result.content[0].text).toBe('PASSED');
    });

    it('describe_test_failure formats stackReport under a header preserving newlines', async () => {
      vi.mocked(sunit.describeTestFailure).mockReturnValue({
        status: 'failed',
        exceptionClass: 'TestFailure',
        errorNumber: 2751,
        messageText: 'Assertion failed',
        description: 'TestFailure: Assertion failed',
        stackReport:
          'TestFailure (AbstractException) >> signal: @3 line 7  [GsNMethod 3523841]\n' +
          'JasperProbeTest >> testFails @3 line 1  [GsNMethod 1236251649]',
      });
      const result = await server
        .getTool('describe_test_failure')!
        .handler({ className: 'ArrayTest', selector: 'testBad' });
      const text = result.content[0].text;

      expect(text).toContain('stackReport:');
      expect(text).toContain('TestFailure (AbstractException) >> signal:');
      expect(text).toContain('JasperProbeTest >> testFails');
    });

    it('refresh runs needsCommit/abortTransaction and returns the result', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('refreshed');
      const result = await server.getTool('refresh')!.handler({});

      const code = vi.mocked(queries.executeFetchString).mock.calls[0][1];
      expect(code).toContain('System needsCommit');
      expect(code).toContain('System abortTransaction');
      expect(result.content[0].text).toBe('refreshed');
    });

    it('status pulls session info via executeFetchString', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('User: DataCurator\n...');
      const result = await server.getTool('status')!.handler({});

      const code = vi.mocked(queries.executeFetchString).mock.calls[0][1];
      expect(code).toContain('myUserProfile');
      expect(code).toContain('stoneName');
      expect(code).toContain('inTransaction');
      expect(code).toContain('needsCommit');
      expect(result.content[0].text).toContain('DataCurator');
    });

    // Stale-transaction guard: the snippet must auto-refresh-if-clean so the
    // rest of the report (and any follow-up read tools in this session) sees
    // committed state. Skipping when needsCommit is true is load-bearing —
    // discarding uncommitted work silently would be far worse than reporting
    // slightly stale state.
    it('status auto-refreshes the view inline (only when no uncommitted changes)', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('');
      await server.getTool('status')!.handler({});

      const code = vi.mocked(queries.executeFetchString).mock.calls[0][1];
      expect(code).toContain('System needsCommit');
      expect(code).toContain('System abortTransaction');
      expect(code).toContain('View: ');
      expect(code).toContain('stale');
      expect(code).toContain('refreshed');
    });

    // Regression: nextPutAll: sends do: to its argument. If any value passed
    // is a SmallInteger (as System stoneVersionReport was observed returning),
    // GemStone raises "SmallInteger does not understand #do:". Every value
    // put into the stream must be a CharacterCollection.
    it('coerces every value streamed in status to a CharacterCollection', async () => {
      vi.mocked(queries.executeFetchString).mockReturnValue('');
      await server.getTool('status')!.handler({});
      const code = vi.mocked(queries.executeFetchString).mock.calls[0][1];

      expect(code).toMatch(/myUserProfile userId (asString|printString)/);
      expect(code).toMatch(/stoneName (asString|printString)/);
      expect(code).toMatch(/session printString/);
      expect(code).toContain('needsCommit');
      // stoneVersionReport returned a SmallInteger in 3.7.x (SmallInteger DNU
      // do:); modifiedObjects isn't a recognized System class method there
      // (DNU #modifiedObjects). Neither should be re-introduced.
      expect(code).not.toContain('stoneVersionReport');
      expect(code).not.toContain('modifiedObjects');
    });

    it('catches errors from queries and returns isError responses', async () => {
      vi.mocked(queries.executeFetchString).mockImplementation(() => {
        throw new Error('MessageNotUnderstood');
      });
      const result = await server.getTool('execute_code')!.handler({ code: 'bad code' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('MessageNotUnderstood');
    });
  });

  it('picks up session changes between tool calls (no stale caching)', async () => {
    session = undefined;
    const missing = await server.getTool('execute_code')!.handler({ code: '1' });
    expect(missing.isError).toBe(true);

    session = makeSession();
    vi.mocked(queries.executeFetchString).mockReturnValue('1');
    const present = await server.getTool('execute_code')!.handler({ code: '1' });
    expect(present.isError).toBeUndefined();
  });
});
