/**
 * Pure HTML rendering for the change-method-signature (M5) editor. It generalizes
 * the R2 rename-method editor: one row per parameter, each pairing the editable
 * keyword part WITH the argument it binds and reorderable as a unit (▲/▼) — plus,
 * for M5, an "Add parameter" button (append a row with a new keyword part, a new
 * argument name, and a default-value spliced at senders) and a per-row Remove
 * control. Renaming a part, reordering arguments, adding a parameter, and removing an
 * (unused) parameter are therefore all direct row edits.
 *
 * A reused parameter keeps its own argument name (M5 does not rename reused args —
 * that is R5), so its argument is shown read-only; a newly-added parameter carries an
 * editable argument name and a default-value input.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly; the webview
 * plumbing lives in changeSignatureEditor.ts and the DOM behaviour (reorder, add,
 * remove, live selector preview, OK/Cancel) in the sibling
 * changeSignatureEditorView.js, read at runtime and injected under a nonce.
 */
import { selectorParts, isKeywordSelector } from './changeSignaturePreview';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface SignatureEditorHtmlOptions {
  className: string;
  oldSelector: string;
  isMeta: boolean;
  /** Current argument names of the defining implementor (from the pre-flight
   *  analysis), one per keyword/binary part in declaration order. */
  argNames: string[];
  /** When set, offer a "This dictionary (name)" scope option. */
  dictName?: string;
  nonce: string;
  script: string;
}

const reorderControls = `<span class="reorder">
      <button class="up" title="Move up" tabindex="-1">&#9650;</button>
      <button class="down" title="Move down" tabindex="-1">&#9660;</button>
    </span>`;

const removeControl =
  '<button class="remove" title="Remove this parameter (must be unused in the body)" tabindex="-1">&#10005; Remove</button>';

/** A reused-parameter row: an editable keyword part and a read-only argument (M5
 *  keeps reused argument names). `hasArg` is false for a unary selector's sole part. */
function renderReusedRow(
  part: string,
  argName: string | undefined,
  originalArgIndex: number,
): string {
  const hasArg = argName !== undefined;
  const orig = hasArg ? ` data-orig="${originalArgIndex}"` : '';
  const arg = hasArg
    ? `<span class="arg" data-argname="${escapeHtml(argName)}" title="argument bound by this keyword">${escapeHtml(argName)}</span>`
    : '<span class="arg none">(no argument)</span>';
  return `<li class="kwrow"${orig}>
    ${reorderControls}
    <input class="part" value="${escapeHtml(part)}" spellcheck="false" aria-label="Selector part">
    <span class="arrow">&rarr;</span>
    ${arg}
    ${removeControl}
  </li>`;
}

/** The template row cloned by the webview when "Add parameter" is clicked: an
 *  editable keyword part, an editable new argument name, and a default-value input
 *  (the source spliced at every send site). `data-orig="0"` marks it a new parameter. */
function addRowTemplate(): string {
  return `<template id="addRowTemplate"><li class="kwrow" data-orig="0">
    ${reorderControls}
    <input class="part" value="arg:" spellcheck="false" aria-label="Selector part">
    <span class="arrow">&rarr;</span>
    <input class="argname" value="aValue" spellcheck="false" aria-label="New argument name">
    <span class="default-label">default:</span>
    <input class="defval" value="nil" spellcheck="false" aria-label="Default value at senders">
    ${removeControl}
  </li></template>`;
}

