import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const keybindings: Array<{
  command: string;
  key: string;
  mac: string;
  when: string;
}> = pkg.contributes.keybindings;

// The ctrl+k / cmd+k chord family. Other bindings (e.g. the single-key
// Backspace/Escape that dismiss a Display It overlay) are validated separately.
const chordBindings = keybindings.filter((kb) => kb.key?.startsWith('ctrl+k'));

describe('keybindings', () => {
  it('should all use the ctrl+k chord prefix (Windows/Linux)', () => {
    for (const kb of chordBindings) {
      expect(kb.key, `${kb.command} has unexpected key: "${kb.key}"`).toMatch(/^ctrl\+k [a-z]$/);
    }
  });

  it('should all use the cmd+k chord prefix (macOS)', () => {
    for (const kb of chordBindings) {
      expect(kb.mac, `${kb.command} has unexpected mac key: "${kb.mac}"`).toMatch(/^cmd\+k [a-z]$/);
    }
  });

  it('should have matching second keys on both platforms', () => {
    for (const kb of chordBindings) {
      const winKey = kb.key.split(' ')[1];
      const macKey = kb.mac.split(' ')[1];
      expect(winKey).toBe(macKey);
    }
  });

  // The terms of a `when` clause, e.g. "a && !b" -> ["a", "!b"].
  const terms = (when: string): string[] => when.split('&&').map((t) => t.trim());

  // Two clauses that can never both hold, because one requires a key the other forbids.
  const mutuallyExclusive = (a: string, b: string): boolean =>
    terms(a).some((t) => !t.startsWith('!') && terms(b).includes(`!${t}`)) ||
    terms(b).some((t) => !t.startsWith('!') && terms(a).includes(`!${t}`));

  const byLetter = (): Map<string, typeof chordBindings> => {
    const groups = new Map<string, typeof chordBindings>();
    for (const kb of chordBindings) {
      const letter = kb.key.split(' ')[1];
      groups.set(letter, [...(groups.get(letter) ?? []), kb]);
    }
    return groups;
  };

  it('should reuse a second key only for commands that can never both be live', () => {
    // Ctrl+K U is deliberately bound twice: Undo and Revert are the same act under two names
    // (the title-bar tooltip can only carry a fixed string, so the verb needs its own command),
    // and a command with no binding loses the chord from its tooltip. Their conditions are
    // opposites, so exactly one is ever active and the chord is never ambiguous.
    for (const [letter, group] of byLetter()) {
      if (group.length === 1) continue;
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          expect(
            mutuallyExclusive(group[i].when, group[j].when),
            `ctrl+k ${letter}: ${group[i].command} and ${group[j].command} can both be active`,
          ).toBe(true);
        }
      }
    }
  });

  it('should map to expected commands', () => {
    const expected: Record<string, string[]> = {
      d: ['gemstone.displayIt'],
      e: ['gemstone.executeIt'],
      r: ['gemstone.debugIt'],
      i: ['gemstone.inspectIt'],
      b: ['gemstone.openBrowser'],
      c: ['gemstone.findClass'],
      m: ['gemstone.findMethodInClass'],
      // One act, two names: whichever of the two is live for the entry on top of the stack.
      u: ['gemstone.undoLast', 'gemstone.revertLast'],
    };

    for (const kb of chordBindings) {
      const letter = kb.mac.split(' ')[1];
      expect(expected[letter]).toContain(kb.command);
    }
  });

  it('should require active session for all chord bindings', () => {
    for (const kb of chordBindings) {
      expect(kb.when).toContain('gemstone.hasActiveSession');
    }
  });

  it('dismiss-overlay bindings use single keys gated on the overlay context', () => {
    const dismiss = keybindings.filter((kb) => kb.command === 'gemstone.dismissDisplayResult');
    // Backspace, Ctrl+Z (undo), and Escape
    expect(dismiss.map((kb) => kb.key).sort()).toEqual(['backspace', 'ctrl+z', 'escape']);
    for (const kb of dismiss) {
      expect(kb.when).toContain('gemstone.displayResultVisible');
      expect(kb.when).toContain('editorTextFocus');
    }
    // The undo binding maps to cmd+z on macOS
    const undo = dismiss.find((kb) => kb.key === 'ctrl+z');
    expect(undo?.mac).toBe('cmd+z');
  });

  it('expand-in-place binds Enter, gated on the overlay context and not stealing IntelliSense', () => {
    const expand = keybindings.filter((kb) => kb.command === 'gemstone.expandDisplayResultInPlace');
    expect(expand.length).toBe(1);
    expect(expand[0].key).toBe('enter');
    expect(expand[0].when).toContain('gemstone.displayResultVisible');
    expect(expand[0].when).toContain('editorTextFocus');
    // Must not hijack Enter while the suggestion widget is open
    expect(expand[0].when).toContain('!suggestWidgetVisible');
  });

  it('should gate editor commands on editorTextFocus and !executing', () => {
    const editorCommands = [
      'gemstone.displayIt',
      'gemstone.executeIt',
      'gemstone.debugIt',
      'gemstone.inspectIt',
    ];
    const matches = keybindings.filter((kb) => editorCommands.includes(kb.command));
    expect(matches.length).toBeGreaterThan(0);
    for (const kb of matches) {
      expect(kb.when).toContain('editorTextFocus');
      expect(kb.when).toContain('!gemstone.executing');
    }
  });

  it('GemStone Search opens on Ctrl/Cmd+Shift+A, not a notebook run-cell gesture', () => {
    const omni = keybindings.filter((kb) => kb.command === 'gemstone.search');

    expect(omni.length).toBe(1);
    expect(omni[0].key).toBe('ctrl+shift+a');
    expect(omni[0].mac).toBe('cmd+shift+a');
    expect(omni[0].when).toContain('gemstone.hasActiveSession');
    // Must stay off the notebook's own run-cell chords so it never shadows executeAndSelectBelow.
    expect(['ctrl+enter', 'shift+enter', 'alt+enter']).not.toContain(omni[0].key);
  });

  it('inspector welcome text should match the actual inspectIt chord', () => {
    const inspectIt = keybindings.find((kb) => kb.command === 'gemstone.inspectIt');
    expect(inspectIt).toBeDefined();
    const letter = inspectIt!.mac.split(' ')[1].toUpperCase();

    const welcomes: Array<{ view: string; contents: string; when?: string }> =
      pkg.contributes.viewsWelcome;
    const inspectorWelcomes = welcomes.filter((w) => w.view === 'gemstoneInspector');
    expect(inspectorWelcomes.length).toBe(2);

    const mac = inspectorWelcomes.find((w) => w.when === 'isMac');
    const nonMac = inspectorWelcomes.find((w) => w.when === '!isMac');
    expect(mac?.contents).toContain(`Cmd+K ${letter} to inspect`);
    expect(nonMac?.contents).toContain(`Ctrl+K ${letter} to inspect`);
  });
});
