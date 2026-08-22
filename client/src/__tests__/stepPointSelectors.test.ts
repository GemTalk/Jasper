import { describe, it, expect } from 'vitest';

import { findNearestStepPoint, expandKeywordParts } from '../stepPointSelectors';
import type { StepPointSelectorInfo } from '../browserQueries';

describe('findNearestStepPoint', () => {
  it('returns null for empty list', () => {
    expect(findNearestStepPoint([], 10)).toBeNull();
  });

  it('returns exact match when cursor is within selector range', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 0, selectorLength: 4, selectorText: 'size' },
      { stepPoint: 2, selectorOffset: 20, selectorLength: 3, selectorText: 'at:' },
    ];
    const result = findNearestStepPoint(infos, 21);
    expect(result).toEqual(infos[1]);
  });

  it('returns match when cursor is at selector start', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 10, selectorLength: 4, selectorText: 'size' },
    ];
    const result = findNearestStepPoint(infos, 10);
    expect(result).toEqual(infos[0]);
  });

  it('returns match when cursor is at selector end', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 10, selectorLength: 4, selectorText: 'size' },
    ];
    const result = findNearestStepPoint(infos, 14);
    expect(result).toEqual(infos[0]);
  });

  it('falls back to nearest by distance when not contained', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 0, selectorLength: 4, selectorText: 'foo' },
      { stepPoint: 2, selectorOffset: 50, selectorLength: 3, selectorText: 'bar' },
    ];
    // Cursor at 45 — closer to step 2 (midpoint 51.5) than step 1 (midpoint 2)
    const result = findNearestStepPoint(infos, 45);
    expect(result).toEqual(infos[1]);
  });

  it('handles cursor before all selectors', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 100, selectorLength: 4, selectorText: 'size' },
      { stepPoint: 2, selectorOffset: 200, selectorLength: 3, selectorText: 'at:' },
    ];
    const result = findNearestStepPoint(infos, 0);
    expect(result).toEqual(infos[0]);
  });

  it('handles cursor after all selectors', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 10, selectorLength: 4, selectorText: 'foo' },
      { stepPoint: 2, selectorOffset: 30, selectorLength: 3, selectorText: 'bar' },
    ];
    const result = findNearestStepPoint(infos, 500);
    expect(result).toEqual(infos[1]);
  });

  it('selects correct selector when cursor is on equals: not at:', () => {
    // Simulates: "self at: idx equals: val" with 0-based offsets
    // at: starts at offset 8, equals: starts at offset 16
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 8, selectorLength: 3, selectorText: 'at:' },
      { stepPoint: 2, selectorOffset: 16, selectorLength: 7, selectorText: 'equals:' },
    ];
    // Cursor at offset 18 — within 'equals:' (16..23)
    const result = findNearestStepPoint(infos, 18);
    expect(result).toEqual(infos[1]);
  });

  it('selects at: when cursor is on at: not equals:', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 8, selectorLength: 3, selectorText: 'at:' },
      { stepPoint: 2, selectorOffset: 16, selectorLength: 7, selectorText: 'equals:' },
    ];
    // Cursor at offset 9 — within 'at:' (8..11)
    const result = findNearestStepPoint(infos, 9);
    expect(result).toEqual(infos[0]);
  });

  it('returns first contained match when cursor is in overlapping ranges', () => {
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 10, selectorText: 'longSelector:' },
      { stepPoint: 2, selectorOffset: 8, selectorLength: 4, selectorText: 'sel:' },
    ];
    // Cursor at 9 is within both — returns first match
    const result = findNearestStepPoint(infos, 9);
    expect(result).toEqual(infos[0]);
  });
});

// ── expandKeywordParts ──────────────────────────────────

