import { describe, it, expect, afterAll, vi } from 'vitest';

// Real GCI and a real filesystem, but stub the `vscode` module the query layer pulls
// in via gciLog.
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { fileInFile } from '../fileIn';
import { parseTopazScript } from '../../topazFileIn';
import { composeFileOut } from '../fileOut';
import type { ActiveSession } from '../../sessionManager';

/**
 * File In against a live stone, and the round trip that is the point of it (#539):
 * what File Out writes, File In has to put back.
 *
 * A unit test can say the runner sent the right query for each step; only a stone can
 * say the file GemStone itself produced parses into steps that rebuild the class it
 * came from — which is the thing that quietly breaks when either side drifts.
 *
 * Transient in both directions. The harness wraps each test in a GciTsBegin/GciTsAbort
 * pair so nothing is committed, and the `.gs` files are written under a temp directory
 * that is removed afterwards. Emitted Smalltalk stays ASCII-only, since the suite also
 * runs on 3.6.x.
 */
describe('file in (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  let withTransientSession: (callback: (transientSession: unknown) => unknown) => Promise<void>;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
    withTransientSession = testContext.withTransientSession;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = async (code: string): Promise<string> => await q.executeFetchString(session(), code);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-filein-'));
  afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const write = (name: string, text: string): string => {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, text, 'utf8');
    return file;
  };

  const dictIndexOf = async (name: string): Promise<number> =>
    parseInt(
      await exec(
        `| sl d | sl := System myUserProfile symbolList. ` +
          `d := sl detect: [:x | x name = #'${name}'] ifNone: [nil]. ` +
          `(d ifNil: [0] ifNotNil: [sl indexOf: d]) printString`,
      ),
      10,
    );
  const userIndex = async (): Promise<number> => await dictIndexOf('UserGlobals');

  const WIDGET = 'JasperFileInWidget';

  const classExists = async (name: string): Promise<boolean> =>
    (await exec(`(UserGlobals includesKey: #'${name}') printString`)).trim() === 'true';

  const selectorsOf = async (name: string, isMeta: boolean): Promise<string[]> =>
    (await q.getClassEnvironments(session(), await userIndex(), name, 0))
      .filter((l) => l.isMeta === isMeta)
      .flatMap((l) => l.selectors)
      .sort();

  const categoryOfMethod = async (name: string, selector: string): Promise<string | undefined> =>
    (await q.getClassEnvironments(session(), await userIndex(), name, 0)).find(
      (l) => !l.isMeta && l.selectors.includes(selector),
    )?.category;

  /** The standard fixture: one instance method and one class method, categorised. */
  const defineWidget = async (): Promise<void> => {
    await q.compileClassDefinition(
      session(),
      `Object subclass: '${WIDGET}' instVarNames: #('size') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    await q.compileMethod(session(), WIDGET, false, 'accessing', 'size ^size');
    await q.compileMethod(session(), WIDGET, true, 'instance creation', 'make ^self new');
  };

  describe('round trip', () => {
    it('rebuilds a deleted class from the file it was filed out to', async () => {
      await defineWidget();
      const text = composeFileOut(await q.fileOutHeader(session()), [
        await q.fileOutClass(session(), WIDGET, await userIndex()),
      ]);
      const file = write(`${WIDGET}.gs`, text);

      await q.deleteClass(session(), await userIndex(), WIDGET);
      expect(await classExists(WIDGET)).toBe(false);

      const outcome = await fileInFile(session(), file);

      expect(outcome.errors).toEqual([]);
      expect(await classExists(WIDGET)).toBe(true);
      expect(await selectorsOf(WIDGET, false)).toContain('size');
      expect(await selectorsOf(WIDGET, true)).toContain('make');
    });

    it('puts each method back in the category it was filed out of', async () => {
      await defineWidget();
      const file = write(
        `${WIDGET}-cat.gs`,
        composeFileOut(await q.fileOutHeader(session()), [
          await q.fileOutClass(session(), WIDGET, await userIndex()),
        ]),
      );
      await q.deleteClass(session(), await userIndex(), WIDGET);

      await fileInFile(session(), file);

      expect(await categoryOfMethod(WIDGET, 'size')).toBe('accessing');
    });

    it("skips nothing it does not understand in GemStone's own file-out", async () => {
      await defineWidget();
      const file = write(
        `${WIDGET}-skip.gs`,
        composeFileOut(await q.fileOutHeader(session()), [
          await q.fileOutClass(session(), WIDGET, await userIndex()),
        ]),
      );

      const outcome = await fileInFile(session(), file);

      // Every directive GemStone writes is one the parser handles or knowingly
      // ignores; a new one showing up here means the file-in is dropping something.
      expect(outcome.skipped).toEqual([]);
      // And a file-out carries no topaz session commands at all — those belong to a
      // hand-written script, not to a file-out.
      expect(outcome.ignored).toEqual([]);
    });

    it('understands every directive a whole-dictionary file-out writes', async () => {
      await defineWidget();

      const steps = parseTopazScript(await q.fileOutDictionary(session(), await userIndex()));

      // The dictionary file-out comes from a different GemStone entry point than the
      // class one, so it gets its own check that nothing in it goes unread.
      expect(steps.filter((s) => s.kind === 'unsupported')).toEqual([]);
      expect(steps.some((s) => s.kind === 'execute')).toBe(true);
      expect(steps.some((s) => s.kind === 'method')).toBe(true);
    });

    it('files a method-only file-out back in without touching the class definition', async () => {
      await defineWidget();
      const file = write(
        `${WIDGET}-method.gs`,
        composeFileOut(await q.fileOutHeader(session()), [
          await q.fileOutMethod(session(), WIDGET, false, 'size', await userIndex()),
        ]),
      );
      // Change the method in the image, so filing the old one back in is observable.
      await q.compileMethod(session(), WIDGET, false, 'accessing', 'size ^0');
      expect(await q.getMethodSource(session(), WIDGET, false, 'size')).toContain('^0');

      const outcome = await fileInFile(session(), file);

      expect(outcome.errors).toEqual([]);
      expect(outcome.executed).toBe(0);
      expect(outcome.compiled).toBe(1);
      expect(await q.getMethodSource(session(), WIDGET, false, 'size')).toContain('^size');
    });
  });

  describe('which session it lands in', () => {
    const TARGETED = 'JasperFileInTargeted';

    const existsIn = async (target: ActiveSession, name: string): Promise<boolean> =>
      (
        await q.executeFetchString(target, `(UserGlobals includesKey: #'${name}') printString`)
      ).trim() === 'true';

    it('files into the session it was handed, and into no other', async () => {
      const file = write(
        'targeted.gs',
        [
          'doit',
          `Object subclass: '${TARGETED}' instVarNames: #() classVars: #() ` +
            'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
          '%',
        ].join('\n'),
      );

      await withTransientSession(async (other) => {
        const second = { id: 2, gci, handle: other } as unknown as ActiveSession;

        const outcome = await fileInFile(second, file);

        expect(outcome.errors).toEqual([]);
        // The class is in the session the file-in was handed...
        expect(await existsIn(second, TARGETED)).toBe(true);
        // ...and not in the other one that is logged in at the same moment. A
        // file-in commits nothing, so an uncommitted class cannot cross sessions —
        // which makes this the sharpest available proof that the work went where it
        // was addressed rather than to whichever session happened to be active.
        expect(await existsIn(session(), TARGETED)).toBe(false);
      });
    });

    it('leaves nothing behind in a session it was not addressed to', async () => {
      const file = write(
        'targeted-back.gs',
        [
          'doit',
          `Object subclass: '${TARGETED}Back' instVarNames: #() classVars: #() ` +
            'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
          '%',
        ].join('\n'),
      );

      // The mirror image: file into THIS session, and the second one cannot see it.
      await fileInFile(session(), file);

      expect(await existsIn(session(), `${TARGETED}Back`)).toBe(true);
      await withTransientSession(async (other) => {
        const second = { id: 2, gci, handle: other } as unknown as ActiveSession;
        expect(await existsIn(second, `${TARGETED}Back`)).toBe(false);
      });
    });
  });

  describe('a whole dictionary', () => {
    const ZOO = 'JasperFileInZoo';

    /** A dictionary of our own, holding a class and its subclass, one of whose
     *  methods refers to the other. Transient: the harness aborts after the test. */
    const defineZoo = async (): Promise<void> => {
      await exec(
        `| d | d := System myUserProfile symbolList objectNamed: #'${ZOO}'. ` +
          `d isNil ifTrue: [d := SymbolDictionary new name: #'${ZOO}'; yourself. ` +
          `System myUserProfile insertDictionary: d at: 1]. 'ok'`,
      );
      await q.compileClassDefinition(
        session(),
        `Object subclass: 'JasperZooAnimal' instVarNames: #() classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: ${ZOO}`,
      );
      await q.compileClassDefinition(
        session(),
        `JasperZooAnimal subclass: 'JasperZooDog' instVarNames: #() classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: ${ZOO}`,
      );
      // Refers forward to its own subclass, so the file has to define both classes
      // before it compiles any method.
      await q.compileMethod(
        session(),
        'JasperZooAnimal',
        false,
        'accessing',
        'pal ^JasperZooDog new',
      );
    };

    const zooExists = async (): Promise<boolean> =>
      (
        await exec(`(System myUserProfile symbolList objectNamed: #'${ZOO}') notNil printString`)
      ).trim() === 'true';

    it('files out a preamble that creates the dictionary, because GemStone does not', async () => {
      await defineZoo();

      const text = await q.fileOutDictionary(session(), ZOO);

      // Every class definition says `inDictionary: <name>`, a bare global — without
      // this the first chunk fails on an undefined symbol and takes the file with it.
      expect(text).toContain(`inDictionary: ${ZOO}`);
      expect(text).toContain(`SymbolDictionary new name: #'${ZOO}'`);
      expect(text).toContain('System myUserProfile insertDictionary: dict at: 1');
    });

    it('rebuilds the dictionary and its classes on a stone that has neither', async () => {
      await defineZoo();
      const file = write(
        `${ZOO}.gs`,
        composeFileOut(await q.fileOutHeader(session()), [
          await q.fileOutDictionary(session(), ZOO),
        ]),
      );

      // Take the whole dictionary away — this is the state a colleague's stone is in.
      await q.removeDictionary(session(), ZOO);
      expect(await zooExists()).toBe(false);

      const outcome = await fileInFile(session(), file);

      expect(outcome.errors).toEqual([]);
      expect(await zooExists()).toBe(true);
      expect(
        (
          await exec(
            `((System myUserProfile symbolList objectNamed: #'${ZOO}') ` +
              `includesKey: #'JasperZooDog') printString`,
          )
        ).trim(),
      ).toBe('true');
      // The forward-referring method compiled, which it only can if both class
      // definitions were read before any method was.
      expect(await q.getMethodSource(session(), 'JasperZooAnimal', false, 'pal')).toContain(
        'JasperZooDog',
      );
    });

    it('leaves an existing dictionary where it is rather than making a second one', async () => {
      await defineZoo();
      const before = (await exec(`System myUserProfile symbolList size printString`)).trim();
      const file = write(
        `${ZOO}-again.gs`,
        composeFileOut(await q.fileOutHeader(session()), [
          await q.fileOutDictionary(session(), ZOO),
        ]),
      );

      const outcome = await fileInFile(session(), file);

      expect(outcome.errors).toEqual([]);
      expect((await exec('System myUserProfile symbolList size printString')).trim()).toBe(before);
    });
  });

  describe('a topaz script', () => {
    it('runs its chunks, skips its topaz commands, and stops at exit', async () => {
      const file = write(
        'script.tpz',
        [
          'set gemstone gs64stone',
          'set user DataCurator password swordfish',
          'login',
          'display oops',
          'run',
          '| ws |',
          'ws := WriteStream on: String new.',
          `ws nextPutAll: 'made by a script'.`,
          `UserGlobals at: #${WIDGET}Note put: ws contents.`,
          '^ws contents',
          '%',
          'commit',
          'logout',
          'exit',
          'run',
          `UserGlobals at: #${WIDGET}NotReached put: 1.`,
          '%',
        ].join('\n'),
      );

      const outcome = await fileInFile(session(), file);

      // The chunk ends in a non-local return, which is ordinary in a hand-written
      // script and would otherwise make the doit answer a non-String and fail.
      expect(outcome.errors).toEqual([]);
      expect(outcome.executed).toBe(1);
      expect(await exec(`(UserGlobals at: #'${WIDGET}Note' ifAbsent: ['?'])`)).toBe(
        'made by a script',
      );

      // Topaz's own commands are recognised, not misread as code...
      expect(outcome.skipped).toEqual([]);
      expect(outcome.ignored.length).toBe(6);
      expect(outcome.askedToCommit).toBe(true);
      // ...and nothing past `exit` runs.
      expect(outcome.stopped).toBe(true);
      expect(await classExists(`${WIDGET}NotReached`)).toBe(false);
    });

    it('does not commit, however plainly the script asked to', async () => {
      const file = write(
        'commits.tpz',
        ['run', `UserGlobals at: #${WIDGET}Uncommitted put: 1.`, '%', 'commit'].join('\n'),
      );

      await fileInFile(session(), file);

      // The harness aborts after every test, so a real commit here would survive into
      // the next one — this asserts the intent at the point it is decided.
      expect(await exec('System needsCommit printString')).toBe('true');
    });
  });

  describe('following input', () => {
    it('files in the files a loader names, resolved beside it', async () => {
      await defineWidget();
      write(
        'part.gs',
        composeFileOut(await q.fileOutHeader(session()), [
          await q.fileOutClass(session(), WIDGET, await userIndex()),
        ]),
      );
      const loader = write('loader.gs', 'fileformat utf8\n\ninput part.gs\n');
      await q.deleteClass(session(), await userIndex(), WIDGET);

      const outcome = await fileInFile(session(), loader);

      expect(outcome.errors).toEqual([]);
      expect(outcome.files).toBe(2);
      expect(await classExists(WIDGET)).toBe(true);
    });
  });

  describe('reporting failure', () => {
    it('names the method GemStone refused, and files the rest in anyway', async () => {
      await defineWidget();
      const file = write(
        'broken.gs',
        [
          'fileformat utf8',
          "category: 'accessing'",
          `method: ${WIDGET}`,
          'good ^1',
          '%',
          "category: 'accessing'",
          `method: ${WIDGET}`,
          'bad ^ this is not smalltalk at all',
          '%',
        ].join('\n'),
      );

      const outcome = await fileInFile(session(), file);

      expect(outcome.compiled).toBe(1);
      expect(outcome.errors).toHaveLength(1);
      expect(outcome.errors[0].message).toContain(`${WIDGET}>>bad`);
      expect(await selectorsOf(WIDGET, false)).toContain('good');
      expect(await selectorsOf(WIDGET, false)).not.toContain('bad');
    });

    it('reports a chunk GemStone raised on, against its line', async () => {
      const file = write('raises.gs', ['doit', 'nil noSuchMessageAtAll', '%'].join('\n'));

      const outcome = await fileInFile(session(), file);

      expect(outcome.executed).toBe(0);
      expect(outcome.errors).toHaveLength(1);
      expect(outcome.errors[0].line).toBe(2);
    });
  });

  describe('removeAllMethods', () => {
    it('clears the instance side but leaves the class side alone', async () => {
      await defineWidget();

      await q.removeAllMethods(session(), WIDGET, false);

      expect(await selectorsOf(WIDGET, false)).toEqual([]);
      expect(await selectorsOf(WIDGET, true)).toContain('make');
    });

    it('clears the class side through the metaclass', async () => {
      await defineWidget();

      await q.removeAllMethods(session(), WIDGET, true);

      expect(await selectorsOf(WIDGET, true)).toEqual([]);
      expect(await selectorsOf(WIDGET, false)).toContain('size');
    });

    it('fails loudly on a name no class answers to', async () => {
      await expect(q.removeAllMethods(session(), 'JasperFileInNoSuchClass', false)).rejects.toThrow(
        /Class not found/,
      );
    });
  });

  describe('fileInChunk', () => {
    it('runs a chunk with its own temporaries', async () => {
      expect(await q.fileInChunk(session(), '| d | d := IdentityBag new. d add: 1. d')).toBe('ok');
    });

    it("lets GemStone's error through instead of folding it into a string", async () => {
      await expect(q.fileInChunk(session(), 'nil noSuchMessageAtAll')).rejects.toThrow();
    });
  });
});
