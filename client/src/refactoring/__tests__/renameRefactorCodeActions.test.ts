import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
import * as vscode from 'vscode';
import {
  REFACTOR_CODE_ACTION_SELECTOR,
  RefactorCodeActionProvider,
} from '../renameRefactorCodeActions';
import { CLASS_COMMENT_LANGUAGE, METHOD_LANGUAGE, SMALLTALK_LANGUAGE } from '../../languageIds';

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
  const provider = new RefactorCodeActionProvider(() => true);

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

  it('offers nothing when the refactoring engine is not installed', () => {
    const gatedOff = new RefactorCodeActionProvider(() => false);
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 5));

    expect(gatedOff.provideCodeActions(docWith('total foo'), range)).toEqual([]);
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

// Which documents get a "Refactor…" menu at all. Every action above runs a
// command that funnels through `resolveMethodEditor`, so anywhere the selector
// reaches beyond a saved, compiled method is a menu that can only decline.
describe('REFACTOR_CODE_ACTION_SELECTOR', () => {
  it('attaches to the source of a compiled method alone', () => {
    expect(REFACTOR_CODE_ACTION_SELECTOR).toEqual({
      scheme: 'gemstone',
      language: METHOD_LANGUAGE,
    });
  });

  it('does not attach to the language every other gemstone:// document carries', () => {
    // A class definition, a new-method template, a new-class template and the
    // read-only override diff view all share SMALLTALK_LANGUAGE behind the same
    // scheme. This registration named that id before the language split, so all
    // four offered the menu, and every action in it declined.
    expect(REFACTOR_CODE_ACTION_SELECTOR.language).not.toBe(SMALLTALK_LANGUAGE);
    expect(REFACTOR_CODE_ACTION_SELECTOR.language).not.toBe(CLASS_COMMENT_LANGUAGE);
  });

  it('names a language rather than matching the whole scheme', () => {
    // A scheme-only filter is how the over-reach happened; naming the language
    // is what keeps the menu where the commands can act.
    expect(REFACTOR_CODE_ACTION_SELECTOR.language).toBeDefined();
  });
});
