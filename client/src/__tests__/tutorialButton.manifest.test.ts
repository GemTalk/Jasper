import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
import { SMALLTALK_CONTROLLER_ID } from '../smalltalkNotebookController';
import { GRAIL_CONTROLLER_ID } from '../grailNotebookController';

type Menu = { command: string; when?: string };
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8'));
const menus = manifest.contributes.menus as Record<string, Menu[]>;
const extensionId = `${manifest.publisher}.${manifest.name}`;

describe('Learn Smalltalk button', () => {
  const [entry] = menus['notebook/toolbar'].filter((m) => m.command === 'gemstone.openTutorial');
  // The when clause carries `notebookKernel =~ /…/`; VS Code sets notebookKernel
  // to `<extension id>/<controller id>`.
  const source = /notebookKernel =~ \/(.+?)\/ &&/.exec(entry.when!)![1];
  const kernelPattern = new RegExp(source);

  it('shows on a notebook running either GemStone kernel', () => {
    expect(entry.when).toContain('notebookType == jupyter-notebook');
    expect(kernelPattern.test(`${extensionId}/${SMALLTALK_CONTROLLER_ID}`)).toBe(true);
    expect(kernelPattern.test(`${extensionId}/${GRAIL_CONTROLLER_ID}`)).toBe(true);
  });

  it('does not show on the tutorial itself', () => {
    expect(entry.when).toContain('!gemstone.tutorialNotebookActive');
  });

  it("does not show on another extension's kernel", () => {
    expect(kernelPattern.test('ms-toolsai.jupyter/python3')).toBe(false);
  });

  it('is no longer in the Logins & Sessions title bar', () => {
    expect(menus['view/title'].some((m) => m.command === 'gemstone.openTutorial')).toBe(false);
  });
});

describe('Open Notebook button', () => {
  const titleBar = menus['view/title'].filter((m) =>
    ['gemstone.openWorkspace', 'gemstone.openNotebook'].includes(m.command),
  ) as Array<Menu & { group: string }>;
  const [workspace, notebook] = ['gemstone.openWorkspace', 'gemstone.openNotebook'].map((c) =>
    titleBar.find((m) => m.command === c)!,
  );

  it('is declared as a command with a title and icon', () => {
    const command = manifest.contributes.commands.find(
      (c: { command: string }) => c.command === 'gemstone.openNotebook',
    );
    expect(command).toMatchObject({ title: 'Open Notebook', icon: expect.any(String) });
  });

  it('sits right after Open Workspace in the Logins & Sessions title bar, under the same condition', () => {
    expect(notebook.when).toBe(workspace.when);
    const order = (group: string) => Number(group.split('@')[1]);
    expect(order(notebook.group)).toBe(order(workspace.group) + 1);
  });
});

describe('Switch Session button', () => {
  const [entry] = menus['notebook/toolbar'].filter((m) => m.command === 'gemstone.switchSession');
  const source = /notebookKernel =~ \/(.+)\/$/.exec(entry.when!)![1];
  const kernelPattern = new RegExp(source);

  it('shows on a notebook whose kernel follows the active session', () => {
    expect(kernelPattern.test(`${extensionId}/${SMALLTALK_CONTROLLER_ID}`)).toBe(true);
    expect(kernelPattern.test(`${extensionId}/${GRAIL_CONTROLLER_ID}`)).toBe(true);
    expect(entry.when).toContain('gemstone.hasActiveSession');
  });

  it('does not show on a kernel bound to one session, which switching would not move', () => {
    expect(kernelPattern.test(`${extensionId}/${SMALLTALK_CONTROLLER_ID}.session-2`)).toBe(false);
    expect(kernelPattern.test(`${extensionId}/${GRAIL_CONTROLLER_ID}.session-2`)).toBe(false);
  });
});
