import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { indexFile, WorkspaceIndex, detectFormat } from '../workspaceIndex';
import { DocumentManager } from '../documentManager';

describe('detectFormat', () => {
  it('returns tonel for .st files', () => {
    expect(detectFormat('file:///path/to/File.st')).toBe('tonel');
  });

  it('returns smalltalk for gemstone: URIs', () => {
    expect(detectFormat('gemstone://1/Globals/Array/instance/accessing/size')).toBe('smalltalk');
  });

  it('returns topaz for .gs files', () => {
    expect(detectFormat('file:///path/to/File.gs')).toBe('topaz');
  });

  it('returns topaz for .tpz files', () => {
    expect(detectFormat('file:///path/to/File.tpz')).toBe('topaz');
  });

  it('returns topaz as default', () => {
    expect(detectFormat('file:///path/to/File.txt')).toBe('topaz');
  });
});

describe('indexFile', () => {
  it('indexes a unary method', () => {
    const methods = indexFile('file:///a.gs', 'method: Foo\nbar\n  ^self\n%');
    expect(methods).toHaveLength(1);
    expect(methods[0].selector).toBe('bar');
    expect(methods[0].className).toBe('Foo');
    expect(methods[0].isClassSide).toBe(false);
  });

  it('indexes a binary method', () => {
    const methods = indexFile('file:///a.gs', 'method: Foo\n+ other\n  ^self\n%');
    expect(methods).toHaveLength(1);
    expect(methods[0].selector).toBe('+');
  });

  it('indexes a keyword method', () => {
    const methods = indexFile('file:///a.gs', 'method: Foo\nat: index put: value\n  ^self\n%');
    expect(methods).toHaveLength(1);
    expect(methods[0].selector).toBe('at:put:');
  });

  it('indexes a classmethod', () => {
    const methods = indexFile('file:///a.gs', 'classmethod: Foo\nnew\n  ^super new\n%');
    expect(methods).toHaveLength(1);
    expect(methods[0].isClassSide).toBe(true);
  });

  it('indexes multiple methods in one file', () => {
    const source = [
      'method: Foo',
      'alpha',
      '  ^1',
      '%',
      'method: Foo',
      'beta',
      '  ^2',
      '%',
      'method: Bar',
      'gamma',
      '  ^3',
      '%',
    ].join('\n');
    const methods = indexFile('file:///a.gs', source);
    expect(methods).toHaveLength(3);
    expect(methods.map((m) => m.selector)).toEqual(['alpha', 'beta', 'gamma']);
    expect(methods[2].className).toBe('Bar');
  });

  it('skips non-method regions', () => {
    const source = 'run\n1 + 2\n%\nmethod: Foo\nbar\n  ^self\n%';
    const methods = indexFile('file:///a.gs', source);
    expect(methods).toHaveLength(1);
    expect(methods[0].selector).toBe('bar');
  });

  it('skips methods with parse errors', () => {
    const source = 'method: Foo\n\n%';
    const methods = indexFile('file:///a.gs', source);
    expect(methods).toHaveLength(0);
  });

  it('captures line ranges', () => {
    const source = 'method: Foo\nbar\n  ^self\n%';
    const methods = indexFile('file:///a.gs', source);
    expect(methods[0].startLine).toBe(1);
    expect(methods[0].endLine).toBe(2);
  });
});

describe('collectSentSelectors (via indexFile)', () => {
  it('collects unary sends', () => {
    const methods = indexFile('file:///a.gs', 'method: Foo\nbar\n  ^self size\n%');
    expect(methods[0].sentSelectors).toContain('size');
  });

  it('collects binary sends', () => {
    const methods = indexFile('file:///a.gs', 'method: Foo\nbar\n  ^1 + 2\n%');
    expect(methods[0].sentSelectors).toContain('+');
  });

  it('collects keyword sends', () => {
    const methods = indexFile('file:///a.gs', 'method: Foo\nbar\n  self at: 1 put: 2\n%');
    expect(methods[0].sentSelectors).toContain('at:put:');
  });

  it('collects sends in nested blocks', () => {
    const methods = indexFile('file:///a.gs', 'method: Foo\nbar\n  [:x | x printString]\n%');
    expect(methods[0].sentSelectors).toContain('printString');
  });

  it('collects sends from cascades', () => {
    const methods = indexFile(
      'file:///a.gs',
      'method: Foo\nbar\n  self add: 1; add: 2; yourself\n%',
    );
    expect(methods[0].sentSelectors).toContain('add:');
    expect(methods[0].sentSelectors).toContain('yourself');
  });

  it('collects all sends in complex method', () => {
    const source = [
      'method: Foo',
      'bar: arg',
      '  | temp |',
      '  temp := arg size.',
      '  self at: temp put: (arg collect: [:e | e printString]).',
      '  ^temp',
      '%',
    ].join('\n');
    const methods = indexFile('file:///a.gs', source);
    const sent = methods[0].sentSelectors;
    expect(sent).toContain('size');
    expect(sent).toContain('at:put:');
    expect(sent).toContain('collect:');
    expect(sent).toContain('printString');
  });
});

