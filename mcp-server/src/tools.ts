// Standalone MCP server tool registration (stdio/SSE/proxy transport); the
// out-of-extension counterpart to client/src/mcpTools.ts, wrapping its own GCI
// session (mcpSession.ts) for AI tool calls.
// Full design: docs/mcp-server.md
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpSession } from './mcpSession';
import { withMcpErrorMap } from '../../client/src/mcpZodErrorMap';

import { QueryExecutor } from '../../client/src/queries/types';
import { getMethodSource } from '../../client/src/queries/getMethodSource';
import { abortTransaction } from '../../client/src/queries/abortTransaction';
import { commitTransaction } from '../../client/src/queries/commitTransaction';
import { runTestMethod, TestRunResult } from '../../client/src/queries/runTestMethod';
import { runTestClass } from '../../client/src/queries/runTestClass';
import { runFailingTests } from '../../client/src/queries/runFailingTests';
import { discoverTestClasses } from '../../client/src/queries/discoverTestClasses';
import {
  describeTestFailure,
  TestFailureDetails,
} from '../../client/src/queries/describeTestFailure';
import { evalPython, compilePython } from '../../client/src/queries/python';
import { wrapExecuteCode } from '../../client/src/queries/executeCode';
import { getDictionaryNames } from '../../client/src/queries/getDictionaryNames';
import { getClassNames } from '../../client/src/queries/getClassNames';
import { getDictionaryEntries } from '../../client/src/queries/getDictionaryEntries';
import { getAllClassNames } from '../../client/src/queries/getAllClassNames';
import { getMethodList } from '../../client/src/queries/getMethodList';
import { getClassDefinition } from '../../client/src/queries/getClassDefinition';
import { getClassHierarchy } from '../../client/src/queries/getClassHierarchy';
import { describeClass } from '../../client/src/queries/describeClass';
import { fileOutClass } from '../../client/src/queries/fileOutClass';
import { compileMethod } from '../../client/src/queries/compileMethod';
import { compileClassDefinition } from '../../client/src/queries/compileClassDefinition';
import { setClassComment } from '../../client/src/queries/setClassComment';
import { deleteMethod } from '../../client/src/queries/deleteMethod';
import { deleteClass } from '../../client/src/queries/deleteClass';
import { addDictionary } from '../../client/src/queries/addDictionary';
import { removeDictionary } from '../../client/src/queries/removeDictionary';
import {
  searchMethodSource,
  sendersOf,
  implementorsOf,
  referencesToObject,
  MethodSearchResult,
} from '../../client/src/queries/methodSearch';

