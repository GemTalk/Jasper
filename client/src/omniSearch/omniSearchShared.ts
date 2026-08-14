/**
 * Shared chrome + message plumbing for the Omni Search webview, used by BOTH hosts: the editor-tab
 * Spotter (`omniSearchPanel.ts`) and the bottom-panel view (`omniSearchViewProvider.ts`). Keeping the
 * HTML, the tab/placeholder helpers, and the common engine-message dispatch here means the two hosts
 * differ only in their host-specific concerns (the tab host has a pin + open-beside + auto-close; the
 * panel host is a docked tool with none of that).
 */
import * as crypto from 'crypto';
import { readWebviewScript } from '../webviewAssets';
import { CATEGORY_BY_ID, OmniCategoryId, OmniConfig } from './omniTypes';
import { OmniEngine, OmniViewData } from './omniEngine';

// The Alt+Enter (references) gesture, rendered per platform. On macOS the Alt key is Option, shown
// as ⌥, with Return as ↩ — the same glyphs VS Code uses in its own keybinding UI; everywhere else
// it stays the literal "Alt+Enter". These are the single source of truth for the hint text so the
// QuickPick placeholder, the webview footer, and the row reference button all agree.
const IS_MAC = process.platform === 'darwin';

/** Plain-text hint for placeholders and tooltips, e.g. `Alt+Enter` or `⌥↩`. */
export const REFERENCES_KEY_HINT = IS_MAC ? '⌥↩' : 'Alt+Enter';

/** `<kbd>`-wrapped hint for the webview footer bar. */
export const REFERENCES_KEY_HINT_HTML = IS_MAC
  ? '<kbd>⌥</kbd><kbd>↩</kbd>'
  : '<kbd>Alt</kbd>+<kbd>Enter</kbd>';

/**
 * Plain-text hint for the shortcut that opens Omni Search from anywhere in a session, per platform.
 * Must track the `gemstone.omniSearch` keybinding in package.json (`ctrl+shift+a` / `cmd+shift+a`);
 * the keybindings manifest test pins that binding so drift here is caught.
 */
export const OMNI_OPEN_KEY_HINT = IS_MAC ? '⌘⇧A' : 'Ctrl+Shift+A';

/** Scope-name lookup for the placeholder. */
const SCOPE_LABEL: Record<string, string> = {
  all: 'everything',
  classes: 'classes',
  methods: 'methods',
  dictionaries: 'dictionaries',
  globals: 'globals',
  source: 'source',
  literals: 'literals',
  categories: 'categories',
};

/** The enabled categories shaped for the webview's tab row (label + explicit flag + search hint). */
export function tabCategoriesFrom(
  enabled: readonly OmniCategoryId[],
): Array<{ id: string; label: string; explicitOnly: boolean; searchHint?: string }> {
  return enabled.map((id) => {
    const cat = CATEGORY_BY_ID[id];
    return {
      id,
      label: cat.label,
      explicitOnly: cat.explicitOnly === true,
      searchHint: cat.searchHint,
    };
  });
}

/** A minimal, scope-aware placeholder — deliberately WITHOUT the QuickPick's cluttered gesture hint.
 *  Explicit-only scopes show their own instruction (they start a search rather than filter rows). */
export function placeholderFor(scopeId: string | null): string {
  if (scopeId) {
    const hint = CATEGORY_BY_ID[scopeId as keyof typeof CATEGORY_BY_ID]?.searchHint;
    if (hint) return hint;
    return `Search ${SCOPE_LABEL[scopeId] ?? scopeId}…`;
  }
  return 'Search classes, methods, globals…';
}

/** The `results` message payload for a fresh view, decorated with the current chrome state. */
export function resultsMessage(
  view: OmniViewData,
  chrome: {
    config: OmniConfig;
    scopeId: OmniCategoryId | null;
    caseSensitive: boolean;
    pinned: boolean;
  },
): Record<string, unknown> {
  return {
    command: 'results',
    rows: view.rows,
    shownCount: view.shownCount,
    hasMore: view.hasMore,
    exact: view.exact,
    pivot: view.pivot,
    pivotTitle: view.pivotTitle,
    categories: tabCategoriesFrom(chrome.config.enabledCategories),
    scopeId: chrome.scopeId,
    caseSensitive: chrome.caseSensitive,
    pinned: chrome.pinned,
    referencesInPreview: chrome.config.referencesInPreview,
    placeholder: placeholderFor(view.pivot ? null : chrome.scopeId),
  };
}

/** The initial `config` message sent on `ready`. */
export function configMessage(config: OmniConfig, pinned: boolean): Record<string, unknown> {
  return {
    command: 'config',
    categories: tabCategoriesFrom(config.enabledCategories),
    scopeId: null,
    caseSensitive: config.caseSensitive,
    pinned,
    referencesInPreview: config.referencesInPreview,
    placeholder: placeholderFor(null),
    keyHint: REFERENCES_KEY_HINT,
  };
}

/** A message from the webview whose engine effect is host-independent. */
export interface CommonInbound {
  command: string;
  value?: string;
  scopeId?: OmniCategoryId | null;
  id?: number;
}

