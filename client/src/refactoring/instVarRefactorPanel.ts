/**
 * The paginated add / remove instance-variable (V1) preview panel. Shows every staged
 * class change (a definition edit or a reparent) as a required row, a prominent list of
 * methods that will not recompile, and migrate / delete-history checkboxes. Fetches
 * further pages on demand and applies
 * server-side. Applying with neither migrate nor delete-history does NOT commit; with
 * either, it commits — so the host confirms first. Resolves with the apply result, or
 * undefined if cancelled/closed. UI-only: the caller supplies the handlers.
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import {
  StartInstVarPreview,
  PreviewPage,
  ApplyResult,
  describeApplyFailure,
} from './instVarRefactorPreview';
import { renderInstVarPanelHtml, renderInstVarCards } from './instVarRefactorPanelHtml';
import { readWebviewScript } from '../webviewAssets';

const panelJs = readWebviewScript('instVarRefactorPanelView.js', 'refactoring');

export interface InstVarPanelHandlers {
  /** Fetch the page starting at `offset` (1-based). */
  loadPage: (offset: number) => Promise<PreviewPage>;
  /** Apply server-side. `options` (or null) replaces the acted-on class's options;
   *  migrate/deleteHistory commit. */
  apply: (
    options: string[] | null,
    migrate: boolean,
    deleteHistory: boolean,
  ) => Promise<ApplyResult>;
  /** Abort the session transaction — discards the stranded partial reshape (and any other
   *  uncommitted work). Invoked from the panel's in-place Abort button. Throws on failure. */
  abort: () => void;
  /** LIVE probe of `System needsCommit`, used at commit-confirmation time. The preview's
   *  `sessionHasUncommittedChanges` is a snapshot from when it was built; a paginated preview can
   *  sit open while the user picks up other uncommitted work, so re-probe here rather than warn (or
   *  fail to warn) off a stale value. `undefined` = couldn't tell; the caller falls back to the
   *  snapshot. Optional so unit tests that don't exercise the committing path can omit it. */
  sessionNeedsCommit?: () => boolean | undefined;
  /** Drop the preview session (called exactly once when the panel closes). */
  cleanup: () => void;
}

/** Show the paginated preview; resolve with the apply result, or undefined if the user
 *  cancelled/closed it. */
export function showInstVarRefactorPanel(
  title: string,
  start: StartInstVarPreview,
  handlers: InstVarPanelHandlers,
  accessorNote?: string,
): Promise<ApplyResult | undefined> {
  const panel = vscode.window.createWebviewPanel(
    'gemstoneInstVarRefactor',
    title,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );

  const nonce = crypto.randomBytes(16).toString('hex');
  panel.webview.html = renderInstVarPanelHtml({
    title,
    total: start.total,
    changes: start.page.changes,
    done: start.page.done,
    outOfScope: start.outOfScope,
    nonce,
    script: panelJs,
    accessorNote,
  });

  let offset = start.page.nextOffset;
  let done = start.page.done;

  return new Promise<ApplyResult | undefined>((resolve) => {
    let settled = false;
    const finish = (result: ApplyResult | undefined): void => {
      if (settled) return;
      settled = true;
      handlers.cleanup();
      resolve(result);
      panel.dispose();
    };

    const fetchOne = async (): Promise<boolean> => {
      const page = await handlers.loadPage(offset);
      void panel.webview.postMessage({
        command: 'appendChanges',
        html: renderInstVarCards(page.changes),
        done: page.done,
      });
      offset = page.nextOffset;
      done = page.done;
      return done;
    };

    let loading = false;
    // Apply is one-shot per panel: `applyForToken:` versions classes (and commits when a
    // committing option is on), so a second run would stage a second round of versions on
    // top of the first. Set before the commit confirmation so an apply arriving while that
    // modal is open is dropped too; cleared only on the paths that leave the panel open.
    let applying = false;
    panel.webview.onDidReceiveMessage((message) => {
      void (async () => {
        try {
          if (message?.command === 'loadMore' || message?.command === 'loadAll') {
            if (loading) return;
            if (done) {
              void panel.webview.postMessage({ command: 'busyDone' });
              return;
            }
            loading = true;
            try {
              if (message.command === 'loadAll') {
                while (!done) await fetchOne();
              } else {
                await fetchOne();
              }
            } finally {
              loading = false;
            }
          } else if (message?.command === 'apply') {
            if (applying) return;
            applying = true;
            const options: string[] | null = Array.isArray(message.options)
              ? message.options.filter((o: unknown): o is string => typeof o === 'string')
              : null;
            const migrate = message.migrate === true;
            const deleteHistory = message.deleteHistory === true;
            if (migrate || deleteHistory) {
              const parts = [
                migrate ? 'migrate existing instances' : '',
                deleteHistory ? 'delete prior class versions' : '',
              ].filter(Boolean);
              // `System commitTransaction` commits the WHOLE session transaction, not just the
              // change staged here, so anything else the user has uncommitted rides along. The
              // preview's flag is a SNAPSHOT from when it was built and the panel may have sat open
              // for a while, so re-probe live; only fall back to the snapshot if the probe can't
              // tell. (A stale `true` merely over-warns; it's the stale `false` that would bite.)
              const live = handlers.sessionNeedsCommit?.();
              const dirty = live ?? start.outOfScope.sessionHasUncommittedChanges;
              const collateral = dirty
                ? ' You have OTHER uncommitted changes in this session — they will be committed too.'
                : '';
              const ok = await vscode.window.showWarningMessage(
                `This will COMMIT the transaction (${parts.join(' and ')}).${collateral} Continue?`,
                { modal: true },
                'Apply & Commit',
              );
              if (ok !== 'Apply & Commit') {
                applying = false;
                void panel.webview.postMessage({ command: 'busyDone' });
                return;
              }
            }
            const result = await handlers.apply(options, migrate, deleteHistory);
            const failure = describeApplyFailure(
              result,
              start.outOfScope.sessionHasUncommittedChanges,
            );
            if (!failure) {
              finish(result);
              return;
            }
            // Apply failed. Keep the panel up with a prominent banner instead of a toast, and
            // leave `applying` set so the (now meaningless) Apply button cannot re-fire. The
            // stranded partial reshape, if any, is aborted in place via the banner's button.
            void panel.webview.postMessage({
              command: 'applyFailed',
              message: failure.message,
              canAbort: failure.canAbort,
            });
          } else if (message?.command === 'abort') {
            // Direct abort — no second confirmation; the banner already stated the cost.
            try {
              handlers.abort();
              void panel.webview.postMessage({ command: 'aborted' });
            } catch (e: unknown) {
              void panel.webview.postMessage({
                command: 'abortFailed',
                message: e instanceof Error ? e.message : String(e),
              });
            }
          } else if (message?.command === 'cancel') {
            finish(undefined);
          }
        } catch (e: unknown) {
          loading = false;
          applying = false;
          const msg = e instanceof Error ? e.message : String(e);
          void vscode.window.showErrorMessage(`Instance-variable preview: ${msg}`);
          void panel.webview.postMessage({ command: 'busyDone' });
        }
      })();
    });

    panel.onDidDispose(() => finish(undefined));
  });
}
