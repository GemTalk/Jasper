import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enhancedInspectorPerfTracker,
  wrapWithEnhancedInspectorPerfProxy,
  buildEnhancedInspectorPerfStatusBarText,
  buildEnhancedInspectorPerfClipboardText,
  buildEnhancedInspectorPerfQuickPickItems,
  RESET_LABEL,
  COPY_LABEL,
} from '../enhancedInspectorPerfTracker';
import type { GciLibrary } from '../../gciLibrary';

// Reset singleton state before each test.
beforeEach(() => {
  enhancedInspectorPerfTracker.setEnabled(false);
  enhancedInspectorPerfTracker.reset();
  enhancedInspectorPerfTracker.onCountChanged = undefined;
});

// ── enhancedInspectorPerfTracker singleton ────────────────────────────────

describe('enhancedInspectorPerfTracker.increment', () => {
  it('does not count when disabled', () => {
    enhancedInspectorPerfTracker.setEnabled(false);
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    expect(enhancedInspectorPerfTracker.count).toBe(0);
    expect(enhancedInspectorPerfTracker.methodCounts.size).toBe(0);
  });

  it('increments count when enabled', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    expect(enhancedInspectorPerfTracker.count).toBe(1);
  });

  it('tracks per-method counts', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    enhancedInspectorPerfTracker.increment('GciTsPerformFetchBytes');
    expect(enhancedInspectorPerfTracker.methodCounts.get('GciTsExecuteFetchBytes')).toBe(2);
    expect(enhancedInspectorPerfTracker.methodCounts.get('GciTsPerformFetchBytes')).toBe(1);
    expect(enhancedInspectorPerfTracker.count).toBe(3);
  });

  it('fires onCountChanged when enabled', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    const cb = vi.fn();
    enhancedInspectorPerfTracker.onCountChanged = cb;
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    expect(cb).toHaveBeenCalledOnce();
  });

  it('does not fire onCountChanged when disabled', () => {
    enhancedInspectorPerfTracker.setEnabled(false);
    const cb = vi.fn();
    enhancedInspectorPerfTracker.onCountChanged = cb;
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('enhancedInspectorPerfTracker.reset', () => {
  it('clears count and methodCounts', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    enhancedInspectorPerfTracker.reset();
    expect(enhancedInspectorPerfTracker.count).toBe(0);
    expect(enhancedInspectorPerfTracker.methodCounts.size).toBe(0);
  });

  it('fires onCountChanged', () => {
    const cb = vi.fn();
    enhancedInspectorPerfTracker.onCountChanged = cb;
    enhancedInspectorPerfTracker.reset();
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe('enhancedInspectorPerfTracker.setEnabled', () => {
  it('enables tracking', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    expect(enhancedInspectorPerfTracker.enabled).toBe(true);
  });

  it('disabling clears count and methodCounts', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    enhancedInspectorPerfTracker.setEnabled(false);
    expect(enhancedInspectorPerfTracker.count).toBe(0);
    expect(enhancedInspectorPerfTracker.methodCounts.size).toBe(0);
  });

  it('fires onCountChanged on enable and disable', () => {
    const cb = vi.fn();
    enhancedInspectorPerfTracker.onCountChanged = cb;
    enhancedInspectorPerfTracker.setEnabled(true);
    enhancedInspectorPerfTracker.setEnabled(false);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

// ── wrapWithEnhancedInspectorPerfProxy ────────────────────────────────────

function makeFakeGci(): GciLibrary {
  return {
    GciTsExecuteFetchBytes: vi.fn(() => ({ bytesReturned: 4, data: 'ok', err: { number: 0 } })),
    GciTsOopIsSpecial: vi.fn(() => false),
    GciTsCallInProgress: vi.fn(() => false),
  } as unknown as GciLibrary;
}

describe('wrapWithEnhancedInspectorPerfProxy', () => {
  it('counts a round-trip method when enabled', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    const proxy = wrapWithEnhancedInspectorPerfProxy(makeFakeGci());
    proxy.GciTsExecuteFetchBytes({}, null, -1, 0n, 0n, 0n, 1024);
    expect(enhancedInspectorPerfTracker.count).toBe(1);
    expect(enhancedInspectorPerfTracker.methodCounts.get('GciTsExecuteFetchBytes')).toBe(1);
  });

  it('does not count a round-trip method when disabled', () => {
    const proxy = wrapWithEnhancedInspectorPerfProxy(makeFakeGci());
    proxy.GciTsExecuteFetchBytes({}, null, -1, 0n, 0n, 0n, 1024);
    expect(enhancedInspectorPerfTracker.count).toBe(0);
  });

  it('does not count a non-round-trip method even when enabled', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    const proxy = wrapWithEnhancedInspectorPerfProxy(makeFakeGci());
    proxy.GciTsOopIsSpecial(0n);
    expect(enhancedInspectorPerfTracker.count).toBe(0);
  });

  // Regression: GciTsCallInProgress is a local session-state check called on every
  // executeFetchString guard. It must never be counted or the tracker explodes.
  it('does not count GciTsCallInProgress', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    const proxy = wrapWithEnhancedInspectorPerfProxy(makeFakeGci());
    proxy.GciTsCallInProgress({});
    expect(enhancedInspectorPerfTracker.count).toBe(0);
  });

  it('passes the return value through unchanged', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    const proxy = wrapWithEnhancedInspectorPerfProxy(makeFakeGci());
    const result = proxy.GciTsExecuteFetchBytes({}, null, -1, 0n, 0n, 0n, 1024);
    expect(result.data).toBe('ok');
  });

  it('calls the original function', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    const fake = makeFakeGci();
    const proxy = wrapWithEnhancedInspectorPerfProxy(fake);
    proxy.GciTsExecuteFetchBytes({}, null, -1, 0n, 0n, 0n, 1024);
    expect(fake.GciTsExecuteFetchBytes).toHaveBeenCalledOnce();
  });
});

// ── buildEnhancedInspectorPerfStatusBarText ───────────────────────────────

describe('buildEnhancedInspectorPerfStatusBarText', () => {
  it('formats zero count', () => {
    expect(buildEnhancedInspectorPerfStatusBarText(0)).toBe('$(record) Enhanced Inspector Perf: 0');
  });

  it('formats a non-zero count', () => {
    expect(buildEnhancedInspectorPerfStatusBarText(14)).toBe(
      '$(record) Enhanced Inspector Perf: 14',
    );
  });
});

// ── buildEnhancedInspectorPerfClipboardText ───────────────────────────────

describe('buildEnhancedInspectorPerfClipboardText', () => {
  it('shows zero total with no methods when empty', () => {
    const text = buildEnhancedInspectorPerfClipboardText(enhancedInspectorPerfTracker);
    expect(text).toBe('Enhanced Inspector Perf: 0 total GCI calls');
  });

  it('includes the total count header', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    const text = buildEnhancedInspectorPerfClipboardText(enhancedInspectorPerfTracker);
    expect(text).toContain('Enhanced Inspector Perf: 2 total GCI calls');
  });

  it('lists methods with their counts', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    enhancedInspectorPerfTracker.increment('GciTsPerformFetchBytes');
    const text = buildEnhancedInspectorPerfClipboardText(enhancedInspectorPerfTracker);
    expect(text).toContain('  GciTsExecuteFetchBytes: 1');
    expect(text).toContain('  GciTsPerformFetchBytes: 1');
  });

  it('sorts methods by count descending', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    enhancedInspectorPerfTracker.increment('GciTsResolveSymbol'); // count: 1, inserted first
    enhancedInspectorPerfTracker.increment('GciTsPerformFetchBytes'); // count: 2, inserted second
    enhancedInspectorPerfTracker.increment('GciTsPerformFetchBytes');
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes'); // count: 3, inserted third
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    const lines = buildEnhancedInspectorPerfClipboardText(enhancedInspectorPerfTracker).split('\n');
    expect(lines[1]).toContain('GciTsExecuteFetchBytes: 3');
    expect(lines[2]).toContain('GciTsPerformFetchBytes: 2');
    expect(lines[3]).toContain('GciTsResolveSymbol: 1');
  });
});

