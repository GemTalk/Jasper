/**
 * Pure HTML rendering for the extract-method (M1) preview panel. Shows the two
 * CORE changes (the new method + the rewritten original) as required rows —
 * checkbox checked and DISABLED so they cannot be deselected — followed by any
 * "replace similar code" duplicate sites as ordinary, deselectable rows. A soft
 * collision warning (the new selector already exists in the hierarchy) sits in a
 * banner at the top; it does not block Apply. Paginated exactly like the
 * rename-method panel, reusing renameMethodPanelView.js for the DOM behaviour, so
 * the checkbox/diff/pagination/apply wiring is shared and unit-tested there.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly.
 */
import { ExtractChange, ExtractOutOfScope, extractChangeLabel } from './extractMethodPreview';
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

function renderAllAdded(source: string): string {
  return source
    .split('\n')
    .map((t) => `<div class="line add">${escapeHtml('+' + t)}</div>`)
    .join('');
}

function renderCard(change: ExtractChange, isCore: boolean): string {
  const label = escapeHtml(extractChangeLabel(change));
  const badge = change.category ? `<span class="badge">${escapeHtml(change.category)}</span>` : '';
  // A methodAdd has no prior source; render it as an all-added method rather than a
  // diff against '' (which would show a phantom deleted empty line).
  const diff =
    change.kind === 'methodAdd' || change.oldSource === ''
      ? renderAllAdded(change.newSource)
      : renderDiff(lineDiff(change.oldSource, change.newSource));
  // Core changes are required: a checked, DISABLED checkbox stays checked, so the
  // shared view JS (which derives the deselected set from UNCHECKED boxes) never
  // reports it — the two core changes always apply. A duplicate-replacement row is
  // OPT-IN: rendered UNCHECKED so it applies only if the user ticks it (off by
  // default, no up-front dialog).
  const cb = isCore
    ? `<input type="checkbox" class="sel" checked disabled title="This change is required" aria-label="${label} (required)">`
    : `<input type="checkbox" class="sel" aria-label="Also replace ${label}">`;
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
 *  this batch and `coreCount` how many leading changes are required, so the two
 *  core rows render disabled even if pagination splits them across pages. Pure. */
export function renderExtractCards(
  changes: ExtractChange[],
  startIndex: number,
  coreCount: number,
): string {
  return changes.map((c, j) => renderCard(c, startIndex + j < coreCount)).join('\n');
}

function renderBanner(oos: ExtractOutOfScope): string {
  if (!oos.collision) return '';
  return `<div class="oos">⚠ ${escapeHtml(oos.collision)} You can still apply the extraction.</div>`;
}

export interface ExtractPanelHtmlOptions {
  newSelector: string;
  /** Total number of changes across all pages. */
  total: number;
  /** How many leading changes are the required core changes (always 2). */
  coreCount: number;
  /** The first page of changes. */
  changes: ExtractChange[];
  /** True when the first page is also the last (no More button). */
  done: boolean;
  outOfScope: ExtractOutOfScope;
  nonce: string;
  script: string;
}

/** Build the panel's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderExtractPanelHtml(opts: ExtractPanelHtmlOptions): string {
  const { newSelector, total, coreCount, changes, done, outOfScope, nonce, script } = opts;
  const cards = renderExtractCards(changes, 0, coreCount);
  const pagerHidden = done ? ' hidden' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Extract Method</title>
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
      border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(200,160,0,0.6));
      background: var(--vscode-inputValidation-warningBackground, rgba(200,160,0,0.12));
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
    <div class="title">Extract method <code>${escapeHtml(newSelector)}</code></div>
    <div class="actions">
      <button id="apply">Apply <span id="count">${total}</span></button>
      <button id="cancel" class="secondary">Cancel</button>
    </div>
  </header>
  ${renderBanner(outOfScope)}
  ${
    total > coreCount
      ? `<div class="summary">${total - coreCount} similar fragment${total - coreCount === 1 ? '' : 's'} found — tick any you also want replaced.</div>`
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
