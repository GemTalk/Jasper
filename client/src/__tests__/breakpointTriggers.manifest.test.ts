import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const extensionSource = fs.readFileSync(path.resolve(__dirname, '..', 'extension.ts'), 'utf-8');

interface Command {
  command: string;
  title: string;
  category?: string;
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

const AT_CURSOR = 'gemstone.breakpoints.editTriggerAtCursor';
const FROM_ROW = 'gemstone.breakpoints.editTrigger';

/**
 * What the MANIFEST has to offer for triggered breakpoints.
 *
 * Jasper cannot reuse VS Code's own *Add Triggered Breakpoint*: `vscode.Breakpoint`
 * exposes no trigger relationship in any API version, and VS Code arms one inside a
 * live debug session, which a Jasper run does not have. Nor can that gutter item be
 * removed — it belongs to VS Code's core debug UI, hung off the `breakpoints`
 * contribution that gives Jasper a gutter at all. So these two commands are the ONLY
 * way to reach the feature, and a missing contribution here makes it unreachable
 * rather than merely awkward.
 */
describe('triggered breakpoints: what the manifest offers', () => {
  it('declares both commands under the GemStone category', () => {
    expect(command(AT_CURSOR)?.title).toBe('Edit Breakpoint Trigger at Cursor');
    expect(command(AT_CURSOR)?.category).toBe('GemStone');
    expect(command(FROM_ROW)?.title).toBe('Break Only After…');
    expect(command(FROM_ROW)?.category).toBe('GemStone');
  });

  it('puts the cursor command in the method editor, beside the condition one', () => {
    const mine = entry('editor/context', AT_CURSOR);
    expect(mine?.when).toBe('editorTextFocus && resourceLangId == gemstone-method');
    // The same breakpoint group as Edit Condition, and after it: the two answer
    // the same question about the breakpoint under the caret.
    const condition = entry('editor/context', 'gemstone.breakpoints.editConditionAtCursor');
    expect(mine?.group?.split('@')[0]).toBe(condition?.group?.split('@')[0]);
    expect(Number(mine?.group?.split('@')[1])).toBeGreaterThan(
      Number(condition?.group?.split('@')[1]),
    );
  });

  it('puts the row command inline on a GemStone Breakpoints row', () => {
    expect(entry('view/item/context', FROM_ROW)?.when).toBe(
      'view == gemstoneBreakpoints && viewItem == gemstoneBreakpoint',
    );
    expect(entry('view/item/context', FROM_ROW)?.group).toMatch(/^inline@/);
  });

  it('gives every breakpoint entry in the editor menu its own slot', () => {
    // Entries sharing a group index render in an order VS Code picks. Three of
    // these were tied on @4 at one point, which is how a menu silently reshuffles
    // between builds.
    const slots = menus['editor/context']
      .filter((m) => m.group?.startsWith('3_gemstoneBreakpoints'))
      .map((m) => m.group);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('puts the trigger entry directly after the condition entry', () => {
    const slot = (id: string): number =>
      Number(menus['editor/context'].find((m) => m.command === id)?.group?.split('@')[1]);
    expect(slot(AT_CURSOR)).toBe(slot('gemstone.breakpoints.editConditionAtCursor') + 1);
  });

  it('orders the row actions, with Remove last', () => {
    // Two inline actions sharing a group index leave their order to VS Code,
    // which is how the trigger action first landed on top of Remove — a
    // destructive button moving under the pointer is the one to keep pinned.
    const inlineOrder = menus['view/item/context']
      .filter((m) => m.when.includes('viewItem') && m.group?.startsWith('inline'))
      .filter((m) => m.when.includes('gemstoneBreakpoints'))
      .map((m) => [m.command, m.group] as const);
    const index = (id: string): number =>
      Number(inlineOrder.find(([c]) => c === id)?.[1]?.split('@')[1]);

    expect(index('gemstone.breakpoints.editCondition')).toBeLessThan(index(FROM_ROW));
    expect(index(FROM_ROW)).toBeLessThan(index('gemstone.breakpoints.remove'));
  });

  it('hides the row command from the Command Palette', () => {
    // It takes a tree node; from the palette it would arrive with undefined.
    expect(entry('commandPalette', FROM_ROW)?.when).toBe('false');
    // The cursor one works from the palette, so it is NOT hidden.
    expect(entry('commandPalette', AT_CURSOR)).toBeUndefined();
  });

  it('registers a handler for each declared command', () => {
    // A command in the manifest with nothing behind it fails at the click with
    // "command not found", which reads as the feature being broken.
    expect(extensionSource).toContain(`registerCommand('${AT_CURSOR}'`);
    expect(extensionSource).toContain(`registerCommand('${FROM_ROW}'`);
  });
});
