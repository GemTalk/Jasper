import { describe, it, expect } from 'vitest';
import { readOmniConfig, OMNI_DEFAULTS, ConfigLike } from '../omniConfig';

/** A fake ConfigLike backed by a plain map (undefined key → provided default). */
function fakeConfig(values: Record<string, unknown>): ConfigLike {
  return {
    get<T>(section: string, defaultValue: T): T {
      return section in values ? (values[section] as T) : defaultValue;
    },
  };
}

describe('readOmniConfig', () => {
  it('returns the documented defaults for an empty config', () => {
    expect(readOmniConfig(fakeConfig({}))).toEqual(OMNI_DEFAULTS);
  });

  it('accepts valid values', () => {
    const cfg = readOmniConfig(
      fakeConfig({
        matchMode: 'substring',
        caseSensitive: true,
        categories: ['methods', 'classes'],
        maxResultsPerCategory: 50,
        debounceMs: 0,
        methodMinQueryLength: 2,
      }),
    );
    expect(cfg.matchMode).toBe('substring');
    expect(cfg.caseSensitive).toBe(true);
    // Canonical display order is preserved regardless of the order given.
    expect(cfg.enabledCategories).toEqual(['classes', 'methods']);
    expect(cfg.maxResultsPerCategory).toBe(50);
    expect(cfg.debounceMs).toBe(0);
    expect(cfg.methodMinQueryLength).toBe(2);
  });

  it('falls back to fuzzy on an unknown matchMode', () => {
    expect(readOmniConfig(fakeConfig({ matchMode: 'regex' })).matchMode).toBe('fuzzy');
  });

  it('drops unknown category ids and never ends up empty', () => {
    expect(readOmniConfig(fakeConfig({ categories: ['bogus'] })).enabledCategories).toEqual(
      OMNI_DEFAULTS.enabledCategories,
    );
    expect(readOmniConfig(fakeConfig({ categories: [] })).enabledCategories).toEqual(
      OMNI_DEFAULTS.enabledCategories,
    );
  });

  it('clamps + truncates out-of-range / fractional numbers', () => {
    const cfg = readOmniConfig(
      fakeConfig({ maxResultsPerCategory: 99999, debounceMs: -5, methodMinQueryLength: 2.9 }),
    );
    expect(cfg.maxResultsPerCategory).toBe(200); // capped
    expect(cfg.debounceMs).toBe(0); // floored
    expect(cfg.methodMinQueryLength).toBe(2); // truncated
  });

  it('coerces a non-number to the default', () => {
    expect(
      readOmniConfig(fakeConfig({ maxResultsPerCategory: 'lots' })).maxResultsPerCategory,
    ).toBe(OMNI_DEFAULTS.maxResultsPerCategory);
  });
});
