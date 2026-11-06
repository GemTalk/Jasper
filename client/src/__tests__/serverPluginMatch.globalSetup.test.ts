import { describe, it, expect } from 'vitest';
import { mismatchFrom } from './serverPluginMatch.globalSetup';

describe('serverPluginMatch global setup', () => {
  it('reports the check’s explanation when the engine is different', () => {
    expect(mismatchFrom(1, "The test stone's refactoring engine isn't this checkout's.\n")).toBe(
      "The test stone's refactoring engine isn't this checkout's.",
    );
  });

  // An unreachable stone is reported by the integration tests themselves.
  it.each([
    ['the engine matches or is absent', 0],
    ['the stone is unreachable', 2],
    ['the check timed out', null],
  ])('reports no mismatch when %s', (_case, status) => {
    expect(mismatchFrom(status, 'some output')).toBeNull();
  });
});
