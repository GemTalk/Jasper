// End-to-end proof that Rowan project export is a deterministic, reload-faithful
// FIXPOINT: exporting a project, unloading it, reloading from the export, and
// re-exporting yields a BYTE-IDENTICAL on-disk tree. This is the invariant the
// export feature promises ("export, load into an image that doesn't have it,
// identical") -- enforced here on every run instead of proven once by hand.
//
// It drives a live stone imperatively: create a throwaway leaf project (nothing
// depends on it, so it can be unloaded), export via the real
// `exportRowanProject` query, unload, reload from the export, re-export, and
// compare the two on-disk trees.
//
// Requirements: a SystemUser session, because create/unload/reload modify system
// dictionaries and DataCurator (the configured VITE_GEMSTONE_USER) gets a
// SecurityError -- so this re-logs the harness session in as SystemUser. And,
// crucially, a stone whose image HAS Rowan. The stone from
// `npm run test:server:start` uses a bare extent with no Rowan, so this test
// SKIPS there. To actually run it, point .env.test / .env.test.local at a
// Rowan-enabled stone (start one from `extent0.rowan3.dbf`).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
vi.mock('vscode', () => import('../../../__mocks__/vscode'));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { useIntegrationTest, GciTestContext } from '../../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../../gciLibrary';
import * as q from '../../../browserQueries';
import type { ActiveSession } from '../../../sessionManager';
import { exportRowanProject } from '../exportRowanProject';
import { listRowanProjects } from '../listRowanProjects';

const TIMEOUT = 300_000;
const PROJECT = 'JasperFixpointProbe';
const PACKAGE = 'JasperFixpointProbe-Core';

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
  let gci: GciLibrary;
  let handle: unknown;
  let login: GciTestContext['login'];
  let logout: GciTestContext['logout'];
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
    login = testContext.login;
    logout = testContext.logout;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);

  let rowanAvailable = false;
  const tmpDirs: string[] = [];

  // Runs after the harness's own beforeAll, so there is already a session to
  // swap: drop the default (DataCurator) login and take a SystemUser one, which
  // the harness then keeps managing -- per-test transaction, and logout at the
  // end. That per-test abort is also what rolls the probe project back, so
  // nothing is left committed on the stone.
  beforeAll(() => {
    logout();
    login({ user: 'SystemUser' });

    rowanAvailable = listRowanProjects(exec).available;
  });

  afterAll(() => {
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

      expect(exec(createCode(home)).trim()).toBe('ok');

      const a = exportRowanProject(exec, PROJECT, targetA);
      expect(a.success, a.detail).toBe(true);

      expect(exec(`Rowan gemstoneTools topaz unloadProjectNamed: '${PROJECT}'. 'ok'`).trim()).toBe(
        'ok',
      );
      expect(listRowanProjects(exec).projects.some((p) => p.name === PROJECT)).toBe(false);

      expect(
        exec(
          `(Rowan projectFromUrl: 'file:${targetA}/rowan/specs/${PROJECT}.ston' projectsHome: '${targetA}') load. 'ok'`,
        ).trim(),
      ).toBe('ok');
      expect(listRowanProjects(exec).projects.some((p) => p.name === PROJECT)).toBe(true);

      const c = exportRowanProject(exec, PROJECT, targetC);
      expect(c.success, c.detail).toBe(true);

      const treeA = readTree(targetA);
      const treeC = readTree(targetC);

      expect(treeC.size).toBeGreaterThan(0);
      expect([...treeC.entries()].sort()).toEqual([...treeA.entries()].sort());
    },
    TIMEOUT,
  );
});
