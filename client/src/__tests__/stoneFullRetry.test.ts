import { describe, expect, it } from 'vitest';
import type { GciError } from '../gciLibrary';
import {
  GS_ERR_MAX_SESSIONS_LIMIT,
  retryNbLoginWhileStoneFull,
  retryWhileStoneFull,
  STONE_FULL_RETRY_MS,
  STONE_FULL_WAIT_MS,
  type RetryClock,
} from './stoneFullRetry';

const FULL = {
  number: GS_ERR_MAX_SESSIONS_LIMIT,
  message: 'the maximum number of users are already logged in.',
};
const BAD_PASSWORD = {
  number: 4051,
  message: 'the userId/password combination is invalid or expired.',
};
type LoginResult = { session: unknown; err: GciError };
const refused = (err: Partial<GciError>): LoginResult => ({
  session: undefined,
  err: err as GciError,
});
const loggedIn: LoginResult = {
  session: { handle: 1 },
  err: { number: 0, message: '' } as GciError,
};

function fakeClock(): RetryClock & { slept: number[] } {
  let time = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => time,
    sleep: (ms) => {
      slept.push(ms);
      time += ms;
    },
  };
}

function logins(...results: LoginResult[]) {
  let calls = 0;
  const attempt = () => results[Math.min(calls++, results.length - 1)];
  return { attempt, calls: () => calls };
}

describe('waiting out a full stone at login', () => {
  it('logs in once a slot frees up', () => {
    const clock = fakeClock();
    const { attempt, calls } = logins(refused(FULL), refused(FULL), loggedIn);

    expect(retryWhileStoneFull(attempt, clock)).toBe(loggedIn);
    expect(calls()).toBe(3);
    expect(clock.slept).toEqual([STONE_FULL_RETRY_MS, STONE_FULL_RETRY_MS]);
  });

  it('answers any other refusal at once', () => {
    const clock = fakeClock();
    const { attempt, calls } = logins(refused(BAD_PASSWORD), loggedIn);

    expect(retryWhileStoneFull(attempt, clock).err).toEqual(BAD_PASSWORD);
    expect(calls()).toBe(1);
    expect(clock.slept).toEqual([]);
  });

  it('gives up when the stone stays full, saying how long it waited', () => {
    const clock = fakeClock();
    const { attempt } = logins(refused(FULL));

    const { session, err } = retryWhileStoneFull(attempt, clock);

    expect(session).toBeUndefined();
    expect(err.number).toBe(GS_ERR_MAX_SESSIONS_LIMIT);
    expect(err.message).toBe(
      `${FULL.message} (still full after ${STONE_FULL_WAIT_MS} ms of retrying)`,
    );
    expect(clock.now()).toBe(STONE_FULL_WAIT_MS);
  });

  it('retries a non-blocking login refused as full, and not one refused otherwise', async () => {
    const full = logins(refused(FULL), loggedIn);
    expect(await retryNbLoginWhileStoneFull(async () => full.attempt())).toBe(loggedIn);
    expect(full.calls()).toBe(2);

    const badPassword = logins(refused(BAD_PASSWORD), loggedIn);
    expect((await retryNbLoginWhileStoneFull(async () => badPassword.attempt())).err).toEqual(
      BAD_PASSWORD,
    );
    expect(badPassword.calls()).toBe(1);
  });
});
