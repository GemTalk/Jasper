/**
 * Pure HTML rendering for the move-method (M6) preview panel. Every row is a CORE
 * change — a `methodAdd` on the target or a `methodRemove` on the source — rendered
 * with a checked, DISABLED checkbox: the user chose which methods to move at
 * drag/command time, so the preview is confirm-or-cancel, not a per-change picker
 * (and the two changes for one selector must apply together). Selectors that could
 * NOT move are listed in a summary; a global decline (which blocks Apply) sits in a
 * banner. Paginated exactly like the inline-method panel, reusing
 * renameMethodPanelView.js for the DOM behaviour.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly.
 */
import { MoveChange, MoveOutOfScope, SkippedMethod, moveChangeLabel } from './moveMethodPreview';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderAllOfType(source: string, type: 'add' | 'del'): string {
  const p = type === 'add' ? '+' : '-';
  return source
    .split('\n')
    .map((t) => `<div class="line ${type}">${escapeHtml(p + t)}</div>`)
    .join('');
}

function renderCard(change: MoveChange): string {
  const label = escapeHtml(moveChangeLabel(change));
  const badge = change.category ? `<span class="badge">${escapeHtml(change.category)}</span>` : '';
  // methodAdd has no old source (all-added on the target); methodRemove has no new
  // source (all-removed from the source). Render each as a single-sided diff rather
  // than diffing against '' (which shows a phantom empty line).
  const diff =
    change.kind === 'methodAdd'
      ? renderAllOfType(change.newSource, 'add')
      : renderAllOfType(change.oldSource, 'del');
  // Every move change is required: a checked, DISABLED checkbox stays checked, so the
  // shared view JS (which derives the deselected set from UNCHECKED boxes) never
  // reports it — the move always applies in full.
  const cb = `<input type="checkbox" class="sel" checked disabled title="This change is required" aria-label="${label} (required)">`;
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

/** Render a batch of cards. All move changes are core, so no core/optional split. Pure. */
export function renderMoveCards(changes: MoveChange[]): string {
  return changes.map((c) => renderCard(c)).join('\n');
}

function renderBanner(oos: MoveOutOfScope): string {
  if (!oos.decline) return '';
  return `<div class="oos">⛔ ${escapeHtml(oos.decline)}</div>`;
}

function renderSkipped(skipped: SkippedMethod[]): string {
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

export interface MovePanelHtmlOptions {
  /** The target class the methods move to (for the header). */
  targetClass: string;
  /** Total number of changes across all pages (2 per movable selector). */
  total: number;
  /** The first page of changes. */
  changes: MoveChange[];
  /** True when the first page is also the last (no More button). */
  done: boolean;
  outOfScope: MoveOutOfScope;
  skippedMethods: SkippedMethod[];
  nonce: string;
  script: string;
}

/** Build the panel's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderMovePanelHtml(opts: MovePanelHtmlOptions): string {
  const { targetClass, total, changes, done, outOfScope, skippedMethods, nonce, script } = opts;
  const cards = renderMoveCards(changes);
  const pagerHidden = done ? ' hidden' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Move Method</title>
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
    <div class="title">Move to <code>${escapeHtml(targetClass)}</code></div>
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
