/**
 * Page Object over VS Code's Integrated Browser (1.109+), which replaced the
 * iframe-based Simple Browser — `simpleBrowser.useIntegratedBrowser` now defers
 * to it, which is why no "Simple Browser: Show" command exists any more.
 *
 * It is a real Chromium WebContents, not a frame of the workbench, so it is its
 * own page in the Electron context and can be driven like any other Playwright
 * page: full DOM, real assertions on what a page actually rendered.
 *
 * That distinction matters, because looking for it the obvious way finds
 * nothing: `window.frames()` is empty, since a separate WebContents is not a
 * frame. Reach it through `context().pages()` instead.
 */
import { Page, expect } from '@playwright/test';
import { runCommand } from '../helpers/vscode';

export class IntegratedBrowser {
  constructor(private readonly window: Page) {}

  /** Open `url` in the editor's browser and answer the page it is showing. */
  async open(url: string): Promise<Page> {
    await runCommand(this.window, 'Browser: Open Integrated Browser');

    const urlBar = this.window.getByRole('textbox', { name: 'Search or enter URL' });
    await urlBar.fill(url);
    await urlBar.press('Enter');

    return await this.pageShowing(url);
  }

  /** The browser's page for `url`, once it turns up in the Electron context. */
  async pageShowing(url: string, timeout = 60_000): Promise<Page> {
    const context = this.window.context();
    let page: Page | undefined;
    await expect
      .poll(
        () => {
          page = context.pages().find((p) => p.url().startsWith(url));
          return page !== undefined;
        },
        { timeout, message: `the integrated browser never opened ${url}` },
      )
      .toBe(true);

    const opened = page as Page;
    await opened.waitForLoadState('domcontentloaded');
    return opened;
  }
}
