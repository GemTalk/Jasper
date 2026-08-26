/**
 * Pure HTML rendering for the per-method history viewer. Read-only: a list of
 * every recorded version of one method in this stone, newest first, each showing
 * when it was compiled and by whom, the category it was filed under, and — the
 * comparison this feature is for — an inline unified diff against the version
 * installed right now. The current version is clearly badged. A non-current
 * version offers "Restore this version" (recompile it as a new version — a redo)
 * and "Diff ⇄ current" (open a side-by-side editor diff against the current one).
 *
 * Kept free of any `vscode` dependency so it unit-tests directly. DOM behaviour
 * (expand/collapse, restore/diff/remove dispatch, refresh) lives in
 * methodHistoryPanelView.js; the version-row HTML is shared with the refresh path
 * via renderVersionRows.
 */
import { MethodVersion, currentVersion } from './methodHistoryModel';
import { lineDiff } from '../refactoring/lineDiff';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Render the engine's locale-neutral ISO timestamp (yyyy-mm-ddTHH:MM:SS) in the
// user's own locale (this runs in the extension host, so toLocaleString uses the
// user's machine locale). Falls back to the raw string if it isn't parseable, and
// to '' when there is no stamp (the synthetic current version).
export function formatLocalTimestamp(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleString();
}

// A compact unified line-diff (old → new) as HTML, using the shared pure lineDiff.
// Empty when the two sources are identical, so an unchanged pair renders nothing.
function renderDiff(oldText: string, newText: string): string {
  if (oldText === newText) return '<div class="nochange">Identical to the current version.</div>';
  const glyph = { context: ' ', add: '+', del: '−' };
  const rows = lineDiff(oldText, newText)
    .map(
      (l) =>
        `<div class="dl ${l.type}"><span class="dg">${glyph[l.type]}</span>${escapeHtml(l.text)}</div>`,
    )
    .join('');
  return `<div class="diff">${rows}</div>`;
}

function renderVersionRow(v: MethodVersion, curSource: string | undefined): string {
  const badge = v.isCurrent ? '<span class="cur">current</span>' : '';
  const who = v.userId ? ` by ${escapeHtml(v.userId)}` : '';
  const when = formatLocalTimestamp(v.timeStamp);
  const stamp = when ? `${escapeHtml(when)}${who}` : v.isCurrent ? 'installed now' : who.trim();
  const cat = v.category
    ? `<span class="cat" title="method category">${escapeHtml(v.category)}</span>`
    : '';
  // Non-current versions can be restored (recompiled as a new version) and diffed
  // side-by-side against the current one in the editor.
  const actions =
    v.isCurrent || v.notInHistory
      ? ''
      : '<button class="restore" title="Recompile this version as the new current version (a redo)">' +
        'Restore this version</button>' +
        '<button class="diff" title="Open a side-by-side editor diff against the current version">' +
        'Diff ⇄ current</button>';
  // The detail shows, for a non-current version, the inline diff against current
  // (the comparison this viewer is for) followed by the full source; for the
  // current version, just its source.
  const diffBlock =
    !v.isCurrent && curSource !== undefined
      ? `<div class="diff-head">Changes from this version to the current version:</div>${renderDiff(
          v.source,
          curSource,
        )}`
      : '';
  return `<li class="version${v.isCurrent ? ' is-current' : ''}" data-index="${v.index}">
  <div class="version-head">
    <button class="toggle" title="Show/hide source and diff" aria-expanded="false">▸</button>
    <span class="idx">[${v.index || '—'}]</span>
    ${badge}
    <span class="when">${stamp}</span>
    ${cat}
    ${actions}
  </div>
  <div class="detail hidden">
    ${diffBlock}
    <div class="src-head">Source:</div>
    <pre class="src">${escapeHtml(v.source)}</pre>
  </div>
</li>`;
}

/** Render all version rows (used for the first render and the refresh after a
 *  restore, so both look identical). Pure. */
export function renderVersionRows(versions: MethodVersion[]): string {
  const cur = currentVersion(versions);
  const curSource = cur?.source;
  return versions.map((v) => renderVersionRow(v, curSource)).join('\n');
}

export interface MethodHistoryHtmlOptions {
  /** Display label for the method, e.g. "Foo>>bar" or "Foo class>>bar". */
  methodLabel: string;
  versions: MethodVersion[];
  nonce: string;
  script: string;
}

/** Build the viewer's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderMethodHistoryHtml(opts: MethodHistoryHtmlOptions): string {
  const { methodLabel, versions, nonce, script } = opts;
  const rows = renderVersionRows(versions);
  const count = versions.length;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Method History</title>
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
    li.version.is-current {
      border-color: var(--vscode-focusBorder, var(--vscode-panel-border, rgba(127,127,127,0.5)));
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
    button.diff {
      margin-left: 6px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .idx { opacity: 0.7; font-family: var(--vscode-editor-font-family, monospace); }
    .cur {
      font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border-radius: 8px; padding: 1px 8px; font-weight: 600;
    }
    .when { opacity: 0.85; font-size: 0.9em; }
    .cat {
      opacity: 0.65; font-size: 0.8em;
      font-family: var(--vscode-editor-font-family, monospace);
    }
    .detail { border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.2)); padding: 4px 0; }
    .detail.hidden { display: none; }
    .diff-head, .src-head { opacity: 0.7; font-size: 0.85em; padding: 6px 12px 2px; }
    pre.src {
      margin: 0; padding: 8px 12px; overflow-x: auto;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, var(--vscode-font-size));
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.08));
    }
    .diff {
      margin: 0 12px; padding: 4px 0; overflow-x: auto;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, var(--vscode-font-size));
      white-space: pre;
    }
    .dl { padding: 0 6px; }
    .dg { display: inline-block; width: 1.2em; text-align: center; opacity: 0.7; }
    .dl.add { background: var(--vscode-diffEditor-insertedTextBackground, rgba(88,124,12,0.2)); }
    .dl.del { background: var(--vscode-diffEditor-removedTextBackground, rgba(199,78,57,0.2)); }
    .dl.add .dg { color: var(--vscode-gitDecoration-addedResourceForeground, #587c0c); }
    .dl.del .dg { color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); }
    .nochange { opacity: 0.6; padding: 4px 12px; }
  </style>
</head>
<body>
  <header>
    <div class="title">History of <code>${escapeHtml(methodLabel)}</code></div>
    <div class="subtitle">${count} version${
      count === 1 ? '' : 's'
    } in this stone — newest first. Read-only; a restore recompiles a version as the new current one and is not committed.</div>
  </header>
  <ul class="versions">
${rows}
  </ul>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
}
