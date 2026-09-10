import { expect } from 'vitest';

/**
 * Asserts that the event loop stays free to do other work while `callback`'s
 * returned promise is pending, by checking that a timer sampled roughly
 * every `pollTimeMs` accumulates at least `expectedIdleTimeMs` of real
 * elapsed time between firings before `callback` settles.
 *
 * Accumulates the actual elapsed time between firings (via `Date.now()`),
 * rather than crediting a fixed `pollTimeMs` per firing, so a firing
 * delayed by a busy event loop still counts for what it actually observed
 * instead of under- or over-counting relative to wall-clock time.
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
  let lastSampleAt = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    totalIdleTimeMs += now - lastSampleAt;
    lastSampleAt = now;
  }, pollTimeMs);

  try {
    await callback();
  } finally {
    clearInterval(timer);
  }

  expect(totalIdleTimeMs).toBeGreaterThanOrEqual(expectedIdleTimeMs);
}

/**
 * Asserts that the event loop is blocked from doing other work for the
 * entire duration of `callback`'s returned promise, by checking that a timer
 * sampled every `pollTimeMs` never gets a chance to fire before `callback`
 * settles.
 *
 * @param pollTimeMs - how often, in milliseconds, a responsive event loop
 *   would let the sampling timer fire.
 * @param callback - the operation to run and await while sampling.
 */
export async function expectEventLoopToBeBlockedDuring(
  pollTimeMs: number,
  callback: () => Promise<unknown>,
) {
  let timerWasRun = false;
  const timer = setInterval(() => (timerWasRun = true), pollTimeMs);

  try {
    await callback();
  } finally {
    clearInterval(timer);
  }

  expect(timerWasRun).toBe(false);
}
