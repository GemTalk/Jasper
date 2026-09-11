import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { ActiveSession } from './sessionManager';
import { ExportManager } from './exportManager';
import * as queries from './browserQueries';
import { BrowserQueryError } from './browserQueries';
import { beginClassCommentEdit } from './undo/recordClassComment';
import { notifyUndoable } from './undo/undoableToast';

/**
 * A "Comment" tab (a webview panel in ViewColumn.Two, beside the Globals and
 * class-definition tabs) showing the selected class's comment in an editable
 * field. Saving writes the comment back to GemStone (queries.setClassComment),
 * records an undo entry and re-syncs the class mirror — the same effect as saving
 * the class's gemstone://…/comment document, but as a persistent panel that refills
 * as the user browses classes rather than sharing the definition/method preview slot.
 *
 * One panel per session (keyed like GlobalsBrowser); disposed on logout via
 * disposeForSession.
 */
export class CommentBrowser {
  private static panels = new Map<number, CommentBrowser>();

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private isReady = false;
  private pending: { className: string; text: string; canWrite: boolean } | null = null;

  // The class the panel currently shows — the save target. Updated on each
  // showOrUpdate so a save always writes the comment of the visible class.
  // `dictIndex` (1-based SymbolList position) scopes the lookup to the exact
  // dictionary, disambiguating the same key in two dictionaries; `dictName` is
  // kept for the mirror sync (exportManager.syncClass takes a name).
  private className = '';
  private dictName = '';
  private dictIndex = 0;

  // Dirty guard: the webview reports edits (and their text) so that switching to
  // a different class doesn't silently discard unsaved changes. `currentText` is
  // the last edited/loaded text, used to save the outgoing class on the prompt.
  private dirty = false;
  private currentText = '';

  static async showOrUpdate(
    session: ActiveSession,
    dictName: string,
    dictIndex: number,
    className: string,
    exportManager?: ExportManager,
  ): Promise<void> {
    const existing = CommentBrowser.panels.get(session.id);
    if (existing) {
      existing.exportManager = exportManager;
      // The panel updates its content in place but never brings itself to the
      // front on a (re)selection — a class click (or right-click, which
      // re-selects) must not steal the active tab from the definition the user
      // is viewing. The user fronts the Comment tab by clicking it.
      //
      // Re-selecting the same class is a no-op — never clobber in-progress edits.
      if (existing.className === className) return;
      // Switching to a different class would replace the field's contents — guard
      // any unsaved edits first, mirroring VS Code's prompt for a dirty editor.
      if (existing.dirty) {
        const choice = await vscode.window.showWarningMessage(
          `Save changes to the comment for ${existing.className}?`,
          { modal: true, detail: "Your changes will be lost if you don't save them." },
          'Save',
          "Don't Save",
        );
        if (choice === undefined) return; // Cancel — keep editing the current class
        if (choice === 'Save') existing.save(existing.currentText);
      }
      existing.loadClass(dictName, dictIndex, className);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'gemstoneCommentBrowser',
      `Comment: ${className}`,
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [],
      },
    );

