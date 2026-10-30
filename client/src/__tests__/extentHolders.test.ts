import { describe, it, expect } from 'vitest';

import {
  parseHolderPids,
  parseProcHolders,
  procHoldersScript,
  parseHolderDetails,
  describeHolder,
  sessionHolders,
  explainExtentLocked,
  isExtentLocked,
} from '../extentHolders';

// Captured verbatim from a running 3.7.6 database on Linux, so the parsers are
// pinned to what these tools actually emit rather than to a tidied-up guess.
// Note `ps -o pid=` does not pad — earlier drafts of these regexes assumed
// otherwise.
const REAL_LSOF_T = '4095725\n4095756\n4095757\n';
const REAL_PS = [
  '4095725 ewinger  Tue Sep  1 14:35:27 2026 /jasperStones/GemStone64Bit3.7.6-x86_64.Linux/sys/stoned gs64stone_rowan -e /jasperStones/db-3/conf/gs64stone_rowan.conf -z /jasperStones/db-3/conf/system.conf -l /jasperStones/db-3/log/gs64stone_rowan.log',
  '4095756 ewinger  Tue Sep  1 14:35:27 2026 /jasperStones/GemStone64Bit3.7.6-x86_64.Linux/sys/gem reclaimgcgem gs64stone_rowan 1 -T 5000',
  '4095757 ewinger  Tue Sep  1 14:35:27 2026 /jasperStones/GemStone64Bit3.7.6-x86_64.Linux/sys/gem symbolgem gs64stone_rowan -T 20480',
].join('\n');

describe('against real tool output', () => {
  it('reads the PIDs lsof actually prints', () => {
    expect(parseHolderPids(REAL_LSOF_T)).toEqual([4095725, 4095756, 4095757]);
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

  it('lists a process holding the file twice only once', () => {
    // lsof prints one line per open descriptor; the reader wants one per process.
    expect(parseHolderPids('589418\n589418\n600854\n')).toEqual([589418, 600854]);
  });

  it('finds nothing in empty output', () => {
    expect(parseHolderPids('')).toEqual([]);
    expect(parseHolderPids('\n\n')).toEqual([]);
  });
});

describe('parseProcHolders', () => {
  // Captured from procHoldersScript on a Linux host where one disk is mounted
  // twice (`/uffda1` and a bind mount of it at `/export/uffda1`, mount ids 131
  // and 1224). Jasper asked about the extent by its `/export/uffda1` path; the
  // holder had opened it as `/uffda1/...`. Trimmed to the lines that matter.
  const BIND_MOUNTED = [
    'E 64772 41028871',
    'M 131 253:4',
    'M 1224 253:4',
    'M 30 253:1',
    'F 1313359 m131 41028871',
  ].join('\n');

  it('finds a holder that opened the extent through another mount of the same disk', () => {
    // A comparison of path text misses this one, and missing a holder lets a
    // stop go ahead on top of live gems. Device and inode do not depend on
    // which path the file was opened by.
    expect(parseProcHolders(BIND_MOUNTED)).toEqual([1313359]);
  });

  it('ignores another file of the same name', () => {
    // Every database's first extent is called extent0.dbf.
    const other = `${BIND_MOUNTED}\nF 50453 m30 447881\nF 721240 m131 99`;

    expect(parseProcHolders(other)).toEqual([1313359]);
  });

  it('matches on device and inode reported by stat, on a kernel without fdinfo inodes', () => {
    // Before Linux 5.14, fdinfo has no `ino:` line, and the script falls back
    // to `stat` for the few descriptors whose name matched.
    expect(parseProcHolders('E 64772 41028871\nF 4242 64772 41028871\nF 4343 64772 7')).toEqual([
      4242,
    ]);
  });

  it('lists a process holding several extents, or one extent twice, only once', () => {
    const output = [
      'E 64772 1',
      'E 64772 2',
      'M 131 253:4',
      'F 900 m131 1',
      'F 900 m131 2',
      'F 900 m131 2',
      'F 901 m131 2',
    ].join('\n');

    expect(parseProcHolders(output)).toEqual([900, 901]);
  });

  it('skips a descriptor whose process exited mid-scan', () => {
    // Its fdinfo is gone by the time it is read, so the line carries no identity.
    expect(parseProcHolders(`${BIND_MOUNTED}\nF 777 m\nF 778 `)).toEqual([1313359]);
  });

  it('finds nothing when the extents could not be identified', () => {
    // No `E` line means stat failed on every extent; nothing can match.
    expect(parseProcHolders('M 131 253:4\nF 1313359 m131 41028871')).toEqual([]);
  });

  it('decodes a device number with a minor above 255', () => {
    // Network and overlay filesystems get anonymous devices such as 0:300,
    // whose st_dev splits the minor across two bit ranges.
    const dev = (0 << 8) | (300 & 0xff) | ((300 & ~0xff) << 12);
    expect(parseProcHolders(`E ${dev} 5\nM 77 0:300\nF 12 m77 5`)).toEqual([12]);
  });
});

describe('procHoldersScript', () => {
  it('quotes each extent path for the shell', () => {
    const script = procHoldersScript(["/db's/data/extent0.dbf", '/db 2/data/extent1.dbf']);

    expect(script).toContain(`'/db'\\''s/data/extent0.dbf'`);
    expect(script).toContain(`'/db 2/data/extent1.dbf'`);
  });

  it('narrows the scan to descriptors named like one of the extents', () => {
    const script = procHoldersScript(['/db/data/extent0.dbf', '/db/data/extent1.dbf']);

    expect(script).toContain(`-lname '*/extent0.dbf'`);
    expect(script).toContain(`-lname '*/extent1.dbf'`);
  });

  it('escapes glob characters in an extent name', () => {
    expect(procHoldersScript(['/db/data/extent[1].dbf'])).toContain(`-lname '*/extent\\[1\\].dbf'`);
  });

  it('runs neither fuser nor lsof, which hang on an unresponsive mount', () => {
    expect(procHoldersScript(['/db/data/extent0.dbf'])).not.toMatch(/\b(fuser|lsof)\b/);
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
