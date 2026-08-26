/**
 * Pure HTML rendering for the rename-class-variable (R4) preview panel. The
 * preview is PAGINATED (first page + "More" / "Load all"). Each card is one
 * staged change: the classDefinitionEdit (the classVars: clause) or a
 * methodRecompile (a reference rewritten). A class-variable rename is
 * ALL-OR-NOTHING, so — unlike rename-instVar/method/class — there are NO
 * selection checkboxes: every change applies together (the engine ignores any
 * deselection, and leaving a method un-rewritten would make it silently read a
 * removed variable). A banner reports a name collision and any skipped method.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly. The DOM
 * behaviour (diff toggle, pagination, apply) is the SHARED renameMethodPanelView.js;
 * with no `.sel` checkboxes present, that script computes an empty deselected set,
 * so Apply sends `deselected: []` — exactly the all-or-nothing contract.
 */
import { ClassVarRenameChange, ClassVarOutOfScope, SkippedMethod } from './renameClassVarPreview';
import { lineDiff, DiffLine } from '../lineDiff';

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

function kindBadge(change: ClassVarRenameChange): string {
  if (change.kind === 'classDefinitionEdit') return '<span class="badge">class definition</span>';
  return change.category ? `<span class="badge">${escapeHtml(change.category)}</span>` : '';
}

function headerLabel(change: ClassVarRenameChange): string {
  const side = change.isMeta ? ' class' : '';
  if (change.kind === 'classDefinitionEdit') {
    return `${escapeHtml(change.className)} <span class="ren-note">(class definition)</span>`;
  }
  return (
    `${escapeHtml(change.className)}${escapeHtml(side)}` +
    (change.selector ? `&gt;&gt;${escapeHtml(change.selector)}` : '')
  );
}

function renderCard(change: ClassVarRenameChange): string {
  const diff = renderDiff(lineDiff(change.oldSource, change.newSource));
  // No selection checkbox: an all-or-nothing rename has nothing to deselect.
  return `<li class="change" data-id="${escapeHtml(change.id)}">
  <div class="change-head">
    <span class="label">${headerLabel(change)}</span>
    ${kindBadge(change)}
    <button class="toggle" title="Show/hide diff" aria-expanded="false">▸</button>
  </div>
  <pre class="diff hidden">${diff}</pre>
</li>`;
}

/** Render a batch of change cards (first page and appended pages look identical). */
export function renderClassVarCards(changes: ClassVarRenameChange[]): string {
  return changes.map(renderCard).join('\n');
}

function renderBanner(oos: ClassVarOutOfScope, skippedMethods: SkippedMethod[]): string {
  const lines: string[] = [];
  if (oos.collision) {
    lines.push(
      `⚠ ${escapeHtml(oos.collision)} — applying will fail unless you choose another name.`,
    );
  }
  lines.push(
    'Changes are confined to this class and its subclasses (both instance and class side).',
  );
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
  return `<div class="oos">${lines.join('<br>')}${skippedList}</div>`;
}

export interface ClassVarPanelHtmlOptions {
  oldName: string;
  newName: string;
  total: number;
  changes: ClassVarRenameChange[];
  done: boolean;
  outOfScope: ClassVarOutOfScope;
  skippedMethods: SkippedMethod[];
  nonce: string;
  script: string;
}

/** Build the panel's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderClassVarPanelHtml(opts: ClassVarPanelHtmlOptions): string {
  const { oldName, newName, total, changes, done, outOfScope, skippedMethods, nonce, script } =
    opts;
  const cards = renderClassVarCards(changes);
  const pagerHidden = done ? ' hidden' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Rename Class Variable</title>
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
    .change-head {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px;
      background: var(--vscode-sideBar-background, transparent);
      cursor: pointer; user-select: none;
    }
    .change-head:hover { background: var(--vscode-list-hoverBackground, transparent); }
    .change-head .label { font-family: var(--vscode-editor-font-family, monospace); flex: 1; }
    .change-head .ren-note { opacity: 0.6; font-family: var(--vscode-font-family); }
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
    <div class="title">Rename class variable <code>${escapeHtml(oldName)}</code> &rarr; <code>${escapeHtml(newName)}</code></div>
    <div class="actions">
      <button id="apply">Apply <span id="count">${total}</span></button>
      <button id="cancel" class="secondary">Cancel</button>
    </div>
  </header>
  ${renderBanner(outOfScope, skippedMethods)}
  <div class="summary">
    ${total} change${total === 1 ? '' : 's'} — the whole rename applies together (all-or-nothing).
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
