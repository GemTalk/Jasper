import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

// The engine is expensive and session-bound; stub it so we can count how often the provider (re)builds
// one. Each build reflects a fresh read of the live config, which is exactly what these tests assert.
vi.mock('../omniEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../omniEngine')>()),
  createOmniEngine: vi.fn(() => ({
    prime: vi.fn(async () => {}),
    applyChange: vi.fn(async () => null),
    resync: vi.fn(async () => null),
    refresh: vi.fn(async () => null),
    search: vi.fn(async () => null),
    state: () => ({ scopeId: null, caseSensitive: false }),
    submit: vi.fn(async () => null),
    lastRegexAnswer: vi.fn(() => null),
    dispose: vi.fn(() => false),
  })),
}));

import { createOmniEngine } from '../omniEngine';
import {
  OmniSearchViewProvider,
  OmniViewContext,
  REVEAL_DEADLINE_MS,
} from '../omniSearchViewProvider';

function fakeContext(sessionId = 1): OmniViewContext {
  const config = {
    matchMode: 'fuzzy',
    caseSensitive: false,
    enabledCategories: [],
    maxResultsPerCategory: 50,
    debounceMs: 0,
    methodMinQueryLength: 1,
    referencesInPreview: false,
  };
  // The engine is mocked, so only `config` is read here; cast past the unused `OmniPanelDeps` members.
  return { deps: { config, onError: vi.fn() }, sessionId } as unknown as OmniViewContext;
}

