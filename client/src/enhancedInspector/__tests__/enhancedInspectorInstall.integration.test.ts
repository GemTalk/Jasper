import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';
import { gsStringLiteral } from '../../serverPlugin/installHelpers';
import { ENHANCED_INSPECTOR_FILE_IN_CLASS } from '../enhancedInspectorInstall';

/**
 * Integration tests for what the Enhanced Inspector install leaves on the stone, over the
 * real GCI transport. They run on the plugin-installed pass, against the payload the CI
 * provisioning step installed, and skip below 3.7.5.
 *
 * The compile rule is exercised by calling the installed file-in class's
 * `compileChunk:into:` on a throwaway class in `UserGlobals`, since the test user cannot
 * write kernel classes. The harness aborts after every test, which removes the class again.
 */
describe('enhanced inspector install (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });
  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);

  const KEPT_DIFFERENT = '#JasperEnhancedInspectorKeptDifferent';

  /**
   * Give a scratch class `probe` (source `existingSource`, category `existingCategory`),
   * then compile `payloadSource` over it the way the installer does. Answers what `probe`
   * returns afterwards and whether the method was recorded as kept-though-different.
   */
  function compileOverExisting(
    existingCategory: string,
    existingSource: string,
    payloadSource: string,
  ): { answer: string; recorded: boolean } {
    const out = exec(`
| cls fi answer recorded |
SessionTemps current removeKey: ${KEPT_DIFFERENT} ifAbsent: [nil].
cls := Object subclass: 'JasperEnhancedInspectorRuleProbe'
	instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
	inDictionary: UserGlobals options: #().
cls compileMethod: ${gsStringLiteral(existingSource)}
	dictionaries: System myUserProfile symbolList category: ${gsStringLiteral(existingCategory)}.
fi := ${ENHANCED_INSPECTOR_FILE_IN_CLASS} new.
fi currentCategory: '*ston-probe'.
fi compileChunk: ${gsStringLiteral(payloadSource)} into: cls.
answer := cls new probe asString.
recorded := (SessionTemps current at: ${KEPT_DIFFERENT} ifAbsent: [#()])
	includes: 'JasperEnhancedInspectorRuleProbe>>probe'.
SessionTemps current removeKey: ${KEPT_DIFFERENT} ifAbsent: [nil].
answer, ' ', recorded printString`).trim();
    const [answer, recorded] = out.split(' ');
    return { answer, recorded: recorded === 'true' };
  }

  // A base stone has its own STONFileReference; with the payload's dictionary last during
  // the file-in, these two class methods landed on that class instead of ours.
  it("puts STONFileReference's class methods on the payload's own class", (ctx) => {
    requireServerPluginFeature(pluginFeatures.enhancedInspector, ctx, session());

    const onOurs = exec(
      '| ours | ours := GsEnhancedInspector at: #STONFileReference. ' +
        '((ours class includesSelector: #fromSton:) ' +
        'and: [ours class includesSelector: #stonName]) printString',
    ).trim();

    expect(onOurs).toBe('true');
  });

  // The installer moves the dictionary to the front of SystemUser's symbol list for the
  // file-in; it must be back behind Globals, where it cannot shadow a kernel class.
  it("leaves GsEnhancedInspector behind Globals in the installing user's symbol list", (ctx) => {
    requireServerPluginFeature(pluginFeatures.enhancedInspector, ctx, session());

    const behind = exec(
      "| list names | list := (AllUsers userWithId: 'SystemUser') symbolList. " +
        'names := (1 to: list size) collect: [:i | (list at: i) name]. ' +
        '((names indexOf: #GsEnhancedInspector) > (names indexOf: #Globals)) printString',
    ).trim();

    expect(behind).toBe('true');
  });

  it("keeps the stone's own method, and records it when the payload's source differs", (ctx) => {
    requireServerPluginFeature(pluginFeatures.enhancedInspector, ctx, session());

    expect(compileOverExisting('stone-own', 'probe ^#stone', 'probe ^#payload')).toEqual({
      answer: 'stone',
      recorded: true,
    });
  });

  it("keeps the stone's own method without recording it when the source matches", (ctx) => {
    requireServerPluginFeature(pluginFeatures.enhancedInspector, ctx, session());

    expect(compileOverExisting('stone-own', 'probe ^#stone', 'probe ^#stone')).toEqual({
      answer: 'stone',
      recorded: false,
    });
  });

  // A `*GToolkit…` method on a class the payload did not create is one a previous install
  // put there, so a re-install must replace it rather than keep the old copy.
  it('replaces a method an earlier install put there', (ctx) => {
    requireServerPluginFeature(pluginFeatures.enhancedInspector, ctx, session());

    expect(
      compileOverExisting('*GToolkit-Probe', 'probe ^#earlierPayload', 'probe ^#payload'),
    ).toEqual({ answer: 'payload', recorded: false });
  });
});
