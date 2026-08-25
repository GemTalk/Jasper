import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  implementorsOf: vi.fn(() => []),
  getAllClassNames: vi.fn(() => []),
}));

import { Position, Range, Location, Uri, __setConfig, __resetConfig } from '../__mocks__/vscode';
import type * as vscode from 'vscode';
import { GemStoneDefinitionProvider, SelectorResolver } from '../gemstoneDefinitionProvider';
import { SessionManager } from '../sessionManager';
import { implementorsOf, getAllClassNames } from '../browserQueries';

// Cast mock Position to vscode.Position to satisfy type checker
const pos = (line: number, char: number) => new Position(line, char) as unknown as vscode.Position;

const mockImplementorsOf = vi.mocked(implementorsOf);
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

function makeDocument(text: string, uri = 'gemstone://1/Globals/Array/instance/accessing/size') {
  const lines = text.split('\n');
  return {
    uri: Uri.parse(uri),
    getText(range?: Range) {
      if (!range) return text;
      return lines[range.start.line].substring(range.start.character, range.end.character);
    },
    getWordRangeAtPosition(pos: Position) {
      const line = lines[pos.line] || '';
      // Simple word extraction: find word boundaries around position
      let start = pos.character;
      let end = pos.character;
      while (start > 0 && /\w/.test(line[start - 1])) start--;
      while (end < line.length && /\w/.test(line[end])) end++;
      if (start === end) return undefined;
      return new Range(new Position(pos.line, start), new Position(pos.line, end));
    },
  } as unknown as vscode.TextDocument;
}

