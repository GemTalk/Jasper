import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

const quiet = vi.hoisted(() => ({ on: false }));
vi.mock('../browserQueries', async (importOriginal) => ({
  BrowserQueryError: (await importOriginal<typeof import('../browserQueries')>()).BrowserQueryError,
  isBusyRefusal: (await importOriginal<typeof import('../browserQueries')>()).isBusyRefusal,
  quietly: <T>(query: () => T): T => {
    quiet.on = true;
    try {
      return query();
    } finally {
      quiet.on = false;
    }
  },
  implementorsOf: vi.fn(() => []),
  sendersOf: vi.fn(() => []),
  getAllClassNames: vi.fn(() => []),
  getClassComment: vi.fn(() => ''),
}));

import {
  EventEmitter,
  Position,
  Range,
  MarkdownString,
  Uri,
  __setConfig,
  __resetConfig,
} from '../__mocks__/vscode';
import type * as vscode from 'vscode';
import { GemStoneHoverProvider as RealHoverProvider } from '../gemstoneHoverProvider';
import { SelectorResolver } from '../selectorProviders';
import { SessionManager } from '../sessionManager';
import {
  BrowserQueryError,
  implementorsOf,
  sendersOf,
  getAllClassNames,
  getClassComment,
} from '../browserQueries';
import { GCI_ERR_OP_IN_PROGRESS } from '../gciConstants';
import { fakeActiveSession } from './fakeActiveSession';
import { announceMethodsChanged } from '../methodsChanged';

// Each provider listens for method changes; disposed after each test so none outlives it.
const providers: RealHoverProvider[] = [];
class GemStoneHoverProvider extends RealHoverProvider {
  constructor(...args: ConstructorParameters<typeof RealHoverProvider>) {
    super(...args);
    providers.push(this);
  }
}
afterEach(() => {
  providers.splice(0).forEach((p) => p.dispose());
});

const busyRefusal = () => new BrowserQueryError('Session is busy', GCI_ERR_OP_IN_PROGRESS);

const mockImplementorsOf = vi.mocked(implementorsOf);
const mockSendersOf = vi.mocked(sendersOf);
const mockGetAllClassNames = vi.mocked(getAllClassNames);
const mockGetClassComment = vi.mocked(getClassComment);

const pos = (line: number, char: number) => new Position(line, char) as unknown as vscode.Position;

const fakeSession = (id: number) =>
  fakeActiveSession({ id, gci: {}, handle: {}, login: { label: 'Test' }, stoneVersion: '3.7.2' });

// Session 1 is selected; `others` are logged in alongside it.
function makeSessionManager(hasSession: boolean, others: number[] = []) {
  const selected = hasSession ? fakeSession(1) : undefined;
  const sessions = [...(selected ? [selected] : []), ...others.map(fakeSession)];
  return {
    getSelectedSession: vi.fn(() => selected),
    getSessions: vi.fn(() => sessions),
    onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
  } as unknown as SessionManager;
}

function makeDocument(text: string) {
  const lines = text.split('\n');
  return {
    uri: { toString: () => 'gemstone://1/Globals/Array/instance/accessing/size' },
    getText(range?: Range) {
      if (!range) return text;
      return lines[range.start.line].substring(range.start.character, range.end.character);
    },
    getWordRangeAtPosition(p: Position) {
      const line = lines[p.line] || '';
      let start = p.character;
      let end = p.character;
      while (start > 0 && /\w/.test(line[start - 1])) start--;
      while (end < line.length && /\w/.test(line[end])) end++;
      if (start === end) return undefined;
      return new Range(new Position(p.line, start), new Position(p.line, end));
    },
  } as unknown as vscode.TextDocument;
}

