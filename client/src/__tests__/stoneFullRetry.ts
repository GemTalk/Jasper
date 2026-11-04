import { setTimeout as sleepAsync } from 'node:timers/promises';
import { GciLibrary, type GciError } from '../gciLibrary';

/** GemStone's refusal of a login because every session the license allows is taken. */
export const GS_ERR_MAX_SESSIONS_LIMIT = 4039;

// A gem logged out or stopped moments ago keeps its slot until it has left the
// stone, so test files running at once can briefly find all 10 of the Community
// license's sessions taken. Under vitest's default 5 s test timeout, so a stone
// that stays full fails with the stone's own message rather than as a timeout.
export const STONE_FULL_WAIT_MS = 4000;
export const STONE_FULL_RETRY_MS = 100;

type LoginResult = { err: GciError };

export type RetryClock = { now: () => number; sleep: (ms: number) => void };

const sleeper = new Int32Array(new SharedArrayBuffer(4));
const realClock: RetryClock = {
  now: () => Date.now(),
  // Synchronous, because GciTsLogin is: every caller expects the login done on return.
  sleep: (ms) => void Atomics.wait(sleeper, 0, 0, ms),
};

const refusedAsFull = (result: LoginResult) => result.err.number === GS_ERR_MAX_SESSIONS_LIMIT;

function stillFull<R extends LoginResult>(result: R): R {
  return {
    ...result,
    err: {
      ...result.err,
      message: `${result.err.message} (still full after ${STONE_FULL_WAIT_MS} ms of retrying)`,
    },
  };
}

/**
 * Runs `attempt` until the stone stops refusing it as full, for up to
 * `STONE_FULL_WAIT_MS`. Any other outcome, success or another error, is
 * answered at once. Once the time is up the refusal is answered, saying so.
 */
export function retryWhileStoneFull<R extends LoginResult>(
  attempt: () => R,
  clock: RetryClock = realClock,
): R {
  const deadline = clock.now() + STONE_FULL_WAIT_MS;
  for (;;) {
    const result = attempt();
    if (!refusedAsFull(result)) return result;
    if (clock.now() >= deadline) return stillFull(result);
    clock.sleep(STONE_FULL_RETRY_MS);
  }
}

/** {@link retryWhileStoneFull} for a non-blocking login, which is retried from the start. */
export async function retryNbLoginWhileStoneFull<R extends LoginResult>(
  attempt: () => Promise<R>,
  signal?: AbortSignal,
): Promise<R> {
  const deadline = Date.now() + STONE_FULL_WAIT_MS;
  for (;;) {
    const result = await attempt();
    if (!refusedAsFull(result)) return result;
    if (Date.now() >= deadline) return stillFull(result);
    await sleepAsync(STONE_FULL_RETRY_MS, undefined, { signal });
  }
}

/**
 * Makes every blocking login on a `GciLibrary` wait out a full stone. Applied
 * to the GCI calls rather than the harness's own logins so that the logins app
 * code makes for itself during a test are covered too: Force Stop's sender,
 * the logout that ends a stopped run's gem, the server-plugin install.
 * Non-blocking logins can't be wrapped here, as their refusal only shows once
 * polled; see {@link retryNbLoginWhileStoneFull}.
 */
export function retryLoginsWhileStoneFull(): void {
  const { GciTsLogin, GciTsLogin_ } = GciLibrary.prototype;
  GciLibrary.prototype.GciTsLogin = function (...args) {
    return retryWhileStoneFull(() => GciTsLogin.apply(this, args));
  };
  GciLibrary.prototype.GciTsLogin_ = function (...args) {
    return retryWhileStoneFull(() => GciTsLogin_.apply(this, args));
  };
}