/**
 * Run the engine op for a host-independent message (query / setScope / toggleCase / loadMore /
 * loadAll / references / back). Returns the fresh view, `null` when superseded, or `undefined` when
 * the message isn't one of these (so the host handles it — ready/activate/preview/close/togglePin).
 */
export function dispatchEngineMessage(
  engine: OmniEngine,
  m: CommonInbound,
): Promise<OmniViewData | null> | undefined {
  switch (m.command) {
    case 'query':
      return engine.search(m.value ?? '');
    case 'setScope':
      return engine.setScope(m.scopeId ?? null);
    case 'toggleCase':
      return engine.toggleCase();
    case 'loadMore':
      return engine.loadMore();
    case 'loadAll':
      return engine.loadAll();
    case 'references':
      return engine.pivot(m.id ?? -1);
    case 'back':
      return engine.exitPivot();
    default:
      return undefined;
  }
}

/**
 * The full Omni Search webview HTML. `showPin` includes the 📌 (only the editor-tab host has a tab
 * to pin). Both hosts get the always-on source-preview pane of the active row.
 */
export function renderOmniHtml(opts: { showPin: boolean }): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const script = readWebviewScript('omniSearchView.js', 'omniSearch');
  const pinButton = opts.showPin
    ? '<button id="pin" title="Keep Omni Search open (pin to a tab)" aria-pressed="false">📌</button>'
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>GemStone Search</title>
  <style>
    :root { --omni-gap: 8px; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 0;
      margin: 0;
    }
    #omni {
      max-width: 960px;
      margin: 0 auto;
      padding: 10px 14px 8px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      box-sizing: border-box;
    }
    #tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: var(--omni-gap); }
    .tab {
      padding: 3px 10px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 999px;
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      cursor: pointer;
      font-size: 0.85em;
      font-family: inherit;
    }
    .tab:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground)); }
    .tab.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
    }
    .tab.explicit { font-style: italic; border-style: dashed; }
    .tab.explicit::before { content: '\\1F50D\\00A0'; font-style: normal; font-size: 0.9em; }
    .tabsep {
      align-self: center;
      margin: 0 4px 0 8px;
      font-size: 0.72em;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--vscode-descriptionForeground);
      border-left: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
      padding-left: 8px;
    }
    #searchbar { display: flex; align-items: center; gap: 6px; }
    #field {
      flex: 1 1 auto;
      display: flex;
      align-items: center;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
    }
    #field:focus-within { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
    #query {
      flex: 1 1 auto;
      padding: 6px 10px;
      font-size: 1.1em;
      background: transparent;
      color: var(--vscode-input-foreground);
      border: none;
      outline: none;
      font-family: inherit;
    }
    #clear {
      flex: 0 0 auto;
      background: transparent;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      font-size: 1.3em;
      line-height: 1;
      padding: 0 8px;
    }
    #clear:hover { color: var(--vscode-foreground); }
    #pin {
      flex: 0 0 auto;
      padding: 5px 8px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      background: transparent;
      cursor: pointer;
      opacity: 0.55;
      filter: grayscale(1);
    }
    #pin.active { opacity: 1; filter: none; background: var(--vscode-button-secondaryBackground, transparent); }
    #case {
      flex: 0 0 auto;
      padding: 5px 9px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      font-family: inherit;
      font-weight: 600;
      opacity: 0.65;
    }
    #case.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
      opacity: 1;
    }
    #breadcrumb { margin-top: var(--omni-gap); font-size: 0.9em; color: var(--vscode-descriptionForeground); display: none; }
    #error {
      margin-top: var(--omni-gap);
      padding: 6px 10px;
      border-radius: 4px;
      background: var(--vscode-inputValidation-errorBackground, transparent);
      border: 1px solid var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
      color: var(--vscode-foreground);
      display: none;
    }
    #body {
      flex: 1 1 auto;
      display: flex;
      gap: 12px;
      min-height: 0;
      margin-top: var(--omni-gap);
    }
    #results { flex: 1 1 55%; list-style: none; margin: 0; padding: 0; overflow-y: auto; min-height: 0; }
    /* Always-on source preview of the active row (with the searched term highlighted). */
    #preview {
      flex: 1 1 45%;
      overflow: auto;
      min-height: 0;
      border-left: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
      padding-left: 12px;
      display: none;
    }
    #preview.has-content { display: block; }
    .preview-title { font-weight: 600; margin-bottom: 6px; color: var(--vscode-descriptionForeground); word-break: break-all; }
    .preview-src { margin: 0; white-space: pre-wrap; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; }
    .preview-src mark {
      background: var(--vscode-editor-findMatchBackground, rgba(234,92,0,0.6));
      outline: 1px solid var(--vscode-editor-findMatchBorder, rgba(234,92,0,0.9));
      color: var(--vscode-editor-foreground, inherit);
      border-radius: 2px;
    }
    /* The sticky references/senders list, shown IN the preview pane (referencesInPreview mode). */
    .preview-list { list-style: none; margin: 0; padding: 0; }
    .preview-ref-item { list-style: none; }
    .preview-ref { display: flex; align-items: baseline; gap: 6px; padding: 3px 6px; border-radius: 4px; cursor: pointer; }
    .preview-ref:hover { background: var(--vscode-list-hoverBackground); }
    .preview-ref .twisty { flex: 0 0 auto; width: 0.9em; text-align: center; font-size: 0.75em; opacity: 0.7; }
    /* Inline (EI Meta-tab style) source of an expanded reference, with the searched symbol highlighted. */
    .preview-ref-src {
      margin: 1px 0 6px 1.7em;
      white-space: pre-wrap;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 0.85em;
      color: var(--vscode-foreground);
      border-left: 2px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
      padding-left: 8px;
    }
    .preview-ref-src mark {
      background: var(--vscode-editor-findMatchBackground, rgba(234,92,0,0.6));
      outline: 1px solid var(--vscode-editor-findMatchBorder, rgba(234,92,0,0.9));
      color: var(--vscode-editor-foreground, inherit);
      border-radius: 2px;
    }
    .preview-ref:focus {
      outline: none;
      background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground));
      color: var(--vscode-list-activeSelectionForeground);
      box-shadow: inset 3px 0 0 0 var(--vscode-focusBorder, var(--vscode-list-focusOutline, #007acc));
    }
    .preview-ref .label { flex: 0 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .preview-ref .desc { flex: 1 1 auto; color: var(--vscode-descriptionForeground); font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .preview-empty { color: var(--vscode-descriptionForeground); font-style: italic; }
    .row { display: flex; align-items: baseline; gap: 8px; padding: 3px 8px 3px 10px; border-radius: 4px; cursor: pointer; }
    .row:hover { background: var(--vscode-list-hoverBackground); }
    /* The active row's background is theme-dependent and can be faint (and webviews don't get VS
       Code's focused/unfocused list treatment), so add a solid left accent bar that always reads. */
    .row.active {
      background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-inactiveSelectionBackground));
      color: var(--vscode-list-activeSelectionForeground);
      box-shadow: inset 3px 0 0 0 var(--vscode-focusBorder, var(--vscode-list-focusOutline, #007acc));
    }
    .row .label { flex: 0 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row .cat {
      flex: 0 0 auto;
      font-size: 0.7em;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--vscode-descriptionForeground);
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
      border-radius: 3px;
      padding: 0 4px;
      opacity: 0.9;
    }
    .row.active .cat { color: inherit; opacity: 0.85; }
    .row .desc { flex: 1 1 auto; color: var(--vscode-descriptionForeground); font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row.active .desc { color: inherit; opacity: 0.85; }
    .row mark { background: transparent; color: var(--vscode-list-highlightForeground, var(--vscode-textLink-foreground)); font-weight: 700; }
    .row.active mark { color: inherit; text-decoration: underline; }
    .refbtn { flex: 0 0 auto; background: transparent; border: none; color: inherit; cursor: pointer; opacity: 0.6; font-size: 1em; }
    .refbtn:hover { opacity: 1; }
    #footer {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-top: 6px;
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
      border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
      margin-top: 6px;
    }
    #count { flex: 1 1 auto; }
    /* A persistent, unobtrusive gesture legend — useful now that Omni Search is a docked panel you
       keep open (not a glance-once dialog). Distinct from the QuickPick's cluttered field-hover. */
    #hints { flex: 0 0 auto; opacity: 0.7; font-size: 0.95em; }
    #hints kbd {
      font-family: inherit;
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
      border-radius: 3px;
      padding: 0 4px;
      margin: 0 2px;
    }
    #footer button {
      background: transparent;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      color: var(--vscode-foreground);
      padding: 2px 10px;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
    }
    #footer button:hover { background: var(--vscode-list-hoverBackground); }
    body.busy #query { background:
      linear-gradient(90deg, var(--vscode-input-background) 0%, var(--vscode-list-hoverBackground) 50%, var(--vscode-input-background) 100%);
    }
  </style>
</head>
<body>
  <div id="omni">
    <div id="tabs" role="tablist"></div>
    <div id="searchbar">
      <div id="field">
        <input id="query" type="text" autocomplete="off" spellcheck="false" placeholder="Search…" aria-label="Omni Search">
        <button id="clear" title="Clear search" aria-label="Clear search" style="display:none">×</button>
      </div>
      <button id="case" title="Case sensitivity" aria-pressed="false">Aa</button>
      ${pinButton}
    </div>
    <div id="breadcrumb"></div>
    <div id="error"></div>
    <div id="body">
      <ul id="results"></ul>
      <div id="preview"></div>
    </div>
    <div id="footer">
      <span id="hints"><kbd>Enter</kbd> open · ${REFERENCES_KEY_HINT_HTML} references</span>
      <span id="count"></span>
      <button id="loadMore" title="Load more results" style="display:none">Load more</button>
      <button id="loadAll" title="Load all results (up to the server limit)" style="display:none">Load all</button>
    </div>
  </div>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
}
