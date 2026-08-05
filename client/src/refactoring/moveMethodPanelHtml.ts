/**
 * Pure HTML rendering for the move-method (M6) preview panel. Every row is a CORE
 * change — a `methodAdd` on the target or a `methodRemove` on the source — rendered
 * with a checked, DISABLED checkbox: the user chose which methods to move at
 * drag/command time, so the preview is confirm-or-cancel, not a per-change picker
 * (and the two changes for one selector must apply together). Selectors that could
 * NOT move are listed in a summary; a global decline (which blocks Apply) sits in a
 * banner. Paginated exactly like the inline-method panel, reusing
 * renameMethodPanelView.js for the DOM behaviour.
 *
 * The document scaffold (CSP, header, banner, skipped summary, diff CSS, pager) is
 * shared with push-method via `methodRelocationPanelHtml`; this module only supplies
 * move's always-required card and header.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly.
 */
import { MoveChange, MoveOutOfScope, SkippedMethod, moveChangeLabel } from './moveMethodPreview';
import {
  RelocationPanelHtmlOptions,
  escapeHtml,
  renderPlainChangeDiff,
  renderRelocationPanelHtml,
} from './methodRelocationPanelHtml';

function renderCard(change: MoveChange): string {
  const label = escapeHtml(moveChangeLabel(change));
  const badge = change.category ? `<span class="badge">${escapeHtml(change.category)}</span>` : '';
  // methodAdd has no old source (all-added on the target); methodRemove has no new
  // source (all-removed from the source). Render each as a single-sided diff rather
  // than diffing against '' (which shows a phantom empty line).
  const diff = renderPlainChangeDiff(change);
  // Every move change is required: a checked, DISABLED checkbox stays checked, so the
  // shared view JS (which derives the deselected set from UNCHECKED boxes) never
  // reports it — the move always applies in full.
  const cb = `<input type="checkbox" class="sel" checked disabled title="This change is required" aria-label="${label} (required)">`;
  return `<li class="change" data-id="${escapeHtml(change.id)}">
  <div class="change-head">
    ${cb}
    <span class="label">${label}</span>
    ${badge}
    <button class="toggle" title="Show/hide diff" aria-expanded="false">▸</button>
  </div>
  <pre class="diff hidden">${diff}</pre>
</li>`;
}

/** Render a batch of cards. All move changes are core, so no core/optional split. Pure. */
export function renderMoveCards(changes: MoveChange[]): string {
  return changes.map((c) => renderCard(c)).join('\n');
}

export interface MovePanelHtmlOptions {
  /** The target class the methods move to (for the header). */
  targetClass: string;
  /** Total number of changes across all pages (2 per movable selector). */
  total: number;
  /** The first page of changes. */
  changes: MoveChange[];
  /** True when the first page is also the last (no More button). */
  done: boolean;
  outOfScope: MoveOutOfScope;
  skippedMethods: SkippedMethod[];
  nonce: string;
  script: string;
}

/** Build the panel's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderMovePanelHtml(opts: MovePanelHtmlOptions): string {
  const { targetClass, total, changes, done, outOfScope, skippedMethods, nonce, script } = opts;
  const shared: RelocationPanelHtmlOptions = {
    docTitle: 'Move Method',
    headerHtml: `Move to <code>${escapeHtml(targetClass)}</code>`,
    total,
    cardsHtml: renderMoveCards(changes),
    pageCount: changes.length,
    done,
    outOfScope,
    skippedMethods,
    nonce,
    script,
    selCursor: 'default',
  };
  return renderRelocationPanelHtml(shared);
}
