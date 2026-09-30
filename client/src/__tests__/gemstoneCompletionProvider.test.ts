import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  getAllClassNames: vi.fn(() => []),
  getInstVarNames: vi.fn(() => []),
  getAllSelectors: vi.fn(() => []),
}));

import { Uri, CompletionItemKind } from '../__mocks__/vscode';
import type * as vscode from 'vscode';
import { GemStoneCompletionProvider } from '../gemstoneCompletionProvider';
import { SessionManager } from '../sessionManager';
import { getAllClassNames, getInstVarNames, getAllSelectors } from '../browserQueries';

const mockGetAllClassNames = vi.mocked(getAllClassNames);
const mockGetInstVarNames = vi.mocked(getInstVarNames);
const mockGetAllSelectors = vi.mocked(getAllSelectors);

// The provider subscribes to both session-lifecycle events in its constructor, so the
// listeners are captured here and can be fired by the tests that pin what they clear.
interface FakeSessions {
  manager: SessionManager;
  fireSelectionChanged(): void;
  fireSessionRemoved(): void;
}
function makeSessions(hasSession: boolean, selectedId = 1): FakeSessions {
  const listeners: { selection: (() => void)[]; removed: (() => void)[] } = {
    selection: [],
    removed: [],
  };
  const session = (id: number) => ({
    id,
    gci: {},
    handle: `h${id}`,
    login: { label: 'Test' },
    stoneVersion: '3.7.2',
  });
  const manager = {
    getSelectedSession: vi.fn(() => (hasSession ? session(selectedId) : undefined)),
    // Answers for any id asked for, so a test can pin which session the provider
    // looked up rather than only which one was selected.
    getSession: vi.fn((id: number) => (hasSession ? session(id) : undefined)),
    onDidChangeSelection: vi.fn((l: () => void) => {
      listeners.selection.push(l);
      return { dispose: () => {} };
    }),
    onDidRemoveSession: vi.fn((l: () => void) => {
      listeners.removed.push(l);
      return { dispose: () => {} };
    }),
  } as unknown as SessionManager;
  return {
    manager,
    fireSelectionChanged: () => listeners.selection.forEach((l) => l()),
    fireSessionRemoved: () => listeners.removed.forEach((l) => l()),
  };
}
function makeSessionManager(hasSession: boolean): SessionManager {
  return makeSessions(hasSession).manager;
}

function makeDocument(uri: string) {
  return {
    uri: Uri.parse(uri),
    getText: vi.fn(() => ''),
    getWordRangeAtPosition: vi.fn(() => undefined),
  } as unknown as vscode.TextDocument;
}

