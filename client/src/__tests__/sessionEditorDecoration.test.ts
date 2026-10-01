import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { Uri, workspace, __setConfig, __resetConfig } from '../__mocks__/vscode';
import { SessionEditorDecorationProvider } from '../sessionEditorDecoration';
import { explorerRowUri } from '../activeEditorDecoration';
import { SessionManager } from '../sessionManager';

const LOGIN = { gs_user: 'DataCurator', stone: 'gs64stone', gem_host: 'localhost' };
const methodUri = (sessionId: number) =>
  Uri.parse(`gemstone://${sessionId}/UserGlobals/Array/instance/accessing/at%3A`);

function makeProvider(sessionIds: number[], openUris: () => Uri[] = () => []) {
  const sessions = new Map(sessionIds.map((id) => [id, { id, login: LOGIN }]));
  const manager = {
    getSession: (id: number) => sessions.get(id),
    // An editor names the session it was opened in; the active one must not leak in.
    getSelectedSession: () => {
      throw new Error('the badge must not read the active session');
    },
  } as unknown as SessionManager;
  return new SessionEditorDecorationProvider(manager, openUris);
}

function changeSessionMode(mode: 'single' | 'multiple') {
  __setConfig('gemstone', 'sessionMode', mode);
  for (const [listener] of vi.mocked(workspace.onDidChangeConfiguration).mock.calls) {
    (listener as (e: unknown) => void)({
      affectsConfiguration: (key: string) => key === 'gemstone.sessionMode',
    });
  }
}

describe('SessionEditorDecorationProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetConfig();
    __setConfig('gemstone', 'sessionMode', 'multiple');
  });

  it("badges a method editor with its own session's number, and names the session in the hover", () => {
    const provider = makeProvider([3, 4]);

    expect(provider.provideFileDecoration(methodUri(3))).toMatchObject({
      badge: '3',
      tooltip: 'Session 3 · DataCurator on gs64stone (localhost)',
    });
    expect(provider.provideFileDecoration(methodUri(4))?.badge).toBe('4');
  });

  it('shows nothing in single-session mode', () => {
    __setConfig('gemstone', 'sessionMode', 'single');
    expect(makeProvider([3]).provideFileDecoration(methodUri(3))).toBeUndefined();
  });

  it("leaves a Methods-pane row alone, though it carries the same method's URI", () => {
    const provider = makeProvider([3]);
    expect(provider.provideFileDecoration(explorerRowUri(methodUri(3)))).toBeUndefined();
  });

  it('shows nothing for a session that has logged out, or a non-gemstone document', () => {
    const provider = makeProvider([3]);
    expect(provider.provideFileDecoration(methodUri(9))).toBeUndefined();
    expect(provider.provideFileDecoration(Uri.parse('file:///tmp/x.st'))).toBeUndefined();
  });

  it('keeps only the hover for a session numbered past what a badge can hold', () => {
    const decoration = makeProvider([100]).provideFileDecoration(methodUri(100));
    expect(decoration?.badge).toBeUndefined();
    expect(decoration?.tooltip).toContain('Session 100');
  });

  it('redraws the open gemstone tabs, and only those, when the mode setting changes', () => {
    const open = [methodUri(3), methodUri(4)];
    const provider = makeProvider([3, 4], () => open);
    const fired: unknown[] = [];
    provider.onDidChangeFileDecorations((e) => fired.push(e));

    changeSessionMode('single');

    expect(fired).toEqual([open]);
  });
});
