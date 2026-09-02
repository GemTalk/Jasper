import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { TrailLabelMode } from './explorerNavigationHistory';

/**
 * The GemStone Explorer's Actions & Navigation pane: a row of the controls you
 * reach for while developing, over a line naming where the Explorer is standing
 * now and, under it, the trail of the methods it has been through. Named for both
 * halves, because Refresh, Commit and Abort are not navigation — and a pane title
 * that covered only one half would imply the other half's buttons act on the
 * thing it names.
 *
 * It is a WEBVIEW rather than a tree with title-bar actions, and that is the whole
 * point of it. VS Code renders a view's title actions only while the pane is
 * EXPANDED and hovered or focused — the stylesheet gates every rule that shows
 * them on `.expanded`, and `workbench.view.alwaysShowHeaderActions` only relaxes
 * the hover half — so a collapsed pane can never show a button. An expanded pane,
 * meanwhile, has a 120px minimum body (only built-in views override it), so the
 * pane costs ~148px whatever it holds. Given that floor is unavoidable, the pane
 * spends it: a always-on button row, and under it the trail, so the height buys
 * something instead of standing empty.
 *
 * The buttons are plain commands, so each one also works from the Command Palette
 * and from any keybinding; nothing here is the only way to reach a function.
 */
export const NAVIGATION_VIEW_ID = 'gemstoneExplorerNavigation';

interface ToolbarButton {
  /** The command the button runs. Also its `data-cmd` handle in the DOM. */
  command: string;
  /** Tooltip and accessible name. */
  label: string;
  /** The 16×16 glyph, as inline SVG markup. */
  glyph: string;
  /** Starts a new group, drawn with a separator before it. */
  startsGroup?: boolean;
  /** Greyed out until the extension says otherwise (Back/Forward at the ends). */
  gated?: boolean;
  /** Only drawn while the trail is in this label mode — the two halves of the
   *  full/selectors toggle, which occupy one slot between them. */
  mode?: TrailLabelMode;
}

/**
 * Glyphs are inlined SVG — the same bargain the debugger toolbar and the Session
 * Configuration panel strike: no webfont to fetch, no extra `localResourceRoots`,
 * and nothing loaded from outside the page, so the strict CSP holds.
 * `fill="currentColor"` lets each button's colour drive its glyph.
 *
 * Every glyph here is the exact VS Code codicon path for the icon the command
 * declares in the manifest, so the button and the same command's Command Palette
 * / title-bar entry are the one picture — `notebook` for Open Workspace (the icon
 * the Logins pane's Open Workspace button already wears), `history` for Recent
 * Locations, `clear-all` for Clear History, `check` / `discard` / `refresh` for
 * Commit, Abort and Refresh. CHEVRON is the codicon chevron-right, mirrored in
 * place for Back and given a shaft so the pair reads as arrows, matching the
 * `$(arrow-left)`/`$(arrow-right)` those two commands wear elsewhere.
 */
const CHEVRON =
  'M6.14601 3.14579C5.95101 3.34079 5.95101 3.65779 6.14601 3.85279L10.292 7.99879L6.14601 12.1448C5.95101 12.3398 5.95101 12.6568 6.14601 12.8518C6.34101 13.0468 6.65801 13.0468 6.85301 12.8518L11.353 8.35179C11.548 8.15679 11.548 7.83979 11.353 7.64478L6.85301 3.14479C6.65801 2.94979 6.34101 2.95079 6.14601 3.14579Z';

