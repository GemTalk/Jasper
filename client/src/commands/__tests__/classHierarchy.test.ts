import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  getAllClassNames: vi.fn(),
  getClassHierarchy: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import { ActiveSession, SessionManager } from '../../sessionManager';
import { showClassHierarchy } from '../classHierarchy';

const session = { id: 7 } as ActiveSession;
const sessionManager = {
  resolveSession: vi.fn().mockResolvedValue(session),
} as unknown as SessionManager;

const hierarchy: queries.ClassHierarchyEntry[] = [
  { className: 'Object', dictName: 'Globals', dictIndex: 3, kind: 'superclass', binding: 'bound' },
  { className: 'Twin', dictName: 'Later', dictIndex: 2, kind: 'self', binding: 'bound' },
  { className: 'TwinChild', dictName: 'Later', dictIndex: 2, kind: 'subclass', binding: 'bound' },
];

// The first showQuickPick is the class list, the second the hierarchy rows.
function pickInOrder(
  pickClass: (items: vscode.QuickPickItem[]) => vscode.QuickPickItem | undefined,
  pickRow: (items: vscode.QuickPickItem[]) => vscode.QuickPickItem | undefined = () => undefined,
): void {
  vi.mocked(vscode.window.showQuickPick)
    .mockImplementationOnce(async (items) => pickClass(items as vscode.QuickPickItem[]))
    .mockImplementationOnce(async (items) => pickRow(items as vscode.QuickPickItem[]));
}

describe('showClassHierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A test that stops at the class pick leaves its row pick queued; drop it.
    vi.mocked(vscode.window.showQuickPick).mockReset();
    vi.mocked(queries.getAllClassNames).mockReturnValue([
      { dictIndex: 2, dictName: 'Later', className: 'Twin' },
      { dictIndex: 1, dictName: 'Earlier', className: 'Twin' },
      { dictIndex: 3, dictName: 'Globals', className: 'Array' },
    ]);
    vi.mocked(queries.getClassHierarchy).mockReturnValue(hierarchy);
  });

  it('offers the class list, alphabetically with each dictionary, instead of a blank text box', async () => {
    pickInOrder(() => undefined);

    await showClassHierarchy(sessionManager);

    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    const offered = vi.mocked(vscode.window.showQuickPick).mock
      .calls[0][0] as vscode.QuickPickItem[];
    expect(offered.map((i) => `${i.label} ${i.description}`)).toEqual([
      'Array Globals',
      'Twin Earlier',
      'Twin Later',
    ]);
    expect(queries.getClassHierarchy).not.toHaveBeenCalled();
  });

  it('asks for the hierarchy of the class in the dictionary that was picked', async () => {
    pickInOrder((items) => items.find((i) => i.description === 'Later'));

    await showClassHierarchy(sessionManager);

    expect(queries.getClassHierarchy).toHaveBeenCalledWith(session, 'Twin', 2);
  });

  it('indents the hierarchy rows and marks the picked class', async () => {
    pickInOrder((items) => items.find((i) => i.description === 'Later'));

    await showClassHierarchy(sessionManager);

    const rows = vi.mocked(vscode.window.showQuickPick).mock.calls[1][0] as vscode.QuickPickItem[];
    expect(rows.map((r) => r.label)).toEqual(['Object', '  Twin ◀', '    TwinChild']);
  });

  it('opens the picked row’s definition scoped to its dictionary', async () => {
    pickInOrder(
      (items) => items.find((i) => i.description === 'Later'),
      (rows) => rows[1],
    );

    await showClassHierarchy(sessionManager);

    expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
    const [command, uri] = vi.mocked(vscode.commands.executeCommand).mock.calls[0];
    expect(command).toBe('gemstone.openDocument');
    const opened = uri as vscode.Uri;
    expect(opened.path).toBe('/Later/Twin/definition');
    expect(opened.query).toBe('dict=2');
  });

  it('opens a row no dictionary binds by name, as before', async () => {
    vi.mocked(queries.getClassHierarchy).mockReturnValue([
      { className: 'OldTwin', dictName: '', kind: 'superclass', binding: 'superseded' },
      ...hierarchy.slice(1),
    ]);
    pickInOrder(
      (items) => items.find((i) => i.description === 'Later'),
      (rows) => rows[0],
    );

    await showClassHierarchy(sessionManager);

    const [, uri] = vi.mocked(vscode.commands.executeCommand).mock.calls[0];
    expect((uri as vscode.Uri).query).toBe('');
  });

  it('says so when the stone finds no hierarchy', async () => {
    vi.mocked(queries.getClassHierarchy).mockReturnValue([]);
    pickInOrder((items) => items[0]);

    await showClassHierarchy(sessionManager);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'No hierarchy found for Array.',
    );
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('reports a failed hierarchy query instead of throwing', async () => {
    vi.mocked(queries.getClassHierarchy).mockImplementation(() => {
      throw new Error('boom');
    });
    pickInOrder((items) => items[0]);

    await showClassHierarchy(sessionManager);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Hierarchy query failed: boom');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });
});
