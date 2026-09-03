import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn(),
}));
// Only the file-out reads matter here; the controller pulls in the whole query module.
vi.mock('../../browserQueries', () => ({
  fileOutHeader: vi.fn(() => 'fileformat utf8\n!'),
  fileOutDictionary: vi.fn(() => 'DICT BODY'),
  fileOutClass: vi.fn((_s: unknown, name: string) => `CLASS ${name}`),
  fileOutMethod: vi.fn(
    (_s: unknown, cls: string, isMeta: boolean, sel: string) =>
      `METHOD ${cls}${isMeta ? ' class' : ''}>>${sel}`,
  ),
  fileOutMethodCategory: vi.fn(
    (_s: unknown, cls: string, isMeta: boolean, cat: string) =>
      `CATEGORY ${cls}${isMeta ? ' class' : ''} ${cat}`,
  ),
  getDictionaryClassFileOutOrder: vi.fn(() => ['Animal', 'Dog', 'Rock']),
}));

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import type { ClassCategoryEntry } from '../../browserQueries';
import {
  ExplorerController,
  ClassItem,
  HierarchyItem,
  MethodCategoryItem,
  MethodItem,
} from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

/**
 * File Out at every Explorer level (issue #539): dictionary, class category, class,
 * method category, method(s).
 *
 * What these pin is the shape of the artifact — that one header goes in front of one
 * or more bodies, that the right query answers each body, and that a level with
 * nothing to export refuses instead of writing an empty `.gs`. The destination is a
 * local save dialog, so the tests read back what was handed to `fs.writeFileSync`.
 */

// DictItem/ClassCategoryItem aren't exported; the controller reads only these fields.
const DICT_NODE = { dictName: 'Animals', dictIndex: 3 } as never;
const CATEGORY_NODE = { segment: 'Fauna', fullPath: 'Fauna' } as never;

const SELECTOR = (selector: string) => ({
  selector,
  category: 'accessing',
  overrideBits: 0,
  sessionBit: 0,
});

function makeController(session: ActiveSession | undefined = {} as ActiveSession) {
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'Animals';
  ctl.state.dictIndex = 3;
  ctl.state.className = 'Dog';
  return ctl;
}

/** A controller whose session manager has nothing selected. */
function makeControllerWithoutSession() {
  const sessionManager = { getSelectedSession: () => undefined } as unknown as SessionManager;
  return new ExplorerController(sessionManager);
}

function setEntries(ctl: ExplorerController, entries: ClassCategoryEntry[]): void {
  (ctl as unknown as { classCategoryEntries: ClassCategoryEntry[] }).classCategoryEntries = entries;
}

/** What was written to disk by the file-out under test. */
function writtenText(): string {
  const call = vi.mocked(fs.writeFileSync).mock.calls[0];
  return call[1] as string;
}

function writtenPath(): string {
  return vi.mocked(fs.writeFileSync).mock.calls[0][0] as string;
}

/** The file name the save dialog was pre-filled with. */
function suggestedFileName(): string {
  const options = vi.mocked(vscode.window.showSaveDialog).mock.calls[0][0];
  return path.basename(options?.defaultUri?.fsPath ?? '');
}

