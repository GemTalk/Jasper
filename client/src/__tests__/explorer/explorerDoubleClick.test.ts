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

    expect(detector.click('a').completesPair).toBe(false);
  });

  it('reports a double-click on the same key within the threshold', () => {
    const clock = makeClock();
    const detector = new DoubleClickDetector(500, clock.now);

    detector.click('a');
    clock.advance(200);

    expect(detector.click('a').completesPair).toBe(true);
  });

  it('does not report a double-click once the threshold has elapsed', () => {
    const clock = makeClock();
    const detector = new DoubleClickDetector(500, clock.now);

    detector.click('a');
    clock.advance(500);

    expect(detector.click('a').completesPair).toBe(false);
  });

  it('does not pair clicks on different keys', () => {
    const clock = makeClock();
    const detector = new DoubleClickDetector(500, clock.now);

    detector.click('a');
    clock.advance(100);

    expect(detector.click('b').completesPair).toBe(false);
  });

  it('starts a fresh pair after a completed double-click', () => {
    const clock = makeClock();
    const detector = new DoubleClickDetector(500, clock.now);

    detector.click('a');
    clock.advance(100);
    detector.click('a');
    clock.advance(100);

    expect(detector.click('a').completesPair).toBe(false);
  });

  it('does not pair a click with a withdrawn one on the same key', () => {
    const clock = makeClock();
    const detector = new DoubleClickDetector(500, clock.now);

    detector.click('a').withdraw();
    clock.advance(100);

    expect(detector.click('a').completesPair).toBe(false);
  });

  it('keeps a later click on the same key when an earlier one is withdrawn', () => {
    const clock = makeClock();
    const detector = new DoubleClickDetector(500, clock.now);
    const earlier = detector.click('a');
    clock.advance(600);
    detector.click('a');

    earlier.withdraw();
    clock.advance(100);

    expect(detector.click('a').completesPair).toBe(true);
  });

  it('keeps a later click on another key when an earlier one is withdrawn', () => {
    const clock = makeClock();
    const detector = new DoubleClickDetector(500, clock.now);
    const earlier = detector.click('a');
    detector.click('b');

    earlier.withdraw();
    clock.advance(100);

    expect(detector.click('b').completesPair).toBe(true);
  });

  it('reports whether a click completes a pair', () => {
    const clock = makeClock();
    const detector = new DoubleClickDetector(500, clock.now);
    const first = detector.click('a');
    clock.advance(100);

    const second = detector.click('a');

    expect([first.completesPair, second.completesPair]).toEqual([false, true]);
  });

  it('honors a custom threshold', () => {
    const clock = makeClock();
    const detector = new DoubleClickDetector(100, clock.now);

    detector.click('a');
    clock.advance(150);

    expect(detector.click('a').completesPair).toBe(false);
  });
});
