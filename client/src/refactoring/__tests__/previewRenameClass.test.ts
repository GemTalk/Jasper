import { describe, it, expect, vi } from 'vitest';
import {
  startRenameClassPreview,
  pageRenameClassPreview,
  applyRenameClass,
  clearRenameClassPreview,
  isRenameClassScope,
} from '../queries/previewRenameClass';

const OPTS = {
  copyMethods: true,
  recompileSubclasses: true,
  migrateInstances: true,
  removeOldFromHistory: false,
};

describe('previewRenameClass queries', () => {
  it('builds a start-preview that renames, sets the four options, and starts the token', async () => {
    const execute = vi.fn().mockResolvedValue('{}');

    await startRenameClassPreview(
      execute,
      'Account',
      'BankAccount',
      { kind: 'wholeSystem' },
      OPTS,
      'tok',
      1000,
      3,
    );

    const code = execute.mock.calls[0][1];
    expect(code).toContain("renameTo: 'BankAccount'");
    expect(code).toContain('scope: #wholeSystem');
    expect(code).toContain('copyMethods: true');
    expect(code).toContain('recompileSubclasses: true');
    expect(code).toContain('migrateInstances: true');
    expect(code).toContain('removeOldFromHistory: false');
    expect(code).toContain("startPreviewToken: 'tok' maxBytes: 1000");
  });

  it('reflects unchecked options and a dictionary scope in the start query', async () => {
    const execute = vi.fn().mockResolvedValue('{}');

    await startRenameClassPreview(
      execute,
      'Account',
      'BankAccount',
      { kind: 'dictionary', dictName: 'MyDict' },
      { ...OPTS, migrateInstances: false, removeOldFromHistory: true },
      'tok',
      1000,
    );

    const code = execute.mock.calls[0][1];
    expect(code).toContain("dictionaryScope: 'MyDict'");
    expect(code).toContain('migrateInstances: false');
    expect(code).toContain('removeOldFromHistory: true');
  });

  it('builds a page query for a token and offset', async () => {
    const execute = vi.fn().mockResolvedValue('{}');

    await pageRenameClassPreview(execute, 'tok', 5, 2000);

    expect(execute.mock.calls[0][1]).toContain("pageForToken: 'tok' from: 5 maxBytes: 2000");
  });

  it('builds an apply query passing the deselected ids', async () => {
    const execute = vi.fn().mockResolvedValue('{}');

    await applyRenameClass(execute, 'tok', ['3', '7']);

    expect(execute.mock.calls[0][1]).toContain("applyForToken: 'tok' deselected: #('3' '7')");
  });

  it('builds a clear query that drops the token', () => {
    const execute = vi.fn().mockReturnValue('ok');

    clearRenameClassPreview(execute, 'tok');

    expect(execute.mock.calls[0][0]).toContain("clearToken: 'tok'");
  });
});

describe('isRenameClassScope (webview-message guard)', () => {
  it('accepts the three argument-less scopes', () => {
    expect(isRenameClassScope({ kind: 'class' })).toBe(true);
    expect(isRenameClassScope({ kind: 'hierarchy' })).toBe(true);
    expect(isRenameClassScope({ kind: 'wholeSystem' })).toBe(true);
  });

  it('accepts a dictionary scope only with a string dictName', () => {
    expect(isRenameClassScope({ kind: 'dictionary', dictName: 'MyDict' })).toBe(true);
    expect(isRenameClassScope({ kind: 'dictionary' })).toBe(false);
    expect(isRenameClassScope({ kind: 'dictionary', dictName: 5 })).toBe(false);
  });

  it('rejects unknown kinds and non-objects', () => {
    expect(isRenameClassScope({ kind: 'everything' })).toBe(false);
    expect(isRenameClassScope({})).toBe(false);
    expect(isRenameClassScope(null)).toBe(false);
    expect(isRenameClassScope(undefined)).toBe(false);
    expect(isRenameClassScope('wholeSystem')).toBe(false);
    expect(isRenameClassScope(42)).toBe(false);
  });
});