const BUTTONS: ToolbarButton[] = [
  {
    command: 'gemstone.navigateBack',
    label: 'Go Back',
    gated: true,
    glyph: `<g transform="translate(16,0) scale(-1,1)"><path d="${CHEVRON}"/></g><path d="M6 7.5h7.3v1H6z"/>`,
  },
  {
    command: 'gemstone.navigateForward',
    label: 'Go Forward',
    gated: true,
    glyph: `<path d="${CHEVRON}"/><path d="M2.7 7.5H10v1H2.7z"/>`,
  },
  {
    // The one place the whole chain is on show — including the dictionary, class
    // category and class landings that Back and Forward step over and the trail
    // below leaves out.
    command: 'gemstone.explorer.showHistory',
    label: 'Recent Locations…',
    glyph:
      '<path d="M7.99909 3C10.7605 3 12.9991 5.23858 12.9991 8C12.9991 10.7614 10.7605 13 7.99909 13C5.39117 13 3.2491 11.003 3.0195 8.45512C2.99471 8.1801 2.75167 7.97723 2.47664 8.00202C2.20161 8.0268 1.99875 8.26985 2.02353 8.54488C2.29916 11.6035 4.86898 14 7.99909 14C11.3128 14 13.9991 11.3137 13.9991 8C13.9991 4.68629 11.3128 2 7.99909 2C6.20656 2 4.59815 2.78613 3.49909 4.03138V2.5C3.49909 2.22386 3.27524 2 2.99909 2C2.72295 2 2.49909 2.22386 2.49909 2.5V5.5C2.49909 5.77614 2.72295 6 2.99909 6H3.08812C3.09498 6.00014 3.10184 6.00014 3.10868 6H5.99909C6.27524 6 6.49909 5.77614 6.49909 5.5C6.49909 5.22386 6.27524 5 5.99909 5H3.99863C4.91128 3.78495 6.36382 3 7.99909 3ZM7.99909 5.5C7.99909 5.22386 7.77524 5 7.49909 5C7.22295 5 6.99909 5.22386 6.99909 5.5V8.5C6.99909 8.77614 7.22295 9 7.49909 9H9.49909C9.77524 9 9.99909 8.77614 9.99909 8.5C9.99909 8.22386 9.77524 8 9.49909 8H7.99909V5.5Z"/>',
  },
  {
    // Greyed out on an empty chain, so the row says whether there is anything to
    // clear without the user having to press it to find out.
    command: 'gemstone.explorer.clearHistory',
    label: 'Clear Navigation History',
    gated: true,
    glyph:
      '<path d="M13.5004 12.0004C13.7762 12.0006 14.0004 12.2245 14.0004 12.5004C14.0002 12.7761 13.7761 13.0002 13.5004 13.0004H2.50037C2.22449 13.0004 2.00056 12.7762 2.00037 12.5004C2.00037 12.2244 2.22437 12.0004 2.50037 12.0004H13.5004Z"/>' +
      '<path d="M13.5004 9.00037C13.7762 9.00056 14.0004 9.22449 14.0004 9.50037C14.0002 9.77608 13.7761 10.0002 13.5004 10.0004H2.50037C2.22449 10.0004 2.00056 9.7762 2.00037 9.50037C2.00037 9.22437 2.22437 9.00037 2.50037 9.00037H13.5004Z"/>' +
      '<path d="M13.5004 6.00037C13.7762 6.00056 14.0004 6.22449 14.0004 6.50037C14.0002 6.77608 13.7761 7.00017 13.5004 7.00037H7.50037C7.22449 7.00037 7.00056 6.7762 7.00037 6.50037C7.00037 6.22437 7.22437 6.00037 7.50037 6.00037H13.5004Z"/>' +
      '<path d="M5.50037 0.999023C5.63295 0.999115 5.76009 1.05179 5.85388 1.14551C5.94777 1.23939 6.00037 1.36722 6.00037 1.5C6.00027 1.63265 5.94769 1.75971 5.85388 1.85352L3.7074 4L5.85388 6.14551C5.94777 6.23939 6.00037 6.36722 6.00037 6.5C6.00027 6.63265 5.94769 6.75971 5.85388 6.85352C5.76008 6.94732 5.63302 6.99991 5.50037 7C5.36759 7 5.23976 6.9474 5.14587 6.85352L3.00037 4.70703L0.853882 6.85352C0.760077 6.94732 0.633017 6.99991 0.500366 7C0.36759 7 0.239761 6.9474 0.145874 6.85352C0.0521583 6.75972 -0.000519052 6.63258 -0.000610352 6.5C-0.000610354 6.36722 0.0519875 6.23939 0.145874 6.14551L2.29333 4L0.145874 1.85352C0.0521583 1.75972 -0.000519119 1.63258 -0.000610352 1.5C-0.000610351 1.36722 0.0519874 1.23939 0.145874 1.14551C0.239761 1.05162 0.36759 0.999023 0.500366 0.999023C0.63295 0.999115 0.76009 1.05179 0.853882 1.14551L3.00037 3.29297L5.14587 1.14551C5.23976 1.05162 5.36759 0.999023 5.50037 0.999023Z"/>' +
      '<path d="M13.5004 3.00037C13.7762 3.00056 14.0004 3.22449 14.0004 3.50037C14.0002 3.77608 13.7761 4.00017 13.5004 4.00037H7.50037C7.22449 4.00037 7.00056 3.7762 7.00037 3.50037C7.00037 3.22437 7.22437 3.00037 7.50037 3.00037H13.5004Z"/>',
  },
  {
    command: 'gemstone.explorer.refresh',
    label: 'Refresh GemStone Explorer',
    startsGroup: true,
    glyph:
      '<path d="M3 8C3 5.23858 5.23858 3 8 3C9.63527 3 11.0878 3.78495 12.0005 5H10C9.72386 5 9.5 5.22386 9.5 5.5C9.5 5.77614 9.72386 6 10 6H12.8904C12.8973 6.00014 12.9041 6.00014 12.911 6H13C13.2761 6 13.5 5.77614 13.5 5.5V2.5C13.5 2.22386 13.2761 2 13 2C12.7239 2 12.5 2.22386 12.5 2.5V4.03138C11.4009 2.78613 9.79253 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14C11.1301 14 13.6999 11.6035 13.9756 8.54488C14.0003 8.26985 13.7975 8.0268 13.5225 8.00202C13.2474 7.97723 13.0044 8.1801 12.9796 8.45512C12.75 11.003 10.6079 13 8 13C5.23858 13 3 10.7614 3 8Z"/>',
  },
  {
    command: 'gemstone.explorer.commit',
    label: 'Commit',
    glyph:
      '<path d="M13.6572 3.13573C13.8583 2.9465 14.175 2.95614 14.3643 3.15722C14.5535 3.35831 14.5438 3.675 14.3428 3.86425L5.84277 11.8642C5.64597 12.0494 5.33756 12.0446 5.14648 11.8535L1.64648 8.35351C1.45121 8.15824 1.45121 7.84174 1.64648 7.64647C1.84174 7.45121 2.15825 7.45121 2.35351 7.64647L5.50976 10.8027L13.6572 3.13573Z"/>',
  },
  {
    command: 'gemstone.explorer.abort',
    label: 'Abort',
    glyph:
      '<path d="M3.00098 2.5C3.00098 2.22386 3.22483 2 3.50098 2C3.77712 2 4.00098 2.22386 4.00098 2.5V6.34262L7.17202 3.17157C8.73412 1.60948 11.2668 1.60948 12.8289 3.17157C14.391 4.73367 14.391 7.26633 12.8289 8.82843L7.80375 13.8536C7.60849 14.0488 7.2919 14.0488 7.09664 13.8536C6.90138 13.6583 6.90138 13.3417 7.09664 13.1464L12.1218 8.12132C13.2933 6.94975 13.2933 5.05025 12.1218 3.87868C10.9502 2.70711 9.0507 2.70711 7.87913 3.87868L4.75781 7H8.50098C8.77712 7 9.00098 7.22386 9.00098 7.5C9.00098 7.77614 8.77712 8 8.50098 8H3.60098C3.26961 8 3.00098 7.73137 3.00098 7.4V2.5Z"/>',
  },
  {
    command: 'gemstone.explorer.showNavigationSelectorsOnly',
    label: 'Show Only Selectors in the Trail',
    startsGroup: true,
    // codicon list-flat — the same glyph the Methods pane's ungroup toggle wears,
    // for the same idea: drop a level and list the leaves.
    glyph: '<path d="M2 3.5h12v1H2zm0 3.5h12v1H2zm0 3.5h12v1H2zm0 3.5h12v-1H2z"/>',
    mode: 'full',
  },
  {
    command: 'gemstone.explorer.showNavigationFullLocations',
    label: 'Show Full Locations in the Trail',
    startsGroup: true,
    // codicon list-tree — rows indented under a parent, i.e. the class restored.
    glyph: '<path d="M2 3h1v10H2zm2 .5h10v1H4zm2 3.5h8v1H6zm0 3.5h8v1H6zm-2 3.5h10v-1H4z"/>',
    mode: 'selectors',
  },
  {
    command: 'gemstone.openWorkspace',
    label: 'Open Workspace',
    glyph:
      '<path d="M4.75 3C4.33579 3 4 3.33579 4 3.75V5.25C4 5.66421 4.33579 6 4.75 6H10.25C10.6642 6 11 5.66421 11 5.25V3.75C11 3.33579 10.6642 3 10.25 3H4.75ZM5 5V4H10V5H5ZM2 2.75C2 1.7835 2.7835 1 3.75 1H11.25C12.2165 1 13 1.7835 13 2.75V13.25C13 14.2165 12.2165 15 11.25 15H3.75C2.7835 15 2 14.2165 2 13.25V2.75ZM3.75 2C3.33579 2 3 2.33579 3 2.75V13.25C3 13.6642 3.33579 14 3.75 14H11.25C11.6642 14 12 13.6642 12 13.25V2.75C12 2.33579 11.6642 2 11.25 2H3.75ZM14.625 4H14V6H14.625C14.8321 6 15 5.83211 15 5.625V4.375C15 4.16789 14.8321 4 14.625 4ZM14 7H14.625C14.8321 7 15 7.16789 15 7.375V8.625C15 8.83211 14.8321 9 14.625 9H14V7ZM14.625 10H14V12H14.625C14.8321 12 15 11.8321 15 11.625V10.375C15 10.1679 14.8321 10 14.625 10Z"/>',
  },
];

