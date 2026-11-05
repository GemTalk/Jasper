import { describe, it, expect } from 'vitest';
import { decide } from './serverPluginMatch.globalSetup';

describe('serverPluginMatch global setup', () => {
  it('stops the run, with the check’s explanation, when the engine is different', () => {
    expect(() => decide(1, "The test stone's refactoring engine isn't this checkout's.\n")).toThrow(
      "The test stone's refactoring engine isn't this checkout's.",
    );
  });

  // A unit-only run needs no stone, and an unreachable one is reported by the
  // integration tests themselves.
  it.each([
    ['the engine matches or is absent', 0],
    ['the stone is unreachable', 2],
    ['the check timed out', null],
  ])('lets the run go ahead when %s', (_case, status) => {
    expect(() => decide(status, '')).not.toThrow();
  });
});