describe('Explorer file out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks clears calls, not implementations, and tests below override some
    // of these — restore each so a shuffled run order can't leak one into the next.
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(queries.fileOutHeader).mockReturnValue('fileformat utf8\n!');
    vi.mocked(queries.fileOutDictionary).mockReturnValue('DICT BODY');
    vi.mocked(queries.fileOutClass).mockImplementation((_s, name) => `CLASS ${name}`);
    vi.mocked(queries.fileOutMethod).mockImplementation(
      (_s, cls, isMeta, sel) => `METHOD ${cls}${isMeta ? ' class' : ''}>>${sel}`,
    );
    vi.mocked(queries.fileOutMethodCategory).mockImplementation(
      (_s, cls, isMeta, cat) => `CATEGORY ${cls}${isMeta ? ' class' : ''} ${cat}`,
    );
    vi.mocked(queries.getDictionaryClassFileOutOrder).mockReturnValue(['Animal', 'Dog', 'Rock']);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(vscode.Uri.file('/out/File.gs'));
  });

  describe('dictionary', () => {
    it('writes the organizer s whole-dictionary file-out under one header', async () => {
      const ctl = makeController();

      await ctl.fileOutDictionary(DICT_NODE);

      expect(queries.fileOutDictionary).toHaveBeenCalledWith(expect.anything(), 3);
      expect(writtenText()).toBe('fileformat utf8\n!\n\nDICT BODY\n');
      expect(writtenPath()).toBe(path.normalize('/out/File.gs'));
      expect(suggestedFileName()).toBe('Animals.gs');
    });

    it('does nothing without a session', async () => {
      const ctl = makeControllerWithoutSession();

      await ctl.fileOutDictionary(DICT_NODE);

      expect(vscode.window.showSaveDialog).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('class category', () => {
    it('files out the category s classes superclass-first, in ONE file', async () => {
      const ctl = makeController();
      setEntries(ctl, [
        { category: 'Fauna', className: 'Dog', hasComment: false },
        { category: 'Fauna', className: 'Animal', hasComment: false },
        { category: 'Minerals', className: 'Rock', hasComment: false },
      ]);

      await ctl.fileOutClassCategory(CATEGORY_NODE);

      // The dictionary's file-out order puts Animal before its subclass Dog, and Rock
      // is in another category so it is not swept in.
      expect(writtenText()).toBe('fileformat utf8\n!\n\nCLASS Animal\nCLASS Dog\n');
      expect(suggestedFileName()).toBe('Fauna.gs');
    });

    it('includes the classes of sub-categories, as the Classes pane does', async () => {
      const ctl = makeController();
      setEntries(ctl, [
        { category: 'Fauna-Mammals', className: 'Dog', hasComment: false },
        { category: 'Minerals', className: 'Rock', hasComment: false },
      ]);

      await ctl.fileOutClassCategory(CATEGORY_NODE);

      expect(writtenText()).toContain('CLASS Dog');
      expect(writtenText()).not.toContain('CLASS Rock');
    });

    it('refuses an empty category instead of writing a header-only file', async () => {
      const ctl = makeController();
      setEntries(ctl, [{ category: 'Minerals', className: 'Rock', hasComment: false }]);

      await ctl.fileOutClassCategory(CATEGORY_NODE);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Fauna'),
      );
      expect(vscode.window.showSaveDialog).not.toHaveBeenCalled();
    });
  });

  describe('class', () => {
    it('files out a Classes-pane row from the selected dictionary', async () => {
      const ctl = makeController();

      await ctl.fileOutClass(new ClassItem('Dog'));

      expect(queries.fileOutClass).toHaveBeenCalledWith(expect.anything(), 'Dog', 3);
      expect(writtenText()).toBe('fileformat utf8\n!\n\nCLASS Dog\n');
      expect(suggestedFileName()).toBe('Dog.gs');
    });

    it('files out a hierarchy row from ITS OWN dictionary, not the selected one', async () => {
      const ctl = makeController();

      // A superclass shown in the hierarchy pane usually lives elsewhere; using the
      // pane's selected dictionary index would resolve the wrong class or none at all.
      await ctl.fileOutClass(new HierarchyItem('Object', 'Globals', 'ancestor', 0, false));

      expect(queries.fileOutClass).toHaveBeenCalledWith(expect.anything(), 'Object', 'Globals');
    });

    it('reports a class that no longer resolves rather than writing the error as source', async () => {
      const ctl = makeController();
      vi.mocked(queries.fileOutClass).mockReturnValue('Class not found: Dog');

      await ctl.fileOutClass(new ClassItem('Dog'));

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Class not found: Dog'),
      );
    });
  });

  describe('method category', () => {
    it('files out one protocol of the selected class', async () => {
      const ctl = makeController();

      await ctl.fileOutMethodCategory(new MethodCategoryItem(false, 'accessing', false));

      expect(queries.fileOutMethodCategory).toHaveBeenCalledWith(
        expect.anything(),
        'Dog',
        false,
        'accessing',
        3,
      );
      expect(writtenText()).toBe('fileformat utf8\n!\n\nCATEGORY Dog accessing\n');
      expect(suggestedFileName()).toBe('Dog-accessing.gs');
    });

    it('files out the class side against the metaclass', async () => {
      const ctl = makeController();

      await ctl.fileOutMethodCategory(new MethodCategoryItem(true, 'instance creation', false));

      expect(queries.fileOutMethodCategory).toHaveBeenCalledWith(
        expect.anything(),
        'Dog',
        true,
        'instance creation',
        3,
      );
      expect(suggestedFileName()).toBe('Dog-instance_creation.gs');
    });

    it('refuses the computed ALL/SESSION rows, which are not real categories', async () => {
      const ctl = makeController();

      await ctl.fileOutMethodCategory(new MethodCategoryItem(false, '** ALL METHODS **', true));

      expect(vscode.window.showSaveDialog).not.toHaveBeenCalled();
      expect(queries.fileOutMethodCategory).not.toHaveBeenCalled();
    });
  });

  describe('methods', () => {
    it('names the file after the one selected method', async () => {
      const ctl = makeController();

      await ctl.fileOutMethods([new MethodItem(false, SELECTOR('bark'))]);

      expect(writtenText()).toBe('fileformat utf8\n!\n\nMETHOD Dog>>bark\n');
      expect(suggestedFileName()).toBe('Dog-bark.gs');
    });

    it('sanitizes a keyword selector into the default file name', async () => {
      const ctl = makeController();

      await ctl.fileOutMethods([new MethodItem(false, SELECTOR('at:put:'))]);

      expect(suggestedFileName()).toBe('Dog-at_put_.gs');
    });

    it('writes a whole multi-selection into one file, one header', async () => {
      const ctl = makeController();

      await ctl.fileOutMethods([
        new MethodItem(false, SELECTOR('bark')),
        new MethodItem(true, SELECTOR('new')),
      ]);

      expect(writtenText()).toBe('fileformat utf8\n!\n\nMETHOD Dog>>bark\nMETHOD Dog class>>new\n');
      expect(suggestedFileName()).toBe('Dog-methods.gs');
    });

    it('does nothing with an empty selection', async () => {
      const ctl = makeController();

      await ctl.fileOutMethods([]);

      expect(vscode.window.showSaveDialog).not.toHaveBeenCalled();
    });

    it('asks for a class first when the pane has none selected', async () => {
      const ctl = makeController();
      ctl.state.className = undefined;

      await ctl.fileOutMethods([new MethodItem(false, SELECTOR('bark'))]);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('class'),
      );
      expect(vscode.window.showSaveDialog).not.toHaveBeenCalled();
    });
  });
});
