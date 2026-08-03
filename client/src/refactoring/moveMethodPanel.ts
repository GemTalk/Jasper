/**
 * The paginated move-method (M6) preview panel. Shows every staged change (a
 * `methodAdd` on the target + a `methodRemove` on the source, per movable selector)
 * as a required row, lists any selectors that could not move, fetches further pages on
 * demand, and applies server-side (no commit). Resolves with the apply result, or
 * undefined if cancelled/closed. UI-only: the caller supplies the page/apply/cleanup
 * handlers.
 *
 * Thin wrapper over the shared `showMethodRelocationPanel` scaffold, supplying move's
 * view-type, title, and render functions. Because every row is required (checked +
 * disabled), the deselected set the view reports is always empty; apply passes it
 * through unchanged.
 */
import { StartMovePreview, PreviewPage, ApplyResult } from './moveMethodPreview';
import { renderMovePanelHtml, renderMoveCards } from './moveMethodPanelHtml';
import { showMethodRelocationPanel } from './methodRelocationPanel';

export interface MoveMethodPanelHandlers {
  /** Fetch the page starting at `offset` (1-based). */
  loadPage: (offset: number) => Promise<PreviewPage>;
  /** Apply server-side, skipping `deselectedIds` (always empty here); no commit. */
  apply: (deselectedIds: string[]) => Promise<ApplyResult>;
  /** Drop the preview session (called exactly once when the panel closes). */
  cleanup: () => void;
}

/** Show the paginated preview; resolve with the apply result, or undefined if the
 *  user cancelled/closed it. */
export function showMoveMethodPanel(
  targetClass: string,
  start: StartMovePreview,
  handlers: MoveMethodPanelHandlers,
): Promise<ApplyResult | undefined> {
  return showMethodRelocationPanel(
    start,
    {
      viewType: 'gemstoneMoveMethod',
      title: `Move to ${targetClass}`,
      errorPrefix: 'Move preview',
      renderCards: renderMoveCards,
      renderHtml: (nonce, script) =>
        renderMovePanelHtml({
          targetClass,
          total: start.total,
          changes: start.page.changes,
          done: start.page.done,
          outOfScope: start.outOfScope,
          skippedMethods: start.skippedMethods,
          nonce,
          script,
        }),
    },
    handlers,
  );
}
