/**
 * Pure HTML rendering for the add / remove instance-variable (V1) preview
 * panel. Every row is a CORE change — a `classDefinitionEdit` on an edited class or a
 * `classReparent` on an affected descendant — rendered with a checked, DISABLED
 * checkbox: the change is all-or-nothing, so the preview is confirm-or-cancel.
 *
 * Beyond the diff list it renders two things the rest of the family does not:
 *   - a prominent WILL-NOT-RECOMPILE warning listing every method that will be dropped —
 *     on a remove, the methods that reference the variable; on an add, the methods whose
 *     own temporary or argument the new variable would shadow;
 *   - MIGRATE INSTANCES / DELETE HISTORY checkboxes, each flagged as committing.
 *
 * The acted-on class's compile options are preserved across the new version server-side
 * (apply sends nil to keep the class's current options); they are intentionally not
 * surfaced for editing here.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly. Uses
 * instVarRefactorPanelView.js for the DOM behaviour.
 */
import { InstVarChange, InstVarOutOfScope, instVarChangeLabel } from './instVarRefactorPreview';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Minimal line diff: old lines as removed, new lines as added. The engine sends whole
// class definitions, which are small, so a full old/new render (not an LCS) is fine.
function renderDiff(change: InstVarChange): string {
  const del = change.oldSource
    .split('\n')
    .map((t) => `<div class="line del">${escapeHtml('-' + t)}</div>`)
    .join('');
  const add = change.newSource
    .split('\n')
    .map((t) => `<div class="line add">${escapeHtml('+' + t)}</div>`)
    .join('');
  // A reparent has identical old/new text (it recompiles only to re-point at the new
  // parent version); show it as context rather than a phantom delete+add.
  if (change.oldSource === change.newSource) {
    return change.newSource
      .split('\n')
      .map((t) => `<div class="line">${escapeHtml(' ' + t)}</div>`)
      .join('');
  }
  return del + add;
}

function renderCard(change: InstVarChange): string {
  const label = escapeHtml(instVarChangeLabel(change));
  const kindBadge =
    change.kind === 'classDefinitionEdit'
      ? '<span class="badge">edit</span>'
      : '<span class="badge">reparent</span>';
  const cb = `<input type="checkbox" class="sel" checked disabled title="This change is required" aria-label="${label} (required)">`;
  return `<li class="change" data-id="${escapeHtml(change.id)}">
  <div class="change-head">
    ${cb}
    <span class="label">${label}</span>
    ${kindBadge}
    <button class="toggle" title="Show/hide diff" aria-expanded="false">▸</button>
  </div>
  <pre class="diff hidden">${renderDiff(change)}</pre>
</li>`;
}

/** Render a batch of cards. Pure. */
export function renderInstVarCards(changes: InstVarChange[]): string {
  return changes.map((c) => renderCard(c)).join('\n');
}

function renderDeclineBanner(oos: InstVarOutOfScope): string {
  if (!oos.decline) return '';
  return `<div class="oos">⛔ ${escapeHtml(oos.decline)}</div>`;
}

function renderWillNotRecompile(oos: InstVarOutOfScope): string {
  const broken = oos.willNotRecompile;
  if (broken.length === 0) return '';
  const items = broken
    .map((m) => `<li><code>${escapeHtml(m.className)}&gt;&gt;${escapeHtml(m.selector)}</code></li>`)
    .join('');
  const n = broken.length;
  return `<div class="warn-box">
    <div class="warn-head">⚠ ${n} method${n === 1 ? '' : 's'} will NOT recompile onto the new class version and will be dropped:</div>
    <ul>${items}</ul>
  </div>`;
}

function renderCommitControls(oos: InstVarOutOfScope): string {
  const note = oos.note
    ? `<div class="commit-note">${escapeHtml(oos.note)}</div>`
    : `<div class="commit-note">Migrating instances and deleting history DO commit the transaction; nothing else does.</div>`;
  return `<div class="commit-box">
    ${note}
    <label class="commit-item"><input type="checkbox" id="migrate"> Migrate existing instances to the new version <span class="warn-tag">⚠ commits</span></label>
    <label class="commit-item"><input type="checkbox" id="deleteHistory"> Delete prior class versions (history) <span class="warn-tag">⚠ commits</span></label>
  </div>`;
}

export interface InstVarPanelHtmlOptions {
  /** Panel title, e.g. "Add tally to Foo" / "Remove count from Foo". */
  title: string;
  total: number;
  changes: InstVarChange[];
  done: boolean;
  outOfScope: InstVarOutOfScope;
  nonce: string;
  script: string;
}

