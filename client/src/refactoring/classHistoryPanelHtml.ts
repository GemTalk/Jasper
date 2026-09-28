/**
 * Pure HTML rendering for the class-definition history viewer. Read-only: a list
 * of every version of a class's definition in this stone, newest first, each
 * showing the name it had then, its timestamp, who defined it, and its object id;
 * expandable to reveal the definition source and the methods added/removed/modified
 * relative to the previous version. A non-current version offers "Restore this
 * version" (a redo — recompiles that version's shape + methods as a new version).
 *
 * Kept free of any `vscode` dependency so it unit-tests directly. DOM behaviour
 * (expand/collapse, restore dispatch, refresh) lives in classHistoryPanelView.js;
 * the version-row HTML is shared with the refresh path via renderVersionRows.
 */
import { ClassVersion, MethodChange } from './classHistoryModel';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Render the engine's locale-neutral ISO timestamp (yyyy-mm-ddTHH:MM:SS) in the
// user's own locale (this runs in the extension host, so toLocaleString uses the
// user's machine locale — a US user sees mm/dd/yyyy). Falls back to the raw string
// if it isn't parseable.
export function formatLocalTimestamp(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleString();
}

function renderChangedMethods(changes: MethodChange[]): string {
  if (changes.length === 0) return '<div class="nochange">No method changes.</div>';
  const glyph = { added: '+', removed: '−', modified: '~' };
  return (
    '<ul class="methods">' +
    changes
      .map(
        (m) =>
          `<li class="mc ${m.change}"><span class="mc-glyph">${glyph[m.change]}</span> ` +
          `${escapeHtml(m.side)} <code>${escapeHtml(m.selector)}</code></li>`,
      )
      .join('') +
    '</ul>'
  );
}

function renderVersionRow(v: ClassVersion): string {
  const cur = v.isCurrent ? '<span class="cur">current</span>' : '';
  const who = v.userId ? ` by ${escapeHtml(v.userId)}` : '';
  const when = formatLocalTimestamp(v.timeStamp);
  const restore = v.isCurrent
    ? ''
    : '<button class="restore" title="Recompile this version as a new version (a redo)">' +
      'Restore this version</button>' +
      '<button class="remove" title="Remove this version from the class history">Remove</button>';
  return `<li class="version" data-index="${v.index}">
  <div class="version-head">
    <button class="toggle" title="Show/hide definition" aria-expanded="false">▸</button>
    <span class="idx">[${v.index}]</span>
    <span class="name">${escapeHtml(v.name)}</span>
    ${cur}
    <span class="when">${escapeHtml(when)}${who}</span>
    <span class="oop" title="object id">oop ${v.oop}</span>
    ${restore}
  </div>
  <div class="detail hidden">
    <pre class="def">${escapeHtml(v.definition)}</pre>
    ${renderChangedMethods(v.changedMethods)}
  </div>
</li>`;
}

/** Render all version rows (used for the first render and the refresh after a
 *  restore, so both look identical). Pure. */
export function renderVersionRows(versions: ClassVersion[]): string {
  return versions.map(renderVersionRow).join('\n');
}

export interface ClassHistoryHtmlOptions {
  className: string;
  versions: ClassVersion[];
  nonce: string;
  script: string;
  /**
   * The dictionary whose class this history belongs to. Shown beside the class name, because a
   * class name alone does not identify a class: the same name can be bound in several
   * dictionaries, and the versions listed here -- and anything Restore does -- belong to exactly
   * one of them.
   */
  dictName?: string;
}

/** Build the viewer's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderClassHistoryHtml(opts: ClassHistoryHtmlOptions): string {
  const { className, versions, nonce, script, dictName } = opts;
  const rows = renderVersionRows(versions);
  const count = versions.length;
  const inDict = dictName ? ` in <code>${escapeHtml(dictName)}</code>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Class History</title>
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
    }
    .title { font-size: 1.1em; }
    .title code {
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.15));
      padding: 1px 5px; border-radius: 3px;
    }
    .subtitle { opacity: 0.7; font-size: 0.9em; margin-top: 4px; }
    ul.versions { list-style: none; margin: 0; padding: 8px; }
    li.version {
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
      border-radius: 4px; margin: 8px; overflow: hidden;
    }
    .version-head {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; cursor: pointer; user-select: none;
      background: var(--vscode-sideBar-background, transparent);
    }
    .version-head:hover { background: var(--vscode-list-hoverBackground, transparent); }
    button {
      padding: 4px 10px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none; border-radius: 2px; cursor: pointer;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.toggle { background: none; color: var(--vscode-foreground); padding: 0 4px; opacity: 0.7; }
    button.toggle:hover { background: none; opacity: 1; }
    button.restore { margin-left: auto; }
    button.remove {
      margin-left: 6px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .idx { opacity: 0.7; font-family: var(--vscode-editor-font-family, monospace); }
    .name { font-family: var(--vscode-editor-font-family, monospace); font-weight: 600; }
    .cur {
      font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.04em;
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.4));
      border-radius: 8px; padding: 0 6px; opacity: 0.8;
    }
    .when { opacity: 0.75; font-size: 0.9em; }
    .oop { opacity: 0.55; font-size: 0.8em; font-family: var(--vscode-editor-font-family, monospace); }
    .detail { border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.2)); }
    .detail.hidden { display: none; }
    pre.def {
      margin: 0; padding: 8px 12px; overflow-x: auto;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, var(--vscode-font-size));
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.08));
    }
    ul.methods { list-style: none; margin: 6px 0; padding: 4px 12px 10px; }
    li.mc { font-family: var(--vscode-editor-font-family, monospace); }
    .mc-glyph { display: inline-block; width: 1.2em; text-align: center; font-weight: 700; }
    li.mc.added .mc-glyph { color: var(--vscode-gitDecoration-addedResourceForeground, #587c0c); }
    li.mc.removed .mc-glyph { color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); }
    li.mc.modified .mc-glyph { color: var(--vscode-gitDecoration-modifiedResourceForeground, #a67c00); }
    .nochange { opacity: 0.6; padding: 4px 12px 10px; }
  </style>
</head>
<body>
  <header>
    <div class="title">Definition history of <code>${escapeHtml(className)}</code>${inDict}</div>
    <div class="subtitle">${count} version${count === 1 ? '' : 's'} in this stone — newest first. Read-only; a restore is a new version and is not committed.</div>
  </header>
  <ul class="versions">
${rows}
  </ul>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
}
