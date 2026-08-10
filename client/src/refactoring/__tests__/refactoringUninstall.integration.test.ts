import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { requireServerPluginFeature } from '../../__tests__/requireServerPluginFeature';
import { pluginFeatures } from '../../serverPlugin/pluginFeatures';

/**
 * Integration test for the refactoring-engine uninstall, over the real GCI transport.
 *
 * The engine is isolated in the dedicated `GsRefactoring` symbol dictionary; the
 * uninstall removes that dictionary from every user's symbol list. This exercises the
 * core, per-user observable of that removal against a live stone: with the engine
 * installed, detaching `GsRefactoring` from the session user's symbol list makes the
 * engine classes unresolvable and flips the availability probe to false.
 *
 * Fully transient — the harness aborts after every test, so nothing is committed and the
 * engine is left intact for the following tests. The detach is scoped to the session
 * user's own symbol list (not the SystemUser-only AllUsers loop / kernel-method removal,
 * which the unit tests cover) precisely so it needs no elevation and cannot persist.
 * Gated on the plugin-installed pass; skips on a bare stone.
 */
describe('refactoring engine uninstall (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });
  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);

  // Remove GsRefactoring from THIS user's symbol list — the per-user step the uninstall
  // performs for every user. ASCII-only for 3.6.x.
  const detachGsRefactoring = `
| prof list idx |
prof := System myUserProfile.
list := prof symbolList.
idx := (1 to: list size) detect: [:i | (list at: i) name == #GsRefactoring] ifNone: [nil].
idx notNil ifTrue: [ prof removeDictionaryAt: idx ].
'ok'`;

  it('isolates the engine classes in the dedicated GsRefactoring dictionary', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());

    const dict = exec(
      '(System myUserProfile symbolList dictionaryAndSymbolOf: ' +
        "(System myUserProfile symbolList objectNamed: 'GsRenameInstanceVariableRefactoring')) " +
        "ifNil: ['none'] ifNotNil: [:da | (da at: 1) name]",
    ).trim();

    expect(dict).toBe('GsRefactoring');
  });

  it('flips the availability probe to false when GsRefactoring leaves the symbol list', (ctx) => {
    requireServerPluginFeature(pluginFeatures.refactoring, ctx, session());
    expect(q.checkRefactoringSupportAvailable(session())).toBe(true);

    exec(detachGsRefactoring);

    expect(q.checkRefactoringSupportAvailable(session())).toBe(false);
    // Never committed — the harness aborts, restoring the engine for later tests.
  });
});
