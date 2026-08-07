import { describe, it, expect } from 'vitest';
import { asCount } from '../previewCounts';

/**
 * The count coercion every refactoring preview parser shares. Previously thirteen private
 * copies with one set of tests reached through methodRelocationPreview; the tests live with
 * the canonical module now.
 */
describe('asCount', () => {
  it('passes finite non-negative integers through', () => {
    expect(asCount(5)).toBe(5);
    expect(asCount(0)).toBe(0);
  });

  it('clamps anything that is not a finite non-negative number to 0', () => {
    expect(asCount(-1)).toBe(0);
    expect(asCount(Number.NaN)).toBe(0);
    expect(asCount(Infinity)).toBe(0);
    expect(asCount(-Infinity)).toBe(0);
    expect(asCount('7')).toBe(0);
    expect(asCount(undefined)).toBe(0);
    expect(asCount(null)).toBe(0);
    expect(asCount({})).toBe(0);
  });

  // These feed `total` / `applied` / `nextOffset` into the preview UI and its pagination
  // arithmetic, where a fraction has no meaning — half a change cannot be rendered, and a
  // fractional offset asks for a page boundary that does not exist.
  it('truncates a fractional count toward zero', () => {
    expect(asCount(2.5)).toBe(2);
    expect(asCount(0.9)).toBe(0);
    expect(asCount(7.000001)).toBe(7);
  });
});
