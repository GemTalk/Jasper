import { describe, it, expect, vi } from 'vitest';
import { globalNameInUse, globalNameInUseInDictionary } from '../queries/globalNameInUse';

describe('globalNameInUse query', () => {
  it('reports true when the stone says the name is bound', async () => {
    const execute = vi.fn().mockReturnValue('true\n');

    expect(await globalNameInUse(execute, 'Account')).toBe(true);
  });

  it('reports false when the name is free', async () => {
    const execute = vi.fn().mockReturnValue('false');

    expect(await globalNameInUse(execute, 'Nope')).toBe(false);
  });

  it('checks the whole symbol list for the name', async () => {
    const execute = vi.fn().mockReturnValue('false');

    await globalNameInUse(execute, 'Account');

    const code = execute.mock.calls[0][0];
    expect(code).toContain('symbolList objectNamed:');
    expect(code).toContain("#'Account'");
  });
});

/**
 * Which collision blocks a rename (#396).
 *
 * Two bindings of a name in the SAME dictionary is the case the image cannot represent and the
 * apply would fail on. A binding in a DIFFERENT dictionary is a shadow -- legal, handled
 * throughout this engine, and quite possibly what the user means -- so it must not block; it is
 * warned about instead.
 */
describe('globalNameInUseInDictionary query', () => {
  it('scopes the question to one dictionary by its SymbolList index', async () => {
    const execute = vi.fn().mockReturnValue('false');

    expect(await globalNameInUseInDictionary(execute, 'Shadowed', 7)).toBe(false);
    expect(execute.mock.calls[0][0]).toContain('symbolList at: 7');
    expect(execute.mock.calls[0][0]).toContain("at: #'Shadowed'");
  });

  it('scopes by dictionary name when that is what the caller has', async () => {
    const execute = vi.fn().mockReturnValue('true');

    expect(await globalNameInUseInDictionary(execute, 'Shadowed', 'DictionaryA')).toBe(true);
    expect(execute.mock.calls[0][0]).toContain("objectNamed: #'DictionaryA'");
  });

  it('answers false without asking when there is no dictionary to scope to', async () => {
    // Nothing to measure a collision against, so the caller decides rather than this inventing an
    // answer -- and crucially it does not fall back to "anywhere", which is the old behaviour.
    const execute = vi.fn().mockReturnValue('true');

    expect(await globalNameInUseInDictionary(execute, 'Shadowed', undefined)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
