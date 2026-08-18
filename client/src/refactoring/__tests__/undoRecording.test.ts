import { describe, it, expect } from 'vitest';
import { recordedApplyExpr } from '../queries/undoRecording';

/**
 * The recorded-apply expression (#434) is the single seam between every method-only
 * refactoring and the undo record, so its two guarantees are pinned here:
 *
 *  1. it still performs the engine's own apply, unchanged, on a stone whose
 *     refactoring engine predates undo — reached through `objectNamed:` so the doit
 *     COMPILES there rather than failing the apply outright;
 *  2. everything the user typed reaches the stone escaped.
 */
describe('recordedApplyExpr', () => {
  it('routes the apply through GsRefactoringUndo, carrying engine, ids and label', () => {
    const code = recordedApplyExpr('GsMoveMethodRefactoring', 'tok1', ['3', '5'], 'Move #foo');
    expect(code).toContain('#recordAndApplyForToken:engine:deselected:label:');
    expect(code).toContain("with: 'tok1'");
    expect(code).toContain("with: 'GsMoveMethodRefactoring'");
    expect(code).toContain("with: #('3' '5')");
    expect(code).toContain("with: 'Move #foo'");
  });

  it('keeps the engine own apply as the fallback for a stone without the undo class', () => {
    const code = recordedApplyExpr('GsMoveMethodRefactoring', 'tok1', ['3'], 'x');
    expect(code).toContain('objectNamed: #GsRefactoringUndo');
    expect(code).toContain(
      "ifTrue: [GsMoveMethodRefactoring applyForToken: 'tok1' deselected: #('3')]",
    );
  });

  it('never names GsRefactoringUndo directly, so the doit compiles on an older engine', () => {
    const code = recordedApplyExpr('GsInlineMethodRefactoring', 't', [], 'x');
    // The only occurrence may be the symbol literal handed to objectNamed:.
    expect(code.replace('#GsRefactoringUndo', '')).not.toContain('GsRefactoringUndo');
  });

  it('escapes single quotes in the token, the ids and the label', () => {
    const code = recordedApplyExpr('GsX', "to'k", ["i'd"], "Rename #it's");
    expect(code).toContain("'to''k'");
    expect(code).toContain("'i''d'");
    expect(code).toContain("'Rename #it''s'");
  });

  it('emits an empty literal array for an all-or-nothing apply', () => {
    expect(recordedApplyExpr('GsX', 't', [], 'x')).toContain('with: #()');
  });
});
