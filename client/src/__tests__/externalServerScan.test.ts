import { describe, it, expect } from 'vitest';
import {
  HostServerProcess,
  allExternalServersConfirmed,
  classifyServerIdentity,
  commandIsServer,
  findExternalServers,
  hasExternalServer,
  parseHostServerProcesses,
  parseProductVersion,
  parseServerEnvironment,
  withServerEnvironment,
} from '../externalServerScan';
import { GemStoneProcess } from '../sysadminTypes';

/** Real `ps -eo pid=,command=` lines, kept verbatim: the matching rules exist
 *  to read exactly this, and paraphrasing them would test the paraphrase. */
const PS_OUTPUT = [
  ' 665551 /home/u/gemstone/GemStone64Bit3.6.2-x86_64.Linux/sys/stoned jasper-test-3.6.2-gs64-stone',
  ' 665844 /home/u/gemstone/GemStone64Bit3.6.2-x86_64.Linux/sys/netldid jasper-test-3.6.2-gs64-ldi -g -D/home/u/gemstone/GemStone64Bit3.6.2-x86_64.Linux/global/log',
  ' 1889602 /home/u/jasperStones/GemStone64Bit3.7.5-x86_64.Linux/sys/netldid gs64ldi -g -aewinger -l /home/u/jasperStones/db-1/log/gs64ldi.log',
  ' 1889606 /home/u/jasperStones/GemStone64Bit3.7.5-x86_64.Linux/sys/stoned gs64stone_375 -e /home/u/jasperStones/db-1/conf/gs64stone_375.conf -z /home/u/jasperStones/db-1/conf/system.conf -l /home/u/jasperStones/db-1/log/gs64stone_375.log',
].join('\n');

const DB = {
  path: '/home/u/jasperStones/db-1',
  config: { stoneName: 'gs64stone_375', ldiName: 'gs64ldi', version: '3.7.5' },
};

function hostProc(overrides: Partial<HostServerProcess> = {}): HostServerProcess {
  return {
    pid: 100,
    type: 'stone',
    name: 'gs64stone_375',
    version: '3.7.5',
    dbPathHints: [],
    command: 'stoned gs64stone_375',
    ...overrides,
  };
}

function gslistProc(overrides: Partial<GemStoneProcess> = {}): GemStoneProcess {
  return {
    type: 'stone',
    name: 'gs64stone_375',
    version: '3.7.5',
    pid: 100,
    status: 'OK',
    responding: true,
    ...overrides,
  };
}

describe('parseHostServerProcesses', () => {
  it('finds every stone and netldi in a process listing', () => {
    const found = parseHostServerProcesses(PS_OUTPUT);

    expect(found.map((p) => [p.type, p.name])).toEqual([
      ['stone', 'jasper-test-3.6.2-gs64-stone'],
      ['netldi', 'jasper-test-3.6.2-gs64-ldi'],
      ['netldi', 'gs64ldi'],
      ['stone', 'gs64stone_375'],
    ]);
  });

  it('reads the version out of the product directory the binary came from', () => {
    const found = parseHostServerProcesses(PS_OUTPUT);

    expect(found.map((p) => p.version)).toEqual(['3.6.2', '3.6.2', '3.7.5', '3.7.5']);
  });

  it('keeps the conf and log paths a stone was started with', () => {
    const [stone] = parseHostServerProcesses(PS_OUTPUT).filter((p) => p.name === 'gs64stone_375');

    expect(stone.dbPathHints).toEqual([
      '/home/u/jasperStones/db-1/conf/gs64stone_375.conf',
      '/home/u/jasperStones/db-1/conf/system.conf',
      '/home/u/jasperStones/db-1/log/gs64stone_375.log',
    ]);
  });

  it('records the process id so a server can be reported and signalled', () => {
    const found = parseHostServerProcesses(PS_OUTPUT);

    expect(found.map((p) => p.pid)).toEqual([665551, 665844, 1889602, 1889606]);
  });

  it('ignores the stop scripts and a search for the servers themselves', () => {
    // Both turn up in a real process table while a reconcile is underway, and
    // mistaking either for a live server would have Jasper report — or kill —
    // the wrong thing.
    const noise = [
      ' 5001 /home/u/gs/bin/stopstone gs64stone_375 DataCurator swordfish',
      ' 5002 grep -E stoned|netldid',
      ' 5003 /bin/sh /home/u/gs/bin/startnetldi gs64ldi',
      ' 5004 /home/u/gs/sys/foostoned gs64stone_375',
    ].join('\n');

    expect(parseHostServerProcesses(noise)).toEqual([]);
  });

  it('accepts a server invoked without a path', () => {
    expect(parseHostServerProcesses(' 42 stoned alpha')).toMatchObject([
      { pid: 42, type: 'stone', name: 'alpha' },
    ]);
  });

  it('leaves the version unknown when the path names no product directory', () => {
    const [proc] = parseHostServerProcesses(' 42 /opt/custom/sys/stoned alpha');

    expect(proc.version).toBeUndefined();
  });

  it('reads nothing out of an empty listing', () => {
    expect(parseHostServerProcesses('')).toEqual([]);
  });

  it('ignores a server that has already died and not been reaped', () => {
    // ps renders a zombie as "[stoned] <defunct>". It is not a running server,
    // and reporting it as one would have Jasper offer to stop a corpse.
    expect(parseHostServerProcesses(' 5005 [stoned] <defunct>')).toEqual([]);
  });
});

