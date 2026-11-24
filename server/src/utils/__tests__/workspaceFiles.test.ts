import { describe, it, expect } from 'vitest';
import { isScannedFile } from '../workspaceFiles';

const folders = ['file:///project'];
const scanned = (uri: string) => isScannedFile(uri, folders, ['.gs', '.st', '.tpz']);

describe('which files the workspace scan indexes', () => {
  it('includes a Smalltalk file anywhere under a workspace folder', () => {
    expect(scanned('file:///project/kernel.gs')).toBe(true);
    expect(scanned('file:///project/src/model/Customer.st')).toBe(true);
  });

  it('leaves out a file outside every workspace folder', () => {
    expect(scanned('file:///tmp/scratch.gs')).toBe(false);
    expect(scanned('file:///project-other/kernel.gs')).toBe(false);
  });

  it('leaves out a file under a dot-folder or node_modules, as the scan does', () => {
    expect(scanned('file:///project/.git/kernel.gs')).toBe(false);
    expect(scanned('file:///project/node_modules/pkg/kernel.gs')).toBe(false);
  });

  it('leaves out a file of another kind, and anything not on disk', () => {
    expect(scanned('file:///project/notes.txt')).toBe(false);
    expect(scanned('gemstone://1/UserGlobals/Foo/instance/x/bar')).toBe(false);
  });
});
