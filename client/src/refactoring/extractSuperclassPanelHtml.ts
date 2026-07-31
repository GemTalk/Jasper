/**
 * Pure HTML rendering for the extract-superclass (V6 / V7) preview panel. Every row is a CORE
 * change (the refactoring is all-or-nothing), rendered with a checked, DISABLED checkbox. A
 * `classAdd` shows the new superclass's generated definition as an all-added block; a
 * `classDefinitionEdit` and a `methodAdd`/`methodRemove` show a before/after diff; a
 * `classReparent` (a descendant recompiled only to re-point at its freshly versioned ancestor)
 * is a compact note. A precondition failure sits in a banner; a note explains that existing
 * instances are not migrated. Paginated exactly like the other refactoring panels, reusing
 * renameMethodPanelView.js for the DOM behaviour.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly.
 */
import {
  ExtractSuperChange,
  ExtractSuperOutOfScope,
  extractSuperChangeLabel,
} from './extractSuperclassPreview';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderLines(source: string, type: 'add' | 'del'): string {
  const p = type === 'add' ? '+' : '-';
  return source
    .split('\n')
    .map((t) => `<div class="line ${type}">${escapeHtml(p + t)}</div>`)
    .join('');
}

function renderCard(change: ExtractSuperChange): string {
  const label = escapeHtml(extractSuperChangeLabel(change));
  const cb = `<input type="checkbox" class="sel" checked disabled title="This change is required" aria-label="${label} (required)">`;
  let body: string;
  if (change.kind === 'classReparent') {
    body = `<pre class="diff hidden"><div class="line ctx">recompiled to re-point at the new class version</div></pre>`;
  } else {
    // classAdd + methodAdd carry only newSource; methodRemove only oldSource — render just the
    // side that's present so single-sided rows don't show a phantom empty line.
    const del = change.oldSource ? renderLines(change.oldSource, 'del') : '';
    const add = change.newSource ? renderLines(change.newSource, 'add') : '';
    body = `<pre class="diff hidden">${del}${add}</pre>`;
  }
  return `<li class="change" data-id="${escapeHtml(change.id)}">
  <div class="change-head">
    ${cb}
    <span class="label">${label}</span>
    <button class="toggle" title="Show/hide diff" aria-expanded="false">▸</button>
  </div>
  ${body}
</li>`;
}

/** Render a batch of cards. All changes are core, so no core/optional split. Pure. */
export function renderExtractSuperCards(changes: ExtractSuperChange[]): string {
  return changes.map((c) => renderCard(c)).join('\n');
}

function renderBanner(oos: ExtractSuperOutOfScope): string {
  if (!oos.decline) return '';
  return `<div class="oos">⛔ ${escapeHtml(oos.decline)}</div>`;
}

function renderNote(oos: ExtractSuperOutOfScope): string {
  if (!oos.note) return '';
  return `<div class="note">ℹ️ ${escapeHtml(oos.note)}</div>`;
}

export interface ExtractSuperPanelHtmlOptions {
  heading: string;
  total: number;
  changes: ExtractSuperChange[];
  done: boolean;
  outOfScope: ExtractSuperOutOfScope;
  nonce: string;
  script: string;
}

/** Build the panel's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderExtractSuperPanelHtml(opts: ExtractSuperPanelHtmlOptions): string {
  const { heading, total, changes, done, outOfScope, nonce, script } = opts;
  const cards = renderExtractSuperCards(changes);
  const pagerHidden = done ? ' hidden' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Extract Superclass</title>
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
    .note {
      margin: 8px 16px 0; padding: 8px 12px;
      border: 1px solid var(--vscode-inputValidation-infoBorder, rgba(0,120,200,0.6));
      background: var(--vscode-inputValidation-infoBackground, rgba(0,120,200,0.10));
      border-radius: 4px;
    }
    .note-inline { opacity: 0.7; font-style: italic; }
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
    .line.ctx { opacity: 0.7; }
    .pager { display: flex; align-items: center; gap: 10px; padding: 4px 16px 24px; }
    .pager.hidden { display: none; }
    #pagerStatus { opacity: 0.75; }
  </style>
</head>
<body data-total="${total}">
  <header>
    <div class="title">${escapeHtml(heading)}</div>
    <div class="actions">
      <button id="apply">Apply <span id="count">${total}</span></button>
      <button id="cancel" class="secondary">Cancel</button>
    </div>
  </header>
  ${renderBanner(outOfScope)}
  ${renderNote(outOfScope)}
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
