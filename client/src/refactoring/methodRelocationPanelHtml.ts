/**
 * Shared HTML primitives for the method-relocation preview panels (RB catalog C2). The
 * move-method (M6) and push-up / push-down (M7 / M8) panels share their entire document
 * scaffold — the CSP + nonce, the sticky header/actions, the decline banner, the
 * "will NOT move" summary, the diff CSS, and the pager — and only differ in how a single
 * change CARD is rendered (move: always a required, disabled row; push: fresh add /
 * opt-in overwrite / required removal). This module owns the shared bits; each family
 * keeps its own `renderCard` and passes the pre-rendered cards in.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly.
 */
import {
  BaseMethodChange,
  RelocationOutOfScope,
  RelocationSkippedMethod,
} from './methodRelocationPreview';

/** HTML-escape for text interpolated into the panel. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Render a whole method body as a single-sided diff (all-added or all-removed). */
export function renderAllOfType(source: string, type: 'add' | 'del'): string {
  const p = type === 'add' ? '+' : '-';
  return source
    .split('\n')
    .map((t) => `<div class="line ${type}">${escapeHtml(p + t)}</div>`)
    .join('');
}

/** The single-sided diff for a plain add / plain remove — the case both families share.
 *  (Push renders overwrite before/after itself.) */
export function renderPlainChangeDiff(change: BaseMethodChange): string {
  return change.kind === 'methodAdd'
    ? renderAllOfType(change.newSource, 'add')
    : renderAllOfType(change.oldSource, 'del');
}

function renderBanner(oos: RelocationOutOfScope): string {
  if (!oos.decline) return '';
  return `<div class="oos">⛔ ${escapeHtml(oos.decline)}</div>`;
}

function renderSkipped(skipped: RelocationSkippedMethod[]): string {
  if (skipped.length === 0) return '';
  const items = skipped
    .map((s) => `<li><code>${escapeHtml(s.selector)}</code> — ${escapeHtml(s.reason)}</li>`)
    .join('');
  const n = skipped.length;
  return `<div class="skipped">
    <div class="skipped-head">${n} method${n === 1 ? '' : 's'} will NOT move:</div>
    <ul>${items}</ul>
  </div>`;
}

/** The panel CSS. `extraCss` lets a family append rules (push adds the warning styles). */
function panelStyle(extraCss: string): string {
  return `<style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 0; margin: 0;
    }
    header {
      position: sticky; top: 0; z-index: 1;
      background: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-panel-border, transparent);
      padding: 12px 16px;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
    }
    .title { font-size: 1.1em; }
    .title code {
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.15));
      padding: 1px 5px; border-radius: 3px;
    }
    .actions { display: flex; gap: 8px; flex: none; }
    button {
      padding: 5px 14px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; border-radius: 2px; cursor: pointer;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button:disabled { opacity: 0.5; cursor: default; }
    button.toggle { background: none; color: var(--vscode-foreground); padding: 0 4px; opacity: 0.7; }
    button.toggle:hover { background: none; opacity: 1; }
    .oos {
      margin: 8px 16px 0; padding: 8px 12px;
      border: 1px solid var(--vscode-inputValidation-errorBorder, rgba(200,0,0,0.6));
      background: var(--vscode-inputValidation-errorBackground, rgba(200,0,0,0.12));
      border-radius: 4px;
    }
    .skipped {
      margin: 8px 16px 0; padding: 8px 12px;
      border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(200,140,0,0.6));
      background: var(--vscode-inputValidation-warningBackground, rgba(200,140,0,0.10));
      border-radius: 4px;
    }
    .skipped-head { margin-bottom: 4px; }
    .skipped ul { margin: 0; padding-left: 20px; }
    .skipped code, .summary code, .title code { font-family: var(--vscode-editor-font-family, monospace); }
    .summary { padding: 8px 16px; opacity: 0.85; display: flex; align-items: center; gap: 10px; }
    button.linkish { background: none; color: var(--vscode-textLink-foreground); padding: 0; font-size: 0.95em; }
    button.linkish:hover { background: none; text-decoration: underline; }
    ul.changes { list-style: none; margin: 0; padding: 0 8px; }
    li.change {
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
      border-radius: 4px; margin: 8px; overflow: hidden;
    }
    li.change.deselected { opacity: 0.5; }
    .change-head {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px;
      background: var(--vscode-sideBar-background, transparent);
      cursor: pointer; user-select: none;
    }
    .change-head:hover { background: var(--vscode-list-hoverBackground, transparent); }
    .change-head .label { font-family: var(--vscode-editor-font-family, monospace); flex: 1; }
    .badge {
      font-size: 0.8em; opacity: 0.75;
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.4));
      border-radius: 10px; padding: 1px 8px;
    }
    pre.diff {
      margin: 0; padding: 6px 0; overflow-x: auto;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, var(--vscode-font-size));
      border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.2));
    }
    pre.diff.hidden { display: none; }
    .line { padding: 0 12px; white-space: pre; }
    .line.add {
      background: var(--vscode-diffEditor-insertedTextBackground, rgba(0,180,0,0.15));
      color: var(--vscode-gitDecoration-addedResourceForeground, inherit);
    }
    .line.del {
      background: var(--vscode-diffEditor-removedTextBackground, rgba(220,0,0,0.15));
      color: var(--vscode-gitDecoration-deletedResourceForeground, inherit);
    }
    .pager { display: flex; align-items: center; gap: 10px; padding: 4px 16px 24px; }
    .pager.hidden { display: none; }
    #pagerStatus { opacity: 0.75; }${extraCss}
  </style>`;
}