function formatTestResult(r: TestRunResult): string {
  const prefix = r.status === 'passed' ? 'PASSED' : r.status === 'failed' ? 'FAILED' : 'ERROR';
  const msg = r.message ? `: ${r.message}` : '';
  return `${prefix}${msg} (${r.durationMs}ms)`;
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

function formatMethodResults(results: MethodSearchResult[], fallback: string): string {
  if (results.length === 0) return fallback;
  return results
    .map(
      (r) =>
        `${r.dictName}\t${r.className}\t${r.isMeta ? 'class' : 'instance'}\t${r.selector}\t${r.category}`,
    )
    .join('\n');
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

// Run a find_* search with auto env-1 fallback. If the caller passed an
// explicit environmentId we honor it (single env search). Otherwise we try
// env 0 first and fall back to env 1 when env 0 is empty — the round-2
// feedback workflow: Python-heavy projects keep most user code in env 1 and
// the env-0 default left agents staring at "No implementors found" when
// the method existed all along.
function searchWithEnvFallback<T>(
  environmentId: number | undefined,
  search: (envId: number) => T[],
): T[] {
  if (environmentId !== undefined) return search(environmentId);
  const env0 = search(0);
  if (env0.length > 0) return env0;
  return search(1);
}

// Refresh the session's view of committed state if (and only if) it's safe to
// do so. GemStone's GCI pins read-only operations to the session's transaction
// view: a commit landed by another process (e.g. install.sh) is invisible
// until this session aborts or commits. Auto-refresh closes the silent-stale
// gap; we skip it when the session has uncommitted work so we never discard.
function refreshIfClean(session: McpSession): void {
  try {
    session.executeFetchString("System needsCommit ifFalse: [System abortTransaction]. 'ok'");
  } catch {
    // Best-effort. If the refresh fails (e.g. session disconnected), the
    // primary tool call below will report the real error.
  }
}

export function registerTools(rawServer: McpServer, session: McpSession): void {
  // Wrap the MCP server so each tool's input shape gets the actionable-error
  // zod error map attached at registration time. Per-schema attachment (not
  // global z.config) — see mcpZodErrorMap.ts for why a global map breaks the
  // SDK's protocol parsing.
  const server = withMcpErrorMap(rawServer) as unknown as McpServer;

  // Bind this session into the QueryExecutor shape shared queries expect.
  const exec: QueryExecutor = (code) => session.executeFetchString(code);

  // Tools are registered in alphabetical order.

  server.tool(
    'abort',
    'Abort the current transaction, discarding all uncommitted changes (compiled methods, object modifications, etc.).',
    {},
    async () => {
      try {
        const text = abortTransaction(exec);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'add_dictionary',
    "Create a new SymbolDictionary and append it to the current user's symbolList. " +
      'NOT committed automatically — call commit to persist or abort to undo.',
    { dictionaryName: z.string().describe('Name of the new dictionary') },
    async ({ dictionaryName }) => {
      try {
        const text = addDictionary(exec, dictionaryName);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'commit',
    'Commit the current transaction, persisting all changes (compiled methods, object modifications, etc.).',
    {},
    async () => {
      try {
        const text = commitTransaction(exec);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ source }) => {
      try {
        const text = compileClassDefinition(exec, source);
        return { content: [{ type: 'text' as const, text: `Class: ${text}` }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'compile_method',
    'Compile (add or update) a method on a class. The change is NOT committed automatically — call abort to undo, or commit to persist. ' +
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
    async ({ className, isMeta, category, source, environmentId, dictionaryName }) => {
      try {
        const text = compileMethod(
          exec,
          className,
          isMeta,
          category,
          source,
          environmentId ?? 0,
          dictionaryName,
        );
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ source }) => {
      try {
        const text = compilePython(exec, source);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ className, dictionaryName }) => {
      try {
        const text = deleteClass(exec, dictionaryName, className);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ className, isMeta, selector, dictionaryName }) => {
      try {
        const text = deleteMethod(exec, className, isMeta, selector, dictionaryName);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ className, dictionaryName }) => {
      try {
        const text = describeClass(exec, className, dictionaryName);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ className, selector }) => {
      try {
        refreshIfClean(session);
        const details = describeTestFailure(exec, className, selector);
        return { content: [{ type: 'text' as const, text: formatTestFailureDetails(details) }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ source }) => {
      try {
        const text = evalPython(exec, source);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'execute_code',
    'Execute GemStone Smalltalk code and return the result as a string (via printString). ' +
      'Accepts both single expressions ("3 + 4") and multi-statement bodies with temp ' +
      'declarations ("| x | x := 42. x + 1") — the body is evaluated as a block, so any ' +
      'sequence of statements is fine. The value of the last statement is returned. ' +
      'Changes are NOT committed automatically.',
    { code: z.string().describe('Smalltalk expression or statement sequence to execute') },
    async ({ code }) => {
      try {
        // Block-wrap so multi-statement bodies and top-level temp declarations
        // parse, and guard with AlmostOutOfStack/AbstractException handlers so
        // a runaway block returns a clean error instead of taking the gem
        // down. See queries/executeCode.ts.
        const wrapped = wrapExecuteCode(code);
        const result = session.executeFetchString(wrapped);
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ className, dictionaryName }) => {
      try {
        const text = fileOutClass(exec, className, dictionaryName);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ selector, environmentId }) => {
      try {
        const results = searchWithEnvFallback(environmentId, (envId) =>
          implementorsOf(exec, selector, envId),
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: formatMethodResults(results, noResultsMessage('implementors', environmentId)),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ objectName, environmentId }) => {
      try {
        const results = searchWithEnvFallback(environmentId, (envId) =>
          referencesToObject(exec, objectName, envId),
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: formatMethodResults(results, noResultsMessage('references', environmentId)),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ selector, environmentId }) => {
      try {
        const results = searchWithEnvFallback(environmentId, (envId) =>
          sendersOf(exec, selector, envId),
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: formatMethodResults(results, noResultsMessage('senders', environmentId)),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'get_class_definition',
    'Get the class definition (superclass, instance variables, etc.) for a GemStone class.',
    { className: z.string().describe('Class name, e.g. "Array"') },
    async ({ className }) => {
      try {
        const result = getClassDefinition(exec, className);
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'get_class_hierarchy',
    'Get the superclass chain and direct subclasses of a class.',
    { className: z.string().describe('Class name') },
    async ({ className }) => {
      try {
        const entries = getClassHierarchy(exec, className);
        const text = entries.map((e) => `${e.dictName}\t${e.className}\t${e.kind}`).join('\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'get_method_source',
    'Get the source code of a method.',
    {
      className: z.string().describe('Class name'),
      isMeta: z.boolean().describe('true for class-side methods, false for instance-side'),
      selector: z.string().describe('Method selector, e.g. "printOn:"'),
      environmentId: z.number().optional().describe('Environment ID (default 0)'),
    },
    async ({ className, isMeta, selector, environmentId }) => {
      try {
        const result = getMethodSource(exec, className, isMeta, selector, environmentId ?? 0);
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'list_all_classes',
    "Enumerate every class in the user's symbol list along with its dictionary. " +
      "Bulk schema discovery; use when you don't know which dictionary a class lives in. " +
      'Returns tab-separated rows: dictIndex, dictName, className. May be large on big schemas.',
    {},
    async () => {
      try {
        const entries = getAllClassNames(exec);
        const text = entries.map((e) => `${e.dictIndex}\t${e.dictName}\t${e.className}`).join('\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'list_classes',
    'List all classes in a given symbol dictionary.',
    { dictionaryName: z.string().describe('Dictionary name, e.g. "Globals"') },
    async ({ dictionaryName }) => {
      try {
        const names = getClassNames(exec, dictionaryName);
        if (names.length === 0) {
          return {
            content: [
              { type: 'text' as const, text: `Dictionary not found or empty: ${dictionaryName}` },
            ],
          };
        }
        return { content: [{ type: 'text' as const, text: names.join('\n') }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'list_dictionaries',
    "List all symbol dictionaries in the current user's symbol list.",
    {},
    async () => {
      try {
        const names = getDictionaryNames(exec);
        return { content: [{ type: 'text' as const, text: names.join('\n') }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'list_dictionary_entries',
    'List every entry in a symbol dictionary, including classes (with their categories) and ' +
      'globals (non-class entries like pools and shared variables). Richer than list_classes. ' +
      'Returns tab-separated rows: kind (class|global), category, name.',
    { dictionaryName: z.string().describe('Dictionary name, e.g. "Globals"') },
    async ({ dictionaryName }) => {
      try {
        const entries = getDictionaryEntries(exec, dictionaryName);
        if (entries.length === 0) {
          return {
            content: [
              { type: 'text' as const, text: `Dictionary not found or empty: ${dictionaryName}` },
            ],
          };
        }
        const text = entries
          .map((e) => `${e.isClass ? 'class' : 'global'}\t${e.category}\t${e.name}`)
          .join('\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'list_failing_tests',
    'Run SUnit tests and return only the failed/errored results — the agent ' +
      'equivalent of "run the suite and grep for failures." Class selection: ' +
      'explicit `classNames` wins; otherwise `classNamePattern` (glob: `*` matches ' +
      'any chars, `#` matches one) filters discovered TestCase subclasses; ' +
      'otherwise every TestCase subclass in the symbolList is run. The message ' +
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
          'TestCase subclass names to run. Omit to run every TestCase in the symbolList, ' +
            'or pair with classNamePattern for glob filtering.',
        ),
      classNamePattern: z
        .string()
        .optional()
        .describe(
          'GemStone glob pattern (`*` = any chars, `#` = one char) to filter discovered ' +
            'TestCase subclasses, e.g. "Bytes*TestCase". Ignored when classNames is set.',
        ),
    },
    async ({ classNames, classNamePattern }) => {
      try {
        refreshIfClean(session);
        const results = runFailingTests(exec, classNames, classNamePattern);
        if (results.length === 0) {
          return { content: [{ type: 'text' as const, text: 'All tests passed.' }] };
        }
        const text = results
          .map((r) => {
            const status = r.status === 'failed' ? 'FAILED' : 'ERROR';
            return `${status}\t${r.className}\t${r.selector}\t${r.message}`;
          })
          .join('\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'list_methods',
    'List all methods of a class, grouped by category. Returns tab-separated lines: side (instance|class), category, selector.',
    { className: z.string().describe('Class name') },
    async ({ className }) => {
      try {
        const methods = getMethodList(exec, className);
        if (methods.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No methods found.' }] };
        }
        const text = methods
          .map((m) => `${m.isMeta ? 'class' : 'instance'}\t${m.category}\t${m.selector}`)
          .join('\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'list_test_classes',
    "Discover every TestCase subclass in the user's symbolList. Returns " +
      'tab-separated lines: dictName, className. Useful for then passing a ' +
      'filtered subset to list_failing_tests.',
    {},
    async () => {
      try {
        const classes = discoverTestClasses(exec);
        if (classes.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No TestCase subclasses found.' }] };
        }
        const text = classes.map((c) => `${c.dictName}\t${c.className}`).join('\n');
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'refresh',
    "Refresh this session's view of committed state by aborting if (and only if) " +
      "there are no uncommitted changes. GemStone's GCI pins the session's read view " +
      'until it aborts or commits, so a commit landed by another process (e.g. install.sh) ' +
      'is invisible until refresh runs. If the session has uncommitted work, this is a ' +
      'no-op and reports back so the caller can decide whether to abort or commit first.',
    {},
    async () => {
      try {
        const result = session.executeFetchString(
          "System needsCommit ifTrue: ['skipped: uncommitted changes present'] ifFalse: [System abortTransaction. 'refreshed']",
        );
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'remove_dictionary',
    "DESTRUCTIVE: remove a dictionary from the current user's symbolList. " +
      'NOT committed automatically.',
    { dictionaryName: z.string().describe('Name of the dictionary to remove') },
    async ({ dictionaryName }) => {
      try {
        const text = removeDictionary(exec, dictionaryName);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'run_test_class',
    'Run all SUnit test methods in a TestCase subclass and return per-method pass/fail/error results. ' +
      'Auto-refreshes the session view first (when no uncommitted changes are pending) so results ' +
      'reflect the latest committed code, not a stale transaction view.',
    {
      className: z.string().describe('TestCase subclass name'),
    },
    async ({ className }) => {
      try {
        refreshIfClean(session);
        const results = runTestClass(exec, className);
        const text = formatTestResults(results);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'run_test_method',
    'Run a single SUnit test method and return pass/fail/error with details. ' +
      'Auto-refreshes the session view first (when no uncommitted changes are pending) so the ' +
      'result reflects the latest committed code.',
    {
      className: z.string().describe('TestCase subclass name'),
      selector: z.string().describe('Test method selector, e.g. "testAdd"'),
    },
    async ({ className, selector }) => {
      try {
        refreshIfClean(session);
        const r = runTestMethod(exec, className, selector);
        const text = formatTestResult(r);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'search_method_source',
    'Search method source code for a substring. Returns up to 500 matches with class, selector, and category.',
    {
      term: z.string().describe('Text to search for in method source'),
      ignoreCase: z.boolean().optional().describe('Case-insensitive search (default true)'),
    },
    async ({ term, ignoreCase }) => {
      try {
        const results = searchMethodSource(exec, term, ignoreCase !== false);
        return {
          content: [
            { type: 'text' as const, text: formatMethodResults(results, 'No matches found.') },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
    async ({ className, comment, dictionaryName }) => {
      try {
        const text = setClassComment(exec, className, comment, dictionaryName);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'status',
    'Report information about the current GemStone session: user, stone, transaction state, ' +
      'whether there are uncommitted changes, and whether the session view was just refreshed. ' +
      'Auto-refreshes the view (via abort) when no uncommitted changes are pending, so subsequent ' +
      'reads reflect the latest committed state — not a stale transaction view from before another ' +
      'process committed.',
    {},
    async () => {
      try {
        // Every value put into the stream must be a CharacterCollection;
        // otherwise nextPutAll: sends do: to it and GemStone complains (e.g.
        // SmallInteger DNU do:). Coerce with asString / printString to keep
        // it robust across GemStone versions.
        //
        // Auto-refresh: if no uncommitted work is pending we abort first so
        // the rest of the report (and any follow-up read tool calls in this
        // session) sees committed state landed by other processes. If
        // uncommitted work is pending we skip — discarding it silently would
        // be far more harmful than reporting slightly stale state.
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
        const result = session.executeFetchString(code);
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
