/**
 * Pure HTML rendering for the UNDO-a-refactoring preview panel (issue #434).
 *
 * Undo gets the same preview treatment the forward direction gets: a paginated,
 * per-change list with a before/after diff and a checkbox on every row, so the user
 * sees exactly what putting the refactoring back would do — and can un-tick any part
 * of it — before anything is compiled.
 *
 * Each row is badged with what undoing it DOES (Restore / Revert / Delete) rather
 * than with the engine's change kind, because the kinds read backwards here: a
 * `methodAdd` in an inverse change set is the undo putting back a method the
 * refactoring deleted.
 *
 * A row whose undo is not a clean reversal (the method was edited since, or is
 * already in the state the undo would leave it in) carries the engine's warning
 * inline, and the count of such rows is summarised at the top — drift is a warning
 * here, never a refusal.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly. The DOM behaviour
 * is the shared renameMethodPanelView.js (same element contract), so the checkbox
 * bookkeeping, diff toggle, pagination and apply dispatch have one implementation.
 */
import {
  UndoChange,
  UndoMechanism,
  undoChangeLabel,
  undoActionLabel,
  undoSummary,
  RENAME_BACK_CAVEAT,
} from './undoRefactoringPreview';
import { lineDiff, DiffLine, DiffLineType } from './lineDiff';

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

/** The diff lines for one change. It reads forward in time: what is in the stone NOW
 *  on the left, what undoing leaves on the right — so a Restore is all-added and a
 *  Delete all-removed, which is what those undos actually do.
 *
 *  The one-sided cases are built directly rather than diffed against an empty string:
 *  `''.split('\n')` is a single empty LINE, not no lines, so diffing would prepend a
 *  phantom `-` row to every restored method. */
function changeDiff(change: UndoChange): DiffLine[] {
  const asLines = (text: string, type: DiffLineType): DiffLine[] =>
    text.split('\n').map((line) => ({ type, text: line }));
  if (change.oldSource === null) return asLines(change.newSource ?? '', 'add');
  if (change.newSource === null) return asLines(change.oldSource, 'del');
  return lineDiff(change.oldSource, change.newSource);
}

function renderCard(change: UndoChange, mechanism: UndoMechanism): string {
  const label = escapeHtml(undoChangeLabel(change));
  const action = undoActionLabel(change, mechanism);
  const category = change.category
    ? `<span class="badge">${escapeHtml(change.category)}</span>`
    : '';
  const diff = renderDiff(changeDiff(change));
  const warning = change.warning ? `<div class="warn">⚠ ${escapeHtml(change.warning)}</div>` : '';
  // The badge is a word, not a colour-only cue, and its class is derived from that word — so a
  // new action label styles itself neutrally instead of silently inheriting another's colour.
  const actionClass = action.toLowerCase().replace(/[^a-z]+/g, '-');
  return `<li class="change${change.warning ? ' warned' : ''}" data-id="${escapeHtml(change.id)}">
  <div class="change-head">
    <input type="checkbox" class="sel" checked aria-label="Include ${label}">
    <span class="action action-${actionClass}">${action}</span>
    <span class="label">${label}</span>
    ${category}
    <button class="toggle" title="Show/hide diff" aria-expanded="false">▸</button>
  </div>
  ${warning}
  <pre class="diff hidden">${diff}</pre>
</li>`;
}

/** Render a batch of change cards (first page and appended pages alike). Pure. */
export function renderUndoCards(
  changes: UndoChange[],
  mechanism: UndoMechanism = 'changeSet',
): string {
  return changes.map((c) => renderCard(c, mechanism)).join('\n');
}

export interface UndoPanelHtmlOptions {
  /** What the refactoring being undone called itself. */
  refactoringLabel: string;
  /** How the undo will be carried out — chooses the row badges and the caveat banner. */
  mechanism: UndoMechanism;
  /** Total number of inverse changes across all pages. */
  total: number;
  /** How many of them carry a warning. */
  drifted: number;
  /** The first page of changes. */
  changes: UndoChange[];
  /** True when the first page is also the last (no More button). */
  done: boolean;
  nonce: string;
  script: string;
}

/** Build the panel's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderUndoPanelHtml(opts: UndoPanelHtmlOptions): string {
  const { refactoringLabel, mechanism, total, drifted, changes, done, nonce, script } = opts;
  const cards = renderUndoCards(changes, mechanism);
  const pagerHidden = done ? ' hidden' : '';
  const driftBanner =
    drifted > 0 ? `<div class="oos">⚠ ${escapeHtml(undoSummary(total, drifted))}</div>` : '';
  // A rename reversal is not a rollback and must not be presented as one. Informational, not a
  // warning: nothing is going wrong here, the mechanism simply differs from what "undo" implies.
  const mechanismBanner =
    mechanism === 'renameBack' ? `<div class="note">↩ ${escapeHtml(RENAME_BACK_CAVEAT)}</div>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Undo Refactoring</title>
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
    li.change.warned { border-color: var(--vscode-inputValidation-warningBorder, rgba(200,160,0,0.6)); }
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
    .action {
      font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.04em;
      border-radius: 3px; padding: 1px 6px; flex: none;
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.4));
    }
    .action-restore { color: var(--vscode-gitDecoration-addedResourceForeground, inherit); }
    .action-delete { color: var(--vscode-gitDecoration-deletedResourceForeground, inherit); }
    .note {
      margin: 8px 16px 0; padding: 8px 12px;
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.4));
      background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.08));
      border-radius: 4px;
    }
    .warn {
      padding: 6px 10px 6px 34px;
      background: var(--vscode-inputValidation-warningBackground, rgba(200,160,0,0.12));
      border-top: 1px solid var(--vscode-inputValidation-warningBorder, rgba(200,160,0,0.4));
    }
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
    <div class="title">Undo <code>${escapeHtml(refactoringLabel)}</code></div>
    <div class="actions">
      <button id="apply">Undo <span id="count">${total}</span></button>
      <button id="cancel" class="secondary">Cancel</button>
    </div>
  </header>
  ${mechanismBanner}
  ${driftBanner}
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
