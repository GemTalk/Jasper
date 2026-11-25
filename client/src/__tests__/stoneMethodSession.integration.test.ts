// A method editor belongs to the session it was opened from, which need not be the active one.
// Only two real sessions can show which one a hover or a completion asked: each sees what the
// other has compiled but not committed only if it asked the right one.
import { describe, it, expect, onTestFinished, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { MarkdownString, Position, Uri, __setConfig, __resetConfig } from '../__mocks__/vscode';
import type * as vscode from 'vscode';
import * as q from '../browserQueries';
import type { ActiveSession } from '../activeSession';
import { SessionManager } from '../sessionManager';
import { GemStoneHoverProvider } from '../gemstoneHoverProvider';
import { GemStoneCompletionProvider } from '../gemstoneCompletionProvider';
import { testActiveSession } from './testActiveSession';
import { useIntegrationTest } from './useIntegrationTest';
import { reportingLoginsOf } from './sessionGateClient';

const CLS = 'StoneMethodSessionDemo';

describe('a method editor whose session is not the active one (integration)', () => {
  let harness: ActiveSession;
  useIntegrationTest(
    (testContext) => {
      harness = testActiveSession(testContext.gciLibrary, testContext.session);
    },
    { sessions: 3 },
  );

  // Two sessions of a SessionManager: `other` has CLS and its methods, compiled and never
  // committed, so `active` can't see them. `active` is the active session.
  function activeAndOther() {
    __setConfig('gemstone', 'sessionMode', 'multiple');
    onTestFinished(() => __resetConfig());
    const manager = reportingLoginsOf(new SessionManager());
    const libraryPath = process.env.VITE_GEMSTONE_GCI_LIBRARY_PATH!;
    const active = manager.login(harness.login, libraryPath);
    const other = manager.login(harness.login, libraryPath);
    onTestFinished(async () => {
      await manager.logout(other.id);
      await manager.logout(active.id);
    });
    q.compileClassDefinition(
      other,
      `Object subclass: '${CLS}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(other, CLS, false, 'demo', 'onlyInOther\n\t^1');
    q.compileMethod(other, CLS, false, 'demo', 'callsIt\n\t^self onlyInOther');
    manager.selectSession(active.id);
    return { manager, active, other };
  }

  const methodOf = (session: ActiveSession, className: string, selector: string) =>
    ({
      uri: Uri.parse(`gemstone://${session.id}/UserGlobals/${className}/instance/demo/${selector}`),
    }) as unknown as vscode.TextDocument;

  it('counts senders and implementors in the session the method was opened from', async () => {
    const { manager, active, other } = activeAndOther();
    expect(manager.getSelectedSession()?.id).toBe(active.id);
    const provider = new GemStoneHoverProvider(manager, {
      getSelector: async () => 'onlyInOther',
    });

    const hover = await provider.provideHover(
      methodOf(other, CLS, 'callsIt'),
      new Position(1, 8) as unknown as vscode.Position,
    );

    const md = hover?.contents as unknown as MarkdownString | undefined;
    expect(md?.value).toContain('1 sender]');
    expect(md?.value).toContain('1 implementor]');
  }, 30_000);

  it('offers the classes of the session the method was opened from', async () => {
    const { manager, active, other } = activeAndOther();
    const provider = new GemStoneCompletionProvider(manager);
    onTestFinished(() => provider.dispose());
    const labels = (doc: vscode.TextDocument) =>
      provider.provideCompletionItems(doc).map((item) => item.label);

    expect(labels(methodOf(other, CLS, 'callsIt'))).toContain(CLS);
    expect(labels(methodOf(active, 'Object', 'printString'))).not.toContain(CLS);
  }, 30_000);
});
