import { describe, it, expect, vi } from 'vitest';
import {
  isRuntimeSettable,
  isEditable,
  sessionIsSystemUser,
  parseConfigReport,
  buildStoneReportCode,
  buildGemReportCode,
  buildSetConfigCode,
  configValueLiteral,
  ConfigValueError,
  stoneConfiguration,
  gemConfiguration,
  setConfiguration,
  configValuesMatch,
} from '../configurationReport';

describe('isRuntimeSettable', () => {
  it('is true for a CamelCase runtime key', () => {
    expect(isRuntimeSettable('StnMaxSessions')).toBe(true);
    expect(isRuntimeSettable('GemTempObjCacheSize')).toBe(true);
  });

  it('is false for an ALL_CAPS config-file key', () => {
    expect(isRuntimeSettable('SHR_PAGE_CACHE_SIZE_KB')).toBe(false);
    expect(isRuntimeSettable('KEYFILE')).toBe(false);
  });
});

describe('isEditable', () => {
  const base = { key: 'K', value: 'v', settable: true } as const;
  it('offers an editor for a settable scalar', () => {
    expect(isEditable({ ...base, type: 'boolean' })).toBe(true);
    expect(isEditable({ ...base, type: 'integer' })).toBe(true);
    expect(isEditable({ ...base, type: 'string' })).toBe(true);
  });
  it('does not offer an editor for a read-only value', () => {
    expect(isEditable({ ...base, settable: false, type: 'integer' })).toBe(false);
  });
  it('does not offer an editor for a value it cannot rebuild', () => {
    expect(isEditable({ ...base, type: 'other' })).toBe(false);
  });
});

describe('parseConfigReport', () => {
  it('reads key, type and value from tab-delimited lines, alphabetized', () => {
    const raw =
      'StnMaxSessions\tSmallInteger\t10\n' +
      'SHR_PAGE_CACHE_LOCKED\tBoolean\tfalse\n' +
      'DBF_EXTENT_NAMES\tString\t$GEMSTONE/data/extent0.dbf\n';
    const entries = parseConfigReport(raw);
    expect(entries).toEqual([
      {
        key: 'DBF_EXTENT_NAMES',
        value: '$GEMSTONE/data/extent0.dbf',
        type: 'string',
        settable: false,
      },
      { key: 'SHR_PAGE_CACHE_LOCKED', value: 'false', type: 'boolean', settable: false },
      { key: 'StnMaxSessions', value: '10', type: 'integer', settable: true },
    ]);
  });

  it('alphabetizes case-insensitively, interleaving ALL_CAPS and CamelCase', () => {
    // ASCII order would group every ALL_CAPS key ahead of every CamelCase one;
    // case-folded order interleaves them the way a person reads a name list.
    const raw =
      'StnMaxSessions\tSmallInteger\t10\n' +
      'DUMP_OPTIONS\tBoolean\ttrue\n' +
      'StnCheckpointInterval\tSmallInteger\t300\n' +
      'SHR_PAGE_CACHE_SIZE_KB\tSmallInteger\t75000\n';
    expect(parseConfigReport(raw).map((e) => e.key)).toEqual([
      'DUMP_OPTIONS',
      'SHR_PAGE_CACHE_SIZE_KB',
      'StnCheckpointInterval',
      'StnMaxSessions',
    ]);
  });

  it('classifies unknown value classes as other', () => {
    const [entry] = parseConfigReport('StnConfigFileNames\tArray\tanArray( ...)\n');
    expect(entry.type).toBe('other');
  });

  it('keeps a value that itself contains no tab even with spaces', () => {
    const [entry] = parseConfigReport('GEM_CACHE_WARMER_ARGS\tString\t-n 5 -w 0\n');
    expect(entry.value).toBe('-n 5 -w 0');
  });

  it('skips a malformed line rather than guessing', () => {
    const entries = parseConfigReport('no-tabs-here\nStnMaxSessions\tSmallInteger\t10\n');
    expect(entries).toEqual([
      { key: 'StnMaxSessions', value: '10', type: 'integer', settable: true },
    ]);
  });

  it('keeps a value whole even if a tab slipped through the server-side flatten', () => {
    // Everything after the second tab is the value: it is sliced, not split, so a
    // stray tab is preserved rather than truncating the value. This is the whole
    // reason the parser slices instead of splitting on tab.
    const [entry] = parseConfigReport('K\tString\ta\tb\tc\n');
    expect(entry.value).toBe('a\tb\tc');
  });

  it('reads an empty value, still classifying by its class', () => {
    // Blank path/name parameters are real; the value slice must yield ''.
    const [entry] = parseConfigReport('DBF_PRE_GROW\tString\t\n');
    expect(entry).toEqual({ key: 'DBF_PRE_GROW', value: '', type: 'string', settable: false });
  });

  it('skips a line with only one tab, and a line with an empty key', () => {
    // Two distinct guards: a line missing its second tab (no value field), and a
    // line whose key is empty. Both are dropped rather than guessed at.
    expect(parseConfigReport('K\tString')).toEqual([]);
    expect(parseConfigReport('\tString\tv')).toEqual([]);
  });

  it('classifies every known integer and string class, and unknowns as other', () => {
    // The class-name sets are a contract: dropping a member would silently
    // reclassify a real report value (and, for integers/strings, stop offering
    // its editor). Pin every member.
    const typeOf = (cls: string) => parseConfigReport(`K\t${cls}\tv\n`)[0].type;
    for (const cls of [
      'SmallInteger',
      'LargePositiveInteger',
      'LargeNegativeInteger',
      'LargeInteger',
    ])
      expect(typeOf(cls)).toBe('integer');
    for (const cls of [
      'String',
      'Symbol',
      'DoubleByteString',
      'QuadByteString',
      'Unicode7',
      'Unicode16',
      'Unicode32',
    ])
      expect(typeOf(cls)).toBe('string');
    expect(typeOf('Boolean')).toBe('boolean');
    expect(typeOf('Float')).toBe('other');
  });

  it('raises the error the report came back with', () => {
    expect(() => parseConfigReport('GS-ERROR: something broke')).toThrow('something broke');
  });
});

