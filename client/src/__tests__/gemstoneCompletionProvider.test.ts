import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  getAllClassNames: vi.fn(() => []),
  getInstVarNames: vi.fn(() => []),
  getAllSelectors: vi.fn(() => []),
}));

import { Uri, CompletionItemKind } from '../__mocks__/vscode';
import type * as vscode from 'vscode';
import { GemStoneCompletionProvider } from '../gemstoneCompletionProvider';
import { SessionManager } from '../sessionManager';
import { getAllClassNames, getInstVarNames, getAllSelectors } from '../browserQueries';

const mockGetAllClassNames = vi.mocked(getAllClassNames);
const mockGetInstVarNames = vi.mocked(getInstVarNames);
const mockGetAllSelectors = vi.mocked(getAllSelectors);

function makeSessionManager(hasSession: boolean) {
  return {
    getSelectedSession: vi.fn(() =>
      hasSession
        ? { id: 1, gci: {}, handle: 'h1', login: { label: 'Test' }, stoneVersion: '3.7.2' }
        : undefined,
    ),
    onDidChangeSelection: vi.fn(() => ({ dispose: () => {} })),
  } as unknown as SessionManager;
}

function makeDocument(uri: string) {
  return {
    uri: Uri.parse(uri),
    getText: vi.fn(() => ''),
    getWordRangeAtPosition: vi.fn(() => undefined),
  } as unknown as vscode.TextDocument;
}

