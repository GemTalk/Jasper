import { describe, it, expect, vi } from 'vitest';
import { ApplyResult, parseApplyResult, parseApplyResultWith } from '../previewEnvelope';
import { asCount } from '../previewCounts';

describe('parseApplyResult (shared apply-result envelope)', () => {
  it('reads applied count, failures, and no error on a clean result', () => {
    const r = parseApplyResult('{"applied":3,"failed":[]}');

    expect(r.applied).toBe(3);
    expect(r.failed).toEqual([]);
    expect(r.error).toBeUndefined();
  });

  it('reads each failure with id, label, and error', () => {
    const r = parseApplyResult(
      '{"applied":1,"failed":[{"id":"c1","label":"Foo>>bar","error":"undeclared"}]}',
    );

    expect(r.failed).toEqual([{ id: 'c1', label: 'Foo>>bar', error: 'undeclared' }]);
  });

  it('fills placeholder defaults for a malformed failure entry', () => {
    const r = parseApplyResult('{"applied":0,"failed":[{}]}');

    expect(r.failed).toEqual([{ id: '?', label: '?', error: 'unknown error' }]);
  });

  it('surfaces a top-level error string', () => {
    const r = parseApplyResult('{"applied":0,"failed":[],"error":"preview session expired"}');

    expect(r.error).toBe('preview session expired');
  });

  it('clamps a missing/negative applied count to zero and ignores non-array failures', () => {
    const missing = parseApplyResult('{"failed":"nope"}');

    expect(missing.applied).toBe(0);
    expect(missing.failed).toEqual([]);

    expect(parseApplyResult('{"applied":-1,"failed":[]}').applied).toBe(0);
    expect(parseApplyResult('{"applied":"lots","failed":[]}').applied).toBe(0);
  });

  it('throws on a non-envelope payload', () => {
    expect(() => parseApplyResult('[]')).toThrow(/result envelope/);
    expect(() => parseApplyResult('42')).toThrow(/result envelope/);
  });
});

/**
 * The hook is what the eight simple families and the five supersets both go through, so
 * pin it directly rather than only through the families: that `extend`'s fields arrive
 * alongside the base, and — invisible to the type system — that a runtime key collision
 * resolves in `extend`'s favour, since the result is `{ ...base, ...extend(env) }`.
 * `Omit<T, keyof ApplyResult>` stops a family DECLARING a base field; it cannot stop one
 * being present at runtime.
 */
describe('parseApplyResultWith', () => {
  it('carries the extra fields alongside the shared base', () => {
    const r = parseApplyResultWith<ApplyResult & { committed: boolean; migrated: number }>(
      '{"applied":3,"failed":[],"committed":true,"migratedFailures":2}',
      (env) => ({ committed: env.committed === true, migrated: asCount(env.migratedFailures) }),
    );

    expect(r).toEqual({ applied: 3, failed: [], error: undefined, committed: true, migrated: 2 });
  });

  it('parses the base once, so a family gets the same coercion as everyone else', () => {
    const r = parseApplyResultWith<ApplyResult & { committed: boolean }>(
      '{"applied":-4,"failed":"nope","committed":true}',
      (env) => ({ committed: env.committed === true }),
    );

    expect(r.applied).toBe(0);
    expect(r.failed).toEqual([]);
    expect(r.committed).toBe(true);
  });

  it('lets extend win a key collision — the spread order, which types cannot enforce', () => {
    // No cast needed, which is the point: Omit<T, keyof ApplyResult> is `{}` here, so
    // the compiler accepts an object carrying `applied` and the spread silently wins.
    const r = parseApplyResultWith<ApplyResult>('{"applied":1,"failed":[]}', () => ({
      applied: 99,
    }));

    expect(r.applied).toBe(99);
  });

  it('still throws on a non-envelope payload before extend is consulted', () => {
    const extend = vi.fn(() => ({}));

    expect(() => parseApplyResultWith('[]', extend)).toThrow(/result envelope/);
    expect(extend).not.toHaveBeenCalled();
  });
});
