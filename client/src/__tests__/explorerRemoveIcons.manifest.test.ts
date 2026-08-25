import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The Explorer's destructive row actions all read as the same gesture, so they all carry
 * the same icon. Removing a method, a class or a dictionary always used the trash can;
 * the two variable removals used `$(remove)` — a minus sign, which reads as "take out of
 * this list" rather than "delete this" and made the variable rows look like a different
 * kind of action than the rows above them.
 *
 * This is a manifest-only choice with no code behind it, so nothing else would catch a
 * regression: the icon is a string in package.json, and a change to it is invisible to
 * every other test.
 */

interface Command {
  command: string;
  title?: string;
  icon?: string;
}

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf-8'),
);
const commands: Command[] = pkg.contributes.commands;

// Every Explorer action whose point is that something goes away.
const DESTRUCTIVE = [
  'gemstone.explorer.removeMethod',
  'gemstone.explorer.removeClass',
  'gemstone.explorer.removeDictionary',
  'gemstone.explorer.removeInstVar',
  'gemstone.explorer.removeClassVar',
] as const;

describe('Explorer destructive row actions', () => {
  for (const id of DESTRUCTIVE) {
    it(`shows ${id} with the trash can`, () => {
      const command = commands.find((c) => c.command === id);

      expect(command).toBeDefined();
      expect(command?.icon).toBe('$(trash)');
    });
  }

  it('leaves no Explorer removal on the minus sign', () => {
    const onMinus = commands.filter(
      (c) => c.command.startsWith('gemstone.explorer.remove') && c.icon === '$(remove)',
    );

    expect(onMinus.map((c) => c.command)).toEqual([]);
  });
});
