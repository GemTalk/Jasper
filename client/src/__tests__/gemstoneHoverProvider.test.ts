import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

vi.mock('../browserQueries', () => ({
  implementorsOf: vi.fn(() => []),
  getAllClassNames: vi.fn(() => []),
  getClassComment: vi.fn(() => ''),
}));

import { Position, Range, MarkdownString, __setConfig, __resetConfig } from '../__mocks__/vscode';
import type * as vscode from 'vscode';
import { GemStoneHoverProvider } from '../gemstoneHoverProvider';
import { SelectorResolver } from '../gemstoneDefinitionProvider';
import { SessionManager } from '../sessionManager';
import { implementorsOf, getAllClassNames, getClassComment } from '../browserQueries';

const mockImplementorsOf = vi.mocked(implementorsOf);
const mockGetAllClassNames = vi.mocked(getAllClassNames);
const mockGetClassComment = vi.mocked(getClassComment);

const pos = (line: number, char: number) => new Position(line, char) as unknown as vscode.Position;

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

function makeDocument(text: string) {
  const lines = text.split('\n');
  return {
    uri: { toString: () => 'gemstone://1/Globals/Array/instance/accessing/size' },
    getText(range?: Range) {
      if (!range) return text;
      return lines[range.start.line].substring(range.start.character, range.end.character);
    },
    getWordRangeAtPosition(p: Position) {
      const line = lines[p.line] || '';
      let start = p.character;
      let end = p.character;
      while (start > 0 && /\w/.test(line[start - 1])) start--;
      while (end < line.length && /\w/.test(line[end])) end++;
      if (start === end) return undefined;
      return new Range(new Position(p.line, start), new Position(p.line, end));
    },
  } as unknown as vscode.TextDocument;
}

describe('GemStoneHoverProvider', () => {
  beforeEach(() => {
    __resetConfig();
    mockImplementorsOf.mockReset();
    mockGetAllClassNames.mockReset();
    mockGetClassComment.mockReset();
    mockImplementorsOf.mockReturnValue([]);
    mockGetAllClassNames.mockReturnValue([]);
    mockGetClassComment.mockReturnValue('');
  });

  describe('with no session', () => {
    it('returns null when no session selected', async () => {
      const provider = new GemStoneHoverProvider(makeSessionManager(false));
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));
      expect(result).toBeNull();
    });
  });

  describe('selector hover', () => {
    it('shows implementors with categories', async () => {
      mockImplementorsOf.mockReturnValue([
        {
          dictName: 'Globals',
          className: 'Array',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
        },
        {
          dictName: 'Globals',
          className: 'String',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
        },
      ]);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      expect(result).not.toBeNull();
      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('**#size**');
      expect(md.value).toContain('*2* implementors');
      expect(md.value).toContain('`Array` (accessing)');
      expect(md.value).toContain('`String` (accessing)');
    });

    it('shows singular "implementor" for one result', async () => {
      mockImplementorsOf.mockReturnValue([
        {
          dictName: 'Globals',
          className: 'Array',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
        },
      ]);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('*1* implementor\n');
    });

    it('shows "class" suffix for class-side implementors', async () => {
      mockImplementorsOf.mockReturnValue([
        {
          dictName: 'Globals',
          className: 'Array',
          isMeta: true,
          selector: 'new',
          category: 'creation',
        },
      ]);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'new') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('Array new'), pos(0, 6));

      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('`Array class` (creation)');
    });

    it('truncates to 10 and shows "...and N more"', async () => {
      const results = Array.from({ length: 15 }, (_, i) => ({
        dictName: 'Globals',
        className: `Class${i}`,
        isMeta: false,
        selector: 'size',
        category: 'accessing',
      }));
      mockImplementorsOf.mockReturnValue(results);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 5));

      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('*15* implementors');
      expect(md.value).toContain('Class9');
      expect(md.value).not.toContain('Class10');
      expect(md.value).toContain('...and 5 more');
    });

    it('returns null when no implementors found', async () => {
      mockImplementorsOf.mockReturnValue([]);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'noSuchMethod') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('self noSuchMethod'), pos(0, 5));

      expect(result).toBeNull();
    });

    it('passes maxEnvironment to implementorsOf', async () => {
      __setConfig('gemstone', 'maxEnvironment', 2);
      mockImplementorsOf.mockReturnValue([
        {
          dictName: 'Globals',
          className: 'Array',
          isMeta: false,
          selector: 'size',
          category: 'accessing',
        },
      ]);
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => 'size') };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      await provider.provideHover(makeDocument('self size'), pos(0, 5));

      expect(mockImplementorsOf).toHaveBeenCalledWith(expect.anything(), 'size', 2);
    });

    it('handles selector resolver throwing', async () => {
      const resolver: SelectorResolver = {
        getSelector: vi.fn(async () => {
          throw new Error('fail');
        }),
      };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('foo'), pos(0, 0));

      // Falls through to class name check, which returns null for lowercase
      expect(result).toBeNull();
    });
  });

  describe('class name hover', () => {
    it('shows class name with dictionary and comment', async () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      mockGetClassComment.mockReturnValue(
        'Instances of Array are variable-length ordered collections.',
      );
      const resolver: SelectorResolver = { getSelector: vi.fn(async () => null) };
      const provider = new GemStoneHoverProvider(makeSessionManager(true), resolver);
      const result = await provider.provideHover(makeDocument('Array new'), pos(0, 0));

      expect(result).not.toBeNull();
      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('**Array**');
      expect(md.value).toContain('*Globals*');
      expect(md.value).toContain('variable-length ordered collections');
    });

    it('truncates long comments to 500 characters', async () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      const longComment = 'A'.repeat(600);
      mockGetClassComment.mockReturnValue(longComment);
      const provider = new GemStoneHoverProvider(makeSessionManager(true));
      const result = await provider.provideHover(makeDocument('Array new'), pos(0, 0));

      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('A'.repeat(500) + '...');
      expect(md.value).not.toContain('A'.repeat(501));
    });

    it('shows hover even when comment is empty', async () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      mockGetClassComment.mockReturnValue('');
      const provider = new GemStoneHoverProvider(makeSessionManager(true));
      const result = await provider.provideHover(makeDocument('Array new'), pos(0, 0));

      expect(result).not.toBeNull();
      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('**Array**');
      expect(md.value).toContain('*Globals*');
    });

    it('returns null for lowercase words', async () => {
      const provider = new GemStoneHoverProvider(makeSessionManager(true));
      const result = await provider.provideHover(makeDocument('self size'), pos(0, 0));

      expect(result).toBeNull();
    });

    it('returns null for unknown class names', async () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      const provider = new GemStoneHoverProvider(makeSessionManager(true));
      const result = await provider.provideHover(makeDocument('NoSuchClass new'), pos(0, 0));

      expect(result).toBeNull();
    });

    it('handles getClassComment throwing', async () => {
      mockGetAllClassNames.mockReturnValue([
        { dictIndex: 1, dictName: 'Globals', className: 'Array' },
      ]);
      mockGetClassComment.mockImplementation(() => {
        throw new Error('not found');
      });
      const provider = new GemStoneHoverProvider(makeSessionManager(true));
      const result = await provider.provideHover(makeDocument('Array new'), pos(0, 0));

      // Should still return hover with class name, just no comment
      expect(result).not.toBeNull();
      const md = result!.contents as unknown as MarkdownString;
      expect(md.value).toContain('**Array**');
    });
  });
});
