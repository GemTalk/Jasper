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

/**
 * The undo affordances outside the status bar (#434).
 *
 * The status-bar tooltip names the exact change — "GemStone — Revert: Remove class Account
 * (Ctrl+K U)" — because a status-bar item's tooltip is set at runtime. A CONTRIBUTED menu
 * title is a fixed string in `package.json`, so the title-bar icons and the palette entry
 * cannot name the change no matter what. What they can do is choose between two commands on
 * a pair of context keys, so at least the VERB agrees: a class edit is reversed by binding an
 * earlier version, and every affordance has to call that a revert rather than promise an undo.
 *
 * These pin that the pairing is complete and symmetric — one Undo and one Revert wherever the
 * action appears, on the two keys `refreshUndoUi` keeps mutually exclusive, so exactly one is
 * ever visible. Plain BOOLEAN conditions: they are what every other `when` in this manifest
 * uses, and a `when` that compares a key to a quoted string is one syntax question too many
 * for something whose failure mode is an icon that silently never appears.
 */
describe('undo / revert menu contributions', () => {
  it('contributes a command per verb, both with the undo icon', () => {
    expect(command('gemstone.undoLast')).toMatchObject({
      title: 'Undo Last Change… (the status bar names it)',
      category: 'GemStone',
      icon: 'resources/undo.svg',
    });
    expect(command('gemstone.revertLast')).toMatchObject({
      title: 'Revert Last Class Change… (the status bar names it)',
      category: 'GemStone',
      icon: 'resources/undo.svg',
    });
  });

  it.each(['commandPalette', 'view/title', 'editor/title'])(
    'gates each verb on its own boolean key in %s',
    (menu) => {
      const undo = entry(menu, 'gemstone.undoLast');
      const revert = entry(menu, 'gemstone.revertLast');

      expect(undo?.when).toContain('gemstone.undoAvailable');
      expect(revert?.when).toContain('gemstone.revertAvailable');
      // Same placement, so swapping verbs does not move the icon.
      expect(revert?.group).toBe(undo?.group);
    },
  );

  it.each(['view/title', 'editor/title'])(
    'keeps the rest of the %s condition identical between the two',
    (menu) => {
      const undo = entry(menu, 'gemstone.undoLast');
      const revert = entry(menu, 'gemstone.revertLast');

      expect(revert?.when.replace('gemstone.revertAvailable', 'gemstone.undoAvailable')).toBe(
        undo?.when,
      );
    },
  );

  it('shows the editor title-bar icon on any editor, not only a GemStone one', () => {
    // `resourceScheme` is per-editor, so gating on it put the icon on the title bar of GemStone
    // tabs ONLY — look at anything else and the action vanished while the status-bar button was
    // still lit. Availability is the whole condition: the two affordances say the same thing or
    // the user learns to distrust both.
    for (const id of ['gemstone.undoLast', 'gemstone.revertLast']) {
      expect(entry('editor/title', id)?.when).not.toContain('resourceScheme');
    }
  });

  it('states both conditions as plain booleans, never as a quoted comparison', () => {
    // The rest of the manifest never compares a context key to a quoted string; an icon that
    // silently never appears is too quiet a failure to risk being the first place that does.
    for (const menu of ['commandPalette', 'view/title', 'editor/title']) {
      for (const id of ['gemstone.undoLast', 'gemstone.revertLast']) {
        expect(entry(menu, id)?.when).not.toContain("'");
      }
    }
  });

  it('points both titles at the one affordance that CAN name the change', () => {
    // The whole reason two titles exist is that neither can say what it would reverse. Saying
    // where that is written turns a dead end into a pointer.
    for (const id of ['gemstone.undoLast', 'gemstone.revertLast']) {
      expect(command(id)?.title).toContain('the status bar names it');
    }
  });

  it('binds the same chord to both, on mutually exclusive conditions', () => {
    // One chord, always live, and VS Code appends it to a title-bar tooltip only for a command
    // that actually carries a binding -- so both need one or the Revert hover loses the chord
    // the Undo hover shows. The conditions cannot overlap, or the chord is a conflict.
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