describe('report code', () => {
  it('asks the stone and the gem for their reports', () => {
    expect(buildStoneReportCode()).toContain('System stoneConfigurationReport');
    expect(buildGemReportCode()).toContain('System gemConfigurationReport');
  });

  it('flattens tabs and newlines out of a value so a line stays a line', () => {
    const code = buildStoneReportCode();
    expect(code).toContain('Character tab');
    expect(code).toContain('Character lf');
    expect(code).toContain('Character cr');
  });
});

describe('configValueLiteral', () => {
  it('renders a boolean', () => {
    expect(configValueLiteral('boolean', 'true')).toBe('true');
    expect(configValueLiteral('boolean', 'FALSE')).toBe('false');
  });
  it('renders an integer', () => {
    expect(configValueLiteral('integer', '60')).toBe('60');
    expect(configValueLiteral('integer', '-1')).toBe('-1');
  });
  it('quotes and escapes a string', () => {
    expect(configValueLiteral('string', "it's")).toBe("'it''s'");
  });
  it('rejects a non-integer', () => {
    expect(() => configValueLiteral('integer', '3.5')).toThrow(ConfigValueError);
  });
  it('rejects a non-boolean', () => {
    expect(() => configValueLiteral('boolean', 'yes')).toThrow(ConfigValueError);
  });
  it('rejects an uneditable type', () => {
    expect(() => configValueLiteral('other', 'x')).toThrow(ConfigValueError);
  });
  it('trims surrounding whitespace off a boolean or integer the user typed', () => {
    expect(configValueLiteral('integer', ' 5 ')).toBe('5');
    expect(configValueLiteral('boolean', ' TRUE ')).toBe('true');
  });
  it('rejects a leading + and an empty integer', () => {
    expect(() => configValueLiteral('integer', '+5')).toThrow(ConfigValueError);
    expect(() => configValueLiteral('integer', '')).toThrow(ConfigValueError);
  });
});

