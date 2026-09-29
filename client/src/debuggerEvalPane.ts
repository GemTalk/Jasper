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
 * This markup carries NO key wording — no placeholder, no tooltip naming a chord. Those are written
 * on at load by `EvaluatePane.applyLabels` (client/src/webview/evaluatePane.js), which the
 * Inspector's evaluate tab calls too, so one function is the only place either pane's keys are
 * spelled out. Only the webview knows which platform it is on, and a legend baked in here said
 * `Ctrl` on a Mac while the half of the pane that derived its own said `Cmd`. The box keeps its
 * `eval-input` class for that call to find it — the same class the Inspector's box carries.
 */
export function evaluatePaneHtml(): string {
  return `<div class="evalbar" id="evalbar">
    <div class="eval-tabs" role="tablist">
      <div class="eval-tab" id="evalToggle" data-tab="eval" role="tab" tabindex="0"
           aria-selected="false" title="Evaluate an expression in the selected frame">Evaluate</div>
    </div>
    <span class="eval-input-wrap">
      <textarea class="eval-input" id="evalInput" rows="1" autocomplete="off"
             spellcheck="false"></textarea>
      <button class="clear-btn" id="evalClear" tabindex="-1" title="Clear">✕</button>
    </span>
    <!-- The answer sits immediately beside the expression it came from, sharing the row half and
         half, and the buttons go last. Putting the toolbar between them pushed the answer to the far
         end of the row, a full button-set away from the thing that produced it — you read the
         expression on the left and then had to jump the width of three buttons to find what it
         said. -->
    <div class="eval-result" id="evalResult"></div>
    <div class="eval-toolbar" id="evalToolbar">
      <button class="btn" data-eval="display">Display It</button>
      <button class="btn" data-eval="execute">Execute It</button>
      <button class="btn" data-eval="inspect">Inspect It</button>
    </div>
  </div>`;
}