describe('WorkspaceIndex', () => {
  function makeIndex(...files: [string, string][]): WorkspaceIndex {
    const idx = new WorkspaceIndex();
    for (const [uri, text] of files) {
      idx.indexFileFromDisk(uri, text);
    }
    return idx;
  }

  describe('findImplementors', () => {
    it('finds implementors across files', () => {
      const idx = makeIndex(
        ['file:///a.gs', 'method: Foo\nbar\n  ^1\n%'],
        ['file:///b.gs', 'method: Baz\nbar\n  ^2\n%'],
      );
      const impls = idx.findImplementors('bar');
      expect(impls).toHaveLength(2);
      expect(impls.map((m) => m.className)).toContain('Foo');
      expect(impls.map((m) => m.className)).toContain('Baz');
    });

    it('distinguishes at: from at:put:', () => {
      const idx = makeIndex(
        ['file:///a.gs', 'method: Foo\nat: index\n  ^self\n%'],
        ['file:///b.gs', 'method: Bar\nat: index put: value\n  ^self\n%'],
      );
      expect(idx.findImplementors('at:')).toHaveLength(1);
      expect(idx.findImplementors('at:put:')).toHaveLength(1);
      expect(idx.findImplementors('at:')[0].className).toBe('Foo');
      expect(idx.findImplementors('at:put:')[0].className).toBe('Bar');
    });

    it('returns empty for unknown selector', () => {
      const idx = makeIndex(['file:///a.gs', 'method: Foo\nbar\n  ^1\n%']);
      expect(idx.findImplementors('baz')).toEqual([]);
    });
  });

  describe('findSenders', () => {
    it('finds senders across files', () => {
      const idx = makeIndex(
        ['file:///a.gs', 'method: Foo\nbar\n  ^self size\n%'],
        ['file:///b.gs', 'method: Baz\nqux\n  ^self size\n%'],
      );
      const senders = idx.findSenders('size');
      expect(senders).toHaveLength(2);
    });

    it('finds senders of keyword selectors', () => {
      const idx = makeIndex(['file:///a.gs', 'method: Foo\nbar\n  self at: 1 put: 2\n%']);
      expect(idx.findSenders('at:put:')).toHaveLength(1);
      expect(idx.findSenders('at:')).toHaveLength(0);
    });
  });

  describe('replaceFile / removeFile', () => {
    it('replaceFile updates the index', () => {
      const idx = new WorkspaceIndex();
      idx.indexFileFromDisk('file:///a.gs', 'method: Foo\nbar\n  ^1\n%');
      expect(idx.findImplementors('bar')).toHaveLength(1);

      // Replace with a different method
      idx.indexFileFromDisk('file:///a.gs', 'method: Foo\nbaz\n  ^2\n%');
      expect(idx.findImplementors('bar')).toHaveLength(0);
      expect(idx.findImplementors('baz')).toHaveLength(1);
    });

    it('removeFile cleans up all indexes', () => {
      const idx = makeIndex(['file:///a.gs', 'method: Foo\nbar\n  self size\n%']);
      expect(idx.findImplementors('bar')).toHaveLength(1);
      expect(idx.findSenders('size')).toHaveLength(1);

      idx.removeFile('file:///a.gs');
      expect(idx.findImplementors('bar')).toHaveLength(0);
      expect(idx.findSenders('size')).toHaveLength(0);
    });

    it('removeFile only affects the specified file', () => {
      const idx = makeIndex(
        ['file:///a.gs', 'method: Foo\nbar\n  ^1\n%'],
        ['file:///b.gs', 'method: Baz\nbar\n  ^2\n%'],
      );
      idx.removeFile('file:///a.gs');
      const impls = idx.findImplementors('bar');
      expect(impls).toHaveLength(1);
      expect(impls[0].className).toBe('Baz');
    });
  });

  describe('searchMethods', () => {
    it('matches by selector', () => {
      const idx = makeIndex(
        ['file:///a.gs', 'method: Foo\nbar\n  ^1\n%'],
        ['file:///b.gs', 'method: Baz\nqux\n  ^2\n%'],
      );
      expect(idx.searchMethods('bar')).toHaveLength(1);
    });

    it('matches by class name', () => {
      const idx = makeIndex(
        ['file:///a.gs', 'method: Foo\nbar\n  ^1\n%'],
        ['file:///b.gs', 'method: Baz\nqux\n  ^2\n%'],
      );
      expect(idx.searchMethods('Baz')).toHaveLength(1);
      expect(idx.searchMethods('Baz')[0].selector).toBe('qux');
    });

    it('matches case-insensitively', () => {
      const idx = makeIndex(['file:///a.gs', 'method: Foo\nbar\n  ^1\n%']);
      expect(idx.searchMethods('FOO')).toHaveLength(1);
    });

    it('matches partial "ClassName >> selector"', () => {
      const idx = makeIndex(['file:///a.gs', 'method: Foo\nbar\n  ^1\n%']);
      expect(idx.searchMethods('Foo >> bar')).toHaveLength(1);
    });
  });
});

