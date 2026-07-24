import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode'));

import * as vscode from 'vscode';
import { QueryExecutor } from '../queries/types';
import {
  runOnlineExtentBackup,
  resolveExtentBackupSession,
  ExtentBackupDeps,
} from '../extentBackupManager';
import type { ActiveSession } from '../sessionManager';
import type { GemStoneSessionItem } from '../loginTreeProvider';
import type { DatabaseNode } from '../databaseTreeProvider';

// A fake GCI executor that answers each bracketing call by matching the emitted
// Smalltalk. Override any response to drive a failure path.
function makeExecutor(
  over: Partial<Record<'fullLogging' | 'extents' | 'suspend' | 'resume', string>> = {},
) {
  const r = {
    fullLogging: 'true',
    extents: '/db/data/extent0.dbf\n',
    suspend: 'OK',
    resume: 'OK',
    ...over,
  };
  return vi.fn<QueryExecutor>((code) => {
    if (code.includes('FULL_LOGGING')) return r.fullLogging;
    if (code.includes('SystemRepository fileNames')) return r.extents;
    if (code.includes('suspendCheckpointsForMinutes')) return r.suspend;
    if (code.includes('resumeCheckpoints')) return r.resume;
    return '';
  });
}

function makeDeps(execute: QueryExecutor, over: Partial<ExtentBackupDeps> = {}): ExtentBackupDeps {
  return {
    execute,
    stoneName: 'gs64stone',
    dbPath: '/db',
    dataDir: '/db/data',
    listDataFiles: vi.fn(() => ['extent0.dbf']),
    ensureDir: vi.fn(),
    copyFile: vi.fn(),
    fileExists: vi.fn(() => true),
    ...over,
  };
}

// The order index of the execute() call whose Smalltalk contains `needle`.
function callOrder(execute: QueryExecutor, needle: string): number {
  const spy = execute as unknown as {
    mock: { calls: [string][]; invocationCallOrder: number[] };
  };
  const i = spy.mock.calls.findIndex(([code]) => code.includes(needle));
  return i === -1 ? -1 : spy.mock.invocationCallOrder[i];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([{ fsPath: '/chosen' } as vscode.Uri]);
});

