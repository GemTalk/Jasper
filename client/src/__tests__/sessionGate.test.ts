import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGate, type StartWatcher, type Watcher } from './sessionGate.globalSetup';
import type { ActiveSession } from '../activeSession';
import {
  assertBookingKept,
  deniedByStone,
  reportedSerialOf,
  reportLogin,
} from './sessionGateClient';

// The gate's sockets with a stand-in watcher, driven by hand: no stone needed.
describe('the session gate', () => {
  let socketPath: string;
  let look: (sessions: Map<string, number>) => void;
  let fail: (error: unknown) => void;
  let watcher: Partial<Watcher>;
  let teardown: (() => Promise<void>) | undefined;
  const files: Socket[] = [];

  const startWatcher: StartWatcher = (onSample, onFail) => {
    look = onSample;
    fail = onFail;
    onSample(new Map());
    return {
      serial: 1,
      sessionLimit: 2,
      lookMs: [],
      stop: () => {},
      freshLoginSerial: () => 2,
      ...watcher,
    };
  };

  const start = async (overrides: Partial<Watcher> = {}) => {
    watcher = overrides;
    teardown = await startGate(socketPath, startWatcher);
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

  const ask = async (n: number): Promise<{ socket: Socket; answer: Record<string, unknown> }> => {
    const socket = await connect();
    const answer = nextAnswer(socket);
    send(socket, { op: 'acquire', file: 'a.test.ts', pid: process.pid, n });
    return { socket, answer: await answer };
  };

  const booked = async (n = 1): Promise<Socket> => (await ask(n)).socket;

  beforeEach(() => {
    socketPath = join(tmpdir(), `jasper-gate-test-${process.pid}-${Date.now()}.sock`);
    teardown = undefined;
  });

  afterEach(async () => {
    for (const socket of files.splice(0)) socket.destroy();
    await teardown?.().catch(() => {});
  });

  describe('starting', () => {
    it("gives tests the stone's session limit, less the watcher's own session", async () => {
      await start({ sessionLimit: 4 });

      const { answer } = await ask(4);

      expect(answer).toEqual({
        error: 'a.test.ts declares 4 stone sessions; only 3 are available to tests',
      });
    });

    const cannotStart = () => {
      throw new Error('no such stone');
    };

    it('fails to start when its watcher cannot start', async () => {
      const starting = startGate(socketPath, cannotStart);

      await expect(starting).rejects.toThrow('no such stone');
    });

    it('stops serving when its watcher cannot start', async () => {
      await startGate(socketPath, cannotStart).catch(() => {});

      const connecting = new Promise((resolve, reject) =>
        createConnection(socketPath).once('connect', resolve).once('error', reject),
      );

      await expect(connecting).rejects.toThrow();
    });
  });

  it('drops a file that sends a message it cannot read', async () => {
    await start();
    const file = await connect();
    const closed = new Promise((resolve) => file.once('close', resolve));

    file.write('not json\n');

    await expect(closed).resolves.toBeDefined();
  });

  it('fails the run on a login it never saw, naming the known serials either side', async () => {
    await start({ freshLoginSerial: () => 4 });
    const file = await booked();
    send(file, { op: 'opened', serial: '2' });
    look(new Map([['2', process.pid]]));
    file.destroy();

    const ending = teardown!();

    await expect(ending).rejects.toThrow(
      /login serial 3: between 2 \(seen .* into the run\) and 4 \(run edge .* into the run\), while .* ran\. Refusals reported near it: none\./,
    );
  });

  describe('when its watcher fails', () => {
    beforeEach(() => start());

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

      await expect(check).rejects.toThrow(
        /Session gate: the session watching the test stone failed/,
      );
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

      const { answer } = await ask(1);

      expect(answer).toEqual({ error: expect.stringMatching(/stone stopped/) });
    });

    it('fails the run at teardown', async () => {
      fail(new Error('stone stopped'));

      const ending = teardown!();

      await expect(ending).rejects.toThrow(/session gate: .*stone stopped/);
    });

    it('ends a run whose watcher kept looking without failing it', async () => {
      look(new Map());

      const ending = teardown!();

      await expect(ending).resolves.toBeUndefined();
    });
  });
});

describe("a test file's side of the session gate", () => {
  it('counts a wrong user or password as refused by the stone', () => {
    const denied = deniedByStone({ number: 4051 });

    expect(denied).toBe(true);
  });

  it.each([
    ['an unknown stone', { number: 4065 }],
    ['an unknown NetLDI', { number: 4147 }],
    ['an error with no GemStone number', new Error('single session only')],
    ['no error at all', undefined],
  ])('does not count %s as refused by the stone', (_, error) => {
    const denied = deniedByStone(error);

    expect(denied).toBe(false);
  });

  const fakeSession = () =>
    ({ executeAndFetchString: () => '42', logout: () => true }) as unknown as ActiveSession;

  it('remembers the serial a session was reported with', () => {
    const own = reportLogin(fakeSession());

    const serial = reportedSerialOf(own);

    expect(serial).toBe('42');
  });

  it('refuses the serial of a session that was never reported', () => {
    const own = fakeSession();

    const asking = () => reportedSerialOf(own);

    expect(asking).toThrow('this session was never reported');
  });
});