describe('buildSetConfigCode', () => {
  it('uses the stone setter for a stone key', () => {
    const code = buildSetConfigCode('stone', 'StnGemTimeout', 'integer', '0');
    expect(code).toContain('System stoneConfigurationAt: #StnGemTimeout put: 0');
    expect(code).toContain('on: Error do:');
  });
  it('uses the gem setter for a gem key', () => {
    const code = buildSetConfigCode('gem', 'GemFreePageIdsCache', 'integer', '200');
    expect(code).toContain('System gemConfigurationAt: #GemFreePageIdsCache put: 200');
  });
  it('accepts a legitimate ALL_CAPS underscored key', () => {
    // The accept side of the shape guard: an underscored config-file name is a
    // valid key, so building set code for it must not throw.
    expect(() =>
      buildSetConfigCode('stone', 'SHR_PAGE_CACHE_SIZE_KB', 'integer', '1'),
    ).not.toThrow();
  });
  it('refuses a key that does not start with a letter', () => {
    expect(() => buildSetConfigCode('gem', '9Bad', 'integer', '1')).toThrow(ConfigValueError);
  });
});

describe('configValuesMatch', () => {
  it('folds case and trims for boolean and integer', () => {
    expect(configValuesMatch('boolean', 'True', 'true')).toBe(true);
    expect(configValuesMatch('integer', ' 60 ', '60')).toBe(true);
    expect(configValuesMatch('integer', '60', '61')).toBe(false);
  });
  it('compares a string verbatim, without trimming', () => {
    // A string's surrounding whitespace is significant (a path, an argument
    // list), so it must NOT be folded away the way a number is.
    expect(configValuesMatch('string', 'x', 'x')).toBe(true);
    expect(configValuesMatch('string', ' x ', 'x')).toBe(false);
    expect(configValuesMatch('other', 'A', 'a')).toBe(false);
  });
});

describe('stoneConfiguration / gemConfiguration', () => {
  it('runs the report code and parses the result', () => {
    const execute = vi.fn(() => 'StnMaxSessions\tSmallInteger\t10\n');
    expect(stoneConfiguration(execute)).toHaveLength(1);
    expect(execute).toHaveBeenCalledWith(buildStoneReportCode());

    execute.mockReturnValue('GemFreePageIdsCache\tSmallInteger\t200\n');
    expect(gemConfiguration(execute)).toEqual([
      { key: 'GemFreePageIdsCache', value: '200', type: 'integer', settable: true },
    ]);
  });
});

describe('sessionIsSystemUser', () => {
  it('is true only when the profile check answers true', () => {
    expect(sessionIsSystemUser(() => 'true')).toBe(true);
    expect(sessionIsSystemUser(() => 'false')).toBe(false);
    expect(sessionIsSystemUser(() => ' true \n')).toBe(true);
  });

  it('asks whether the session profile is SystemUser', () => {
    const execute = vi.fn((_code: string) => 'false');
    sessionIsSystemUser(execute);
    expect(execute.mock.calls[0][0]).toContain("userWithId: 'SystemUser'");
  });
});

describe('setConfiguration', () => {
  it('reports success when the stone answers OK', () => {
    const execute = vi.fn(() => 'OK');
    expect(setConfiguration(execute, 'gem', 'GemFreePageIdsCache', 'integer', '200')).toEqual({
      ok: true,
    });
  });

  it("relays the stone's own words when it refuses", () => {
    const execute = vi.fn(
      () => 'GS-ERROR: a SecurityError occurred (error 2213), ... only be performed by SystemUser.',
    );
    const result = setConfiguration(execute, 'stone', 'StnGemTimeout', 'integer', '0');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('SystemUser');
    expect(result.message?.startsWith('GS-ERROR:')).toBe(false);
  });

  it('does not reach the gem with an invalid value', () => {
    const execute = vi.fn(() => 'OK');
    expect(() => setConfiguration(execute, 'gem', 'GemFreePageIdsCache', 'integer', 'NaN')).toThrow(
      ConfigValueError,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('relays a bare (non-sentinel) failure message verbatim', () => {
    const result = setConfiguration(() => 'weird', 'gem', 'GemFreePageIdsCache', 'integer', '1');
    expect(result).toEqual({ ok: false, message: 'weird' });
  });

  it('falls back to a default message when the stone answers nothing', () => {
    const result = setConfiguration(() => '', 'gem', 'GemFreePageIdsCache', 'integer', '1');
    expect(result).toEqual({ ok: false, message: 'The configuration value could not be set.' });
  });
});
