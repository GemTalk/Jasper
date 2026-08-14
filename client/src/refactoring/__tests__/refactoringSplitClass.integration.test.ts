import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import {
  candidatesForSplitClass,
  analyzeSplitClass,
  startSplitClassPreview,
  pageSplitClassPreview,
  applySplitClass,
} from '../queries/previewSplitClass';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import {
  parseAnalysis,
  parseCandidates,
  parseStartPreview,
  parsePage,
  parseApplyResult,
} from '../splitClassPreview';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { fileInEngineTestsExpr } from './support/refactoring';

/**
 * Automatic GCI integration test for the split-class (V8 / extract class) refactoring, over the real
 * GCI transport.
 *
 * Layers, mirroring the other refactoring integration tests:
 *  1. The engine's GS SUnit suite, filed in from the built payload and run in-stone.
 *  2. Client round trips through the real query builders and parsers: extract a cohesive set of a
 *     class's own ivars (and the methods that use them) into a new component, then assert the
 *     APPLIED stone state — the component carries the moved ivars + methods, the source keeps a
 *     lazy accessor + a delegating stub per moved method (external behavior preserved through the
 *     delegator), the retained methods survive the source's reversion (including one no change set
 *     mentions), the subtree is reparented, and nothing is committed. Plus a clean-cut decline.
 *
 * Gated via the shared server-plugin feature gate; the engine-dependent tests run in the
 * plugin-installed CI pass and skip, with a reason, against a bare stone. Fully transient: the
 * harness aborts each test, so the fixture classes and any applied change are rolled back and
 * nothing is committed. All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('split class (integration)', () => {
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
      '(System myUserProfile symbolList objectNamed: #GsSplitClassRefactoring) notNil printString',
    ).trim() === 'true';

  // A cohesive Contact whose address ivars (street/city/zip) and the methods that use them are a
  // clean extract set; name/email + their readers stay behind, and a subclass adds `tier` without
  // touching the address. Names are substring-safe against the engine's decline keywords.
  const SOURCE = 'ScItContact';
  const COMPONENT = 'ScItAddress';
  const COMPONENT_IVAR = 'scItAddress';
  const SUB = 'ScItVip';

  const defineFixture = (): void => {
    const def = (name: string, sup: string, ivars: string): void => {
      q.compileClassDefinition(
        session(),
        `${sup} subclass: '${name}' instVarNames: #(${ivars}) classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );
    };
    def(SOURCE, 'Object', "'name' 'email' 'street' 'city' 'zip'");
    q.compileMethod(session(), SOURCE, false, 'accessing', 'name\n\t^name');
    q.compileMethod(session(), SOURCE, false, 'accessing', 'email\n\t^email');
    q.compileMethod(session(), SOURCE, false, 'accessing', 'street\n\t^street');
    q.compileMethod(session(), SOURCE, false, 'accessing', 'street: aString\n\tstreet := aString');
    q.compileMethod(session(), SOURCE, false, 'accessing', 'city\n\t^city');
    q.compileMethod(session(), SOURCE, false, 'accessing', 'zip\n\t^zip');
    q.compileMethod(
      session(),
      SOURCE,
      false,
      'printing',
      "fullAddress\n\t^street, ', ', city, ' ', zip",
    );
    def(SUB, SOURCE, "'tier'");
    q.compileMethod(session(), SUB, false, 'accessing', 'tier\n\t^tier');
    q.compileMethod(session(), SUB, false, 'printing', 'vipLabel\n\t^name');
  };

  const superclassOf = (cls: string): string => exec(`${cls} superclass name asString`).trim();
  const definesSelector = (cls: string, selector: string): boolean =>
    exec(
      `(${cls} compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) notNil printString`,
    ).trim() === 'true';
  const ownInstVars = (cls: string): string[] => {
    const raw = exec(`(${cls} instVarNames collect: [:e | e asString]) printString`);
    return [...raw.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  };
  const methodSourceOf = (cls: string, selector: string): string =>
    exec(`(${cls} compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) sourceString`);

  it('reports split-class engine availability matching the shared refactoring probe', () => {
    expect(enginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  // Generous timeout: this files in the whole (growing) engine-tests.gs payload and runs a full
  // SUnit suite in-stone over the GCI transport, which takes several seconds on a cold stone.
  it('runs the split-class GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInEngineTestsExpr()}
r := (System myUserProfile symbolList objectNamed: #GsSplitClassRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect(exec(code).trim()).toBe('0');
  }, 60_000);

  it('lists the source own instance variables as extract candidates', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();

    const candidates = parseCandidates(await candidatesForSplitClass(asyncExec, SOURCE));

    expect(candidates.sourceClass).toBe(SOURCE);
    expect(candidates.instVars.map((v) => v.name).sort()).toEqual([
      'city',
      'email',
      'name',
      'street',
      'zip',
    ]);
  });

  it('reports the movable methods and no decline for a clean extract set', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();

    const analysis = parseAnalysis(
      await analyzeSplitClass(asyncExec, SOURCE, COMPONENT, ['street', 'city', 'zip']),
    );

    expect(analysis.decline).toBeNull();
    // street, street:, city, zip, fullAddress all touch only the extract set.
    expect(analysis.movableCount).toBe(5);
  });

  it('moves the chosen ivars and their methods into a new component, delegating from the source', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `split-apply-${SOURCE}`;
    const start = parseStartPreview(
      await startSplitClassPreview(
        asyncExec,
        SOURCE,
        COMPONENT,
        ['street', 'city', 'zip'],
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );
    expect(start.outOfScope.decline).toBeNull();

    const result = parseApplyResult(await applySplitClass(asyncExec, token));

    expect(result.failed).toEqual([]);
    expect(result.committed).toBe(false);
    // The component carries the extracted ivars and the moved methods...
    expect(ownInstVars(COMPONENT).sort()).toEqual(['city', 'street', 'zip']);
    expect(definesSelector(COMPONENT, 'street')).toBe(true);
    expect(definesSelector(COMPONENT, 'fullAddress')).toBe(true);
    // ...the source drops the extracted ivars and gains the component ivar...
    const sourceIvars = ownInstVars(SOURCE);
    expect(sourceIvars).not.toContain('street');
    expect(sourceIvars).toContain(COMPONENT_IVAR);
    expect(sourceIvars).toContain('name');
    // ...with a lazy accessor and a delegating stub per moved method...
    expect(methodSourceOf(SOURCE, COMPONENT_IVAR)).toContain('ifNil:');
    expect(methodSourceOf(SOURCE, 'street')).toContain(`self ${COMPONENT_IVAR}`);
  });

  it('preserves external behavior through the generated delegator', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `split-behavior-${SOURCE}`;
    parseStartPreview(
      await startSplitClassPreview(
        asyncExec,
        SOURCE,
        COMPONENT,
        ['street', 'city', 'zip'],
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );
    parseApplyResult(await applySplitClass(asyncExec, token));

    const readBack = exec(
      `| c | c := ${SOURCE} new. c perform: #'street:' with: '1 Analytical Way'. c street`,
    );

    expect(readBack.trim()).toBe('1 Analytical Way');
  });

  it('keeps the retained methods on the reversioned source and reparents the subtree', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `split-survive-${SOURCE}`;
    parseStartPreview(
      await startSplitClassPreview(
        asyncExec,
        SOURCE,
        COMPONENT,
        ['street', 'city', 'zip'],
        token,
        PREVIEW_PAGE_BYTES,
      ),
    );
    parseApplyResult(await applySplitClass(asyncExec, token));

    // A retained reader survives the reversion — `email` is named by no change set, so only the
    // copy-forward preserves it (the both-sides survival assertion).
    expect(definesSelector(SOURCE, 'email')).toBe(true);
    // The subclass is reparented onto the new source version and keeps its own methods.
    expect(superclassOf(SUB)).toBe(SOURCE);
    expect(definesSelector(SUB, 'tier')).toBe(true);
    expect(definesSelector(SUB, 'vipLabel')).toBe(true);
  });

  it('declines a straddling method that also uses a retained instance variable', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    q.compileMethod(session(), SOURCE, false, 'computing', 'usesBoth\n\t^street size + name size');

    const analysis = parseAnalysis(
      await analyzeSplitClass(asyncExec, SOURCE, COMPONENT, ['street', 'city', 'zip']),
    );

    expect(analysis.decline).toContain('stay behind');
  });

  it('serves the preview across several byte-bounded pages that drain to the total', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `split-page-${SOURCE}`;
    const start = parseStartPreview(
      await startSplitClassPreview(
        asyncExec,
        SOURCE,
        COMPONENT,
        ['street', 'city', 'zip'],
        token,
        200,
      ),
    );
    expect(start.page.changes.length).toBeLessThan(start.total); // a small budget forced paging

    const changes = [...start.page.changes];
    let offset = start.page.nextOffset;
    let done = start.page.done;
    while (!done) {
      const page = parsePage(await pageSplitClassPreview(asyncExec, token, offset, 200));
      changes.push(...page.changes);
      offset = page.nextOffset;
      done = page.done;
    }

    expect(changes).toHaveLength(start.total);
  });

  it('reports an expired session for an unknown page or apply token', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const pageRaw = await pageSplitClassPreview(asyncExec, 'no-such-token', 1, 1000);
    const applyResult = parseApplyResult(await applySplitClass(asyncExec, 'no-such-token'));

    expect(() => parsePage(pageRaw)).toThrow(/expired/);
    expect(applyResult.error).toContain('expired');
  });
});
