import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

// The engine is expensive and session-bound; stub it so we can count how often the provider (re)builds
// one. Each build reflects a fresh read of the live config, which is exactly what these tests assert.
vi.mock('../omniEngine', () => ({
  createOmniEngine: vi.fn(() => ({
    prime: vi.fn(async () => {}),
    applyChange: vi.fn(async () => null),
    resync: vi.fn(async () => null),
    state: () => ({ scopeId: null, caseSensitive: false }),
  })),
}));

import { createOmniEngine } from '../omniEngine';
import { OmniSearchViewProvider, OmniViewContext } from '../omniSearchViewProvider';

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

describe('Omni Search docked panel — reacting to settings changes', () => {
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

describe('Omni Search docked panel — reacting to image changes', () => {
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

  it('rebuilds every cached corpus when its session syncs', async () => {
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