// ── buildEnhancedInspectorPerfQuickPickItems ──────────────────────────────

describe('buildEnhancedInspectorPerfQuickPickItems', () => {
  it('always has Reset Counter as first item', () => {
    const items = buildEnhancedInspectorPerfQuickPickItems(enhancedInspectorPerfTracker);
    expect(items[0].label).toBe(RESET_LABEL);
  });

  it('always has Copy to Clipboard as second item', () => {
    const items = buildEnhancedInspectorPerfQuickPickItems(enhancedInspectorPerfTracker);
    expect(items[1].label).toBe(COPY_LABEL);
  });

  it('has a separator as third item', () => {
    const items = buildEnhancedInspectorPerfQuickPickItems(enhancedInspectorPerfTracker);
    expect(items[2].isSeparator).toBe(true);
  });

  it('shows only the three fixed items when there are no method counts', () => {
    const items = buildEnhancedInspectorPerfQuickPickItems(enhancedInspectorPerfTracker);
    expect(items).toHaveLength(3);
  });

  it('Reset Counter description shows current count', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    const items = buildEnhancedInspectorPerfQuickPickItems(enhancedInspectorPerfTracker);
    expect(items[0].description).toContain('2');
  });

  it('lists methods after the separator sorted by count descending', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    enhancedInspectorPerfTracker.increment('GciTsResolveSymbol'); // count: 1, inserted first
    enhancedInspectorPerfTracker.increment('GciTsPerformFetchBytes'); // count: 2, inserted second
    enhancedInspectorPerfTracker.increment('GciTsPerformFetchBytes');
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes'); // count: 3, inserted third
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    const items = buildEnhancedInspectorPerfQuickPickItems(enhancedInspectorPerfTracker);
    // items[0]=Reset, [1]=Copy, [2]=separator, [3..5]=methods high→low
    expect(items[3].label).toBe('GciTsExecuteFetchBytes');
    expect(items[3].description).toBe('3');
    expect(items[4].label).toBe('GciTsPerformFetchBytes');
    expect(items[4].description).toBe('2');
    expect(items[5].label).toBe('GciTsResolveSymbol');
    expect(items[5].description).toBe('1');
  });

  it('method descriptions are strings not numbers', () => {
    enhancedInspectorPerfTracker.setEnabled(true);
    enhancedInspectorPerfTracker.increment('GciTsExecuteFetchBytes');
    const items = buildEnhancedInspectorPerfQuickPickItems(enhancedInspectorPerfTracker);
    expect(typeof items[3].description).toBe('string');
  });
});
