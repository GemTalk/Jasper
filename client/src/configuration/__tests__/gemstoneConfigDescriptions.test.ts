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

  it('requires a divider between blocks — without one, the second key is lost', () => {
    // The parser's key boundary is the divider line. Two blocks with a divider
    // yield two keys; drop the divider and the second header is absorbed as the
    // first key's description text, so its parameter silently gets no tooltip.
    const divided = '#===\n# STN_A: first.\n#STN_A = 1;\n#===\n# STN_B: second.\n#STN_B = 2;\n';
    expect([...parseConfigDescriptions(divided).keys()].sort()).toEqual(['STN_A', 'STN_B']);

    const undivided = '#===\n# STN_A: first.\n# STN_B: second.\n#STN_A = 1;\n';
    const m = parseConfigDescriptions(undivided);
    expect(m.has('STN_A')).toBe(true);
    expect(m.has('STN_B')).toBe(false);
    expect(m.get('STN_A')).toContain('STN_B');
  });

  it('preserves an interior blank comment line but drops a wholly empty one', () => {
    // A `#` line becomes a blank line inside the tooltip; a truly empty line is
    // skipped. Surrounding blank lines are trimmed.
    const text = '#===\n# STN_D: line one\n#\n# line three\n\n# line five\n#STN_D = 1;\n';
    expect(parseConfigDescriptions(text).get('STN_D')?.split('\n')).toEqual([
      'line one',
      '',
      'line three',
      'line five',
    ]);
  });

  it('returns an empty map — never throws — for empty or key-less input', () => {
    // gemstoneManager.ts relies on this: a missing/odd system.conf means "no
    // tooltips", not a thrown parse.
    expect(parseConfigDescriptions('').size).toBe(0);
    expect(parseConfigDescriptions('# a banner with no divider and no key\n').size).toBe(0);
    expect(parseConfigDescriptions('plain text, no hash at all\n').size).toBe(0);
  });

  it('keeps the first non-empty description for a duplicated key', () => {
    // flush(): the first non-empty block wins; an empty block never sets the key,
    // and a later block never overwrites it.
    const emptyThenFull = '#===\n# STN_G\n#STN_G = 1;\n#===\n# STN_G: real desc.\n#STN_G = 1;\n';
    expect(parseConfigDescriptions(emptyThenFull).get('STN_G')).toBe('real desc.');

    const fullThenFull = '#===\n# STN_H: first.\n#===\n# STN_H: second.\n';
    expect(parseConfigDescriptions(fullThenFull).get('STN_H')).toBe('first.');
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
  it('is lossy for TempObj — a known miss the module header documents', () => {
    // The real config-file key is GEM_TEMPOBJ_CACHE_SIZE, but the transform splits
    // Temp|Obj and yields GEM_TEMP_OBJ_CACHE_SIZE, which resolves to nothing. Pin
    // the actual (lossy) output so any change to the transform is a conscious one.
    expect(toConfigFileKey('GemTempObjCacheSize')).toBe('GEM_TEMP_OBJ_CACHE_SIZE');
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

  it('misses an irregular runtime key whose file name is not a mechanical transform', () => {
    // ShrPcTargetPercentDirty's real config-file key is STN_SHR_TARGET_PERCENT_DIRTY,
    // but toConfigFileKey yields SHR_PC_TARGET_PERCENT_DIRTY — so even when the file
    // describes the parameter, descriptionFor returns undefined. The contract is
    // "no tooltip, never a wrong one"; resolving these would need a curated alias
    // table. Pin the miss so the boundary is explicit, not assumed-covered.
    const m = parseConfigDescriptions(
      '#===\n# STN_SHR_TARGET_PERCENT_DIRTY: page-dirty threshold.\n#STN_SHR_TARGET_PERCENT_DIRTY = 40;\n',
    );
    expect(m.has('STN_SHR_TARGET_PERCENT_DIRTY')).toBe(true);
    expect(descriptionFor(m, 'ShrPcTargetPercentDirty')).toBeUndefined();
  });
});
