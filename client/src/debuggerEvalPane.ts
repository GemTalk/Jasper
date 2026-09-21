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
 */
export function evaluatePaneHtml(): string {
  return `<div class="evalbar" id="evalbar">
    <div class="eval-tabs" role="tablist">
      <div class="eval-tab" id="evalToggle" data-tab="eval" role="tab" tabindex="0"
           aria-selected="false" title="Evaluate an expression in the selected frame">Evaluate</div>
    </div>
    <span class="eval-input-wrap">
      <textarea id="evalInput" rows="1" autocomplete="off" spellcheck="false"
             placeholder="Evaluate in the selected frame — Enter, or Ctrl+K D · E · I"></textarea>
      <button class="clear-btn" id="evalClear" tabindex="-1" title="Clear">✕</button>
    </span>
    <div class="eval-toolbar" id="evalToolbar">
      <button class="btn" data-eval="display" title="Ctrl+K D">Display It</button>
      <button class="btn" data-eval="execute" title="Ctrl+K E">Execute It</button>
      <button class="btn" data-eval="inspect" title="Ctrl+K I">Inspect It</button>
    </div>
    <div class="eval-result" id="evalResult"></div>
  </div>`;
}
