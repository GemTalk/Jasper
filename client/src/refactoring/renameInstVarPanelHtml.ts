/**
 * Pure HTML rendering for the rename-instance-variable preview panel. Kept free
 * of any `vscode` dependency so it unit-tests directly; the panel plumbing that
 * creates the webview and handles messages lives in renameInstVarPanel.ts, which
 * imports renderRenamePanelHtml from here.
 */
import { RenameChange, changeLabel, isStructuralChange } from './renameInstVarPreview';
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

function renderCard(change: RenameChange): string {
  const label = escapeHtml(changeLabel(change));
  const badge =
    change.kind === 'classDefinitionEdit'
      ? '<span class="badge def">class definition</span>'
      : change.category
        ? `<span class="badge">${escapeHtml(change.category)}</span>`
        : '';
  const diff = renderDiff(lineDiff(change.oldSource, change.newSource));
  // A structural change is checked and DISABLED so it can't be deselected; see
  // isStructuralChange for why. (Mirrors the class-rename panel.)
  const structural = isStructuralChange(change);
  const cb = structural
    ? `<input type="checkbox" class="sel" checked disabled title="required" aria-label="${label} (required)">`
    : `<input type="checkbox" class="sel" checked aria-label="Include ${label}">`;
  // Diffs start collapsed so the list is a scannable set of change headers;
  // click a row (or its chevron) to expand its before/after.
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

export interface RenamePanelHtmlOptions {
  oldName: string;
  newName: string;
  changes: RenameChange[];
  nonce: string;
  script: string;
}

/** Build the panel's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderRenamePanelHtml(opts: RenamePanelHtmlOptions): string {
  const { oldName, newName, changes, nonce, script } = opts;
  const cards = changes.map(renderCard).join('\n');
  const n = changes.length;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Rename Instance Variable</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 0;
      margin: 0;
    }
    header {
      position: sticky;
      top: 0;
      background: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-panel-border, transparent);
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .title { font-size: 1.1em; }
    .title code {
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.15));
      padding: 1px 5px;
      border-radius: 3px;
    }
    .actions { display: flex; gap: 8px; flex: none; }
    button {
      padding: 5px 14px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button:disabled { opacity: 0.5; cursor: default; }
    button.toggle {
      background: none;
      color: var(--vscode-foreground);
      padding: 0 4px;
      opacity: 0.7;
    }
    button.toggle:hover { background: none; opacity: 1; }
    .summary {
      padding: 8px 16px;
      opacity: 0.85;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    button.linkish {
      background: none;
      color: var(--vscode-textLink-foreground);
      padding: 0;
      font-size: 0.95em;
    }
    button.linkish:hover {
      background: none;
      text-decoration: underline;
      color: var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground));
    }
    ul.changes { list-style: none; margin: 0; padding: 0 8px 24px; }
    li.change {
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
      border-radius: 4px;
      margin: 8px;
      overflow: hidden;
    }
    li.change.deselected { opacity: 0.5; }
    .change-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      background: var(--vscode-sideBar-background, transparent);
      cursor: pointer;
      user-select: none;
    }
    .change-head:hover { background: var(--vscode-list-hoverBackground, transparent); }
    .change-head .sel { cursor: default; }
    .change-head .label {
      font-family: var(--vscode-editor-font-family, monospace);
      flex: 1;
    }
    .badge {
      font-size: 0.8em;
      opacity: 0.75;
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.4));
      border-radius: 10px;
      padding: 1px 8px;
    }
    .badge.def { border-style: dashed; }
    pre.diff {
      margin: 0;
      padding: 6px 0;
      overflow-x: auto;
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
  </style>
</head>
<body>
  <header>
    <div class="title">Rename <code>${escapeHtml(oldName)}</code> &rarr; <code>${escapeHtml(newName)}</code></div>
    <div class="actions">
      <button id="apply">Apply <span id="count">${n}</span></button>
      <button id="cancel" class="secondary">Cancel</button>
    </div>
  </header>
  <div class="summary">
    <span id="selcount">${n}</span> of ${n} change${n === 1 ? '' : 's'} selected
    <button id="toggleAll" class="linkish" aria-expanded="false">Expand all</button>
  </div>
  <ul class="changes">
${cards}
  </ul>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
}
