/**
 * Elapsed time on the monotonic clock, whole milliseconds.
 *
 * Not `Date.now()` deltas: those can jump backward or forward across an NTP
 * step or a manual clock change. `performance.now()` cannot.
 */
export class Stopwatch {
  private readonly startedAt = performance.now();

  static start(): Stopwatch {
    return new Stopwatch();
  }

  elapsedMs(): number {
    return Math.round(performance.now() - this.startedAt);
  }
}
