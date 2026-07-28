import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('fs');

import * as fs from 'fs';
import * as path from 'path';
import { readWebviewScript } from '../webviewAssets';

// The module under test lives one level up from this test file, so its
// `__dirname` — the base of both lookups — is this directory's parent.
const moduleDir = path.resolve(__dirname, '..');

function scriptExistsBesideTheModule(exists: boolean): void {
  vi.mocked(fs.existsSync).mockReturnValue(exists);
}

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

  it('reads the copy that sits beside the module when one is there', () => {
    scriptExistsBesideTheModule(true);
    scriptContents('console.log("beside");');

    const script = readWebviewScript('panel.js', 'refactoring');

    expect(pathRead()).toBe(path.join(moduleDir, 'refactoring', 'panel.js'));
    expect(script).toBe('console.log("beside");');
  });

  it('reads the script as UTF-8 text rather than raw bytes', () => {
    scriptExistsBesideTheModule(true);

    readWebviewScript('panel.js', 'refactoring');

    expect(vi.mocked(fs.readFileSync).mock.calls[0][1]).toBe('utf8');
  });

  it('falls back to the sibling source tree when nothing sits beside the module', () => {
    scriptExistsBesideTheModule(false);
    scriptContents('console.log("bundled");');

    const script = readWebviewScript('panel.js', 'refactoring');

    expect(pathRead()).toBe(path.join(moduleDir, '..', 'src', 'refactoring', 'panel.js'));
    expect(script).toBe('console.log("bundled");');
  });

  it('resolves a script kept at the top of the tree without an empty path segment', () => {
    scriptExistsBesideTheModule(true);

    readWebviewScript('debuggerView.js');

    expect(pathRead()).toBe(path.join(moduleDir, 'debuggerView.js'));
  });

  it('resolves the fallback for a top-of-tree script without an empty path segment', () => {
    scriptExistsBesideTheModule(false);

    readWebviewScript('debuggerView.js');

    expect(pathRead()).toBe(path.join(moduleDir, '..', 'src', 'debuggerView.js'));
  });

  it('lets a missing script surface as the underlying read failure', () => {
    scriptExistsBesideTheModule(false);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    expect(() => readWebviewScript('gone.js', 'refactoring')).toThrow(/ENOENT/);
  });
});
