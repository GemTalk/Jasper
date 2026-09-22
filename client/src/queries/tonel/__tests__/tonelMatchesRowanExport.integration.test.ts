// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement. SKIPS on anything else, and on any
// stone whose image has no Rowan.
//
// The strongest available oracle for file out: build a Rowan project, package and
// class ourselves, export the project through ROWAN'S OWN project writer, and
// compare Rowan's `.class.st` with the one Jasper's single-class file out
// produces. They must be byte-identical.
//
// Why this beats comparing against the shipped corpus
// ----------------------------------------------------
// `tonelFileOut.integration.test.ts` compares against the 720 `.class.st` files
// GemStone ships, which is a real check but a compromised one: those files are a
// PACKAGE-partitioned export, so a base class's methods are split across its own
// file and other packages' `.extension.st` files, while Jasper writes one
// class-complete file. Whole-file comparison is therefore meaningless there, and
// the suite has to assert header identity, method fidelity and selector
// completeness separately — three checks that each have to remember what they
// cover.
//
// Here the class belongs to exactly ONE package and has no extension methods
// anywhere, so the package-partitioned file and the class-complete file describe
// the same set of methods. That makes a single whole-file comparison legitimate,
// and it covers everything the three separate oracles do plus whatever they
// forgot — method ORDER across categories, the blank lines between blocks, the
// category pragma format, and the exact header key order.
//
// The class is built to be awkward on purpose: selectors that sort differently
// under the two plausible comparators (`Aa`/`aa`/`Zz`/`zz`), a leading-underscore
// selector, binary selectors, a keyword selector, and several protocols including
// one that sorts after the class's own name.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
vi.mock('vscode', () => import('../../../__mocks__/vscode.js'));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { useIntegrationTest, GciTestContext } from '../../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../../gciLibrary';
import * as q from '../../../browserQueries';
import type { ActiveSession } from '../../../sessionManager';
import { exportRowanProject } from '../../rowan/exportRowanProject';
import { listRowanProjects } from '../../rowan/listRowanProjects';
import { fileOutClassTonel, isTonelFileOutError } from '../fileOutClassTonel';
import { tonelCapability } from '../tonelCapability';

const TIMEOUT = 300_000;
const PROJECT = 'JasperTonelOracleProbe';
const PACKAGE = 'JasperTonelOracleProbe-Core';
const CLASS = 'JasperTonelOracleThing';

/**
 * Methods the probe class defines, as [protocol, source].
 *
 * Chosen to be awkward: `Aa`/`aa`/`Zz`/`zz` sort one way under
 * `_unicodeLessThan:` and the other under `codePointCompareTo:`, so a wrong
 * comparator cannot pass by luck; `_reset` leads with an underscore; `+` and `=`
 * are binary; `at:put:` is a multi-keyword selector. The protocols deliberately do
 * not sort in the order the methods do.
 */
const METHODS: ReadonlyArray<readonly [string, string]> = [
  ['accessing', 'aa\n\t^#aa'],
  ['accessing', 'Aa\n\t^#Aa'],
  ['zed-last', 'zz\n\t^#zz'],
  ['zed-last', 'Zz\n\t^#Zz'],
  ['arithmetic', '+ aNumber\n\t^aNumber'],
  ['comparing', '= anObject\n\t^self == anObject'],
  ['accessing', 'at: aKey put: aValue\n\t^aValue'],
  ['private', '_reset\n\tivar := nil'],
  ['printing', "printOn: aStream\n\taStream nextPutAll: 'probe'"],
];

const CLASS_METHODS: ReadonlyArray<readonly [string, string]> = [
  ['instance creation', 'make\n\t^self new'],
  ['Zed-class-protocol', 'zzMake\n\t^self new'],
];

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** The first file named `name` anywhere under `root`, or undefined. */
function findFile(root: string, name: string): string | undefined {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return full;
    }
  }
  return undefined;
}

