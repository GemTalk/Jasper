import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import * as debug from '../../debugQueries';
import { isEnhancedInspectorInstalled } from '../enhancedInspectorInstall';
import { refreshEnhancedInspectorAvailable } from '../enhancedInspectorAvailability';
import type { ActiveSession } from '../../sessionManager';
import {
  requireServerPluginFeature,
  requireServerPluginFeatureAbsent,
} from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';

/**
 * Integration tests for the unified "Inspect It" routing: it opens the Enhanced
 * Inspector when the session reports it as available, and otherwise falls back
 * to the classic Inspector tree view. Both halves run real Smalltalk against the
 * image, over the real GCI transport (not a mock) — the recent "blank enhanced
 * inspector" episode was invisible to unit tests that only string-match generated
 * code and mock the availability flag.
 *
 * Gated on the shared plugin-feature registry (`requireServerPluginFeature`/
 * `requireServerPluginFeatureAbsent`), so the present-world assertions run only
 * once the CI matrix installs the plugin, and the absent-world (fallback)
 * assertions run only on a bare stone or an unsupported version.
 */
describe('inspect it routing (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession =>
    ({ id: 1, gci, handle, stoneVersion: gci.GciTsVersion().version }) as unknown as ActiveSession;

  // The routing flag is set from the LIGHTWEIGHT probe (marker class only), but a
  // usable Enhanced Inspector also needs the Object>>gtViewsInCurrentContext
  // extension (the DEEP check). If the lightweight probe ever reports available
  // while the deep check does not — a partial install — Inspect It opens a blank
  // enhanced panel instead of falling back to the tree. On any healthy image the
  // two agree (both true when fully installed, both false when absent); this
  // guards the exact gap the blank-tab episode exposed.
  it('the availability probe and the deep install check agree', () => {
    const available = q.checkEnhancedInspectorAvailable(session());
    const installed = isEnhancedInspectorInstalled(session());

    expect(available).toBe(installed);
  });

  it('routes to the enhanced inspector once the feature is installed on a supported version', (ctx) => {
    requireServerPluginFeature(pluginFeatures.enhancedInspector, ctx, session());

    expect(refreshEnhancedInspectorAvailable(session())).toBe(true);
  });

  // Degradation assertion: on a bare stone, or a version too old for the Enhanced
  // Inspector, routing must fall back rather than ever answer true.
  it('never routes to the enhanced inspector when the feature is absent', (ctx) => {
    requireServerPluginFeatureAbsent(pluginFeatures.enhancedInspector, ctx, session());

    expect(refreshEnhancedInspectorAvailable(session())).toBe(false);
  });

  // Degradation assertion: when the enhanced inspector is absent, every Inspect
  // It falls back to the classic tree view, which reads an object's structure
  // through these debug queries. `Globals` is a live SymbolDictionary present on
  // every stone, so it is a stable fixture for the dictionary branch the tree
  // provider uses.
  it('the classic-inspector fallback reads a live object through the real queries', (ctx) => {
    requireServerPluginFeatureAbsent(pluginFeatures.enhancedInspector, ctx, session());

    const globalsOop = gci.resolveSymbol(handle, 'Globals');

    expect(debug.getObjectClassName(session(), globalsOop)).toBe('SymbolDictionary');
    expect(debug.getObjectPrintString(session(), globalsOop, 1024).length).toBeGreaterThan(0);

    const keys = debug.getDictionaryEntries(session(), globalsOop).map((e) => e.key);
    expect(keys).toContain('Array');
    expect(keys).toContain('String');
  });
});
