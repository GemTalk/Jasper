// What the three reference-graph MCP tools say back.
//
// mcpTools.test.ts asserts the three are registered. This asserts what they RENDER, which
// is the whole of their value: an agent has only the text, so anything the scan qualified
// has to survive into it. Two qualifications matter and are easy to lose. A dirty session
// is a normal outcome rather than an error, and must come back as something the caller can
// act on. And every list is capped -- a silently truncated list reads as a complete one,
// which is how a partial answer becomes a false claim.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', () => ({
  executeFetchString: vi.fn(() => ''),
  implementorsOf: vi.fn(() => []),
  sendersOf: vi.fn(() => []),
  referencesToObject: vi.fn(() => []),
  getClassDefinition: vi.fn(() => ''),
  getClassHierarchy: vi.fn(() => []),
  getMethodSource: vi.fn(() => ''),
  getMethodList: vi.fn(() => []),
  getDictionaryNames: vi.fn(() => []),
  getClassNames: vi.fn(() => []),
  getDictionaryEntries: vi.fn(() => []),
  getAllClassNames: vi.fn(() => []),
  searchMethodSource: vi.fn(() => []),
  describeClass: vi.fn(() => ''),
  referrersOf: vi.fn(),
  classCensus: vi.fn(),
  referenceEdges: vi.fn(),
  fileOutClass: vi.fn(() => ''),
  compileMethod: vi.fn(() => ''),
  compileClassDefinition: vi.fn(() => ''),
  setClassComment: vi.fn(() => ''),
  deleteMethod: vi.fn(() => ''),
  deleteClass: vi.fn(() => ''),
  addDictionary: vi.fn(() => ''),
  removeDictionary: vi.fn(() => ''),
  BrowserQueryError: class extends Error {},
}));
vi.mock('../sunitQueries', () => ({
  runTestMethod: vi.fn(),
  runTestClass: vi.fn(() => []),
  runFailingTests: vi.fn(() => []),
  discoverTestClasses: vi.fn(() => []),
  describeTestFailure: vi.fn(() => ({ status: 'passed' })),
  SunitQueryError: class extends Error {},
}));
vi.mock('../pythonQueries', () => ({
  evalPython: vi.fn(() => ''),
  compilePython: vi.fn(() => ''),
}));

import * as queries from '../browserQueries';
import { registerMcpTools } from '../mcpTools';
import { ActiveSession } from '../sessionManager';

type Handler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

