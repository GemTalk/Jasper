/**
 * Pure HTML rendering for the push-up / push-down method (M7 / M8) preview panel.
 * Rows are one of three kinds:
 *   - a plain `methodAdd` onto a fresh target — enabled + CHECKED, so the user can un-tick
 *     a target they do not want (a copy-down convenience; the source is kept);
 *   - an OVERWRITE `methodAdd` onto a target that already defines the selector — enabled +
 *     UNCHECKED by default, flagged with a ⚠ data-loss warning and a before/after diff, so
 *     replacing the existing method is an explicit opt-in;
 *   - a source `methodRemove` — CORE (checked + disabled): the server fires it only once
 *     the targets actually hold the method, so it is not a user choice.
 * Selectors that could NOT move (a hard decline) are listed in a summary; a global decline
 * (which blocks Apply) sits in a banner. Paginated exactly like the other refactoring
 * panels, reusing renameMethodPanelView.js for the DOM behaviour (it derives the deselected
 * set from unchecked boxes and recomputes the count on load).
 *
 * The document scaffold (CSP, header, banner, skipped summary, diff CSS, pager) is shared
 * with move-method via `methodRelocationPanelHtml`; this module only supplies push's
 * three-way card, its warning styles, and clickable-checkbox cursor.
 *
 * Kept free of any `vscode` dependency so it unit-tests directly.
 */
import {
  PushChange,
  PushOutOfScope,
  PushSkippedMethod,
  pushChangeLabel,
} from './pushMethodPreview';
import {
  RelocationPanelHtmlOptions,
  escapeHtml,
  renderAllOfType,
  renderRelocationPanelHtml,
} from './methodRelocationPanelHtml';

/** Push-specific CSS appended to the shared style block: the warning row + banner styling
 *  and the disabled-checkbox cursor override. */
const PUSH_EXTRA_CSS = `
    li.change.warn {
      border-color: var(--vscode-inputValidation-warningBorder, rgba(200,140,0,0.6));
    }
    .warn {
      margin: 0; padding: 6px 10px;
      font-size: 0.9em;
      color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
      background: var(--vscode-inputValidation-warningBackground, rgba(200,140,0,0.10));
      border-top: 1px solid var(--vscode-inputValidation-warningBorder, rgba(200,140,0,0.4));
    }
    .change-head .sel:disabled { cursor: default; }`;

function renderCard(change: PushChange): string {
  const label = escapeHtml(pushChangeLabel(change));
  const badge = change.category ? `<span class="badge">${escapeHtml(change.category)}</span>` : '';
  const isRemove = change.kind === 'methodRemove';
  const isOverwrite = change.kind === 'methodAdd' && change.warning != null;
  // Diff: a plain add is all-added; a remove is all-removed; an OVERWRITE shows the
  // existing body (removed) above the pushed body (added) — a real before/after so the
  // user sees exactly what is lost.
  const diff = isRemove
    ? renderAllOfType(change.oldSource, 'del')
    : isOverwrite
      ? renderAllOfType(change.oldSource, 'del') + renderAllOfType(change.newSource, 'add')
      : renderAllOfType(change.newSource, 'add');
  // Checkbox policy:
  //  - a source #methodRemove is CORE (checked + disabled): the server fires it only once
  //    the targets actually hold the method, so it is not a user choice;
  //  - an OVERWRITE add is opt-in: enabled and UNCHECKED by default, so the destructive
  //    replace happens only if the user ticks it;
  //  - a plain add (a fresh target) is enabled and CHECKED, so the user can un-tick a
  //    target they do not want (a copy-down convenience; the source is then kept).
  // The shared view JS derives the deselected set from UNCHECKED boxes and recomputes the
  // count on load, so a default-unchecked overwrite is reported deselected from the start.
  let cb: string;
  if (isRemove) {
    cb = `<input type="checkbox" class="sel" checked disabled title="Removed from the source automatically, once every target has the method" aria-label="${label} (automatic)">`;
  } else if (isOverwrite) {
    cb = `<input type="checkbox" class="sel" title="Overwrites an existing method — tick to replace it (data loss)" aria-label="${label} (overwrite, opt-in)">`;
  } else {
    cb = `<input type="checkbox" class="sel" checked title="Untick to skip this target" aria-label="${label}">`;
  }
  const warn = change.warning ? `<div class="warn">⚠ ${escapeHtml(change.warning)}</div>` : '';
  const liClass = isOverwrite ? 'change warn deselected' : 'change';
  return `<li class="${liClass}" data-id="${escapeHtml(change.id)}">
  <div class="change-head">
    ${cb}
    <span class="label">${label}</span>
    ${badge}
    <button class="toggle" title="Show/hide diff" aria-expanded="false">▸</button>
  </div>
  ${warn}
  <pre class="diff hidden">${diff}</pre>
</li>`;
}

/** Render a batch of cards. All push changes are core, so no core/optional split. Pure. */
export function renderPushCards(changes: PushChange[]): string {
  return changes.map((c) => renderCard(c)).join('\n');
}

export interface PushPanelHtmlOptions {
  /** The panel heading, e.g. "Push Up to Foo" or "Push Down into subclasses of Foo". */
  heading: string;
  /** Total number of changes across all pages. */
  total: number;
  /** The first page of changes. */
  changes: PushChange[];
  /** True when the first page is also the last (no More button). */
  done: boolean;
  outOfScope: PushOutOfScope;
  skippedMethods: PushSkippedMethod[];
  nonce: string;
  script: string;
}

/** Build the panel's HTML. Pure (no vscode) so it unit-tests directly. */
export function renderPushPanelHtml(opts: PushPanelHtmlOptions): string {
  const { heading, total, changes, done, outOfScope, skippedMethods, nonce, script } = opts;
  const shared: RelocationPanelHtmlOptions = {
    docTitle: 'Push Method',
    headerHtml: escapeHtml(heading),
    total,
    cardsHtml: renderPushCards(changes),
    pageCount: changes.length,
    done,
    outOfScope,
    skippedMethods,
    nonce,
    script,
    extraCss: PUSH_EXTRA_CSS,
    selCursor: 'pointer',
  };
  return renderRelocationPanelHtml(shared);
}
