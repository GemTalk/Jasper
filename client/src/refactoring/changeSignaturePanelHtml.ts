/**
 * Pure HTML rendering for the change-method-signature (M5) preview panel. The
 * preview is PAGINATED: the panel shows the first page of changes and a "More" /
 * "Load all" control that fetches further pages (each bounded so it fits the GCI
 * buffer) and appends them. Each implementor rename shows its removed→added selector
 * in the header (struck-through red = removed, green = added) so add/remove/reorder is
 * visible without expanding; senders (modified in place) render a plain label. An
 * out-of-scope / skipped-methods banner sits at the top, and — belt-and-suspenders,
 * since the command already refuses up front — a hard collision/decline banner.
 *
 * Reuses the R2 panel's DOM behaviour (renameMethodPanelView.js — the exported global
 * `RenameMethodPanel`); only the card/banner HTML is M5-specific. Kept free of any
 * `vscode` dependency so it unit-tests directly; card HTML is shared with the append
 * path via renderSignatureCards so newly-fetched pages render identically.
 */
import {
  MethodSignatureChange,
  methodChangeLabel,
  OutOfScopeCounts,
  SkippedMethod,
} from './changeSignaturePreview';
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

function renderCard(change: MethodSignatureChange): string {
  const label = escapeHtml(methodChangeLabel(change));
  const badge = change.category ? `<span class="badge">${escapeHtml(change.category)}</span>` : '';
  const diff = renderDiff(lineDiff(change.oldSource, change.newSource));
  // A methodRename REMOVES the old-selector method and ADDS the new-selector one;
  // show both in the collapsed header. A pure argument reorder (same selector,
  // recompiled in place) and a sender render as a plain label.
  const isRename =
    change.kind === 'methodRename' &&
    !!change.newSelector &&
    change.newSelector !== change.selector;
  const side = change.isMeta ? ' class' : '';
  const labelHtml = isRename
    ? `${escapeHtml(change.className)}${side}&gt;&gt;` +
      `<span class="sel-removed" title="removed">${escapeHtml(change.selector ?? '?')}</span>` +
      '<span class="ren-arrow"> → </span>' +
      `<span class="sel-added" title="added">${escapeHtml(change.newSelector as string)}</span>`
    : label;
  return `<li class="change" data-id="${escapeHtml(change.id)}">
  <div class="change-head">
    <input type="checkbox" class="sel" checked aria-label="Include ${label}">
    <span class="label">${labelHtml}</span>
    ${badge}
    <button class="toggle" title="Show/hide diff" aria-expanded="false">▸</button>
  </div>
  <pre class="diff hidden">${diff}</pre>
</li>`;
}

/** Render a batch of change cards (used for the first page and for appended pages, so
 *  both look identical). Pure. */
export function renderSignatureCards(changes: MethodSignatureChange[]): string {
  return changes.map(renderCard).join('\n');
}

function renderBlocker(oos: OutOfScopeCounts): string {
  const messages: string[] = [];
  if (oos.collision) messages.push(escapeHtml(oos.collision));
  if (oos.decline) messages.push(escapeHtml(oos.decline));
  if (messages.length === 0) return '';
  return `<div class="blocker">⛔ ${messages.join('<br>')}</div>`;
}

function renderOutOfScope(oos: OutOfScopeCounts, skippedMethods: SkippedMethod[]): string {
  const lines: string[] = [];
  const scoped = oos.implementors + oos.senders;
  if (scoped > 0) {
    const bits: string[] = [];
    if (oos.implementors > 0)
      bits.push(`${oos.implementors} implementor${oos.implementors === 1 ? '' : 's'}`);
    if (oos.senders > 0) bits.push(`${oos.senders} sender${oos.senders === 1 ? '' : 's'}`);
    lines.push(`${bits.join(' and ')} outside the chosen scope will NOT be changed.`);
  }
  let skippedList = '';
  if (oos.skipped > 0) {
    lines.push(
      `${oos.skipped} method${oos.skipped === 1 ? '' : 's'} could not be rewritten and ` +
        `${oos.skipped === 1 ? 'was' : 'were'} skipped. ` +
        '<button class="linkish" id="showSkipped" aria-expanded="false">Show</button>',
    );
    skippedList =
      '<ul class="skipped-list hidden" id="skippedList">' +
      skippedMethods
        .map((m) => `<li>${escapeHtml(m.className)}&gt;&gt;${escapeHtml(m.selector)}</li>`)
        .join('') +
      '</ul>';
  }
  if (lines.length === 0) return '';
  return `<div class="oos">⚠ ${lines.join('<br>')}${skippedList}</div>`;
}

export interface SignaturePanelHtmlOptions {
  oldSelector: string;
  newSelector: string;
  /** Total number of changes across all pages. */
  total: number;
  /** The first page of changes. */
  changes: MethodSignatureChange[];
  /** True when the first page is also the last (no More button). */
  done: boolean;
  outOfScope: OutOfScopeCounts;
  skippedMethods: SkippedMethod[];
  nonce: string;
  script: string;
}

/** Build the panel's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderSignaturePanelHtml(opts: SignaturePanelHtmlOptions): string {
  const {
    oldSelector,
    newSelector,
    total,
    changes,
    done,
    outOfScope,
    skippedMethods,
    nonce,
    script,
  } = opts;
  const cards = renderSignatureCards(changes);
  const pagerHidden = done ? ' hidden' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Change Method Signature</title>
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
    .blocker {
      margin: 8px 16px 0; padding: 8px 12px;
      border: 1px solid var(--vscode-inputValidation-errorBorder, rgba(200,0,0,0.6));
      background: var(--vscode-inputValidation-errorBackground, rgba(200,0,0,0.12));
      border-radius: 4px;
    }
    .oos {
      margin: 8px 16px 0; padding: 8px 12px;
      border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(200,160,0,0.6));
      background: var(--vscode-inputValidation-warningBackground, rgba(200,160,0,0.12));
      border-radius: 4px;
    }
    .oos .skipped-list { margin: 8px 0 0; padding-left: 20px; max-height: 160px; overflow-y: auto; }
    .oos .skipped-list.hidden { display: none; }
    .oos .skipped-list li { font-family: var(--vscode-editor-font-family, monospace); }
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
    .change-head .sel-removed {
      text-decoration: line-through;
      color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39);
    }
    .change-head .sel-added { color: var(--vscode-gitDecoration-addedResourceForeground, #587c0c); }
    .change-head .ren-arrow { opacity: 0.6; }
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
    .pager {
      display: flex; align-items: center; gap: 10px;
      padding: 4px 16px 24px;
    }
    .pager.hidden { display: none; }
    #pagerStatus { opacity: 0.75; }
  </style>
</head>
<body data-total="${total}">
  <header>
    <div class="title">Change signature <code>${escapeHtml(oldSelector)}</code> &rarr; <code>${escapeHtml(newSelector)}</code></div>
    <div class="actions">
      <button id="apply">Apply <span id="count">${total}</span></button>
      <button id="cancel" class="secondary">Cancel</button>
    </div>
  </header>
  ${renderBlocker(outOfScope)}
  ${renderOutOfScope(outOfScope, skippedMethods)}
  <div class="summary">
    <span id="selcount">${total}</span> of ${total} change${total === 1 ? '' : 's'} selected
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
