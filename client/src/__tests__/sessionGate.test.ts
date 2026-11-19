import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnection, type Socket } from 'node:net';
import {
  gateSocketPath,
  startGate,
  type StartWatcher,
  type Watcher,
} from './sessionGate.globalSetup';
import type { ActiveSession } from '../activeSession';
import {
  assertBookingKept,
  deniedByStone,
  reportedSerialOf,
  reportLogin,
  roomToLogIn,
  type Booking,
} from './sessionGateClient';

// The gate's sockets with a stand-in watcher, driven by hand: no stone needed.
describe('the session gate', () => {
  let socketPath: string;
  let look: (sessions: Map<string, number>) => void;
  let fail: (error: unknown) => void;
  let watcher: Partial<Watcher>;
  let watchersStarted: number;
  let teardown: (() => Promise<void>) | undefined;
  const files: Socket[] = [];

  const startWatcher: StartWatcher = (onSample, onFail) => {
    watchersStarted++;
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
    socketPath = gateSocketPath(`jasper-gate-test-${process.pid}-${Date.now()}`);
    watchersStarted = 0;
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

    it('does not log in to the stone until a file books', async () => {
      await start();

      await connect();

      expect(watchersStarted).toBe(0);
    });

    it('logs in to the stone once, for the first file that books', async () => {
      await start({ sessionLimit: 3 });

      await ask(1);
      await ask(1);

      expect(watchersStarted).toBe(1);
    });

    it('ends a run no file booked in without logging in to the stone', async () => {
      await start();

      const ending = teardown!();

      await expect(ending).resolves.toBeUndefined();
      expect(watchersStarted).toBe(0);
    });

    describe('when its watcher cannot log in', () => {
      beforeEach(async () => {
        teardown = await startGate(socketPath, () => {
          watchersStarted++;
          throw new Error('no such stone');
        });
      });

      it('refuses the booking, saying why', async () => {
        const { answer } = await ask(1);

        expect(answer).toEqual({
          error: expect.stringMatching(/could not start the session that watches.*no such stone/),
        });
      });

      it('does not try to log in again for a later booking', async () => {
        await ask(1);

        const { answer } = await ask(1);

        expect(watchersStarted).toBe(1);
        expect(answer).toEqual({ error: expect.stringMatching(/could not start/) });
      });

      it('fails the run at teardown', async () => {
        (await ask(1)).socket.destroy();

        const ending = teardown!();

        await expect(ending).rejects.toThrow(/session gate: could not start.*no such stone/);
      });
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

  it("tells a file it blames what it knew of the file's logins, the failures it reported included", async () => {
    await start();
    const file = await booked();
    const onStone = new Map([['5', process.pid]]);
    send(file, {
      op: 'loginFailed',
      denied: false,
      startedAt: Date.now(),
      failedAt: Date.now(),
      number: 4100,
      message: 'no NetLDI',
    });
    look(onStone);
    let answer: Record<string, unknown> | undefined;
    void nextAnswer(file).then((a) => (answer = a));

    send(file, { op: 'check' });
    // The gate answers a check after its next look, which has to follow the check's arrival.
    await vi.waitFor(() => {
      look(onStone);
      expect(answer).toBeDefined();
    });

    expect(answer).toMatchObject({
      unreported: [{ serial: '5' }],
      loginsAround: expect.arrayContaining([
        expect.stringContaining('error 4100: no NetLDI; not refused by the stone'),
        expect.stringMatching(/^login serial 5: seen .* from this test worker, blamed$/),
      ]),
    });
  });

  describe('when its watcher fails', () => {
    let file: Socket;

    beforeEach(async () => {
      await start();
      file = await booked();
    });

    it('answers the check of a file holding a booking with the failure', async () => {
      const answer = nextAnswer(file);
      send(file, { op: 'check' });

      fail(new Error('Your session has been forcibly terminated'));

      expect(await answer).toEqual({
        error: expect.stringMatching(/session watching the test stone failed.*forcibly terminated/),
      });
    });

    it('fails the end-of-file check of a file holding a booking', async () => {
      fail(new Error('Your session has been forcibly terminated'));

      const check = assertBookingKept(file);

      await expect(check).rejects.toThrow(
        /Session gate: the session watching the test stone failed/,
      );
    });

    it('gives a file still waiting for room the failure', async () => {
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
      file.destroy();

      const ending = teardown!();

      await expect(ending).rejects.toThrow(/session gate: .*stone stopped/);
    });

    it('ends a run whose watcher kept looking without failing it', async () => {
      look(new Map());
      file.destroy();

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

  describe('before a login', () => {
    // Booked 2: login 10 still logged in, login 11 logged out, both reported at time 100.
    const fullWithOneLeaving = (): Booking => ({
      n: 2,
      mine: new Map([
        ['10', 100],
        ['11', 100],
      ]),
      closed: new Set(['11']),
    });

    it('waits while a logged-out gem is still on the stone and the booking is full', () => {
      const booking = fullWithOneLeaving();

      const room = roomToLogIn(booking, { at: 200, serials: ['10', '11'] });

      expect(room).toBe(false);
    });

    it('has room once a look begun after the logout no longer shows the gem', () => {
      const booking = fullWithOneLeaving();

      const room = roomToLogIn(booking, { at: 200, serials: ['10'] });

      expect(room).toBe(true);
    });

    it('does not take a look begun before the login was reported as showing its gem gone', () => {
      const booking = fullWithOneLeaving();

      const room = roomToLogIn(booking, { at: 50, serials: ['10'] });

      expect(room).toBe(false);
    });

    it('waits while there is no look to go by', () => {
      const booking = fullWithOneLeaving();

      const room = roomToLogIn(booking, undefined);

      expect(room).toBe(false);
    });

    it('does not wait for gems still logged in, which waiting cannot free', () => {
      const booking: Booking = { ...fullWithOneLeaving(), closed: new Set() };

      const room = roomToLogIn(booking, { at: 200, serials: ['10', '11'] });

      expect(room).toBe(true);
    });

    it('has room while a logged-out gem leaves if the booking is not full', () => {
      const booking: Booking = { ...fullWithOneLeaving(), n: 3 };

      const room = roomToLogIn(booking, { at: 200, serials: ['10', '11'] });

      expect(room).toBe(true);
    });

    it('forgets a gem that left without a logout being reported, as a forked one does', () => {
      const booking: Booking = { ...fullWithOneLeaving(), closed: new Set(['10']) };

      roomToLogIn(booking, { at: 200, serials: ['10'] });

      expect([...booking.mine.keys()]).toEqual(['10']);
    });
  });
});
