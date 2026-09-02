import { describe, it, expect } from 'vitest';
import { DoubleClickDetector } from '../../explorerDoubleClick';

// A controllable clock so click timing is deterministic.
function makeClock(start = 1000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('DoubleClickDetector', () => {
  it('treats the first click on a key as a single click', () => {
    const clock = makeClock();
    const detector = new DoubleClickDetector(500, clock.now);

    expect(detector.register('a')).toBe(false);
  });

  it('reports a double-click on the same key within the threshold', () => {
    const clock = makeClock();
    const detector = new DoubleClickDetector(500, clock.now);

    detector.register('a');
    clock.advance(200);

    expect(detector.register('a')).toBe(true);
  });

  it('does not report a double-click once the threshold has elapsed', () => {
    const clock = makeClock();
    const detector = new DoubleClickDetector(500, clock.now);

    detector.register('a');
    clock.advance(500);

    expect(detector.register('a')).toBe(false);
  });

  it('does not pair clicks on different keys', () => {
    const clock = makeClock();
    const detector = new DoubleClickDetector(500, clock.now);

    detector.register('a');
    clock.advance(100);

    expect(detector.register('b')).toBe(false);
  });

  it('starts a fresh pair after a completed double-click', () => {
    const clock = makeClock();
    const detector = new DoubleClickDetector(500, clock.now);

    detector.register('a');
    clock.advance(100);
    detector.register('a');
    clock.advance(100);

    expect(detector.register('a')).toBe(false);
  });

  it('honors a custom threshold', () => {
    const clock = makeClock();
    const detector = new DoubleClickDetector(100, clock.now);

    detector.register('a');
    clock.advance(150);

    expect(detector.register('a')).toBe(false);
  });
});
