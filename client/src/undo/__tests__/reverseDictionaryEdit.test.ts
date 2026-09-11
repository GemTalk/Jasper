import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../gciLog', () => ({ logInfo: vi.fn() }));
vi.mock('../../browserQueries', () => ({
  defaultQueryExecutorUsing: () => () => '',
  renameDictionary: vi.fn(),
  removeDictionary: vi.fn(),
}));
vi.mock('../queries/dictionaryQueries', () => ({
  captureDictionary: vi.fn(),
  reinsertDictionary: vi.fn(),
  dictionaryEntryCount: vi.fn(),
}));
vi.mock('../afterUndo', () => ({
  refreshSymbolList: vi.fn(),
  refreshSearch: vi.fn(),
  reloadGemstoneEditors: vi.fn(),
}));

import * as vscode from 'vscode';
import { removeDictionary, renameDictionary } from '../../browserQueries';
import {
  captureDictionary,
  dictionaryEntryCount,
  reinsertDictionary,
} from '../queries/dictionaryQueries';
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
  vi.mocked(removeDictionary).mockReturnValue('Removed dictionary: Reports');
  vi.mocked(dictionaryEntryCount).mockReturnValue(0);
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

  it('keeps the entry on offer when the rename itself raises', async () => {
    vi.mocked(renameDictionary).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(await reverseDictionaryEdit(session, rename())).toBe(false);
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('session busy'),
    );
  });

  it('keeps the entry on offer when the symbol list cannot be read', async () => {
    vi.mocked(captureDictionary).mockImplementation(() => {
      throw new Error('session busy');
    });

    expect(await reverseDictionaryEdit(session, removal())).toBe(false);
    expect(reinsertDictionary).not.toHaveBeenCalled();
  });

  describe('a CREATED dictionary, reversed by taking it off the list', () => {
    const created = (): DictionaryUndoEntry => ({
      id: 3,
      kind: 'dictionaryEdit',
      sessionId: session.id,
      label: 'Create dictionary Reports',
      before: { present: false, name: 'Reports', index: 4 },
      after: { present: true, name: 'Reports', index: 4 },
      stashKey: null,
    });

    beforeEach(() => {
      // It is on the list — that is the state the reversal acts on, the opposite of the
      // other two directions.
      vi.mocked(captureDictionary).mockReturnValue({ present: true, name: 'Reports', index: 4 });
    });

    it('unlists it, and asks nothing when it is still empty', async () => {
      expect(await reverseDictionaryEdit(session, created())).toBe(true);

      expect(removeDictionary).toHaveBeenCalledWith(session, 'Reports');
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
      expect(reinsertDictionary).not.toHaveBeenCalled();
      expect(refreshSymbolList).toHaveBeenCalledWith(session.id);
    });

    it('does not count the self-referential entry as content', async () => {
      // A freshly created dictionary reports a size of one: its own `#Name -> theDict`.
      vi.mocked(dictionaryEntryCount).mockReturnValue(0);

      await reverseDictionaryEdit(session, created());

      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it('warns, with a count, when it has been filled since', async () => {
      vi.mocked(dictionaryEntryCount).mockReturnValue(3);
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Undo Anyway' as never);

      expect(await reverseDictionaryEdit(session, created())).toBe(true);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('holds 3 entries now'),
        expect.objectContaining({ modal: true, detail: expect.stringContaining('out of reach') }),
        'Undo Anyway',
      );
      expect(removeDictionary).toHaveBeenCalled();
    });

    it('reads a single entry as singular', async () => {
      vi.mocked(dictionaryEntryCount).mockReturnValue(1);
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Undo Anyway' as never);

      await reverseDictionaryEdit(session, created());

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('holds 1 entry now'),
        expect.anything(),
        'Undo Anyway',
      );
    });

    it('keeps the entry on offer when the warning is declined', async () => {
      vi.mocked(dictionaryEntryCount).mockReturnValue(2);
      vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

      expect(await reverseDictionaryEdit(session, created())).toBe(false);
      expect(removeDictionary).not.toHaveBeenCalled();
    });

    it('undoes without the warning when the count cannot be read', async () => {
      // A count that cannot be read must not block the undo.
      vi.mocked(dictionaryEntryCount).mockImplementation(() => {
        throw new Error('session busy');
      });

      expect(await reverseDictionaryEdit(session, created())).toBe(true);
      expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
      expect(removeDictionary).toHaveBeenCalled();
    });

    it('does nothing when it is already off the symbol list', async () => {
      vi.mocked(captureDictionary).mockReturnValue({ present: false, name: 'Reports', index: 0 });

      expect(await reverseDictionaryEdit(session, created())).toBe(true);
      expect(removeDictionary).not.toHaveBeenCalled();
    });

    it('reports a removal the stone answered with a status string', async () => {
      vi.mocked(removeDictionary).mockReturnValue('Dictionary not found');

      expect(await reverseDictionaryEdit(session, created())).toBe(false);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Dictionary not found'),
      );
    });

    it('keeps the entry on offer when the removal raises', async () => {
      vi.mocked(removeDictionary).mockImplementation(() => {
        throw new Error('session busy');
      });

      expect(await reverseDictionaryEdit(session, created())).toBe(false);
    });

    it('keeps the entry on offer when the symbol list cannot be read', async () => {
      vi.mocked(captureDictionary).mockImplementation(() => {
        throw new Error('session busy');
      });

      expect(await reverseDictionaryEdit(session, created())).toBe(false);
      expect(removeDictionary).not.toHaveBeenCalled();
    });
  });
});
