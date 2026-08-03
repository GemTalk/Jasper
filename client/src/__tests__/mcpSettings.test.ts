import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { __resetConfig, __setConfig } from '../__mocks__/vscode';
import { readMcpSetting } from '../mcpSettings';

describe('readMcpSetting', () => {
  beforeEach(() => {
    __resetConfig();
  });

  it('prefers the new jasper.mcp setting when it is set', () => {
    __setConfig('jasper', 'mcp.httpPort', 30000);
    __setConfig('gemstone', 'mcp.httpPort', 40000);

    expect(readMcpSetting('httpPort', 27101)).toBe(30000);
  });

  it('falls back to a legacy gemstone.mcp setting configured before the rename', () => {
    __setConfig('gemstone', 'mcp.httpPort', 40000);

    expect(readMcpSetting('httpPort', 27101)).toBe(40000);
  });

  it('returns the default when neither the new nor the legacy setting is set', () => {
    expect(readMcpSetting('httpPort', 27101)).toBe(27101);
  });

  it('honors a legacy boolean set to false (not treated as unset)', () => {
    __setConfig('gemstone', 'mcp.registerWithClaudeDesktop', false);

    expect(readMcpSetting('registerWithClaudeDesktop', true)).toBe(false);
  });
});
