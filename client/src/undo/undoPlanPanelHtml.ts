/**
 * The page an undo shows before it runs.
 *
 * Deliberately built to look like the refactoring undo's panel -- same header, same button row,
 * same row cards -- because the whole point of showing it is that "Undo" should not look like two
 * different features depending on which machinery recorded the change (#396 review).
 *
 * Simpler than that panel in one way, and honestly so: the rows are fixed. The local reversers
 * apply a plan whole, so a tick the user could clear would be a lie. They are rendered ticked and
 * disabled, which is the same all-or-nothing the engine already reports for most of its own
 * reversals.
 *
 * Pure (no vscode), so it unit-tests directly.
 */
import { UndoPlan } from './undoPlan';

/**
 * Why the change named may not be the last thing you did.
 *
 * True of every undo and worth knowing once, which is why it is a disclosure rather than a
 * banner: after the first few reversals it is text the reader already has, sitting above the one
 * thing they opened the panel to read. Collapsed it costs a line; open it says the same thing it
 * always did. A plan's own `note` stays prominent -- that one is specific to the reversal in
 * front of you and names something it will cost.
 */
const WHY_THIS_CHANGE =
  'Undo takes the most recent change Jasper RECORDED in this session, which is not necessarily ' +
  'the last thing you did: an action that cannot be reversed records nothing, so the change ' +
  'before it is what this reverses.';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface UndoPlanHtmlOptions {
  plan: UndoPlan;
  nonce: string;
  script: string;
}

export function renderUndoPlanHtml(opts: UndoPlanHtmlOptions): string {
  const { plan, nonce, script } = opts;
  const n = plan.rows.length;
  const rows = plan.rows
    .map(
      (r) => `    <li class="change" data-id="${escapeHtml(r.id)}">
      <div class="change-head">
        <input class="sel" type="checkbox" checked disabled aria-label="always applied">
        <span class="action">${escapeHtml(r.action)}</span>
        <span class="label">${escapeHtml(r.target)}</span>
      </div>${r.detail ? `\n      <div class="detail">${escapeHtml(r.detail)}</div>` : ''}
    </li>`,
    )
    .join('\n');
  const note = plan.note ? `  <div class="oos">${escapeHtml(plan.note)}</div>\n` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Undo</title>
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
    .oos {
      margin: 8px 16px 0; padding: 8px 12px;
      border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(200,160,0,0.6));
      background: var(--vscode-inputValidation-warningBackground, rgba(200,160,0,0.12));
      border-radius: 4px;
    }
    .summary { padding: 8px 16px; opacity: 0.85; display: flex; align-items: baseline; gap: 12px; }
    details.why { font-size: 0.95em; }
    details.why summary {
      cursor: pointer; opacity: 0.7;
      color: var(--vscode-textLink-foreground);
      list-style: none;
    }
    details.why summary::-webkit-details-marker { display: none; }
    details.why summary:hover { opacity: 1; text-decoration: underline; }
    details.why p { margin: 6px 0 0; opacity: 0.85; max-width: 70ch; }
    ul.changes { list-style: none; margin: 0; padding: 0 8px; }
    li.change {
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
      border-radius: 4px; margin: 8px; overflow: hidden;
    }
    .change-head { display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
    .change-head .sel { cursor: default; }
    .change-head .action { opacity: 0.8; }
    .change-head .label { font-family: var(--vscode-editor-font-family, monospace); flex: 1; }
    .detail { padding: 0 10px 8px 34px; opacity: 0.75; }
  </style>
</head>
<body>
  <header>
    <div class="title">${escapeHtml(plan.verb)} <code>${escapeHtml(plan.label)}</code></div>
    <div class="actions">
      <button id="apply">${escapeHtml(plan.verb)} ${n}</button>
      <button id="cancel" class="secondary">Cancel</button>
    </div>
  </header>
${note}  <div class="summary">
    <span>${n} change${n === 1 ? '' : 's'} — all applied together</span>
    <details class="why">
      <summary>Why this change?</summary>
      <p>${escapeHtml(WHY_THIS_CHANGE)}</p>
    </details>
  </div>
  <ul class="changes">
${rows}
  </ul>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
}