describe('commandIsServer', () => {
  it('recognises the server it was asked about', () => {
    expect(
      commandIsServer('/gs/sys/stoned gs64stone -e /db/conf/s.conf', 'stone', 'gs64stone'),
    ).toBe(true);
  });

  it('rejects a server of the same kind running under another name', () => {
    // The whole point of the check: killing "a stoned" is not the same as
    // killing "the stoned we meant".
    expect(commandIsServer('/gs/sys/stoned other-stone', 'stone', 'gs64stone')).toBe(false);
  });

  it('rejects the other kind of server sharing the name', () => {
    expect(commandIsServer('/gs/sys/netldid gs64stone', 'stone', 'gs64stone')).toBe(false);
  });

  it('rejects an unrelated process that inherited the process id', () => {
    expect(commandIsServer('/usr/bin/ssh-agent', 'stone', 'gs64stone')).toBe(false);
  });

  it('rejects a process id that no longer exists', () => {
    expect(commandIsServer('GONE', 'stone', 'gs64stone')).toBe(false);
    expect(commandIsServer('', 'stone', 'gs64stone')).toBe(false);
  });

  it('accepts a server invoked without a path', () => {
    expect(commandIsServer('netldid gs64ldi -g', 'netldi', 'gs64ldi')).toBe(true);
  });

  it('does not accept a name that merely starts the same way', () => {
    expect(commandIsServer('/gs/sys/stoned gs64stone_375', 'stone', 'gs64stone')).toBe(false);
  });
});

describe('parseProductVersion', () => {
  it('reads a version off a product directory name', () => {
    expect(parseProductVersion('/x/GemStone64Bit3.7.4.3-arm64.Darwin/sys/stoned')).toBe('3.7.4.3');
  });

  it('finds nothing in a path with no product directory', () => {
    expect(parseProductVersion('/usr/local/sys/stoned')).toBeUndefined();
  });
});

describe('parseServerEnvironment', () => {
  it('picks the GemStone variables out of a process listing with its environment', () => {
    const output =
      '/x/sys/stoned gs64stone_375 -e /db/conf/s.conf ' +
      'LANG=en_US.UTF-8 GEMSTONE_LOG=/db-1/log/s.log GEMSTONE_GLOBAL_DIR=/elsewhere ' +
      'GEMSTONE=/x SHELL=/bin/bash GEMSTONE_SYS_CONF=/db-1/conf';

    expect(parseServerEnvironment(output)).toEqual({
      GEMSTONE_LOG: '/db-1/log/s.log',
      GEMSTONE_GLOBAL_DIR: '/elsewhere',
      GEMSTONE: '/x',
      GEMSTONE_SYS_CONF: '/db-1/conf',
    });
  });

  it('reads nothing when the environment was not available', () => {
    expect(parseServerEnvironment('/x/sys/stoned gs64stone_375')).toEqual({});
  });

  it('truncates a path containing a space rather than inventing one', () => {
    // ps separates the pairs with spaces and quotes nothing, so a path with a
    // space in it cannot be recovered. The truncated value then reads as
    // pointing outside the database, which refuses a stop — the safe direction.
    expect(parseServerEnvironment('GEMSTONE_SYS_CONF=/my dbs/db-1/conf')).toEqual({
      GEMSTONE_SYS_CONF: '/my',
    });
  });
});

