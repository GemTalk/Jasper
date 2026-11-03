import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  classRowContents: vi.fn(),
  isBusyRefusal: vi.fn(() => false),
  getDefinedInstVarCounts: vi.fn(() => new Map<string, number>()),
  getDefinedClassVarCounts: vi.fn(() => new Map<string, number>()),
  getClassVersions: vi.fn(() => new Map()),
  getClassesWithCategory: vi.fn(() => []),
}));

import { ExplorerController, ClassItem, VarSideItem } from '../../gemstoneExplorer';
import * as queries from '../../browserQueries';
import { NbCancelledError } from '../../nbRunner';
import type { SessionManager, ActiveSession } from '../../sessionManager';

const CLASS = 'Foo';
const ROW = { instVarNames: ['count'], classVarNames: ['Registry'], ivarsCanMoveDown: true };

function makeController(): ExplorerController {
  const sessionManager = {
    getSelectedSession: () => ({}) as ActiveSession,
  } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.selectDict({ dictName: 'UserGlobals', dictIndex: 1 });
  return ctl;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('what an expanded class row shows', () => {
  it('asks GemStone once for a class row and the two side rows under it', async () => {
    vi.mocked(queries.classRowContents).mockResolvedValue(ROW);
    const ctl = makeController();

    await Promise.all([
      ctl.classProvider.getChildren(new ClassItem(CLASS, true)),
      ctl.classProvider.getChildren(new VarSideItem(CLASS, false)),
      ctl.classProvider.getChildren(new VarSideItem(CLASS, true)),
    ]);

    expect(queries.classRowContents).toHaveBeenCalledTimes(1);
  });

  it('remembers a class row once answered', async () => {
    vi.mocked(queries.classRowContents).mockResolvedValue(ROW);
    const ctl = makeController();
    await ctl.classRow(CLASS);

    const row = await ctl.classRow(CLASS);

    expect(row).toEqual(ROW);
    expect(queries.classRowContents).toHaveBeenCalledTimes(1);
  });

  it('asks again after the class list reloads', async () => {
    vi.mocked(queries.classRowContents).mockResolvedValue(ROW);
    const ctl = makeController();
    await ctl.classRow(CLASS);
    ctl.selectDict({ dictName: 'UserGlobals', dictIndex: 1 });

    await ctl.classRow(CLASS);

    expect(queries.classRowContents).toHaveBeenCalledTimes(2);
  });

  it('does not keep an answer that arrives after the class list reloaded', async () => {
    const stale = deferred<typeof ROW>();
    vi.mocked(queries.classRowContents).mockReturnValueOnce(stale.promise).mockResolvedValue(ROW);
    const ctl = makeController();
    const early = ctl.classRow(CLASS);
    ctl.selectDict({ dictName: 'UserGlobals', dictIndex: 1 });
    stale.resolve({ instVarNames: ['old'], classVarNames: [], ivarsCanMoveDown: false });
    await early;

    const row = await ctl.classRow(CLASS);

    expect(row).toEqual(ROW);
  });

  it.each([
    [true, 'explorerIvar'],
    [false, 'explorerIvarNoSubs'],
  ])(
    'offers pushing an instance variable down only to a class with subclasses (has subclasses: %s)',
    async (ivarsCanMoveDown, contextValue) => {
      vi.mocked(queries.classRowContents).mockResolvedValue({ ...ROW, ivarsCanMoveDown });
      const ctl = makeController();

      const ivars = await ctl.classProvider.getChildren(new VarSideItem(CLASS, false));

      expect(ivars.map((row) => row.contextValue)).toEqual([contextValue]);
    },
  );

  it('asks again for a row the user cancelled', async () => {
    vi.mocked(queries.classRowContents)
      .mockRejectedValueOnce(new NbCancelledError())
      .mockResolvedValue(ROW);
    const ctl = makeController();
    await ctl.classRow(CLASS);

    const row = await ctl.classRow(CLASS);

    expect(row).toEqual(ROW);
    expect(queries.classRowContents).toHaveBeenCalledTimes(2);
  });

  it('asks again for a row refused because a run held the session', async () => {
    vi.mocked(queries.isBusyRefusal).mockReturnValueOnce(true);
    vi.mocked(queries.classRowContents)
      .mockRejectedValueOnce(new Error('session busy'))
      .mockResolvedValue(ROW);
    const ctl = makeController();
    await ctl.classRow(CLASS);

    const row = await ctl.classRow(CLASS);

    expect(row).toEqual(ROW);
    expect(queries.classRowContents).toHaveBeenCalledTimes(2);
  });

  it('remembers a row that failed for any other reason', async () => {
    vi.mocked(queries.classRowContents)
      .mockRejectedValueOnce(new Error('compile error'))
      .mockResolvedValue(ROW);
    const ctl = makeController();
    await ctl.classRow(CLASS);

    await ctl.classRow(CLASS);

    expect(queries.classRowContents).toHaveBeenCalledTimes(1);
  });
});