/** What the webview posts back: a button press, a click on a trail row, or the
 *  one-shot `ready` that says it can receive state. */
export type ViewMessage =
  { kind: 'ready' } | { kind: 'run'; command: string } | { kind: 'goto'; index: number };

/**
 * Read a raw webview message as one of the three things this view is allowed to
 * say. Answers undefined for anything else.
 *
 * This is the trust boundary, and it is deliberately a whitelist: a webview can
 * post any object at all, so dispatching a `command` string straight into
 * `executeCommand` would hand the page the entire workbench command registry, and
 * taking `index` on faith would index somewhere nobody drew.
 *
 * `rows` is the set of indices the trail actually drew, NOT a count. A row's index
 * is its position in the visited list, and the trail leaves out the dictionary and
 * class landings in that list — so the indices it draws have gaps, and a bound of
 * "less than the number of rows" would reject the very rows furthest down.
 */
export function parseViewMessage(
  message: unknown,
  rows: ReadonlySet<number>,
): ViewMessage | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const { kind, command, index } = message as {
    kind?: unknown;
    command?: unknown;
    index?: unknown;
  };
  if (kind === 'ready') return { kind: 'ready' };
  if (kind === 'run') {
    return typeof command === 'string' && BUTTONS.some((b) => b.command === command)
      ? { kind: 'run', command }
      : undefined;
  }
  if (kind === 'goto') {
    return typeof index === 'number' && Number.isInteger(index) && rows.has(index)
      ? { kind: 'goto', index }
      : undefined;
  }
  return undefined;
}

