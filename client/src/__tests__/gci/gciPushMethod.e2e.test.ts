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
  analyzePushMethod,
  startPushMethodPreview,
  applyPushMethod,
} from '../../refactoring/queries/previewPushMethod';
import { PREVIEW_PAGE_BYTES } from '../../refactoring/queries/previewRenameMethod';
import {
  parseAnalysis,
  parseStartPreview,
  parseApplyResult,
} from '../../refactoring/pushMethodPreview';

/**
 * On-demand GCI end-to-end test (`npm run test:gci`) for the push-up / push-down method
 * refactorings (M7 / M8). Drives the real query builders + parsers against a live stone
 * over the GCI transport, then rolls everything back.
 *
 * GUARDED on the engine being loaded: on a bare stone (no GsPushUpMethodRefactoring) each
 * test skips with a reason. Fully transient — every test aborts the transaction in a
 * `finally`, so the fixture classes and the applied changes never commit.
 */
describe('push method up/down (gci e2e)', () => {
  let gci: GciLibrary;
  let session: ActiveSession;
  let enginePresent = false;

  const exec = (code: string): string => q.executeFetchString(session, code);
  const asyncExec = (_label: string, code: string): Promise<string> => Promise.resolve(exec(code));

  const BASE = 'PumE2eBase';
  const SUBA = 'PumE2eA';
  const SUBB = 'PumE2eB';

  const defineFixture = (): void => {
    q.compileClassDefinition(
      session,
      `Object subclass: '${BASE}' instVarNames: #('state') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session,
      `${BASE} subclass: '${SUBA}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session,
      `${BASE} subclass: '${SUBB}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session, BASE, false, 'accessing', 'pumDown\n\t^100');
    q.compileMethod(session, SUBA, false, 'accessing', 'pumUpPure\n\t^7');
    // Collision: both the superclass and subclass A define pumCollide -> push-up overwrite.
    q.compileMethod(session, BASE, false, 'accessing', "pumCollide\n\t^'base'");
    q.compileMethod(session, SUBA, false, 'accessing', "pumCollide\n\t^'suba'");
  };

  const definesSelector = (cls: string, selector: string): boolean =>
    exec(
      `(${cls} compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) notNil printString`,
    ).trim() === 'true';

  const sourceOf = (cls: string, selector: string): string =>
    exec(
      `(${cls} compiledMethodAt: #'${selector}' environmentId: 0 otherwise: nil) ` +
        "ifNil: [''] ifNotNil: [:m | m sourceString]",
    );

  const abort = (): void => {
    // Evaluate to a String: executeFetchString sends #encodeAsUTF8 to the result, which
    // the System class (the value of `System abortTransaction`) does not understand.
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
        '(System myUserProfile symbolList objectNamed: #GsPushUpMethodRefactoring) notNil printString',
      ).trim() === 'true';
  });

  afterAll(() => {
    if (session?.handle) gci.GciTsLogout(session.handle);
    gci?.close();
  });

  it('pushes a pure method up to its superclass, then rolls back', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();
      const analysis = parseAnalysis(
        await analyzePushMethod(asyncExec, 'up', SUBA, ['pumUpPure'], false),
      );
      expect(analysis.targetClass).toBe(BASE);

      const token = `pum-e2e-up`;
      parseStartPreview(
        await startPushMethodPreview(
          asyncExec,
          'up',
          SUBA,
          ['pumUpPure'],
          false,
          token,
          PREVIEW_PAGE_BYTES,
        ),
      );
      const result = parseApplyResult(await applyPushMethod(asyncExec, 'up', token, []));

      expect(result.failed).toEqual([]);
      expect(definesSelector(BASE, 'pumUpPure')).toBe(true);
      expect(definesSelector(SUBA, 'pumUpPure')).toBe(false);
    } finally {
      abort();
    }
  });

  it('pushes up onto a colliding superclass as an opt-in overwrite, then rolls back', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();
      const analysis = parseAnalysis(
        await analyzePushMethod(asyncExec, 'up', SUBA, ['pumCollide'], false),
      );
      expect(analysis.selectors[0].decline).toBeNull();
      expect(analysis.selectors[0].warning).not.toBeNull();

      const token = `pum-e2e-up-collide`;
      const start = parseStartPreview(
        await startPushMethodPreview(
          asyncExec,
          'up',
          SUBA,
          ['pumCollide'],
          false,
          token,
          PREVIEW_PAGE_BYTES,
        ),
      );
      const add = start.page.changes.find((c) => c.kind === 'methodAdd');
      expect(add?.oldSource).toContain('base');
      const result = parseApplyResult(await applyPushMethod(asyncExec, 'up', token, []));

      expect(result.failed).toEqual([]);
      expect(sourceOf(BASE, 'pumCollide')).toContain('suba');
      expect(definesSelector(SUBA, 'pumCollide')).toBe(false);
    } finally {
      abort();
    }
  });

  it('pushes a method down into every subclass, then rolls back', async (ctx) => {
    if (!enginePresent) return ctx.skip();

    try {
      defineFixture();
      const token = `pum-e2e-down`;
      const start = parseStartPreview(
        await startPushMethodPreview(
          asyncExec,
          'down',
          BASE,
          ['pumDown'],
          false,
          token,
          PREVIEW_PAGE_BYTES,
        ),
      );
      expect(start.total).toBe(3);
      const result = parseApplyResult(await applyPushMethod(asyncExec, 'down', token, []));

      expect(result.failed).toEqual([]);
      expect(definesSelector(SUBA, 'pumDown')).toBe(true);
      expect(definesSelector(SUBB, 'pumDown')).toBe(true);
      expect(definesSelector(BASE, 'pumDown')).toBe(false);
    } finally {
      abort();
    }
  });
});
