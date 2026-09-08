import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

interface Command {
  command: string;
  title: string;
  category?: string;
  icon?: string;
}
interface MenuItem {
  command: string;
  when: string;
  group?: string;
}

const commands: Command[] = pkg.contributes.commands;
const menus: Record<string, MenuItem[]> = pkg.contributes.menus;

const command = (id: string): Command | undefined => commands.find((c) => c.command === id);
const entry = (menu: string, id: string): MenuItem | undefined =>
  menus[menu].find((m) => m.command === id);
const placements = (id: string): string[] =>
  Object.entries(menus)
    .filter(([, items]) => items.some((m) => m.command === id))
    .map(([menu]) => menu);

/**
 * The undo affordances the MANIFEST contributes (#434).
 *
 * There is one Undo BUTTON, and it is not here: it is a button in the Explorer's Actions &
 * Navigation pane, drawn by `explorerNavigationView` and covered by that module's tests. It
 * got there on the review of #507, which found three of the five affordances that existed —
 * a status-bar item, an icon on the Methods pane title bar, one on the editor title bar, the
 * palette entry and the toast — and asked for a single button instead.
 *
 * The pane's button is a webview button, which is what makes it the right one to keep: it
 * writes its own tooltip, so it can name the verb AND the change. A CONTRIBUTED entry's
 * title is a fixed string in `package.json` and can never do that, which is why the two
 * commands still exist — the palette and the keybinding have no other way to say "Revert"
 * for a class edit, so there is one command per verb, gated on a pair of context keys that
 * `refreshUndoUi` keeps mutually exclusive.
 *
 * What these pin, then, is that the manifest offers the verbs through the PALETTE and the
 * CHORD only, and that no icon placement has crept back in.
 */
describe('undo / revert menu contributions', () => {
  it('contributes a command per verb, each naming its own verb', () => {
    expect(command('gemstone.undoLast')).toMatchObject({
      title: 'Undo Last Change…',
      category: 'GemStone',
    });
    expect(command('gemstone.revertLast')).toMatchObject({
      title: 'Revert Last Class Change…',
      category: 'GemStone',
    });
  });

  it('no longer points either title at an affordance that names the change', () => {
    // The titles used to end "(the status bar names it)", because neither could say what it
    // would reverse and the status-bar tooltip was the only place that could. The status bar
    // is gone, and it is no longer needed as a pointer: the pane's button names the change in
    // its tooltip, and the confirmation the dispatcher now raises names it before acting.
    for (const id of ['gemstone.undoLast', 'gemstone.revertLast']) {
      expect(command(id)?.title).not.toContain('status bar');
    }
  });

  it('carries no icon, since nothing in the manifest renders one', () => {
    // Both wore `resources/undo.svg` for the two title-bar placements. Those are gone, and
    // the palette does not draw command icons, so an icon here would be an asset kept alive
    // by nothing. The glyph lives inline in the pane instead, where it can take its colour
    // from the theme rather than having purple baked into the file.
    for (const id of ['gemstone.undoLast', 'gemstone.revertLast']) {
      expect(command(id)?.icon).toBeUndefined();
    }
    expect(JSON.stringify(pkg.contributes)).not.toContain('undo.svg');
  });

  it('offers both verbs in the palette and nowhere else', () => {
    // One button, in the pane. A title-bar icon creeping back in is exactly the regression
    // the review asked to be rid of, so the placement list is asserted whole.
    expect(placements('gemstone.undoLast')).toEqual(['commandPalette']);
    expect(placements('gemstone.revertLast')).toEqual(['commandPalette']);
  });

  it('gates each verb on its own boolean key in the palette', () => {
    const undo = entry('commandPalette', 'gemstone.undoLast');
    const revert = entry('commandPalette', 'gemstone.revertLast');

    expect(undo?.when).toContain('gemstone.undoAvailable');
    expect(revert?.when).toContain('gemstone.revertAvailable');
  });

  it('states both conditions as plain booleans, never as a quoted comparison', () => {
    // The rest of the manifest never compares a context key to a quoted string; an entry that
    // silently never appears is too quiet a failure to risk being the first place that does.
    for (const id of ['gemstone.undoLast', 'gemstone.revertLast']) {
      expect(entry('commandPalette', id)?.when).not.toContain("'");
    }
  });

  it('binds the same chord to both, on mutually exclusive conditions', () => {
    // One chord, always live. The conditions cannot overlap, or the chord is a conflict.
    const bound: { command: string; key: string; when: string }[] =
      pkg.contributes.keybindings.filter(
        (k: { command: string }) =>
          k.command === 'gemstone.undoLast' || k.command === 'gemstone.revertLast',
      );

    expect(bound).toHaveLength(2);
    expect(new Set(bound.map((k) => k.key))).toEqual(new Set(['ctrl+k u']));
    expect(bound.find((k) => k.command === 'gemstone.undoLast')?.when).toBe(
      'gemstone.hasActiveSession && !gemstone.revertAvailable',
    );
    expect(bound.find((k) => k.command === 'gemstone.revertLast')?.when).toBe(
      'gemstone.hasActiveSession && gemstone.revertAvailable',
    );
  });

  it('keeps the chord live when there is nothing to reverse', () => {
    // With no entry both keys are false, so the Undo binding wins and the user gets the
    // "there is nothing to undo" refusal rather than a chord that does nothing at all.
    const undo = pkg.contributes.keybindings.find(
      (k: { command: string }) => k.command === 'gemstone.undoLast',
    );

    expect(undo.when).toContain('!gemstone.revertAvailable');
  });

  it('does not leave a stray gemstone.undoVerb condition behind', () => {
    expect(JSON.stringify(pkg.contributes)).not.toContain('gemstone.undoVerb');
  });
});
