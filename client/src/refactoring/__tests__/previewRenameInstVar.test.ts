import { describe, it, expect, vi } from 'vitest';
import { startRenameInstVarPreview } from '../queries/previewRenameInstVar';

describe('startRenameInstVarPreview query', () => {
  it('drives the server-side refactoring engine and returns its tokenised JSON preview', () => {
    const execute = vi.fn().mockReturnValue('{"token":"tok1","changes":[{"id":"1"}]}');

    const result = startRenameInstVarPreview(execute, 'Account', 'balance', 'amount', 'tok1');

    expect(result).toBe('{"token":"tok1","changes":[{"id":"1"}]}');
    const code = execute.mock.calls[0][0];
    expect(code).toContain('GsRenameInstanceVariableRefactoring');
    expect(code).toContain("renameInstVar: 'balance'");
    expect(code).toContain("to: 'amount'");
    expect(code).toContain("startPreviewToken: 'tok1'");
  });

  it('resolves the class as a global when no dictionary is given', () => {
    const execute = vi.fn().mockReturnValue('[]');

    startRenameInstVarPreview(execute, 'Account', 'balance', 'amount', 'tok1');

    const code = execute.mock.calls[0][0];
    expect(code).toContain("objectNamed: #'Account'");
    expect(code).not.toContain('symbolList at:');
  });

  it('scopes the class lookup to a dictionary index when given', () => {
    const execute = vi.fn().mockReturnValue('[]');

    startRenameInstVarPreview(execute, 'Account', 'balance', 'amount', 'tok1', 3);

    const code = execute.mock.calls[0][0];
    expect(code).toContain('(System myUserProfile symbolList at: 3)');
  });

  it('escapes single quotes in the variable names', () => {
    const execute = vi.fn().mockReturnValue('[]');

    // Not a real ivar name, but the builder must never break the string literal.
    startRenameInstVarPreview(execute, 'Account', "od'd", "ne'w", 'tok1');

    const code = execute.mock.calls[0][0];
    expect(code).toContain("renameInstVar: 'od''d'");
    expect(code).toContain("to: 'ne''w'");
  });

  it('guards against a missing class before invoking the engine', () => {
    const execute = vi.fn().mockReturnValue('[]');

    startRenameInstVarPreview(execute, 'Account', 'balance', 'amount', 'tok1');

    const code = execute.mock.calls[0][0];
    expect(code).toContain('cls isNil ifTrue:');
  });
});