/** One row of the trail, as the pane draws it. */
export interface TrailRow {
  /** Position in the history chain — what a click jumps to. */
  index: number;
  /** `Array class>>new`, or just `new` under the selectors-only label mode. */
  label: string;
  /** The context the label leaves out — the dictionary, or the class when the
   *  label has been shortened to a bare selector. Shown dimmed after the label. */
  context: string;
  /** The landing currently being shown. */
  current: boolean;
}

/** Everything the pane draws, pushed as one message so the row and the trail can
 *  never disagree about where the cursor is. */
export interface NavigationViewState {
  back: boolean;
  forward: boolean;
  /** Whether there is any history to clear. */
  clear: boolean;
  /** Which of the two label-mode buttons the row shows, and how the labels read. */
  mode: TrailLabelMode;
  /**
   * Where the Explorer is standing right now, spelled out in full — `Globals ·
   * Collections · Array class>>new`. Pinned above the trail and replaced on every
   * landing, which is the only place a dictionary, class category or class click
   * shows: those are navigation you passed through, not places worth a row each,
   * and flipping between two dictionaries would otherwise fill the trail with
   * them. Undefined before the Explorer has landed anywhere.
   */
  location?: string;
  /** The method landings only, newest last; the pane draws them newest first. */
  trail: TrailRow[];
}

