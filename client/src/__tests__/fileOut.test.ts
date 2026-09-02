import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { composeFileOut, fileOutFileName, sanitizeFileNameStem, saveFileOut } from '../fileOut';
import { LAST_DIRECTORY_KEY } from '../fileTransferDirectory';

describe('sanitizeFileNameStem', () => {
  it('leaves an ordinary class name alone', () => {
    expect(sanitizeFileNameStem('Association')).toBe('Association');
  });

  it('turns a keyword selector into a usable file name', () => {
    expect(sanitizeFileNameStem('at:put:')).toBe('at_put_');
  });

  it('collapses runs so a spaced category does not become a wall of underscores', () => {
    expect(sanitizeFileNameStem('Animal-instance creation')).toBe('Animal-instance_creation');
  });

  it('falls back rather than naming a file after a binary selector s punctuation', () => {
    expect(sanitizeFileNameStem('<=')).toBe('fileOut');
  });

  it('cannot produce a dotfile or a traversal', () => {
    expect(sanitizeFileNameStem('../../etc/passwd')).toBe('etc_passwd');
    expect(sanitizeFileNameStem('.hidden')).toBe('hidden');
  });
});

describe('fileOutFileName', () => {
  it('suffixes .gs, the extension Rowan and Jadeite both use', () => {
    expect(fileOutFileName('Animal')).toBe('Animal.gs');
    expect(fileOutFileName('Animal-at:put:')).toBe('Animal-at_put_.gs');
  });
});

describe('composeFileOut', () => {
  it('writes ONE header however many bodies there are', () => {
    const text = composeFileOut('fileformat utf8\n!', ['chunk a', 'chunk b']);
    expect(text.match(/fileformat utf8/g)).toHaveLength(1);
    expect(text).toContain('chunk a');
    expect(text).toContain('chunk b');
  });

  it('newline-terminates each body so two chunks cannot run together', () => {
    expect(composeFileOut('H', ['a %', 'b %'])).toBe('H\n\na %\nb %\n');
  });

  it('drops empty bodies instead of padding the file with blank chunks', () => {
    expect(composeFileOut('H', ['a', '   ', ''])).toBe('H\n\na\n');
  });
});

describe('saveFileOut', () => {
  const memento = {
    get: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn(),
  } as unknown as vscode.Memento;

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks resets calls but not implementations, and one test below makes
    // writeFileSync throw — restore both explicitly so a shuffled order can't leak it.
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [
      { uri: vscode.Uri.file('/ws') },
    ];
  });

  it('does not run the build when the user cancels the dialog', async () => {
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);
    const build = vi.fn().mockReturnValue('text');

    const uri = await saveFileOut({ title: 't', defaultFileName: 'a.gs', label: 'a', build });

    expect(uri).toBeUndefined();
    // Filing out a dictionary is an expensive query — cancelling must cost nothing.
    expect(build).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('writes the built text and remembers the directory it went to', async () => {
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(vscode.Uri.file('/out/dir/A.gs'));

    const uri = await saveFileOut({
      title: 'File Out Animal',
      defaultFileName: 'Animal.gs',
      label: 'Animal',
      build: () => 'the source',
      store: memento,
    });

    expect(uri?.fsPath).toBe(path.normalize('/out/dir/A.gs'));
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.normalize('/out/dir/A.gs'),
      'the source',
      'utf8',
    );
    expect(memento.update).toHaveBeenCalledWith(LAST_DIRECTORY_KEY, path.normalize('/out/dir'));
  });

  it('opens the dialog in the remembered directory when there is one', async () => {
    vi.mocked(memento.get).mockReturnValue('/previous');
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);

    await saveFileOut({
      title: 't',
      defaultFileName: 'Animal.gs',
      label: 'a',
      build: () => '',
      store: memento,
    });

    const options = vi.mocked(vscode.window.showSaveDialog).mock.calls[0][0];
    expect(options?.defaultUri?.fsPath).toBe(path.normalize('/previous/Animal.gs'));
  });

  it('falls back to the workspace root when the remembered directory is gone', async () => {
    vi.mocked(memento.get).mockReturnValue('/deleted');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);

    await saveFileOut({
      title: 't',
      defaultFileName: 'Animal.gs',
      label: 'a',
      build: () => '',
      store: memento,
    });

    const options = vi.mocked(vscode.window.showSaveDialog).mock.calls[0][0];
    expect(options?.defaultUri?.fsPath).toBe(path.normalize('/ws/Animal.gs'));
  });

  it('falls back to the home directory with no workspace open', async () => {
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = undefined;
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(undefined);

    await saveFileOut({ title: 't', defaultFileName: 'Animal.gs', label: 'a', build: () => '' });

    const options = vi.mocked(vscode.window.showSaveDialog).mock.calls[0][0];
    expect(options?.defaultUri?.fsPath).toBe(path.join(os.homedir(), 'Animal.gs'));
  });

  it('reports a failed build and writes nothing', async () => {
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(vscode.Uri.file('/out/A.gs'));

    const uri = await saveFileOut({
      title: 't',
      defaultFileName: 'A.gs',
      label: 'A',
      build: () => {
        throw new Error('session busy');
      },
      store: memento,
    });

    expect(uri).toBeUndefined();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('session busy'),
    );
    // A failed file-out must not move the remembered directory.
    expect(memento.update).not.toHaveBeenCalled();
  });

  it('reports a failed write and does not claim the file out succeeded', async () => {
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(vscode.Uri.file('/ro/A.gs'));
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('EACCES');
    });

    const uri = await saveFileOut({
      title: 't',
      defaultFileName: 'A.gs',
      label: 'A',
      build: () => 'text',
      store: memento,
    });

    expect(uri).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('EACCES'));
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('offers to open the file it wrote, and opens it when asked', async () => {
    vi.mocked(vscode.window.showSaveDialog).mockResolvedValue(vscode.Uri.file('/out/A.gs'));
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Open' as never);

    await saveFileOut({
      title: 't',
      defaultFileName: 'A.gs',
      label: 'Animal',
      build: () => 'text',
      store: memento,
    });
    // The notification is deliberately not awaited by saveFileOut, so let it settle.
    await Promise.resolve();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Filed out Animal to A.gs'),
      'Open',
    );
    expect(vscode.window.showTextDocument).toHaveBeenCalled();
  });
});