describe('GemStoneDefinitionProvider', () => {
  beforeEach(() => {
    __resetConfig();
    mockImplementorsOf.mockReset();
    mockGetAllClassNames.mockReset();
    mockImplementorsOf.mockReturnValue([]);
    mockGetAllClassNames.mockReturnValue([]);
  });

  describe('with no session', () => {
    it('returns empty when no session selected', async () => {
      const provider = new GemStoneDefinitionProvider(makeSessionManager(false));
      const doc = makeDocument('self size');
      const results = await provider.provideDefinition(doc, pos(0, 5));
      expect(results).toEqual([]);
    });
  });

  describe('selector resolution', () => {
    it('queries implementors when selector resolver returns a selector', async () => {
      mockImplementorsOf.mockReturnValue([
        {
          dictName: 'Globals',
          className: 'Array',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
          environmentId: 0,
        },
      ]);
      const resolver: SelectorResolver = {
        getSelector: vi.fn(async () => 'size'),
      };
      const provider = new GemStoneDefinitionProvider(makeSessionManager(true), resolver);
      const doc = makeDocument('self size');
      const results = await provider.provideDefinition(doc, pos(0, 5));

      expect(mockImplementorsOf).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        'size',
        0,
      );
      expect(results).toHaveLength(1);
      expect(results[0]).toBeInstanceOf(Location);
      expect(results[0].uri.scheme).toBe('gemstone');
      expect(results[0].uri.authority).toBe('1');
      expect(results[0].uri.path).toContain('/Array/instance/accessing/size');
    });

    it('returns multiple locations for multiple implementors', async () => {
      mockImplementorsOf.mockReturnValue([
        {
          dictName: 'Globals',
          className: 'Array',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
          environmentId: 0,
        },
        {
          dictName: 'Globals',
          className: 'String',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
          environmentId: 0,
        },
      ]);
      const resolver: SelectorResolver = {
        getSelector: vi.fn(async () => 'size'),
      };
      const provider = new GemStoneDefinitionProvider(makeSessionManager(true), resolver);
      const doc = makeDocument('self size');
      const results = await provider.provideDefinition(doc, pos(0, 5));

      expect(results).toHaveLength(2);
      expect(results[0].uri.path).toContain('/Array/');
      expect(results[1].uri.path).toContain('/String/');
    });

    it('builds class-side URI for isMeta results', async () => {
      mockImplementorsOf.mockReturnValue([
        {
          dictName: 'Globals',
          className: 'Array',
          isMeta: true,
          selector: 'new',
          category: 'creation',
          environmentId: 0,
        },
      ]);
      const resolver: SelectorResolver = {
        getSelector: vi.fn(async () => 'new'),
      };
      const provider = new GemStoneDefinitionProvider(makeSessionManager(true), resolver);
      const doc = makeDocument('Array new');
      const results = await provider.provideDefinition(doc, pos(0, 6));

      expect(results[0].uri.path).toContain('/class/creation/new');
    });

    it('passes maxEnvironment config to implementorsOf', async () => {
      __setConfig('gemstone', 'maxEnvironment', 3);
      const resolver: SelectorResolver = {
        getSelector: vi.fn(async () => 'size'),
      };
      const provider = new GemStoneDefinitionProvider(makeSessionManager(true), resolver);
      const doc = makeDocument('self size');
      await provider.provideDefinition(doc, pos(0, 5));

      expect(mockImplementorsOf).toHaveBeenCalledWith(expect.anything(), 'size', 3);
    });

    it('handles selector resolver throwing', async () => {
      const resolver: SelectorResolver = {
        getSelector: vi.fn(async () => {
          throw new Error('LSP not ready');
        }),
      };
      mockGetAllClassNames.mockReturnValue([]);
      const provider = new GemStoneDefinitionProvider(makeSessionManager(true), resolver);
      const doc = makeDocument('foo');
      const results = await provider.provideDefinition(doc, pos(0, 0));

      // Should not throw, falls through to class name check
      expect(results).toEqual([]);
    });

    it('returns empty when selector has no implementors', async () => {
      mockImplementorsOf.mockReturnValue([]);
      const resolver: SelectorResolver = {
        getSelector: vi.fn(async () => 'nonExistentSelector'),
      };
      const provider = new GemStoneDefinitionProvider(makeSessionManager(true), resolver);
      const doc = makeDocument('self nonExistentSelector');
      const results = await provider.provideDefinition(doc, pos(0, 5));

      expect(results).toEqual([]);
    });
  });

  describe('class name fallback', () => {
    it('returns definition URI for uppercase word when no selector found', async () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      const resolver: SelectorResolver = {
        getSelector: vi.fn(async () => null),
      };
      const provider = new GemStoneDefinitionProvider(makeSessionManager(true), resolver);
      const doc = makeDocument('Array new');
      const results = await provider.provideDefinition(doc, pos(0, 0));

      expect(results).toHaveLength(1);
      expect(results[0].uri.path).toContain('/Array/definition');
    });

    it('returns multiple locations when class exists in multiple dictionaries', async () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
        { dictIndex: 2, dictName: 'UserGlobals', className: 'Array' },
      ]);
      const provider = new GemStoneDefinitionProvider(makeSessionManager(true));
      const doc = makeDocument('Array new');
      const results = await provider.provideDefinition(doc, pos(0, 0));

      expect(results).toHaveLength(2);
      expect(results[0].uri.path).toContain('Globals');
      expect(results[1].uri.path).toContain('UserGlobals');
    });

    it('returns empty for lowercase words', async () => {
      const provider = new GemStoneDefinitionProvider(makeSessionManager(true));
      const doc = makeDocument('self size');
      const results = await provider.provideDefinition(doc, pos(0, 0));

      expect(results).toEqual([]);
    });

    it('returns empty when class name not found', async () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      const provider = new GemStoneDefinitionProvider(makeSessionManager(true));
      const doc = makeDocument('NoSuchClass new');
      const results = await provider.provideDefinition(doc, pos(0, 0));

      expect(results).toEqual([]);
    });

    it('works without a selector resolver', async () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      const provider = new GemStoneDefinitionProvider(makeSessionManager(true));
      const doc = makeDocument('Array new');
      const results = await provider.provideDefinition(doc, pos(0, 0));

      expect(results).toHaveLength(1);
      expect(results[0].uri.path).toContain('/Array/definition');
    });

    it('encodes special characters in URI', async () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'My Dict', className: 'MyClass' },
      ]);
      const provider = new GemStoneDefinitionProvider(makeSessionManager(true));
      const doc = makeDocument('MyClass new');
      const results = await provider.provideDefinition(doc, pos(0, 0));

      expect(results).toHaveLength(1);
      expect(results[0].uri.toString()).toContain('My%20Dict');
    });
  });
});
