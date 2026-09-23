/**
 * The debugger's evaluate pane markup, in one place so the panel and its tests cannot drift apart.
 *
 * Same reason `renderOmniHtml` is shared with the GemStone Search webview harness: the view's wiring
 * skips controls it cannot find (`if (!el) return;`), so a test against a hand-copied DOM stays green
 * against markup the panel no longer emits — and a test asserting that a control EXISTS proves
 * nothing at all unless it is looking at what ships.
 *
 * The pane is a lower tab rather than an always-present bar, offering the same three actions by the
 * same names as the Inspector's evaluate tab (see evaluateMode.ts). Its wiring lives in
 * debuggerView.js; the styles live with the rest of the panel's stylesheet.
 *
 * The keys it answers to are advertised without costing a pixel of layout — this pane is squeezed
 * into a panel that is always short of height. The placeholder occupies space the empty box was
 * spending on nothing and is gone the moment you type; the rest rides on tooltips, here and on the
 * buttons. The placeholder previously said "Enter", which stopped being true when the box became
 * multi-line and Shift+Enter took over running it.
 *
 * The keys are written `Ctrl` here, which is right everywhere but a Mac. Only the webview knows
 * which platform it is on, so `labelKeysForPlatform` in debuggerView.js rewrites these titles to
 * `Cmd` when it is one — the markup carries the one copy of the wording, the webview adjusts it.
 *
 * It names ONE key rather than the full legend, because this box is a single line in a narrow
 * column: a placeholder wider than the field made the textarea scroll sideways, and the scrollbar
 * ate most of a 1.9rem box — so a pane nobody had touched yet looked broken. The full legend is on
 * this element's tooltip, which costs nothing and cannot overflow.
 */
export function evaluatePaneHtml(): string {
  return `<div class="evalbar" id="evalbar">
    <div class="eval-tabs" role="tablist">
      <div class="eval-tab" id="evalToggle" data-tab="eval" role="tab" tabindex="0"
           aria-selected="false" title="Evaluate an expression in the selected frame">Evaluate</div>
    </div>
    <span class="eval-input-wrap">
      <textarea id="evalInput" rows="1" autocomplete="off" spellcheck="false"
             placeholder="Shift+Enter to run"
             title="Shift+Enter or Ctrl+Enter — Display It&#10;Ctrl+K then D / E / I — Display It, Execute It, Inspect It&#10;Ctrl+↑ / Ctrl+↓ — earlier / later expression&#10;Escape — clear the box"></textarea>
      <button class="clear-btn" id="evalClear" tabindex="-1" title="Clear">✕</button>
    </span>
    <!-- The answer sits immediately beside the expression it came from, sharing the row half and
         half, and the buttons go last. Putting the toolbar between them pushed the answer to the far
         end of the row, a full button-set away from the thing that produced it — you read the
         expression on the left and then had to jump the width of three buttons to find what it
         said. -->
    <div class="eval-result" id="evalResult"></div>
    <div class="eval-toolbar" id="evalToolbar">
      <button class="btn" data-eval="display" title="Shift+Enter, Ctrl+K D, or Ctrl+Enter">Display It</button>
      <button class="btn" data-eval="execute" title="Ctrl+K E">Execute It</button>
      <button class="btn" data-eval="inspect" title="Ctrl+K I">Inspect It</button>
    </div>
  </div>`;
}
