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

  // Triage #14: the server scan cap used to be a hard-coded constant, so a user who wanted a wider
  // net on a broad term had no way to ask for one.
  describe('maxServerScan', () => {
    it('defaults to 200 and accepts a raised value', () => {
      expect(readOmniConfig(fakeConfig({})).maxServerScan).toBe(200);
      expect(readOmniConfig(fakeConfig({ maxServerScan: 2000 })).maxServerScan).toBe(2000);
    });

    it('floors a too-small value so a typo cannot make every search look capped', () => {
      expect(readOmniConfig(fakeConfig({ maxServerScan: 1 })).maxServerScan).toBe(20);
    });

    it('ceilings a huge value so settings.json cannot turn each keystroke into a full-image walk', () => {
      expect(readOmniConfig(fakeConfig({ maxServerScan: 5_000_000 })).maxServerScan).toBe(20_000);
    });

    it('falls back to the default for a non-number', () => {
      expect(readOmniConfig(fakeConfig({ maxServerScan: 'lots' })).maxServerScan).toBe(200);
    });
  });

  it('coerces a non-number to the default', () => {
    expect(
      readOmniConfig(fakeConfig({ maxResultsPerCategory: 'lots' })).maxResultsPerCategory,
    ).toBe(OMNI_DEFAULTS.maxResultsPerCategory);
  });

  it('keeps references in the preview pane unless explicitly turned off', () => {
    expect(readOmniConfig(fakeConfig({})).referencesInPreview).toBe(true);
    expect(readOmniConfig(fakeConfig({ referencesInPreview: false })).referencesInPreview).toBe(
      false,
    );
  });
});