describe('GemStoneCompletionProvider', () => {
  beforeEach(() => {
    mockGetAllClassNames.mockReset();
    mockGetInstVarNames.mockReset();
    mockGetAllSelectors.mockReset();
    mockGetAllClassNames.mockReturnValue([]);
    mockGetInstVarNames.mockReturnValue([]);
    mockGetAllSelectors.mockReturnValue([]);
  });

  describe('with no session', () => {
    it('returns empty when no session selected', () => {
      const provider = new GemStoneCompletionProvider(makeSessionManager(false));
      const result = provider.provideCompletionItems(
        makeDocument('gemstone://1/Globals/Array/instance/accessing/size'),
      );
      expect(result).toEqual([]);
    });
  });

  describe('class name completions', () => {
    it('returns class names from getAllClassNames', () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
        { dictIndex: 1, dictName: 'Globals', className: 'String' },
      ]);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      const classItems = result.filter((i) => i.kind === CompletionItemKind.Class);
      expect(classItems).toHaveLength(2);
      expect(classItems[0].label).toBe('Array');
      expect(classItems[0].detail).toBe('Globals');
      expect(classItems[1].label).toBe('String');
    });

    it('deduplicates class names across dictionaries', () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
        { dictIndex: 2, dictName: 'UserGlobals', className: 'Array' },
      ]);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      const classItems = result.filter((i) => i.kind === CompletionItemKind.Class);
      expect(classItems).toHaveLength(1);
      expect(classItems[0].label).toBe('Array');
      expect(classItems[0].detail).toBe('Globals');
    });

    it('provides class names for file:// documents', () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe(CompletionItemKind.Class);
    });
  });

  describe('instance variable completions', () => {
    it('returns inst vars for gemstone:// documents', () => {
      mockGetAllClassNames.mockReturnValue([]);
      mockGetInstVarNames.mockReturnValue(['name', 'age', 'email']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = provider.provideCompletionItems(
        makeDocument('gemstone://1/Globals/Person/instance/accessing/name'),
      );

      const fieldItems = result.filter((i) => i.kind === CompletionItemKind.Field);
      expect(fieldItems).toHaveLength(3);
      expect(fieldItems[0].label).toBe('name');
      expect(fieldItems[0].detail).toBe('Person inst var');
      expect(fieldItems[1].label).toBe('age');
      expect(fieldItems[2].label).toBe('email');
    });

    it('does not provide inst vars for file:// documents', () => {
      mockGetInstVarNames.mockReturnValue(['name']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      const fieldItems = result.filter((i) => i.kind === CompletionItemKind.Field);
      expect(fieldItems).toHaveLength(0);
      expect(mockGetInstVarNames).not.toHaveBeenCalled();
    });
  });

  describe('selector completions', () => {
    it('returns selectors for gemstone:// documents', () => {
      mockGetAllClassNames.mockReturnValue([]);
      mockGetAllSelectors.mockReturnValue(['size', 'at:', 'at:put:']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = provider.provideCompletionItems(
        makeDocument('gemstone://1/Globals/Array/instance/accessing/size'),
      );

      const methodItems = result.filter((i) => i.kind === CompletionItemKind.Method);
      expect(methodItems).toHaveLength(3);
      expect(methodItems[0].label).toBe('size');
      expect(methodItems[1].label).toBe('at:');
      expect(methodItems[2].label).toBe('at:put:');
    });

    it('does not provide selectors for file:// documents', () => {
      mockGetAllSelectors.mockReturnValue(['size']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      const methodItems = result.filter((i) => i.kind === CompletionItemKind.Method);
      expect(methodItems).toHaveLength(0);
      expect(mockGetAllSelectors).not.toHaveBeenCalled();
    });
  });

  describe('caching', () => {
    it('caches class names across calls', () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      provider.provideCompletionItems(makeDocument('file:///test.tpz'));
      provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      expect(mockGetAllClassNames).toHaveBeenCalledTimes(1);
    });

    it('caches inst vars and selectors per class', () => {
      mockGetInstVarNames.mockReturnValue(['x']);
      mockGetAllSelectors.mockReturnValue(['size']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const doc = makeDocument('gemstone://1/Globals/Array/instance/accessing/size');
      provider.provideCompletionItems(doc);
      provider.provideCompletionItems(doc);

      expect(mockGetInstVarNames).toHaveBeenCalledTimes(1);
      expect(mockGetAllSelectors).toHaveBeenCalledTimes(1);
    });

    it('invalidateCache forces re-query', () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      provider.provideCompletionItems(makeDocument('file:///test.tpz'));
      provider.invalidateCache();
      provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      expect(mockGetAllClassNames).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('returns empty when getAllClassNames throws', () => {
      mockGetAllClassNames.mockImplementation(() => {
        throw new Error('GCI error');
      });
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = provider.provideCompletionItems(makeDocument('file:///test.tpz'));

      expect(result).toEqual([]);
    });

    it('returns class names when getInstVarNames throws', () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      mockGetInstVarNames.mockImplementation(() => {
        throw new Error('GCI error');
      });
      mockGetAllSelectors.mockReturnValue(['size']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = provider.provideCompletionItems(
        makeDocument('gemstone://1/Globals/Array/instance/accessing/size'),
      );

      const classItems = result.filter((i) => i.kind === CompletionItemKind.Class);
      const fieldItems = result.filter((i) => i.kind === CompletionItemKind.Field);
      const methodItems = result.filter((i) => i.kind === CompletionItemKind.Method);
      expect(classItems).toHaveLength(1);
      expect(fieldItems).toHaveLength(0);
      expect(methodItems).toHaveLength(1);
    });

    it('returns class names when getAllSelectors throws', () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      mockGetInstVarNames.mockReturnValue(['x']);
      mockGetAllSelectors.mockImplementation(() => {
        throw new Error('GCI error');
      });
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      const result = provider.provideCompletionItems(
        makeDocument('gemstone://1/Globals/Array/instance/accessing/size'),
      );

      const classItems = result.filter((i) => i.kind === CompletionItemKind.Class);
      const fieldItems = result.filter((i) => i.kind === CompletionItemKind.Field);
      const methodItems = result.filter((i) => i.kind === CompletionItemKind.Method);
      expect(classItems).toHaveLength(1);
      expect(fieldItems).toHaveLength(1);
      expect(methodItems).toHaveLength(0);
    });
  });

  describe('URI parsing', () => {
    it('extracts class name from gemstone:// URI', () => {
      mockGetAllClassNames.mockReturnValue([]);
      mockGetInstVarNames.mockReturnValue(['x']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      provider.provideCompletionItems(
        makeDocument('gemstone://1/Globals/MyClass/instance/accessing/foo'),
      );

      expect(mockGetInstVarNames).toHaveBeenCalledWith(expect.anything(), 'MyClass');
    });

    it('decodes percent-encoded class names', () => {
      mockGetAllClassNames.mockReturnValue([]);
      mockGetInstVarNames.mockReturnValue([]);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      provider.provideCompletionItems(
        makeDocument('gemstone://1/My%20Dict/My%20Class/instance/cat/sel'),
      );

      expect(mockGetInstVarNames).toHaveBeenCalledWith(expect.anything(), 'My Class');
    });

    it('handles definition URIs without class context methods', () => {
      mockGetAllClassNames.mockReturnValue([]);
      mockGetInstVarNames.mockReturnValue(['x']);
      const provider = new GemStoneCompletionProvider(makeSessionManager(true));
      provider.provideCompletionItems(makeDocument('gemstone://1/Globals/Array/definition'));

      // Should still extract "Array" as class name
      expect(mockGetInstVarNames).toHaveBeenCalledWith(expect.anything(), 'Array');
    });
  });
});
