/**
 * Pure HTML rendering for the rename-class (R3) preview panel. The preview is
 * PAGINATED (first page + "More" / "Load all"). Each card is one staged change:
 * a classRename (Old → New), a classReparent (a descendant re-pointed at the new
 * parent), or a methodRecompile (an outside reference rewritten). The classRename
 * and classReparent changes are STRUCTURAL — their checkbox is checked and
 * disabled, because skipping one would orphan a subclass or dangle the name; only
 * the reference recompiles can be deselected. A banner reports references outside
 * the chosen scope, the descendant reparents, a name collision, and any skipped
 * method.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly. The DOM
 * behaviour (checkboxes, diff toggle, pagination, apply) is the SHARED
 * renameMethodPanelView.js — a disabled structural checkbox can never be unchecked,
 * so it is never reported as deselected, and the engine applies it regardless.
 */
import {
  ClassRenameChange,
  classChangeLabel,
  isStructuralChange,
  ClassOutOfScope,
  SkippedMethod,
} from './renameClassPreview';
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

function kindBadge(change: ClassRenameChange): string {
  if (change.kind === 'classReparent') return '<span class="badge">reparent</span>';
  if (change.kind === 'classRename') return '<span class="badge">class</span>';
  return change.category ? `<span class="badge">${escapeHtml(change.category)}</span>` : '';
}

function headerLabel(change: ClassRenameChange): string {
  const side = change.isMeta ? ' class' : '';
  if (change.kind === 'classRename' && change.newName) {
    return (
      `<span class="sel-removed" title="old name">${escapeHtml(change.className)}</span>` +
      '<span class="ren-arrow"> → </span>' +
      `<span class="sel-added" title="new name">${escapeHtml(change.newName)}</span>`
    );
  }
  return (
    `${escapeHtml(change.className)}${escapeHtml(side)}` +
    (change.kind === 'methodRecompile' && change.selector
      ? `&gt;&gt;${escapeHtml(change.selector)}`
      : '')
  );
}

function renderCard(change: ClassRenameChange): string {
  const label = escapeHtml(classChangeLabel(change));
  const diff = renderDiff(lineDiff(change.oldSource, change.newSource));
  const structural = isStructuralChange(change);
  // Structural changes are required — checked + disabled so they cannot be
  // deselected (and so are never reported as deselected to the engine).
  const cb = structural
    ? `<input type="checkbox" class="sel" checked disabled title="required" aria-label="${label} (required)">`
    : `<input type="checkbox" class="sel" checked aria-label="Include ${label}">`;
  return `<li class="change" data-id="${escapeHtml(change.id)}">
  <div class="change-head">
    ${cb}
    <span class="label">${headerLabel(change)}</span>
    ${kindBadge(change)}
    <button class="toggle" title="Show/hide diff" aria-expanded="false">▸</button>
  </div>
  <pre class="diff hidden">${diff}</pre>
</li>`;
}

/** Render a batch of change cards (first page and appended pages look identical). */
export function renderClassCards(changes: ClassRenameChange[]): string {
  return changes.map(renderCard).join('\n');
}

function renderOutOfScope(
  oos: ClassOutOfScope,
  skippedMethods: SkippedMethod[],
  recompileSubclasses: boolean,
  migrateInstances: boolean,
  removeOldFromHistory: boolean,
): string {
  const lines: string[] = [];
  if (oos.collision) {
    lines.push(
      `⚠ ${escapeHtml(oos.collision)} — applying will fail unless you choose another name.`,
    );
  }
  if (oos.references > 0) {
    lines.push(
      `${oos.references} reference${oos.references === 1 ? '' : 's'} outside the chosen ` +
        'scope will NOT be updated.',
    );
  }
  if (oos.descendants > 0) {
    const n = oos.descendants;
    const plural = n === 1 ? '' : 'es';
    lines.push(
      recompileSubclasses
        ? `${n} subclass${plural} will be re-parented onto the new version.`
        : `⚠ ${n} subclass${plural} will NOT be re-parented (recompile subclasses is off) ` +
            `and will be orphaned on the old version.`,
    );
  }
  lines.push(
    migrateInstances
      ? 'Existing instances will be migrated to the new version.'
      : 'Existing instances stay on their prior version (not migrated).',
  );
  // #10: the rename is non-committing UNLESS a persistent option is chosen. Spell
  // out in the preview which selected option(s) force a commit, so "never commits"
  // is never misleading.
  const commitReasons: string[] = [];
  if (migrateInstances) commitReasons.push('“Migrate all instances”');
  if (removeOldFromHistory) commitReasons.push('“Remove old versions from class history”');
  lines.push(
    commitReasons.length > 0
      ? `⚠ This rename will <strong>commit the transaction</strong> — ${commitReasons.join(' and ')} ` +
          `${commitReasons.length === 1 ? 'requires a commit' : 'each require a commit'}. ` +
          'Without those options the rename applies without committing.'
      : 'This rename applies without committing (no instance migration or history removal chosen).',
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
  if (lines.length === 0) return '';
  return `<div class="oos">${lines.join('<br>')}${skippedList}</div>`;
}

export interface ClassPanelHtmlOptions {
  oldName: string;
  newName: string;
  total: number;
  changes: ClassRenameChange[];
  done: boolean;
  outOfScope: ClassOutOfScope;
  skippedMethods: SkippedMethod[];
  /** Whether the rename will re-parent subclasses (drives the banner wording). */
  recompileSubclasses: boolean;
  /** Whether the rename will migrate instances (drives the banner wording). */
  migrateInstances: boolean;
  /** Whether old versions will be dropped from class history (also commits). */
  removeOldFromHistory: boolean;
  nonce: string;
  script: string;
}

/** Build the panel's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderClassPanelHtml(opts: ClassPanelHtmlOptions): string {
  const {
    oldName,
    newName,
    total,
    changes,
    done,
    outOfScope,
    skippedMethods,
    recompileSubclasses,
    migrateInstances,
    removeOldFromHistory,
    nonce,
    script,
  } = opts;
  const cards = renderClassCards(changes);
  const pagerHidden = done ? ' hidden' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Rename Class</title>
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
    <div class="title">Rename class <code>${escapeHtml(oldName)}</code> &rarr; <code>${escapeHtml(newName)}</code></div>
    <div class="actions">
      <button id="apply">Apply <span id="count">${total}</span></button>
      <button id="cancel" class="secondary">Cancel</button>
    </div>
  </header>
  ${renderOutOfScope(outOfScope, skippedMethods, recompileSubclasses, migrateInstances, removeOldFromHistory)}
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