describe('the reference-graph MCP tools', () => {
  let tools: Map<string, Handler>;

  /** Run a tool and hand back the single block of text it answered. */
  const say = async (name: string, args: Record<string, unknown> = {}): Promise<string> =>
    (await tools.get(name)!(args)).content[0].text;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = new Map();
    const server = {
      tool: (name: string, _d: string, _s: unknown, handler: Handler) => tools.set(name, handler),
    };
    registerMcpTools(
      server as unknown as Parameters<typeof registerMcpTools>[0],
      () => ({ id: 1, gci: {}, handle: {}, login: { label: 'T' } }) as unknown as ActiveSession,
    );
  });

  describe('referrers_of', () => {
    it('leads with the totals, then a row per class', () => {
      vi.mocked(queries.referrersOf).mockReturnValue({
        kind: 'ok',
        scanMillis: 24,
        groups: [
          { referrerClass: 'GsNMethod', referrerClassOop: '1', count: 496 },
          { referrerClass: 'ClassHistory', referrerClassOop: '2', count: 3 },
        ],
      });

      return expect(say('referrers_of', { oop: 66817 })).resolves.toBe(
        '499 object(s) from 2 class(es) point at this, scanned in 24ms\n' +
          '  GsNMethod\t496\n' +
          '  ClassHistory\t3',
      );
    });

    it('says nothing points at it, which is a real answer and not an empty one', async () => {
      vi.mocked(queries.referrersOf).mockReturnValue({ kind: 'ok', groups: [], scanMillis: 3 });

      const text = await say('referrers_of', { oop: 1 });

      expect(text).toContain('Nothing in the repository holds a reference');
      // Why, not just that: reachable from a session temp or a stack frame.
      expect(text).toContain('session temporary or a stack frame');
    });

    it('explains a dirty session well enough to act on', async () => {
      // Not an error: a repository-wide scan aborts the session, so GemStone declines
      // rather than discarding the work. The caller has to be told what to do next.
      vi.mocked(queries.referrersOf).mockReturnValue({ kind: 'needsCommit' });

      const text = await say('referrers_of', { oop: 1 });

      expect(text).toContain('aborts the session');
      expect(text).toContain('Commit or abort, then retry');
    });

    it('passes on the stone’s own reason when it declines', async () => {
      vi.mocked(queries.referrersOf).mockReturnValue({
        kind: 'unavailable',
        reason: 'argument is not a Pom oop',
      });

      await expect(say('referrers_of', { oop: 7 })).resolves.toBe(
        'Unavailable: argument is not a Pom oop',
      );
    });

    it('states what it cut rather than reading as the whole list', async () => {
      vi.mocked(queries.referrersOf).mockReturnValue({
        kind: 'ok',
        scanMillis: 30,
        groups: Array.from({ length: 284 }, (_, i) => ({
          referrerClass: `C${i}`,
          referrerClassOop: String(i),
          count: 1,
        })),
      });

      const text = await say('referrers_of', { oop: 1 });

      expect(text).toContain('284 class(es) point at this');
      expect(text).toContain('… 84 more class(es) not listed');
    });
  });

  describe('class_census', () => {
    it('gives each class its dictionary and its population', async () => {
      vi.mocked(queries.classCensus).mockReturnValue({
        kind: 'ok',
        scanMillis: 43,
        classes: [
          { className: 'String', classOop: '1', dictionary: 'Globals', instanceCount: 33771 },
          {
            className: 'DemoEmployee',
            classOop: '2',
            dictionary: 'UserGlobals',
            instanceCount: 1200,
          },
        ],
      });

      const text = await say('class_census', {});

      expect(text).toContain('2 class(es), scanned in 43ms');
      expect(text).toContain('  String\t[Globals]\t33771');
      expect(text).toContain('  DemoEmployee\t[UserGlobals]\t1200');
    });

    it('declines the same way when the session is dirty', async () => {
      vi.mocked(queries.classCensus).mockReturnValue({ kind: 'needsCommit' });

      await expect(say('class_census', {})).resolves.toContain('aborts the session');
    });

    it('says so when there are no classes rather than answering a bare header', async () => {
      vi.mocked(queries.classCensus).mockReturnValue({ kind: 'ok', classes: [], scanMillis: 1 });

      await expect(say('class_census', {})).resolves.toBe('No classes found.');
    });
  });

  describe('reference_edges', () => {
    it('draws the edges among the named classes', async () => {
      vi.mocked(queries.referenceEdges).mockReturnValue({
        kind: 'ok',
        scanMillis: 39,
        edges: [{ from: 'LineItem', fromOop: '1', to: 'Product', toOop: '2', count: 40 }],
        unattributed: [],
      });

      const text = await say('reference_edges', { classNames: ['LineItem', 'Product'] });

      expect(text).toContain('1 edge(s) among the named classes, scanned in 39ms');
      expect(text).toContain('  LineItem --> Product\t40');
    });

    it('reports what points in from outside the set, instead of dropping it', async () => {
      // An ERD showing only the edges among the requested classes is not the whole inbound
      // picture, and saying so is the difference between a diagram and a claim.
      vi.mocked(queries.referenceEdges).mockReturnValue({
        kind: 'ok',
        scanMillis: 39,
        edges: [],
        unattributed: [{ to: 'Product', toOop: '2', count: 26837 }],
      });

      const text = await say('reference_edges', { classNames: ['Product'] });

      expect(text).toContain('Inbound references from classes outside the requested set');
      expect(text).toContain('  (elsewhere) --> Product\t26837');
    });

    it('says plainly when nothing references anything', async () => {
      vi.mocked(queries.referenceEdges).mockReturnValue({
        kind: 'ok',
        edges: [],
        unattributed: [],
        scanMillis: 5,
      });

      await expect(say('reference_edges', { classNames: ['A'] })).resolves.toBe(
        'No references found among the named classes.',
      );
    });
  });
});
