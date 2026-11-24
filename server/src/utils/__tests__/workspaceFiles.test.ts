import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { isScannedFile } from '../workspaceFiles';

// Built from real paths, so a Windows run gets its drive letter.
const root = path.resolve('/project');
const uriOf = (...parts: string[]) => pathToFileURL(path.join(...parts)).toString();
const scanned = (uri: string) =>
  isScannedFile(uri, [pathToFileURL(root).toString()], ['.gs', '.st', '.tpz']);

describe('which files the workspace scan indexes', () => {
  it('includes a Smalltalk file anywhere under a workspace folder', () => {
    expect(scanned(uriOf(root, 'kernel.gs'))).toBe(true);
    expect(scanned(uriOf(root, 'src', 'model', 'Customer.st'))).toBe(true);
  });

  it('leaves out a file outside every workspace folder', () => {
    expect(scanned(uriOf(path.resolve('/tmp'), 'scratch.gs'))).toBe(false);
    expect(scanned(uriOf(`${root}-other`, 'kernel.gs'))).toBe(false);
  });

  it('leaves out a file under a dot-folder or node_modules, as the scan does', () => {
    expect(scanned(uriOf(root, '.git', 'kernel.gs'))).toBe(false);
    expect(scanned(uriOf(root, 'node_modules', 'pkg', 'kernel.gs'))).toBe(false);
  });

  it('leaves out a file of another kind, and anything not on disk', () => {
    expect(scanned(uriOf(root, 'notes.txt'))).toBe(false);
    expect(scanned('gemstone://1/UserGlobals/Foo/instance/x/bar.gs')).toBe(false);
  });

  it('leaves out a file URI that names no path on this machine, rather than failing', () => {
    expect(() => scanned('file://server/share/kernel.gs')).not.toThrow();
  });
});
