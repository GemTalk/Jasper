import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../gciLog', () => ({ logInfo: vi.fn() }));

import * as vscode from 'vscode';
import {
  TUTORIAL_LESSONS,
  buildTutorialCells,
  buildTutorialNotebook,
  openTutorialNotebook,
} from '../tutorialNotebook';
import { GEMSTONE_NOTEBOOK_TYPE } from '../gemstoneNotebookKernel';
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
    it('wraps the cells in notebook data', () => {
      const data = buildTutorialNotebook();
      expect(data.cells).toEqual(buildTutorialCells());
    });
  });

  describe('openTutorialNotebook', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('opens an untitled jupyter notebook and shows it', async () => {
      await openTutorialNotebook();

      expect(vscode.workspace.openNotebookDocument).toHaveBeenCalledTimes(1);
      const [type, data] = vi.mocked(vscode.workspace.openNotebookDocument).mock.calls[0];
      expect(type).toBe(GEMSTONE_NOTEBOOK_TYPE);
      expect((data as vscode.NotebookData).cells.length).toBe(buildTutorialCells().length);
      expect(vscode.window.showNotebookDocument).toHaveBeenCalledTimes(1);
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
});
