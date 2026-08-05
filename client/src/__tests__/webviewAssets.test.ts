import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('fs');

import * as fs from 'fs';
import * as path from 'path';
import { readWebviewScript } from '../webviewAssets';

// The module under test lives one level up from this test file, so its
// `__dirname` — the base of the lookup — is this directory's parent.
const moduleDir = path.resolve(__dirname, '..');

function scriptContents(contents: string): void {
  vi.mocked(fs.readFileSync).mockReturnValue(contents);
}

function pathRead(): string {
  return String(vi.mocked(fs.readFileSync).mock.calls[0][0]);
}

describe('reading a webview script from disk', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    scriptContents('');
  });

  it('reads from the sibling source tree, never the __dirname-adjacent path', () => {
    scriptContents('console.log("source");');

    const script = readWebviewScript('panel.js', 'refactoring');

    expect(pathRead()).toBe(path.join(moduleDir, '..', 'src', 'refactoring', 'panel.js'));
    expect(script).toBe('console.log("source");');
  });

  it('reads the script as UTF-8 text rather than raw bytes', () => {
    readWebviewScript('panel.js', 'refactoring');

    expect(vi.mocked(fs.readFileSync).mock.calls[0][1]).toBe('utf8');
  });

  it('resolves a script kept at the top of the tree without an empty path segment', () => {
    readWebviewScript('debuggerView.js');

    expect(pathRead()).toBe(path.join(moduleDir, '..', 'src', 'debuggerView.js'));
  });

  it('lets a missing script surface as the underlying read failure', () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    expect(() => readWebviewScript('gone.js', 'refactoring')).toThrow(/ENOENT/);
  });
});
