import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
  writeFileSync: vi.fn(),
}));
vi.mock('../browserQueries', () => ({
  fileInChunk: vi.fn(() => 'ok'),
  compileMethod: vi.fn(() => 'Compiled'),
  removeAllMethods: vi.fn(() => 'ok'),
}));

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as queries from '../browserQueries';
import { fileInFile, fileInUris, fileInCommand } from '../fileIn';
import type { ActiveSession, SessionManager } from '../sessionManager';

/**
 * Filing a Topaz `.gs` file back into a session (issue #539).
 *
 * The runner's job is to do every step the file asks for, in order, and to keep going
 * when one fails — a developer filing in a class with one bad method wants the other
 * twenty compiled and the bad one named. These read back what reached the query layer.
 */

const SESSION = { id: 1 } as ActiveSession;

/** A filesystem holding the given absolute-path → content pairs. */
function withFiles(files: Record<string, string>): void {
  vi.mocked(fs.readFileSync).mockImplementation(((p: string) => {
    const content = files[path.resolve(p)];
    if (content === undefined) throw new Error(`ENOENT: ${p}`);
    return content;
  }) as unknown as typeof fs.readFileSync);
}

/**
 * An absolute path in the exact shape the code under test will see it.
 *
 * On Windows these two disagree: `path.resolve('/src/x.gs')` takes the cwd's drive
 * letter as-is (`D:\src\x.gs`), while `Uri.fsPath` lowercases it (`d:\src\x.gs` —
 * vscode-uri's `uriToFsPath`). The mock filesystem below is a plain object, so a
 * fixture keyed the first way is simply invisible to a file-in that arrived through
 * a `Uri`, and every Uri-driven test fails while the ones passing a raw path pass.
 * Routing both through `Uri.file` puts them on one key. A no-op off Windows.
 */
const at = (p: string): string => vscode.Uri.file(path.resolve(p)).fsPath;

const A_GS = at('/src/Animal.gs');
const D_GS = at('/src/Dog.gs');
const LOADER = at('/src/Animals.gs');
const TPZ = at('/src/script.tpz');

const CLASS_FILE = [
  'fileformat utf8',
  '!',
  '! From GemStone/S 64 Bit 3.7.5',
  '!',
  'set compile_env: 0',
  'expectvalue /Class',
  'doit',
  "Object subclass: 'Animal' instVarNames: #('name') inDictionary: UserGlobals",
  '%',
  'removeAllMethods Animal',
  'removeAllClassMethods Animal',
  "category: 'accessing'",
  'method: Animal',
  'name',
  '\t^name',
  '%',
  "category: 'instance creation'",
  'classmethod: Animal',
  'new',
  '\t^super new',
  '%',
].join('\n');

