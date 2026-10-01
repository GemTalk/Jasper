/**
 * Pure HTML rendering for the rename-class editor: a single new-name field plus
 * a reference-scope dropdown (default Whole system). This mirrors the
 * rename-method editor's look and flow deliberately — a consistent "edit the new
 * name, pick a scope, Preview…" gesture across the rename refactorings — even
 * though a class rename needs only one field.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly; the webview
 * plumbing lives in renameClassEditor.ts and the DOM behaviour (live validation,
 * host round-trip for a name-collision, OK/Cancel) in renameClassEditorView.js.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface ClassEditorHtmlOptions {
  oldName: string;
  /** When set, offer a "This dictionary (name)" scope option. */
  dictName?: string;
  nonce: string;
  script: string;
}

/** Build the editor's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderClassEditorHtml(opts: ClassEditorHtmlOptions): string {
  const { oldName, dictName, nonce, script } = opts;
  const dictOption = dictName
    ? `<option value="dictionary">This dictionary (${escapeHtml(dictName)})</option>`
    : '';
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
    .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
    .field label { opacity: 0.85; }
    input#name {
      font-family: var(--vscode-editor-font-family, monospace);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px; padding: 5px 8px; min-width: 260px; max-width: 420px;
    }
    .scope { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
    select {
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border, transparent);
      border-radius: 2px; padding: 3px 6px;
      font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    }
    .error { color: var(--vscode-errorForeground); min-height: 1.2em; margin-top: 10px; }
    fieldset.options {
      margin: 16px 0 0; padding: 8px 12px 12px;
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.3)); border-radius: 4px;
    }
    fieldset.options legend { padding: 0 4px; opacity: 0.85; }
    fieldset.options label { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
    fieldset.options .note { opacity: 0.6; font-size: 0.9em; }
    fieldset.options .optwarn { color: var(--vscode-editorWarning-foreground, #cca700); font-size: 0.9em; min-height: 1.1em; margin-top: 4px; }
  </style>
</head>
<body>
  <header>
    <div class="title">Rename class <code>${escapeHtml(oldName)}</code>${
      dictName ? ` in <code>${escapeHtml(dictName)}</code>` : ''
    }</div>
    <div class="actions">
      <button id="ok">Preview…</button>
      <button id="cancel" class="secondary">Cancel</button>
    </div>
  </header>
  <div class="body">
    <p class="hint">Enter the new class name. The rename updates references across the chosen scope, re-parents every subclass, brings all methods forward, and adds a new class version — without committing.</p>
    <div class="field">
      <label for="name">New name</label>
      <input id="name" value="${escapeHtml(oldName)}" spellcheck="false" autocomplete="off" aria-label="New class name">
    </div>
    <div class="scope">
      <label for="scope">Reference scope:</label>
      <select id="scope">
        <option value="wholeSystem" selected>Whole system</option>
        <option value="hierarchy">Class &amp; hierarchy</option>
        <option value="class">This class only</option>
        ${dictOption}
      </select>
    </div>
    <fieldset class="options">
      <legend>Options</legend>
      <label><input type="checkbox" id="optCopyMethods" checked> Copy methods to the new version</label>
      <label><input type="checkbox" id="optRecompileSubclasses" checked> Recompile (re-parent) subclasses</label>
      <label><input type="checkbox" id="optMigrateInstances" checked> Migrate all instances <span class="note">(commits the rename)</span></label>
      <label><input type="checkbox" id="optRemoveOldFromHistory"> Remove old versions from class history <span class="note">(commits)</span></label>
      <div class="optwarn" id="optWarn"></div>
    </fieldset>
    <div class="error" id="error"></div>
  </div>
  <script nonce="${nonce}" data-old-name="${escapeHtml(oldName)}" data-dict-name="${escapeHtml(dictName ?? '')}">${script}</script>
</body>
</html>`;
}
