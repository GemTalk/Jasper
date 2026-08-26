import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({
  defaultQueryExecutorUsing: () => () => '',
  renameDictionary: vi.fn(),
}));
vi.mock('../queries/dictionaryQueries', () => ({
  captureDictionary: vi.fn(),
  reinsertDictionary: vi.fn(),
}));
vi.mock('../afterUndo', () => ({
  refreshSymbolList: vi.fn(),
  refreshSearch: vi.fn(),
  reloadGemstoneEditors: vi.fn(),
}));

import * as vscode from 'vscode';
import { renameDictionary } from '../../browserQueries';
import { captureDictionary, reinsertDictionary } from '../queries/dictionaryQueries';
import { refreshSymbolList } from '../afterUndo';
import { reverseDictionaryEdit } from '../reverseDictionaryEdit';
import { DictionaryUndoEntry } from '../undoTypes';
import type { ActiveSession } from '../../sessionManager';

/**
 * Undoing a symbol-list change (#434).
 *
 * One reverser for both shapes. The behaviour that matters is that a REMOVED dictionary goes
 * back at its old POSITION — a symbol list is ordered and name resolution walks it in order,
 * so appending it would silently change what a bare name resolves to — and that a RENAMED one
 * is found under its NEW name, since that is what it is called now.
 */

const session = { id: 1 } as ActiveSession;

const removal = (): DictionaryUndoEntry => ({
  id: 1,
  kind: 'dictionaryEdit',
  sessionId: session.id,
  label: 'Remove dictionary Reports',
  before: { present: true, name: 'Reports', index: 2 },
  after: { present: false, name: 'Reports', index: 2 },
  stashKey: 'JasperUndoStash_1',
});

const rename = (): DictionaryUndoEntry => ({
  id: 2,
  kind: 'dictionaryEdit',
  sessionId: session.id,
  label: 'Rename dictionary Reports to Reporting',
  before: { present: true, name: 'Reports', index: 2 },
  after: { present: true, name: 'Reporting', index: 2 },
  stashKey: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(captureDictionary).mockReturnValue({ present: false, name: 'Reports', index: 0 });
  vi.mocked(reinsertDictionary).mockReturnValue(null);
  vi.mocked(renameDictionary).mockReturnValue('ok');
});

describe('reverseDictionaryEdit', () => {
  it('puts a removed dictionary back at the position it held', async () => {
    expect(await reverseDictionaryEdit(session, removal())).toBe(true);

    expect(reinsertDictionary).toHaveBeenCalledWith(expect.anything(), 'JasperUndoStash_1', 2);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('back at position 2'),
    );
  });

  it('rebuilds the Explorer from the symbol list up, not just its panes', async () => {
    // Every dictionary below the change has shifted index, and the Explorer caches those.
    await reverseDictionaryEdit(session, removal());

    expect(refreshSymbolList).toHaveBeenCalledWith(session.id);
  });

  it('renames a renamed dictionary back, finding it under its NEW name', async () => {
    expect(await reverseDictionaryEdit(session, rename())).toBe(true);

    expect(renameDictionary).toHaveBeenCalledWith(session, 'Reporting', 'Reports');
    expect(reinsertDictionary).not.toHaveBeenCalled();
  });

  it('does nothing when the old name is already back on the symbol list', async () => {
    vi.mocked(captureDictionary).mockReturnValue({ present: true, name: 'Reports', index: 2 });

    expect(await reverseDictionaryEdit(session, removal())).toBe(true);
    expect(reinsertDictionary).not.toHaveBeenCalled();
  });

  it('reports a reinsert the stone refused and keeps the entry on offer', async () => {
    vi.mocked(reinsertDictionary).mockReturnValue(
      'this session no longer holds the removed dictionary',
    );

    expect(await reverseDictionaryEdit(session, removal())).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('no longer holds'),
    );
  });

  it('reports a rename the stone refused by RETURNING a reason rather than raising', async () => {
    vi.mocked(renameDictionary).mockReturnValue('The name Reports is already in use');

    expect(await reverseDictionaryEdit(session, rename())).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('already in use'),
    );
  });

  it('keeps the entry on offer when the symbol list cannot be read', async () => {
    vi.mocked(captureDictionary).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(await reverseDictionaryEdit(session, removal())).toBe(false);
    expect(reinsertDictionary).not.toHaveBeenCalled();
  });
});