/** Every command this pane's button row can offer, in the order it draws them —
 *  including both halves of the label-mode toggle, only one of which is on screen
 *  at a time. Exported so a test can check the row against the manifest rather
 *  than a hand-copied list. */
export function toolbarCommands(): string[] {
  return BUTTONS.map((b) => b.command);
}

function renderButton(button: ToolbarButton): string {
  // Both halves of the label-mode toggle are in the markup; the script shows the
  // one matching the current mode. The marker goes on that button's separator too,
  // so the row keeps exactly one divider there either way. Only a moded element
  // carries the attribute — the hiding rule keys on its mere presence, so an
  // unmoded separator must not carry an empty one.
  const mode = button.mode ? ` data-mode="${button.mode}"` : '';
  const separator = button.startsGroup ? `<span class="sep"${mode}></span>` : '';
  const disabled = button.gated ? ' disabled' : '';
  return (
    `${separator}<button type="button" data-cmd="${button.command}"${mode} title="${button.label}" ` +
    `aria-label="${button.label}"${disabled}>` +
    `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${button.glyph}</svg>` +
    `</button>`
  );
}

export function renderNavigationViewHtml(nonce = crypto.randomBytes(16).toString('hex')): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>GemStone Explorer Navigation</title>
  <style>
    html, body { height: 100%; }
    body {
      margin: 0; padding: 0;
      display: flex; flex-direction: column;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: transparent;
    }
    /* The button row is fixed at the top; only the trail under it scrolls, so the
       controls stay put however long the trail gets. */
    .toolbar {
      flex: 0 0 auto;
      display: flex; align-items: center; gap: 2px; flex-wrap: wrap;
      padding: 1px 4px 2px;
    }
    .toolbar button {
      display: flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; padding: 0;
      color: var(--vscode-icon-foreground, var(--vscode-foreground));
      background: transparent; border: none; border-radius: 4px; cursor: pointer;
    }
    .toolbar button svg { width: 16px; height: 16px; display: block; pointer-events: none; }
    .toolbar button:hover:not(:disabled) {
      background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
    }
    .toolbar button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    /* At the ends of the chain Back/Forward dim rather than disappear, so the row
       never changes width under the pointer. */
    .toolbar button:disabled { opacity: 0.4; cursor: default; }
    .sep {
      width: 1px; height: 16px; margin: 0 3px;
      background: var(--vscode-panel-border, var(--vscode-editorWidget-border, transparent));
    }
    /* Only the half of the label-mode toggle matching the current mode is shown.
       Scoped to direct children: the row itself carries a data-mode (the script
       writes the current mode there), and an unscoped rule would hide the row. */
    .toolbar > [data-mode] { display: none; }
    .toolbar[data-mode='full'] > button[data-mode='full'],
    .toolbar[data-mode='selectors'] > button[data-mode='selectors'] { display: flex; }
    .toolbar[data-mode='full'] > span.sep[data-mode='full'],
    .toolbar[data-mode='selectors'] > span.sep[data-mode='selectors'] { display: block; }
    /* Where you are now, pinned above the trail. Not a button: it is a statement
       of position, and a row you can click that takes you nowhere reads as broken. */
    .location {
      flex: 0 0 auto;
      display: none;
      padding: 1px 6px 2px 8px; line-height: 18px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      border-bottom: 1px solid var(--vscode-panel-border, transparent);
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
    }
    .location.shown { display: block; }
    .location .where { color: var(--vscode-foreground); }
    .trail { flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; }
    .row {
      display: flex; align-items: baseline; gap: 6px; width: 100%;
      padding: 1px 6px 1px 8px; border: none; border-left: 2px solid transparent;
      background: transparent; color: inherit; cursor: pointer;
      font: inherit; text-align: left; line-height: 20px;
    }
    .row:hover { background: var(--vscode-list-hoverBackground); }
    .row:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .row .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row .dict { flex: 0 0 auto; font-size: 0.9em; color: var(--vscode-descriptionForeground); }
    /* Where you are now: an accent bar and the dictionary slot saying so, rather
       than a selection highlight, which would read as "clicking here does nothing". */
    .row.current { border-left-color: var(--vscode-focusBorder); font-weight: 600; }
    .empty {
      padding: 3px 8px; line-height: 20px;
      color: var(--vscode-descriptionForeground); font-style: italic;
    }
  </style>
