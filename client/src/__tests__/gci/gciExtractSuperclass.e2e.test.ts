import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock vscode since browserQueries → gciLog → vscode.
vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { GciLibrary } from '../../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gciTestConfig';
import { ActiveSession } from '../../sessionManager';
import { GemStoneLogin } from '../../loginTypes';
import * as q from '../../browserQueries';
import {
  analyzeExtractSuperclass,
  startExtractSuperclassPreview,
  applyExtractSuperclass,
} from '../../refactoring/queries/previewExtractSuperclass';
import { PREVIEW_PAGE_BYTES } from '../../refactoring/queries/previewRenameMethod';
import {
  parseAnalysis,
  parseStartPreview,
  parseApplyResult,
} from '../../refactoring/extractSuperclassPreview';

/**
 * On-demand GCI end-to-end test (`npm run test:gci`) for the insert-superclass (V6) /
 * extract-superclass (V7) refactorings. Drives the real query builders + parsers against a live
 * stone over the GCI transport, then rolls everything back.
 *
 * GUARDED on the engine being loaded: on a bare stone (no GsExtractSuperclassRefactoring) each
 * test skips with a reason. Fully transient — every test aborts the transaction in a `finally`, so
 * the fixture classes and the applied changes never commit.
 */
describe('extract superclass (gci e2e)', () => {
  let gci: GciLibrary;
  let session: ActiveSession;
  let enginePresent = false;

  const exec = (code: string): string => q.executeFetchString(session, code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const ANIMAL = 'EsE2eAnimal';
  const DOG = 'EsE2eDog';
  const CAT = 'EsE2eCat';
  const PUPPY = 'EsE2ePuppy';

  const defineFixture = (): void => {
    const def = (name: string, sup: string, ivars: string): void => {
      q.compileClassDefinition(
        session,
        `${sup} subclass: '${name}' instVarNames: #(${ivars}) classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );
    };
    def(ANIMAL, 'Object', '');
    def(DOG, ANIMAL, "'name' 'bark'");
    def(CAT, ANIMAL, "'name' 'meow'");
    def(PUPPY, DOG, "'cuteness'");
    q.compileMethod(session, DOG, false, 'accessing', 'eat\n\t^42');
    q.compileMethod(session, CAT, false, 'accessing', 'eat\n\t^42');
  };

  const superclassOf = (cls: string): string => exec(`${cls} superclass name asString`).trim();
  const definesSelector = (cls: string, selector: string): boolean =>
    exec(
      `(${cls} compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) notNil printString`,
    ).trim() === 'true';
  const understands = (cls: string, selector: string): boolean =>
    exec(`(${cls} canUnderstand: #'${selector}') printString`).trim() === 'true';

  const abort = (): void => {
    // Evaluate to a String: executeFetchString sends #encodeAsUTF8 to the result, which the System
    // class (the value of `System abortTransaction`) does not understand.
    exec("System abortTransaction. 'ok'");
  };

  beforeAll(() => {
    gci = new GciLibrary(GCI_LIBRARY_PATH);
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();
    session = {
      id: 1,
      gci,
      handle: login.session,
      login: { label: 'Test' } as GemStoneLogin,
      stoneVersion: '3.7.5',
    };
    enginePresent =
      exec(
        '(System myUserProfile symbolList objectNamed: #GsExtractSuperclassRefactoring) notNil printString',
      ).trim() === 'true';
  });

  afterAll(() => {
    if (session?.handle) gci.GciTsLogout(session.handle);
    gci?.close();
  });

  it('inserts an empty superclass above a class, then rolls back', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();
      const analysis = parseAnalysis(
        await analyzeExtractSuperclass(asyncExec, DOG, 'EsE2ePet', [], {
          methods: [],
          instVars: [],
        }),
      );
      expect(analysis.decline).toBeNull();

      const token = 'esup-e2e-insert';
      parseStartPreview(
        await startExtractSuperclassPreview(
          asyncExec,
          DOG,
          'EsE2ePet',
          [],
          { methods: [], instVars: [] },
          token,
          PREVIEW_PAGE_BYTES,
        ),
      );
      const result = parseApplyResult(await applyExtractSuperclass(asyncExec, token));

      expect(result.failed).toEqual([]);
      expect(superclassOf('EsE2ePet')).toBe(ANIMAL);
      expect(superclassOf(DOG)).toBe('EsE2ePet');
      expect(superclassOf(PUPPY)).toBe(DOG);
    } finally {
      abort();
    }
  });

  it('extracts a common superclass hoisting an identical method both classes inherit, then rolls back', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();
      const token = 'esup-e2e-extract';
      parseStartPreview(
        await startExtractSuperclassPreview(
          asyncExec,
          DOG,
          'EsE2ePet',
          [CAT],
          { methods: ['eat'], instVars: [] },
          token,
          PREVIEW_PAGE_BYTES,
        ),
      );
      const result = parseApplyResult(await applyExtractSuperclass(asyncExec, token));

      expect(result.failed).toEqual([]);
      expect(definesSelector('EsE2ePet', 'eat')).toBe(true);
      expect(definesSelector(DOG, 'eat')).toBe(false);
      expect(definesSelector(CAT, 'eat')).toBe(false);
      expect(understands(DOG, 'eat')).toBe(true);
      expect(understands(CAT, 'eat')).toBe(true);
    } finally {
      abort();
    }
  });
});
