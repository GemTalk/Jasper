import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'child_process';
import * as fs from 'fs';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));
import {
  startSeasideServer,
  stopSeasideServer,
  isSeasideServing,
  seasideUrl,
  SEASIDE_DEFAULT_PORT,
} from '../seasideServer';
import { ActiveSession } from '../sessionManager';

vi.mock('child_process');
vi.mock('fs');

function fakeSession(): ActiveSession {
  return {
    id: 1,
    login: {
      version: '3.7.5',
      gem_host: 'localhost',
      stone: 'demo-stone',
      gs_user: 'DataCurator',
      netldi: 'demo-ldi',
    },
    stoneVersion: '3.7.5',
  } as unknown as ActiveSession;
}

function spawnReturns(pid = 4242) {
  const child = {
    pid,
    stdin: { write: vi.fn(), end: vi.fn() },
    unref: vi.fn(),
    once: vi.fn(),
  };
  vi.mocked(child_process.spawn).mockReturnValue(child as unknown as child_process.ChildProcess);
  return child;
}

function servesHelloWorld() {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    text: async () => '<body>Hello World from Seaside</body>',
  });
}

describe('Seaside server lifecycle', () => {
  beforeEach(() => {
    vi.mocked(fs.openSync).mockReturnValue(3);
  });

  afterEach(() => {
    stopSeasideServer(SEASIDE_DEFAULT_PORT);
    stopSeasideServer(9090);
    vi.clearAllMocks();
  });

  it('starts a detached topaz gem that serves the app and returns its URL', async () => {
    spawnReturns();
    servesHelloWorld();

    const url = await startSeasideServer({
      session: fakeSession(),
      gemstonePath: '/gs/GemStone64Bit3.7.5-arm64.Darwin',
      globalDir: '/gs/GemStone64Bit3.7.5-arm64.Darwin/global',
    });

    expect(url).toBe(seasideUrl());
    const [cmd, args, opts] = vi.mocked(child_process.spawn).mock.calls[0];
    expect(cmd).toBe('/gs/GemStone64Bit3.7.5-arm64.Darwin/bin/topaz');
    expect(args).toEqual(['-l']);
    expect(opts?.detached).toBe(true);
  });

  it('logs in as SystemUser and starts the adaptor on the requested port', async () => {
    const child = spawnReturns();
    servesHelloWorld();

    await startSeasideServer({
      session: fakeSession(),
      gemstonePath: '/gs',
      globalDir: '/gs/global',
      port: 9090,
    });

    const script = child.stdin.write.mock.calls[0][0] as string;
    expect(script).toContain('set user SystemUser');
    expect(script).toContain('WAGsZincAdaptor startOn: 9090.');
  });

  it('does not start a second gem for a port that is already serving', async () => {
    spawnReturns();
    servesHelloWorld();

    await startSeasideServer({
      session: fakeSession(),
      gemstonePath: '/gs',
      globalDir: '/gs/global',
    });
    await startSeasideServer({
      session: fakeSession(),
      gemstonePath: '/gs',
      globalDir: '/gs/global',
    });

    expect(child_process.spawn).toHaveBeenCalledTimes(1);
  });

  it('stops the serving gem by signalling its whole process group', async () => {
    spawnReturns(555);
    servesHelloWorld();
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);

    await startSeasideServer({
      session: fakeSession(),
      gemstonePath: '/gs',
      globalDir: '/gs/global',
    });
    expect(isSeasideServing()).toBe(true);

    const stopped = stopSeasideServer();

    expect(stopped).toBe(true);
    expect(kill).toHaveBeenCalledWith(-555, 'SIGTERM');
    expect(isSeasideServing()).toBe(false);
    kill.mockRestore();
  });
});
