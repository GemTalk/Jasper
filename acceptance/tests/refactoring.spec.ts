import { test, expect } from '../helpers/vscode';

/**
 * End-to-end coverage for the refactoring UI — the "live F5" layer that unit and
 * GCI tests cannot reach: the Explorer pencil → preview panel → Apply round-trip,
 * driven through a real editor window.
 *
 * STATUS: SCAFFOLD. The steps below are marked `test.fixme` because the concrete
 * webview locators (the preview panel's DOM, the pencil's inline icon) must be
 * captured against a running window — this suite opens a real editor (macOS cannot
 * headless it; use `npm run test:acceptance:docker`), and it further needs a stone
 * with the RB engine installed, which the acceptance container does not yet
 * provision. Finalize by running with a display, filling in the `TODO(selector)`
 * locators from the live DOM, then dropping `test.fixme`. Tracked as the
 * "acceptance E2E for the refactoring UI" hardening item.
 *
 * Coverage to land (mirrors the manual F5 checklist):
 *   1. Rename an instance variable via the Explorer pencil → preview panel shows
 *      the before/after diffs → Apply → the renamed ivar row is revealed.
 *   2. The preview panel renders a strict CSP + nonce (view-source assertion).
 *   3. Class Definition History viewer opens read-only and its Restore works.
 */
test.describe('refactoring UI (Explorer pencil → preview → apply)', () => {
  test.fixme('renames an instance variable end to end', async ({ window }) => {
    // Preconditions: a stone with the RB engine installed and a fixture class
    // carrying an instance variable and a method that reads it.
    await window.getByRole('tab', { name: /GemStone/ }).click();

    // TODO(selector): open the Explorer, select the fixture class, reveal its
    // instance-variable row, and click the inline rename pencil
    // (command gemstone.explorer.renameInstVariable).

    // TODO(selector): in the preview webview, assert the before/after diff for the
    // reading method is shown, then click Apply.

    // TODO(assert): the renamed ivar row is revealed and selected in the Explorer.
    expect(true).toBe(true);
  });

  test.fixme('the preview panel is served with a strict CSP and a nonce', async ({ window }) => {
    await window.getByRole('tab', { name: /GemStone/ }).click();
    // TODO(selector): open any refactoring preview panel and assert its webview
    // HTML carries a Content-Security-Policy meta and a per-open nonce.
    expect(true).toBe(true);
  });
});
