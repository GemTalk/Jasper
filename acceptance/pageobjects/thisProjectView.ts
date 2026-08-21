/**
 * Page Object over the "This Project" view — the disk-first package list Jasper
 * contributes to the Explorer when the open folder is a Rowan project. Read
 * straight from the Tonel source; no stone required.
 */
import { Page, Locator, expect } from '@playwright/test';
import { touch } from '../helpers/vscode';

export class ThisProjectView {
  constructor(private readonly page: Page) {}

  private get sidebar(): Locator {
    return this.page.locator('.sidebar');
  }

  /** Show the Explorer and expand the Rowan ("This Project") pane. */
  async open(): Promise<void> {
    // No reload needed: the folder has rowan/project.ston, so the extension
    // activates via `workspaceContains` and sets gemstone.workspaceIsRowanProject
    // at startup — the Explorer's "This Project" (Rowan) section is present from
    // the first paint. (Reloading re-runs activation and briefly clears the
    // context key, which flips the section back to a "Create Rowan Project"
    // welcome mid-transition — a race we avoid by never reloading.)
    //
    // The activity bar has "Explorer" and "GemStone" — anchor to the file
    // Explorer, then confirm it's the active sidebar by waiting for a
    // GemStone-only section ("Versions") to disappear. The GemStone sidebar has
    // its own "Rowan Section" pane, so until the switch settles the match below
    // would be ambiguous.
    //
    // Note that Versions is also hidden whenever no session is connected, so
    // this wait only proves the sidebar switched when one is.
    await touch(this.page.getByRole('tab', { name: /^Explorer/ }));
    await expect(this.sidebar.getByRole('button', { name: 'Versions Section' })).toBeHidden({
      timeout: 30_000,
    });
    // The pane header carries the project name as its description, so its
    // accessible name is "Rowan - <Project> Section" (e.g. "Rowan - DemoLibrary
    // Section"). Match the "Rowan" prefix rather than the project name.
    const header = this.sidebar.getByRole('button', { name: /^Rowan\b/ });
    await header.waitFor({ timeout: 30_000 });
    await header.scrollIntoViewIfNeeded();
    if ((await header.getAttribute('aria-expanded')) === 'false') {
      await touch(header);
    }
  }

  /** A package row by its visible name (the label; its accessible name is a path). */
  package(name: string): Locator {
    return this.sidebar.getByRole('treeitem').filter({ hasText: name });
  }

  /** A dependency row under the Dependencies group, by the project's name. */
  dependency(name: string): Locator {
    return this.sidebar.getByRole('treeitem').filter({ hasText: name });
  }

  /** Add a dependency via the view's "+" action: enter a git URL or directory. */
  async addDependency(input: string): Promise<void> {
    await touch(this.sidebar.getByRole('button', { name: /Add Dependency/i }));
    await this.page.locator('.quick-input-widget input').waitFor();
    await this.page.keyboard.type(input);
    await this.page.keyboard.press('Enter');
  }
}
