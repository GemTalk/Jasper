import { expect } from 'vitest';

/**
 * Asserts that the event loop stays free to do other work while `callback`'s
 * returned promise is pending, by checking that a timer sampled every
 * `pollTimeMs` accumulates at least `expectedIdleTimeMs` of idle time before
 * `callback` settles.
 *
 * @param pollTimeMs - how often, in milliseconds, to sample the event loop's idle time.
 * @param expectedIdleTimeMs - the minimum accumulated idle time, in
 *   milliseconds, `callback` must allow for.
 * @param callback - the operation to run and await while sampling.
 */
export async function expectEventLoopToRemainResponsiveDuring(
  pollTimeMs: number,
  expectedIdleTimeMs: number,
  callback: () => Promise<unknown>,
) {
  let totalIdleTimeMs = 0;
  const timer = setInterval(() => (totalIdleTimeMs += pollTimeMs), pollTimeMs);

  try {
    await callback();
  } finally {
    clearInterval(timer);
  }

  expect(totalIdleTimeMs).toBeGreaterThan(expectedIdleTimeMs);
}
