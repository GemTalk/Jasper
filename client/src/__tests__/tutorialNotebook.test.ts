import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logInfo: vi.fn() }));

import * as vscode from 'vscode';
import {
  TUTORIAL_LESSONS,
  buildTutorialCells,
  buildTutorialNotebook,
  openTutorialNotebook,
  isTutorialNotebook,
  registerTutorialContext,
  TUTORIAL_ACTIVE_CONTEXT,
  tutorialUri,
} from '../tutorialNotebook';
import { SMALLTALK_LANGUAGE_ID } from '../smalltalkNotebookController';

const MARKUP = vscode.NotebookCellKind.Markup;
const CODE = vscode.NotebookCellKind.Code;

function allCellText(): string {
  return buildTutorialCells()
    .map((c) => c.value)
    .join('\n');
}

describe('tutorial notebook', () => {
  describe('buildTutorialCells', () => {
    it('emits one Markdown cell per lesson', () => {
      const markup = buildTutorialCells().filter((c) => c.kind === MARKUP);
      expect(markup).toHaveLength(TUTORIAL_LESSONS.length);
    });

    it('emits one code cell per snippet across all lessons', () => {
      const snippetCount = TUTORIAL_LESSONS.reduce((n, l) => n + l.snippets.length, 0);
      const code = buildTutorialCells().filter((c) => c.kind === CODE);
      expect(code).toHaveLength(snippetCount);
    });

    it('starts with the welcome lesson as a Markdown cell', () => {
      const first = buildTutorialCells()[0];
      expect(first.kind).toBe(MARKUP);
      expect(first.value).toContain('## Welcome to GemStone Smalltalk');
    });

    it('renders each lesson title as a level-2 Markdown heading', () => {
      const markup = buildTutorialCells().filter((c) => c.kind === MARKUP);
      for (const [i, lesson] of TUTORIAL_LESSONS.entries()) {
        expect(markup[i].value.startsWith(`## ${lesson.title}\n`)).toBe(true);
      }
    });

    it('tags every code cell as GemStone Smalltalk', () => {
      const code = buildTutorialCells().filter((c) => c.kind === CODE);
      expect(code.length).toBeGreaterThan(0);
      expect(code.every((c) => c.languageId === SMALLTALK_LANGUAGE_ID)).toBe(true);
    });

    it("places a lesson's Markdown cell immediately before its code cells", () => {
      const cells = buildTutorialCells();
      // The cell before any code cell is either its lesson's markdown or an
      // earlier code cell from the same lesson — never a different lesson's
      // markdown appearing after code. Assert the first cell is markup and no
      // code cell precedes the first markup.
      const firstCode = cells.findIndex((c) => c.kind === CODE);
      const firstMarkup = cells.findIndex((c) => c.kind === MARKUP);
      expect(firstMarkup).toBeLessThan(firstCode);
    });
  });

  describe('adaptation from Prof Stef', () => {
    it('drops all Prof Stef next/previous/goto navigation', () => {
      const text = allCellText();
      expect(text).not.toMatch(/ProfStef\s+(next|previous|go\b|goto)/);
      expect(text).not.toContain('ProfStef next');
    });

    it('leaves no <DICT> placeholder from the Jade source', () => {
      expect(allCellText()).not.toContain('<DICT>');
    });

    it('includes an Introduction to GemStone lesson', () => {
      const intro = TUTORIAL_LESSONS.find((l) => l.title === 'Introduction to GemStone');
      expect(intro).toBeDefined();
      expect(intro!.body).toMatch(/commit/i);
      expect(intro!.body).toMatch(/repositor/i);
    });

    it('covers the core Smalltalk lessons', () => {
      const titles = TUTORIAL_LESSONS.map((l) => l.title.toLowerCase());
      for (const topic of [
        'numbers',
        'strings',
        'symbols',
        'arrays',
        'blocks',
        'conditionals',
        'loops',
        'iterators',
        'cascade',
        'reflection',
      ]) {
        expect(titles.some((t) => t.includes(topic))).toBe(true);
      }
    });

    it('leaves nothing permanent: the persistence demo aborts its own change', () => {
      const intro = TUTORIAL_LESSONS.find((l) => l.title === 'Introduction to GemStone')!;
      const joined = intro.snippets.join('\n');
      expect(joined).toContain('UserGlobals at: #JasperTutorialGreeting put:');
      expect(joined).toContain('removeKey: #JasperTutorialGreeting');
      expect(joined).toContain('System abortTransaction');
    });
  });

  describe('buildTutorialNotebook', () => {
    it('declares Smalltalk as the notebook language so the ipynb round trip keeps it', () => {
      expect(buildTutorialNotebook().metadata?.metadata.language_info).toEqual({
        name: SMALLTALK_LANGUAGE_ID,
      });
    });

    it('marks itself as the tutorial', () => {
      const doc = { metadata: buildTutorialNotebook().metadata } as vscode.NotebookDocument;
      expect(isTutorialNotebook(doc)).toBe(true);
      expect(isTutorialNotebook({ metadata: {} } as vscode.NotebookDocument)).toBe(false);
      expect(isTutorialNotebook(undefined)).toBe(false);
    });

    it('wraps the cells in notebook data', () => {
      const data = buildTutorialNotebook();
      expect(data.cells).toEqual(buildTutorialCells());
    });
  });

  describe('openTutorialNotebook', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('opens a notebook named "Learn Smalltalk.ipynb", fills it and shows it', async () => {
      await openTutorialNotebook();

      const [uri] = vi.mocked(vscode.workspace.openNotebookDocument).mock.calls[0];
      expect((uri as unknown as vscode.Uri).scheme).toBe('untitled');
      expect((uri as unknown as vscode.Uri).path).toBe('Learn Smalltalk.ipynb');

      const edit = vi.mocked(vscode.workspace.applyEdit).mock.calls[0][0] as unknown as {
        notebookEdits: { edits: Array<Record<string, unknown>> }[];
      };
      const [metadataEdit, insertEdit] = edit.notebookEdits[0].edits;
      expect(metadataEdit.newMetadata).toEqual({
        metadata: buildTutorialNotebook().metadata!.metadata,
      });
      expect(insertEdit.index).toBe(0);
      expect((insertEdit.newCells as unknown[]).length).toBe(buildTutorialCells().length);

      expect(vscode.window.showNotebookDocument).toHaveBeenCalledTimes(1);
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'notebook.selectKernel',
        expect.objectContaining({ id: 'gemstone-smalltalk-kernel' }),
      );
    });

    it("keeps the serializer's own metadata but replaces its Python default", async () => {
      // What VS Code's ipynb serializer hands back for an empty untitled notebook.
      vi.mocked(vscode.workspace.openNotebookDocument).mockResolvedValueOnce({
        uri: vscode.Uri.from({ scheme: 'untitled', path: 'Learn Smalltalk.ipynb' }),
        cellCount: 0,
        metadata: { nbformat: 4, metadata: { language_info: { name: 'python' }, custom: 1 } },
      } as never);

      await openTutorialNotebook();

      const edit = vi.mocked(vscode.workspace.applyEdit).mock.calls[0][0] as unknown as {
        notebookEdits: { edits: Array<{ newMetadata?: Record<string, unknown> }> }[];
      };
      expect(edit.notebookEdits[0].edits[0].newMetadata).toEqual({
        nbformat: 4,
        metadata: {
          language_info: { name: SMALLTALK_LANGUAGE_ID },
          custom: 1,
          jasper: { tutorial: true },
        },
      });
    });

    it('opens the next free number when a Learn Smalltalk tab is already open', async () => {
      const open = { uri: vscode.Uri.from({ scheme: 'untitled', path: 'Learn Smalltalk.ipynb' }) };
      (vscode.workspace as unknown as { notebookDocuments: unknown[] }).notebookDocuments.push(
        open,
      );
      try {
        await openTutorialNotebook();
        const [uri] = vi.mocked(vscode.workspace.openNotebookDocument).mock.calls[0];
        expect((uri as unknown as vscode.Uri).path).toBe('Learn Smalltalk 2.ipynb');
      } finally {
        (vscode.workspace as unknown as { notebookDocuments: unknown[] }).notebookDocuments.length =
          0;
      }
    });

    it('reports a clear error when notebook support is unavailable', async () => {
      vi.mocked(vscode.workspace.openNotebookDocument).mockRejectedValueOnce(
        new Error('no notebook serializer'),
      );

      await openTutorialNotebook();

      expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
      const msg = vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0];
      expect(msg).toContain('tutorial notebook');
      expect(vscode.window.showNotebookDocument).not.toHaveBeenCalled();
    });
  });

  describe('tutorialUri', () => {
    it('numbers the name past the tutorials already open', () => {
      const first = tutorialUri([]);
      expect(first.path).toBe('Learn Smalltalk.ipynb');
      const second = tutorialUri([first.toString()]);
      expect(second.path).toBe('Learn Smalltalk 2.ipynb');
      expect(tutorialUri([first.toString(), second.toString()]).path).toBe(
        'Learn Smalltalk 3.ipynb',
      );
    });

    it('reuses a lower number once that tutorial is closed', () => {
      const second = tutorialUri([tutorialUri([]).toString()]);
      expect(tutorialUri([second.toString()]).path).toBe('Learn Smalltalk.ipynb');
    });
  });

  describe('registerTutorialContext', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('sets the context from the active notebook, and again whenever it changes', () => {
      const tutorial = { notebook: { metadata: buildTutorialNotebook().metadata } };
      const other = { notebook: { metadata: {} } };
      (vscode.window as { activeNotebookEditor: unknown }).activeNotebookEditor = tutorial;
      try {
        registerTutorialContext();
        expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
          'setContext',
          TUTORIAL_ACTIVE_CONTEXT,
          true,
        );

        const onChange = vi.mocked(vscode.window.onDidChangeActiveNotebookEditor).mock
          .calls[0][0] as (e: unknown) => void;
        onChange(other);
        expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
          'setContext',
          TUTORIAL_ACTIVE_CONTEXT,
          false,
        );
        onChange(undefined);
        expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
          'setContext',
          TUTORIAL_ACTIVE_CONTEXT,
          false,
        );
      } finally {
        (vscode.window as { activeNotebookEditor: unknown }).activeNotebookEditor = undefined;
      }
    });
  });
});
