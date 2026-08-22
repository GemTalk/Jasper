import { describe, it, expect } from 'vitest';
import {
  parseConfigDescriptions,
  toConfigFileKey,
  descriptionFor,
} from '../gemstoneConfigDescriptions';

const SAMPLE = `#========================================================================
# Copyright (C) GemTalk Systems. All Rights Reserved.
# Name - system.conf
# As this file is shipped, all default configuration options are commented out.
#=========================================================================
# CONFIG_WARNINGS_FATAL
#  If TRUE then any warning about invalid or out of range entries
#  in a config file is treated as a fatal error.
# Default: FALSE
#  CONFIG_WARNINGS_FATAL = FALSE;

#=========================================================================
# STN_MAX_SESSIONS: The maximum number of sessions that may be
#  logged in to this Stone at one time.
# Default: 40
#STN_MAX_SESSIONS = 40;

#=========================================================================
# SHR_PAGE_CACHE_SIZE_KB:  Size of the shared page cache, in KB.
# Default: computed
#SHR_PAGE_CACHE_SIZE_KB = 75000;
`;

describe('parseConfigDescriptions', () => {
  const map = parseConfigDescriptions(SAMPLE);

  it('keys a description by its ALL_CAPS parameter name', () => {
    expect(map.has('STN_MAX_SESSIONS')).toBe(true);
    expect(map.get('STN_MAX_SESSIONS')).toContain('maximum number of sessions');
  });

  it('keeps the inline text that follows a `KEY:` header', () => {
    expect(map.get('STN_MAX_SESSIONS')?.startsWith('The maximum number of sessions')).toBe(true);
  });

  it('drops the setting line but keeps the Default line', () => {
    const desc = map.get('CONFIG_WARNINGS_FATAL') ?? '';
    expect(desc).toContain('fatal error');
    expect(desc).toContain('Default: FALSE');
    expect(desc).not.toContain('= FALSE;');
  });

  it('ignores the file banner before the first parameter', () => {
    expect(map.has('Copyright')).toBe(false);
    expect(map.has('Name')).toBe(false);
  });

  it('parses each of the sample parameters', () => {
    expect([...map.keys()].sort()).toEqual([
      'CONFIG_WARNINGS_FATAL',
      'SHR_PAGE_CACHE_SIZE_KB',
      'STN_MAX_SESSIONS',
    ]);
  });
});

describe('toConfigFileKey', () => {
  it('leaves an ALL_CAPS key alone', () => {
    expect(toConfigFileKey('SHR_PAGE_CACHE_SIZE_KB')).toBe('SHR_PAGE_CACHE_SIZE_KB');
  });
  it('converts a CamelCase runtime key to UPPER_SNAKE', () => {
    expect(toConfigFileKey('StnMaxSessions')).toBe('STN_MAX_SESSIONS');
    expect(toConfigFileKey('StnCheckpointInterval')).toBe('STN_CHECKPOINT_INTERVAL');
  });
  it('splits a run of capitals before a following word', () => {
    expect(toConfigFileKey('ShrPcTargetPercentDirty')).toBe('SHR_PC_TARGET_PERCENT_DIRTY');
  });
});

describe('descriptionFor', () => {
  const map = parseConfigDescriptions(SAMPLE);

  it('finds an ALL_CAPS key directly', () => {
    expect(descriptionFor(map, 'SHR_PAGE_CACHE_SIZE_KB')).toContain('shared page cache');
  });

  it('finds a CamelCase key via its config-file spelling', () => {
    expect(descriptionFor(map, 'StnMaxSessions')).toContain('maximum number of sessions');
  });

  it('is undefined when the file named neither spelling', () => {
    expect(descriptionFor(map, 'StnGemTimeout')).toBeUndefined();
  });
});
