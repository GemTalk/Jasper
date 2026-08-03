import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  getAllClassNames: vi.fn(() => [
    { dictIndex: 1, dictName: 'Globals', className: 'Array' },
    { dictIndex: 1, dictName: 'Globals', className: 'String' },
    { dictIndex: 1, dictName: 'Globals', className: 'ArrayedCollection' },
    { dictIndex: 2, dictName: 'UserGlobals', className: 'MyClass' },
    { dictIndex: 2, dictName: 'UserGlobals', className: 'MyArray' },
  ]),
}));

import { SymbolKind } from '../__mocks__/vscode';
import { GemStoneWorkspaceSymbolProvider } from '../gemstoneSymbolProvider';
import { SessionManager } from '../sessionManager';
import { getAllClassNames } from '../browserQueries';

const mockGetAllClassNames = vi.mocked(getAllClassNames);

function makeSessionManager(hasSession: boolean) {
  return {
    getSelectedSession: vi.fn(() =>
      hasSession
        ? { id: 1, gci: {}, handle: {}, login: { label: 'Test' }, stoneVersion: '3.7.2' }
        : undefined,
    ),
    onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
  } as unknown as SessionManager;
}

describe('GemStoneWorkspaceSymbolProvider', () => {
  describe('with active session', () => {
    let provider: GemStoneWorkspaceSymbolProvider;

    beforeEach(() => {
      provider = new GemStoneWorkspaceSymbolProvider(makeSessionManager(true));
    });

    it('returns empty for empty query', () => {
      expect(provider.provideWorkspaceSymbols('')).toEqual([]);
    });

    it('returns matching classes for query', () => {
      const results = provider.provideWorkspaceSymbols('Array');
      expect(results).toHaveLength(3);
      const names = results.map((r) => r.name);
      expect(names).toContain('Array');
      expect(names).toContain('ArrayedCollection');
      expect(names).toContain('MyArray');
    });

    it('search is case-insensitive', () => {
      const results = provider.provideWorkspaceSymbols('array');
      expect(results).toHaveLength(3);
    });

    it('returns SymbolKind.Class for all results', () => {
      const results = provider.provideWorkspaceSymbols('My');
      for (const r of results) {
        expect(r.kind).toBe(SymbolKind.Class);
      }
    });

    it('includes dictionary name as container', () => {
      const results = provider.provideWorkspaceSymbols('MyClass');
      expect(results).toHaveLength(1);
      expect(results[0].containerName).toBe('UserGlobals');
    });

    it('builds definition URI for each symbol', () => {
      const results = provider.provideWorkspaceSymbols('String');
      expect(results).toHaveLength(1);
      const uri = results[0].location.uri;
      expect(uri.scheme).toBe('gemstone');
      expect(uri.authority).toBe('1');
      expect(uri.path).toContain('/String/definition');
    });

    it('caches results across calls', () => {
      mockGetAllClassNames.mockClear();
      provider.provideWorkspaceSymbols('Array');
      provider.provideWorkspaceSymbols('String');
      expect(mockGetAllClassNames).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache forces re-fetch', () => {
      mockGetAllClassNames.mockClear();
      provider.provideWorkspaceSymbols('Array');
      provider.invalidateCache();
      provider.provideWorkspaceSymbols('Array');
      expect(mockGetAllClassNames).toHaveBeenCalledTimes(2);
    });
  });

  describe('without active session', () => {
    it('returns empty when no session', () => {
      const provider = new GemStoneWorkspaceSymbolProvider(makeSessionManager(false));
      expect(provider.provideWorkspaceSymbols('Array')).toEqual([]);
    });
  });
});