describe('runOnlineExtentBackup', () => {
  it('suspends, copies each extent, then resumes — in that order', async () => {
    const execute = makeExecutor();
    const deps = makeDeps(execute);

    const ok = await runOnlineExtentBackup(deps);

    expect(ok).toBe(true);
    expect(deps.copyFile).toHaveBeenCalledWith(
      '/db/data/extent0.dbf',
      expect.stringMatching(/\/chosen\/gs64stone_extents_[\d-]+_[\d-]+\/extent0\.dbf$/),
    );
    const copyOrder = (deps.copyFile as unknown as { mock: { invocationCallOrder: number[] } }).mock
      .invocationCallOrder[0];
    expect(callOrder(execute, 'suspendCheckpointsForMinutes')).toBeLessThan(copyOrder);
    expect(copyOrder).toBeLessThan(callOrder(execute, 'resumeCheckpoints'));
  });

  it('tells the user where the snapshot went and that restore needs the tranlogs', async () => {
    const deps = makeDeps(makeExecutor());

    await runOnlineExtentBackup(deps);

    const message = vi.mocked(vscode.window.showInformationMessage).mock.calls[0][0];
    expect(message).toContain('written to');
    expect(message).toContain('transaction logs');
  });

  it('refuses to run in partial-logging mode without touching checkpoints', async () => {
    const execute = makeExecutor({ fullLogging: 'false' });
    const deps = makeDeps(execute);

    const ok = await runOnlineExtentBackup(deps);

    expect(ok).toBe(false);
    expect(deps.copyFile).not.toHaveBeenCalled();
    expect(callOrder(execute, 'suspendCheckpointsForMinutes')).toBe(-1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('takes no backup when checkpoints cannot be suspended', async () => {
    const execute = makeExecutor({ suspend: 'FAILED' });
    const deps = makeDeps(execute);

    const ok = await runOnlineExtentBackup(deps);

    expect(ok).toBe(false);
    expect(deps.copyFile).not.toHaveBeenCalled();
    expect(callOrder(execute, 'resumeCheckpoints')).toBe(-1);
  });

  it('resumes checkpoints even when copying an extent fails', async () => {
    const execute = makeExecutor();
    const deps = makeDeps(execute, {
      copyFile: vi.fn(() => {
        throw new Error('disk full');
      }),
    });

    const ok = await runOnlineExtentBackup(deps);

    expect(ok).toBe(false);
    expect(callOrder(execute, 'resumeCheckpoints')).toBeGreaterThan(-1);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('flags the copy as unusable when checkpoints resumed too early', async () => {
    const deps = makeDeps(makeExecutor({ resume: 'FAILED' }));

    const ok = await runOnlineExtentBackup(deps);

    expect(ok).toBe(false);
    expect(deps.copyFile).toHaveBeenCalled();
    const error = vi.mocked(vscode.window.showErrorMessage).mock.calls[0][0];
    expect(error).toContain('NOT usable');
  });

  it('does nothing when the user cancels the folder picker', async () => {
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined);
    const execute = makeExecutor();
    const deps = makeDeps(execute);

    const ok = await runOnlineExtentBackup(deps);

    expect(ok).toBe(false);
    expect(callOrder(execute, 'suspendCheckpointsForMinutes')).toBe(-1);
    expect(deps.copyFile).not.toHaveBeenCalled();
  });

  it('scans the data directory for extents when the stone lists none, skipping tranlogs', async () => {
    const execute = makeExecutor({ extents: '' });
    const deps = makeDeps(execute, {
      listDataFiles: vi.fn(() => ['extent0.dbf', 'tranlog0.dbf', 'extent1.dbf']),
    });

    const ok = await runOnlineExtentBackup(deps);

    expect(ok).toBe(true);
    expect(deps.copyFile).toHaveBeenCalledTimes(2);
    const copied = (
      deps.copyFile as unknown as { mock: { calls: [string, string][] } }
    ).mock.calls.map(([src]) => src);
    expect(copied).toEqual(['/db/data/extent0.dbf', '/db/data/extent1.dbf']);
  });
});

// The command reaches the backup from two tree rows and the Command Palette;
// the resolver decides which live session each invocation targets. It only reads
// `login.stone` off a session and `db.config.stoneName` off a stone node, so
// minimal stand-ins are enough.
function fakeSession(stone: string): ActiveSession {
  return { login: { stone } } as unknown as ActiveSession;
}
function sessionRow(session: ActiveSession): GemStoneSessionItem {
  return { activeSession: session };
}
function runningStoneRow(stoneName: string): DatabaseNode {
  return { kind: 'stone', db: { config: { stoneName } }, running: true } as unknown as DatabaseNode;
}

describe('resolveExtentBackupSession', () => {
  it('uses the session carried by the Sessions view row', () => {
    const session = fakeSession('gs64stone');

    const result = resolveExtentBackupSession(sessionRow(session), [], undefined);

    expect(result).toEqual({ session });
  });

  it('binds to a live session on the clicked stone, ignoring the selected one', () => {
    const target = fakeSession('gs64stone');
    const elsewhere = fakeSession('otherstone');

    const result = resolveExtentBackupSession(
      runningStoneRow('gs64stone'),
      [elsewhere, target],
      elsewhere,
    );

    expect(result).toEqual({ session: target });
  });

  it('asks the user to log in when the clicked stone has no live session', () => {
    const result = resolveExtentBackupSession(
      runningStoneRow('gs64stone'),
      [fakeSession('otherstone')],
      undefined,
    );

    expect(result).toEqual({ needLogin: 'gs64stone' });
  });

  it('falls back to the active session when invoked from the Command Palette', () => {
    const selected = fakeSession('gs64stone');

    const result = resolveExtentBackupSession(undefined, [selected], selected);

    expect(result).toEqual({ session: selected });
  });

  it('reports no session when the palette is used with nothing connected', () => {
    const result = resolveExtentBackupSession(undefined, [], undefined);

    expect(result).toEqual({ noSession: true });
  });
});
