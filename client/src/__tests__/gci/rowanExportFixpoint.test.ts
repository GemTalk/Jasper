// End-to-end proof that Rowan project export is a deterministic, reload-faithful
// FIXPOINT: exporting a project, unloading it, reloading from the export, and
// re-exporting yields a BYTE-IDENTICAL on-disk tree. This is the invariant the
// export feature promises ("export, load into an image that doesn't have it,
// identical") — enforced here on every run instead of proven once by hand.
//
// It drives a live stone imperatively: create a throwaway leaf project (nothing
// depends on it, so it can be unloaded), export via the real
// `exportRowanProject` query, unload, reload from the export, re-export, and
// compare the two on-disk trees.
//
// Requirements: a SystemUser session (create/unload/reload modify system
// dictionaries — DataCurator gets a SecurityError) and, crucially, a stone whose
// image HAS Rowan. The stone from `npm run test:server:start` uses a bare extent
// with no Rowan, so this test SKIPS there. To actually run it, point .env.test /
// .env.test.local at a Rowan-enabled stone (start one from `extent0.rowan3.dbf`),
// then: `npx vitest run --project gci rowanExportFixpoint`.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GciLibrary } from '../../gciLibrary';
import { QueryExecutor } from '../../queries/types';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_PASSWORD } from './gciTestConfig';
import { exportRowanProject } from '../../queries/rowan/exportRowanProject';
import { listRowanProjects } from '../../queries/rowan/listRowanProjects';

const OOP_NIL = 0x14n;
const OOP_ILLEGAL = 0x01n;
const MAX_RESULT = 256 * 1024;
const TIMEOUT = 300_000;
const PROJECT = 'JasperFixpointProbe';
const PACKAGE = 'JasperFixpointProbe-Core';

interface SysSession {
  exec: QueryExecutor;
  logout: () => void;
}

// A SystemUser session (needed for create/unload/reload) bound to a QueryExecutor,
// mirroring queryHarness.login() but with the elevated user.
function loginSystemUser(): SysSession {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);
  const r = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, 'SystemUser', GS_PASSWORD, 0, 0);
  if (!r.session) {
    throw new Error(`SystemUser login failed: ${r.err.message || `error ${r.err.number}`}`);
  }
  const handle = r.session;
  const utf8 = gci.GciTsResolveSymbol(handle, 'Utf8', OOP_NIL).result;
  const exec: QueryExecutor = (code) => {
    const { data, err } = gci.GciTsExecuteFetchBytes(
      handle,
      code,
      -1,
      utf8,
      OOP_ILLEGAL,
      OOP_NIL,
      MAX_RESULT,
    );
    if (err.number !== 0)
      throw new Error(`${err.message || `GCI error ${err.number}`} | source: ${code}`);
    return String(data);
  };
  return {
    exec,
    logout: () => {
      try {
        gci.GciTsAbort(handle);
      } catch {
        /* ignore */
      }
      try {
        gci.GciTsLogout(handle);
      } catch {
        /* ignore */
      }
    },
  };
}

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Read a directory tree into { relativePath -> content }, normalizing any
// absolute file: URL to a constant. The only byte that legitimately differs
// between two exports to different locations is the load spec's own #diskUrl,
// which records where the copy was written; everything else must match exactly.
function readTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, rel: string) => {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, r);
      else out.set(r, fs.readFileSync(full, 'utf8').replace(/file:[^\s',]+/g, 'file:NORM'));
    }
  };
  walk(root, '');
  return out;
}

const createCode = (projectsHome: string) => `| p |
[Rowan gemstoneTools topaz unloadProjectNamed: '${PROJECT}'] on: Error do: [:e | nil].
p := (Rowan newProjectNamed: '${PROJECT}')
  projectsHome: '${projectsHome}';
  gemstoneSetDefaultSymbolDictNameTo: 'UserGlobals';
  repoType: #disk;
  addLoadComponentNamed: 'Core';
  addPackagesNamed: { '${PACKAGE}' } toComponentNamed: 'Core';
  comment: 'throwaway fixpoint probe';
  yourself.
(p packageNamed: '${PACKAGE}')
  addClassNamed: 'JasperFixThing' super: 'Object' instvars: #('ivar') category: '${PACKAGE}' comment: 'a thing'.
p load.
'ok'`;

describe('Rowan export is a deterministic reload-faithful fixpoint', () => {
  let sys: SysSession;
  let rowanAvailable = false;
  const tmpDirs: string[] = [];

  beforeAll(() => {
    sys = loginSystemUser();
    rowanAvailable = listRowanProjects(sys.exec).available;
  });

  afterAll(() => {
    sys?.logout();
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  });

  it(
    'round-trips a created project to a byte-identical on-disk copy',
    (ctx) => {
      // No Rowan in this image (e.g. the bare-extent test stone) → skip visibly
      // rather than passing vacuously.
      if (!rowanAvailable) ctx.skip();

      const home = mkTmp('jasper-rowan-home-');
      const dirA = mkTmp('jasper-rowan-a-');
      const dirC = mkTmp('jasper-rowan-c-');
      tmpDirs.push(home, dirA, dirC);
      const targetA = path.join(dirA, PROJECT);
      const targetC = path.join(dirC, PROJECT);

      expect(sys.exec(createCode(home)).trim()).toBe('ok');

      const a = exportRowanProject(sys.exec, PROJECT, targetA);
      expect(a.success, a.detail).toBe(true);

      expect(
        sys.exec(`Rowan gemstoneTools topaz unloadProjectNamed: '${PROJECT}'. 'ok'`).trim(),
      ).toBe('ok');
      expect(listRowanProjects(sys.exec).projects.some((p) => p.name === PROJECT)).toBe(false);

      expect(
        sys
          .exec(
            `(Rowan projectFromUrl: 'file:${targetA}/rowan/specs/${PROJECT}.ston' projectsHome: '${targetA}') load. 'ok'`,
          )
          .trim(),
      ).toBe('ok');
      expect(listRowanProjects(sys.exec).projects.some((p) => p.name === PROJECT)).toBe(true);

      const c = exportRowanProject(sys.exec, PROJECT, targetC);
      expect(c.success, c.detail).toBe(true);

      const treeA = readTree(targetA);
      const treeC = readTree(targetC);

      expect(treeC.size).toBeGreaterThan(0);
      expect([...treeC.entries()].sort()).toEqual([...treeA.entries()].sort());
    },
    TIMEOUT,
  );
});
