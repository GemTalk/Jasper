import { describe, it, expect } from 'vitest';
import { lineDiff } from '../lineDiff';

describe('lineDiff', () => {
  it('reports identical text as all context', () => {
    const diff = lineDiff('a\nb\nc', 'a\nb\nc');

    expect(diff.every((l) => l.type === 'context')).toBe(true);
    expect(diff.map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });

  it('marks a changed line as a deletion followed by an addition', () => {
    const diff = lineDiff('x\n^count', 'x\n^tally');

    expect(diff).toEqual([
      { type: 'context', text: 'x' },
      { type: 'del', text: '^count' },
      { type: 'add', text: '^tally' },
    ]);
  });

  it('keeps unchanged surrounding lines as context', () => {
    const diff = lineDiff('a\nb\nc', 'a\nB\nc');

    expect(diff.filter((l) => l.type === 'context').map((l) => l.text)).toEqual(['a', 'c']);
    expect(diff.filter((l) => l.type === 'del').map((l) => l.text)).toEqual(['b']);
    expect(diff.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['B']);
  });

  it('handles a pure insertion', () => {
    const diff = lineDiff('a\nc', 'a\nb\nc');

    expect(diff.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['b']);
    expect(diff.filter((l) => l.type === 'del')).toHaveLength(0);
  });

  it('handles a pure deletion', () => {
    const diff = lineDiff('a\nb\nc', 'a\nc');

    expect(diff.filter((l) => l.type === 'del').map((l) => l.text)).toEqual(['b']);
    expect(diff.filter((l) => l.type === 'add')).toHaveLength(0);
  });
});