/** Build the editor's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderSignatureEditorHtml(opts: SignatureEditorHtmlOptions): string {
  const { className, oldSelector, isMeta, argNames, dictName, nonce, script } = opts;
  const parts = selectorParts(oldSelector);
  const keyword = isKeywordSelector(oldSelector);
  const rows = parts
    .map((p, i) => renderReusedRow(p, i < argNames.length ? argNames[i] : undefined, i + 1))
    .join('\n');
  const side = isMeta ? ' class' : '';
  const dictOption = dictName
    ? `<option value="dictionary">This dictionary (${escapeHtml(dictName)})</option>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Change Method Signature</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0; padding: 0;
    }
    header {
      position: sticky; top: 0;
      background: var(--vscode-editor-background);
      border-bottom: 1px solid var(--vscode-panel-border, transparent);
      padding: 12px 16px;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
    }
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
    .body { padding: 12px 16px 24px; }
    .hint { opacity: 0.8; margin: 0 0 12px; }
    ul.rows { list-style: none; margin: 0 0 10px; padding: 0; }
    li.kwrow {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 8px; margin: 4px 0;
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
      border-radius: 4px;
      background: var(--vscode-sideBar-background, transparent);
    }
    li.kwrow input.part, li.kwrow input.argname, li.kwrow input.defval {
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px; padding: 3px 6px; min-width: 70px;
    }
    li.kwrow input.part { min-width: 90px; }
    li.kwrow .arrow { opacity: 0.6; }
    li.kwrow .arg {
      font-family: var(--vscode-editor-font-family, monospace);
      opacity: 0.9;
    }
    li.kwrow .arg.none { opacity: 0.5; font-style: italic; }
    li.kwrow .default-label { opacity: 0.6; font-size: 0.9em; }
    li.kwrow .reorder { display: inline-flex; gap: 2px; flex: none; }
    li.kwrow button.up, li.kwrow button.down {
      background: none; color: var(--vscode-foreground);
      padding: 0 6px; opacity: 0.7; font-size: 0.9em;
    }
    li.kwrow button.up:hover, li.kwrow button.down:hover { background: none; opacity: 1; }
    li.kwrow button.remove {
      margin-left: auto; flex: none;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      padding: 3px 10px; font-size: 0.9em; opacity: 0.95;
    }
    li.kwrow button.remove:hover {
      background: var(--vscode-inputValidation-errorBackground, var(--vscode-button-hoverBackground));
      opacity: 1;
    }
    .add-row {
      margin: 0 0 14px;
      background: none; color: var(--vscode-textLink-foreground);
      padding: 2px 0; opacity: 0.95;
    }
    .add-row:hover { background: none; text-decoration: underline; }
    .preview {
      margin: 6px 0 16px; padding: 8px 10px;
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
      border-radius: 4px;
      background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.08));
    }
    .preview code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 1.05em;
    }
    .scope { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border, transparent);
      border-radius: 2px; padding: 3px 6px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    .error { color: var(--vscode-errorForeground); min-height: 1.2em; margin-top: 8px; }
  </style>
</head>
<body>
  <header>
    <div class="title">Change signature <code>${escapeHtml(className)}${side}&gt;&gt;${escapeHtml(oldSelector)}</code></div>
    <div class="actions">
      <button id="ok">Preview&hellip;</button>
      <button id="cancel" class="secondary">Cancel</button>
    </div>
  </header>
  <div class="body">
    <p class="hint">${
      keyword
        ? 'Edit each keyword part in place; use ▲▼ to reorder (the argument moves with its keyword) and Remove to drop a parameter (it must be unused in the body). Add a parameter with the button below; each added parameter takes a default value spliced at every call site.'
        : 'Edit the selector name, or add a parameter (its default value is spliced at every call site).'
    }</p>
    <ul class="rows">
${rows}
    </ul>
    <button class="add-row" id="addParam">+ Add parameter</button>
    <div class="preview">Selector: <code id="sel"></code></div>
    <div class="scope">
      <label for="scope">Scope:</label>
      <select id="scope">
        <option value="hierarchy" selected>Class &amp; hierarchy</option>
        <option value="class">This class only</option>
        ${dictOption}
        <option value="wholeSystem">Whole system</option>
      </select>
    </div>
    <div class="error" id="error"></div>
  </div>
  ${addRowTemplate()}
  <script nonce="${nonce}" data-old-selector="${escapeHtml(oldSelector)}" data-dict-name="${escapeHtml(dictName ?? '')}">${script}</script>
</body>
</html>`;
}
