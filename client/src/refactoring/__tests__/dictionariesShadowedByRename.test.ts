import { describe, it, expect } from 'vitest';
import { dictionariesShadowedByRename } from '../queries/dictionariesShadowedByRename';

/**
 * Which dictionaries a rename would shadow, with the renamed class's own one already removed —
 * in the stone, by identity.
 *
 * Removing it on the client meant removing every dictionary of that NAME, so a second dictionary
 * called the same thing, holding a real clashing class, disappeared along with the destination
 * and the rename went ahead with no warning at all (#396).
 */
describe('dictionariesShadowedByRename', () => {
  it('reads each holder’s symbol-list position and name', () => {
    const rows = dictionariesShadowedByRename(
      () => '1\tDictionaryA\n4\tZzTwin\n',
      'Account',
      'Ledger',
    );

    expect(rows).toEqual([
      { position: 1, name: 'DictionaryA' },
      { position: 4, name: 'ZzTwin' },
    ]);
  });

  it('keeps a twin of the destination’s own name, which the client used to drop', () => {
    const rows = dictionariesShadowedByRename(() => '2\tZzTwin\n', 'Account', 'Ledger', 5);

    expect(rows).toEqual([{ position: 2, name: 'ZzTwin' }]);
  });

  it('names a holder that has no name at all, rather than passing over it', () => {
    const rows = dictionariesShadowedByRename(() => '6\t(unnamed)\n', 'Account', 'Ledger');

    expect(rows).toEqual([{ position: 6, name: '(unnamed)' }]);
  });

  it('answers nothing when no other dictionary holds the name', () => {
    expect(dictionariesShadowedByRename(() => '', 'Account', 'Ledger')).toEqual([]);
  });

  it('excludes the renamed class’s own dictionary by identity, in the stone', () => {
    let code = '';
    dictionariesShadowedByRename(
      (c) => {
        code = c;
        return '';
      },
      'Account',
      'Ledger',
      3,
    );

    // The class is resolved, its dictionary's POSITION found by identity, and that slot skipped.
    expect(code).toContain('i ~= home');
    expect(code).toContain('isBehavior');
    // and the name being searched for is the NEW one
    expect(code).toContain("at: #'Account'");
  });
});
