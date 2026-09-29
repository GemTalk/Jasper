import { describe, it, expect } from 'vitest';
import { resolveDictionaryIndex } from '../dictionaryIndex';

// Two dictionaries called `Shared`, with UserGlobals between them.
const NAMES = ['Shared', 'UserGlobals', 'Shared'];

describe('resolveDictionaryIndex', () => {
  it('keeps the recorded position when the dictionary there still has the name', () => {
    expect(resolveDictionaryIndex(NAMES, 'Shared', 3)).toBe(3);
  });

  it('looks the name up when the recorded position now holds another dictionary', () => {
    // A dictionary was inserted ahead: position 2 is no longer the one recorded as UserGlobals.
    expect(resolveDictionaryIndex(['Globals', 'Shared', 'UserGlobals'], 'UserGlobals', 2)).toBe(3);
  });

  it('looks the name up when the recorded position is past the end of the list', () => {
    expect(resolveDictionaryIndex(NAMES, 'UserGlobals', 9)).toBe(2);
  });

  it('answers the first of that name when there is no recorded position', () => {
    expect(resolveDictionaryIndex(NAMES, 'Shared')).toBe(1);
  });

  it('answers 0 for a name no dictionary carries', () => {
    expect(resolveDictionaryIndex(NAMES, 'Gone', 1)).toBe(0);
  });
});
