/**
 * Shared jsdom harness for the Omni Search webview tests.
 *
 * The DOM these tests mount is derived from `renderOmniHtml` — the SAME function the extension ships
 * to the webview — so a chrome change (a renamed button, a new control, a dropped element) reaches
 * every test automatically. Hand-copied HTML skeletons drifted from production silently: because the
 * view's wiring skips elements it can't find (`if (!el) return;`), a test could stay green against
 * markup the extension no longer emits. Deriving the shell from the real renderer removes that gap.
 *
 * Each webview test file loads the view script once (`loadOmniView`) and mounts through
 * `mountOmniView` instead of repeating the `beforeAll` / `api()` / `SHELL` / `mount()` boilerplate.
 */
import * as fs from 'fs';
import * as path from 'path';
import { vi } from 'vitest';
import { renderOmniHtml } from '../omniSearchShared';

/** Every method the webview's `wire()` returns that these tests reach into. */
export interface WiredOmniView {
  renderResults: (view: unknown) => void;
  onMessage: (event: { data: unknown }) => void;
  setActive: (i: number, scroll?: boolean) => void;
  previewEnabled: () => boolean;
  scopeMenuOpen: () => boolean;
  excludedFromAll: () => string[];
  matchMode: () => string;
}

interface ViewApi {
  wire(doc: Document, vscode: { postMessage: (m: unknown) => void }): WiredOmniView;
}

/**
 * The `#omni` markup exactly as the panel host renders it. `showPin: false` matches the bottom
 * panel; the inlined `<script>` is stripped because jsdom does not execute a script injected via
 * `innerHTML` — the view code is loaded separately by `loadOmniView`.
 */
export function omniShellHtml(): string {
  const html = renderOmniHtml({ showPin: false });
  const start = html.indexOf('<div id="omni"');
  const end = html.indexOf('<script', start);
  if (start < 0 || end < 0) {
    throw new Error(
      'renderOmniHtml no longer exposes an #omni…<script> shell — update omniViewHarness',
    );
  }
  return html.slice(start, end).trim();
}

/** Load the shipped view script once, exposing the `OmniSearchView` global. Call from `beforeAll`. */
export function loadOmniView(): void {
  const source = fs.readFileSync(path.resolve(__dirname, '../omniSearchView.js'), 'utf8');
  new Function(source)();
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = vi.fn();
}

function api(): ViewApi {
  return (globalThis as unknown as { OmniSearchView: ViewApi }).OmniSearchView;
}

export interface MountedOmniView {
  view: WiredOmniView;
  posted: Array<Record<string, unknown>>;
}

/**
 * Mount the real chrome into `document.body` and wire the view to a message collector. Pass a
 * `config` payload to deliver an initial `config` message and start the collector empty (so `posted`
 * reflects only the test's own interactions); omit it to wire without sending a config.
 */
export function mountOmniView(config?: Record<string, unknown>): MountedOmniView {
  document.body.innerHTML = omniShellHtml();
  document.body.className = '';
  const posted: Array<Record<string, unknown>> = [];
  const view = api().wire(document, {
    postMessage: (m: unknown) => posted.push(m as Record<string, unknown>),
  });
  if (config) {
    view.onMessage({ data: { command: 'config', ...config } });
    posted.length = 0;
  }
  return { view, posted };
}
