import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { ViewGrower } from '../viewGrower';

/** A grower whose panel gets `step` pixels taller (or shorter) on each command, reporting at once. */
function panel(start: number, onCommand: (command: string, height: number) => number) {
  const grower = new ViewGrower();
  let height = start;
  vi.mocked(vscode.commands.executeCommand).mockImplementation(async (command: string) => {
    height = onCommand(command, height);
    setTimeout(() => grower.report(height), 0);
    return undefined;
  });
  grower.report(start);
  return { grower, height: () => height };
}

describe('growing the panel to show results', () => {
  beforeEach(() => vi.mocked(vscode.commands.executeCommand).mockReset());

  it('grows a short panel step by step until it is tall enough', async () => {
    const { grower, height } = panel(100, (_c, h) => h + 50);

    await grower.growTo(320);

    expect(height()).toBe(350);
  });

  it('leaves a panel that is already tall enough alone', async () => {
    const { grower } = panel(400, (_c, h) => h + 50);

    await grower.growTo(320);

    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('switches to the other command when the first one shrinks the panel', async () => {
    const { grower, height } = panel(200, (c, h) =>
      c === 'workbench.action.increaseViewHeight' ? h - 50 : h + 50,
    );

    await grower.growTo(320);

    expect(height()).toBeGreaterThanOrEqual(320);
  });

  it('stops when the panel cannot get any taller', async () => {
    const { grower } = panel(200, (_c, h) => h);

    await grower.growTo(320);

    expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
  });
});
