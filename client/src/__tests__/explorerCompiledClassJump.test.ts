import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
vi.mock('../browserQueries', async (orig) => ({
  ...(await orig()),
  getClassesWithCategory: vi.fn(() => []),
  getDictionaryNames: vi.fn(() => ['Globals']),
  getAllClassNames: vi.fn(() => []),
}));

import { ExplorerController } from '../gemstoneExplorer';
import { getClassesWithCategory, getDictionaryNames, getAllClassNames } from '../browserQueries';
import type { SessionManager, ActiveSession } from '../sessionManager';

function makeController(): ExplorerController {
  const session = { id: 1 } as ActiveSession;
  const sessionManager = { getSelectedSession: () => session } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'Globals';
  ctl.state.dictIndex = 1;
  return ctl;
}

const classesInDict = getClassesWithCategory as ReturnType<typeof vi.fn>;
const dictNames = getDictionaryNames as ReturnType<typeof vi.fn>;
const allClasses = getAllClassNames as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  classesInDict.mockReturnValue([]);
  dictNames.mockReturnValue(['Globals']);
  allClasses.mockReturnValue([]);
});

// Bug F: after a class is compiled, the explorer should reveal it — in the current
// dictionary when it lives there, otherwise it should JUMP to the dictionary the
// class was actually created in (e.g. a new class whose inDictionary: named a
// different dictionary than the selected one).
describe('onExternalClassCompiled reveals the compiled class in the right dictionary', () => {
  it('reveals in the current dictionary when the class lives there', () => {
    const ctl = makeController();
    classesInDict.mockReturnValue([{ className: 'Foo', category: '' }]);
    const reveal = vi.spyOn(ctl as unknown as { revealClass: () => void }, 'revealClass');

    ctl.onExternalClassCompiled(1, 'Foo');

    expect(reveal).toHaveBeenCalledWith('Globals', 1, 'Foo');
  });

  it('jumps to the dictionary the class was created in when it is not in the current one', () => {
    const ctl = makeController();
    classesInDict.mockReturnValue([]); // not in the selected dictionary
    dictNames.mockReturnValue(['Globals', 'OtherDict']); // OtherDict → 1-based index 2
    const reveal = vi
      .spyOn(ctl as unknown as { revealClass: () => void }, 'revealClass')
      .mockImplementation(() => {});

    ctl.onExternalClassCompiled(1, 'Foo', 'OtherDict');

    expect(reveal).toHaveBeenCalledWith('OtherDict', 2, 'Foo');
  });

  it('does not reveal when the class cannot be resolved in any dictionary', () => {
    const ctl = makeController();
    classesInDict.mockReturnValue([]);
    dictNames.mockReturnValue(['Globals']); // 'Nope' unresolved
    allClasses.mockReturnValue([]); // and no global match either
    const reveal = vi.spyOn(ctl as unknown as { revealClass: () => void }, 'revealClass');

    ctl.onExternalClassCompiled(1, 'Foo', 'Nope');

    expect(reveal).not.toHaveBeenCalled();
  });
});
