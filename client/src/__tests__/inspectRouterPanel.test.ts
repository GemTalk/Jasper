import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { __setConfig } from '../__mocks__/vscode';
import { ActiveSession } from '../sessionManager';
import { routeInspect } from '../inspectRouter';
import { BasicInspector } from '../basicInspector/basicInspector';
import { EnhancedInspector } from '../enhancedInspector/enhancedInspector';

/**
 * Which editor tab an Inspect actually raises — the real panel classes, not
 * stand-ins, so this pins the webview that opens rather than the routing
 * decision alone (`inspectRouter.test.ts` covers that). The two are told apart
 * by their view type, which is what VS Code keys a panel by.
 */
const session = (enhanced: boolean) =>
  ({
    id: 1,
    handle: {},
    enhancedInspectorAvailable: enhanced,
    gci: { GciTsCallInProgress: () => ({ result: 0 }) },
  }) as unknown as ActiveSession;

const raisedViewTypes = () =>
  vi.mocked(vscode.window.createWebviewPanel).mock.calls.map((call) => call[0]);

beforeEach(() => {
  vi.clearAllMocks();
  __setConfig('gemstone', 'inspector.preferred', undefined);
  // Panels register themselves per session until disposed; start each test with
  // an empty registry so a leftover cannot answer for the one under test.
  (BasicInspector as unknown as { panels: Map<number, unknown> }).panels = new Map();
  (EnhancedInspector as unknown as { panels: Map<number, unknown> }).panels = new Map();
});

describe('the inspector an Inspect raises', () => {
  it('raises the Enhanced Inspector on auto, on a session that has its server support', () => {
    __setConfig('gemstone', 'inspector.preferred', 'auto');

    routeInspect(session(true), 100n, 'anAccount');

    expect(raisedViewTypes()).toEqual(['gemstoneEnhancedInspector']);
  });

  it('raises the basic Inspector on a session without it', () => {
    routeInspect(session(false), 100n, 'anAccount');

    expect(raisedViewTypes()).toEqual(['gemstoneBasicInspector']);
  });

  it('raises the basic Inspector by default, even on a session that has the Enhanced one', () => {
    routeInspect(session(true), 100n, 'anAccount');

    expect(raisedViewTypes()).toEqual(['gemstoneBasicInspector']);
  });

  it('raises one panel, beside the editor, without stealing focus', () => {
    routeInspect(session(false), 100n, 'anAccount');

    const call = vi.mocked(vscode.window.createWebviewPanel).mock.calls[0];
    expect(call[2]).toMatchObject({ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
  });

  /** The handle an owner (the debugger) keeps has to close the panel that opened. */
  it('answers a handle that closes the panel it raised', () => {
    const handle = routeInspect(session(false), 100n, 'anAccount');
    const panel = vi.mocked(vscode.window.createWebviewPanel).mock.results[0].value;

    handle.close();

    expect(panel.dispose).toHaveBeenCalled();
  });
});
