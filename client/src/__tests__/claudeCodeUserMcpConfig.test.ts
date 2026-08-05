import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('fs');

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { claudeCodeUserConfigPath, writeClaudeCodeUserMcpConfig } from '../claudeCodeUserMcpConfig';
import { proxyScriptPath } from '../mcpSocketServer';

const desiredEntry = (extPath: string, sockPath: string) => ({
  type: 'stdio',
  command: 'node',
  args: [proxyScriptPath(extPath), '--proxy-socket', sockPath],
  env: {},
});

// A pre-rename `gemstone` entry that Jasper itself wrote — same proxy script,
// possibly a different (older, workspace-hashed) socket.
const legacyJasperEntry = (extPath: string, sockPath: string) => ({
  command: 'node',
  args: [proxyScriptPath(extPath), '--proxy-socket', sockPath],
});

// A `gemstone` entry owned by something else (e.g. the GemStone-native MCP
// server). Must never be removed by Jasper's migration cleanup.
const foreignGemstoneEntry = { command: 'gemstone-mcp', args: ['--serve'] };

describe('claudeCodeUserConfigPath', () => {
  it('resolves to ~/.claude.json', () => {
    expect(claudeCodeUserConfigPath()).toBe(path.join(os.homedir(), '.claude.json'));
  });
});

describe('writeClaudeCodeUserMcpConfig', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.writeFileSync).mockClear();
  });

  it('writes a single user-scope jasper entry under top-level mcpServers', () => {
    const result = writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    expect(result.updated).toBe(true);
    expect(result.skipped).toBeUndefined();
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string);
    expect(written.mcpServers.jasper).toEqual(desiredEntry('/ext', '/tmp/socket.sock'));
  });

  it('does not rewrite when the entry is already correct', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        mcpServers: { jasper: desiredEntry('/ext', '/tmp/socket.sock') },
      }),
    );

    const result = writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    expect(result.updated).toBe(false);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('rewrites when the proxy path has changed (e.g., extension version bump)', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        mcpServers: { jasper: desiredEntry('/OLD-ext', '/tmp/socket.sock') },
      }),
    );

    const result = writeClaudeCodeUserMcpConfig('/NEW-ext', '/tmp/socket.sock');

    expect(result.updated).toBe(true);
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string);
    expect(written.mcpServers.jasper.args[0]).toContain('NEW-ext');
  });

  it('preserves unrelated top-level mcpServers entries', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        mcpServers: {
          'claude-context': { command: 'other' },
        },
      }),
    );

    writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string);
    expect(written.mcpServers['claude-context']).toEqual({ command: 'other' });
    expect(written.mcpServers.jasper).toBeDefined();
  });

  it('preserves unrelated top-level keys like projects', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        userID: 'abc-123',
        projects: { '/some/path': { history: ['a', 'b'] } },
      }),
    );

    writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string);
    expect(written.userID).toBe('abc-123');
    expect(written.projects['/some/path'].history).toEqual(['a', 'b']);
  });

  it("removes the pre-rename top-level gemstone entry when it is Jasper's own proxy", () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        mcpServers: { gemstone: legacyJasperEntry('/ext', '/tmp/OLD.sock') },
      }),
    );

    const result = writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    expect(result.updated).toBe(true);
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string);
    expect(written.mcpServers.gemstone).toBeUndefined();
    expect(written.mcpServers.jasper).toEqual(desiredEntry('/ext', '/tmp/socket.sock'));
  });

  it('keeps a foreign top-level gemstone entry (e.g. the native GemStone MCP server)', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        mcpServers: { gemstone: foreignGemstoneEntry },
      }),
    );

    writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string);
    expect(written.mcpServers.gemstone).toEqual(foreignGemstoneEntry);
    expect(written.mcpServers.jasper).toBeDefined();
  });

  it('removes legacy project-scope entries left by previous `claude mcp add`', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        projects: {
          '/Users/me/Grail': {
            mcpServers: {
              gemstone: legacyJasperEntry('/ext', '/tmp/grail-hashed.sock'),
              'other-mcp': { command: 'keep-me' },
            },
          },
          '/Users/me/WebGS': {
            mcpServers: {
              gemstone: legacyJasperEntry('/ext', '/tmp/webgs-hashed.sock'),
            },
          },
          '/Users/me/Untouched': {
            history: ['something'],
          },
        },
      }),
    );

    const result = writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    expect(result.updated).toBe(true);
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string);
    expect(written.projects['/Users/me/Grail'].mcpServers.gemstone).toBeUndefined();
    expect(written.projects['/Users/me/Grail'].mcpServers['other-mcp']).toEqual({
      command: 'keep-me',
    });
    expect(written.projects['/Users/me/WebGS'].mcpServers.gemstone).toBeUndefined();
    expect(written.projects['/Users/me/Untouched'].history).toEqual(['something']);
  });

  it('keeps a foreign project-scope gemstone entry', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        projects: {
          '/Users/me/Grail': {
            mcpServers: { gemstone: foreignGemstoneEntry },
          },
        },
      }),
    );

    writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const written = JSON.parse(writeCall[1] as string);
    expect(written.projects['/Users/me/Grail'].mcpServers.gemstone).toEqual(foreignGemstoneEntry);
  });

  it('rewrites when only the legacy-project cleanup applies', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        mcpServers: { jasper: desiredEntry('/ext', '/tmp/socket.sock') },
        projects: {
          '/Users/me/Grail': {
            mcpServers: { gemstone: legacyJasperEntry('/ext', '/tmp/grail-hashed.sock') },
          },
        },
      }),
    );

    const result = writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    expect(result.updated).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it('skips with "missing" when ~/.claude.json does not exist (does not create it)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    expect(result.skipped).toBe('missing');
    expect(result.updated).toBe(false);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('skips with "unreadable" when the file cannot be parsed (does not clobber)', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('this-is-not-json');

    const result = writeClaudeCodeUserMcpConfig('/ext', '/tmp/socket.sock');

    expect(result.skipped).toBe('unreadable');
    expect(result.updated).toBe(false);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
});
