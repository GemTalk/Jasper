import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
vi.mock('vscode', () => import('../../__mocks__/vscode'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { escapeString } from '../../queries/util';
import {
  analyzeExtractSuperclass,
  candidatesForExtractSuperclass,
  startExtractSuperclassPreview,
  applyExtractSuperclass,
} from '../queries/previewExtractSuperclass';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import {
  parseAnalysis,
  parseCandidates,
  parseStartPreview,
  parseApplyResult,
} from '../extractSuperclassPreview';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';

/**
 * Automatic GCI integration test for the insert-superclass (V6) / extract-superclass (V7)
 * refactorings, over the real GCI transport.
 *
 * Layers, mirroring the other refactoring integration tests:
 *  1. The engine's GS SUnit suite, filed in from the built payload and run in-stone.
 *  2. Client round trips through the real query builders and parsers: insert an empty superclass
 *     (subtree survives, anchor reparented); extract a common superclass hoisting an identical
 *     method (the new class defines it and BOTH extracted classes still understand it while
 *     losing their own copy — the apply-path both-sides assertion); classify members; and decline
 *     a name collision.
 *
 * Gated via the shared server-plugin feature gate; the engine-dependent tests run in the
 * plugin-installed CI pass and skip, with a reason, against a bare stone. Fully transient: the
 * harness aborts each test, so the fixture classes and any applied change are rolled back and
 * nothing is committed. All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('extract superclass (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const enginePresent = (): boolean =>
    exec(
      '(System myUserProfile symbolList objectNamed: #GsExtractSuperclassRefactoring) notNil printString',
    ).trim() === 'true';

  const engineTestsPayload = (): string =>
    path.resolve(__dirname, '../../../../resources/refactoring/engine-tests.gs');

  const fileInTests = (): string => {
    const p = escapeString(engineTestsPayload());
    return `[GsFileIn fromServerPath: '${p}'] on: Error do: [:e | GsFileIn fromPath: '${p}' on: #serverUtf8File to: nil].`;
  };

  const ANIMAL = 'EsItAnimal';
  const DOG = 'EsItDog';
  const CAT = 'EsItCat';
  const PUPPY = 'EsItPuppy';

  // Animal -> {Dog, Cat}, Dog -> Puppy. Dog and Cat share an identical `eat` and `name` ivar; their
  // `describe` differs.
  const defineFixture = (): void => {
    const def = (name: string, sup: string, ivars: string): void => {
      q.compileClassDefinition(
        session(),
        `${sup} subclass: '${name}' instVarNames: #(${ivars}) classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );
    };
    def(ANIMAL, 'Object', '');
    def(DOG, ANIMAL, "'name' 'bark'");
    def(CAT, ANIMAL, "'name' 'meow'");
    def(PUPPY, DOG, "'cuteness'");
    q.compileMethod(session(), DOG, false, 'accessing', 'eat\n\t^42');
    q.compileMethod(session(), DOG, false, 'accessing', "describe\n\t^'a dog'");
    q.compileMethod(session(), CAT, false, 'accessing', 'eat\n\t^42');
    q.compileMethod(session(), CAT, false, 'accessing', "describe\n\t^'a cat'");
    q.compileMethod(session(), PUPPY, false, 'accessing', 'puppyM\n\t^1');
  };

  const superclassOf = (cls: string): string => exec(`${cls} superclass name asString`).trim();
  const definesSelector = (cls: string, selector: string): boolean =>
    exec(
      `(${cls} compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) notNil printString`,
    ).trim() === 'true';
  const understands = (cls: string, selector: string): boolean =>
    exec(`(${cls} canUnderstand: #'${selector}') printString`).trim() === 'true';

  it('reports extract-superclass engine availability matching the shared refactoring probe', () => {
    expect(enginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  it('runs the extract-superclass GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInTests()}
r := (System myUserProfile symbolList objectNamed: #GsExtractSuperclassRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect(exec(code).trim()).toBe('0');
  });

  it('inserts an empty superclass above a class, keeping the subtree parented', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const analysis = parseAnalysis(
      await analyzeExtractSuperclass(asyncExec, DOG, 'EsItPet', [], { methods: [], instVars: [] }),
    );
    expect(analysis.decline).toBeNull();
    expect(analysis.sharedParent).toBe(ANIMAL);

    const token = `esup-insert-${DOG}`;
    const start = parseStartPreview(
      await startExtractSuperclassPreview(
        asyncExec,
        DOG,
        'EsItPet',
        [],
        { methods: [], instVars: [] },
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );
    expect(start.outOfScope.decline).toBeNull();
    const result = parseApplyResult(await applyExtractSuperclass(asyncExec, token));

    expect(result.failed).toEqual([]);
    expect(superclassOf('EsItPet')).toBe(ANIMAL);
    expect(superclassOf(DOG)).toBe('EsItPet');
    expect(superclassOf(PUPPY)).toBe(DOG);
    expect(understands(PUPPY, 'eat')).toBe(true);
  });

  it('extracts a common superclass, hoisting an identical method both classes then inherit', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `esup-extract-${DOG}`;
    const start = parseStartPreview(
      await startExtractSuperclassPreview(
        asyncExec,
        DOG,
        'EsItPet',
        [CAT],
        { methods: ['eat'], instVars: [] },
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );
    expect(start.outOfScope.decline).toBeNull();
    const result = parseApplyResult(await applyExtractSuperclass(asyncExec, token));

    expect(result.failed).toEqual([]);
    // The hoisted method lives on the new superclass...
    expect(definesSelector('EsItPet', 'eat')).toBe(true);
    // ...is gone from both extracted classes' own dictionaries...
    expect(definesSelector(DOG, 'eat')).toBe(false);
    expect(definesSelector(CAT, 'eat')).toBe(false);
    // ...but both still understand it by inheritance (the both-sides survival assertion)...
    expect(understands(DOG, 'eat')).toBe(true);
    expect(understands(CAT, 'eat')).toBe(true);
    // ...and their non-hoisted methods stay put.
    expect(definesSelector(DOG, 'describe')).toBe(true);
    expect(definesSelector(CAT, 'describe')).toBe(true);
  });

  it('classifies a shared method as identical and a differing one as divergent', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const candidates = parseCandidates(await candidatesForExtractSuperclass(asyncExec, DOG, [CAT]));

    const eat = candidates.methods.find((m) => m.selector === 'eat');
    const describe = candidates.methods.find((m) => m.selector === 'describe');
    expect(eat?.kind).toBe('identical');
    expect(eat?.defaultChecked).toBe(true);
    expect(describe?.kind).toBe('divergent');
  });

  it('declines extracting into an existing class name', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const analysis = parseAnalysis(
      await analyzeExtractSuperclass(asyncExec, DOG, CAT, [], { methods: [], instVars: [] }),
    );

    expect(analysis.decline).toContain('already exists');
  });
});