/** The provider registers its webview callback as `void this.onMessage(m)`, so awaiting a message
 *  returns the moment the handler suspends, not when it finishes. Yield a macrotask to let it run to
 *  the end — otherwise an in-flight `ready` handler picks up work the test has not posted yet, or the
 *  assertion runs before the handler's last `postMessage`. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeView(visible: boolean) {
  const on = { message: (_m: unknown) => Promise.resolve(), visibility: () => {} };
  const view = {
    visible,
    webview: {
      options: {},
      html: '',
      onDidReceiveMessage: (cb: (m: unknown) => unknown) => {
        on.message = cb as (m: unknown) => Promise<void>;
        return { dispose() {} };
      },
      postMessage: vi.fn(),
    },
    onDidChangeVisibility: (cb: () => void) => {
      on.visibility = cb;
      return { dispose() {} };
    },
  };
  return { view, on };
}

describe('GemStone Search docked panel — reacting to settings changes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rebuilds the engine when a setting changes while the panel is open, so the edit takes effect', async () => {
    const resolveContext = vi.fn(async () => fakeContext());
    const provider = new OmniSearchViewProvider(resolveContext);
    const { view, on } = fakeView(true);
    provider.resolveWebviewView(view as never);
    await on.message({ command: 'ready' });
    expect(createOmniEngine).toHaveBeenCalledTimes(1);

    provider.onConfigChanged();

    await vi.waitFor(() => expect(createOmniEngine).toHaveBeenCalledTimes(2));
  });

  it('builds the new engine with the toggles the old one had, except one whose setting changed', async () => {
    const provider = new OmniSearchViewProvider(vi.fn(async () => fakeContext()));
    const { view, on } = fakeView(true);
    provider.resolveWebviewView(view as never);
    await on.message({ command: 'ready' });
    const live = {
      scopeId: 'source',
      scopeBeforeRegex: 'classes',
      caseSensitive: true,
      matchMode: 'prefix',
      excludedFromAll: [],
      regex: true,
      pivot: false,
      regexAvailable: true,
    };
    vi.mocked(createOmniEngine).mock.results[0].value.state = () => live;

    provider.onConfigChanged((key) => key === 'caseSensitive');

    await vi.waitFor(() => expect(createOmniEngine).toHaveBeenCalledTimes(2));
    // The old engine's regex search would otherwise keep the session busy out of sight.
    expect(vi.mocked(createOmniEngine).mock.results[0].value.dispose).toHaveBeenCalled();
    expect(vi.mocked(createOmniEngine).mock.calls[1][0].carryOver).toEqual({
      scopeId: 'source',
      scopeBeforeRegex: 'classes',
      matchMode: 'prefix',
      excludedFromAll: [],
      regex: true,
    });
  });

  it('runs a regex search the rebuild stopped again on the new engine, and shows its answer', async () => {
    const provider = new OmniSearchViewProvider(vi.fn(async () => fakeContext()));
    const { view, on } = fakeView(true);
    provider.resolveWebviewView(view as never);
    await on.message({ command: 'ready' });
    const old = vi.mocked(createOmniEngine).mock.results[0].value;
    old.state = () => ({ scopeId: 'source', caseSensitive: false, regex: true, term: 'foo.*bar' });
    old.dispose.mockReturnValue(true);
    const rebuilt = {
      prime: vi.fn(async () => {}),
      state: () => ({ scopeId: 'source', caseSensitive: false, regex: true, term: 'foo.*bar' }),
      submit: vi.fn(async () => ({ rows: [], hasMore: false, exact: true, truncations: [] })),
      dispose: vi.fn(() => false),
    };
    vi.mocked(createOmniEngine).mockReturnValueOnce(rebuilt as never);

    provider.onConfigChanged((key) => key === 'maxServerScan');

    await vi.waitFor(() => expect(rebuilt.submit).toHaveBeenCalledWith('foo.*bar'));
    await vi.waitFor(() =>
      expect(view.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'results', term: 'foo.*bar' }),
      ),
    );
  });

  it.each([
    ['fails', () => Promise.reject(new Error('stone went away')), 'stone went away'],
    ['fails with something other than an Error', () => Promise.reject('hung up'), 'hung up'],
    ['is superseded', () => Promise.resolve(null), undefined],
  ])('takes the spinner off when the search it runs again %s', async (_what, outcome, error) => {
    const ctx = fakeContext();
    const provider = new OmniSearchViewProvider(vi.fn(async () => ctx));
    const { view, on } = fakeView(true);
    provider.resolveWebviewView(view as never);
    await on.message({ command: 'ready' });
    const old = vi.mocked(createOmniEngine).mock.results[0].value;
    old.state = () => ({ scopeId: 'source', caseSensitive: false, regex: true, term: 'a' });
    old.dispose.mockReturnValue(true);
    const rebuilt = {
      prime: vi.fn(async () => {}),
      state: () => ({ scopeId: 'source', caseSensitive: false, regex: true, term: 'a' }),
      submit: vi.fn(outcome),
      dispose: vi.fn(() => false),
    };
    vi.mocked(createOmniEngine).mockReturnValueOnce(rebuilt as never);
    view.webview.postMessage.mockClear();

    provider.onConfigChanged();

    await vi.waitFor(() =>
      expect(view.webview.postMessage).toHaveBeenCalledWith({ command: 'busy', on: false }),
    );
    expect(vi.mocked(ctx.deps.onError!).mock.calls).toEqual(error ? [[error]] : []);
  });

  it('shows an answered regex search again on the new engine, without searching the stone', async () => {
    const provider = new OmniSearchViewProvider(vi.fn(async () => fakeContext()));
    const { view, on } = fakeView(true);
    provider.resolveWebviewView(view as never);
    await on.message({ command: 'ready' });
    const old = vi.mocked(createOmniEngine).mock.results[0].value;
    const answer = { key: 'c:foo', results: [], meta: { exact: true } };
    old.state = () => ({ scopeId: 'source', caseSensitive: false, regex: true, term: 'foo' });
    old.lastRegexAnswer.mockReturnValue(answer);
    const rebuilt = {
      prime: vi.fn(async () => {}),
      state: () => ({ scopeId: 'source', caseSensitive: false, regex: true, term: 'foo' }),
      search: vi.fn(async () => ({ rows: [], hasMore: false, exact: true, truncations: [] })),
      submit: vi.fn(async () => null),
      dispose: vi.fn(() => false),
    };
    vi.mocked(createOmniEngine).mockReturnValueOnce(rebuilt as never);

    provider.onConfigChanged();

    await vi.waitFor(() => expect(rebuilt.search).toHaveBeenCalledWith('foo'));
    expect(rebuilt.submit).not.toHaveBeenCalled();
    expect(vi.mocked(createOmniEngine).mock.calls[1][0].carryOver?.regexAnswer).toBe(answer);
  });

  it('drops what it carried, and resets the panel, when the session changes before the rebuild', async () => {
    const contexts = [fakeContext(1)];
    const provider = new OmniSearchViewProvider(vi.fn(async () => contexts[0]));
    const shown = fakeView(true);
    provider.resolveWebviewView(shown.view as never);
    await shown.on.message({ command: 'ready' });
    const old = vi.mocked(createOmniEngine).mock.results[0].value;
    old.state = () => ({ scopeId: 'source', caseSensitive: true, regex: true, term: 'foo' });
    old.dispose.mockReturnValue(true);
    shown.view.visible = false;

    provider.onConfigChanged();
    contexts[0] = fakeContext(2);
    await provider.onSessionSelectionChanged();
    shown.view.visible = true;
    await shown.on.message({ command: 'query', value: '' });

    expect(shown.view.webview.postMessage).toHaveBeenCalledWith({ command: 'reset' });
    const built = vi.mocked(createOmniEngine).mock.calls;
    expect(built[built.length - 1][0].carryOver).toBeUndefined();
    const latest = vi.mocked(createOmniEngine).mock.results.at(-1)!.value;
    expect(latest.submit).not.toHaveBeenCalled();
  });

  it('runs nothing again when no regex search was running', async () => {
    const provider = new OmniSearchViewProvider(vi.fn(async () => fakeContext()));
    const { view, on } = fakeView(true);
    provider.resolveWebviewView(view as never);
    await on.message({ command: 'ready' });

    provider.onConfigChanged();
    await vi.waitFor(() => expect(createOmniEngine).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(vi.mocked(createOmniEngine).mock.results[1].value.submit).not.toHaveBeenCalled();
  });

  it('defers the rebuild to the next interaction when the panel is hidden', async () => {
    const resolveContext = vi.fn(async () => fakeContext());
    const provider = new OmniSearchViewProvider(resolveContext);
    const { view, on } = fakeView(false);
    provider.resolveWebviewView(view as never);
    await on.message({ command: 'ready' });
    expect(createOmniEngine).toHaveBeenCalledTimes(1);

    provider.onConfigChanged();

    expect(createOmniEngine).toHaveBeenCalledTimes(1);
    await on.message({ command: 'ready' });
    expect(createOmniEngine).toHaveBeenCalledTimes(2);
  });
});

describe('GemStone Search docked panel — reacting to image changes', () => {
  beforeEach(() => vi.clearAllMocks());

  async function openForSession1() {
    const provider = new OmniSearchViewProvider(vi.fn(async () => fakeContext()));
    const { view, on } = fakeView(true);
    provider.resolveWebviewView(view as never);
    await on.message({ command: 'ready' });
    const engine = vi.mocked(createOmniEngine).mock.results[0].value;
    return { provider, view, engine };
  }

  it('folds a locally compiled class into the engine built for that session', async () => {
    const { provider, engine } = await openForSession1();

    await provider.onClassCompiled(1, 'Bar', 'UserGlobals');

    expect(engine.applyChange).toHaveBeenCalledWith({
      kind: 'class',
      className: 'Bar',
      dictName: 'UserGlobals',
    });
  });

  it('ignores a class compile for a different session', async () => {
    const { provider, engine } = await openForSession1();

    await provider.onClassCompiled(2, 'Bar');

    expect(engine.applyChange).not.toHaveBeenCalled();
  });

  it('rebuilds every cached corpus when its session syncs while the panel is visible', async () => {
    const { provider, engine } = await openForSession1();

    await provider.onSessionSynced(1);

    expect(engine.resync).toHaveBeenCalled();
  });

  it('redraws the results when a change affects the current view', async () => {
    const { provider, view, engine } = await openForSession1();
    engine.applyChange.mockResolvedValueOnce({
      rows: [],
      shownCount: 0,
      hasMore: false,
      exact: true,
      pivot: false,
    });

    await provider.onClassCompiled(1, 'Bar');

    expect(view.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'results' }),
    );
  });

  it('leaves the view alone when the change does not affect it', async () => {
    const { provider, view, engine } = await openForSession1();
    engine.applyChange.mockResolvedValueOnce(null);
    view.webview.postMessage.mockClear();

    await provider.onClassCompiled(1, 'Bar');

    expect(view.webview.postMessage).not.toHaveBeenCalled();
  });
});

// A sync rebuild re-primes every provider, three of them via image-wide synchronous GCI executes. The
// engine outlives a hidden panel, so without this gate every commit/abort — and every dictionary
// add/remove/rename — paid that cost with nothing on screen. See the PR #443 review.
describe('GemStone Search docked panel — a session sync while hidden', () => {
  beforeEach(() => vi.clearAllMocks());

  async function openThenHide() {
    const provider = new OmniSearchViewProvider(vi.fn(async () => fakeContext()));
    const { view, on } = fakeView(true);
    provider.resolveWebviewView(view as never);
    await on.message({ command: 'ready' }); // shown once: builds + primes the engine
    await settle();
    const engine = vi.mocked(createOmniEngine).mock.results[0].value;
    view.visible = false;
    return { provider, view, on, engine };
  }

  it('does not touch the corpora while the panel is hidden', async () => {
    const { provider, engine } = await openThenHide();

    await provider.onSessionSynced(1);

    expect(engine.resync).not.toHaveBeenCalled();
  });

  it('pays the deferred rebuild when the panel is revealed again', async () => {
    const { provider, view, on, engine } = await openThenHide();
    await provider.onSessionSynced(1);

    view.visible = true;
    on.visibility();

    await vi.waitFor(() => expect(engine.resync).toHaveBeenCalledTimes(1));
  });

  it('rebuilds before the next search, so a hidden sync is never searched stale', async () => {
    const { provider, on, engine } = await openThenHide();
    await provider.onSessionSynced(1);

    await on.message({ command: 'query', value: 'Foo' });
    await settle();

    expect(engine.resync).toHaveBeenCalledTimes(1);
    expect(engine.search).toHaveBeenCalledWith('Foo');
  });

  it('rebuilds once for many hidden syncs, not once per sync', async () => {
    const { provider, view, on, engine } = await openThenHide();
    await provider.onSessionSynced(1);
    await provider.onSessionSynced(1);
    await provider.onSessionSynced(1);

    view.visible = true;
    on.visibility();

    await vi.waitFor(() => expect(engine.resync).toHaveBeenCalledTimes(1));
    await settle();
    expect(engine.resync).toHaveBeenCalledTimes(1);
  });

  it('stays quiet on a reveal with no sync outstanding', async () => {
    const { view, on, engine } = await openThenHide();

    view.visible = true;
    on.visibility();

    await settle();
    expect(createOmniEngine).toHaveBeenCalledTimes(1);
    expect(engine.resync).not.toHaveBeenCalled();
  });
});

describe('GemStone Search docked panel — reporting whether a reveal landed', () => {
  // The mocked `<viewId>.focus` never builds a view, so every reveal here is one that did not land.
  // What focus() must NOT do is answer from the fact that a view was built at some point in the past:
  // that field is set once and never cleared, so reading it would report success for the rest of the
  // window — and the post-login reveal would have no way to notice a panel that failed to appear.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('reports failure when the view never resolves, without waiting forever', async () => {
    const provider = new OmniSearchViewProvider(async () => null);

    const landed = provider.focus();
    await vi.advanceTimersByTimeAsync(REVEAL_DEADLINE_MS);

    await expect(landed).resolves.toBe(false);
  });

  it('answers at once for a view that is already built, without waiting on a fresh event', async () => {
    const provider = new OmniSearchViewProvider(async () => null);
    provider.resolveWebviewView(fakeView(false).view as never);

    // An existing view IS a landed reveal — `<viewId>.focus` had something to show. Waiting for another
    // resolve event here would hang until the deadline on every reveal after the first.
    await expect(provider.focus()).resolves.toBe(true);
  });

  it('returns as soon as the view resolves, rather than sitting out the deadline', async () => {
    const provider = new OmniSearchViewProvider(async () => null);

    const landed = provider.focus();
    await vi.advanceTimersByTimeAsync(0); // let the reveal command settle
    provider.resolveWebviewView(fakeView(false).view as never); // the workbench catches up

    await expect(landed).resolves.toBe(true);
  });
});

describe('GemStone Search docked panel — switching the active session', () => {
  beforeEach(() => vi.clearAllMocks());

  /** Open the panel on session 1, with a resolver whose session id we can move afterwards. */
  async function openWithSwitchableSession(visible: boolean) {
    let sessionId = 1;
    const provider = new OmniSearchViewProvider(vi.fn(async () => fakeContext(sessionId)));
    const { view, on } = fakeView(visible);
    provider.resolveWebviewView(view as never);
    await on.message({ command: 'ready' });
    expect(createOmniEngine).toHaveBeenCalledTimes(1);
    return { provider, view, on, select: (id: number) => (sessionId = id) };
  }

  it('wipes the webview and rebinds the engine when another session is made active', async () => {
    const { provider, view, select } = await openWithSwitchableSession(true);
    select(2);

    await provider.onSessionSelectionChanged();

    // The rows on screen came out of session 1 — leaving them up would show stale results that still
    // look live, and activating one would open a document against session 2.
    expect(view.webview.postMessage).toHaveBeenCalledWith({ command: 'reset' });
    expect(createOmniEngine).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the selection lands back on the session it is already built for', async () => {
    const { provider, view, select } = await openWithSwitchableSession(true);
    select(1); // same session — e.g. re-selecting it in the Sessions tree
    view.webview.postMessage.mockClear();

    await provider.onSessionSelectionChanged();

    // Re-priming would cost three image-wide GCI executes to arrive where we already are.
    expect(createOmniEngine).toHaveBeenCalledTimes(1);
    expect(view.webview.postMessage).not.toHaveBeenCalledWith({ command: 'reset' });
  });

  it('wipes a HIDDEN panel too, and leaves the rebuild for the next reveal', async () => {
    const { provider, view, on, select } = await openWithSwitchableSession(false);
    select(2);

    await provider.onSessionSelectionChanged();

    // The wipe is not deferred: unlike a stale corpus, stale ROWS are visible the instant the panel is
    // revealed, and the reveal cannot un-show them retroactively.
    expect(view.webview.postMessage).toHaveBeenCalledWith({ command: 'reset' });
    expect(createOmniEngine).toHaveBeenCalledTimes(1); // the costly part still waits
    await on.message({ command: 'ready' });
    expect(createOmniEngine).toHaveBeenCalledTimes(2);
  });

  it('resets and asks for a login when the last session logs out', async () => {
    let ctx: OmniViewContext | null = fakeContext(1);
    const provider = new OmniSearchViewProvider(vi.fn(async () => ctx));
    const { view, on } = fakeView(true);
    provider.resolveWebviewView(view as never);
    await on.message({ command: 'ready' });
    ctx = null;

    await provider.onSessionSelectionChanged();

    expect(view.webview.postMessage).toHaveBeenCalledWith({ command: 'reset' });
    expect(view.webview.postMessage).toHaveBeenCalledWith({
      command: 'error',
      message: 'Log in to a GemStone session to search.',
    });
  });
});

