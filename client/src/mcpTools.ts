// Client-side MCP tool registration: exposes GemStone operations to AI tools
// (Claude Desktop, Claude Code) over the in-extension MCP server.
// Full design: docs/mcp-server.md
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ActiveSession } from './sessionManager';
import * as queries from './browserQueries';
import * as sunit from './sunitQueries';
import * as python from './pythonQueries';
import { wrapExecuteCode } from './queries/executeCode';
import type { TestRunResult } from './queries/runTestMethod';
import type { TestFailureDetails } from './queries/describeTestFailure';
import { withMcpErrorMap } from './mcpZodErrorMap';
import { drainTranscript } from './transcriptSink';
import { appendTranscriptOutput } from './transcriptChannel';

// AI-executed code writes to the Transcript too: the sink buffers those writes
// (MCP tools run on the FetchBytes path, which cannot host live forwarding —
// see transcriptSink.ts), so surface them in the channel after each code run.
function showBufferedTranscript(session: ActiveSession): void {
  appendTranscriptOutput(drainTranscript(session));
}

// Refresh the session's view of committed state if it's safe to do so.
// GemStone's GCI pins read-only operations to the session's transaction
// view: a commit landed by another process is invisible until this session
// aborts or commits. Auto-refresh closes the silent-stale gap; we skip
// when the session has uncommitted work so we never discard.
function refreshIfClean(session: ActiveSession): void {
  try {
    queries.executeFetchString(
      session,
      "System needsCommit ifFalse: [System abortTransaction]. 'ok'",
    );
  } catch {
    // Best effort. If refresh fails (e.g. session disconnected) the primary
    // tool call below will report the real error.
  }
}

// Outcome of resolving which dictionary a test class lives in. A SUnit test
// class must never be run without knowing its dictionary: the same name can
// exist in two dictionaries as two genuinely different suites, and bare-name
// resolution silently runs only the symbol-list winner.
type TestDictResolution =
  | { kind: 'resolved'; dictName: string }
  | { kind: 'notFound' }
  | { kind: 'ambiguous'; dictNames: string[] };

// Resolve the dictionary for a test class. If the caller supplied one, trust
// it. Otherwise discover which dictionaries define a TestCase subclass of that
// name: exactly one -> use it; zero -> notFound; many -> ambiguous (the caller
// must disambiguate rather than guess).
function resolveTestDictionary(
  session: ActiveSession,
  className: string,
  dictionary?: string,
): TestDictResolution {
  if (dictionary) return { kind: 'resolved', dictName: dictionary };
  const dictNames = sunit
    .discoverTestClasses(session)
    .filter((c) => c.className === className)
    .map((c) => c.dictName);
  if (dictNames.length === 0) return { kind: 'notFound' };
  if (dictNames.length > 1) return { kind: 'ambiguous', dictNames };
  return { kind: 'resolved', dictName: dictNames[0] };
}

function ambiguousDictMessage(className: string, dictNames: string[]): string {
  return (
    `'${className}' is defined as a TestCase subclass in multiple dictionaries: ` +
    `${dictNames.join(', ')}. These may be different test suites. Re-run with the ` +
    `'dictionary' parameter set to one of them (ask the user which they mean if unsure).`
  );
}

// Resolve the dictionary for className, then either invoke run(dictName) or
// return the user-facing error text when the class is missing/ambiguous. Folds
// the notFound/ambiguous handling shared by the test-running tools into one
// place so they can't drift.
function withResolvedDict(
  session: ActiveSession,
  className: string,
  dictionary: string | undefined,
  run: (dictName: string) => string,
): string {
  const res = resolveTestDictionary(session, className, dictionary);
  if (res.kind === 'notFound') return `No TestCase subclass named '${className}' found.`;
  if (res.kind === 'ambiguous') return ambiguousDictMessage(className, res.dictNames);
  return run(res.dictName);
}

