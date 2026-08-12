import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';

/**
 * Integration test for the Enhanced Inspector uninstall, over the real GCI transport.
 *
 * The support's payload classes are now isolated in the dedicated `GsEnhancedInspector`
 * symbol dictionary (the rework that lets the whole payload be removed by dropping one
 * dictionary, instead of hunting GToolkit classes out of the shared `Published`). This
 * verifies both halves against a live stone: the payload really lives in
 * `GsEnhancedInspector`, and detaching that dictionary from the session user's symbol
 * list flips the availability probe to false.
 *
 * Fully transient — the harness aborts after every test, so nothing is committed and the
 * support is left intact for the following tests. The detach is scoped to the session
 * user's own symbol list (not the SystemUser-only AllUsers loop / GToolkit kernel-method
 * removal, which the unit tests cover). Gated on the plugin-installed pass; also skips
 * below 3.7.5, where the Enhanced Inspector is not applicable.
 */
describe('enhanced inspector uninstall (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });
  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);

  // Remove GsEnhancedInspector from THIS user's symbol list — the per-user step the
  // uninstall performs for every user.
  const detachGsEnhancedInspector = `
| prof list idx |
prof := System myUserProfile.
list := prof symbolList.
idx := (1 to: list size) detect: [:i | (list at: i) name == #GsEnhancedInspector] ifNone: [nil].
idx notNil ifTrue: [ prof removeDictionaryAt: idx ].
'ok'`;

  it('files the payload classes into the dedicated GsEnhancedInspector dictionary', (ctx) => {
    requireServerPluginFeature(pluginFeatures.enhancedInspector, ctx, session());

    const dict = exec(
      '(System myUserProfile symbolList dictionaryAndSymbolOf: ' +
        "(System myUserProfile symbolList objectNamed: 'GtRemotePhlowViewedObject')) " +
        "ifNil: ['none'] ifNotNil: [:da | (da at: 1) name]",
    ).trim();

    expect(dict).toBe('GsEnhancedInspector');
  });

  it('flips the availability probe to false when GsEnhancedInspector leaves the symbol list', (ctx) => {
    requireServerPluginFeature(pluginFeatures.enhancedInspector, ctx, session());
    expect(q.checkEnhancedInspectorAvailable(session())).toBe(true);

    exec(detachGsEnhancedInspector);

    expect(q.checkEnhancedInspectorAvailable(session())).toBe(false);
    // Never committed — the harness aborts, restoring the support for later tests.
  });
});