describe('GemStoneHoverProvider', () => {
  beforeEach(() => {
    __resetConfig();
    mockImplementorsOf.mockReset();
    mockSendersOf.mockReset();
    mockGetAllClassNames.mockReset();
    mockGetClassComment.mockReset();
    mockImplementorsOf.mockReturnValue([]);
    mockSendersOf.mockReturnValue([]);
    mockGetAllClassNames.mockReturnValue([]);
    mockGetClassComment.mockReturnValue('');
  });

  describe('with no session', () => {
    it('returns null when no session selected', async () => {
      const provider = new GemStoneHoverProvider(makeSessionManager(false));
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));
      expect(result).toBeNull();
    });
  });

  describe('which session answers', () => {
    const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
    const docAt = (uri: string): vscode.TextDocument =>
      Object.assign(makeDocument('self size'), { uri: Uri.parse(uri) });

    it('counts senders in the session a stone method was opened from, not the selected one', async () => {
      mockSendersOf.mockReturnValue([{} as never]);
      const provider = new GemStoneHoverProvider(makeSessionManager(true, [2]), resolver);

      const hover = await provider.provideHover(
        docAt('gemstone://2/Globals/Array/instance/accessing/size'),
        pos(0, 5),
      );

      expect(mockSendersOf).toHaveBeenCalled();
      expect(mockSendersOf.mock.calls.every(([s]) => s.id === 2)).toBe(true);
      expect(mockImplementorsOf.mock.calls.every(([s]) => s.id === 2)).toBe(true);
      // The Browse senders link must open the same session's list the count came from.
      const md = hover!.contents as unknown as MarkdownString;
      expect(decodeURIComponent(md.value)).toContain('"sessionId":2');
    });

    it('shows nothing for a stone method whose session has logged out', async () => {
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);

      const hover = await provider.provideHover(
        docAt('gemstone://2/Globals/Array/instance/accessing/size'),
        pos(0, 5),
      );

      expect(hover).toBeNull();
      expect(mockSendersOf).not.toHaveBeenCalled();
    });

    it('asks the selected session from a file on disk', async () => {
      const provider = new GemStoneHoverProvider(makeSessionManager(true, [2]), resolver);

      await provider.provideHover(docAt('file:///project/kernel.gs'), pos(0, 5));

      expect(mockSendersOf).toHaveBeenCalled();
      expect(mockSendersOf.mock.calls.every(([s]) => s.id === 1)).toBe(true);
    });
  });

  describe('selector hover', () => {
    it('shows implementors with categories, plus clickable senders/implementors links', async () => {
      mockImplementorsOf.mockReturnValue([
        {
          dictName: 'Globals',
          className: 'Array',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
          environmentId: 0,
        },
        {
          dictName: 'Globals',
          className: 'String',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
          environmentId: 0,
        },
      ]);
      mockSendersOf.mockReturnValue(Array.from({ length: 7 }, () => ({}) as never));
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      expect(result).not.toBeNull();
      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('**#size**');
      // #432: counts are clickable command links, not plain text.
      expect(md.value).toContain('7 senders](command:gemstone.sendersOfSelector?');
      expect(md.value).toContain('2 implementors](command:gemstone.implementorsOfSelector?');
      expect(md.isTrusted).toBe(true); // command: links only fire from a trusted hover
      expect(md.value).toContain('`Array` (accessing)');
      expect(md.value).toContain('`String` (accessing)');
    });

    it('lists implementors in the shared method order, not the order the stone found them', async () => {
      const row = (className: string, isMeta: boolean) => ({
        dictName: 'Globals',
        className,
        isMeta,
        selector: 'size',
        category: 'accessing',
        environmentId: 0,
      });
      mockImplementorsOf.mockReturnValue([
        row('Zed', false),
        row('array', true),
        row('_Private', false),
        row('array', false),
      ]);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      const md = result!.contents as unknown as MarkdownString;
      const listed = md.value.split('\n').filter((l) => l.startsWith('- '));
      expect(listed).toEqual([
        '- `_Private` (accessing)',
        '- `array` (accessing)',
        '- `array class` (accessing)',
        '- `Zed` (accessing)',
      ]);
    });

    it('shows a hover with just a senders link when the selector has no implementors', async () => {
      mockImplementorsOf.mockReturnValue([]);
      mockSendersOf.mockReturnValue(Array.from({ length: 3 }, () => ({}) as never));
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'onlySent') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self onlySent'), pos(0, 5));

      expect(result).not.toBeNull();
      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('3 senders](command:gemstone.sendersOfSelector?');
      expect(md.value).toContain('0 implementors](command:gemstone.implementorsOfSelector?');
    });

    it('sweeps environments 0..maxEnvironment rather than asking the ceiling alone', async () => {
      // maxEnvironment is a CEILING. Asking environment 1 alone answered no senders and no
      // implementors for every selector -- almost nothing is compiled above 0 -- and a hover
      // with nothing to report returns null, so the senders/implementors line simply vanished.
      __setConfig('gemstone', 'maxEnvironment', 1);
      mockImplementorsOf.mockImplementation((_session, _selector, env) =>
        env === 0
          ? [
              {
                dictName: 'Globals',
                className: 'Array',
                isMeta: false,
                selector: 'size',
                category: 'accessing',
                environmentId: 0,
              },
            ]
          : [],
      );
      mockSendersOf.mockImplementation((_session, _selector, env) =>
        env === 0 ? Array.from({ length: 5 }, () => ({}) as never) : [],
      );
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      expect(mockImplementorsOf.mock.calls.map((c) => c[2])).toEqual([0, 1]);
      expect(mockSendersOf.mock.calls.map((c) => c[2])).toEqual([0, 1]);
      expect(result).not.toBeNull();
      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('5 senders](command:gemstone.sendersOfSelector?');
      expect(md.value).toContain('1 implementor](command:gemstone.implementorsOfSelector?');
    });

    it('adds up the counts found across environments', async () => {
      __setConfig('gemstone', 'maxEnvironment', 1);
      mockImplementorsOf.mockImplementation((_session, _selector, env = 0) => [
        {
          dictName: 'Globals',
          className: env === 0 ? 'Array' : 'String',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
          environmentId: env,
        },
      ]);
      mockSendersOf.mockImplementation(() => Array.from({ length: 2 }, () => ({}) as never));
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('4 senders](command:gemstone.sendersOfSelector?');
      expect(md.value).toContain('2 implementors](command:gemstone.implementorsOfSelector?');
      expect(md.value).toContain('`Array` (accessing)');
      expect(md.value).toContain('`String` (accessing)');
    });

    it('lists what the other environments found, but shows no counts, when one of them throws', async () => {
      // The guard sits inside the sweep, not around it: a throw in the last environment used
      // to discard the rows the earlier ones had already returned.
      __setConfig('gemstone', 'maxEnvironment', 2);
      mockImplementorsOf.mockImplementation((_session, _selector, env) => {
        if (env === 2) throw new Error('session busy');
        return [
          {
            dictName: 'Globals',
            className: env === 0 ? 'Array' : 'String',
            isMeta: false,
            selector: 'size',
            category: 'accessing',
            environmentId: env as number,
          },
        ];
      });
      mockSendersOf.mockImplementation((_session, _selector, env) => {
        if (env === 2) throw new Error('session busy');
        return Array.from({ length: 3 }, () => ({}) as never);
      });
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('$(symbol-method) implementors](command:');
      expect(md.value).toContain('$(references) senders](command:');
      expect(md.value).toContain('`Array` (accessing)');
      expect(md.value).toContain('`String` (accessing)');
    });

    it('does not ask for senders again after a failure, until methods change', async () => {
      const methodsChanged = new EventEmitter<void>();
      __setConfig('gemstone', 'maxEnvironment', 1);
      let failing = true;
      mockSendersOf.mockImplementation((_session, _selector, env) => {
        if (env === 1 && failing) throw new Error('The connection to the gem was lost');
        return Array.from({ length: 2 }, () => ({}) as never);
      });
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(
        makeSessionManager(true),
        resolver,
        methodsChanged.event,
      );
      await provider.provideHover(makeDocument('self size'), pos(0, 5));
      failing = false;

      const again = await provider.provideHover(makeDocument('self size'), pos(0, 5));
      expect((again!.contents as unknown as MarkdownString).value).toContain(
        '$(references) senders](command:gemstone.sendersOfSelector?',
      );
      expect(mockSendersOf).toHaveBeenCalledTimes(2);

      methodsChanged.fire();
      const after = await provider.provideHover(makeDocument('self size'), pos(0, 5));
      expect((after!.contents as unknown as MarkdownString).value).toContain(
        '4 senders](command:gemstone.sendersOfSelector?',
      );
    });

    it('shows nothing while the session is busy', async () => {
      mockImplementorsOf.mockImplementation(() => {
        throw busyRefusal();
      });
      mockSendersOf.mockImplementation(() => {
        throw busyRefusal();
      });
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);

      expect(await provider.provideHover(makeDocument('self size'), pos(0, 5))).toBeNull();
    });

    it('shows nothing when only the senders lookup is refused as busy', async () => {
      mockImplementorsOf.mockReturnValue([
        {
          dictName: 'Globals',
          className: 'Array',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
          environmentId: 0,
        },
      ]);
      mockSendersOf.mockImplementation(() => {
        throw busyRefusal();
      });
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);

      expect(await provider.provideHover(makeDocument('self size'), pos(0, 5))).toBeNull();
    });

    it('asks for senders again once the busy session frees up', async () => {
      mockSendersOf
        .mockImplementationOnce(() => {
          throw busyRefusal();
        })
        .mockReturnValue([{}, {}] as never);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      await provider.provideHover(makeDocument('self size'), pos(0, 5));

      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      expect((result!.contents as unknown as MarkdownString).value).toContain(
        '2 senders](command:gemstone.sendersOfSelector?',
      );
    });

    it('counts senders again once methods change on the stone', async () => {
      const methodsChanged = new EventEmitter<void>();
      mockSendersOf.mockReturnValueOnce([{} as never]).mockReturnValue([{}, {}] as never);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(
        makeSessionManager(true),
        resolver,
        methodsChanged.event,
      );
      await provider.provideHover(makeDocument('self size'), pos(0, 5));

      methodsChanged.fire();
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      expect((result!.contents as unknown as MarkdownString).value).toContain(
        '2 senders](command:gemstone.sendersOfSelector?',
      );
    });

    it('stops listening for method changes once disposed', () => {
      const release = vi.fn();
      const provider = new GemStoneHoverProvider(makeSessionManager(true), undefined, () => ({
        dispose: release,
      }));

      provider.dispose();

      expect(release).toHaveBeenCalledTimes(1);
    });

    it('names the environment on an implementor found above 0', async () => {
      // Two environments can implement the same selector on the same class. Both rows are
      // kept on purpose, so without the suffix the list shows the same line twice.
      __setConfig('gemstone', 'maxEnvironment', 1);
      mockImplementorsOf.mockImplementation((_session, _selector, env) => [
        {
          dictName: 'Globals',
          className: 'Array',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
          environmentId: env as number,
        },
      ]);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('- `Array` (accessing)\n');
      expect(md.value).toContain('- `Array` (accessing) · env 1\n');
    });

    it('still shows the senders count when the implementors lookup throws', async () => {
      // A thrown GCI query (busy session, browser/RB plugin absent) must not reject
      // the whole hover and silently show nothing.
      mockImplementorsOf.mockImplementation(() => {
        throw new Error('session busy');
      });
      mockSendersOf.mockReturnValue(Array.from({ length: 4 }, () => ({}) as never));
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      expect(result).not.toBeNull();
      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('4 senders](command:gemstone.sendersOfSelector?');
      expect(md.value).toContain('$(symbol-method) implementors](command:');
    });

    it("says in a link's tooltip why its count is unavailable", async () => {
      mockImplementorsOf.mockReturnValue([]);
      mockSendersOf.mockImplementation(() => {
        throw new Error('The connection to the gem was lost');
      });
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toMatch(
        /senders\]\(command:gemstone\.sendersOfSelector\?\S+ "Count unavailable: The connection to the gem was lost"\)/,
      );
    });

    it("says in the implementors link's tooltip why its count is unavailable", async () => {
      mockImplementorsOf.mockImplementation(() => {
        throw new Error('The connection to the gem was lost');
      });
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toMatch(
        /implementors\]\(command:gemstone\.implementorsOfSelector\?\S+ "Count unavailable: The connection to the gem was lost"\)/,
      );
    });

    it('keeps the link whole when the error has quote marks in it', async () => {
      mockSendersOf.mockImplementation(() => {
        throw new Error('a "Foo" does not understand #bar');
      });
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toMatch(
        /senders\]\(command:gemstone\.sendersOfSelector\?\S+ "Count unavailable: a \\"Foo\\" does not understand #bar"\)/,
      );
    });

    it('keeps the link whole when the error spans lines or ends in a backslash', async () => {
      mockSendersOf.mockImplementation(() => {
        throw new Error('line one\n\nline two \\');
      });
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('"Count unavailable: line one line two \\\\")');
    });

    it('says what was thrown when it is not an Error', async () => {
      mockSendersOf.mockImplementation(() => {
        throw 'gem gone';
      });
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      expect((result!.contents as unknown as MarkdownString).value).toContain(
        '"Count unavailable: gem gone"',
      );
    });

    it('gives the first failure when several environments fail', async () => {
      __setConfig('gemstone', 'maxEnvironment', 1);
      mockSendersOf.mockImplementation((_session, _selector, env) => {
        throw new Error(env === 0 ? 'first' : 'second');
      });
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      expect((result!.contents as unknown as MarkdownString).value).toContain(
        '"Count unavailable: first"',
      );
    });

    it('counts senders again when any part of Jasper announces that methods changed', async () => {
      mockSendersOf.mockReturnValueOnce([{} as never]).mockReturnValue([{}, {}] as never);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      await provider.provideHover(makeDocument('self size'), pos(0, 5));

      announceMethodsChanged();
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      expect((result!.contents as unknown as MarkdownString).value).toContain(
        '2 senders](command:gemstone.sendersOfSelector?',
      );
    });

    it('shows the links without counts, rather than nothing, when both lookups fail', async () => {
      mockImplementorsOf.mockImplementation(() => {
        throw new Error('The connection to the gem was lost');
      });
      mockSendersOf.mockImplementation(() => {
        throw new Error('The connection to the gem was lost');
      });
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      expect(result).not.toBeNull();
      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('$(references) senders](command:');
      expect(md.value).toContain('$(symbol-method) implementors](command:');
    });

    it('shows singular "implementor" for one result', async () => {
      mockImplementorsOf.mockReturnValue([
        {
          dictName: 'Globals',
          className: 'Array',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
          environmentId: 0,
        },
      ]);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('1 implementor](command:gemstone.implementorsOfSelector?');
    });

    it('shows "class" suffix for class-side implementors', async () => {
      mockImplementorsOf.mockReturnValue([
        {
          dictName: 'Globals',
          className: 'Array',
          isMeta: true,
          selector: 'new',
          category: 'creation',
          environmentId: 0,
        },
      ]);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'new') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('Array new'), pos(0, 6));

      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('`Array class` (creation)');
    });

    it('truncates to 10 and shows "...and N more"', async () => {
      const results = Array.from({ length: 15 }, (_, i) => ({
        dictName: 'Globals',
        className: `Class${i}`,
        isMeta: false,
        selector: 'size',
        category: 'accessing',
        environmentId: 0,
      }));
      mockImplementorsOf.mockReturnValue(results);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('15 implementors](command:gemstone.implementorsOfSelector?');
      expect(md.value).toContain('Class9');
      expect(md.value).not.toContain('Class10');
      expect(md.value).toContain('...and 5 more');
    });

    it('returns null when no implementors found', async () => {
      mockImplementorsOf.mockReturnValue([]);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'noSuchMethod') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self noSuchMethod'), pos(0, 5));

      expect(result).toBeNull();
    });

    it('passes maxEnvironment to implementorsOf', async () => {
      __setConfig('gemstone', 'maxEnvironment', 2);
      mockImplementorsOf.mockReturnValue([
        {
          dictName: 'Globals',
          className: 'Array',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
          environmentId: 0,
        },
      ]);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      await provider.provideHover(makeDocument('self size'), pos(0, 5));

      expect(mockImplementorsOf).toHaveBeenCalledWith(expect.anything(), 'size', 2);
    });

    it('handles selector resolver throwing', async () => {
      const resolver: SelectorResolver = {
        getSelector: vi.fn(async () => {
          throw new Error('fail');
        }),
      };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('foo'), pos(0, 0));

      // Falls through to class name check, which returns null for lowercase
      expect(result).toBeNull();
    });
  });

  // A busy session would otherwise raise the Stop notice as the mouse moves.
  it('asks the stone quietly, for a selector and for a class', async () => {
    const quietly: boolean[] = [];
    const record =
      <T>(answer: T) =>
      () => {
        quietly.push(quiet.on);
        return answer;
      };
    mockImplementorsOf.mockImplementation(record([]));
    mockSendersOf.mockImplementation(record([]));
    mockGetAllClassNames.mockImplementation(
      record([{ dictIndex: 1, dictName: 'Globals', className: 'Array' }]),
    );
    mockGetClassComment.mockImplementation(record('a comment'));
    const onSelector: SelectorResolver = { getSelector: vi.fn(async () => 'quietlyAsked') };
    const onClass: SelectorResolver = { getSelector: vi.fn(async () => null) };

    await new GemStoneHoverProvider(makeSessionManager(true), onSelector).provideHover(
      makeDocument('self quietlyAsked'),
      pos(0, 5),
    );
    await new GemStoneHoverProvider(makeSessionManager(true), onClass).provideHover(
      makeDocument('Array new'),
      pos(0, 0),
    );

    expect(quietly.length).toBeGreaterThanOrEqual(4);
    expect(quietly.every(Boolean)).toBe(true);
  });

  describe('class name hover', () => {
    it('shows class name with dictionary and comment', async () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      mockGetClassComment.mockReturnValue(
        'Instances of Array are variable-length ordered collections.',
      );
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => null) };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('Array new'), pos(0, 0));

      expect(result).not.toBeNull();
      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('**Array**');
      expect(md.value).toContain('*Globals*');
      expect(md.value).toContain('variable-length ordered collections');
    });

    it('truncates long comments to 500 characters', async () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      const longComment = 'A'.repeat(600);
      mockGetClassComment.mockReturnValue(longComment);
      const provider = new GemStoneHoverProvider(makeSessionManager(true));
      const result = await provider.provideHover(makeDocument('Array new'), pos(0, 0));

      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('A'.repeat(500) + '...');
      expect(md.value).not.toContain('A'.repeat(501));
    });

    it('shows hover even when comment is empty', async () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      mockGetClassComment.mockReturnValue('');
      const provider = new GemStoneHoverProvider(makeSessionManager(true));
      const result = await provider.provideHover(makeDocument('Array new'), pos(0, 0));

      expect(result).not.toBeNull();
      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('**Array**');
      expect(md.value).toContain('*Globals*');
    });

    it('returns null for lowercase words', async () => {
      const provider = new GemStoneHoverProvider(makeSessionManager(true));
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 0));

      expect(result).toBeNull();
    });

    it('returns null for unknown class names', async () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      const provider = new GemStoneHoverProvider(makeSessionManager(true));
      const result = await provider.provideHover(makeDocument('NoSuchClass new'), pos(0, 0));

      expect(result).toBeNull();
    });

    it('handles getClassComment throwing', async () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      mockGetClassComment.mockImplementation(() => {
        throw new Error('not found');
      });
      const provider = new GemStoneHoverProvider(makeSessionManager(true));
      const result = await provider.provideHover(makeDocument('Array new'), pos(0, 0));

      // Should still return hover with class name, just no comment
      expect(result).not.toBeNull();
      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('**Array**');
    });
  });
});
