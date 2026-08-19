/**
 * Shared chrome + message plumbing for the GemStone Search webview, used by BOTH hosts: the editor-tab
 * Spotter (`omniSearchPanel.ts`) and the bottom-panel view (`omniSearchViewProvider.ts`). Keeping the
 * HTML, the tab/placeholder helpers, and the common engine-message dispatch here means the two hosts
 * differ only in their host-specific concerns (the tab host has a pin + open-beside + auto-close; the
 * panel host is a docked tool with none of that).
 */
import * as crypto from 'crypto';
import { readWebviewScript } from '../webviewAssets';
import { CATEGORY_BY_ID, OmniCategoryId, OmniConfig } from './omniTypes';
import { MatchMode } from './omniMatch';
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
 * Plain-text hint for the shortcut that opens GemStone Search from anywhere in a session, per platform.
 * Must track the `gemstone.search` keybinding in package.json (`ctrl+shift+a` / `cmd+shift+a`);
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
  categories: 'class categories',
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

/**
 * The `results` message payload for a fresh view, decorated with the current chrome state.
 *
 * `previewPane` is deliberately NOT included here. Once the webview has it from `configMessage` the
 * toggle belongs to the webview alone (the engine has no part in it), so re-sending it on every
 * results message would silently undo the user's toggle on their next keystroke. Anyone adding a
 * field to this payload should double-check it is engine-owned before forwarding it.
 */