describe('fileInFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queries.fileInChunk).mockReturnValue('ok');
    vi.mocked(queries.compileMethod).mockReturnValue('Compiled');
    vi.mocked(queries.removeAllMethods).mockReturnValue('ok');
  });

  it('runs every step of a class file-out, in order', () => {
    withFiles({ [A_GS]: CLASS_FILE });

    const outcome = fileInFile(SESSION, A_GS);

    expect(outcome.errors).toEqual([]);
    expect(outcome.executed).toBe(1);
    expect(outcome.compiled).toBe(2);
    expect(outcome.removed).toBe(2);
    expect(outcome.files).toBe(1);
    expect(queries.fileInChunk).toHaveBeenCalledWith(SESSION, expect.stringContaining('subclass:'));
    expect(queries.removeAllMethods).toHaveBeenCalledWith(SESSION, 'Animal', false);
    expect(queries.removeAllMethods).toHaveBeenCalledWith(SESSION, 'Animal', true);
  });

  it('compiles each method into the category and side the file put it in', () => {
    withFiles({ [A_GS]: CLASS_FILE });

    fileInFile(SESSION, A_GS);

    expect(queries.compileMethod).toHaveBeenCalledWith(
      SESSION,
      'Animal',
      false,
      'accessing',
      'name\n\t^name',
      0,
    );
    expect(queries.compileMethod).toHaveBeenCalledWith(
      SESSION,
      'Animal',
      true,
      'instance creation',
      'new\n\t^super new',
      0,
    );
  });

  it('keeps going after a failing method and names the one that failed', () => {
    withFiles({ [A_GS]: CLASS_FILE });
    vi.mocked(queries.compileMethod).mockImplementationOnce(() => {
      throw new Error('CompileError: undefined symbol');
    });

    const outcome = fileInFile(SESSION, A_GS);

    // The class-side method still went in.
    expect(outcome.compiled).toBe(1);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].message).toContain('Animal>>name');
    expect(outcome.errors[0].message).toContain('undefined symbol');
    // Line numbers are 1-based, as an editor shows them: `name` is on line 14.
    expect(outcome.errors[0].line).toBe(14);
    expect(outcome.errors[0].file).toBe(A_GS);
  });

  it('follows an input line, resolving it beside the file that named it', () => {
    withFiles({
      [LOADER]: ['doit', 'UserGlobals at: #Animals put: nil', '%', 'input Animal.gs'].join('\n'),
      [A_GS]: CLASS_FILE,
    });

    const outcome = fileInFile(SESSION, LOADER);

    expect(outcome.files).toBe(2);
    expect(outcome.executed).toBe(2);
    expect(outcome.compiled).toBe(2);
  });

  it('does not loop on files that input each other', () => {
    withFiles({
      [A_GS]: 'input Dog.gs',
      [D_GS]: 'input Animal.gs',
    });

    const outcome = fileInFile(SESSION, A_GS);

    expect(outcome.files).toBe(2);
    expect(outcome.errors).toEqual([]);
  });

  it('reports an input naming a file that is not there', () => {
    withFiles({ [LOADER]: 'input Missing.gs' });

    const outcome = fileInFile(SESSION, LOADER);

    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].message).toContain('Could not read');
    expect(outcome.errors[0].file).toBe(at('/src/Missing.gs'));
  });

  it('reports a directive it does not recognise, and runs the rest of the file', () => {
    withFiles({
      [A_GS]: ['wibble', 'doit', "Object subclass: 'Animal'", '%'].join('\n'),
    });

    const outcome = fileInFile(SESSION, A_GS);

    expect(outcome.executed).toBe(1);
    expect(outcome.errors).toEqual([]);
    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.skipped[0].message).toContain('wibble');
  });

  it('runs a topaz script s chunks and leaves its topaz commands alone', () => {
    withFiles({
      [TPZ]: [
        'set gemstone gs64stone',
        'set user DataCurator password swordfish',
        'login',
        'run',
        "Object subclass: 'Animal'",
        '%',
        'commit',
        'logout',
        'exit',
      ].join('\n'),
    });

    const outcome = fileInFile(SESSION, TPZ);

    expect(outcome.executed).toBe(1);
    // The preamble is recognised as topaz's own, not reported as gibberish.
    expect(outcome.skipped).toEqual([]);
    expect(outcome.ignored.map((n) => n.message)).toEqual([
      'Topaz command not run: set gemstone gs64stone',
      'Topaz command not run: set user DataCurator password swordfish',
      'Topaz command not run: login',
      'Topaz command not run: commit',
      'Topaz command not run: logout',
    ]);
    expect(outcome.askedToCommit).toBe(true);
    expect(outcome.stopped).toBe(true);
  });

  it('reads no further than exit, as topaz would', () => {
    withFiles({
      [TPZ]: ['doit', "Object subclass: 'Animal'", '%', 'exit', 'doit', 'Never run', '%'].join(
        '\n',
      ),
    });

    const outcome = fileInFile(SESSION, TPZ);

    expect(outcome.executed).toBe(1);
    expect(queries.fileInChunk).not.toHaveBeenCalledWith(SESSION, 'Never run');
  });

  it('stops the files an exit-ing file pulled it in beside', () => {
    withFiles({
      [LOADER]: ['input Animal.gs', 'input Dog.gs'].join('\n'),
      [A_GS]: 'exit',
      [D_GS]: CLASS_FILE,
    });

    const outcome = fileInFile(SESSION, LOADER);

    expect(outcome.stopped).toBe(true);
    expect(outcome.files).toBe(2);
    expect(outcome.compiled).toBe(0);
  });

  it('reads a file that starts with a byte-order mark', () => {
    withFiles({ [A_GS]: `\uFEFF${CLASS_FILE}` });

    const outcome = fileInFile(SESSION, A_GS);

    expect(outcome.errors).toEqual([]);
    expect(outcome.skipped).toEqual([]);
    expect(outcome.executed).toBe(1);
  });

  it('reports a file it cannot read rather than throwing', () => {
    withFiles({});

    const outcome = fileInFile(SESSION, A_GS);

    expect(outcome.files).toBe(0);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0].message).toContain('Could not read');
  });
});