describe('GemStone Search docked panel — the refresh button', () => {
  beforeEach(() => vi.clearAllMocks());

  async function open(visible = true) {
    const provider = new OmniSearchViewProvider(vi.fn(async () => fakeContext()));
    const { view, on } = fakeView(visible);
    provider.resolveWebviewView(view as never);
    void on.message({ command: 'ready' });
    // The handler is fire-and-forget (`void this.onMessage(m)`), so wait for the engine it builds AND
    // let the rest of the handler drain — otherwise its own `flushPendingSync` lands mid-test and looks
    // like the code under test resyncing.
    await vi.waitFor(() => expect(createOmniEngine).toHaveBeenCalled());
    await settle();
    // The LAST engine built, not `results[0]`: `vi.clearAllMocks()` does not empty `mock.results`, so an
    // earlier test's engine can still be sitting at index 0.
    const results = vi.mocked(createOmniEngine).mock.results;
    return { provider, view, on, engine: results[results.length - 1].value };
  }

  it('reloads every cached corpus, so code created by executing it is picked up', async () => {
    const { provider, engine } = await open();

    await provider.refresh();

    // `refresh`, not `resync`: the two differ over an open references list — see the engine tests.
    expect(engine.refresh).toHaveBeenCalled();
    expect(engine.resync).not.toHaveBeenCalled();
  });

  it('drops the busy indicator when a newer call superseded the refresh', async () => {
    const { view, on, engine } = await open();
    engine.refresh.mockResolvedValueOnce(null);

    // The provider's message handler is registered as `void this.onMessage(m)`, so the webview message
    // is fire-and-forget — hence waitFor rather than a bare await, here and below.
    void on.message({ command: 'refresh' });

    await vi.waitFor(() => expect(engine.refresh).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(view.webview.postMessage).toHaveBeenCalledWith({ command: 'busy', on: false }),
    );
  });

  it('reloads ONCE when a hidden sync was also outstanding', async () => {
    const { provider, on, engine } = await open(false);
    await provider.onSessionSynced(1); // deferred: the panel is hidden
    expect(engine.resync).not.toHaveBeenCalled();

    void on.message({ command: 'refresh' });

    // Both want the same rebuild; paying for it twice is two image-wide walks for one click.
    await vi.waitFor(() => expect(engine.refresh).toHaveBeenCalledTimes(1));
    expect(engine.resync).not.toHaveBeenCalled();
  });

  it('builds nothing when the view has never been instantiated', async () => {
    // `gemstone.search.refresh` reaches both hosts, so it fires even when the Spotter is the chosen UI
    // and this view was never resolved. Priming an engine there would cost three image-wide executes
    // for a panel nobody opened.
    const resolveContext = vi.fn(async () => fakeContext());
    const provider = new OmniSearchViewProvider(resolveContext);

    await provider.refresh();

    expect(resolveContext).not.toHaveBeenCalled();
    expect(createOmniEngine).not.toHaveBeenCalled();
  });

  it('defers the command to the next reveal when the panel is collapsed', async () => {
    // Collapsing the panel disposes the view, so reloading now would pay three image-wide executes to
    // post results to a webview nobody is looking at — the same bargain every other catch-up path here
    // makes. But the request must not be silently dropped, or the panel the user reopens is the stale
    // one they just asked to refresh.
    const { provider, view, on, engine } = await open(true);
    view.visible = false;

    await provider.refresh();
    expect(engine.refresh).not.toHaveBeenCalled();

    view.visible = true;
    on.visibility();

    await vi.waitFor(() => expect(engine.refresh).toHaveBeenCalledTimes(1));
    expect(engine.resync).not.toHaveBeenCalled(); // the refresh subsumes any deferred sync
  });

  it('drops the cached class list when the webview’s own ⟳ is pressed', async () => {
    // The Source and Literals scopes search through the session's cached ClassOrganizer, so a
    // refresh that rebuilt only the corpora would still miss a class created in a workspace.
    const context = fakeContext();
    const dropClassIndex = vi.fn();
    (context.deps as unknown as { dropClassIndex: () => void }).dropClassIndex = dropClassIndex;
    const provider = new OmniSearchViewProvider(vi.fn(async () => context));
    const { view, on } = fakeView(true);
    provider.resolveWebviewView(view as never);
    void on.message({ command: 'ready' });
    await vi.waitFor(() => expect(createOmniEngine).toHaveBeenCalled());
    await settle();
    const engines = vi.mocked(createOmniEngine).mock.results;
    const engine = engines[engines.length - 1].value;

    void on.message({ command: 'refresh' });

    await vi.waitFor(() => expect(engine.refresh).toHaveBeenCalled());
    expect(dropClassIndex).toHaveBeenCalled();
    expect(dropClassIndex.mock.invocationCallOrder[0]).toBeLessThan(
      engine.refresh.mock.invocationCallOrder[0],
    );
  });

  it('still reloads on the webview button while the view reports itself hidden', async () => {
    // A message from the webview is proof enough that someone is looking, so the ⟳ inside the chrome
    // skips the visibility gate the palette command honours.
    const { on, engine } = await open(false);

    void on.message({ command: 'refresh' });

    await vi.waitFor(() => expect(engine.refresh).toHaveBeenCalledTimes(1));
  });

  it('takes the spinner off when the reload throws', async () => {
    // The palette command and the title-bar button call `refresh()` as a bare `void`, so a rejection —
    // resolving senders of a common selector against a busy session, say — used to go unhandled and
    // leave the panel faded for good.
    const { provider, view, engine } = await open();
    engine.refresh.mockRejectedValueOnce(new Error('session busy'));

    await provider.refresh();

    expect(view.webview.postMessage).toHaveBeenCalledWith({
      command: 'error',
      message: 'session busy',
    });
    expect(view.webview.postMessage).toHaveBeenCalledWith({ command: 'busy', on: false });
  });
});

