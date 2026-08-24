/**
 * Steps for the GemStone Manager chapter.
 *
 * The per-step hooks (ringing, screenshots) are registered once in
 * rowan.steps.ts and apply to every scenario in the project, so there are none
 * here — a second registration would photograph each step twice.
 */
import { createBdd } from 'playwright-bdd';
import { test, expect, touch, mark, shows } from '../helpers/vscode';
import { GemstoneManager } from '../pageobjects/gemstoneManager';

const { Given, When, Then } = createBdd(test);

When('I open the GemStone Manager', async ({ window }) => {
  await new GemstoneManager(window).open();
});

Given('the GemStone Manager is open', async ({ window }) => {
  await new GemstoneManager(window).open();
});

Then('it has a(n) {string} section', async ({ window }, title: string) => {
  await shows(new GemstoneManager(window).section(title));
});

// A section a user has to open is a section they can read: which ones start
// expanded follows what needs attention, so this is the click a settled machine
// asks for rather than a workaround.
When('I open the {string} section', async ({ window }, title: string) => {
  await new GemstoneManager(window).openSection(title);
});

Then('shared memory is listed as a prerequisite', async ({ window }) => {
  await shows(new GemstoneManager(window).prerequisite('Shared memory'));
});

// The reading comes from the machine itself — sysctl for the limit, ipcs for
// what is already held — so this asserts the shape of an answer rather than a
// figure, which would only pin whatever the container happened to be given.
Then('it says how much this machine has', async ({ window }) => {
  const detail = await mark(new GemstoneManager(window).prerequisiteDetail('Shared memory'));

  await expect(detail).toHaveText(/\d+(\.\d+)?\s*(B|KB|MB|GB|TB)/);
});

Then('{word} is listed under Connect', async ({ window }, user: string) => {
  await shows(new GemstoneManager(window).login(user));
});

When("I start {word}'s stone and log in", async ({ window }, user: string) => {
  const manager = new GemstoneManager(window);

  await touch(manager.startAndLogInButton(user));

  // Logging in offers to install enhanced inspector support — a modal that
  // blocks the window until answered. Decline: it commits classes to the
  // database over a SystemUser login, which has nothing to do with this screen.
  const inspectorOffer = window.getByRole('button', { name: 'Never', exact: true });
  if (await inspectorOffer.count()) await touch(inspectorOffer);
});

// Log out is offered only on a row that is connected, so its arrival is the
// panel having noticed the session — the redraw, not just the login.
Then('the manager offers to log {word} out again', async ({ window }, user: string) => {
  const logOut = new GemstoneManager(window).logOutButton(user);

  await expect(logOut).toBeVisible({ timeout: 60_000 });
  await mark(logOut);
});

// Logging in makes the new session the one the editor works through, and the
// row says which that is — the reason to connect from here rather than anywhere
// else is that the screen goes on telling you where you are.
Then('the session it opened is the one the editor works in', async ({ window }) => {
  await shows(new GemstoneManager(window).currentSessionRow());
});
