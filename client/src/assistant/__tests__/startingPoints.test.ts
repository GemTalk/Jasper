import { describe, expect, it } from 'vitest';
import { parseStartingPoints, startingPointNotes } from '../queries/startingPoints';

describe('parseStartingPoints', () => {
  it('starts from the methods no other method of the class sends to', () => {
    const raw = [
      'C\tRingBuffer',
      'M\t0\tadd:',
      'S\t0\tadd:\t0\tisFull',
      'M\t0\tinitializeCapacity:',
      'M\t0\tisFull',
      'M\t1\tnew:',
      'S\t1\tnew:\t0\tinitializeCapacity:',
      '',
    ].join('\n');

    const result = parseStartingPoints(raw);

    expect(result).toEqual({
      className: 'RingBuffer',
      starts: [
        { isMeta: false, selector: 'add:' },
        { isMeta: true, selector: 'new:' },
      ],
      noneUncalled: false,
    });
  });

  it('does not count a method calling itself', () => {
    const raw = ['C\tTree', 'M\t0\twalk', 'S\t0\twalk\t0\twalk', ''].join('\n');

    const result = parseStartingPoints(raw);

    expect(result.starts).toEqual([{ isMeta: false, selector: 'walk' }]);
  });

  it('falls back to the least-called methods when every method is called from inside', () => {
    const raw = [
      'C\tPingPong',
      'M\t0\tping',
      'M\t0\tpong',
      'M\t0\tserve',
      'S\t0\tping\t0\tpong',
      'S\t0\tpong\t0\tping',
      'S\t0\tserve\t0\tping',
      'S\t0\tping\t0\tserve',
      '',
    ].join('\n');

    const result = parseStartingPoints(raw);

    expect(result.noneUncalled).toBe(true);
    expect(result.starts.map((m) => m.selector)).toEqual(['pong', 'serve']);
  });
});

describe('startingPointNotes', () => {
  it('notes each starting point as having no senders in its class', () => {
    const found = parseStartingPoints(
      ['C\tParser', 'M\t0\tparse', 'M\t0\tnext', 'S\t0\tparse\t0\tnext', 'M\t1\tparse:', ''].join(
        '\n',
      ),
    );

    const notes = startingPointNotes(found);

    expect([...notes].map(([key, note]) => [key, note.text])).toEqual([
      ['Parser>>parse', 'no senders in Parser'],
      ['Parser class>>parse:', 'no senders in Parser'],
    ]);
  });

  it('notes nothing when every method has a sender in its class', () => {
    const found = parseStartingPoints(
      [
        'C\tPingPong',
        'M\t0\tping',
        'M\t0\tpong',
        'S\t0\tping\t0\tpong',
        'S\t0\tpong\t0\tping',
        '',
      ].join('\n'),
    );

    const notes = startingPointNotes(found);

    expect(notes.size).toBe(0);
  });
});
