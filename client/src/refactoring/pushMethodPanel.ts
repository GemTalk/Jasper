/**
 * The paginated push-up / push-down method (M7 / M8) preview panel. Shows every staged
 * change (a `methodAdd` on the target + a `methodRemove` on the source, per movable
 * selector), lists any selectors that could not move, fetches further pages on demand,
 * and applies server-side (no commit). Resolves with the apply result, or undefined if
 * cancelled/closed. UI-only: the caller supplies the page/apply/cleanup handlers.
 *
 * Thin wrapper over the shared `showMethodRelocationPanel` scaffold, supplying push's
 * view-type, heading, and render functions (which handle push's fresh-add / opt-in
 * overwrite / required-removal rows). `heading` names the direction + target.
 */
import { StartPushPreview, PushPreviewPage, PushApplyResult } from './pushMethodPreview';
import { renderPushPanelHtml, renderPushCards } from './pushMethodPanelHtml';
import { showMethodRelocationPanel } from './methodRelocationPanel';

export interface PushMethodPanelHandlers {
  /** Fetch the page starting at `offset` (1-based). */
  loadPage: (offset: number) => Promise<PushPreviewPage>;
  /** Apply server-side, skipping `deselectedIds`; no commit. */
  apply: (deselectedIds: string[]) => Promise<PushApplyResult>;
  /** Drop the preview session (called exactly once when the panel closes). */
  cleanup: () => void;
}

/** Show the paginated preview; resolve with the apply result, or undefined if the
 *  user cancelled/closed it. `heading` names the direction + target. */
export function showPushMethodPanel(
  heading: string,
  start: StartPushPreview,
  handlers: PushMethodPanelHandlers,
): Promise<PushApplyResult | undefined> {
  return showMethodRelocationPanel(
    start,
    {
      viewType: 'gemstonePushMethod',
      title: heading,
      errorPrefix: 'Push preview',
      renderCards: renderPushCards,
      renderHtml: (nonce, script) =>
        renderPushPanelHtml({
          heading,
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
