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
});
