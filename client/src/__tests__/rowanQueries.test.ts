import { describe, it, expect, vi } from 'vitest';
import { listRowanProjects } from '../queries/rowan/listRowanProjects';
import { getGemCacheKB } from '../queries/rowan/getGemCacheKB';
import { exportRowanProject } from '../queries/rowan/exportRowanProject';
import { findRowanClassOwners } from '../queries/rowan/findRowanClassOwners';
import { listAllRowanClasses } from '../queries/rowan/listAllRowanClasses';
import { buildLoadRowanProjectCode, parseRowanLoadResult } from '../queries/rowan/loadRowanProject';
import { diffRowanProject, formatRowanDiff } from '../queries/rowan/diffRowanProject';
import { unloadRowanProject } from '../queries/rowan/unloadRowanProject';
import type { QueryExecutor } from '../queries/types';

const executor = (result: string) => vi.fn<QueryExecutor>(() => result);

describe('listRowanProjects', () => {
  it('parses project names with their dirty and built-in flags', () => {
    const result = listRowanProjects(executor('Cypress\tfalse\ttrue\nSeaside\ttrue\tfalse\n'));

    expect(result.available).toBe(true);
    expect(result.projects).toEqual([
      { name: 'Cypress', isDirty: false, isBuiltin: true },
      { name: 'Seaside', isDirty: true, isBuiltin: false },
    ]);
  });

  it('reports Rowan unavailable on the sentinel', () => {
    expect(listRowanProjects(executor('!NO_ROWAN')).available).toBe(false);
  });
});

describe('listAllRowanClasses', () => {
  it('parses each class with its project, package, and symbol dictionary', () => {
    const result = listAllRowanClasses(
      executor(
        'STONReader\tSTON\tSTON-Core\tUserGlobals\nAnnouncementSet\tAnnouncements\tAnnouncements-Core-GemStone\tGlobals\n',
      ),
    );

    expect(result).toEqual([
      { name: 'STONReader', project: 'STON', package: 'STON-Core', symbolDict: 'UserGlobals' },
      {
        name: 'AnnouncementSet',
        project: 'Announcements',
        package: 'Announcements-Core-GemStone',
        symbolDict: 'Globals',
      },
    ]);
  });

  it('returns nothing when Rowan is absent', () => {
    expect(listAllRowanClasses(executor(''))).toEqual([]);
  });
});

describe('findRowanClassOwners', () => {
  it('splits owners into defining and extending packages', () => {
    const result = findRowanClassOwners(
      executor('D\tSTON\tSTON-Core\nX\tCypress\tCypress-Comparison\n'),
      'STONReader',
    );

    expect(result.defined).toEqual([{ project: 'STON', package: 'STON-Core' }]);
    expect(result.extended).toEqual([{ project: 'Cypress', package: 'Cypress-Comparison' }]);
  });

  it('returns empty groups when the class belongs to no package', () => {
    expect(findRowanClassOwners(executor(''), 'Nope')).toEqual({ defined: [], extended: [] });
  });

  it('scans by includesKey so classes outside the symbolList are still found', () => {
    const execute = executor('');
    findRowanClassOwners(execute, 'STONReader');
    const code = execute.mock.calls[0][0];
    expect(code).toContain("loadedClasses includesKey: 'STONReader'");
    expect(code).toContain("loadedClassExtensions includesKey: 'STONReader'");
  });
});

describe('parseRowanLoadResult', () => {
  it('reports the loaded project name on OK', () => {
    expect(parseRowanLoadResult('OK\tLoadMe')).toEqual({ success: true, detail: 'LoadMe' });
  });

  it('reports the error message on ERR', () => {
    expect(parseRowanLoadResult('ERR\tbad spec')).toEqual({ success: false, detail: 'bad spec' });
  });
});

describe('buildLoadRowanProjectCode', () => {
  it('loads via projectFromUrl:diskUrl: and commits', () => {
    const code = buildLoadRowanProjectCode('/p/specs/LoadMe.ston', '/p');

    expect(code).toContain("projectFromUrl: 'file:/p/specs/LoadMe.ston' diskUrl: 'file:/p'");
    expect(code).toContain('System commitTransaction');
    expect(code).toContain('System abortTransaction');
  });
});