    const browser = new CommentBrowser(panel, session, exportManager);
    CommentBrowser.panels.set(session.id, browser);
    browser.loadClass(dictName, dictIndex, className);
  }

  static disposeForSession(sessionId: number): void {
    const browser = CommentBrowser.panels.get(sessionId);
    if (browser) browser.panel.dispose();
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly session: ActiveSession,
    private exportManager?: ExportManager,
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message) => {
        if (message.command === 'ready') {
          this.isReady = true;
          this.flush();
        } else if (message.command === 'edited') {
          this.dirty = true;
          this.currentText = message.text as string;
        } else if (message.command === 'save') {
          this.save(message.text as string);
        }
      },
      null,
      this.disposables,
    );
  }

  /** Fetch the class's comment and writability and (re)fill the panel with it. */
  private loadClass(dictName: string, dictIndex: number, className: string): void {
    this.dictName = dictName;
    this.dictIndex = dictIndex;
    this.className = className;
    const canWrite = this.computeCanWrite(className);
    const text = queries.getClassComment(this.session, className, this.dictIndex);
    this.panel.title = `Comment: ${className}`;
    this.dirty = false;
    this.currentText = text;
    this.send(className, text, canWrite);
  }

  private computeCanWrite(className: string): boolean {
    try {
      return queries.canClassBeWritten(this.session, className, this.dictIndex);
    } catch {
      // If the check fails (e.g. session busy), assume writable — a failed save
      // will surface the real error rather than blocking editing pre-emptively.
      return true;
    }
  }

  private send(className: string, text: string, canWrite: boolean): void {
    this.pending = { className, text, canWrite };
    this.flush();
  }

  private flush(): void {
    if (this.isReady && this.pending !== null) {
      this.panel.webview.postMessage({ command: 'loadComment', ...this.pending });
      this.pending = null;
    }
  }

  private save(text: string): void {
    try {
      // Read the old comment BEFORE overwriting it — this is the one moment it still
      // exists (#434).
      const recording = beginClassCommentEdit(this.session, {
        dict: this.dictIndex,
        className: this.className,
      });
      const result = queries.setClassComment(this.session, this.className, text, this.dictIndex);
      // setClassComment reports a class it cannot resolve by RETURNING a status string
      // rather than throwing, so "Comment updated" used to appear over a save that wrote
      // nothing — and an undo entry for it would offer to put back a comment nobody
      // replaced.
      if (!result.startsWith('Comment set:')) {
        vscode.window.showWarningMessage(`Comment for ${this.className} was not saved: ${result}`);
        this.panel.webview.postMessage({ command: 'saveError' });
        return;
      }
      notifyUndoable(`Comment updated for ${this.className}`, recording?.commit(text));
      void this.exportManager?.syncClass(this.session, this.dictName, this.className);
      this.dirty = false;
      this.currentText = text;
      this.panel.webview.postMessage({ command: 'saved' });
    } catch (e: unknown) {
      const detail = e instanceof BrowserQueryError || e instanceof Error ? e.message : String(e);
      vscode.window.showErrorMessage(`Failed to update comment for ${this.className}: ${detail}`);
      this.panel.webview.postMessage({ command: 'saveError' });
    }
  }

  private dispose(): void {
    CommentBrowser.panels.delete(this.session.id);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  private getHtml(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Comment</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
    }
    .class-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status { margin-left: auto; font-size: 0.85em; color: var(--vscode-descriptionForeground); white-space: nowrap; }
    button {
      padding: 2px 10px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.4; cursor: default; }
    textarea {
      flex: 1;
      width: 100%;
      resize: none;
      border: none;
      outline: none;
      padding: 8px 10px;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="class-name" id="className"></span>
    <span class="status" id="status"></span>
    <button id="saveBtn" disabled>Save</button>
  </div>
  <textarea id="comment" spellcheck="false" placeholder="Select a class to view its comment…"></textarea>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const textarea = document.getElementById('comment');
    const saveBtn = document.getElementById('saveBtn');
    const statusEl = document.getElementById('status');
    const classNameEl = document.getElementById('className');
    let dirty = false;
    let readOnly = false;

    function setDirty(value) {
      dirty = value;
      saveBtn.disabled = readOnly || !value;
      statusEl.textContent = readOnly ? 'Read-only' : (value ? 'Modified' : '');
    }

    function save() {
      if (readOnly || !dirty) return;
      statusEl.textContent = 'Saving…';
      saveBtn.disabled = true;
      vscode.postMessage({ command: 'save', text: textarea.value });
    }

    textarea.addEventListener('input', () => {
      if (readOnly) return;
      setDirty(true);
      // Report the edit (and its text) so the host can guard unsaved changes
      // when another class is selected.
      vscode.postMessage({ command: 'edited', text: textarea.value });
    });
    saveBtn.addEventListener('click', save);
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    });

    window.addEventListener('message', ev => {
      const msg = ev.data;
      if (msg.command === 'loadComment') {
        classNameEl.textContent = msg.className;
        textarea.value = msg.text;
        readOnly = msg.canWrite === false;
        textarea.readOnly = readOnly;
        setDirty(false);
      } else if (msg.command === 'saved') {
        setDirty(false);
        statusEl.textContent = 'Saved';
      } else if (msg.command === 'saveError') {
        setDirty(true);
        statusEl.textContent = 'Save failed';
      }
    });

    vscode.postMessage({ command: 'ready' });
  </script>
</body>
</html>`;
  }
}
