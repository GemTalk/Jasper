import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
// The controller module pulls in browserQueries (→ native GCI). Stub it; this test spies
// out the controller's own refresh so nothing touches a live tree or stone.
vi.mock('../browserQueries', () => ({}));
vi.mock('../refactoring/extractSuperclassCommand', () => ({
  insertSuperclassCommand: vi.fn(),
  extractSuperclassCommand: vi.fn(),
}));

import { ExplorerController, HierarchyItem } from '../gemstoneExplorer';
import {
  insertSuperclassCommand,
  extractSuperclassCommand,
} from '../refactoring/extractSuperclassCommand';
import type { SessionManager, ActiveSession } from '../sessionManager';

/**
 * Drives ExplorerController.insertSuperclass / extractSuperclass — the wiring between an Explorer
 * item and the extract-superclass command. Pins the dictionary-resolution branch (a hierarchy-tree
 * node names a class that may live outside the current dictionary, so it passes no dict; a class row
 * passes the current dictIndex) and the refresh-only-on-outcome behavior. The command is mocked and
 * the controller's refresh is spied, so nothing needs a live tree or stone.
 */

function makeController(session: ActiveSession | undefined) {
  const sessionManager = {
    getSelectedSession: () => session,
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.className = 'EsCircle';
  ctl.state.dictName = 'EsShapeDemo';
  ctl.state.dictIndex = 7;
  const refresh = vi
    .spyOn(
      ctl as unknown as { refreshAfterClassReshape: (c: string) => Promise<void> },
      'refreshAfterClassReshape',
    )
    .mockResolvedValue();
  return { ctl, refresh };
}

const classRow = { className: 'EsCircle' } as never;
const hierarchyNode = () => new HierarchyItem('EsCircle', 'EsShapeDemo', 'self', 0, false);

const cases = [
  { title: 'insertSuperclass', command: vi.mocked(insertSuperclassCommand) },
  { title: 'extractSuperclass', command: vi.mocked(extractSuperclassCommand) },
] as const;

beforeEach(() => vi.clearAllMocks());

describe.each(cases)('ExplorerController.$title', ({ title, command }) => {
  const run = (ctl: ExplorerController, item: never): Promise<void> =>
    (ctl as unknown as Record<string, (i: never) => Promise<void>>)[title](item);

  it('does nothing when there is no selected session', async () => {
    const { ctl, refresh } = makeController(undefined);

    await run(ctl, classRow);

    expect(command).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('passes the current dictionary index for a class row', async () => {
    const { ctl } = makeController({} as ActiveSession);
    command.mockResolvedValue({ newClass: 'EsRenderable', applied: 3 });

    await run(ctl, classRow);

    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ className: 'EsCircle', dict: 7 }),
    );
  });

  it('passes no dictionary for a hierarchy-tree node', async () => {
    const { ctl } = makeController({} as ActiveSession);
    command.mockResolvedValue({ newClass: 'EsRenderable', applied: 3 });

    await run(ctl, hierarchyNode() as never);

    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ className: 'EsCircle', dict: undefined }),
    );
  });

  it('refreshes on the new class when the command succeeds', async () => {
    const { ctl, refresh } = makeController({} as ActiveSession);
    command.mockResolvedValue({ newClass: 'EsRenderable', applied: 3 });

    await run(ctl, classRow);

    expect(refresh).toHaveBeenCalledWith('EsRenderable');
  });

  it('does not refresh when the command is cancelled or nothing applied', async () => {
    const { ctl, refresh } = makeController({} as ActiveSession);
    command.mockResolvedValue(undefined);

    await run(ctl, classRow);

    expect(refresh).not.toHaveBeenCalled();
  });
});
