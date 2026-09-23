/**
 * The three things an evaluate pane can do with an expression.
 *
 * Shared by the Inspector's evaluate tab and the debugger's evaluate pane so the two panels cannot
 * drift apart in what a gesture means. It is the host-side half of that sharing; the webview half —
 * the keys, the chord, the expression history the arrows walk, and the wording of all three — is
 * webview/evaluatePane.js, which both panels inject.
 *
 * The modes: Display It shows the printString, Execute It runs it for its effect without printing an
 * answer, and Inspect It opens the answer in an Inspector. They are named
 * after — and bound to — the editor's own `ctrl+k d` / `e` / `i`, so the keys that run an expression
 * against the stone are the same whether it was typed in a Smalltalk file, against an inspected
 * object, or in a stack frame.
 *
 * Debug It is deliberately absent. It works by compiling the expression and starting it with the
 * single-step flag set so the halt carries a process for a debugger to attach to; neither pane has a
 * halted process to hand over, so the key would have nothing to open.
 */
export type EvalMode = 'display' | 'execute' | 'inspect';
