import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

interface MenuItem {
  command: string;
  when: string;
  group: string;
}

const editorContext: MenuItem[] = pkg.contributes.menus['editor/context'];

function getMenuItem(command: string): MenuItem | undefined {
  return editorContext.find((item) => item.command === command);
}

describe('editor/context menu', () => {
  it('contributes the GemStone editor-context actions', () => {
    const commands = editorContext.map((item) => item.command);

    expect(commands).toEqual([
      'gemstone.displayIt',
      'gemstone.inspectIt',
      'gemstone.executeIt',
      'gemstone.debugIt',
      'gemstone.runInNewGem',
      'gemstone.sendersOf',
      'gemstone.implementorsOf',
      'gemstone.methodHistoryFromEditor',
      'gemstone.breakpoints.toggleAtCursor',
      'gemstone.breakpoints.enableAtCursor',
      'gemstone.breakpoints.disableAtCursor',
      'gemstone.breakpoints.clearMethod',
      'gemstone.breakpoints.toggleStepPoints',
    ]);
  });

  it('does not add the RB refactorings as top-level context items (they live under Refactor…)', () => {
    const commands = editorContext.map((item) => item.command);

    expect(commands).not.toContain('gemstone.explorer.extractMethod');
    expect(commands).not.toContain('gemstone.explorer.inlineMethod');
    expect(commands).not.toContain('gemstone.explorer.extractTemporary');
    expect(commands).not.toContain('gemstone.explorer.inlineTemporary');
  });

  it('shows "Display It" in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.displayIt')?.when).toBe(
      `editorTextFocus && resourceLangId == gemstone-smalltalk && !gemstone.executing`,
    );
  });

  it('shows "Inspect It" in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.inspectIt')?.when).toBe(
      `editorTextFocus && resourceLangId == gemstone-smalltalk && !gemstone.executing`,
    );
  });

  it('shows "Execute It" in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.executeIt')?.when).toBe(
      `editorTextFocus && resourceLangId == gemstone-smalltalk && !gemstone.executing`,
    );
  });

  it('shows "Debug It" in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.debugIt')?.when).toBe(
      `editorTextFocus && resourceLangId == gemstone-smalltalk && !gemstone.executing`,
    );
  });

  it('shows "Senders Of..." in gemstone documents', () => {
    expect(getMenuItem('gemstone.sendersOf')?.when).toBe(
      `editorTextFocus && resourceLangId == gemstone-smalltalk`,
    );
  });

  it('shows "Implementors Of..." in gemstone documents', () => {
    expect(getMenuItem('gemstone.implementorsOf')?.when).toBe(
      `editorTextFocus && resourceLangId == gemstone-smalltalk`,
    );
  });

  it('shows the breakpoint actions in gemstone documents', () => {
    const commands = [
      'gemstone.breakpoints.toggleAtCursor',
      'gemstone.breakpoints.enableAtCursor',
      'gemstone.breakpoints.disableAtCursor',
      'gemstone.breakpoints.clearMethod',
      'gemstone.breakpoints.toggleStepPoints',
    ];
    // Compared as a map so a mismatch names the offending command itself.
    expect(Object.fromEntries(commands.map((c) => [c, getMenuItem(c)?.when]))).toEqual(
      Object.fromEntries(
        commands.map((c) => [c, `editorTextFocus && resourceLangId == gemstone-smalltalk`]),
      ),
    );
  });

  it('shows "Method History…" only when a method editor is active', () => {
    expect(getMenuItem('gemstone.methodHistoryFromEditor')?.when).toBe(
      'gemstone.methodEditorActive',
    );
  });
});

describe('Method History in-editor entry points', () => {
  interface MenuItem {
    command: string;
    when: string;
    group?: string;
  }
  const cmd = 'gemstone.methodHistoryFromEditor';

  it('puts a history button in the editor title bar, gated to method editors', () => {
    const titleItems: MenuItem[] = pkg.contributes.menus['editor/title'] ?? [];
    const item = titleItems.find((i) => i.command === cmd);
    expect(item?.when).toBe('gemstone.methodEditorActive');
  });

  it('carries the history icon so the title-bar entry renders as a button', () => {
    const command = pkg.contributes.commands.find(
      (c: { command: string; icon?: string }) => c.command === cmd,
    );
    expect(command?.icon).toBe('$(history)');
  });

  it('appears in the command palette only when a method editor is active', () => {
    const palette: MenuItem[] = pkg.contributes.menus.commandPalette ?? [];
    const item = palette.find((i) => i.command === cmd);
    expect(item?.when).toBe('gemstone.methodEditorActive');
  });
});
