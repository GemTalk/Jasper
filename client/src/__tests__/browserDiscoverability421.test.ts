import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Issue #421 — the GemStone Explorer is the browser users should meet first.
 *
 * The classic System Browser had two always-present buttons advertising it: an inline
 * action on every session row, and a `$(book)` status-bar item shown whenever a session
 * was active. Both are gone. The FEATURE is deliberately kept — the command and its
 * Cmd+K B keybinding still open it — so these guard the distinction: no buttons, but
 * still fully reachable for anyone who wants it.
 *
 * The status-bar half is checked by scanning extension.ts, because `activate()` is not
 * unit-exercised (extension.test.ts covers exported helpers only) and standing up enough
 * mocks to run it would cost more than it proves. The scan is precise: `gemstone.openBrowser`
 * must appear exactly once in that file, at its registerCommand — any new wiring, status
 * bar or otherwise, pushes the count up and fails here.
 */

const repoRoot = path.resolve(__dirname, '../../..');

const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
  contributes: {
    commands: { command: string; title: string; icon?: string }[];
    keybindings: { command: string; key: string; mac?: string; when?: string }[];
    menus: Record<string, { command?: string; when?: string; group?: string }[]>;
  };
};

const extensionSource = fs.readFileSync(path.join(repoRoot, 'client/src/extension.ts'), 'utf8');