// Build the empty-result message for a find_* tool. With env explicitly set,
// say so plainly; with env defaulted (we search env 0 then auto-fall-back to
// env 1), say nothing was found in either.
function noResultsMessage(label: string, environmentId: number | undefined): string {
  if (environmentId === undefined) {
    return `No ${label} found in environmentId 0 or 1.`;
  }
  return `No ${label} found in environmentId ${environmentId}.`;
}

// Run a find_* search with auto env-1 fallback. Mirrors the helper in the
// stdio surface — see mcp-server/src/tools.ts for the rationale.
function searchWithEnvFallback<T>(
  environmentId: number | undefined,
  search: (envId: number) => T[],
): T[] {
  if (environmentId !== undefined) return search(environmentId);
  const env0 = search(0);
  if (env0.length > 0) return env0;
  return search(1);
}

/**
 * Register the Jasper MCP tools against the user's currently selected
 * GemStone session. The session is resolved on each invocation via the
 * provided callback, so switching the active session in the UI is reflected
 * immediately.
 *
 * If no session is selected (or the user has not logged in), tools return an
 * error response rather than throwing — Claude can handle that gracefully and
 * tell the user to log in.
 */
export function registerMcpTools(
  rawServer: McpServer,
  getSession: () => ActiveSession | undefined,
): void {
  // Wrap the MCP server so each tool's input shape gets the actionable-error
  // zod error map attached at registration time. Per-schema attachment (not
  // global z.config) — see mcpZodErrorMap.ts for why a global map breaks the
  // SDK's protocol parsing.
  const server = withMcpErrorMap(rawServer) as unknown as McpServer;

  function requireSession(): ActiveSession | { errorText: string } {
    const session = getSession();
    if (!session) {
      return {
        errorText:
          'No active GemStone session. Select a session in Jasper (Sessions pane) ' +
          'or log in to a database before calling this tool.',
      };
    }
    return session;
  }

  function wrap<T extends Record<string, unknown>>(
    fn: (session: ActiveSession, args: T) => string,
  ): (args: T) => { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
    return (args: T) => {
      const s = requireSession();
      if ('errorText' in s) {
        return { content: [{ type: 'text', text: s.errorText }], isError: true };
      }
      try {
        const text = fn(s, args);
        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    };
  }

  // Tools are registered alphabetically.

  server.tool(
    'abort',
    "Abort the current transaction on the user's active session, discarding uncommitted changes.",
    {},
    async () =>
      wrap<Record<string, unknown>>((session) => {
        return executeString(session, `System abortTransaction. 'Transaction aborted'`);
      })({}),
  );

  server.tool(
    'add_dictionary',
    "Create a new SymbolDictionary and append it to the current user's symbolList. " +
      'NOT committed automatically — call commit to persist or abort to undo.',
    { dictionaryName: z.string().describe('Name of the new dictionary') },
    async (args) =>
      wrap<typeof args>((session, a) => {
        return queries.addDictionary(session, a.dictionaryName);
      })(args),
  );

  server.tool(
    'commit',
    "Commit the user's active session transaction, persisting all changes.",
    {},
    async () =>
      wrap<Record<string, unknown>>((session) => {
        return executeString(
          session,
          `System commitTransaction
  ifTrue: ['Transaction committed']
  ifFalse: ['Commit failed — possible conflict. Use abort to reset, then retry.']`,
        );
      })({}),
  );

  server.tool(
    'compile_class_definition',
    "Evaluate a class-definition expression (e.g. `Object subclass: 'Foo' ... inDictionary: 'UserGlobals'`). " +
      'Creates the class if new, updates it if it exists. The source embeds its own dictionary target. ' +
      'NOT committed automatically.',
    {
      source: z
        .string()
        .describe(
          'Full class-definition Smalltalk expression including the "subclass:" keyword send and inDictionary:',
        ),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        return `Class: ${queries.compileClassDefinition(session, a.source)}`;
      })(args),
  );

  server.tool(
    'compile_method',
    "Compile (add or update) a method on a class in the user's active session. Not committed automatically. " +
      'Optional dictionaryName disambiguates shadowed class names.',
    {
      className: z.string().describe('Class name'),
      isMeta: z.boolean().describe('true for class-side, false for instance-side'),
      category: z.string().describe('Method category, e.g. "accessing"'),
      source: z.string().describe('Full method source including the selector line'),
      environmentId: z.number().optional().describe('Environment ID (default 0)'),
      dictionaryName: z
        .string()
        .optional()
        .describe(
          'Optional dictionary to scope the class lookup. Omit for first-match resolution.',
        ),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        return queries.compileMethod(
          session,
          a.className,
          a.isMeta,
          a.category,
          a.source,
          a.environmentId ?? 0,
          a.dictionaryName,
        );
      })(args),
  );

  server.tool(
    'compile_python',
    'Transpile Python source to Smalltalk via Grail (GemStone-Python) and return the ' +
      'generated Smalltalk source verbatim. Useful for inspecting codegen output without ' +
      'running the code, and as an end-to-end check on the codegen pipeline. ' +
      'Returns a "Grail not detected" hint if Grail (class ModuleAst) is not loaded ' +
      'in the current session.',
    {
      source: z.string().describe('Python source string to transpile'),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        return python.compilePython(session, a.source);
      })(args),
  );

  server.tool(
    'delete_class',
    'DESTRUCTIVE: remove a class from a specific dictionary. Requires dictionaryName because ' +
      'deletion must target a specific dictionary (names can be shadowed across dicts). ' +
      'NOT committed automatically — abort undoes it.',
    {
      className: z.string().describe('Class name to delete'),
      dictionaryName: z.string().describe('Name of the dictionary that contains the class'),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        return queries.deleteClass(session, a.dictionaryName, a.className);
      })(args),
  );

  server.tool(
    'delete_method',
    'Remove a method from a class. NOT committed automatically. Optional dictionaryName ' +
      'disambiguates shadowed class names.',
    {
      className: z.string().describe('Class name'),
      isMeta: z.boolean().describe('true for class-side, false for instance-side'),
      selector: z.string().describe('Method selector to remove'),
      dictionaryName: z
        .string()
        .optional()
        .describe('Optional dictionary to scope the class lookup.'),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        return queries.deleteMethod(session, a.className, a.isMeta, a.selector, a.dictionaryName);
      })(args),
  );

  server.tool(
    'describe_class',
    'Agent-focused: combined class description in one round trip. Returns the class definition ' +
      '(superclass, instance/class variables, pool dictionaries), class comment, and own methods ' +
      'grouped by category for both instance and class sides. Does NOT include inherited selectors. ' +
      'Prefer this over calling get_class_definition + list_methods separately when you want to ' +
      'understand a class. Optional dictionaryName disambiguates shadowed class names.',
    {
      className: z.string().describe('Class name, e.g. "Array"'),
      dictionaryName: z
        .string()
        .optional()
        .describe(
          'Optional dictionary to scope the lookup. Omit to use first-match resolution across the symbolList.',
        ),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        return queries.describeClass(session, a.className, a.dictionaryName);
      })(args),
  );

  server.tool(
    'describe_test_failure',
    'Re-run a single SUnit test method and return structured details about why it failed: ' +
      'exception class, GemStone error number, messageText, description, and (for ' +
      'MessageNotUnderstood) the receiver and missing selector. Use this after run_test_method ' +
      'or list_failing_tests reports a failure. Re-runs in isolation with its own ' +
      'AbstractException handler — bypasses TestCase>>run, which would swallow the exception.',
    {
      className: z.string().describe('TestCase subclass name'),
      selector: z.string().describe('Test method selector, e.g. "testAdd"'),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        const details = sunit.describeTestFailure(session, a.className, a.selector);
        return formatTestFailureDetails(details);
      })(args),
  );

  server.tool(
    'eval_python',
    'Compile and execute Python source via Grail (GemStone-Python) and return the result ' +
      'as a printString. Closes the diagnostic-snippet gap for Python-heavy projects: ' +
      'one tool call instead of writing a /tmp/diag*.gs script that drives the codegen ' +
      'pipeline manually. Returns a "Grail not detected" hint if Grail (class ModuleAst) ' +
      'is not loaded in the current session. Grail-side compile and runtime errors are ' +
      'reported inline as "Error: <class> — <messageText>".',
    {
      source: z.string().describe('Python source string to evaluate'),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        try {
          return python.evalPython(session, a.source);
        } finally {
          showBufferedTranscript(session);
        }
      })(args),
  );

  server.tool(
    'execute_code',
    "Execute GemStone Smalltalk code in the user's active session and return the result as a string (via printString). " +
      'Accepts both single expressions ("3 + 4") and multi-statement bodies with temp ' +
      'declarations ("| x | x := 42. x + 1") — the body is evaluated as a block, so any ' +
      'sequence of statements is fine. The value of the last statement is returned. ' +
      'Changes are NOT committed automatically.',
    { code: z.string().describe('Smalltalk expression or statement sequence to execute') },
    async (args) =>
      wrap<typeof args>((session, a) => {
        // See queries/executeCode.ts. Block-wraps multi-statement bodies and
        // guards against AlmostOutOfStack / AbstractException so a runaway
        // block returns a clean error string instead of taking the gem down.
        try {
          return executeString(session, wrapExecuteCode(a.code));
        } finally {
          showBufferedTranscript(session);
        }
      })(args),
  );

  server.tool(
    'export_class_source',
    'Export a class as Topaz file-in source (full definition plus all methods). Useful for ' +
      'backing up a class or transporting it between environments. Optional dictionaryName ' +
      'disambiguates shadowed class names; without it, resolves to the first match in the ' +
      "symbolList (the class the user's code actually binds to).",
    {
      className: z.string().describe('Class name, e.g. "Array"'),
      dictionaryName: z
        .string()
        .optional()
        .describe('Optional dictionary to scope the lookup. Omit for first-match resolution.'),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        return queries.fileOutClass(session, a.className, a.dictionaryName);
      })(args),
  );

  server.tool(
    'find_implementors',
    'Find all classes that implement a given selector. Returns up to 500 results. ' +
      'With no environmentId, searches env 0 first and automatically falls back to env 1 ' +
      'if env 0 is empty — projects like GemStone-Python keep most user code in env 1, and ' +
      'the previous env-0-only default would silently report "no implementors" for methods ' +
      'that exist in env 1. Pass environmentId explicitly to limit to one environment.',
    {
      selector: z.string().describe('Method selector to search for'),
      environmentId: z
        .number()
        .optional()
        .describe('Environment ID. Omit for env 0 with auto-fallback to env 1.'),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        const results = searchWithEnvFallback(a.environmentId, (envId) =>
          queries.implementorsOf(session, a.selector, envId),
        );
        return formatMethodResults(results, noResultsMessage('implementors', a.environmentId));
      })(args),
  );

  server.tool(
    'find_references_to',
    'Find all methods that reference a named global (class, pool, or shared variable). ' +
      'Sister to find_senders, which matches a selector; this matches a global by name. ' +
      'Returns up to 500 results. With no environmentId, searches env 0 first and auto-falls ' +
      'back to env 1 if env 0 is empty. Pass environmentId explicitly to limit to one environment.',
    {
      objectName: z.string().describe('Name of the global to find references to, e.g. "AllUsers"'),
      environmentId: z
        .number()
        .optional()
        .describe('Environment ID. Omit for env 0 with auto-fallback to env 1.'),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        const results = searchWithEnvFallback(a.environmentId, (envId) =>
          queries.referencesToObject(session, a.objectName, envId),
        );
        return formatMethodResults(results, noResultsMessage('references', a.environmentId));
      })(args),
  );

  server.tool(
    'find_senders',
    'Find all methods that send a given selector. Returns up to 500 results. ' +
      'With no environmentId, searches env 0 first and auto-falls back to env 1 if env 0 is ' +
      'empty. Pass environmentId explicitly to limit to one environment.',
    {
      selector: z.string().describe('Method selector to search for'),
      environmentId: z
        .number()
        .optional()
        .describe('Environment ID. Omit for env 0 with auto-fallback to env 1.'),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        const results = searchWithEnvFallback(a.environmentId, (envId) =>
          queries.sendersOf(session, a.selector, envId),
        );
        return formatMethodResults(results, noResultsMessage('senders', a.environmentId));
      })(args),
  );

  server.tool(
    'get_class_definition',
    'Get the class definition (superclass, instance variables, etc.) for a class.',
    { className: z.string().describe('Class name, e.g. "Array"') },
    async (args) =>
      wrap<typeof args>((session, a) => {
        return queries.getClassDefinition(session, a.className);
      })(args),
  );

  server.tool(
    'get_class_hierarchy',
    'Get the superclass chain and direct subclasses of a class.',
    { className: z.string().describe('Class name') },
    async (args) =>
      wrap<typeof args>((session, a) => {
        const entries = queries.getClassHierarchy(session, a.className);
        return entries.map((e) => `${e.dictName}\t${e.className}\t${e.kind}`).join('\n');
      })(args),
  );

  server.tool(
    'get_method_source',
    'Get the source code of a method.',
    {
      className: z.string().describe('Class name'),
      isMeta: z.boolean().describe('true for class-side, false for instance-side'),
      selector: z.string().describe('Method selector, e.g. "printOn:"'),
      environmentId: z.number().optional().describe('Environment ID (default 0)'),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        return queries.getMethodSource(
          session,
          a.className,
          a.isMeta,
          a.selector,
          a.environmentId ?? 0,
        );
      })(args),
  );

  server.tool(
    'list_all_classes',
    "Enumerate every class in the user's symbol list along with its dictionary. " +
      "Bulk schema discovery; use when you don't know which dictionary a class lives in. " +
      'Returns tab-separated rows: dictIndex, dictName, className. May be large on big schemas.',
    {},
    async () =>
      wrap<Record<string, unknown>>((session) => {
        const entries = queries.getAllClassNames(session);
        return entries.map((e) => `${e.dictIndex}\t${e.dictName}\t${e.className}`).join('\n');
      })({}),
  );

  server.tool(
    'list_classes',
    'List all classes in a given symbol dictionary.',
    { dictionaryName: z.string().describe('Dictionary name, e.g. "Globals"') },
    async (args) =>
      wrap<typeof args>((session, a) => {
        const names = queries.getClassNames(session, a.dictionaryName);
        if (names.length === 0) return `Dictionary not found or empty: ${a.dictionaryName}`;
        return names.join('\n');
      })(args),
  );

  server.tool(
    'list_dictionaries',
    "List all symbol dictionaries in the current user's symbol list.",
    {},
    async () =>
      wrap<Record<string, unknown>>((session) => {
        return queries.getDictionaryNames(session).join('\n');
      })({}),
  );

  server.tool(
    'list_dictionary_entries',
    'List every entry in a symbol dictionary, including classes (with their categories) and ' +
      'globals (non-class entries like pools and shared variables). Richer than list_classes. ' +
      'Returns tab-separated rows: kind (class|global), category, name.',
    { dictionaryName: z.string().describe('Dictionary name, e.g. "Globals"') },
    async (args) =>
      wrap<typeof args>((session, a) => {
        const entries = queries.getDictionaryEntries(session, a.dictionaryName);
        if (entries.length === 0) return `Dictionary not found or empty: ${a.dictionaryName}`;
        return entries
          .map((e) => `${e.isClass ? 'class' : 'global'}\t${e.category}\t${e.name}`)
          .join('\n');
      })(args),
  );

  server.tool(
    'list_failing_tests',
    'Run SUnit tests and return only the failed/errored results — the agent ' +
      'equivalent of "run the suite and grep for failures." Class selection: ' +
      'explicit `classNames` wins; otherwise `classNamePattern` (glob: `*` matches ' +
      'any chars, `#` matches one) filters discovered TestCase subclasses; ' +
      'otherwise every TestCase subclass in the symbolList is run. The run is ' +
      'capped at 100 classes (running more in one blocking call wedges the session); ' +
      'an oversized selection errors and asks you to narrow it. The message ' +
      'column carries the actual exception class + messageText (e.g. ' +
      '`MessageNotUnderstood: nil does not understand #foo`), captured by ' +
      're-running each failing test with its own AbstractException handler. ' +
      'Auto-refreshes the session view first when no uncommitted changes are pending. ' +
      'Returns "All tests passed." if every test passed; otherwise tab-separated ' +
      'lines: status, className, selector, message.',
    {
      classNames: z
        .array(z.string())
        .optional()
        .describe(
          'TestCase subclass names to run. Omit to run every TestCase in the symbolList ' +
            '(capped at 100 — a full image has hundreds, so omitting usually errors and asks ' +
            'you to narrow with classNamePattern), or pair with classNamePattern for glob filtering.',
        ),
      classNamePattern: z
        .string()
        .optional()
        .describe(
          'GemStone glob pattern (`*` = any chars, `#` = one char) to filter discovered ' +
            'TestCase subclasses, e.g. "Bytes*TestCase". Ignored when classNames is set.',
        ),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        refreshIfClean(session);
        const results = sunit.runFailingTests(session, a.classNames, a.classNamePattern);
        if (results.length === 0) return 'All tests passed.';
        return results
          .map((r) => {
            const status = r.status === 'failed' ? 'FAILED' : 'ERROR';
            return `${status}\t${r.className}\t${r.selector}\t${r.message}`;
          })
          .join('\n');
      })(args),
  );

  server.tool(
    'list_methods',
    'List all methods of a class, grouped by category. Returns tab-separated lines: side (instance|class), category, selector.',
    { className: z.string().describe('Class name') },
    async (args) =>
      wrap<typeof args>((session, a) => {
        const methods = queries.getMethodList(session, a.className);
        if (methods.length === 0) return 'No methods found.';
        return methods
          .map((m) => `${m.isMeta ? 'class' : 'instance'}\t${m.category}\t${m.selector}`)
          .join('\n');
      })(args),
  );

  server.tool(
    'list_test_classes',
    "Discover every TestCase subclass in the user's symbolList. Returns " +
      'tab-separated lines: dictName, className. Useful for then passing a ' +
      'filtered subset to list_failing_tests.',
    {},
    async () =>
      wrap<Record<string, unknown>>((session) => {
        const classes = sunit.discoverTestClasses(session);
        if (classes.length === 0) return 'No TestCase subclasses found.';
        return classes.map((c) => `${c.dictName}\t${c.className}`).join('\n');
      })({}),
  );

  server.tool(
    'refresh',
    "Refresh this session's view of committed state by aborting if (and only if) " +
      "there are no uncommitted changes. GemStone's GCI pins the session's read view " +
      'until it aborts or commits, so a commit landed by another process (e.g. install.sh) ' +
      'is invisible until refresh runs. If the session has uncommitted work, this is a ' +
      'no-op and reports back so the caller can decide whether to abort or commit first.',
    {},
    async () =>
      wrap<Record<string, unknown>>((session) => {
        return executeString(
          session,
          "System needsCommit ifTrue: ['skipped: uncommitted changes present'] ifFalse: [System abortTransaction. 'refreshed']",
        );
      })({}),
  );

  server.tool(
    'remove_dictionary',
    "DESTRUCTIVE: remove a dictionary from the current user's symbolList. " +
      'NOT committed automatically.',
    { dictionaryName: z.string().describe('Name of the dictionary to remove') },
    async (args) =>
      wrap<typeof args>((session, a) => {
        return queries.removeDictionary(session, a.dictionaryName);
      })(args),
  );

  server.tool(
    'run_test_class',
    'Run all SUnit test methods in a TestCase subclass and return per-method pass/fail/error results. ' +
      'Auto-refreshes the session view first (when no uncommitted changes are pending) so results ' +
      'reflect the latest committed code, not a stale transaction view. The dictionary is always ' +
      'resolved before running: omit it to auto-discover (errors if the name is ambiguous across ' +
      'dictionaries), or pass it to target a specific copy.',
    {
      className: z.string().describe('TestCase subclass name'),
      dictionary: z
        .string()
        .optional()
        .describe(
          'SymbolDictionary holding the class (e.g. "UserGlobals"). Omit to auto-discover; ' +
            'required when the same class name exists in more than one dictionary.',
        ),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        refreshIfClean(session);
        try {
          return withResolvedDict(session, a.className, a.dictionary, (dictName) =>
            formatTestResults(sunit.runTestClass(session, a.className, dictName)),
          );
        } finally {
          showBufferedTranscript(session);
        }
      })(args),
  );

  server.tool(
    'run_test_method',
    'Run a single SUnit test method and return pass/fail/error with details. ' +
      'Auto-refreshes the session view first (when no uncommitted changes are pending) so the ' +
      'result reflects the latest committed code. The dictionary is always resolved before ' +
      'running: omit it to auto-discover (errors if the name is ambiguous), or pass it to target ' +
      'a specific copy.',
    {
      className: z.string().describe('TestCase subclass name'),
      selector: z.string().describe('Test method selector, e.g. "testAdd"'),
      dictionary: z
        .string()
        .optional()
        .describe(
          'SymbolDictionary holding the class (e.g. "UserGlobals"). Omit to auto-discover; ' +
            'required when the same class name exists in more than one dictionary.',
        ),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        refreshIfClean(session);
        try {
          return withResolvedDict(session, a.className, a.dictionary, (dictName) =>
            formatTestResult(sunit.runTestMethod(session, a.className, a.selector, dictName)),
          );
        } finally {
          showBufferedTranscript(session);
        }
      })(args),
  );

  server.tool(
    'search_method_source',
    'Search method source for a substring. Returns up to 500 matches with class, selector, and category.',
    {
      term: z.string().describe('Text to search for in method source'),
      ignoreCase: z.boolean().optional().describe('Case-insensitive search (default true)'),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        const results = queries.searchMethodSource(session, a.term, a.ignoreCase ?? true);
        return formatMethodResults(results, 'No matches found.');
      })(args),
  );

  server.tool(
    'set_class_comment',
    'Set the class comment (docstring equivalent). Replaces any existing comment. ' +
      'NOT committed automatically. Optional dictionaryName disambiguates shadowed class names.',
    {
      className: z.string().describe('Class name'),
      comment: z.string().describe('New comment text'),
      dictionaryName: z
        .string()
        .optional()
        .describe('Optional dictionary to scope the class lookup.'),
    },
    async (args) =>
      wrap<typeof args>((session, a) => {
        return queries.setClassComment(session, a.className, a.comment, a.dictionaryName);
      })(args),
  );

  server.tool(
    'status',
    "Report information about the user's active GemStone session: user, stone, transaction state, " +
      'whether there are uncommitted changes, and whether the session view was just refreshed. ' +
      'Auto-refreshes the view (via abort) when no uncommitted changes are pending, so subsequent ' +
      'reads reflect the latest committed state — not a stale transaction view from before another ' +
      'process committed.',
    {},
    async () =>
      wrap<Record<string, unknown>>((session) => {
        // Every value put into the stream must be a CharacterCollection; otherwise
        // nextPutAll: sends do: to it and GemStone complains (e.g. SmallInteger
        // DNU do:). Coerce with asString / printString to keep it robust across
        // GemStone versions where these System methods return different types.
        //
        // Auto-refresh: if no uncommitted work is pending we abort first so the
        // rest of the report (and any follow-up read tool calls) sees committed
        // state landed by other processes. Skip when uncommitted work is
        // pending — silent discard would be far worse than slightly stale state.
        const code = `| ws viewState |
viewState := System needsCommit
  ifTrue: ['stale (uncommitted changes — call abort or commit to refresh)']
  ifFalse: [System abortTransaction. 'refreshed'].
ws := WriteStream on: String new.
ws nextPutAll: 'User: '; nextPutAll: System myUserProfile userId asString; lf.
ws nextPutAll: 'Stone: '; nextPutAll: System stoneName asString; lf.
ws nextPutAll: 'Session ID: '; nextPutAll: System session printString; lf.
ws nextPutAll: 'Transaction: '; nextPutAll: (System inTransaction ifTrue: ['active'] ifFalse: ['none']); lf.
ws nextPutAll: 'Uncommitted changes: '; nextPutAll: (System needsCommit ifTrue: ['yes'] ifFalse: ['no']); lf.
ws nextPutAll: 'View: '; nextPutAll: viewState; lf.
ws contents`;
        return executeString(session, code);
      })({}),
  );
}

