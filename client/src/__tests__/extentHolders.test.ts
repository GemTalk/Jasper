import { describe, it, expect } from 'vitest';

import {
  parseHolderPids,
  parseHolderDetails,
  describeHolder,
  sessionHolders,
  explainExtentLocked,
  isExtentLocked,
} from '../extentHolders';

// Captured verbatim from a running 3.7.6 database on Linux, so the parsers are
// pinned to what these tools actually emit rather than to a tidied-up guess.
// Note `fuser` leads with a space and ends without a newline, and `ps -o pid=`
// does not pad — earlier drafts of these regexes assumed otherwise.
const REAL_LSOF_T = '4095725\n4095756\n4095757\n';
const REAL_FUSER = ' 4095725 4095756 4095757';
const REAL_PS = [
  '4095725 ewinger  Tue Sep  1 14:35:27 2026 /jasperStones/GemStone64Bit3.7.6-x86_64.Linux/sys/stoned gs64stone_rowan -e /jasperStones/db-3/conf/gs64stone_rowan.conf -z /jasperStones/db-3/conf/system.conf -l /jasperStones/db-3/log/gs64stone_rowan.log',
  '4095756 ewinger  Tue Sep  1 14:35:27 2026 /jasperStones/GemStone64Bit3.7.6-x86_64.Linux/sys/gem reclaimgcgem gs64stone_rowan 1 -T 5000',
  '4095757 ewinger  Tue Sep  1 14:35:27 2026 /jasperStones/GemStone64Bit3.7.6-x86_64.Linux/sys/gem symbolgem gs64stone_rowan -T 20480',
].join('\n');

describe('against real tool output', () => {
  it('reads the PIDs lsof and fuser actually print', () => {
    expect(parseHolderPids(REAL_LSOF_T)).toEqual([4095725, 4095756, 4095757]);
    expect(parseHolderPids(REAL_FUSER)).toEqual([4095725, 4095756, 4095757]);
  });

  it('splits the ps rows a running database actually produces', () => {
    const holders = parseHolderDetails(REAL_PS);

    expect(holders.map((h) => h.pid)).toEqual([4095725, 4095756, 4095757]);
    expect(holders[0].user).toBe('ewinger');
    expect(holders[0].startedAt).toBe('Tue Sep 1 14:35:27 2026');
    expect(holders[0].command).toContain('sys/stoned gs64stone_rowan');
  });

  it('treats a healthy running database as having nothing attached', () => {
    // The stone and its housekeeping gems hold the extents by definition. If
    // these counted, every stop of a working database would ask the user about
    // processes Jasper started itself.
    expect(sessionHolders(parseHolderDetails(REAL_PS), 'gs64stone_rowan')).toEqual([]);
  });

  it('keeps a session gem, which names no stone', () => {
    // What a NetLDI starts for a client, and what outlives a force-stopped stone.
    const withSession = parseHolderDetails(
      `${REAL_PS}\n589418 ewinger  Tue Sep  1 17:26:25 2026 /jasperStones/GemStone64Bit3.7.5-x86_64.Linux/sys/gem TCP 5`,
    );

    expect(sessionHolders(withSession, 'gs64stone_rowan').map((h) => h.pid)).toEqual([589418]);
  });
});

describe('parseHolderPids', () => {
  it('reads the one-per-line PIDs lsof -t prints', () => {
    expect(parseHolderPids('589418\n600854\n')).toEqual([589418, 600854]);
  });

  it('reads the space-separated PIDs fuser prints', () => {
    expect(parseHolderPids(' 589418  600854\n')).toEqual([589418, 600854]);
  });

  it('lists a process holding the file twice only once', () => {
    // lsof prints one line per open descriptor; the reader wants one per process.
    expect(parseHolderPids('589418\n589418\n600854\n')).toEqual([589418, 600854]);
  });

  it('finds nothing in empty output', () => {
    expect(parseHolderPids('')).toEqual([]);
    expect(parseHolderPids('\n\n')).toEqual([]);
  });
});