describe('#421 — the classic System Browser is not advertised with buttons', () => {
  it('contributes no menu entry anywhere for gemstone.openBrowser', () => {
    const entries = Object.entries(manifest.contributes.menus).flatMap(([menu, items]) =>
      items.filter((i) => i.command === 'gemstone.openBrowser').map((i) => ({ menu, ...i })),
    );

    expect(entries).toEqual([]);
  });

  it('wires no status-bar item to it', () => {
    // Exactly one occurrence: the registerCommand. A status-bar item (or any other
    // affordance) referencing the command would add a second.
    const occurrences = extensionSource.split('gemstone.openBrowser').length - 1;

    expect(occurrences).toBe(1);
    expect(extensionSource).toMatch(/registerCommand\('gemstone\.openBrowser'/);
    expect(extensionSource).not.toContain('browserBarItem');
  });

  it('leaves the other status-bar items alone', () => {
    // Guards against the removal having been done by deleting too much: the active-session
    // indicator and its siblings must survive.
    expect(extensionSource).toContain("statusBarItem.command = 'gemstone.selectSession'");
    expect(extensionSource.split('createStatusBarItem').length - 1).toBeGreaterThan(0);
  });
});

describe('#421 — but the System Browser is still fully reachable', () => {
  const command = () => {
    const found = manifest.contributes.commands.find((c) => c.command === 'gemstone.openBrowser');
    if (!found) throw new Error('gemstone.openBrowser is no longer contributed as a command');
    return found;
  };

  it('is still a Command Palette command', () => {
    expect(command().command).toBe('gemstone.openBrowser');
  });

  it('says which browser it opens, so nobody stumbling on it expects the Explorer', () => {
    expect(command().title).toMatch(/classic/i);
    expect(command().title).toMatch(/system browser/i);
  });

  it('keeps its keybinding, gated on there being a session', () => {
    const binding = manifest.contributes.keybindings.find(
      (k) => k.command === 'gemstone.openBrowser',
    );

    expect(binding?.key).toBe('ctrl+k b');
    expect(binding?.mac).toBe('cmd+k b');
    expect(binding?.when).toBe('gemstone.hasActiveSession');
  });

  it('still registers a handler that resolves a session on its own', () => {
    // Invoked from the palette there is no tree item to supply one, so the fallback is
    // what makes the palette route work at all.
    expect(extensionSource).toMatch(
      /registerCommand\('gemstone\.openBrowser',[\s\S]{0,200}resolveSession\(\)/,
    );
  });
});

describe('#421 — documentation points at the Explorer', () => {
  const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

  /** Every contributed setting as [key, schema], flattening the one-or-many sections shape. */
  const settingsEntries = (): [string, unknown][] => {
    const configuration = (
      JSON.parse(read('package.json')) as { contributes: { configuration: unknown } }
    ).contributes.configuration;
    const sections = (Array.isArray(configuration) ? configuration : [configuration]) as {
      properties?: Record<string, unknown>;
    }[];
    return sections.flatMap((s) => Object.entries(s.properties ?? {}));
  };

  it('the onboarding walkthrough sends users to the Explorer', () => {
    const walkthrough = read('resources/walkthrough/inspectIt.md');

    expect(walkthrough).toMatch(/GemStone Explorer/);
    expect(walkthrough).not.toMatch(/System Browser/);
  });

  it('the "Welcome to GemStone Smalltalk" tutorial does too', () => {
    const tutorial = read('client/src/tutorialNotebook.ts');

    expect(tutorial).toMatch(/Browse and edit the image in the \*\*GemStone Explorer\*\*/);
    expect(tutorial).not.toMatch(/Browse the image in the \*\*System Browser\*\*/);
  });

  it('both welcome surfaces say WHERE the Explorer is, not just its name', () => {
    // The Explorer is its own activity-bar container, NOT one of the GemStone sidebar
    // views — so naming it without a location sends a new user hunting in the wrong
    // sidebar. Redirecting the browser mentions is only useful if the destination is
    // findable.
    for (const rel of ['resources/walkthrough/inspectIt.md', 'client/src/tutorialNotebook.ts']) {
      expect(read(rel), `${rel} names the Explorer without saying where to find it`).toMatch(
        /activity bar/i,
      );
    }
  });

  it('the Explorer really is a separate activity-bar container, as the docs claim', () => {
    const containers = (
      JSON.parse(read('package.json')) as {
        contributes: { viewsContainers: Record<string, { id: string; title: string }[]> };
      }
    ).contributes.viewsContainers.activitybar;

    // If the Explorer is ever folded into the GemStone container, the wording above
    // becomes wrong and should fail here rather than mislead a newcomer.
    expect(containers.map((c) => c.id)).toContain('gemstoneExplorer');
    expect(containers.find((c) => c.id === 'gemstoneExplorer')?.title).toBe('GemStone Explorer');
  });

  it('the README documents the Explorer, and frames the browser as the older option', () => {
    const readme = read('README.md');

    expect(readme).toMatch(/^### GemStone Explorer$/m);
    // The Explorer section must come first — it is what a reader should find.
    expect(readme.indexOf('### GemStone Explorer')).toBeLessThan(
      readme.indexOf('### System Browser'),
    );
    expect(readme).not.toMatch(/\*\*Open Browser\*\* — launch the System Browser/);
  });

  it('no setting description routes users to the System Browser', () => {
    for (const [key, value] of settingsEntries()) {
      const text = JSON.stringify(value);
      expect(text, `setting ${key} still routes users to the System Browser`).not.toMatch(
        /edit via the System Browser/i,
      );
    }
  });

  it('no setting whose effect is wider than the browser describes itself as browser-only', () => {
    // gemstone.maxEnvironment said "to show in the browser" while six modules read it —
    // systemBrowser, gemstoneExplorer, extension, and the hover / CodeLens / definition
    // providers — so it read as irrelevant to anyone using the Explorer. A description that
    // says "the browser" and nothing else is the shape of that bug, so it is what's pinned.
    for (const [key, value] of settingsEntries()) {
      const description = String(
        (value as { description?: string; markdownDescription?: string }).description ??
          (value as { markdownDescription?: string }).markdownDescription ??
          '',
      );
      if (!/browser/i.test(description)) continue;
      expect(description, `setting ${key} mentions the browser but not the Explorer`).toMatch(
        /Explorer/i,
      );
    }
  });
});