/** Build the panel's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderInstVarPanelHtml(opts: InstVarPanelHtmlOptions): string {
  const { title, total, changes, done, outOfScope, nonce, script } = opts;
  const cards = renderInstVarCards(changes);
  const pagerHidden = done ? ' hidden' : '';
  const applyDisabled = outOfScope.decline ? ' disabled' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Instance Variable</title>
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
    .hidden { display: none; }
    #apply.commits {
      background: var(--vscode-inputValidation-warningBorder, #c88c00);
      color: #000;
    }
    .fail-box {
      margin: 12px 16px 0; padding: 14px 16px;
      border: 2px solid var(--vscode-inputValidation-errorBorder, rgba(200,0,0,0.8));
      background: var(--vscode-inputValidation-errorBackground, rgba(200,0,0,0.15));
      border-radius: 4px;
    }
    .fail-head { font-size: 1.25em; font-weight: 700; margin-bottom: 6px; }
    .fail-msg { margin-bottom: 12px; white-space: pre-wrap; }
    .fail-actions { display: flex; gap: 8px; }
    button.danger {
      background: var(--vscode-inputValidation-errorBorder, #c0392b); color: #fff;
    }
    button.danger:hover {
      background: var(--vscode-inputValidation-errorBorder, #c0392b); opacity: 0.9;
    }
    button.toggle { background: none; color: var(--vscode-foreground); padding: 0 4px; opacity: 0.7; }
    button.toggle:hover { background: none; opacity: 1; }
    .oos {
      margin: 8px 16px 0; padding: 8px 12px;
      border: 1px solid var(--vscode-inputValidation-errorBorder, rgba(200,0,0,0.6));
      background: var(--vscode-inputValidation-errorBackground, rgba(200,0,0,0.12));
      border-radius: 4px;
    }
    .warn-box {
      margin: 8px 16px 0; padding: 8px 12px;
      border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(200,140,0,0.6));
      background: var(--vscode-inputValidation-warningBackground, rgba(200,140,0,0.10));
      border-radius: 4px;
    }
    .warn-head { margin-bottom: 4px; font-weight: 600; }
    .warn-box ul { margin: 0; padding-left: 20px; }
    .warn-box code { font-family: var(--vscode-editor-font-family, monospace); }
    .commit-box {
      margin: 8px 16px 0; padding: 8px 12px;
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
      border-radius: 4px;
    }
    .commit-item { display: flex; align-items: center; gap: 6px; }
    .commit-item { margin-top: 6px; }
    .commit-note { opacity: 0.85; margin-bottom: 4px; }
    .warn-tag { color: var(--vscode-inputValidation-warningBorder, #c88c00); font-size: 0.85em; }
    .summary { padding: 8px 16px; opacity: 0.85; display: flex; align-items: center; gap: 10px; }
    button.linkish { background: none; color: var(--vscode-textLink-foreground); padding: 0; font-size: 0.95em; }
    button.linkish:hover { background: none; text-decoration: underline; }
    ul.changes { list-style: none; margin: 0; padding: 0 8px; }
    li.change {
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
      border-radius: 4px; margin: 8px; overflow: hidden;
    }
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
    .line.add { background: var(--vscode-diffEditor-insertedTextBackground, rgba(0,180,0,0.15)); }
    .line.del { background: var(--vscode-diffEditor-removedTextBackground, rgba(220,0,0,0.15)); }
    .pager { display: flex; align-items: center; gap: 10px; padding: 4px 16px 24px; }
    .pager.hidden { display: none; }
    #pagerStatus { opacity: 0.75; }
  </style>
</head>
<body data-total="${total}">
  <header>
    <div class="title">${escapeHtml(title)}</div>
    <div class="actions">
      <button id="apply"${applyDisabled}>Apply</button>
      <button id="cancel" class="secondary">Cancel</button>
    </div>
  </header>
  <div id="failBanner" class="fail-box hidden" role="alert" aria-live="assertive">
    <div class="fail-head">✖ Apply failed</div>
    <div id="failMsg" class="fail-msg"></div>
    <div class="fail-actions">
      <button id="abort" class="danger hidden">Abort Transaction</button>
      <button id="failClose" class="secondary">Close</button>
    </div>
  </div>
  ${renderDeclineBanner(outOfScope)}
  ${renderWillNotRecompile(outOfScope)}
  ${renderCommitControls(outOfScope)}
  <div class="summary">
    ${total} change${total === 1 ? '' : 's'}
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
