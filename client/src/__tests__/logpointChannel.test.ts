import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { appendLogpoint, disposeLogpointChannel, getLogpointChannel } from '../logpointChannel';

describe('the logpoint channel', () => {
  beforeEach(() => {
    disposeLogpointChannel();
    vi.mocked(vscode.window.createOutputChannel).mockClear();
  });

  it('is named so the help text can send people to it', () => {
    // The hover, the breakpoint row and two warnings all name this channel. If
    // the name here and the name there ever drift, every one of them is a dead
    // end — see docs/output-channels.md.
    getLogpointChannel();
    expect(vi.mocked(vscode.window.createOutputChannel)).toHaveBeenCalledWith('GemStone Logpoints');
  });

  it('is one channel however many lines are written', () => {
    appendLogpoint('a', 'one');
    appendLogpoint('b', 'two');
    expect(vi.mocked(vscode.window.createOutputChannel)).toHaveBeenCalledTimes(1);
  });

  it('writes the source of a line beside it, so two logpoints are distinguishable', () => {
    const lines: string[] = [];
    const channel = getLogpointChannel() as unknown as {
      appendLine: (line: string) => void;
    };
    channel.appendLine = (line) => lines.push(line);

    appendLogpoint('Account>>deposit: @4', 'amount=100');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Account>>deposit: @4');
    expect(lines[0]).toContain('amount=100');
    // Timestamped, because what a logpoint on a loop tells you is usually when
    // and how often.
    expect(lines[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\]/);
  });
});
