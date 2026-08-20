import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import {
  analyzeChangeSignature,
  startChangeSignaturePreview,
  applyChangeSignature,
} from '../queries/previewChangeSignature';
import { PREVIEW_PAGE_BYTES } from '../queries/previewRenameMethod';
import { parseAnalysis, parseStartPreview, parseApplyResult } from '../changeSignaturePreview';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { fileInEngineTestsExpr } from './support/refactoring';

/**
 * Automatic GCI integration test for the change-method-signature (M5) refactoring —
 * add / remove / reorder parameters — over the real GCI transport.
 *
 * Two layers, mirroring the other refactoring integration tests:
 *  1. The engine's GS SUnit suite, filed in from the built payload and run in-stone.
 *  2. Client round trips through the real query builders and parsers: pre-flight
 *     analyze, then the four operations end to end — ADD a parameter (senders get the
 *     default), REORDER parameters, REMOVE an unused parameter — plus the two
 *     precondition paths that block Apply (REMOVE of a used parameter declines; a new
 *     selector that already exists collides) and the deselection path (a deselected
 *     sender is left untouched while the implementor is renamed).
 *
 * Gated via the shared server-plugin feature gate
 * (`requireServerPluginFeature(pluginFeatures.refactoring, …)`): the engine-dependent
 * tests run in the plugin-installed CI pass and skip, with a reason, against a bare
 * stone. Fully transient: the harness aborts each test, so the fixture classes and any
 * applied change are rolled back and nothing is committed. The fixture uses selector
 * spellings unique to it (`csig…`), so a whole-system implementor/sender search matches
 * only the fixture. All emitted Smalltalk is ASCII-only for the 3.6.x matrix.
 */