describe('GemStoneCompletionProvider', () => {
  beforeEach(() => {
    mockGetAllClassNames.mockReset();
    mockGetInstVarNames.mockReset();
    mockGetAllSelectors.mockReset();
    mockGetAllClassNames.mockResolvedValue([]);
    mockGetInstVarNames.mockResolvedValue([]);
    mockGetAllSelectors.mockResolvedValue([]);
  });

  describe('with no session', () => {
    it('returns empty when no session selected', async () => {
      const provider = new GemStoneCompletionProvider(makeSessionManager(false));
      const result = await provider.provideCompletionItems(
        makeDocument('gemstone://1/Globals/Array/instance/accessing/size'),
      );
      expect(result).toEqual([]);
    });
  });

  describe('class name completions', () => {
    it('returns class names from getAllClassNames', async () => {
      mockGetAllClassNames.mockResolvedValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
        { dictIndex: 1, dictName: 'Globals', className: 'String' },
      ]);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = await provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      const classItems = result.filter((i) => i.kind === CompletionItemKind.Class);
      expect(classItems).toHaveLength(2);
      expect(classItems[0].label).toBe('Array');
      expect(classItems[0].detail).toBe('Globals');
      expect(classItems[1].label).toBe('String');
    });

    it('deduplicates class names across dictionaries', async () => {
      mockGetAllClassNames.mockResolvedValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
        { dictIndex: 2, dictName: 'UserGlobals', className: 'Array' },
      ]);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = await provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      const classItems = result.filter((i) => i.kind === CompletionItemKind.Class);
      expect(classItems).toHaveLength(1);
      expect(classItems[0].label).toBe('Array');
      expect(classItems[0].detail).toBe('Globals');
    });

    it('provides class names for file:// documents', async () => {
      mockGetAllClassNames.mockResolvedValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = await provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe(CompletionItemKind.Class);
    });
  });

  describe('instance variable completions', () => {
    it('returns inst vars for gemstone:// documents', async () => {
      mockGetAllClassNames.mockResolvedValue([]);
      mockGetInstVarNames.mockResolvedValue(['name', 'age', 'email']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = await provider.provideCompletionItems(
        makeDocument('gemstone://1/Globals/Person/instance/accessing/name'),
      );

      const fieldItems = result.filter((i) => i.kind === CompletionItemKind.Field);
      expect(fieldItems).toHaveLength(3);
      expect(fieldItems[0].label).toBe('name');
      expect(fieldItems[0].detail).toBe('Person inst var');
      expect(fieldItems[1].label).toBe('age');
      expect(fieldItems[2].label).toBe('email');
    });

    it('does not provide inst vars for file:// documents', async () => {
      mockGetInstVarNames.mockResolvedValue(['name']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = await provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      const fieldItems = result.filter((i) => i.kind === CompletionItemKind.Field);
      expect(fieldItems).toHaveLength(0);
      expect(mockGetInstVarNames).not.toHaveBeenCalled();
    });
  });

  describe('selector completions', () => {
    it('returns selectors for gemstone:// documents', async () => {
      mockGetAllClassNames.mockResolvedValue([]);
      mockGetAllSelectors.mockResolvedValue(['size', 'at:', 'at:put:']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = await provider.provideCompletionItems(
        makeDocument('gemstone://1/Globals/Array/instance/accessing/size'),
      );

      const methodItems = result.filter((i) => i.kind === CompletionItemKind.Method);
      expect(methodItems).toHaveLength(3);
      expect(methodItems[0].label).toBe('size');
      expect(methodItems[1].label).toBe('at:');
      expect(methodItems[2].label).toBe('at:put:');
    });

    it('does not provide selectors for file:// documents', async () => {
      mockGetAllSelectors.mockResolvedValue(['size']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = await provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      const methodItems = result.filter((i) => i.kind === CompletionItemKind.Method);
      expect(methodItems).toHaveLength(0);
      expect(mockGetAllSelectors).not.toHaveBeenCalled();
    });
  });

  describe('caching', () => {
    it('caches class names across calls', async () => {
      mockGetAllClassNames.mockResolvedValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      await provider.provideCompletionItems(makeDocument('file:///test.tpz'));
      await provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      expect(mockGetAllClassNames).toHaveBeenCalledTimes(1);
    });

    it('caches inst vars and selectors per class', async () => {
      mockGetInstVarNames.mockResolvedValue(['x']);
      mockGetAllSelectors.mockResolvedValue(['size']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const doc = makeDocument('gemstone://1/Globals/Array/instance/accessing/size');
      await provider.provideCompletionItems(doc);
      await provider.provideCompletionItems(doc);

      expect(mockGetInstVarNames).toHaveBeenCalledTimes(1);
      expect(mockGetAllSelectors).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache forces re-query', async () => {
      mockGetAllClassNames.mockResolvedValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      await provider.provideCompletionItems(makeDocument('file:///test.tpz'));
      provider.invalidateCache();
      await provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      expect(mockGetAllClassNames).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('returns empty when getAllClassNames throws', async () => {
      mockGetAllClassNames.mockImplementation(() => {
        throw new Error('GCI error');
      });
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = await provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      expect(result).toEqual([]);
    });

    it('returns class names when getInstVarNames throws', async () => {
      mockGetAllClassNames.mockResolvedValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      mockGetInstVarNames.mockImplementation(() => {
        throw new Error('GCI error');
      });
      mockGetAllSelectors.mockResolvedValue(['size']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = await provider.provideCompletionItems(
        makeDocument('gemstone://1/Globals/Array/instance/accessing/size'),
      );

      const classItems = result.filter((i) => i.kind === CompletionItemKind.Class);
      const fieldItems = result.filter((i) => i.kind === CompletionItemKind.Field);
      const methodItems = result.filter((i) => i.kind === CompletionItemKind.Method);
      expect(classItems).toHaveLength(1);
      expect(fieldItems).toHaveLength(0);
      expect(methodItems).toHaveLength(1);
    });

    it('returns class names when getAllSelectors throws', async () => {
      mockGetAllClassNames.mockResolvedValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      mockGetInstVarNames.mockResolvedValue(['x']);
      mockGetAllSelectors.mockImplementation(() => {
        throw new Error('GCI error');
      });
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = await provider.provideCompletionItems(
        makeDocument('gemstone://1/Globals/Array/instance/accessing/size'),
      );

      const classItems = result.filter((i) => i.kind === CompletionItemKind.Class);
      const fieldItems = result.filter((i) => i.kind === CompletionItemKind.Field);
      const methodItems = result.filter((i) => i.kind === CompletionItemKind.Method);
      expect(classItems).toHaveLength(1);
      expect(fieldItems).toHaveLength(1);
      expect(methodItems).toHaveLength(0);
    });
  });

  describe('URI parsing', () => {
    it('extracts class name from gemstone:// URI', async () => {
      mockGetAllClassNames.mockResolvedValue([]);
      mockGetInstVarNames.mockResolvedValue(['x']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      await provider.provideCompletionItems(
        makeDocument('gemstone://1/Globals/MyClass/instance/accessing/foo'),
      );

      expect(mockGetInstVarNames).toHaveBeenCalledWith(expect.anything(), 'MyClass');
    });

    it('decodes percent-encoded class names', async () => {
      mockGetAllClassNames.mockResolvedValue([]);
      mockGetInstVarNames.mockResolvedValue([]);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      await provider.provideCompletionItems(
        makeDocument('gemstone://1/My%20Dict/My%20Class/instance/cat/sel'),
      );

      expect(mockGetInstVarNames).toHaveBeenCalledWith(expect.anything(), 'My Class');
    });

    it('handles definition URIs without class context methods', async () => {
      mockGetAllClassNames.mockResolvedValue([]);
      mockGetInstVarNames.mockResolvedValue(['x']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      await provider.provideCompletionItems(makeDocument('gemstone://1/Globals/Array/definition'));

      // Should still extract "Array" as class name
      expect(mockGetInstVarNames).toHaveBeenCalledWith(expect.anything(), 'Array');
    });
  });
});

// The three caches are only correct while the image they were read from is, and the
// stone announces nothing. invalidateCache had exactly one caller in the whole client
// — the palette-only "Refresh Browser" command, named after a browser Jasper no longer
// uses — so nothing an Explorer surface could reach ever cleared them: compile a new
// method, press Refresh GemStone Explorer, and completion kept serving whatever it
// fetched on the session's first request.
describe('when the cached answers stop being true', () => {
  // These describes sit outside the file's main one, so its mock reset does not reach
  // them: without this, query calls accumulate across tests and the counts below are
  // whatever ran before them.
  beforeEach(() => {
    mockGetAllClassNames.mockReset().mockResolvedValue([]);
    mockGetInstVarNames.mockReset().mockResolvedValue([]);
    mockGetAllSelectors.mockReset().mockResolvedValue([]);
  });

  const doc = () => makeDocument('gemstone://1/Globals/Array/instance/accessing/size');

  async function primed(selectedId = 1) {
    const sessions = makeSessions(true, selectedId);
    const provider = new GemStoneCompletionProvider(sessions.manager);
    mockGetAllSelectors.mockResolvedValue(['size']);
    mockGetInstVarNames.mockResolvedValue(['contents']);
    mockGetAllClassNames.mockResolvedValue([
      { className: 'Array', dictName: 'Globals', dictIndex: 1 },
    ]);
    await provider.provideCompletionItems(doc());
    // Everything is cached now, so a second request must not reach the stone at all.
    mockGetAllSelectors.mockClear();
    mockGetInstVarNames.mockClear();
    mockGetAllClassNames.mockClear();
    await provider.provideCompletionItems(doc());
    expect(mockGetAllSelectors).not.toHaveBeenCalled();
    expect(mockGetAllClassNames).not.toHaveBeenCalled();
    return { provider, sessions };
  }

  it('caches, so the assertions below are about invalidation and not about misses', async () => {
    await primed();
  });

  it('refetches one class after a compile, without dropping the class list', async () => {
    const { provider } = await primed();

    provider.invalidateForCompiledUri(Uri.parse('gemstone://1/Globals/Array/instance/x/y'));
    await provider.provideCompletionItems(doc());

    // The compiled class is re-read…
    expect(mockGetAllSelectors).toHaveBeenCalledTimes(1);
    expect(mockGetInstVarNames).toHaveBeenCalledTimes(1);
    // …and the image-wide class list, much the most expensive of the three, is not.
    expect(mockGetAllClassNames).not.toHaveBeenCalled();
  });

  it('also drops the class list when a class DEFINITION was compiled', async () => {
    const { provider } = await primed();

    provider.invalidateForCompiledUri(Uri.parse('gemstone://1/Globals/Array/definition'), true);
    await provider.provideCompletionItems(doc());

    // A definition compile can introduce a name the list has never seen.
    expect(mockGetAllClassNames).toHaveBeenCalledTimes(1);
  });

  // The URI carries the session it belongs to in its authority, and that is the session
  // whose entry goes: with two sessions open the compile can land on the one that is NOT
  // selected, and clearing the selected session's entry instead would leave the stale
  // entry sitting in the cache behind a cache that had visibly been cleared.
  it("drops the compiled session's class, not the selected session's", async () => {
    const { provider } = await primed(2);

    provider.invalidateForCompiledUri(Uri.parse('gemstone://1/Globals/Array/instance/x/y'));
    await provider.provideCompletionItems(doc());

    // Session 2's Array was never stale, so it is still served from the cache.
    expect(mockGetAllSelectors).not.toHaveBeenCalled();
    expect(mockGetInstVarNames).not.toHaveBeenCalled();
  });

  it('leaves another class alone when one class is compiled', async () => {
    const { provider } = await primed();

    provider.invalidateForCompiledUri(Uri.parse('gemstone://1/Globals/Other/instance/x/y'));
    await provider.provideCompletionItems(doc());

    expect(mockGetAllSelectors).not.toHaveBeenCalled();
  });

  it('clears everything when the selected session changes', async () => {
    const { provider, sessions } = await primed();

    sessions.fireSelectionChanged();
    await provider.provideCompletionItems(doc());

    expect(mockGetAllClassNames).toHaveBeenCalledTimes(1);
    expect(mockGetAllSelectors).toHaveBeenCalledTimes(1);
  });

  // Also the only bound on how much these maps hold: there is no LRU and no TTL, so a
  // long session otherwise accumulated a selector array per class ever browsed.
  it('clears everything when a session is removed', async () => {
    const { provider, sessions } = await primed();

    sessions.fireSessionRemoved();
    await provider.provideCompletionItems(doc());

    expect(mockGetAllClassNames).toHaveBeenCalledTimes(1);
    expect(mockGetAllSelectors).toHaveBeenCalledTimes(1);
  });
});

// provideCompletionItems is synchronous, so the FIRST request for a class paid
// getAllSelectors and getInstVarNames inline, on the keystroke. Selecting a class in
// the Explorer is the strongest signal its methods are about to be read, so the fetch
// moves there — off the gesture, and debounced so clicking through classes does not
// fire one per row passed through.
describe('warming a class ahead of the first request', () => {
  // These describes sit outside the file's main one, so its mock reset does not reach
  // them: without this, query calls accumulate across tests and the counts below are
  // whatever ran before them.
  beforeEach(() => {
    mockGetAllClassNames.mockReset().mockResolvedValue([]);
    mockGetInstVarNames.mockReset().mockResolvedValue([]);
    mockGetAllSelectors.mockReset().mockResolvedValue([]);
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });
  // In afterEach, not at the end of each test: a failing assertion would otherwise skip
  // the restore and leave the clock faked for whatever ran next — and within-file order
  // is shuffled (sequence.shuffle in vitest.config.ts), so WHICH describe inherited it
  // would be a per-seed lottery. useRealTimers rather than clearAllTimers, which drains
  // the pending queue but leaves the fake clock installed: it uninstalls the clock and
  // discards the queue with it, so a prime still pending cannot fire inside another test
  // — which it did, and the shuffling made it look intermittent.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not touch the stone on the selection itself', () => {
    const provider = new GemStoneCompletionProvider(makeSessionManager(true));

    provider.primeClass(1, 'Array');

    expect(mockGetAllSelectors).not.toHaveBeenCalled();
    expect(mockGetInstVarNames).not.toHaveBeenCalled();
  });

  it('fetches once the selection settles', async () => {
    const provider = new GemStoneCompletionProvider(makeSessionManager(true));

    provider.primeClass(1, 'Array');
    await vi.runAllTimersAsync();

    expect(mockGetAllSelectors).toHaveBeenCalledWith(expect.anything(), 'Array');
    expect(mockGetInstVarNames).toHaveBeenCalledWith(expect.anything(), 'Array');
  });

  it('fetches only the class landed on when several are clicked through', async () => {
    const provider = new GemStoneCompletionProvider(makeSessionManager(true));

    provider.primeClass(1, 'First');
    provider.primeClass(1, 'Second');
    provider.primeClass(1, 'Third');
    await vi.runAllTimersAsync();

    expect(mockGetAllSelectors).toHaveBeenCalledTimes(1);
    expect(mockGetAllSelectors).toHaveBeenCalledWith(expect.anything(), 'Third');
  });

  it('makes the first real request free, which is the point', async () => {
    const provider = new GemStoneCompletionProvider(makeSessionManager(true));
    mockGetAllSelectors.mockResolvedValue(['size']);

    provider.primeClass(1, 'Array');
    await vi.runAllTimersAsync();
    mockGetAllSelectors.mockClear();
    await provider.provideCompletionItems(
      makeDocument('gemstone://1/Globals/Array/instance/a/size'),
    );

    expect(mockGetAllSelectors).not.toHaveBeenCalled();
  });

  // The prime is a quarter-second behind the gesture, so the selection can have moved
  // to another session by the time it fires. It warms the session the class was
  // selected in, which is the one whose completions the user is about to ask for.
  it('warms the session it was handed, not whichever is selected when it fires', async () => {
    const sessions = makeSessions(true, 1);
    const provider = new GemStoneCompletionProvider(sessions.manager);

    provider.primeClass(7, 'Array');
    await vi.runAllTimersAsync();

    expect(mockGetAllSelectors).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'Array');
    expect(mockGetInstVarNames).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), 'Array');
  });

  it('does nothing for a session that went away while the prime waited', async () => {
    const sessions = makeSessions(false);
    const provider = new GemStoneCompletionProvider(sessions.manager);

    provider.primeClass(7, 'Array');
    await vi.runAllTimersAsync();

    expect(mockGetAllSelectors).not.toHaveBeenCalled();
  });

  it('drops a prime that has not fired yet when disposed', async () => {
    const provider = new GemStoneCompletionProvider(makeSessionManager(true));

    provider.primeClass(1, 'Array');
    provider.dispose();
    await vi.runAllTimersAsync();

    expect(mockGetAllSelectors).not.toHaveBeenCalled();
  });
});
