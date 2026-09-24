import { describe, it, expect, vi } from 'vitest';
import { Stopwatch } from '../stopwatch';

describe('Stopwatch', () => {
  it('reports non-negative whole milliseconds', () => {
    const stopwatch = Stopwatch.start();

    const elapsed = stopwatch.elapsedMs();

    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(elapsed)).toBe(true);
  });

  it('reports the elapsed time rounded to whole milliseconds', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(1234.6);

    const stopwatch = Stopwatch.start();
    const elapsed = stopwatch.elapsedMs();

    expect(elapsed).toBe(235);

    nowSpy.mockRestore();
  });
});
