/**
 * A webview panel that edits a method's selector as reorderable keyword-part
 * rows (each row pairing the editable keyword with the argument it binds) and a
 * scope, resolving with the chosen parts + argument permutation + scope, or
 * undefined if cancelled/closed. The caller runs the (non-committing) preview.
 *
 * Follows Jasper's webview conventions: the DOM logic lives in the sibling
 * renameMethodEditorView.js (read at runtime, injected under a nonce) so it can
 * be unit-tested in jsdom; the HTML is themed with vscode CSS variables.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { renderMethodEditorHtml } from './renameMethodEditorHtml';
import { RenameMethodScope } from './queries/previewRenameMethod';
import { readWebviewScript } from '../webviewAssets';

const editorJs = readWebviewScript('renameMethodEditorView.js', 'refactoring');

export interface MethodEditResult {
  /** New selector parts, in new (possibly reordered) order. */
  parts: string[];
  /** For each new argument position, the 1-based ORIGINAL argument index it draws
   *  from (the engine's permutation). Empty for a zero-argument selector. */
  originalIndices: number[];
  scope: RenameMethodScope;
}

export interface RenameMethodEditorOptions {
  className: string;
  oldSelector: string;
  isMeta: boolean;
  argNames: string[];
  /** The current dictionary's name; enables a "This dictionary" scope option. */
  dictName?: string;
}

/** Show the keyword-part editor; resolve with the edit, or undefined if cancelled. */
export function showRenameMethodEditor(
  opts: RenameMethodEditorOptions,
): Promise<MethodEditResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneRenameMethodEditor',
    `Rename ${opts.oldSelector}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderMethodEditorHtml({ ...opts, nonce, script: editorJs });

  return new Promise<MethodEditResult | undefined>((resolve) => {
    let settled = false;
    const finish = (result: MethodEditResult | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(result);
      panel.dispose();
    };
    panel.webview.onDidReceiveMessage((message) => {
      if (message?.command === 'ok') {
        finish({
          parts: Array.isArray(message.parts) ? message.parts : [],
          originalIndices: Array.isArray(message.originalIndices) ? message.originalIndices : [],
          scope: message.scope,
        });
      } else if (message?.command === 'cancel') {
        finish(undefined);
      }
    });
    panel.onDidDispose(() => finish(undefined));
  });
}