describe('the File In command', () => {
  const memento = {
    get: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn(),
  } as unknown as vscode.Memento;

  const sessionManager = (session: ActiveSession | undefined) =>
    ({ resolveSession: () => Promise.resolve(session) }) as unknown as SessionManager;

  /** A session manager that would refuse to answer — proves a caller-named session
   *  is used without asking. */
  const wouldAsk = () =>
    ({
      resolveSession: () => Promise.reject(new Error('should not have asked')),
    }) as unknown as SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(queries.fileInChunk).mockReturnValue('ok');
    vi.mocked(queries.compileMethod).mockReturnValue('Compiled');
    vi.mocked(queries.removeAllMethods).mockReturnValue('ok');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
    vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined);
    withFiles({ [A_GS]: CLASS_FILE });
  });

  it('does nothing when the user cancels the file picker', async () => {
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined);

    await fileInCommand(sessionManager(SESSION), memento);

    expect(queries.fileInChunk).not.toHaveBeenCalled();
  });

  it('opens the picker in the folder the last file-out went to', async () => {
    vi.mocked(memento.get).mockReturnValue('/src');
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined);

    await fileInCommand(sessionManager(SESSION), memento);

    const options = vi.mocked(vscode.window.showOpenDialog).mock.calls[0][0];
    expect(options?.defaultUri?.fsPath).toBe(path.normalize('/src'));
  });

  it('asks which session before writing anything, and stops if there is none', async () => {
    await fileInUris(sessionManager(undefined), [vscode.Uri.file(A_GS)], memento);

    expect(queries.fileInChunk).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('files into the session the caller named, without asking which', async () => {
    // The ⤓ on a session row in Logins & Sessions, and the one on the GemStone
    // Explorer, both know their session — so the usual "which session?" prompt would
    // be a question already answered.
    const named = { id: 7 } as ActiveSession;

    await fileInUris(wouldAsk(), [vscode.Uri.file(A_GS)], memento, named);

    expect(queries.fileInChunk).toHaveBeenCalledWith(named, expect.stringContaining('subclass:'));
  });

  it('passes the caller s session through the file picker to the file-in', async () => {
    const named = { id: 7 } as ActiveSession;
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([vscode.Uri.file(A_GS)]);

    await fileInCommand(wouldAsk(), memento, named);

    expect(queries.compileMethod).toHaveBeenCalledWith(
      named,
      'Animal',
      false,
      'accessing',
      expect.any(String),
      0,
    );
  });

  it('says what went in, and that it is not committed', async () => {
    await fileInUris(sessionManager(SESSION), [vscode.Uri.file(A_GS)], memento);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Not committed'),
    );
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('says so plainly when the file asked to commit and did not get one', async () => {
    withFiles({ [TPZ]: ['doit', "Object subclass: 'Animal'", '%', 'commit'].join('\n') });

    await fileInUris(sessionManager(SESSION), [vscode.Uri.file(TPZ)], memento);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('The file asked to commit; Jasper did not'),
      'Show Log',
    );
  });

  it('stops filing in further picked files once one says exit', async () => {
    withFiles({ [TPZ]: 'exit', [D_GS]: CLASS_FILE });

    await fileInUris(
      sessionManager(SESSION),
      [vscode.Uri.file(TPZ), vscode.Uri.file(D_GS)],
      memento,
    );

    expect(queries.compileMethod).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Stopped where the file said exit'),
    );
  });

  it('remembers the folder it filed in from, so the next file-out lands there', async () => {
    await fileInUris(sessionManager(SESSION), [vscode.Uri.file(A_GS)], memento);

    // The folder of the file that went in — derived from the fixture rather than
    // restated, so it carries the same drive-letter shape `at` produces.
    expect(memento.update).toHaveBeenCalledWith(
      'gemstone.fileInOut.lastDirectory',
      path.dirname(A_GS),
    );
  });

  it('reports errors with the first one named, and offers the log', async () => {
    vi.mocked(queries.compileMethod).mockImplementation(() => {
      throw new Error('CompileError: nope');
    });

    await fileInUris(sessionManager(SESSION), [vscode.Uri.file(A_GS)], memento);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('2 error(s)'),
      'Show Log',
    );
  });

  it('files in several chosen files into one report', async () => {
    withFiles({ [A_GS]: CLASS_FILE, [D_GS]: CLASS_FILE });

    await fileInUris(
      sessionManager(SESSION),
      [vscode.Uri.file(A_GS), vscode.Uri.file(D_GS)],
      memento,
    );

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('4 method(s)'),
    );
  });

  it('refreshes the Explorer so the new code is visible', async () => {
    await fileInUris(sessionManager(SESSION), [vscode.Uri.file(A_GS)], memento);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('gemstone.explorer.refresh');
  });
});
