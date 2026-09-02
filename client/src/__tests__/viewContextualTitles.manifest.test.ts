import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// A view moved out of its own container loses the container's name with it, so a pane
// contributed as "Classes" or "Methods" lands next to every other extension's tabs saying
// nothing about whose it is. `contextualTitle` is what VS Code shows there, and it lives
// only in package.json — so it is asserted against the manifest itself, or the next view
// copy-pasted from a neighbour quietly ships without one.

interface View {
  id: string;
  name: string;
  contextualTitle?: string;
}

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
) as { contributes: { views: Record<string, View[]> } };

const allViews = Object.values(manifest.contributes.views).flat();

// The containers Jasper owns outright. A view in one of these is already under a
// "GemStone" / "GemStone Explorer" / "GemStone Search" heading, so its own name stays short.
const OWN_CONTAINERS = ['gemstone', 'gemstoneExplorer', 'gemstoneOmniSearchPanel'];

describe('contributed views name themselves when moved out of their container', () => {
  it.each(allViews.map((v) => [v.id, v] as const))(
    '%s declares a contextual title saying whose it is',
    (_id, view) => {
      expect(view.contextualTitle).toBeDefined();
      expect(view.contextualTitle).toMatch(/^(GemStone|Jasper) /);
    },
  );

  it('names a view in a SHARED container in the name itself, not just the contextual title', () => {
    // Nothing announces the owner of a pane contributed into VS Code's own file Explorer —
    // there is no container heading above it to do the job, so the name has to.
    for (const [container, views] of Object.entries(manifest.contributes.views)) {
      if (OWN_CONTAINERS.includes(container)) continue;
      for (const view of views) {
        expect(view.name).toMatch(/^(GemStone|Jasper) /);
      }
    }
  });
});