</head>
<body>
  <div class="toolbar" role="toolbar" aria-label="GemStone Explorer actions">
    ${BUTTONS.map(renderButton).join('\n    ')}
  </div>
  <div class="location" id="location" aria-live="polite"></div>
  <div class="trail" id="trail" role="list" aria-label="Methods visited"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.querySelector('.toolbar').addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button || button.disabled) return;
      vscode.postMessage({ kind: 'run', command: button.dataset.cmd });
    });

    document.getElementById('trail').addEventListener('click', (e) => {
      const row = e.target.closest('.row');
      if (!row) return;
      vscode.postMessage({ kind: 'goto', index: Number(row.dataset.index) });
    });

    function setEnabled(cmd, on) {
      const button = document.querySelector('[data-cmd="' + cmd + '"]');
      if (button) button.disabled = !on;
    }

    // Rows are built with textContent, never innerHTML: the labels are class and
    // selector names read out of the stone, and a stone is not a place to trust
    // markup from.
    // The pinned "you are here" line. Built with textContent for the same reason
    // the rows are: these names come out of a stone.
    function drawLocation(location) {
      const host = document.getElementById('location');
      host.textContent = '';
      host.className = location ? 'location shown' : 'location';
      if (!location) return;
      const lead = document.createElement('span');
      lead.textContent = 'In ';
      const where = document.createElement('span');
      where.className = 'where';
      where.textContent = location;
      host.title = location;
      host.append(lead, where);
    }

    function drawTrail(trail) {
      const host = document.getElementById('trail');
      host.textContent = '';
      if (trail.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'Methods you open are listed here.';
        host.append(empty);
        return;
      }
      for (const entry of trail.slice().reverse()) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = entry.current ? 'row current' : 'row';
        row.dataset.index = String(entry.index);
        row.setAttribute('role', 'listitem');
        row.title = entry.current
          ? entry.label + ' — where you are now'
          : 'Go to ' + entry.label + ' in ' + entry.context;
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = entry.label;
        const dict = document.createElement('span');
        dict.className = 'dict';
        dict.textContent = entry.current ? 'current' : entry.context;
        row.append(label, dict);
        host.append(row);
      }
    }

    window.addEventListener('message', (e) => {
      const state = e.data;
      if (!state || state.kind !== 'state') return;
      setEnabled('gemstone.navigateBack', state.back);
      setEnabled('gemstone.navigateForward', state.forward);
      setEnabled('gemstone.explorer.clearHistory', state.clear);
      document.querySelector('.toolbar').dataset.mode = state.mode;
      drawLocation(state.location);
      drawTrail(state.trail);
    });

    // Suppress the native Cut/Copy/Paste menu: this pane is a row of buttons over
    // a list of places, so an editing menu on right-click offers nothing that
    // applies. Matches how the debugger webview handles its own right-clicks.
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    vscode.postMessage({ kind: 'ready' });
  </script>
</body>
</html>`;
}

/**
 * Hosts the Actions & Navigation pane. A collapsed or hidden pane is disposed by the
 * workbench and re-resolved when it comes back, so the state is re-pushed on every
 * resolve — a rebuilt webview knows nothing about the chain it is drawing.
 */
export class NavigationViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private state: NavigationViewState = {
    back: false,
    forward: false,
    clear: false,
    mode: 'full',
    trail: [],
  };

  /** Go to the place a trail row names — its index in the visited list. Wired up
   *  at registration. */
  constructor(private readonly goToIndex: (index: number) => void) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = renderNavigationViewHtml();
    view.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseViewMessage(raw, new Set(this.state.trail.map((row) => row.index)));
      if (!message) return;
      if (message.kind === 'ready') this.push();
      else if (message.kind === 'run') void vscode.commands.executeCommand(message.command);
      else this.goToIndex(message.index);
    });
    this.push();
  }

  /** Redraw for a moved chain or cursor. */
  setState(state: NavigationViewState): void {
    this.state = state;
    this.push();
  }

  private push(): void {
    void this.view?.webview.postMessage({ kind: 'state', ...this.state });
  }
}
