import { describe, it, expect, vi, afterEach } from 'vitest';
import { Stopwatch } from '../stopwatch';

describe('Stopwatch', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports non-negative whole milliseconds', () => {
    const stopwatch = Stopwatch.start();

    const elapsed = stopwatch.elapsedMs();

    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(elapsed)).toBe(true);
  });

  it('reports the elapsed time rounded to whole milliseconds', () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1234.6);

    const stopwatch = Stopwatch.start();
    const elapsed = stopwatch.elapsedMs();

    expect(elapsed).toBe(235);
  });
});