export interface RelocationPanelHtmlOptions {
  /** The document <title>, e.g. "Move Method" / "Push Method". */
  docTitle: string;
  /** The rendered header title HTML (already escaped; e.g. `Move to <code>Target</code>`). */
  headerHtml: string;
  /** Total number of changes across all pages. */
  total: number;
  /** The already-rendered cards for the first page. */
  cardsHtml: string;
  /** Count of changes in the first page (for the pager status). */
  pageCount: number;
  /** True when the first page is also the last (no More button). */
  done: boolean;
  outOfScope: RelocationOutOfScope;
  skippedMethods: RelocationSkippedMethod[];
  nonce: string;
  script: string;
  /** Extra CSS a family appends to the shared style block (e.g. push's warning rows). */
  extraCss?: string;
  /**
   * The checkbox `.change-head .sel` cursor style. Move rows are all disabled, so the
   * default (`default`) reads best; push has clickable rows (`pointer`). Kept as a knob
   * so the emitted CSS matches each family's original byte-for-byte.
   */
  selCursor?: string;
}

/** Assemble the full panel document from a family's pre-rendered header + cards. Pure. */
export function renderRelocationPanelHtml(opts: RelocationPanelHtmlOptions): string {
  const {
    docTitle,
    headerHtml,
    total,
    cardsHtml,
    pageCount,
    done,
    outOfScope,
    skippedMethods,
    nonce,
    script,
    extraCss = '',
    selCursor = 'default',
  } = opts;
  const pagerHidden = done ? ' hidden' : '';
  const selRule = `\n    .change-head .sel { cursor: ${selCursor}; }`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>${escapeHtml(docTitle)}</title>
  ${panelStyle(selRule + extraCss)}
</head>
<body data-total="${total}">
  <header>
    <div class="title">${headerHtml}</div>
    <div class="actions">
      <button id="apply">Apply <span id="count">${total}</span></button>
      <button id="cancel" class="secondary">Cancel</button>
    </div>
  </header>
  ${renderBanner(outOfScope)}
  ${renderSkipped(skippedMethods)}
  <div class="summary">
    <span id="selcount">${total}</span> of ${total} change${total === 1 ? '' : 's'} selected
    <button id="toggleAll" class="linkish" aria-expanded="false">Expand all</button>
  </div>
  <ul class="changes">
${cardsHtml}
  </ul>
  <div class="pager${pagerHidden}" id="pager">
    <button id="more">More</button>
    <button id="loadAll" class="secondary">Load all</button>
    <span id="pagerStatus">${pageCount} of ${total} loaded</span>
  </div>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
}
