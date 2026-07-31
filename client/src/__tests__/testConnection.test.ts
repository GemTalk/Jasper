import { describe, it, expect } from 'vitest';
import { resolveTestConnection, requireParsedStoneNrs } from './testConnection';

function makeEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    VITE_GEMSTONE_GCI_LIBRARY_PATH: '/opt/gemstone/lib/libgcits-3.7.2-64.so',
    VITE_GEMSTONE_STONE_NRS: '!tcp@db.example.com#server!jasper-test',
    VITE_GEMSTONE_GEM_NRS: '!tcp@db.example.com#netldi:jasper-test-ldi#task!gemnetobject',
    VITE_GEMSTONE_USER: 'DataCurator',
    VITE_GEMSTONE_PASSWORD: 'swordfish',
    ...overrides,
  };
}

describe('resolveTestConnection', () => {
  it('tolerates a Stone NRS shape it does not itself parse', () => {
    const env = makeEnv({ VITE_GEMSTONE_STONE_NRS: 'gs64stone' });

    const connection = resolveTestConnection(env);

    expect(connection.stoneNrs).toBe('gs64stone');
  });

  it('prefers a NetLDI name carried by a freshly generated Gem NRS over a stale atomic override', () => {
    const env = makeEnv({
      VITE_GEMSTONE_GEM_NRS: '!tcp@db.example.com#netldi:fresh-ldi#task!gemnetobject',
      VITE_GEMSTONE_NETLDI_NAME: 'old-ldi',
    });

    const connection = resolveTestConnection(env);

    expect(connection.netldiName).toBe('fresh-ldi');
  });

  it('falls back to the version embedded in the GCI library filename when unset', () => {
    const env = makeEnv({ VITE_GEMSTONE_VERSION: undefined });

    const connection = resolveTestConnection(env);

    expect(connection.version).toBe('3.7.2');
  });

  it('throws an actionable error when the Stone NRS is missing from every source', () => {
    const env = makeEnv({ VITE_GEMSTONE_STONE_NRS: undefined, GS_STONE_NRS: undefined });

    expect(() => resolveTestConnection(env)).toThrow(/Stone NRS/);
  });
});

describe('requireParsedStoneNrs', () => {
  it('parses gem_host and stone out of a well-formed Stone NRS', () => {
    const parsed = requireParsedStoneNrs('!tcp@db.example.com#server!jasper-test');

    expect(parsed).toEqual({ gem_host: 'db.example.com', stone: 'jasper-test' });
  });

  it('throws with the offending NRS when it is not in the !tcp@host#server!stone shape', () => {
    expect(() => requireParsedStoneNrs('not-a-stone-nrs')).toThrow(/not-a-stone-nrs/);
  });
});