describe('GemStone Search docked panel — an operation that fails part way', () => {
  beforeEach(() => vi.clearAllMocks());

  it('redraws the buttons from the engine, so a .* turned off before the search failed shows off', async () => {
    const provider = new OmniSearchViewProvider(vi.fn(async () => fakeContext()));
    const { view, on } = fakeView(true);
    provider.resolveWebviewView(view as never);
    await on.message({ command: 'ready' });
    const engine = vi.mocked(createOmniEngine).mock.results[0].value;
    engine.toggleRegex = vi.fn(async () => {
      throw new Error('This session is busy');
    });
    engine.state = () => ({
      scopeId: null,
      caseSensitive: false,
      matchMode: 'fuzzy',
      excludedFromAll: [],
      regex: false,
      regexAvailable: true,
    });
    view.webview.postMessage.mockClear();

    await on.message({ command: 'toggleRegex' });
    await settle();

    const posted = view.webview.postMessage.mock.calls.map((c) => c[0]);
    expect(posted).toContainEqual({
      command: 'error',
      message: 'This session is busy',
      failed: 'toggleRegex',
    });
    expect(posted.find((m) => m.command === 'config')).toMatchObject({ regex: false });
  });
});

describe('GemStone Search docked panel — previewing a regex hit', () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends the hit's matches as offsets into the source it sends, past an emoji included", async () => {
    const source = 'bar\n  "😀" ^self at: 1 put: 2';
    const ctx = fakeContext();
    (ctx.deps as unknown as { previewSource: () => string }).previewSource = () => source;
    const provider = new OmniSearchViewProvider(vi.fn(async () => ctx));
    const { view, on } = fakeView(true);
    provider.resolveWebviewView(view as never);
    await on.message({ command: 'ready' });
    const engine = vi.mocked(createOmniEngine).mock.results[0].value;
    // Where the stone puts `at: 1 put:`: counted in characters, so the emoji counts once.
    const start = [...source.slice(0, source.indexOf('at: 1'))].length;
    engine.resultFor = () => ({
      label: 'Foo>>bar',
      action: { kind: 'openMethod', matches: [{ start, end: start + 10 }] },
    });

    await on.message({ command: 'preview', id: 0 });
    await settle();

    const posted = view.webview.postMessage.mock.calls.map((c) => c[0]);
    const preview = posted.find((m) => m.command === 'preview');
    const [m] = preview.matches as Array<{ start: number; end: number }>;
    expect(source.slice(m.start, m.end)).toBe('at: 1 put:');
  });

  it('sends no matches for a row that is not a regex hit', async () => {
    const ctx = fakeContext();
    (ctx.deps as unknown as { previewSource: () => string }).previewSource = () => 'bar ^1';
    const provider = new OmniSearchViewProvider(vi.fn(async () => ctx));
    const { view, on } = fakeView(true);
    provider.resolveWebviewView(view as never);
    await on.message({ command: 'ready' });
    vi.mocked(createOmniEngine).mock.results[0].value.resultFor = () => ({
      label: 'Foo>>bar',
      action: { kind: 'openMethod' },
    });

    await on.message({ command: 'preview', id: 0 });
    await settle();

    const posted = view.webview.postMessage.mock.calls.map((c) => c[0]);
    expect(posted.find((m) => m.command === 'preview')).toMatchObject({
      source: 'bar ^1',
      matches: undefined,
    });
  });
});

