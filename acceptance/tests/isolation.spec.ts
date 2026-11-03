import { test, expect } from '../helpers/vscode';
import { readContainerStone } from '../helpers/containerStone';

// At file scope, so a container run skips before the `window` fixture launches VS Code.
test.skip(
  !!readContainerStone(),
  "the container run points gemstone.rootPath at its stone's install",
);

/**
 * A run must not touch the developer's own machine. The Databases & Versions
 * panel is the tell: if the isolated GemStone root leaked to the real one, its
 * Versions count would include the releases installed locally.
 */
test("does not surface the machine's installed GemStone versions", async ({ window }) => {
  await window.getByRole('tab', { name: /GemStone/ }).click();
  const sidebar = window.locator('.sidebar');
  // A section's title-bar buttons only show while the pointer is over it.
  await sidebar.getByRole('heading', { name: 'Databases' }).hover();
  await sidebar.getByRole('button', { name: 'Manage Databases & Versions' }).click();

  const panel = window.frameLocator('iframe.webview').frameLocator('#active-frame');
  await expect(panel.getByText('0 installed', { exact: true })).toBeVisible();
});
