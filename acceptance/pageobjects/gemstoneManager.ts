/**
 * Page Object over the GemStone Manager — the editor-area panel that shows the
 * whole GemStone environment on one screen.
 *
 * Unlike the sidebar views, this one is a webview, so nothing in it is reachable
 * from the workbench page directly: VS Code nests the panel's own document two
 * iframes deep (the `webview` element, then the `active-frame` inside it), and a
 * locator that doesn't cross both finds an empty document rather than failing.
 * `frame` is that crossing, and everything here hangs off it.
 */
import { Page, Locator, FrameLocator, expect } from '@playwright/test';
import { runCommand, touch } from '../helpers/vscode';

/** The `data-section` a heading belongs to — the panel's own key for each. */
const SECTIONS: Record<string, string> = {
  'Operating System': 'os',
  Versions: 'versions',
  Databases: 'databases',
  Connect: 'connect',
};

export class GemstoneManager {
  constructor(private readonly window: Page) {}

  /** The panel's own document, inside VS Code's two nested webview frames. */
  get frame(): FrameLocator {
    return this.window.frameLocator('iframe.webview').frameLocator('iframe#active-frame');
  }

  /** The manager's editor tab — the durable handle on the panel from outside. */
  get tab(): Locator {
    return this.window.getByRole('tab', { name: /GemStone Manager/ });
  }

  /**
   * Open the manager from the command palette, and wait for it to have rendered.
   *
   * Opening it renders twice — once from what is already on disk, then again
   * when the download catalog answers or gives up — and the second render
   * replaces the first wholesale. Nothing here waits that out: what a scenario
   * does to the panel survives a redraw, which is the panel's own contract.
   */
  async open(): Promise<void> {
    await runCommand(this.window, 'GemStone Admin: GemStone Manager');
    await expect(this.tab).toBeVisible();
    await this.frame.locator('details.section').first().waitFor({ timeout: 60_000 });
  }

  /** One of the four sections, whether or not it is expanded. */
  section(title: string): Locator {
    return this.frame.locator(`details.section[data-section="${SECTIONS[title]}"]`);
  }

  /**
   * Expand a section, if it isn't already. Which sections start open follows what
   * needs attention — a settled machine collapses its Operating System section —
   * so a scenario that reads one has to open it as a user would.
   */
  async openSection(title: string): Promise<void> {
    const section = this.section(title);
    await section.waitFor();
    if (await section.evaluate((el) => el.hasAttribute('open'))) return;

    // The title, not the header: a header is a click target its whole width, and
    // a section that carries buttons there would swallow the toggle.
    await touch(section.locator('summary .section-title'));
    await expect(section.locator('.section-body')).toBeVisible();
  }

  /** A prerequisite row in the Operating System checklist, by what it checks. */
  prerequisite(label: string): Locator {
    return this.section('Operating System').locator('li.os-check', { hasText: label });
  }

  /** What the machine reports for a prerequisite — the right-hand column. */
  prerequisiteDetail(label: string): Locator {
    return this.prerequisite(label).locator('.os-check-detail');
  }

  /** A login's row under Connect, found by the user it logs in as. */
  login(user: string): Locator {
    return this.section('Connect').locator('.login-row', { hasText: user });
  }

  /**
   * The way in when the manager cannot see the stone running — which is any
   * stone this machine did not make here, since the process list is read through
   * an installed version and there needn't be one. It starts only what is down,
   * so it is also the way in when the stone is already up.
   */
  startAndLogInButton(user: string): Locator {
    return this.login(user).getByRole('button', { name: 'Start & log in', exact: true });
  }

  /**
   * Offered only on a row that is connected — so it is proof that one is.
   *
   * Scoped to the status cell, where the row says what it is: a connected row
   * also carries the session's own action strip, which offers logging out among
   * the rest, and the two would be one ambiguous match.
   */
  logOutButton(user: string): Locator {
    return this.login(user)
      .locator('.login-status')
      .getByRole('button', { name: 'Log out', exact: true });
  }

  /** The mark on the row whose session Display It and Execute It run in. */
  currentSessionRow(): Locator {
    return this.section('Connect').locator('.login-row-current');
  }
}