describe('expandKeywordParts', () => {
  it('returns infos unchanged for unary messages', () => {
    const source = 'self size';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 4, selectorText: 'size' },
    ];
    expect(expandKeywordParts(source, infos)).toEqual(infos);
  });

  it('finds continuation keyword for assert:equals:', () => {
    //              0         1         2         3
    //              0123456789012345678901234567890123456
    const source = 'self assert: (x at: 1) equals: true.';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 16, selectorLength: 3, selectorText: 'at:' },
      { stepPoint: 2, selectorOffset: 5, selectorLength: 7, selectorText: 'assert:' },
    ];
    const expanded = expandKeywordParts(source, infos);
    expect(expanded).toHaveLength(3);
    // at: has no continuation (argument is literal, then ) exits)
    expect(expanded[0]).toEqual(infos[0]);
    // assert: should get equals: as continuation
    expect(expanded[1]).toEqual(infos[1]);
    expect(expanded[2]).toEqual({
      stepPoint: 2,
      selectorOffset: 23,
      selectorLength: 7,
      selectorText: 'equals:',
    });
  });

  it('finds continuation keywords for perform:env:', () => {
    //              0123456789012345678901234567890
    const source = 'true perform: #foo env: 2';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 8, selectorText: 'perform:' },
    ];
    const expanded = expandKeywordParts(source, infos);
    expect(expanded).toHaveLength(2);
    expect(expanded[1]).toEqual({
      stepPoint: 1,
      selectorOffset: 19,
      selectorLength: 4,
      selectorText: 'env:',
    });
  });

  it('skips keywords inside parenthesized arguments', () => {
    //              01234567890123456789012345678901234567890
    const source = 'self assert: (x at: 1) equals: true.';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 7, selectorText: 'assert:' },
    ];
    const expanded = expandKeywordParts(source, infos);
    // Should find equals: but NOT at: (which is inside parens)
    const continuations = expanded.filter((e) => e !== infos[0]);
    expect(continuations).toHaveLength(1);
    expect(continuations[0].selectorText).toBe('equals:');
  });

  it('skips symbol literals', () => {
    //              012345678901234567890123456
    const source = 'self foo: #bar: baz: 2';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 4, selectorText: 'foo:' },
    ];
    const expanded = expandKeywordParts(source, infos);
    // #bar: is a symbol literal, baz: is the continuation
    const texts = expanded.map((e) => e.selectorText);
    expect(texts).toContain('foo:');
    expect(texts).toContain('baz:');
    expect(texts).not.toContain('bar:');
  });

  it('stops at period', () => {
    const source = 'self foo: 1. self bar: 2';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 4, selectorText: 'foo:' },
    ];
    const expanded = expandKeywordParts(source, infos);
    // bar: is after period — should not be included
    expect(expanded).toHaveLength(1);
  });

  it('stops at semicolon (cascade)', () => {
    const source = 'self foo: 1; bar: 2';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 4, selectorText: 'foo:' },
    ];
    const expanded = expandKeywordParts(source, infos);
    expect(expanded).toHaveLength(1);
  });

  it('does not expand unary messages (no colon)', () => {
    const source = 'self size printString';
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 5, selectorLength: 4, selectorText: 'size' },
    ];
    const expanded = expandKeywordParts(source, infos);
    expect(expanded).toHaveLength(1);
  });
});

// ── findNearestStepPoint with expanded keywords ─────────

describe('findNearestStepPoint with keyword expansion', () => {
  it('matches cursor on equals: to assert:equals: step point', () => {
    // Simulates expanded infos for: self assert: (x at: 1) equals: true.
    const infos: StepPointSelectorInfo[] = [
      { stepPoint: 1, selectorOffset: 14, selectorLength: 3, selectorText: 'at:' },
      { stepPoint: 2, selectorOffset: 5, selectorLength: 7, selectorText: 'assert:' },
      { stepPoint: 2, selectorOffset: 23, selectorLength: 7, selectorText: 'equals:' },
    ];
    // Cursor on equals: at offset 25
    const result = findNearestStepPoint(infos, 25);
    expect(result!.stepPoint).toBe(2);
    expect(result!.selectorText).toBe('equals:');
  });
});
