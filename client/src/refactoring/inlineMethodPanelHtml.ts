/**
 * Pure HTML rendering for the inline-method (M2) preview panel. Shows the one CORE
 * change (the rewritten caller) as a required row — checkbox checked and DISABLED
 * so it cannot be deselected — followed, when the inlined call was the target's last
 * sender, by a single OFFERED removal row: checked (so it applies by default) but
 * enabled, so the user can untick it to keep the now-unused method. A hard decline
 * (which blocks Apply) sits in a banner; the command already refuses before opening,
 * so it is defensive. Paginated exactly like the rename-method panel, reusing
 * renameMethodPanelView.js for the DOM behaviour.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly.
 */
import { InlineChange, InlineOutOfScope, inlineChangeLabel } from './inlineMethodPreview';
import { lineDiff, DiffLine } from './lineDiff';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDiff(diff: DiffLine[]): string {
  const prefix = { context: ' ', add: '+', del: '-' };
  return diff
    .map((l) => `<div class="line ${l.type}">${escapeHtml(prefix[l.type] + l.text)}</div>`)
    .join('');
}

function renderAllRemoved(source: string): string {
  return source
    .split('\n')
    .map((t) => `<div class="line del">${escapeHtml('-' + t)}</div>`)
    .join('');
}

function renderCard(change: InlineChange, isCore: boolean): string {
  const label = escapeHtml(inlineChangeLabel(change));
  const badge = change.category ? `<span class="badge">${escapeHtml(change.category)}</span>` : '';
  // A methodRemove has no new source; render it as an all-removed method rather than
  // a diff against '' (which would show a phantom added empty line).
  const diff =
    change.kind === 'methodRemove'
      ? renderAllRemoved(change.oldSource)
      : renderDiff(lineDiff(change.oldSource, change.newSource));
  // The core change (the caller recompile) is required: a checked, DISABLED checkbox
  // stays checked, so the shared view JS (which derives the deselected set from
  // UNCHECKED boxes) never reports it — it always applies. The removal row is
  // OPT-IN: rendered UNCHECKED, so the target is kept by default and is removed only
  // if the user ticks it (removing the method is not the default action).
  const cb = isCore
    ? `<input type="checkbox" class="sel" checked disabled title="This change is required" aria-label="${label} (required)">`
    : `<input type="checkbox" class="sel" aria-label="${label} (tick to remove the now-unused method)">`;
  return `<li class="change" data-id="${escapeHtml(change.id)}">
  <div class="change-head">
    ${cb}
    <span class="label">${label}</span>
    ${badge}
    <button class="toggle" title="Show/hide diff" aria-expanded="false">▸</button>
  </div>
  <pre class="diff hidden">${diff}</pre>
</li>`;
}

/** Render a batch of cards. `startIndex` is the global index of the first change in
 *  this batch and `coreCount` how many leading changes are required. Pure. */
export function renderInlineCards(
  changes: InlineChange[],
  startIndex: number,
  coreCount: number,
): string {
  return changes.map((c, j) => renderCard(c, startIndex + j < coreCount)).join('\n');
}

function renderBanner(oos: InlineOutOfScope): string {
  if (!oos.decline) return '';
  return `<div class="oos">⛔ ${escapeHtml(oos.decline)}</div>`;
}

export interface InlinePanelHtmlOptions {
  targetSelector: string;
  /** Total number of changes across all pages (1, or 2 when last-sender). */
  total: number;
  /** How many leading changes are the required core changes (always 1). */
  coreCount: number;
  /** True when the inlined call was the target's last sender (a removal is offered). */
  lastSender: boolean;
  /** The first page of changes. */
  changes: InlineChange[];
  /** True when the first page is also the last (no More button). */
  done: boolean;
  outOfScope: InlineOutOfScope;
  nonce: string;
  script: string;
}

/** Build the panel's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderInlinePanelHtml(opts: InlinePanelHtmlOptions): string {
  const { targetSelector, total, coreCount, lastSender, changes, done, outOfScope, nonce, script } =
    opts;
  const cards = renderInlineCards(changes, 0, coreCount);
  const pagerHidden = done ? ' hidden' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Inline Method</title>
  <style>
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
    .change-head .sel { cursor: default; }
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
    #pagerStatus { opacity: 0.75; }
  </style>
</head>
<body data-total="${total}">
  <header>
    <div class="title">Inline <code>${escapeHtml(targetSelector)}</code></div>
    <div class="actions">
      <button id="apply">Apply <span id="count">${coreCount}</span></button>
      <button id="cancel" class="secondary">Cancel</button>
    </div>
  </header>
  ${renderBanner(outOfScope)}
  ${
    lastSender
      ? `<div class="summary">This was the last sender of <code>${escapeHtml(targetSelector)}</code> — tick the last row to also remove the now-unused method.</div>`
      : ''
  }
  <div class="summary">
    <span id="selcount">${coreCount}</span> of ${total} change${total === 1 ? '' : 's'} selected
    <button id="toggleAll" class="linkish" aria-expanded="false">Expand all</button>
  </div>
  <ul class="changes">
${cards}
  </ul>
  <div class="pager${pagerHidden}" id="pager">
    <button id="more">More</button>
    <button id="loadAll" class="secondary">Load all</button>
    <span id="pagerStatus">${changes.length} of ${total} loaded</span>
  </div>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
}
