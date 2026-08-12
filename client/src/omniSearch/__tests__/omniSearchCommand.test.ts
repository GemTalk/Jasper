import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { buildOmniHandlers } from '../omniSearchCommand';

describe('buildOmniHandlers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reveals a dictionary by name via the Explorer command, not a bare pane focus', () => {
    void buildOmniHandlers().revealDictionary({
      kind: 'revealDictionary',
      sessionId: 1,
      dictName: 'V8SplitDemo',
    });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.explorer.revealDictionary',
      'V8SplitDemo',
    );
  });

  it('jumps a global to the class of its value, not to the dictionary', () => {
    void buildOmniHandlers().revealGlobal({
      kind: 'revealGlobal',
      sessionId: 1,
      dictName: 'Globals',
      name: 'Transcript',
      className: 'GsTerminalStream',
    });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.explorer.findClass',
      'GsTerminalStream',
    );
  });

  it('reveals a class category via dict + path, not just the dictionary', () => {
    void buildOmniHandlers().revealCategory({
      kind: 'revealCategory',
      sessionId: 1,
      dictName: 'Globals',
      dictIndex: 1,
      category: 'Kernel-Objects',
    });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'gemstone.explorer.revealCategory',
      'Globals',
      'Kernel-Objects',
    );
  });
});
