/**
 * A webview panel that edits a class's new name and the reference scope,
 * resolving with `{ newName, scope }` or undefined if cancelled/closed. Mirrors
 * the rename-method editor for a consistent rename UX.
 *
 * On submit the host runs `validate(newName)` — a synchronous check that includes
 * "is this name already in use in the stone?" — and, if it returns an error,
 * posts it back to the editor (`invalid`) so the user can choose another name
 * without the editor closing. The editor resolves only once a name passes.
 *
 * Follows Jasper's webview conventions: DOM logic lives in the sibling
 * renameClassEditorView.js (read at runtime, injected under a nonce).
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { renderClassEditorHtml } from './renameClassEditorHtml';
import {
  RenameClassScope,
  RenameClassOptions,
  isRenameClassScope,
} from './queries/previewRenameClass';
import { readWebviewScript } from '../webviewAssets';

const editorJs = readWebviewScript('renameClassEditorView.js', 'refactoring');

const DEFAULT_OPTIONS: RenameClassOptions = {
  copyMethods: true,
  recompileSubclasses: true,
  migrateInstances: true,
  removeOldFromHistory: false,
};

function parseOptions(raw: unknown): RenameClassOptions {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_OPTIONS };
  const o = raw as Record<string, unknown>;
  return {
    copyMethods: o.copyMethods !== false,
    recompileSubclasses: o.recompileSubclasses !== false,
    migrateInstances: o.migrateInstances === true,
    removeOldFromHistory: o.removeOldFromHistory === true,
  };
}

export interface ClassEditResult {
  newName: string;
  scope: RenameClassScope;
  options: RenameClassOptions;
}

export interface RenameClassEditorOptions {
  oldName: string;
  /** The current dictionary's name; enables a "This dictionary" scope option. */
  dictName?: string;
}

/** Show the rename-class editor. `validate` returns an error string to show
 *  inline (e.g. "the name Bar is already in use") or undefined when the name is
 *  acceptable. Resolves with the edit, or undefined if cancelled/closed. */
export function showRenameClassEditor(
  opts: RenameClassEditorOptions,
  validate: (newName: string) => string | undefined,
): Promise<ClassEditResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneRenameClassEditor',
    `Rename ${opts.oldName}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderClassEditorHtml({ ...opts, nonce, script: editorJs });

  return new Promise<ClassEditResult | undefined>((resolve) => {
    let settled = false;
    const finish = (result: ClassEditResult | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(result);
      panel.dispose();
    };
    panel.webview.onDidReceiveMessage((message) => {
      if (message?.command === 'ok') {
        const newName = typeof message.newName === 'string' ? message.newName.trim() : '';
        if (!isRenameClassScope(message.scope)) {
          // Malformed scope from the webview: reject rather than trust the cast.
          void panel.webview.postMessage({
            command: 'invalid',
            message: 'Internal error: unrecognized rename scope.',
          });
          return; // keep the editor open
        }
        const scope: RenameClassScope = message.scope;
        const err = validate(newName);
        if (err) {
          void panel.webview.postMessage({ command: 'invalid', message: err });
          return; // keep the editor open so the user can choose another name
        }
        finish({ newName, scope, options: parseOptions(message.options) });
      } else if (message?.command === 'cancel') {
        finish(undefined);
      }
    });
    panel.onDidDispose(() => finish(undefined));
  });
}