describe('classifyServerIdentity', () => {
  it('confirms a server whose config lies inside the database directory', () => {
    const proc = hostProc({ dbPathHints: ['/home/u/jasperStones/db-1/conf/gs64stone_375.conf'] });

    expect(classifyServerIdentity(proc, DB.path)).toBe('confirmed');
  });

  it('reports a same-named server pointed at another database as a different one', () => {
    const proc = hostProc({ dbPathHints: ['/home/u/other/db-9/conf/gs64stone_375.conf'] });

    expect(classifyServerIdentity(proc, DB.path)).toBe('different');
  });

  it('leaves identity unknown when the process gave nothing away', () => {
    expect(classifyServerIdentity(hostProc(), DB.path)).toBe('unknown');
  });

  it('does not mistake a sibling directory for the database directory', () => {
    // "db-10" starts with "db-1", so a plain prefix test would confirm it.
    const proc = hostProc({ dbPathHints: ['/home/u/jasperStones/db-10/conf/gs64stone_375.conf'] });

    expect(classifyServerIdentity(proc, DB.path)).toBe('different');
  });
});

describe('withServerEnvironment', () => {
  it('confirms a server that only its environment identifies', () => {
    // A netldi's command line often carries no paths at all, so reading the
    // environment is the difference between offering a restart and refusing to
    // touch it.
    const server = {
      process: hostProc({ type: 'netldi', name: 'gs64ldi' }),
      identity: 'unknown' as const,
    };

    const enriched = withServerEnvironment(
      server,
      { GEMSTONE_SYS_CONF: '/home/u/jasperStones/db-1/conf', GEMSTONE_GLOBAL_DIR: '/elsewhere' },
      DB.path,
    );

    expect(enriched.identity).toBe('confirmed');
    expect(enriched.process.globalDir).toBe('/elsewhere');
  });

  it('keeps identity unknown when the environment says nothing either', () => {
    const server = { process: hostProc(), identity: 'unknown' as const };

    expect(withServerEnvironment(server, {}, DB.path).identity).toBe('unknown');
  });

  it('takes the version from the environment when the path did not carry one', () => {
    const server = { process: hostProc({ version: undefined }), identity: 'unknown' as const };

    const enriched = withServerEnvironment(
      server,
      { GEMSTONE: '/opt/GemStone64Bit3.7.5-x86_64.Linux' },
      DB.path,
    );

    expect(enriched.process.version).toBe('3.7.5');
  });
});

describe('findExternalServers', () => {
  it('finds nothing when gslist already accounts for both servers', () => {
    const gslist = [gslistProc(), gslistProc({ type: 'netldi', name: 'gs64ldi' })];
    const hosts = parseHostServerProcesses(PS_OUTPUT);

    expect(findExternalServers(DB, gslist, hosts)).toEqual({});
  });

  it('reports a server that is alive on the host but missing from gslist', () => {
    const hosts = parseHostServerProcesses(PS_OUTPUT);

    const finding = findExternalServers(DB, [], hosts);

    expect(finding.stone?.process.pid).toBe(1889606);
    expect(finding.netldi?.process.pid).toBe(1889602);
  });

  it('confirms both servers from the paths they were started with', () => {
    const finding = findExternalServers(DB, [], parseHostServerProcesses(PS_OUTPUT));

    expect(finding.stone?.identity).toBe('confirmed');
    expect(finding.netldi?.identity).toBe('confirmed');
  });

  it('reports only the side gslist cannot see', () => {
    const hosts = parseHostServerProcesses(PS_OUTPUT);

    const finding = findExternalServers(DB, [gslistProc()], hosts);

    expect(finding.stone).toBeUndefined();
    expect(finding.netldi?.process.pid).toBe(1889602);
  });

  it('ignores a same-named server belonging to another installed version', () => {
    const hosts = [hostProc({ version: '3.6.2' })];

    expect(findExternalServers(DB, [], hosts)).toEqual({});
  });

  it('accepts a server whose version could not be read', () => {
    // Refusing it would hide exactly the unusual-install case this detection
    // exists for; the identity check is what guards against acting on it.
    const hosts = [hostProc({ version: undefined })];

    expect(findExternalServers(DB, [], hosts).stone?.process.pid).toBe(100);
  });

  it('does not treat a netldi as the stone of the same name', () => {
    const hosts = [hostProc({ type: 'netldi', name: 'gs64stone_375' })];

    expect(findExternalServers(DB, [], hosts)).toEqual({});
  });
});

describe('acting on a finding', () => {
  const confirmed = {
    process: hostProc({ dbPathHints: [`${DB.path}/conf/s.conf`] }),
    identity: 'confirmed' as const,
  };
  const unknown = { process: hostProc(), identity: 'unknown' as const };

  it('has nothing to act on for an empty finding', () => {
    expect(hasExternalServer({})).toBe(false);
    expect(allExternalServersConfirmed({})).toBe(false);
  });

  it('permits action only when every server found is confirmed', () => {
    expect(allExternalServersConfirmed({ stone: confirmed })).toBe(true);
    expect(allExternalServersConfirmed({ stone: confirmed, netldi: unknown })).toBe(false);
  });
});
