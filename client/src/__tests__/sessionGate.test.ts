import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGate, type StartWatcher } from './sessionGate.globalSetup';
import { assertBookingKept } from './sessionGateClient';

// The gate's sockets with a stand-in watcher, driven by hand: no stone needed.
describe('the session gate when its watcher fails', () => {
  let socketPath: string;
  let look: (sessions: Map<string, number>) => void;
  let fail: (error: unknown) => void;
  let teardown: () => Promise<void>;
  const files: Socket[] = [];

  const startWatcher: StartWatcher = (onSample, onFail) => {
    look = onSample;
    fail = onFail;
    onSample(new Map());
    return { serial: 1, lookMs: [], stop: () => {}, freshLoginSerial: () => 2 };
  };

  const connect = async (): Promise<Socket> => {
    const socket = createConnection(socketPath);
    await new Promise((resolve) => socket.once('connect', resolve));
    files.push(socket);
    return socket;
  };

  const nextAnswer = (socket: Socket) =>
    new Promise<Record<string, unknown>>((resolve) =>
      socket.once('data', (chunk) => resolve(JSON.parse(chunk.toString().split('\n')[0]))),
    );

  const send = (socket: Socket, msg: object) => socket.write(JSON.stringify(msg) + '\n');

  const booked = async (n = 1): Promise<Socket> => {
    const socket = await connect();
    const answer = nextAnswer(socket);
    send(socket, { op: 'acquire', file: 'a.test.ts', pid: process.pid, n });
    await answer;
    return socket;
  };

  beforeEach(async () => {
    socketPath = join(tmpdir(), `jasper-gate-test-${process.pid}-${Date.now()}.sock`);
    teardown = await startGate(socketPath, startWatcher, 1);
  });

  afterEach(async () => {
    for (const socket of files.splice(0)) socket.destroy();
    await teardown().catch(() => {});
  });

  it('answers the check of a file holding a booking with the failure', async () => {
    const file = await booked();
    const answer = nextAnswer(file);
    send(file, { op: 'check' });

    fail(new Error('Your session has been forcibly terminated'));

    expect(await answer).toEqual({
      error: expect.stringMatching(/session watching the test stone failed.*forcibly terminated/),
    });
  });

  it('fails the end-of-file check of a file holding a booking', async () => {
    const file = await booked();
    fail(new Error('Your session has been forcibly terminated'));

    const check = assertBookingKept(file);

    await expect(check).rejects.toThrow(/Session gate: the session watching the test stone failed/);
  });

  it('gives a file still waiting for room the failure', async () => {
    await booked();
    const waiting = await connect();
    const answer = nextAnswer(waiting);
    send(waiting, { op: 'acquire', file: 'b.test.ts', pid: process.pid, n: 1 });

    fail(new Error('stone stopped'));

    expect(await answer).toEqual({ error: expect.stringMatching(/stone stopped/) });
  });

  it('refuses a booking asked for after the failure', async () => {
    fail(new Error('stone stopped'));
    const file = await connect();

    const answer = nextAnswer(file);
    send(file, { op: 'acquire', file: 'a.test.ts', pid: process.pid, n: 1 });

    expect(await answer).toEqual({ error: expect.stringMatching(/stone stopped/) });
  });

  it('fails the run at teardown', async () => {
    fail(new Error('stone stopped'));

    const ending = teardown();

    await expect(ending).rejects.toThrow(/session gate: .*stone stopped/);
  });

  it('ends a run whose watcher kept looking without failing it', async () => {
    look(new Map());

    const ending = teardown();

    await expect(ending).resolves.toBeUndefined();
  });
});