describe('change method signature (integration)', () => {
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
      '(System myUserProfile symbolList objectNamed: #GsChangeSignatureRefactoring) notNil printString',
    ).trim() === 'true';

  const BASE = 'CSigItBase';
  const WHOLE = { kind: 'wholeSystem' } as const;

  // A fixture with unique keyword selectors + senders, one per M5 scenario.
  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${BASE}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    const m = (src: string): void => {
      q.compileMethod(session(), BASE, false, 'accessing', src);
    };
    // ADD: body uses only k, so a second (unused) parameter is behaviour-preserving.
    m('csigStore: k\n\t^Array with: k');
    m('csigCallStore\n\t^self csigStore: 1');
    // REORDER: both arguments used.
    m('csigMoveX: xVal y: yVal\n\t^Array with: xVal with: yVal');
    m('csigCallMove\n\t^self csigMoveX: 1 y: 2');
    // REMOVE (safe): drop: (b) is unused in the body.
    m('csigKeep: a drop: b\n\t^a * 2');
    m('csigCallKeep\n\t^self csigKeep: 5 drop: 9');
    // REMOVE (declines): a and b are both used.
    m('csigSumA: a b: b\n\t^a + b');
    // COLLISION target: an existing selector to clash with.
    m('csigExisting: p q: r\n\t^p');
  };

  const storedSource = (selector: string): string =>
    exec(`(${BASE} compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) sourceString`);

  const definesSelector = (selector: string): boolean =>
    exec(
      `(${BASE} compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) notNil printString`,
    ).trim() === 'true';

  it('reports change-signature engine availability matching the shared refactoring probe', () => {
    expect(enginePresent()).toBe(q.checkRefactoringSupportAvailable(session()));
  });

  // One blocking exec runs an entire in-stone SUnit suite; under a busy shared
  // stone that can exceed vitest's default 5s and flake a push. Give it room.
  it('runs the change-signature GS SUnit suite in-stone with zero failures', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const code = `| r |
${fileInEngineTestsExpr()}
r := (System myUserProfile symbolList objectNamed: #GsChangeSignatureRefactoringTest) suite run.
(r failures size + r errors size) printString`;

    expect(exec(code).trim()).toBe('0');
  }, 60_000);

  it('pre-flight analyses the method arity and argument names', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();

    const analysis = parseAnalysis(
      await analyzeChangeSignature(asyncExec, BASE, 'csigMoveX:y:', false),
    );

    expect(analysis.decline).toBeNull();
    expect(analysis.selectorKind).toBe('keyword');
    expect(analysis.arity).toBe(2);
    expect(analysis.argNames).toEqual(['xVal', 'yVal']);
  });

  it('adds a parameter, splicing the caller default at the send site', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `csig-add-${BASE}`;

    const start = parseStartPreview(
      await startChangeSignaturePreview(
        asyncExec,
        BASE,
        'csigStore:',
        ['csigStore:', 'put:'],
        [1, 0],
        ['k', 'v'],
        ['', 'nil'],
        WHOLE,
        token,
        PREVIEW_PAGE_BYTES,
        false,
      ),
    );

    expect(start.outOfScope.collision).toBeNull();
    expect(start.outOfScope.decline).toBeNull();
    const impl = start.page.changes.find((c) => c.kind === 'methodRename' && c.className === BASE);
    expect(impl?.newSelector).toBe('csigStore:put:');
    const sender = start.page.changes.find(
      (c) => c.kind === 'methodRecompile' && c.selector === 'csigCallStore',
    );
    expect(sender?.newSource).toContain('put: nil');

    const result = parseApplyResult(await applyChangeSignature(asyncExec, token, []));

    expect(result.failed).toEqual([]);
    expect(definesSelector('csigStore:put:')).toBe(true);
    expect(definesSelector('csigStore:')).toBe(false);
    expect(storedSource('csigCallStore')).toContain('csigStore: 1 put: nil');
  });

  it('reorders parameters in the signature and at the call site', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `csig-reorder-${BASE}`;

    const start = parseStartPreview(
      await startChangeSignaturePreview(
        asyncExec,
        BASE,
        'csigMoveX:y:',
        ['csigMoveY:', 'x:'],
        [2, 1],
        ['', ''],
        ['', ''],
        WHOLE,
        token,
        PREVIEW_PAGE_BYTES,
        false,
      ),
    );

    const impl = start.page.changes.find((c) => c.kind === 'methodRename' && c.className === BASE);
    expect(impl?.newSelector).toBe('csigMoveY:x:');
    expect(impl?.newSource).toContain('csigMoveY: yVal x: xVal');

    const result = parseApplyResult(await applyChangeSignature(asyncExec, token, []));

    expect(result.failed).toEqual([]);
    expect(definesSelector('csigMoveY:x:')).toBe(true);
    expect(definesSelector('csigMoveX:y:')).toBe(false);
    expect(storedSource('csigCallMove')).toContain('csigMoveY: 2 x: 1');
  });

  it('removes an unused parameter, dropping its argument at the call site', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `csig-remove-${BASE}`;

    const start = parseStartPreview(
      await startChangeSignaturePreview(
        asyncExec,
        BASE,
        'csigKeep:drop:',
        ['csigKeep:'],
        [1],
        ['a'],
        [''],
        WHOLE,
        token,
        PREVIEW_PAGE_BYTES,
        false,
      ),
    );

    expect(start.outOfScope.decline).toBeNull();
    const impl = start.page.changes.find((c) => c.kind === 'methodRename' && c.className === BASE);
    expect(impl?.newSelector).toBe('csigKeep:');

    const result = parseApplyResult(await applyChangeSignature(asyncExec, token, []));

    expect(result.failed).toEqual([]);
    expect(definesSelector('csigKeep:')).toBe(true);
    expect(definesSelector('csigKeep:drop:')).toBe(false);
    const callKeep = storedSource('csigCallKeep');
    expect(callKeep).toContain('csigKeep: 5');
    expect(callKeep).not.toContain('drop:');
  });

  it('declines removing a parameter that is used in the body', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `csig-decline-${BASE}`;

    const start = parseStartPreview(
      await startChangeSignaturePreview(
        asyncExec,
        BASE,
        'csigSumA:b:',
        ['csigSumA:'],
        [1],
        ['a'],
        [''],
        WHOLE,
        token,
        PREVIEW_PAGE_BYTES,
        false,
      ),
    );

    expect(start.outOfScope.decline).not.toBeNull();
    expect(start.outOfScope.decline).toContain('used');
    expect(start.total).toBe(0);
  });

  it('surfaces a collision when the new selector already exists on the class', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `csig-collide-${BASE}`;

    const start = parseStartPreview(
      await startChangeSignaturePreview(
        asyncExec,
        BASE,
        'csigMoveX:y:',
        ['csigExisting:', 'q:'],
        [1, 2],
        ['', ''],
        ['', ''],
        WHOLE,
        token,
        PREVIEW_PAGE_BYTES,
        false,
      ),
    );

    expect(start.outOfScope.collision).not.toBeNull();
    expect(start.outOfScope.collision).toContain('csigExisting:q:');
  });

  it('leaves a deselected sender untouched while renaming the implementor', async (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    defineFixture();
    const token = `csig-deselect-${BASE}`;

    const start = parseStartPreview(
      await startChangeSignaturePreview(
        asyncExec,
        BASE,
        'csigStore:',
        ['csigStore:', 'put:'],
        [1, 0],
        ['k', 'v'],
        ['', 'nil'],
        WHOLE,
        token,
        PREVIEW_PAGE_BYTES,
        false,
      ),
    );
    const sender = start.page.changes.find(
      (c) => c.kind === 'methodRecompile' && c.selector === 'csigCallStore',
    );
    expect(sender).toBeDefined();

    const result = parseApplyResult(await applyChangeSignature(asyncExec, token, [sender!.id]));

    expect(result.failed).toEqual([]);
    expect(definesSelector('csigStore:put:')).toBe(true);
    const callStore = storedSource('csigCallStore');
    expect(callStore).toContain('csigStore: 1');
    expect(callStore).not.toContain('put:');
  });
});
