/**
 * A webview panel that edits a method's signature — the selector parts plus the
 * add/remove/reorder of parameters — and a scope, resolving with the chosen parts,
 * argument permutation, new argument names, per-position defaults, and scope, or
 * undefined if cancelled/closed. The caller runs the (non-committing) preview.
 *
 * Follows Jasper's webview conventions: the DOM logic lives in the sibling
 * changeSignatureEditorView.js (read at runtime, injected under a nonce) so it can be
 * unit-tested in jsdom; the HTML is themed with vscode CSS variables.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { renderSignatureEditorHtml } from './changeSignatureEditorHtml';
import { ChangeSignatureScope } from './queries/previewChangeSignature';
import { readWebviewScript } from '../webviewAssets';

const editorJs = readWebviewScript('changeSignatureEditorView.js', 'refactoring');

export interface SignatureEditResult {
  /** New selector parts, in new (possibly reordered) order. */
  newParts: string[];
  /** For each new argument position, the 1-based ORIGINAL argument index it draws
   *  from, or 0 for a brand-new parameter (the engine's permutation). */
  permutation: number[];
  /** For each new argument position, the argument name (only new positions are
   *  honoured server-side; reused positions keep their own name). */
  newArgNames: string[];
  /** For each new argument position, the source spliced at send sites for a new
   *  parameter ('' for a reused one). */
  defaults: string[];
  scope: ChangeSignatureScope;
}

export interface SignatureEditorOptions {
  className: string;
  oldSelector: string;
  isMeta: boolean;
  /** Current argument names of the defining implementor (from the pre-flight
   *  analysis), one per keyword/binary part in declaration order. */
  argNames: string[];
  /** The current dictionary's name; enables a "This dictionary" scope option. */
  dictName?: string;
}

/** Show the signature editor; resolve with the edit, or undefined if cancelled. */
export function showChangeSignatureEditor(
  opts: SignatureEditorOptions,
): Promise<SignatureEditResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneChangeSignatureEditor',
    `Change signature ${opts.oldSelector}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderSignatureEditorHtml({ ...opts, nonce, script: editorJs });

  return new Promise<SignatureEditResult | undefined>((resolve) => {
    let settled = false;
    const finish = (result: SignatureEditResult | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(result);
      panel.dispose();
    };
    panel.webview.onDidReceiveMessage((message) => {
      if (message?.command === 'ok') {
        finish({
          newParts: Array.isArray(message.newParts) ? message.newParts : [],
          permutation: Array.isArray(message.permutation) ? message.permutation : [],
          newArgNames: Array.isArray(message.newArgNames) ? message.newArgNames : [],
          defaults: Array.isArray(message.defaults) ? message.defaults : [],
          scope: message.scope,
        });
      } else if (message?.command === 'cancel') {
        finish(undefined);
      }
    });
    panel.onDidDispose(() => finish(undefined));
  });
}
