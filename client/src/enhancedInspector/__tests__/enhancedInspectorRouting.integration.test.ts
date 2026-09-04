import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import * as debug from '../../debugQueries';
import * as bi from '../../basicInspector/queries/basicInspectorQueries';
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
 * to the basic tabbed Inspector. Both halves run real Smalltalk against the
 * image, over the real GCI transport (not a mock) — the recent "blank enhanced
 * inspector" episode was invisible to unit tests that only string-match generated
 * code and mock the availability flag.
 *
 * The fallback half matters twice over: it is the only place the basic
 * inspector's doits meet a real stone, and the stone it meets is the oldest one
 * supported. Those doits are written to need no server-side support and to
 * survive 3.6.x's Unicode literal rules, and only running them proves it.
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

  const exec = () => (code: string) => q.executeFetchString(session(), code);

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

  // Degradation assertions: when the enhanced inspector is absent, every Inspect
  // It falls back to the basic tabbed Inspector, whose every tab is built from
  // the doits below. `Globals` is a live SymbolDictionary present on every
  // stone, so it is a stable fixture for the dictionary path.
  it('the fallback inspector reads a live dictionary through the real queries', (ctx) => {
    requireServerPluginFeatureAbsent(pluginFeatures.enhancedInspector, ctx, session());

    const globalsOop = gci.resolveSymbol(handle, 'Globals');
    const header = bi.fetchObjectHeader(exec(), globalsOop);

    expect(header).not.toBeNull();
    expect(header!.className).toBe('SymbolDictionary');
    expect(header!.isDictionary).toBe(true);
    expect(header!.entryCount).toBeGreaterThan(0);
    expect(header!.printString.length).toBeGreaterThan(0);

    // A row's label is the key's printString, so a Symbol key arrives quoted —
    // `#'Array'` on 3.6.2. Strip the syntax to assert on the name itself.
    const keys = bi
      .fetchEntries(exec(), globalsOop, 1, header!.entryCount)
      .map((row) => row.label.replace(/^#/, '').replace(/^'(.*)'$/, '$1'));
    expect(keys).toContain('Array');
    expect(keys).toContain('String');
  });

  it('the fallback inspector reads indexed items as elements, not raw slots', (ctx) => {
    requireServerPluginFeatureAbsent(pluginFeatures.enhancedInspector, ctx, session());

    // SmallIntegers, deliberately: a string literal in a GCI-compiled doit is a
    // Unicode7 on 3.6.x, which would make the expected class name depend on the
    // stone's version rather than on anything this query does.
    const arrayOop = gci.execute(handle, '#(10 20 30)');
    const header = bi.fetchObjectHeader(exec(), arrayOop);

    expect(header!.className).toBe('Array');
    expect(header!.isDictionary).toBe(false);
    expect(header!.itemCount).toBe(3);

    const items = bi.fetchItems(exec(), arrayOop, 1, 10);
    expect(items.map((row) => row.label)).toEqual(['[1]', '[2]', '[3]']);
    expect(items.map((row) => row.value)).toEqual(['10', '20', '30']);
    expect(items.map((row) => row.className)).toEqual([
      'SmallInteger',
      'SmallInteger',
      'SmallInteger',
    ]);
    // Every row carries a usable OOP and write index — what drill-in and the
    // slot editor both need.
    expect(items.every((row) => BigInt(row.oop) > 0n)).toBe(true);
    expect(items.map((row) => row.index)).toEqual([1, 2, 3]);
  });

  it('the fallback inspector reads named slots on an object that has them', (ctx) => {
    requireServerPluginFeatureAbsent(pluginFeatures.enhancedInspector, ctx, session());

    // A class object always has named instance variables (Behavior's), so it is
    // a fixture the Slots path can rely on without defining anything.
    const slots = bi.fetchSlots(exec(), gci.resolveSymbol(handle, 'Array'));

    expect(slots.length).toBeGreaterThan(0);
    expect(slots.map((row) => row.index)).toEqual(slots.map((_, i) => i + 1));
    expect(slots.every((row) => row.label.length > 0)).toBe(true);
  });

  it('the fallback inspector reads class metadata without any server support', (ctx) => {
    requireServerPluginFeatureAbsent(pluginFeatures.enhancedInspector, ctx, session());

    const meta = bi.fetchObjectMeta(exec(), gci.execute(handle, 'Array new: 3'));

    expect(meta).not.toBeNull();
    expect(meta!.className).toBe('Array');
    expect(meta!.definition.length).toBeGreaterThan(0);
    expect(meta!.instanceSelectors.length).toBeGreaterThan(0);
  });

  it('the fallback inspector reads bytes as numbers', (ctx) => {
    requireServerPluginFeatureAbsent(pluginFeatures.enhancedInspector, ctx, session());

    // Numbers, not text: an unprintable byte cannot corrupt the payload the way
    // an escaped-text round trip could.
    const bytesOop = gci.execute(handle, '#[104 101 108 108 111]');

    expect(bi.fetchObjectHeader(exec(), bytesOop)!.isBytes).toBe(true);
    expect(bi.fetchBytes(exec(), bytesOop, 1, 16)).toEqual([104, 101, 108, 108, 111]);
  });

  it('the fallback inspector evaluates an expression with the object bound to self', (ctx) => {
    requireServerPluginFeatureAbsent(pluginFeatures.enhancedInspector, ctx, session());

    const resultOop = debug.evaluateWithReceiverToOop(
      session(),
      gci.execute(handle, '#(10 20 30)'),
      'self size + 1',
    );

    expect(debug.getObjectPrintString(session(), resultOop, 64)).toBe('4');
  });
});
