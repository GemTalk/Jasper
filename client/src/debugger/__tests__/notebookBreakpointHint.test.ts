import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { notebooks, workspace, NotebookCellKind } from '../../__mocks__/vscode';
import {
  registerNotebookBreakpointHint,
  NOTEBOOK_BREAKPOINT_HINT,
} from '../notebookBreakpointHint';
import { GEMSTONE_NOTEBOOK_TYPE } from '../../gemstoneNotebookKernel';
import { SMALLTALK_LANGUAGE } from '../../languageIds';

/**
 * The "Breakpoints not honored" item on a notebook cell's status bar: shown on Smalltalk code
 * cells only, and re-queried when a cell's language changes.
 */

interface Provider {
  onDidChangeCellStatusBarItems: (listener: () => void) => unknown;
  provideCellStatusBarItems(
    cell: unknown,
  ): Array<{ text: string; tooltip?: string; command?: string }>;
}

const cell = (kind: number, languageId: string) => ({ kind, document: { languageId } });

let provider: Provider;
let onOpen: (doc: { uri: { scheme: string } }) => void;

beforeEach(() => {
  vi.mocked(notebooks.registerNotebookCellStatusBarItemProvider).mockClear();
  vi.mocked(workspace.onDidOpenTextDocument).mockClear();
  registerNotebookBreakpointHint();
  const [type, registered] = vi.mocked(notebooks.registerNotebookCellStatusBarItemProvider).mock
    .calls[0];
  expect(type).toBe(GEMSTONE_NOTEBOOK_TYPE);
  provider = registered as Provider;
  onOpen = (
    vi.mocked(workspace.onDidOpenTextDocument).mock.calls[0] as unknown[]
  )[0] as typeof onOpen;
});

describe('the notebook breakpoint hint', () => {
  it('is shown on a Smalltalk code cell, and opens a workspace when clicked', () => {
    const items = provider.provideCellStatusBarItems(
      cell(NotebookCellKind.Code, SMALLTALK_LANGUAGE),
    );

    expect(items).toHaveLength(1);
    expect(items[0].text).toContain('Breakpoints not honored');
    expect(items[0].tooltip).toBe(NOTEBOOK_BREAKPOINT_HINT);
    expect(items[0].command).toBe('gemstone.openWorkspace');
  });

  it('is not shown on a markdown cell', () => {
    expect(
      provider.provideCellStatusBarItems(cell(NotebookCellKind.Markup, SMALLTALK_LANGUAGE)),
    ).toEqual([]);
  });

  it('is not shown on a code cell in another language', () => {
    expect(provider.provideCellStatusBarItems(cell(NotebookCellKind.Code, 'python'))).toEqual([]);
  });

  it('asks VS Code to redraw when a cell document reopens, as it does on a language change', () => {
    const redraw = vi.fn();
    provider.onDidChangeCellStatusBarItems(redraw);

    onOpen({ uri: { scheme: 'file' } });
    expect(redraw).not.toHaveBeenCalled();

    onOpen({ uri: { scheme: 'vscode-notebook-cell' } });
    expect(redraw).toHaveBeenCalledTimes(1);
  });
});
