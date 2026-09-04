import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

// The ids come from the code that hands them out, so a `when` clause and the
// document it is meant to match cannot drift apart. languageIds.test.ts pins the
// literal strings.
import { METHOD_LANGUAGE, SMALLTALK_LANGUAGE } from '../languageIds';

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

  // Each clause names BOTH Smalltalk language ids. Method editors were split
  // onto gemstone-method so `contributes.breakpoints` could name them alone (see
  // client/src/languageIds.ts); the editor commands are not part of that split
  // and must keep working in a workspace, a .gst file and a method alike.
  it('shows "Display It" in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.displayIt')?.when).toBe(
      `editorTextFocus && (resourceLangId == ${SMALLTALK_LANGUAGE} || resourceLangId == ${METHOD_LANGUAGE}) && !gemstone.executing`,
    );
  });

  it('shows "Inspect It" in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.inspectIt')?.when).toBe(
      `editorTextFocus && (resourceLangId == ${SMALLTALK_LANGUAGE} || resourceLangId == ${METHOD_LANGUAGE}) && !gemstone.executing`,
    );
  });

  it('shows "Execute It" in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.executeIt')?.when).toBe(
      `editorTextFocus && (resourceLangId == ${SMALLTALK_LANGUAGE} || resourceLangId == ${METHOD_LANGUAGE}) && !gemstone.executing`,
    );
  });

  it('shows "Debug It" in gemstone documents when code execution is available', () => {
    expect(getMenuItem('gemstone.debugIt')?.when).toBe(
      `editorTextFocus && (resourceLangId == ${SMALLTALK_LANGUAGE} || resourceLangId == ${METHOD_LANGUAGE}) && !gemstone.executing`,
    );
  });

  it('shows "Senders Of..." in gemstone documents', () => {
    expect(getMenuItem('gemstone.sendersOf')?.when).toBe(
      `editorTextFocus && (resourceLangId == ${SMALLTALK_LANGUAGE} || resourceLangId == ${METHOD_LANGUAGE})`,
    );
  });

  it('shows "Implementors Of..." in gemstone documents', () => {
    expect(getMenuItem('gemstone.implementorsOf')?.when).toBe(
      `editorTextFocus && (resourceLangId == ${SMALLTALK_LANGUAGE} || resourceLangId == ${METHOD_LANGUAGE})`,
    );
  });

  it('shows the breakpoint actions in a method editor ALONE', () => {
    // Unlike the commands above, these five name only the method language. A
    // breakpoint is a step point in a compiled method, so offering "Toggle
    // Breakpoint at Cursor" in a workspace or a .gst file is the same empty
    // invitation the gutter used to make — the click can only ever be refused.
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
        commands.map((c) => [c, `editorTextFocus && resourceLangId == ${METHOD_LANGUAGE}`]),
      ),
    );
  });

  it('reaches Toggle Breakpoint at Cursor from Shift+F9 on the same terms', () => {
    // The keyboard route was gated on the gemstone SCHEME, which also covers a
    // class comment and a class definition — neither of which holds a method.
    const binding = pkg.contributes.keybindings.find(
      (k: { command: string }) => k.command === 'gemstone.breakpoints.toggleAtCursor',
    );

    expect(binding.key).toBe('shift+f9');
    expect(binding.when).toBe(
      `editorTextFocus && resourceLangId == ${METHOD_LANGUAGE} && gemstone.hasActiveSession`,
    );
  });
});