describe('Jasper file out matches Rowan project export for the same class', () => {
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

  let runnable = false;
  let whyNot = '';
  const tmpDirs: string[] = [];

  // Creating and loading a Rowan project writes system dictionaries, which
  // DataCurator may not do — the export fixpoint suite next door swaps the same
  // way and for the same reason. The Tonel feature itself does NOT need
  // SystemUser; that is covered as DataCurator elsewhere.
  beforeAll(() => {
    logout();
    login({ user: 'SystemUser' });

    if (!listRowanProjects(exec).available) {
      whyNot = 'this image has no Rowan';
      return;
    }
    const capability = tonelCapability(exec);
    if (!capability.available) {
      whyNot = `Tonel machinery absent: ${capability.missing.join(', ')}`;
      return;
    }
    runnable = true;
  });

  afterAll(() => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  });

  /** Create the project, package and class, with every method above. */
  const createProbe = (projectsHome: string): void => {
    const instance = METHODS.map(
      ([protocol, source]) =>
        `(cls compileMethod: '${source.replace(/'/g, "''")}' ` +
        `dictionaries: System myUserProfile symbolList ` +
        `category: '${protocol}').`,
    ).join('\n');
    const meta = CLASS_METHODS.map(
      ([protocol, source]) =>
        `(cls class compileMethod: '${source.replace(/'/g, "''")}' ` +
        `dictionaries: System myUserProfile symbolList ` +
        `category: '${protocol}').`,
    ).join('\n');

    const code = `| p cls |
[Rowan gemstoneTools topaz unloadProjectNamed: '${PROJECT}'] on: Error do: [:e | nil].
p := (Rowan newProjectNamed: '${PROJECT}')
  projectsHome: '${projectsHome}';
  gemstoneSetDefaultSymbolDictNameTo: 'UserGlobals';
  repoType: #disk;
  addLoadComponentNamed: 'Core';
  addPackagesNamed: { '${PACKAGE}' } toComponentNamed: 'Core';
  comment: 'throwaway Tonel oracle probe';
  yourself.
(p packageNamed: '${PACKAGE}')
  addClassNamed: '${CLASS}' super: 'Object' instvars: #('ivar')
  category: '${PACKAGE}' comment: 'A probe with awkward selectors.'.
p load.
cls := System myUserProfile symbolList objectNamed: #'${CLASS}'.
cls isNil ifTrue: [^'ERR class not created'].
${instance}
${meta}
'ok'`;
    expect(exec(code).trim()).toBe('ok');
  };

  it(
    'produces byte-identical text for a class with no extension methods',
    (ctx) => {
      if (!runnable) {
        // A skip is a NON-RESULT, not a pass — see useRowan3Stone.ts. Under
        // JASPER_REQUIRE_ROWAN3 it is an outright failure, so a green verification
        // run cannot have quietly lost this oracle.
        if (process.env.JASPER_REQUIRE_ROWAN3) {
          throw new Error(`JASPER_REQUIRE_ROWAN3 is set, but this oracle cannot run: ${whyNot}`);
        }
        ctx.skip();
      }

      const home = mkTmp('jasper-tonel-oracle-home-');
      const target = mkTmp('jasper-tonel-oracle-out-');
      tmpDirs.push(home, target);

      createProbe(home);

      const exported = exportRowanProject(exec, PROJECT, path.join(target, PROJECT));
      expect(exported.success, exported.detail).toBe(true);

      const rowanFile = findFile(path.join(target, PROJECT), `${CLASS}.class.st`);
      expect(rowanFile, `Rowan wrote no ${CLASS}.class.st under ${target}`).toBeDefined();
      const rowanText = fs.readFileSync(rowanFile as string, 'utf8');

      // Nothing may have leaked into another package, or the premise of a
      // whole-file comparison — that the two describe the same method set — does
      // not hold and a match would be luck.
      const extensions = findFile(path.join(target, PROJECT), `${CLASS}.extension.st`);
      expect(extensions, 'the probe class has extension methods; the comparison is invalid').toBe(
        undefined,
      );

      const jasperText = fileOutClassTonel(exec, CLASS);
      expect(isTonelFileOutError(jasperText), jasperText).toBe(false);

      expect(jasperText).toBe(rowanText);
    },
    TIMEOUT,
  );
});
