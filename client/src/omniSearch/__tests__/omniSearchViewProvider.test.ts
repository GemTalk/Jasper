import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

// The engine is expensive and session-bound; stub it so we can count how often the provider (re)builds
// one. Each build reflects a fresh read of the live config, which is exactly what these tests assert.
vi.mock('../omniEngine', () => ({
  createOmniEngine: vi.fn(() => ({
    prime: vi.fn(async () => {}),
    applyChange: vi.fn(async () => null),
    resync: vi.fn(async () => null),
    search: vi.fn(async () => null),
    state: () => ({ scopeId: null, caseSensitive: false }),
  })),
}));

import { createOmniEngine } from '../omniEngine';
import {
  OmniSearchViewProvider,
  OmniViewContext,
  REVEAL_DEADLINE_MS,
} from '../omniSearchViewProvider';

function fakeContext(): OmniViewContext {
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
  return { deps: { config, onError: vi.fn() }, sessionId: 1 } as unknown as OmniViewContext;
}

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

  // The provider's webview callback is `void this.onMessage(m)`, so awaiting `on.message(...)` returns
  // the moment the handler suspends, not when it finishes. Yield a macrotask to let it run to the end —
  // otherwise an in-flight `ready` handler picks up a sync this test hasn't posted yet.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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
