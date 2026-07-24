import { describe, it, expect, vi } from 'vitest';
import {
  startRenameClassVarPreview,
  pageRenameClassVarPreview,
  applyRenameClassVar,
  clearRenameClassVarPreview,
} from '../queries/previewRenameClassVar';

describe('previewRenameClassVar queries', () => {
  it('builds a start-preview that renames the class variable and starts the token', async () => {
    const execute = vi.fn().mockResolvedValue('{}');

    await startRenameClassVarPreview(execute, 'Account', 'Rate', 'InterestRate', 'tok', 1000, 3);

    const code = execute.mock.calls[0][1];
    expect(code).toContain('GsRenameClassVariableRefactoring');
    expect(code).toContain("renameClassVar: 'Rate'");
    expect(code).toContain("to: 'InterestRate'");
    expect(code).toContain("startPreviewToken: 'tok' maxBytes: 1000");
  });

  it('resolves the class through the given dictionary', async () => {
    const execute = vi.fn().mockResolvedValue('{}');

    await startRenameClassVarPreview(execute, 'Account', 'Rate', 'InterestRate', 'tok', 1000, 5);

    const code = execute.mock.calls[0][1];
    expect(code).toContain('symbolList');
  });

  it('builds a page query for a token and offset', async () => {
    const execute = vi.fn().mockResolvedValue('{}');

    await pageRenameClassVarPreview(execute, 'tok', 4, 2000);

    const code = execute.mock.calls[0][1];
    expect(code).toContain("pageForToken: 'tok'");
    expect(code).toContain('from: 4 maxBytes: 2000');
  });

  it('always applies with an empty deselection set (all-or-nothing; takes no deselection arg)', async () => {
    const execute = vi.fn().mockResolvedValue('{}');

    await applyRenameClassVar(execute, 'tok');

    const code = execute.mock.calls[0][1];
    expect(code).toContain("applyForToken: 'tok'");
    expect(code).toContain('deselected: #()');
  });

  it('clears a finished preview by token', () => {
    const execute = vi.fn().mockReturnValue('ok');

    clearRenameClassVarPreview(execute, 'tok');

    const code = execute.mock.calls[0][0];
    expect(code).toContain("clearToken: 'tok'");
  });
});
