import { describe, it, expect, vi } from 'vitest';
import {
  isRuntimeSettable,
  isEditable,
  parseConfigReport,
  buildStoneReportCode,
  buildGemReportCode,
  buildSetConfigCode,
  configValueLiteral,
  ConfigValueError,
  stoneConfiguration,
  gemConfiguration,
  setConfiguration,
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
  it('reads key, type and value from tab-delimited lines', () => {
    const raw =
      'StnMaxSessions\tSmallInteger\t10\n' +
      'SHR_PAGE_CACHE_LOCKED\tBoolean\tfalse\n' +
      'DBF_EXTENT_NAMES\tString\t$GEMSTONE/data/extent0.dbf\n';
    const entries = parseConfigReport(raw);
    expect(entries).toEqual([
      { key: 'StnMaxSessions', value: '10', type: 'integer', settable: true },
      { key: 'SHR_PAGE_CACHE_LOCKED', value: 'false', type: 'boolean', settable: false },
      {
        key: 'DBF_EXTENT_NAMES',
        value: '$GEMSTONE/data/extent0.dbf',
        type: 'string',
        settable: false,
      },
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
  it('refuses a key that is not a configuration name', () => {
    expect(() => buildSetConfigCode('gem', 'Gem foo. System', 'integer', '1')).toThrow(
      ConfigValueError,
    );
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
});
