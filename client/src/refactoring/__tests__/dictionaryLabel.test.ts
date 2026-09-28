import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

vi.mock('../../browserQueries', () => ({
  getDictionaryNames: vi.fn(),
}));

import * as queries from '../../browserQueries';
import { dictionaryNameFor, qualifiedClassName } from '../dictionaryLabel';
import type { ActiveSession } from '../../sessionManager';

const session = {} as ActiveSession;

// A class name does not identify a class -- the same name can be bound in several dictionaries,
// and a refactoring acts on exactly one. These name the dictionary in the text the user reads
// afterwards, which is the last place a refactoring that went somewhere unintended is catchable
// (#396).
describe('dictionaryNameFor', () => {
  it('resolves a 1-based SymbolList index to its dictionary name', () => {
    vi.mocked(queries.getDictionaryNames).mockReturnValue([
      'UserGlobals',
      'Globals',
      'DictionaryB',
    ]);

    expect(dictionaryNameFor(session, 3)).toBe('DictionaryB');
  });

  it('passes a name straight through without a round trip', () => {
    vi.mocked(queries.getDictionaryNames).mockClear();

    expect(dictionaryNameFor(session, 'DictionaryB')).toBe('DictionaryB');
    expect(queries.getDictionaryNames).not.toHaveBeenCalled();
  });

  it('answers undefined for no reference at all', () => {
    expect(dictionaryNameFor(session, undefined)).toBeUndefined();
  });

  it('answers undefined for an index past the end of the symbol list', () => {
    vi.mocked(queries.getDictionaryNames).mockReturnValue(['UserGlobals']);

    expect(dictionaryNameFor(session, 9)).toBeUndefined();
  });

  it('answers undefined rather than throwing when the query fails', () => {
    vi.mocked(queries.getDictionaryNames).mockImplementation(() => {
      throw new Error('session gone');
    });

    expect(dictionaryNameFor(session, 2)).toBeUndefined();
  });
});

describe('qualifiedClassName', () => {
  it('names the dictionary alongside the class', () => {
    expect(qualifiedClassName('Shadowed', 'DictionaryB')).toBe('Shadowed (DictionaryB)');
  });

  it('leaves the class name alone when the dictionary is unknown', () => {
    // Less specific beats wrong: a label naming the wrong dictionary is worse than none.
    expect(qualifiedClassName('Shadowed', undefined)).toBe('Shadowed');
  });
});