describe('WorkspaceIndex.updateFromParsedDocument', () => {
  function indexOpenEditor(uri: string, source: string): WorkspaceIndex {
    const idx = new WorkspaceIndex();
    idx.updateFromParsedDocument(new DocumentManager().update(uri, 1, source, detectFormat(uri)));
    return idx;
  }

  it('indexes a file open in an editor', () => {
    const idx = indexOpenEditor(
      'file:///project/customer.gs',
      'method: Foo\ncount\n  ^items size\n%',
    );

    expect(idx.findSenders('size').map((m) => m.uri)).toEqual(['file:///project/customer.gs']);
  });

  it('leaves out a method opened from the stone', () => {
    const idx = indexOpenEditor(
      'gemstone://1/UserGlobals/DemoCustomer/instance/accessing/orderCount',
      'orderCount\n  ^orders size',
    );

    expect(idx.findSenders('size')).toEqual([]);
    expect(idx.findImplementors('orderCount')).toEqual([]);
  });
});

describe('an editor that closes', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  // A file on disk holding `saved`, opened in an editor that now holds `edited`.
  function fileEditedInEditor(saved: string, edited: string) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-close-'));
    const file = path.join(dir, 'customer.gs');
    fs.writeFileSync(file, saved);
    const uri = pathToFileURL(file).toString();
    const idx = new WorkspaceIndex();
    idx.indexFileFromDisk(uri, saved);
    idx.updateFromParsedDocument(new DocumentManager().update(uri, 2, edited, detectFormat(uri)));
    return { idx, uri, file };
  }

  it('puts a workspace file closed with unsaved edits back to what is saved on disk', () => {
    const { idx, uri } = fileEditedInEditor(
      'method: Foo\nsaved\n  ^items size\n%',
      'method: Foo\nunsaved\n  ^items first\n%',
    );

    idx.indexClosedDocument(uri, true);

    expect(idx.findImplementors('unsaved')).toEqual([]);
    expect(idx.findSenders('first')).toEqual([]);
    expect(idx.findImplementors('saved').map((m) => m.uri)).toEqual([uri]);
    expect(idx.findSenders('size').map((m) => m.uri)).toEqual([uri]);
  });

  it('takes a workspace file deleted while it was open out of the index', () => {
    const { idx, uri, file } = fileEditedInEditor(
      'method: Foo\nsaved\n  ^self\n%',
      'method: Foo\nsaved\n  ^self\n%',
    );
    fs.rmSync(file);

    idx.indexClosedDocument(uri, true);

    expect(idx.findImplementors('saved')).toEqual([]);
  });

  it('takes a file the workspace scan does not cover out of the index, though it is on disk', () => {
    const { idx, uri } = fileEditedInEditor(
      'method: Foo\nsaved\n  ^self\n%',
      'method: Foo\nsaved\n  ^self\n%',
    );

    idx.indexClosedDocument(uri, false);

    expect(idx.findImplementors('saved')).toEqual([]);
  });

  it('leaves the other files in the index alone', () => {
    const idx = new WorkspaceIndex();
    idx.indexFileFromDisk('file:///project/other.gs', 'method: Bar\nkept\n  ^self\n%');
    idx.indexFileFromDisk('file:///tmp/scratch.gs', 'method: Foo\ndraft\n  ^self\n%');

    idx.indexClosedDocument('file:///tmp/scratch.gs', false);

    expect(idx.findImplementors('kept').map((m) => m.uri)).toEqual(['file:///project/other.gs']);
    expect(idx.findImplementors('draft')).toEqual([]);
  });
});