describe('parseHolderDetails', () => {
  // Real output for the gems that held a force-stopped stone's extent open.
  const PS_OUTPUT = [
    ' 589418 ewinger  Tue Sep  1 17:26:25 2026 /jasperStones/GemStone64Bit3.7.5-x86_64.Linux/sys/gem TCP 5',
    ' 600854 ewinger  Tue Sep  1 17:30:01 2026 /jasperStones/GemStone64Bit3.7.5-x86_64.Linux/sys/gem TCP 5',
  ].join('\n');

  it('splits a ps line into pid, user, start time and command', () => {
    const holders = parseHolderDetails(PS_OUTPUT);

    expect(holders).toHaveLength(2);
    expect(holders[0]).toEqual({
      pid: 589418,
      user: 'ewinger',
      startedAt: 'Tue Sep 1 17:26:25 2026',
      command: '/jasperStones/GemStone64Bit3.7.5-x86_64.Linux/sys/gem TCP 5',
    });
  });

  it('keeps a command containing spaces whole', () => {
    const holders = parseHolderDetails(
      '111 ewinger Tue Sep  1 09:00:00 2026 /gs/sys/topaz -l -e /some/path/my file.tpz',
    );

    expect(holders[0].command).toBe('/gs/sys/topaz -l -e /some/path/my file.tpz');
  });

  it('skips lines that are not process rows', () => {
    expect(parseHolderDetails('\nerror: process ID list syntax error\n')).toEqual([]);
  });
});

describe('describeHolder', () => {
  it('names the process and shows its command on its own line', () => {
    const text = describeHolder({
      pid: 589418,
      user: 'ewinger',
      startedAt: 'Tue Sep 1 17:26:25 2026',
      command: '/gs/sys/gem TCP 5',
    });

    expect(text).toContain('PID 589418');
    expect(text).toContain('ewinger');
    expect(text).toContain('Tue Sep 1 17:26:25 2026');
    expect(text).toContain('/gs/sys/gem TCP 5');
  });

  it('still names a PID that ps had nothing to say about', () => {
    expect(describeHolder({ pid: 4242, command: '' })).toBe('PID 4242');
  });
});

describe('isExtentLocked', () => {
  // The stone log's own words when a gem outlives its stone.
  const REAL_FAILURE = `
    GemStone is unable to open the file /db-1/data/extent0.dbf
       reason = exclusive open:  File is open by another process. , file /db-1/data/extent0.dbf,
       failed with EAGAIN Resource temporarily unavailable EWOULDBLOCK

    An error occurred opening the repository for exclusive access.
    Stone startup has failed.`;

  it('recognises the exclusive-open failure', () => {
    expect(isExtentLocked(REAL_FAILURE)).toBe(true);
  });

  it('recognises it when only errno is reported', () => {
    expect(
      isExtentLocked('An error occurred opening the repository for exclusive access. EAGAIN'),
    ).toBe(true);
  });

  it('does not claim an unrelated failure', () => {
    // Shared memory is the other common start failure and needs a different fix
    // entirely; explaining it as a locked extent sends the user to the wrong place.
    expect(isExtentLocked('Unable to allocate shared memory segment')).toBe(false);
  });
});

describe('explainExtentLocked', () => {
  const FAILURE = 'reason = exclusive open:  File is open by another process.';

  it('lets an unrelated failure stand', () => {
    expect(
      explainExtentLocked('gs64stone', 'Unable to allocate shared memory', []),
    ).toBeUndefined();
  });

  it('names every holder it found', () => {
    const text = explainExtentLocked('gs64stone_375', FAILURE, [
      {
        pid: 589418,
        user: 'ewinger',
        startedAt: 'Tue Sep 1 17:26:25 2026',
        command: '/gs/sys/gem',
      },
      {
        pid: 600854,
        user: 'ewinger',
        startedAt: 'Tue Sep 1 17:30:01 2026',
        command: '/gs/sys/gem',
      },
    ])!;

    expect(text).toContain('gs64stone_375');
    expect(text).toContain('589418');
    expect(text).toContain('600854');
  });

  it('says Jasper has not touched them, and does not offer to', () => {
    // The whole point of the message: the user decides what to end. A prompt
    // that offered to kill would be Jasper guessing at what is inside a process
    // it did not start.
    const text = explainExtentLocked('gs64stone', FAILURE, [{ pid: 42, command: '/gs/sys/gem' }])!;

    expect(text).toContain('has not touched');
    expect(text).not.toMatch(/\bkill\b/i);
  });

  it('tells the user how to look when it could not name the holder', () => {
    const text = explainExtentLocked('gs64stone', FAILURE, [])!;

    expect(text).toContain('lsof');
    expect(text).toContain(FAILURE);
  });

  it('keeps GemStone’s own output, so nothing is hidden', () => {
    const text = explainExtentLocked('gs64stone', FAILURE, [{ pid: 42, command: '' }])!;

    expect(text).toContain(FAILURE);
  });
});