// ── Helpers (local) ────────────────────────────────────────────────────────

function formatMethodResults(results: queries.MethodSearchResult[], fallback: string): string {
  if (results.length === 0) return fallback;
  return results
    .map(
      (r) =>
        `${r.dictName}\t${r.className}\t${r.isMeta ? 'class' : 'instance'}\t${r.selector}\t${r.category}`,
    )
    .join('\n');
}

function formatTestResult(r: TestRunResult): string {
  const prefix = r.status === 'passed' ? 'PASSED' : r.status === 'failed' ? 'FAILED' : 'ERROR';
  const msg = r.message ? `: ${r.message}` : '';
  return `${prefix}${msg} (${r.durationMs}ms)`;
}

// Render TestFailureDetails as line-oriented text. Agents read this directly,
// so the format is "<key>: <value>\n" — easy to scan, easy to grep, no
// structure beyond the keys the Smalltalk side already provides. stackReport
// is emitted last (and bare, since it's already multi-line) under a header
// so the agent sees the structured fields first and can scroll to the trace.
function formatTestFailureDetails(d: TestFailureDetails): string {
  if (d.status === 'passed') return 'PASSED';
  const lines: string[] = [];
  lines.push(`status: ${d.status}`);
  if (d.exceptionClass) lines.push(`exceptionClass: ${d.exceptionClass}`);
  if (d.errorNumber !== undefined) lines.push(`errorNumber: ${d.errorNumber}`);
  if (d.messageText !== undefined) lines.push(`messageText: ${d.messageText}`);
  if (d.description !== undefined) lines.push(`description: ${d.description}`);
  if (d.mnuReceiver !== undefined) lines.push(`mnuReceiver: ${d.mnuReceiver}`);
  if (d.mnuSelector !== undefined) lines.push(`mnuSelector: ${d.mnuSelector}`);
  if (d.stackReport) {
    lines.push('stackReport:');
    lines.push(d.stackReport);
  }
  return lines.join('\n');
}

function formatTestResults(results: TestRunResult[]): string {
  return results
    .map((r) => {
      const prefix = r.status === 'passed' ? 'PASSED' : r.status === 'failed' ? 'FAILED' : 'ERROR';
      const msg = r.message ? `\n  ${r.message}` : '';
      return `${prefix}: ${r.className} >> ${r.selector}${msg}`;
    })
    .join('\n');
}

function executeString(session: ActiveSession, code: string): string {
  return queries.executeFetchString(session, code);
}
