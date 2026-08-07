import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
import * as vscode from 'vscode';
import { RefactorCodeActionProvider } from '../renameRefactorCodeActions';

function docWith(line: string): vscode.TextDocument {
  return {
    getWordRangeAtPosition: (pos: vscode.Position, re: RegExp) => {
      const m = re.exec(line.slice(pos.character));
      return m && m.index === 0
        ? new vscode.Range(pos, new vscode.Position(pos.line, pos.character + m[0].length))
        : undefined;
    },
  } as unknown as vscode.TextDocument;
}

describe('refactor code actions', () => {
  const provider = new RefactorCodeActionProvider();

  it('offers the cursor-on-identifier refactorings when the cursor is on an identifier', () => {
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));

    const actions = provider.provideCodeActions(docWith('total'), range);

    expect(actions.map((a) => a.command?.command)).toEqual([
      'gemstone.explorer.inlineMethod',
      'gemstone.explorer.inlineTemporary',
      'gemstone.rename',
      'gemstone.convertTempToInstVar',
      'gemstone.changeMethodSignature',
    ]);
    // Tagged with Refactor sub-kinds and emitted grouped, so the Refactor… menu
    // separates them into Inline / Rename / other-rewrite sections.
    expect(actions.map((a) => a.kind?.value)).toEqual([
      'refactor.inline',
      'refactor.inline',
      'refactor.rename',
      'refactor.rewrite',
      'refactor.rewrite',
    ]);
    // Each carries the exact position it was offered at, so it acts on the token
    // there rather than wherever the editor selection happens to be.
    for (const action of actions) {
      expect(action.command?.arguments?.[0]).toBe(range.start);
    }
  });

  it('still offers Rename and change-signature when the cursor is not on an identifier', () => {
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));

    const actions = provider.provideCodeActions(docWith('  + 1'), range);

    // Rename… is offered anywhere (on a selector or the method header it renames the
    // method), so it appears even off an identifier.
    expect(actions.map((a) => a.command?.command)).toEqual([
      'gemstone.rename',
      'gemstone.changeMethodSignature',
    ]);
  });

  it('offers the extractions (only) on a selection that does not start on an identifier', () => {
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 5));

    const actions = provider.provideCodeActions(docWith('  1 + 2'), range);

    expect(actions.map((a) => a.command?.command)).toEqual([
      'gemstone.explorer.extractMethod',
      'gemstone.explorer.extractTemporary',
      'gemstone.rename',
      'gemstone.changeMethodSignature',
    ]);
    // The extractions read the editor selection, so they carry no position argument.
    expect(actions[0].command?.arguments).toBeUndefined();
    expect(actions[1].command?.arguments).toBeUndefined();
  });

  it('offers extractions and cursor refactorings on a selection starting on an identifier', () => {
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 5));

    const actions = provider.provideCodeActions(docWith('total foo'), range);

    expect(actions.map((a) => a.command?.command)).toEqual([
      'gemstone.explorer.extractMethod',
      'gemstone.explorer.extractTemporary',
      'gemstone.explorer.inlineMethod',
      'gemstone.explorer.inlineTemporary',
      'gemstone.rename',
      'gemstone.convertTempToInstVar',
      'gemstone.changeMethodSignature',
    ]);
    // Contiguous groups → the Refactor… menu separates Extract / Inline / Rename /
    // other-rewrite.
    expect(actions.map((a) => a.kind?.value)).toEqual([
      'refactor.extract',
      'refactor.extract',
      'refactor.inline',
      'refactor.inline',
      'refactor.rename',
      'refactor.rewrite',
      'refactor.rewrite',
    ]);
  });

  it('advertises the Refactor code-action kind', () => {
    expect(RefactorCodeActionProvider.providedCodeActionKinds).toContain(
      vscode.CodeActionKind.Refactor,
    );
  });
});