describe('GemStone Search docked panel — reopening the view', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-sends the config to the fresh webview a reopen creates', async () => {
    // Collapsing the panel disposes the view; reopening it hands us a brand-new webview with an empty
    // tab row, no case flag and a zero debounce. The engine that outlives it still matches the session,
    // so `ensureEngine` has nothing to rebuild — and therefore used to push nothing, leaving the fresh
    // webview to limp until the first search happened to refill its chrome.
    const provider = new OmniSearchViewProvider(vi.fn(async () => fakeContext()));
    const first = fakeView(true);
    provider.resolveWebviewView(first.view as never);
    void first.on.message({ command: 'ready' });
    await vi.waitFor(() => expect(createOmniEngine).toHaveBeenCalled());
    await settle();

    const reopened = fakeView(true);
    provider.resolveWebviewView(reopened.view as never);
    void reopened.on.message({ command: 'ready' });

    await vi.waitFor(() =>
      expect(
        reopened.view.webview.postMessage.mock.calls.some(
          (c) => (c[0] as { command?: string }).command === 'config',
        ),
      ).toBe(true),
    );
    expect(createOmniEngine).toHaveBeenCalledTimes(1); // and without paying for a rebuild
  });

  /** Open the panel, put a list on screen, and answer a reopen's fresh webview. */
  async function showListThenReopen(
    betweenOpens: (provider: OmniSearchViewProvider, select: (id: number) => void) => unknown,
  ) {
    let sessionId = 1;
    const provider = new OmniSearchViewProvider(vi.fn(async () => fakeContext(sessionId)));
    const first = fakeView(true);
    provider.resolveWebviewView(first.view as never);
    void first.on.message({ command: 'ready' });
    await vi.waitFor(() => expect(createOmniEngine).toHaveBeenCalled());
    await settle();
    const engine = vi.mocked(createOmniEngine).mock.results[0].value;
    engine.search.mockResolvedValue({
      rows: [{ id: 1, label: 'Parser>>parse' }],
      shownCount: 1,
      pivot: true,
      pivotTitle: 'Methods created in Parser',
    });
    void first.on.message({ command: 'query', value: '' });
    await settle();
    await betweenOpens(provider, (id) => (sessionId = id));
    const reopened = fakeView(true);
    provider.resolveWebviewView(reopened.view as never);
    void reopened.on.message({ command: 'ready' });
    await settle();
    await settle();
    return reopened.view.webview.postMessage.mock.calls
      .map((c) => c[0] as { command?: string; pivotTitle?: string })
      .filter((m) => m.command === 'results');
  }

  it('puts the list that was on screen back into the fresh webview a reopen creates', async () => {
    const results = await showListThenReopen(() => {});

    expect(results.map((m) => m.pivotTitle)).toEqual(['Methods created in Parser']);
  });

  it('does not put back a list from a session the user has since left', async () => {
    const results = await showListThenReopen(async (provider, select) => {
      select(2);
      await provider.onSessionSelectionChanged();
    });

    expect(results).toEqual([]);
  });
});

describe('GemStone Search docked panel — failed actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('names the action that failed, so the view can tell a failed search from the rest', async () => {
    const provider = new OmniSearchViewProvider(vi.fn(async () => fakeContext(1)));
    const { view, on } = fakeView(true);
    provider.resolveWebviewView(view as never);
    await on.message({ command: 'ready' });
    const engines = vi.mocked(createOmniEngine).mock.results;
    const engine = engines[engines.length - 1].value;
    engine.search.mockRejectedValueOnce(new Error('session busy'));

    void on.message({ command: 'query', value: 'Object>>printString' });

    await vi.waitFor(() =>
      expect(view.webview.postMessage).toHaveBeenCalledWith({
        command: 'error',
        message: 'session busy',
        failed: 'query',
      }),
    );
  });
});