describe('unloadRowanProject', () => {
  it('reports the unloaded project name on OK', () => {
    expect(unloadRowanProject(executor('OK\tSTON'), 'STON')).toEqual({
      success: true,
      detail: 'STON',
    });
  });

  it('surfaces the dependency error and aborts on ERR', () => {
    const result = unloadRowanProject(
      executor('ERR\tCannot unload projects that are required by other projects'),
      'Cypress',
    );

    expect(result.success).toBe(false);
    expect(result.detail).toContain('required by other projects');
  });

  it('unloads via gemstoneTools topaz and commits', () => {
    const execute = executor('');

    unloadRowanProject(execute, 'STON');

    const code = execute.mock.calls[0][0];
    expect(code).toContain("gemstoneTools topaz unloadProjectNamed: 'STON'");
    expect(code).toContain('System commitTransaction');
    expect(code).toContain('System abortTransaction');
  });
});

describe('diffRowanProject', () => {
  it('maps I/D/M to image/disk/changed and cleans the target', () => {
    const raw =
      'I\tSTON-Core\ta RwCypressMethodDefinition(STONReader>>next)\n' +
      'D\tSTON-Core\ta RwCypressMethodDefinition(STONWriter>>old)\n' +
      'M\tSTON-Core\ta RwCypressClassDefinition(STONReader)\n';

    const diff = diffRowanProject(executor(raw), 'STON');

    expect(diff.ok).toBe(true);
    expect(diff.operations).toEqual([
      { location: 'image', package: 'STON-Core', target: 'STONReader>>next' },
      { location: 'disk', package: 'STON-Core', target: 'STONWriter>>old' },
      { location: 'changed', package: 'STON-Core', target: 'STONReader' },
    ]);
  });

  it('reports Rowan-absent and error sentinels as not ok', () => {
    expect(diffRowanProject(executor('!NO_ROWAN'), 'X').ok).toBe(false);
    expect(diffRowanProject(executor('!ERR could not read disk'), 'X')).toMatchObject({
      ok: false,
      error: 'could not read disk',
    });
  });
});

describe('formatRowanDiff', () => {
  it('reports a clean project', () => {
    const text = formatRowanDiff('STON', { ok: true, error: '', operations: [] });

    expect(text).toContain('No differences');
  });

  it('groups operations by package with labels', () => {
    const text = formatRowanDiff('STON', {
      ok: true,
      error: '',
      operations: [
        { location: 'image', package: 'STON-Core', target: 'STONReader>>next' },
        { location: 'disk', package: 'STON-Core', target: 'STONWriter>>old' },
      ],
    });

    expect(text).toContain('2 difference(s) across 1 package(s)');
    expect(text).toContain('STON-Core');
    expect(text).toContain('only in image');
    expect(text).toContain('STONReader>>next');
    expect(text).toContain('only on disk');
  });

  it('surfaces the error when the diff failed', () => {
    const text = formatRowanDiff('STON', { ok: false, error: 'boom', operations: [] });

    expect(text).toContain('boom');
  });
});

describe('exportRowanProject', () => {
  it('reports success and the target directory on OK', () => {
    const result = exportRowanProject(executor('OK\t/out/Cypress'), 'Cypress', '/out/Cypress');

    expect(result).toEqual({ success: true, detail: '/out/Cypress' });
  });

  it('reports failure with the error message on ERR', () => {
    const result = exportRowanProject(
      executor('ERR\tProject Cypress is not loaded'),
      'Cypress',
      '/out',
    );

    expect(result).toEqual({ success: false, detail: 'Project Cypress is not loaded' });
  });

  it('writes the load spec too (the copy is otherwise not reloadable)', () => {
    const execute = executor('OK\t/out/Cypress');

    exportRowanProject(execute, 'Cypress', '/out/Cypress');

    const code = execute.mock.calls[0][0];
    expect(code).toContain('writeResolvedProject:');
    expect(code).toContain('exportLoadSpecification');
    expect(code).toContain("diskRepositoryRoot: '/out/Cypress'");
  });
});

describe('getGemCacheKB', () => {
  it('parses the gem temp-object cache size into KB', () => {
    expect(getGemCacheKB(executor('512000'))).toBe(512000);
  });

  it('queries GemTempObjCacheSize in KB units', () => {
    const execute = executor('0');
    getGemCacheKB(execute);
    expect(execute.mock.calls[0][0]).toContain('GemTempObjCacheSize');
    expect(execute.mock.calls[0][0]).toContain('// 1024');
  });

  it('returns undefined when the value is not a positive number', () => {
    expect(getGemCacheKB(executor('nil'))).toBeUndefined();
    expect(getGemCacheKB(executor('0'))).toBeUndefined();
  });
});
