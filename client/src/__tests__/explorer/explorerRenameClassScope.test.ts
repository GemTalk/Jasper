import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

// Capture what the rename-class editor is handed for its scope, and cancel the
// flow immediately afterward (resolve undefined) so nothing downstream runs.
vi.mock('../../refactoring/renameClassEditor', () => ({
  showRenameClassEditor: vi.fn(),
}));

// The flow calls isKernelClass then classDefiningDictionaryName before the editor;
// nothing after (the editor cancels). Stub both.
vi.mock('../../browserQueries', () => ({
  isKernelClass: vi.fn(() => false),
  classDefiningDictionaryName: vi.fn(() => ''),
}));

import { showRenameClassEditor } from '../../refactoring/renameClassEditor';
import * as queries from '../../browserQueries';
import { ExplorerController } from '../../gemstoneExplorer';
import type { SessionManager, ActiveSession } from '../../sessionManager';

const showEditor = vi.mocked(showRenameClassEditor);
const homeDictOf = vi.mocked(queries.classDefiningDictionaryName);

/**
 * Regression for PR #392 review finding #2: a class rename invoked from a method
 * editor (or a hierarchy node) scoped "This dictionary" to whatever dictionary was
 * selected in the Explorer, not the dictionary that actually defines the class.
 * When they differ, choosing "This dictionary" silently excludes the class's real
 * references. The scope must follow the class being renamed.
 */
function makeController(): ExplorerController {
  const session = { rbSupportAvailable: true } as unknown as ActiveSession;
  const sessionManager = {
    getSelectedSession: () => session,
  } as unknown as SessionManager;
  return new ExplorerController(sessionManager);
}

beforeEach(() => {
  vi.clearAllMocks();
  showEditor.mockResolvedValue(undefined); // cancel right after capturing the scope
  vi.mocked(queries.isKernelClass).mockReturnValue(false);
});

describe('rename-class "This dictionary" scope follows the class, not the Explorer selection', () => {
  it("offers the class's own dictionary even when a different dictionary is selected", async () => {
    homeDictOf.mockReturnValueOnce('DictA');
    const ctl = makeController();
    ctl.state.dictName = 'DictB'; // the Explorer selection — the WRONG dictionary
    ctl.state.dictIndex = 12;

    await ctl.renameClassNamed('Foo', 5); // Foo actually lives in DictA (index 5)

    expect(homeDictOf).toHaveBeenCalledWith(expect.anything(), 'Foo', 5);
    expect(showEditor).toHaveBeenCalledWith(
      expect.objectContaining({ oldName: 'Foo', dictName: 'DictA' }),
      expect.any(Function),
    );
  });

  it('omits the "This dictionary" option when the class is not bound under its own name', async () => {
    homeDictOf.mockReturnValueOnce('');
    const ctl = makeController();
    ctl.state.dictName = 'DictB';

    await ctl.renameClassNamed('Ghost', undefined);

    expect(showEditor).toHaveBeenCalledWith(
      expect.objectContaining({ dictName: undefined }),
      expect.any(Function),
    );
  });

  it('falls back to the Explorer selection when the home-dictionary probe fails', async () => {
    homeDictOf.mockImplementationOnce(() => {
      throw new Error('stone query failed');
    });
    const ctl = makeController();
    ctl.state.dictName = 'DictB';

    await ctl.renameClassNamed('Foo', 5);

    expect(showEditor).toHaveBeenCalledWith(
      expect.objectContaining({ dictName: 'DictB' }),
      expect.any(Function),
    );
  });
});
