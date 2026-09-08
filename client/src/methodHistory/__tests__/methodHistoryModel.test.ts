import { describe, it, expect } from 'vitest';
import {
  parseMethodHistory,
  parseRemoveMethodHistoryResult,
  currentVersion,
  MethodVersion,
} from '../methodHistoryModel';

describe('parseMethodHistory', () => {
  it('parses each version’s index, stamp, author, category, source, and current flag', () => {
    const json = JSON.stringify([
      {
        index: 2,
        timeStamp: '2026-08-25T09:56:44',
        userId: 'SystemUser',
        category: 'accessing',
        isCurrent: true,
        source: 'bar ^2',
      },
      {
        index: 1,
        timeStamp: '2026-08-25T09:55:53',
        userId: 'DataCurator',
        category: 'accessing',
        isCurrent: false,
        source: 'bar ^1',
      },
    ]);

    const versions = parseMethodHistory(json);

    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({
      index: 2,
      userId: 'SystemUser',
      isCurrent: true,
      source: 'bar ^2',
      notInHistory: false,
    });
    expect(versions[1].source).toBe('bar ^1');
  });

  it('marks the synthetic current version that is not in the recorded history', () => {
    const json = JSON.stringify([
      {
        index: 0,
        timeStamp: '',
        userId: '',
        category: 'accessing',
        isCurrent: true,
        notInHistory: true,
        source: 'bar ^42',
      },
    ]);

    const [v] = parseMethodHistory(json);

    expect(v.notInHistory).toBe(true);
    expect(v.isCurrent).toBe(true);
  });

  it('throws the engine’s error envelope for an unbound class', () => {
    expect(() => parseMethodHistory('{"error":"not a class: Nope"}')).toThrow('not a class: Nope');
  });

  it('throws when the payload is not a version array', () => {
    expect(() => parseMethodHistory('42')).toThrow();
  });
});

describe('parseRemoveMethodHistoryResult', () => {
  it('reports whether anything was forgotten', () => {
    expect(parseRemoveMethodHistoryResult('{"removed":true,"remaining":0}').removed).toBe(true);
    expect(parseRemoveMethodHistoryResult('{"removed":false,"remaining":0}').removed).toBe(false);
  });

  it('surfaces an error envelope', () => {
    const r = parseRemoveMethodHistoryResult('{"removed":false,"error":"not a class: Nope"}');
    expect(r.error).toBe('not a class: Nope');
  });
});

describe('currentVersion', () => {
  it('finds the version flagged current', () => {
    const versions: MethodVersion[] = [
      {
        index: 2,
        timeStamp: '',
        userId: '',
        category: '',
        isCurrent: true,
        source: 'now',
        notInHistory: false,
      },
      {
        index: 1,
        timeStamp: '',
        userId: '',
        category: '',
        isCurrent: false,
        source: 'then',
        notInHistory: false,
      },
    ];

    expect(currentVersion(versions)?.source).toBe('now');
  });

  it('is undefined when nothing is current (e.g. the method was removed)', () => {
    expect(currentVersion([])).toBeUndefined();
  });
});
