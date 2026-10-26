import { readWebviewScript } from './webviewAssets';

const loginEditorViewJs = readWebviewScript('loginEditorView.js');

/**
 * The login editor's page: the form, with its script from loginEditorView.js.
 * Kept apart from the panel so the page can be tested in a browser-like
 * environment without the editor's API.
 */
export function loginEditorHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>GemStone Login</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      padding: 20px;
      max-width: 500px;
    }
    h2 {
      margin-top: 0;
      font-weight: 400;
    }
    label {
      display: block;
      margin-top: 12px;
      margin-bottom: 4px;
      font-weight: 600;
    }
    select, input[type="text"], input[type="password"] {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .version-download {
      margin-top: 6px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    .version-download[hidden] {
      display: none;
    }
    select:focus, input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }
    .field-group {
      border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, transparent));
      padding-bottom: 12px;
      margin-bottom: 4px;
    }
    .button-row {
      margin-top: 20px;
      display: flex;
      gap: 8px;
    }
    button {
      padding: 6px 14px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }
    .checkbox-row input[type="checkbox"] {
      margin: 0;
    }
    label.inline-label {
      display: inline;
      margin: 0;
      font-weight: 400;
      cursor: pointer;
    }
    .hint {
      font-size: 0.9em;
      opacity: 0.7;
      margin-top: 4px;
    }
    a.doc-link {
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      text-decoration: none;
    }
    a.doc-link:hover {
      color: var(--vscode-textLink-activeForeground);
      text-decoration: underline;
    }
    .help-row {
      margin: 4px 0 8px;
    }
    /* Per-field help, revealed by the "Help me login" toggle. The left accent bar
       visually ties each note to the field above it. */
    .field-help {
      display: none;
      font-size: 0.9em;
      opacity: 0.85;
      margin-top: 4px;
      padding-left: 8px;
      border-left: 2px solid var(--vscode-focusBorder);
    }
    body.help-on .field-help {
      display: block;
    }
    .help-intro {
      display: none;
      padding: 8px 12px;
      margin-bottom: 12px;
      border-radius: 2px;
      background: var(--vscode-inputValidation-infoBackground, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-inputValidation-infoBorder, var(--vscode-focusBorder));
    }
    body.help-on .help-intro {
      display: block;
    }
    .banner {
      display: none;
      padding: 8px 12px;
      margin-bottom: 12px;
      border-radius: 2px;
      background: var(--vscode-inputValidation-infoBackground, var(--vscode-editorWidget-background));
      border: 1px solid var(--vscode-inputValidation-infoBorder, var(--vscode-focusBorder));
    }
  </style>
</head>
<body>
  <h2>GemStone Login Parameters</h2>

  <div class="help-row">
    <button id="helpToggle" class="secondary" type="button" aria-expanded="false">Help me login</button>
  </div>

  <div id="helpIntro" class="help-intro">
    Fill in the fields below to connect to a stone; each field's help explains what to
    enter. Host User/Password are needed only for a remote stone whose NetLDI requires
    host authentication. For a full explanation of how GemStone logins work — NRS
    syntax, linked vs. RPC logins, and how the NetLDI starts your Gem — see GemStone's
    <a class="doc-link" id="docsLink">Logging in Gem Sessions</a> guide.
  </div>

  <div id="readOnlyBanner" class="banner">
    <span id="activeSessionNote">
      This login has an active session, so its configuration is read-only. Log out to edit it.
    </span>
    <span id="keychainUnreadableNote">
      The OS keychain couldn't be read, so this login is read-only: saving it now would erase the
      passwords kept there. Close it and open it again to retry, or edit it anyway and type the
      passwords again.
      <button id="editAnywayBtn" class="secondary" type="button">Edit anyway</button>
    </span>
  </div>

  <div class="field-group">
    <label for="version">GemStone Version</label>
    <select id="version"></select>
    <div id="versionDownload" class="version-download" hidden
         title="Jasper downloads GemStone's GCI client libraries for this version. No server is installed.">
      <span id="versionDownloadText"></span>
      <button id="downloadVersionBtn" class="secondary">Download files</button>
      <span id="versionDownloadSize"></span>
    </div>
    <div class="field-help">The GemStone version of the stone you are connecting to. Jasper downloads what it needs for that version the first time you use it.</div>

    <label for="gem_host">Gem Host</label>
    <input type="text" id="gem_host" placeholder="localhost">
    <div class="field-help">The machine where your Gem process runs. Use <code>localhost</code> for a stone on this computer, or the remote host's name or IP address for a remote stone.</div>

    <label for="stone">Stone</label>
    <input type="text" id="stone" placeholder="gs64stone">
    <div class="field-help">The name of the running stone (repository monitor) to log in to — for example, <code>gs64stone</code>.</div>

    <label for="netldi">NetLDI (name or port)</label>
    <input type="text" id="netldi" placeholder="gs64ldi or 50377">
    <div class="field-help">The NetLDI network server that launches your Gem. Enter its service name (e.g. <code>gs64ldi</code>) or its port number (e.g. <code>50377</code>). A port number is often easiest for a remote stone.</div>
  </div>

  <div class="field-group">
    <label for="gs_user">GemStone User</label>
    <input type="text" id="gs_user" placeholder="DataCurator">
    <div class="field-help">Your GemStone user — a UserProfile inside the repository, such as <code>DataCurator</code>. This is a GemStone account, not your operating-system login.</div>

    <label for="gs_password">GemStone Password</label>
    <input type="password" id="gs_password">
    <div class="field-help">The password for the GemStone user.</div>
  </div>

  <div class="field-group">
    <label for="host_user">Host User (optional)</label>
    <input type="text" id="host_user">

    <label for="host_password">Host Password (optional)</label>
    <input type="password" id="host_password">
    <div class="field-help">The operating-system account on the Gem's host machine. Fill these in only when the remote NetLDI requires host authentication; leave them blank for a local stone or a guest-mode NetLDI. If left blank, your own OS user is used.</div>
  </div>

  <div class="field-group">
    <div class="checkbox-row">
      <input type="checkbox" id="password_in_keychain">
      <label for="password_in_keychain" class="inline-label">Keep saved passwords in the OS keychain</label>
    </div>
    <div class="hint">For both passwords above. A password you fill in is kept in your OS keychain when this is checked, or as plain text in your VS Code settings when it isn't. A password left blank is never saved: Jasper asks for it when you log in, if it is needed.</div>
  </div>

  <div class="field-group">
    <div class="checkbox-row">
      <input type="checkbox" id="sync_classes" checked>
      <label for="sync_classes" class="inline-label">Sync classes to local files (Find in Files, Go to Definition)</label>
    </div>
    <div class="field-help">Keeps a read-only .gemstone mirror in sync on login/commit. Turn off for slow or remote connections where the initial sync isn't worth it — server-side search still works.</div>
  </div>

  <div class="button-row">
    <button id="saveBtn">Save</button>
    <button id="cancelBtn" class="secondary">Cancel</button>
  </div>

  <script nonce="${nonce}">${loginEditorViewJs}</script>
</body>
</html>`;
}
