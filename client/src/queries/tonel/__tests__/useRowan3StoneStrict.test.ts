// The rowan3 tier skips when the machinery is absent, which means a green
// `npm test` on a base extent proves nothing about the Tonel feature. These pin
// the escape hatch that makes verification checkable — see `useRowan3Stone`.
//
// Each scenario is its own `describe` because `useRowan3Stone` captures the probe
// result in a `beforeAll`. The mock is seeded in a `beforeAll` registered BEFORE
// the gate's, so it is in place when the gate reads it; the environment variable
// is read at call time and so is set inside the test body.
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

vi.mock('../tonelCapability', () => ({ tonelCapability: vi.fn() }));

import { tonelCapability } from '../tonelCapability';
import { useRowan3Stone } from './useRowan3Stone';

const executor = () => (() => '') as never;

afterEach(() => {
  delete process.env.JASPER_REQUIRE_ROWAN3;
});

describe('useRowan3Stone — the machinery is absent', () => {
  beforeAll(() => {
    vi.mocked(tonelCapability).mockReturnValue({ available: false, missing: ['Rw>>thing'] });
  });
  const gate = useRowan3Stone(executor);

  it('skips rather than failing by default, so CI and base extents stay green', () => {
    const ctx = { skip: vi.fn() };
    expect(() => gate.skipUnlessAvailable(ctx)).not.toThrow();
    expect(ctx.skip).toHaveBeenCalled();
  });

  it('fails under JASPER_REQUIRE_ROWAN3, so a skip cannot pass for a verification', () => {
    process.env.JASPER_REQUIRE_ROWAN3 = '1';
    const ctx = { skip: vi.fn() };
    expect(() => gate.skipUnlessAvailable(ctx)).toThrow(/JASPER_REQUIRE_ROWAN3/);
    expect(ctx.skip).not.toHaveBeenCalled();
  });

  it('names the missing capabilities in that failure', () => {
    process.env.JASPER_REQUIRE_ROWAN3 = '1';
    expect(() => gate.skipUnlessAvailable({ skip: vi.fn() })).toThrow(/Rw>>thing/);
  });
});

describe('useRowan3Stone — the machinery is present', () => {
  beforeAll(() => {
    vi.mocked(tonelCapability).mockReturnValue({ available: true, missing: [] });
  });
  const gate = useRowan3Stone(executor);

  it('neither skips nor fails, with or without the variable', () => {
    process.env.JASPER_REQUIRE_ROWAN3 = '1';
    const ctx = { skip: vi.fn() };
    expect(() => gate.skipUnlessAvailable(ctx)).not.toThrow();
    expect(ctx.skip).not.toHaveBeenCalled();
  });
});
