import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { GciLibrary } from '../../gciLibrary';
import type { ActiveSession } from '../../sessionManager';
import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { testActiveSession } from '../../__tests__/testActiveSession';
import {
  fetchFullPrintString,
  FULL_PRINT_STRING_MAX_CHARS,
  type FullPrintString,
} from '../debugQueries';
import { executeFetchString } from '../../browserQueries';
import { fetchEnhancedInspectorPrintTabData } from '../../enhancedInspector/queries/getEnhancedInspectorViewSpecs';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';

/**
 * The inspectors' full print against a real stone. The unit suite only checks
 * the Smalltalk as text; what can go wrong is in how GemStone's `PrintStream`
 * behaves at its limit: when it reports itself full, whether a collection's
 * `printOn:` honours it, and what a print that raises leaves behind.
 *
 * The Enhanced Inspector's Print tab makes the same kind of capped print to
 * decide whether to offer "Show all…"; its tests run only where that inspector's
 * server support is installed.
 *
 * The objects printed are put in UserGlobals inside the harness transaction and
 * never committed.
 */
describe('full print of an object (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);

  /** The print, failing the test if the fetch answered an error instead. */
  const printOf = async (oop: bigint, maxChars?: number): Promise<FullPrintString> => {
    const result = await fetchFullPrintString(session(), oop, maxChars);
    if ('error' in result) throw new Error(`print failed: ${result.error}`);
    return result;
  };

  /** Evaluate `expr`, keep the result reachable, and answer its oop. */
  const oopOf = (expr: string): bigint =>
    BigInt(
      gci.executeAndFetchString(
        handle,
        `| o | o := ${expr}.
UserGlobals at: #JasperFullPrintTest put: o.
o asOop printString`,
      ),
    );

  it('answers a small print whole', async () => {
    const result = await printOf(oopOf("'abc'"));

    expect(result).toEqual({ text: "'abc'", cutShortAt: 0 });
  });

  it('answers a print of exactly the cap whole', async () => {
    // 'abc' prints as five characters, quotes included.
    const result = await printOf(oopOf("'abc'"), 5);

    expect(result).toEqual({ text: "'abc'", cutShortAt: 0 });
  });

  it('cuts a print one character past the cap short', async () => {
    const result = await printOf(oopOf("'abc'"), 4);

    expect(result.cutShortAt).toBe(4);
    expect(result.text.startsWith("'abc")).toBe(true);
  });

  it('cuts a large collection short near the cap', async () => {
    // 200 is below the ~700 characters at which 3.6.2's collections stop on their own.
    const result = await printOf(oopOf('(1 to: 5000) asArray'), 200);

    expect(result.cutShortAt).toBe(200);
    expect(result.text.startsWith('anArray( 1, 2, 3')).toBe(true);
    // GemStone appends its own ellipsis after the cap.
    expect(result.text.length).toBeGreaterThan(200);
    expect(result.text.length).toBeLessThan(220);
  });

  it('stops a print larger than the default cap at the cap', async () => {
    const big = FULL_PRINT_STRING_MAX_CHARS + 200_000;
    const result = await printOf(oopOf(`(String new: ${big}) atAllPut: $a; yourself`));

    expect(result.cutShortAt).toBe(FULL_PRINT_STRING_MAX_CHARS);
    expect(result.text.length).toBeGreaterThan(FULL_PRINT_STRING_MAX_CHARS);
    expect(result.text.length).toBeLessThan(FULL_PRINT_STRING_MAX_CHARS + 20);
  }, 30_000);

  it('keeps characters outside ASCII intact', async () => {
    const result = await printOf(
      oopOf(
        `'caf' , (String with: (Character codePoint: 233)) , (String with: (Character codePoint: 16r263A))`,
      ),
    );

    expect(result).toEqual({ text: "'café☺'", cutShortAt: 0 });
  });

  it('answers a print that raises as an error, and the session stays usable', async () => {
    gci.executeAndFetchString(
      handle,
      `| cls |
cls := Object subclass: 'JasperFullPrintBroken'
  instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
  inDictionary: UserGlobals.
cls compileMethod: 'printOn: aStream self error: ''cannot print me'''
  dictionaries: System myUserProfile symbolList category: 'jasper-test'.
'ok'`,
    );

    const result = await fetchFullPrintString(session(), oopOf('JasperFullPrintBroken new'));

    expect(result).toEqual({ error: expect.stringMatching(/cannot print me/) });
    expect(gci.executeAndFetchString(handle, '(3 + 4) printString')).toBe('7');
  });

  /** The Enhanced Inspector Print tab's flag that offers "Show all…". */
  const printTabOffersShowAll = (oop: bigint): boolean =>
    fetchEnhancedInspectorPrintTabData(
      (code) => executeFetchString(session(), code),
      oop,
      'gtPrintFor:',
    ).truncated;

  it('offers Show all on the Print tab when the print runs past its text', (ctx) => {
    requireServerPluginFeature(pluginFeatures.enhancedInspector, ctx, session());

    expect(printTabOffersShowAll(oopOf('(1 to: 5000) asArray'))).toBe(true);
  });

  it('offers no Show all on the Print tab when its text is the whole print', (ctx) => {
    requireServerPluginFeature(pluginFeatures.enhancedInspector, ctx, session());

    expect(printTabOffersShowAll(oopOf("'abc'"))).toBe(false);
  });
});
