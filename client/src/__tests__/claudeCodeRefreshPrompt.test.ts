import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import {
  promptClaudeCodeRefresh,
  buildRefreshPromptDeps,
  RefreshPromptDeps,
  __test,
} from '../claudeCodeRefreshPrompt';

type FakeContext = Parameters<typeof buildRefreshPromptDeps>[0];

// Minimal ExtensionContext stand-in backed by a plain key/value store, enough
// for buildRefreshPromptDeps' globalState get/update calls.
function makeContext(initial: Record<string, unknown> = {}): {
  context: FakeContext;
  store: Record<string, unknown>;
} {
  const store: Record<string, unknown> = { ...initial };
  const context = {
    globalState: {
      get: (key: string, def?: unknown) => (key in store ? store[key] : def),
      update: async (key: string, value: unknown) => {
        store[key] = value;
      },
    },
  } as unknown as FakeContext;
  return { context, store };
}

const NEW_SUPPRESS_KEY = 'jasper.mcp.claudeCodeRefreshPrompt.suppressed';
const LEGACY_SUPPRESS_KEY = 'gemstone.mcp.claudeCodeRefreshPrompt.suppressed';

function makeDeps(
  overrides: {
    initialSuppressed?: boolean;
    choice?: string;
  } = {},
): RefreshPromptDeps & {
  store: { suppressed: boolean };
  showInformationMessage: ReturnType<typeof vi.fn>;
  executeCommand: ReturnType<typeof vi.fn>;
} {
  const store = { suppressed: overrides.initialSuppressed ?? false };
  const showInformationMessage = vi.fn(async () => overrides.choice);
  const executeCommand = vi.fn(async () => undefined);
  return {
    store,
    getSuppressed: () => store.suppressed,
    setSuppressed: async (value) => {
      store.suppressed = value;
    },
    showInformationMessage,
    executeCommand,
  };
}

describe('promptClaudeCodeRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "suppressed" and skips the prompt when the memento is set', async () => {
    const deps = makeDeps({ initialSuppressed: true });
    const result = await promptClaudeCodeRefresh(deps);
    expect(result).toBe('suppressed');
    expect(deps.showInformationMessage).not.toHaveBeenCalled();
    expect(deps.executeCommand).not.toHaveBeenCalled();
  });

  it('shows the prompt with "Reload Window" and "Don\'t show again" actions', async () => {
    const deps = makeDeps();
    await promptClaudeCodeRefresh(deps);
    expect(deps.showInformationMessage).toHaveBeenCalledTimes(1);
    const [message, ...actions] = deps.showInformationMessage.mock.calls[0];
    expect(message).toBe(__test.PROMPT_MESSAGE);
    expect(message).toMatch(/registered the jasper MCP server/);
    expect(message).toMatch(/Reload the window/);
    expect(message).toMatch(/future launches/);
    expect(actions).toEqual([__test.RELOAD_WINDOW, __test.DONT_SHOW_AGAIN]);
  });

  it('executes the reload command and returns "reloaded" when user clicks "Reload Window"', async () => {
    const deps = makeDeps({ choice: __test.RELOAD_WINDOW });
    const result = await promptClaudeCodeRefresh(deps);
    expect(result).toBe('reloaded');
    expect(deps.executeCommand).toHaveBeenCalledWith(__test.RELOAD_COMMAND);
    expect(deps.store.suppressed).toBe(false);
  });

  it('persists suppression and returns "acknowledged" when user clicks "Don\'t show again"', async () => {
    const deps = makeDeps({ choice: __test.DONT_SHOW_AGAIN });
    const result = await promptClaudeCodeRefresh(deps);
    expect(result).toBe('acknowledged');
    expect(deps.store.suppressed).toBe(true);
    expect(deps.executeCommand).not.toHaveBeenCalled();
  });

  it('returns "dismissed" without persisting or reloading when the user dismisses the prompt', async () => {
    const deps = makeDeps({ choice: undefined });
    const result = await promptClaudeCodeRefresh(deps);
    expect(result).toBe('dismissed');
    expect(deps.store.suppressed).toBe(false);
    expect(deps.executeCommand).not.toHaveBeenCalled();
  });

  it('re-prompts on a later call when the user previously dismissed without acknowledging', async () => {
    const deps = makeDeps({ choice: undefined });
    await promptClaudeCodeRefresh(deps);
    await promptClaudeCodeRefresh(deps);
    expect(deps.showInformationMessage).toHaveBeenCalledTimes(2);
  });
});

describe('buildRefreshPromptDeps', () => {
  it('treats a suppression flag set before the rename as suppressed', () => {
    const { context } = makeContext({ [LEGACY_SUPPRESS_KEY]: true });

    const deps = buildRefreshPromptDeps(context);

    expect(deps.getSuppressed()).toBe(true);
  });

  it('is not suppressed when neither the new nor the legacy flag is set', () => {
    const { context } = makeContext();

    const deps = buildRefreshPromptDeps(context);

    expect(deps.getSuppressed()).toBe(false);
  });

  it('persists new suppressions under the jasper key', async () => {
    const { context, store } = makeContext();

    await buildRefreshPromptDeps(context).setSuppressed(true);

    expect(store[NEW_SUPPRESS_KEY]).toBe(true);
  });
});