export function resultsMessage(
  view: OmniViewData,
  chrome: {
    config: OmniConfig;
    scopeId: OmniCategoryId | null;
    caseSensitive: boolean;
    pinned: boolean;
    excludedFromAll: OmniCategoryId[];
    matchMode: MatchMode;
  },
): Record<string, unknown> {
  return {
    command: 'results',
    rows: view.rows,
    shownCount: view.shownCount,
    hasMore: view.hasMore,
    exact: view.exact,
    // Scopes whose own server scan was capped, so the footer can say so IN the UI. This payload lists
    // its fields one by one rather than spreading `view`, so a new OmniViewData field is invisible to
    // the webview until it is added here — which is exactly how the truncation notice first shipped
    // broken (the engine computed the flag, the footer never received it, and a scan that stopped at
    // its ceiling still reported a bare "200 results").
    truncations: view.truncations,
    pivot: view.pivot,
    pivotTitle: view.pivotTitle,
    pivotHint: view.pivotHint,
    categories: tabCategoriesFrom(chrome.config.enabledCategories),
    scopeId: chrome.scopeId,
    caseSensitive: chrome.caseSensitive,
    pinned: chrome.pinned,
    referencesInPreview: chrome.config.referencesInPreview,
    // Which categories are currently held back from "All" — the scope filter renders its checkboxes
    // from this, so the panel always shows what the engine actually did.
    excludedFromAll: chrome.excludedFromAll,
    // Engine-owned, like `caseSensitive` — so it IS re-sent every time, unlike `previewPane`.
    matchMode: chrome.matchMode,
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
    // Starting values for the two in-panel controls; both are owned by the session afterwards.
    previewPane: config.previewPane,
    excludedFromAll: config.excludedFromAll,
    matchMode: config.matchMode,
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
  /** Categories to hold back from the "All" fan-out (the scope filter's checkbox state). */
  excludedFromAll?: OmniCategoryId[];
  /** The match algorithm picked from the panel. */
  mode?: MatchMode;
}

/**
 * Run the engine op for a host-independent message (query / setScope / toggleCase / loadMore /
 * loadAll / references / back / setExcludedFromAll / setMatchMode). Returns the fresh view, `null` when superseded,
 * or `undefined` when the message isn't one of these (so the host handles it —
 * ready/activate/preview/close/togglePin). The preview-pane toggle is absent on purpose: it never
 * reaches the host at all, since hiding the pane is pure chrome with no engine effect.
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
    case 'setExcludedFromAll':
      return engine.setExcludedFromAll(m.excludedFromAll ?? []);
    case 'setMatchMode':
      return engine.setMatchMode(m.mode ?? 'fuzzy');
    default:
      return undefined;
  }
}

/**
 * The full GemStone Search webview HTML. `showPin` includes the 📌 (only the editor-tab host has a tab
 * to pin). Both hosts get the always-on source-preview pane of the active row.
 */
export function renderOmniHtml(opts: { showPin: boolean }): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const script = readWebviewScript('omniSearchView.js', 'omniSearch');
  const pinButton = opts.showPin
    ? '<button id="pin" title="Keep GemStone Search open (pin to a tab)" aria-pressed="false">📌</button>'
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
      /* Size to the window, not to a fixed pixel cap. A max-width of 960px here left a wide monitor
         mostly empty and ellipsized long Class>>selector rows with blank space sitting beside them;
         both hosts render this chrome, so the docked panel paid for it too. (No backticks in here --
         this stylesheet lives inside a template literal.) */
      width: 100%;
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
    /* Heavy/slow scopes (Source/Literals/Categories) each run a full-image scan, so they carry a
       distinct hourglass marker rather than the plain magnifier the whole field otherwise reads as.
       No backticks in this comment -- the stylesheet is a template literal. */
    .tab.explicit::before { content: '\\231B\\00A0'; font-style: normal; font-size: 0.9em; }
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
    /* References-mode indicator: a chip in the field row, styled like the always-on
       case toggle, that appears (filled/accent) whenever the panel is showing references or senders --
       so it is obvious you are in a references view -- and clicking it exits back to the normal search.
       Shown/hidden via an INLINE style the view sets, never via a stylesheet display:none. */
    #refindicator {
      flex: 0 0 auto;
      padding: 5px 9px;
      border: 1px solid var(--vscode-button-background);
      border-radius: 4px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-family: inherit;
      font-size: 0.85em;
      white-space: nowrap;
    }
    #refindicator:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }
    /* "Not searched here: Source - Literals - Class Categories" under the field while the All scope is
       active. Those three are explicitOnly, so an All-scope search silently skips them and "no results"
       is indistinguishable from "not in the image". No display rule here on purpose: the
       element starts hidden via an inline style and the view sets explicit display values, because a
       rule here would beat the view clearing the inline style. Unlike the footer's cap note this one
       does NOT reserve space when hidden — an empty line under the field would just be a gap. */
    #scopehint {
      margin-top: var(--omni-gap);
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
    }
    #scopehint button {
      background: transparent;
      border: none;
      padding: 0 2px;
      font-family: inherit;
      font-size: inherit;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      text-decoration: underline;
    }
    #scopehint button:hover { color: var(--vscode-textLink-activeForeground); }
    #breadcrumb { margin-top: var(--omni-gap); font-size: 0.9em; color: var(--vscode-descriptionForeground); display: none; }
    /* The pivot's exit hint rides beside the breadcrumb title as its own span, quieter than the
       title so it reads as an aside rather than part of the name of the list. */
    #breadcrumb .crumb-hint { margin-left: 0.6em; font-size: 0.85em; opacity: 0.75; }
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
    #count { flex: 0 0 auto; }
    /* Sits immediately after the count so the two read as one statement: "200+ shown — Methods scan
       capped at 200". A capped scan is otherwise invisible: the results just stop, with
       nothing on screen saying the scan gave up rather than ran out. Warning-toned, not error-toned —
       the results shown are correct, merely incomplete. */
    /* This note is ALWAYS a flex item and is the footer's only slack absorber, so the Load buttons stay
       pinned to the right whether or not it has anything to say. The view toggles "visibility", never
       "display": display:none removes the item, which both hands the slack to something else and drops
       one of the footer's 10px gaps — so the buttons visibly jumped as the note came and went.
       Deliberately NO display rule here either; a "display: none" in this stylesheet would also win over
       the view and leave the note permanently invisible, which is how it first shipped.
       (No backticks in this comment: the whole stylesheet is inside a template literal.) */
    #capnote {
      flex: 1 1 auto;
      min-width: 0;
      color: var(--vscode-editorWarning-foreground, var(--vscode-inputValidation-warningBorder));
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: help;
    }
    /* A persistent, unobtrusive gesture legend — useful now that GemStone Search is a docked panel you
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
    /* Two controls over what a search COSTS: the preview-pane toggle and the All-scope filter.
       Kept in their own block (and shaped to match the case chip rather than editing its rule) so
       this stays an additive hunk. No backticks anywhere in here - this is a template literal. */
    #previewToggle, #scopeFilter, #matchMode {
      flex: 0 0 auto;
      padding: 5px 9px;
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 4px;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      font-family: inherit;
      opacity: 0.65;
    }
    #previewToggle.active, #scopeFilter.active {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
      opacity: 1;
    }
    /* The algorithm chip always shows its CURRENT value as text, so it needs no on/off state. */
    #matchMode {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: var(--vscode-button-background);
      opacity: 1;
    }
    /* The filter button owns the menu's positioning context, so the searchbar rule is left alone. */
    #scopeFilterWrap { position: relative; flex: 0 0 auto; display: inline-flex; }
    #scopeFilterMenu {
      position: absolute;
      right: 0;
      top: calc(100% + 4px);
      z-index: 10;
      min-width: 190px;
      padding: 4px 0;
      background: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
      color: var(--vscode-menu-foreground, var(--vscode-foreground));
      border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, var(--vscode-panel-border, transparent)));
      border-radius: 4px;
      box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0,0,0,0.36));
    }
    #scopeFilterMenu[hidden] { display: none; }
    .scope-opt-title {
      padding: 2px 10px 4px;
      font-size: 0.8em;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    .scope-opt {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 4px 10px;
      background: transparent;
      border: none;
      color: inherit;
      font-family: inherit;
      font-size: inherit;
      text-align: left;
      cursor: pointer;
      white-space: nowrap;
    }
    .scope-opt:hover { background: var(--vscode-list-hoverBackground); }
    .scope-opt .box { flex: 0 0 auto; width: 1em; text-align: center; opacity: 0.9; }
    .scope-opt.off { color: var(--vscode-descriptionForeground); }
    /* Preview off: the results list gets the whole body width back. Beats the has-content rule on
       specificity, so a loaded preview stays hidden until the pane is switched back on. */
    body.no-preview #preview { display: none; }
  </style>
</head>
<body>
  <div id="omni">
    <div id="tabs" role="tablist"></div>
    <div id="searchbar">
      <div id="field">
        <input id="query" type="text" autocomplete="off" spellcheck="false" placeholder="Search…" aria-label="GemStone Search">
        <button id="clear" title="Clear search" aria-label="Clear search" style="display:none">×</button>
      </div>
      <button id="case" title="Case sensitivity" aria-pressed="false">Aa</button>
      <button id="previewToggle" title="Show the source preview" aria-label="Show the source preview" aria-pressed="true">&#9707;</button>
      <span id="scopeFilterWrap">
        <button id="scopeFilter" title="Choose which scopes the All search runs" aria-label="Choose which scopes the All search runs" aria-haspopup="true" aria-expanded="false">Scopes</button>
        <div id="scopeFilterMenu" role="menu" hidden></div>
      </span>
      <button id="matchMode" title="Match algorithm" aria-label="Match algorithm">Fuzzy</button>
      <button id="refindicator" title="Showing references — click to exit" aria-pressed="false" style="display:none">↗ References</button>
      ${pinButton}
    </div>
    <div id="scopehint" style="display:none"></div>
    <div id="breadcrumb"></div>
    <div id="error"></div>
    <div id="body">
      <ul id="results"></ul>
      <div id="preview"></div>
    </div>
    <div id="footer">
      <span id="hints"><kbd>Enter</kbd> open · ${REFERENCES_KEY_HINT_HTML} references · <kbd>Tab</kbd>/<kbd>&#8679;Tab</kbd> switch scope</span>
      <span id="count"></span>
      <span id="capnote" role="status" style="visibility:hidden"></span>
      <button id="loadMore" title="Load more results" style="display:none">Load more</button>
      <button id="loadAll" title="Load all results (up to the server limit)" style="display:none">Load all</button>
    </div>
  </div>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
}
