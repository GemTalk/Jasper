import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

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
    commands: { command: string; icon?: string }[];
    views: Record<string, { id: string; type?: string; size?: number; visibility?: string }[]>;
    keybindings: { command: string; key: string; when: string }[];
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
  clear: true,
  mode: 'full',
  trail: trail(2),
  ...over,
});

/**
 * Mount the pane's REAL chrome and its REAL inline script into a jsdom window, so
 * what is asserted is what the webview does rather than what its source says.
 *
 * A jsdom *window* built here, rather than the file-wide jsdom environment this
 * repo's other webview tests declare with a pragma: those load a view script that
 * ships as its own `.js` file, while this pane's script is inline in a module that
 * imports `vscode` — and under that environment the bare `vscode` specifier no
 * longer resolves, so the whole file fails to load. (Do not write that pragma even
 * in a comment here: it is matched anywhere in the file, not just at the top.)
 * `runScripts: 'outside-only'` gives a window that will `eval` the script without
 * running the page's own, so the script is handed the `acquireVsCodeApi` it
 * expects before it runs.
 *
 * Layout is the one thing this cannot see: jsdom computes no styles, so the flex
 * and overflow rules the pane depends on stay pinned as text below.
 */
function mountPane() {
  const html = renderNavigationViewHtml('test-nonce');
  const scriptAt = html.indexOf('<script');
  const shell = html.slice(html.indexOf('<body>') + '<body>'.length, scriptAt);
  const script = html.slice(html.indexOf('>', scriptAt) + 1, html.indexOf('</script>'));
  if (!shell.includes('id="trail"') || !script.includes('drawTrail')) {
    throw new Error('renderNavigationViewHtml no longer has a body/script shape this can mount');
  }

  const posted: Record<string, unknown>[] = [];
  const dom = new JSDOM(`<body>${shell}</body>`, { runScripts: 'outside-only' });
  const win = dom.window as unknown as Window & {
    acquireVsCodeApi: () => { postMessage: (m: Record<string, unknown>) => void };
    eval: (source: string) => void;
  };
  win.acquireVsCodeApi = () => ({ postMessage: (m) => posted.push(m) });
  win.eval(script);
  const doc = dom.window.document;

  return {
    posted,
    /** Deliver a state push exactly as the provider posts one. */
    push: (over: Partial<NavigationViewState> = {}) =>
      win.dispatchEvent(
        new dom.window.MessageEvent('message', { data: { kind: 'state', ...state(over) } }),
      ),
    location: () => doc.getElementById('location')!,
    rows: () => Array.from(doc.querySelectorAll('#trail .row')),
    trail: () => doc.getElementById('trail')!,
    button: (cmd: string) => doc.querySelector(`[data-cmd="${cmd}"]`) as HTMLButtonElement,
  };
}

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

  it('offers Back, Forward, the history list and its clear, refresh, commit, abort, the label toggle and a workspace', () => {
    expect(toolbarCommands()).toEqual([
      'gemstone.navigateBack',
      'gemstone.navigateForward',
      'gemstone.explorer.showHistory',
      'gemstone.explorer.clearHistory',
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

  it('keeps the Back/Forward keys alive after the last GemStone tab is closed', () => {
    // The keys stopped working the moment the preview tab went away and came back
    // only after clicking in the pane: `resourceScheme == gemstone` needs an ACTIVE
    // EDITOR, and closing the last one leaves none — while focus lands in the empty
    // editor group rather than a view, so the focusedView arm missed too. The third
    // arm covers exactly that gap: the GemStone Explorer is the sidebar you are in,
    // and nothing in the editor area has focus to claim the key.
    const keys = manifest().contributes.keybindings.filter((k) =>
      ['gemstone.navigateBack', 'gemstone.navigateForward'].includes(k.command),
    );
    expect(keys).toHaveLength(2);
    for (const binding of keys) {
      expect(binding.when).toContain('resourceScheme == gemstone');
      expect(binding.when).toContain('focusedView =~ /^gemstoneExplorer/');
      expect(binding.when).toContain(
        "activeViewlet == 'workbench.view.extension.gemstoneExplorer' && !editorFocus",
      );
    }
    // Both directions have to agree, or Back and Forward stop working in different
    // places and the pair reads as broken.
    expect(keys[0].when).toBe(keys[1].when);
  });

  it('leaves the keys to VS Code while a non-GemStone editor has focus', () => {
    // The new arm is guarded by !editorFocus for this reason: editing a .ts file
    // with the GemStone Explorer open in the sidebar must still get VS Code's own
    // Go Back, not a jump into the stone.
    const binding = manifest().contributes.keybindings.find(
      (k) => k.command === 'gemstone.navigateBack',
    );
    expect(binding?.when).not.toMatch(/activeViewlet == '[^']+'\)/);
    expect(binding?.when).toContain('!editorFocus');
  });

  it('leaves the Explorer container enough slack for its sashes to work', () => {
    // VS Code stops drawing sashes at all once every pane is pinned at its
    // minimum — there is nothing left to redistribute — and then NO pane can be
    // resized, this one included. An expanded extension pane costs a 22px header
    // plus a 120px body floor; a collapsed one costs the header alone. Adding this
    // pane took the container from five panes to six, which is what pushed it over
    // and froze the sidebar. Keep the total inside what an ordinary screen gives.
    const HEADER = 22;
    const MIN_BODY = 120;
    const BUDGET = 620;
    const minimum = manifest().contributes.views.gemstoneExplorer.reduce(
      (total, view) => total + HEADER + (view.visibility === 'collapsed' ? 0 : MIN_BODY),
      0,
    );
    expect(minimum).toBeLessThanOrEqual(BUDGET);
  });

  it('gives the trail a bigger share than the smallest pane', () => {
    // At size 1 it was the smallest of the six, so every relayout squeezed the
    // trail back to a couple of rows.
    const views = manifest().contributes.views.gemstoneExplorer;
    const navigation = views.find((v) => v.id === NAVIGATION_VIEW_ID);
    expect(navigation?.size).toBeGreaterThan(1);
  });

  it('starts Back, Forward and Clear greyed out, and leaves the rest live', () => {
    const html = renderNavigationViewHtml('test-nonce');
    const disabled = [...html.matchAll(/data-cmd="([^"]+)"[^>]*?\sdisabled/g)].map((m) => m[1]);
    expect(disabled).toEqual([
      'gemstone.navigateBack',
      'gemstone.navigateForward',
      'gemstone.explorer.clearHistory',
    ]);
  });

  it('re-gates Clear along with Back and Forward on every state push', () => {
    const html = renderNavigationViewHtml('test-nonce');
    expect(html).toContain("setEnabled('gemstone.explorer.clearHistory', state.clear)");
  });

  it('wears the same glyph for Open Workspace as the manifest gives the command', () => {
    // The Logins pane's Open Workspace button is $(notebook); a hand-drawn sheet
    // beside it read as a different action. Same command, same picture.
    const html = renderNavigationViewHtml('test-nonce');
    const notebook = 'M4.75 3C4.33579 3 4 3.33579 4 3.75V5.25C4 5.66421 4.33579 6 4.75 6H10.25';
    expect(html).toContain(notebook);
    const contributed = manifest().contributes.commands;
    expect(contributed.find((c) => c.command === 'gemstone.openWorkspace')?.icon).toBe(
      '$(notebook)',
    );
  });

  it('pins a current-location line above the trail, and hides it until there is one', () => {
    // Dictionaries, class categories and classes are not rows of their own; this
    // one replaceable line is where they show.
    const pane = mountPane();

    pane.push({ location: undefined });
    expect(pane.location().className).toBe('location');
    expect(pane.location().textContent).toBe('');

    pane.push({ location: 'Globals \u203a Account' });
    expect(pane.location().classList.contains('shown')).toBe(true);
    expect(pane.location().textContent).toBe('In Globals \u203a Account');
    // The whole name is on the line's own tooltip, since the line itself elides.
    expect(pane.location().title).toBe('Globals \u203a Account');
  });

  it('draws one row per trail entry, newest first, with the accent on where you are', () => {
    const pane = mountPane();

    pane.push({
      trail: [
        { index: 0, label: 'Array>>at:', context: 'Globals', current: false },
        { index: 1, label: 'Set>>add:', context: 'Globals', current: true },
      ],
    });

    const rows = pane.rows();
    expect(rows.map((r) => r.querySelector('.label')?.textContent)).toEqual([
      'Set>>add:',
      'Array>>at:',
    ]);
    // The row's index is its place in the CHAIN, which is what a click on it names.
    expect(rows.map((r) => (r as HTMLElement).dataset.index)).toEqual(['1', '0']);
    expect(rows.map((r) => r.className)).toEqual(['row current', 'row']);
    // Where you are says so in the dimmed slot rather than repeating its dictionary.
    expect(rows.map((r) => r.querySelector('.dict')?.textContent)).toEqual(['current', 'Globals']);
  });

  it('says the trail is empty rather than drawing nothing at all', () => {
    const pane = mountPane();

    pane.push({ trail: [] });

    expect(pane.rows()).toHaveLength(0);
    expect(pane.trail().textContent).toContain('Methods you open are listed here.');
  });

  it('posts the chain index of the row that was clicked', () => {
    const pane = mountPane();
    pane.push({
      trail: [{ index: 4, label: 'Array>>at:', context: 'Globals', current: false }],
    });

    (pane.rows()[0] as HTMLElement).click();

    expect(pane.posted).toContainEqual({ kind: 'goto', index: 4 });
  });

  it('dims the arrows the chain has run out of', () => {
    const pane = mountPane();

    pane.push({ back: true, forward: false, clear: false });

    expect(pane.button('gemstone.navigateBack').disabled).toBe(false);
    expect(pane.button('gemstone.navigateForward').disabled).toBe(true);
    expect(pane.button('gemstone.explorer.clearHistory').disabled).toBe(true);
  });

  it('gives the trail its own scrolling region under the fixed button row', () => {
    // Text, not DOM: jsdom computes no layout, so the rules that keep the button
    // row put while the trail scrolls can only be pinned as the CSS they are.
    const html = renderNavigationViewHtml('test-nonce');
    expect(html).toContain('id="trail"');
    expect(html).toMatch(/\.trail \{[^}]*overflow-y:\s*auto/);
    expect(html).toMatch(/\.toolbar \{[^}]*flex:\s*0 0 auto/);
    // Hidden until a state push names somewhere; the shown/hidden pair is asserted
    // as behaviour above, this pins the display rules it swaps between.
    expect(html).toMatch(/\.location \{[^}]*display:\s*none/);
    expect(html).toMatch(/\.location\.shown \{\s*display:\s*block/);
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
    send({ kind: 'goto', index: 99 });
    send({ kind: 'goto', index: 0.5 });
    send({ kind: 'goto', index: '1' });
    send({ kind: 'goto' });
    expect(jumps).toEqual([]);
  });

  it('reads only the three things the pane is allowed to say', () => {
    const none = new Set<number>();
    expect(parseViewMessage({ kind: 'ready' }, none)).toEqual({ kind: 'ready' });
    expect(parseViewMessage({ kind: 'run', command: 'gemstone.navigateBack' }, none)).toEqual({
      kind: 'run',
      command: 'gemstone.navigateBack',
    });
    expect(parseViewMessage({ kind: 'goto', index: 0 }, new Set([0]))).toEqual({
      kind: 'goto',
      index: 0,
    });
    expect(parseViewMessage({ kind: 'goto', index: 0 }, none)).toBeUndefined();
    expect(parseViewMessage({ kind: 'nope' }, none)).toBeUndefined();
    expect(parseViewMessage(undefined, none)).toBeUndefined();
  });

  it('accepts a row whose index sits past the end of the trail', () => {
    // A row's index is its place in the VISITED list, and the trail leaves the
    // dictionary and class landings out of that list — so the indices it draws have
    // gaps, and the furthest row's index routinely exceeds the number of rows. A
    // count-based bound silently refused to jump to the oldest methods.
    expect(parseViewMessage({ kind: 'goto', index: 7 }, new Set([2, 7]))).toEqual({
      kind: 'goto',
      index: 7,
    });
    // Still refuses an index nothing drew.
    expect(parseViewMessage({ kind: 'goto', index: 3 }, new Set([2, 7]))).toBeUndefined();
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
      { kind: 'state', back: true, forward: true, clear: true, mode: 'full', trail: trail(1) },
    ]);
    expect(executeCommand).not.toHaveBeenCalled();
  });
});
