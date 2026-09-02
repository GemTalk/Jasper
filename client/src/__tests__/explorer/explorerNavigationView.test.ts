import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { commands } from '../../__mocks__/vscode';
import {
  NAVIGATION_VIEW_ID,
  NavigationViewProvider,
  NavigationViewState,
  parseViewMessage,
  renderNavigationViewHtml,
  toolbarCommands,
} from '../../explorerNavigationView';

const executeCommand = commands.executeCommand as ReturnType<typeof vi.fn>;

function manifest(): {
  contributes: {
    commands: { command: string }[];
    views: Record<string, { id: string; type?: string }[]>;
  };
} {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8'),
  ) as ReturnType<typeof manifest>;
}

// A WebviewView-shaped stub that records what the extension posts and lets a test
// play the webview's side of the protocol back.
function fakeView() {
  const posted: Record<string, unknown>[] = [];
  let onMessage: (m: unknown) => void = () => {};
  const view = {
    webview: {
      options: {},
      html: '',
      postMessage: (m: Record<string, unknown>) => {
        posted.push(m);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (handler: (m: unknown) => void) => {
        onMessage = handler;
        return { dispose: () => {} };
      },
    },
  };
  return { view, posted, send: (m: unknown) => onMessage(m) };
}

const trail = (count: number): NavigationViewState['trail'] =>
  Array.from({ length: count }, (_, index) => ({
    index,
    label: `Array>>sel${index}`,
    context: 'Globals',
    current: index === count - 1,
  }));

const state = (over: Partial<NavigationViewState> = {}): NavigationViewState => ({
  back: true,
  forward: false,
  mode: 'full',
  trail: trail(2),
  ...over,
});

describe('the Actions & Navigation pane', () => {
  beforeEach(() => {
    executeCommand.mockClear();
  });

  it('draws a button for every command it offers', () => {
    const html = renderNavigationViewHtml('test-nonce');
    for (const command of toolbarCommands()) {
      expect(html).toContain(`data-cmd="${command}"`);
    }
  });

  it('offers Back, Forward, the history list, refresh, commit, abort, the label toggle and a workspace', () => {
    expect(toolbarCommands()).toEqual([
      'gemstone.navigateBack',
      'gemstone.navigateForward',
      'gemstone.explorer.showHistory',
      'gemstone.explorer.refresh',
      'gemstone.explorer.commit',
      'gemstone.explorer.abort',
      'gemstone.explorer.showNavigationSelectorsOnly',
      'gemstone.explorer.showNavigationFullLocations',
      'gemstone.openWorkspace',
    ]);
  });

  it('carries both halves of the label toggle, and shows only the one that applies', () => {
    const html = renderNavigationViewHtml('test-nonce');
    // Both are in the markup so switching mode costs no re-render; CSS keyed on the
    // row's data-mode decides which is on screen.
    expect(html).toContain(
      'data-cmd="gemstone.explorer.showNavigationSelectorsOnly" data-mode="full"',
    );
    expect(html).toContain(
      'data-cmd="gemstone.explorer.showNavigationFullLocations" data-mode="selectors"',
    );
  });

  it('hides only the toggle half that does not apply, never the row itself', () => {
    // The row carries the current mode as its own data-mode, so an unscoped
    // [data-mode] rule would hide every button in it — which it did, until a
    // headless render of the pane showed an empty toolbar.
    const html = renderNavigationViewHtml('test-nonce');
    expect(html).toContain('.toolbar > [data-mode] { display: none; }');
    // The buttons with no mode must not carry the attribute at all, or the rule
    // above would take them out too.
    expect(html).not.toContain('data-mode=""');
    expect(html).toContain("document.querySelector('.toolbar').dataset.mode = state.mode");
  });

  it('runs the label toggle like any other button', () => {
    const provider = new NavigationViewProvider(() => {});
    const { view, send } = fakeView();
    provider.resolveWebviewView(view as never);

    send({ kind: 'run', command: 'gemstone.explorer.showNavigationSelectorsOnly' });
    expect(executeCommand).toHaveBeenCalledWith('gemstone.explorer.showNavigationSelectorsOnly');
  });

  it('the label toggle is a findable setting, not just a button', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8'),
    ) as { contributes: { configuration: { properties: Record<string, unknown> }[] } };
    const properties = config.contributes.configuration.flatMap((block) =>
      Object.keys(block.properties ?? {}),
    );
    expect(properties).toContain('gemstone.explorer.navigationSelectorsOnly');
  });

  it('every button runs a command the extension actually contributes', () => {
    const contributed = new Set(manifest().contributes.commands.map((c) => c.command));
    for (const command of toolbarCommands()) {
      expect(contributed.has(command), `${command} is not contributed`).toBe(true);
    }
  });

  it('is the first view in the Explorer container, as a webview', () => {
    const views = manifest().contributes.views.gemstoneExplorer;
    // A webview because a tree pane cannot show its buttons while collapsed, and
    // first because the toolbar belongs above the panes it acts on.
    expect(views.find((v) => v.id === NAVIGATION_VIEW_ID)?.type).toBe('webview');
    expect(views[0].id).toBe(NAVIGATION_VIEW_ID);
  });

  it('starts Back and Forward greyed out, and leaves the rest live', () => {
    const html = renderNavigationViewHtml('test-nonce');
    const disabled = [...html.matchAll(/data-cmd="([^"]+)"[^>]*?\sdisabled/g)].map((m) => m[1]);
    expect(disabled).toEqual(['gemstone.navigateBack', 'gemstone.navigateForward']);
  });

  it('gives the trail its own scrolling region under the fixed button row', () => {
    const html = renderNavigationViewHtml('test-nonce');
    expect(html).toContain('id="trail"');
    expect(html).toMatch(/\.trail \{[^}]*overflow-y: auto/);
    expect(html).toMatch(/\.toolbar \{[^}]*flex: 0 0 auto/);
  });

  it('builds trail rows from text, never markup', () => {
    // Labels are class and selector names read out of the stone; assembling rows
    // with innerHTML would make a selector an injection vector.
    const html = renderNavigationViewHtml('test-nonce');
    expect(html).toContain('label.textContent = entry.label');
    expect(html).not.toMatch(/\.innerHTML\s*=/);
  });

  it('offers no native Cut/Copy/Paste menu on right-click', () => {
    // A row of buttons over a list of places has nothing an editing menu applies to.
    const html = renderNavigationViewHtml('test-nonce');
    expect(html).toMatch(/addEventListener\('contextmenu',[\s\S]*?preventDefault\(\)/);
  });

  it('locks the page down to its own inline script', () => {
    const html = renderNavigationViewHtml('test-nonce');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-test-nonce'");
    expect(html).toContain('<script nonce="test-nonce">');
  });

  it('runs the command a button press names', () => {
    const provider = new NavigationViewProvider(() => {});
    const { view, send } = fakeView();
    provider.resolveWebviewView(view as never);

    send({ kind: 'run', command: 'gemstone.explorer.commit' });
    expect(executeCommand).toHaveBeenCalledWith('gemstone.explorer.commit');
  });

  it('jumps to the trail row that was clicked', () => {
    const jumps: number[] = [];
    const provider = new NavigationViewProvider((index) => jumps.push(index));
    const { view, send } = fakeView();
    provider.resolveWebviewView(view as never);
    provider.setState(state({ trail: trail(3) }));

    send({ kind: 'goto', index: 1 });
    expect(jumps).toEqual([1]);
  });

  it('refuses a command that is not one of its buttons', () => {
    const provider = new NavigationViewProvider(() => {});
    const { view, send } = fakeView();
    provider.resolveWebviewView(view as never);

    // A webview can post anything; dispatching it blindly would hand the page the
    // whole command registry.
    send({ kind: 'run', command: 'workbench.action.closeWindow' });
    send({ kind: 'run', command: 42 });
    send({ command: 'gemstone.explorer.abort' }); // no kind
    send('gemstone.explorer.abort');
    send(null);
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('refuses a jump to a row that is not in the trail', () => {
    const jumps: number[] = [];
    const provider = new NavigationViewProvider((index) => jumps.push(index));
    const { view, send } = fakeView();
    provider.resolveWebviewView(view as never);
    provider.setState(state());

    send({ kind: 'goto', index: 2 });
    send({ kind: 'goto', index: -1 });
    send({ kind: 'goto', index: 0.5 });
    send({ kind: 'goto', index: '1' });
    send({ kind: 'goto' });
    expect(jumps).toEqual([]);
  });

  it('reads only the three things the pane is allowed to say', () => {
    expect(parseViewMessage({ kind: 'ready' }, 0)).toEqual({ kind: 'ready' });
    expect(parseViewMessage({ kind: 'run', command: 'gemstone.navigateBack' }, 0)).toEqual({
      kind: 'run',
      command: 'gemstone.navigateBack',
    });
    expect(parseViewMessage({ kind: 'goto', index: 0 }, 1)).toEqual({ kind: 'goto', index: 0 });
    expect(parseViewMessage({ kind: 'goto', index: 0 }, 0)).toBeUndefined();
    expect(parseViewMessage({ kind: 'nope' }, 0)).toBeUndefined();
    expect(parseViewMessage(undefined, 0)).toBeUndefined();
  });

  it('pushes the whole state at once, and re-pushes it to a rebuilt webview', () => {
    const provider = new NavigationViewProvider(() => {});
    const first = fakeView();
    provider.resolveWebviewView(first.view as never);
    const pushed = state();
    provider.setState(pushed);
    // One message, so the buttons and the trail can never disagree about the cursor.
    expect(first.posted.at(-1)).toEqual({ kind: 'state', ...pushed });

    // Collapsing the pane disposes the webview; the replacement knows nothing, so
    // resolving one has to re-state everything.
    const rebuilt = fakeView();
    provider.resolveWebviewView(rebuilt.view as never);
    expect(rebuilt.posted).toContainEqual({ kind: 'state', ...pushed });
  });

  it('answers a webview that says it is ready with the current state', () => {
    const provider = new NavigationViewProvider(() => {});
    provider.setState(state({ forward: true, trail: trail(1) }));
    const { view, posted, send } = fakeView();
    provider.resolveWebviewView(view as never);
    posted.length = 0;

    send({ kind: 'ready' });
    expect(posted).toEqual([
      { kind: 'state', back: true, forward: true, mode: 'full', trail: trail(1) },
    ]);
    expect(executeCommand).not.toHaveBeenCalled();
  });
});
