import { describe, it, expect } from 'vitest';
import { parseApplyResult } from '../previewEnvelope';

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
    const r = parseApplyResult('{"failed":"nope"}');

    expect(r.applied).toBe(0);
    expect(r.failed).toEqual([]);
  });

  it('throws on a non-envelope payload', () => {
    expect(() => parseApplyResult('[]')).toThrow(/result envelope/);
    expect(() => parseApplyResult('42')).toThrow(/result envelope/);
  });
});
