/**
 * One object-graph webview panel — one tab, one graph.
 *
 * Deliberately NOT a singleton. Stepping into a referrer opens a new panel rather than
 * replacing the current one, so walking never destroys the graph you walked from: the tab
 * you came from is still there, still interactive, still showing what it showed. Going
 * *back* along the breadcrumb re-centres within its own tab, because that is what a back
 * control is for.
 *
 * UI-only, and stateless with respect to the walk. ObjectGraphWalk owns which object is
 * centred and which class is expanded, and hands over a complete view plus the handlers
 * for that view on every render — so a click always acts on the render it came from and a
 * stale closure cannot act on a previous target.
 *
 * DOM behaviour lives in objectGraphView.js (read at runtime, injected under a nonce),
 * matching Jasper's webview convention.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { renderObjectGraphHtml } from './objectGraphHtml';
import { ObjectGraphActions, ObjectGraphWalkView } from './objectGraphWalk';
import { readWebviewScript } from '../webviewAssets';

const panelJs = readWebviewScript('objectGraphView.js', 'objectGraph');

/** The message shapes objectGraphView.js sends up. Kept beside the handler that reads
 *  them so the protocol can be checked in both directions from one place. Nothing is sent
 *  the other way: the host re-renders the whole document instead. */
type ViewMessage =
  | { command: 'expand'; classOop: string; className: string; ownerOop: string }
  | { command: 'dive'; oop: string }
  | { command: 'goTo'; index: number }
  | { command: 'inspectObject'; oop: string }
  | { command: 'inspectCollection'; classOop: string; className: string }
  | { command: 'revealClass'; className: string }
  | { command: 'revealClassByOop'; oop: string }
  | { command: 'addToCanvas'; oop: string }
  | { command: 'removeFromCanvas'; oop: string }
  | { command: 'clearCanvas' }
  | { command: 'focusNode'; oop: string }
  | { command: 'moveBox'; boxId: string; x: number; y: number }
  | { command: 'resetLayout' }
  | { command: 'removeGroup'; ownerOop: string; className: string }
  | { command: 'restoreRemoved' };

/** Route one view message to the matching handler. Split out so the protocol reads as a
 *  single table: every message the view can send appears here exactly once, and a message
 *  with a bad payload is dropped rather than passed on as NaN or "undefined". */
async function route(message: ViewMessage, handlers: ObjectGraphActions): Promise<void> {
  const isOop = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v);
  const isName = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

  switch (message?.command) {
    case 'expand':
      if (isOop(message.classOop) && isName(message.className) && isOop(message.ownerOop)) {
        await handlers.expand(message.ownerOop, message.classOop, message.className);
      }
      return;
    case 'dive':
      if (isOop(message.oop)) await handlers.dive(message.oop);
      return;
    case 'goTo':
      if (Number.isInteger(message.index)) await handlers.goTo(message.index);
      return;
    case 'inspectObject':
      if (isOop(message.oop)) await handlers.inspectObject(message.oop);
      return;
    case 'inspectCollection':
      if (isOop(message.classOop) && isName(message.className)) {
        await handlers.inspectCollection(message.classOop, message.className);
      }
      return;
    case 'revealClass':
      if (isName(message.className)) await handlers.revealClass(message.className);
      return;
    case 'revealClassByOop':
      if (isOop(message.oop)) await handlers.revealClassByOop(message.oop);
      return;
    case 'addToCanvas':
      if (isOop(message.oop)) await handlers.addToCanvas(message.oop);
      return;
    case 'removeFromCanvas':
      if (isOop(message.oop)) await handlers.removeFromCanvas(message.oop);
      return;
    case 'clearCanvas':
      await handlers.clearCanvas();
      return;
    case 'focusNode':
      if (isOop(message.oop)) await handlers.focusNode(message.oop);
      return;
    case 'moveBox':
      // Coordinates come from a drag in the webview, so they are checked rather than
      // trusted: a NaN would place a box nowhere and take its edges with it.
      if (
        isName(message.boxId) &&
        Number.isFinite(message.x) &&
        Number.isFinite(message.y) &&
        message.x >= 0 &&
        message.y >= 0
      ) {
        await handlers.moveBox(message.boxId, Math.round(message.x), Math.round(message.y));
      }
      return;
    case 'resetLayout':
      await handlers.resetLayout();
      return;
    case 'restoreRemoved':
      await handlers.restoreRemoved();
      return;
    case 'removeGroup':
      if (isOop(message.ownerOop) && isName(message.className)) {
        await handlers.removeGroup(message.ownerOop, message.className);
      }
      return;
  }
}

export class ObjectGraphPanel {
  private readonly panel: vscode.WebviewPanel;
  /** Handlers for the render currently on screen. Replaced on every render. */
  private actions: ObjectGraphActions | undefined;
  /** Serialises clicks within this panel. A scan is a blocking GCI call; overlapping them
   *  on one session would trip the session-busy check and surface as an error the user did
   *  not cause. Per-panel rather than global, since two panels may be on two sessions. */
  private busy = false;

  /** Open a new panel. `onClose` fires when the user closes the tab, so the walk behind it
   *  can release its pinned objects. */
  constructor(onClose: () => void) {
    this.panel = vscode.window.createWebviewPanel(
      'gemstoneObjectGraph',
      'Object Graph',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
    );
    this.panel.onDidDispose(() => {
      this.actions = undefined;
      onClose();
    });
    this.panel.webview.onDidReceiveMessage((message: ViewMessage) => {
      void (async () => {
        const handlers = this.actions;
        if (!handlers || this.busy) return;
        this.busy = true;
        try {
          await route(message, handlers);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          void vscode.window.showErrorMessage(`Object graph: ${msg}`);
        } finally {
          this.busy = false;
        }
      })();
    });
  }

  /** Draw `view`, and bind the controls in it to `actions`. */
  render(view: ObjectGraphWalkView, actions: ObjectGraphActions): void {
    this.actions = actions;
    const nonce = crypto.randomBytes(16).toString('hex');
    this.panel.title = `Object Graph: ${view.targetClass}`;
    this.panel.webview.html = renderObjectGraphHtml({ ...view, nonce, script: panelJs });
    this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Active, false);
  }

  dispose(): void {
    this.panel.dispose();
  }
}
