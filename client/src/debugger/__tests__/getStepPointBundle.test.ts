import { describe, it, expect } from 'vitest';
import { parseStepPointBundle } from '../queries/getStepPointBundle';

// The reply frames the source LAST and counts the rows ahead of it, so nothing in
// the source has to be escaped. These pin that framing: the source is whatever is
// left after the counted rows, byte for byte.
describe('parseStepPointBundle', () => {
  it('splits offsets, selector rows and source', () => {
    const raw = ['1,9,14', '2', '1\t0\t3\tfoo', '2\t8\t4\tbar:', 'foo\n  ^ self bar: 1'].join('\n');
    const bundle = parseStepPointBundle(raw);

    expect(bundle.offsets).toEqual([1, 9, 14]);
    expect(bundle.selectors).toEqual([
      { stepPoint: 1, selectorOffset: 0, selectorLength: 3, selectorText: 'foo' },
      { stepPoint: 2, selectorOffset: 8, selectorLength: 4, selectorText: 'bar:' },
    ]);
    expect(bundle.source).toBe('foo\n  ^ self bar: 1');
  });

  it('keeps a source that looks like its own header rows', () => {
    // The whole reason the count is sent: a method whose text is "2" or
    // "1<tab>0<tab>3<tab>foo" must not be re-read as framing.
    const source = '2\n1\t0\t3\tfoo\nstill source';
    const raw = ['5', '1', '1\t0\t3\tfoo', source].join('\n');
    expect(parseStepPointBundle(raw).source).toBe(source);
  });

  it('handles a method with no step points', () => {
    const bundle = parseStepPointBundle(['', '0', 'comment\n  ^ 1'].join('\n'));
    expect(bundle.offsets).toEqual([]);
    expect(bundle.selectors).toEqual([]);
    expect(bundle.source).toBe('comment\n  ^ 1');
  });

  it('keeps a trailing newline in the source', () => {
    expect(parseStepPointBundle(['1', '0', 'foo\n'].join('\n')).source).toBe('foo\n');
  });
});
