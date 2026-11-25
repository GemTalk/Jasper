// Find All References against a live stone: the senders come from the stone's own method
// dictionaries, so only a real stone shows they are found and addressed as methods to open.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { Position, Uri } from '../__mocks__/vscode';
import type * as vscode from 'vscode';
import { useIntegrationTest } from './useIntegrationTest';
import { GciLibrary } from '../gciLibrary';
import * as q from '../browserQueries';
import type { ActiveSession, SessionManager } from '../sessionManager';
import { testActiveSession } from './testActiveSession';
import { GemStoneReferenceProvider } from '../gemstoneReferenceProvider';

describe('GemStoneReferenceProvider (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const CLS = 'ReferenceProviderDemo';
  const SELECTOR = 'referenceProviderDemoTarget';

  it('lists the stone’s senders of the selector under the cursor, as methods to open', async () => {
    const session: ActiveSession = testActiveSession(gci, handle);
    // A transient fixture, rolled back by the harness's abort.
    q.compileClassDefinition(
      session,
      `Object subclass: '${CLS}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session, CLS, false, 'accessing', `${SELECTOR}\n\t^1`);
    q.compileMethod(session, CLS, false, 'accessing', `sendsIt\n\t^self ${SELECTOR}`);
    q.compileMethod(
      session,
      CLS,
      true,
      'instance creation',
      `alsoSendsIt\n\t^self new ${SELECTOR}`,
    );
    const sessions = {
      getSelectedSession: () => session,
      getSessions: () => [session],
    } as unknown as SessionManager;
    const provider = new GemStoneReferenceProvider(sessions, {
      getSelector: async () => SELECTOR,
    });
    const document = {
      uri: Uri.parse(`gemstone://${session.id}/UserGlobals/${CLS}/instance/accessing/sendsIt`),
    } as unknown as vscode.TextDocument;

    const found = await provider.provideReferences(
      document,
      new Position(1, 8) as unknown as vscode.Position,
    );

    expect(found.map((l) => decodeURIComponent(l.uri.path)).sort()).toEqual([
      `/UserGlobals/${CLS}/class/instance creation/alsoSendsIt`,
      `/UserGlobals/${CLS}/instance/accessing/sendsIt`,
    ]);
    expect(found.every((l) => l.uri.authority === String(session.id))).toBe(true);
  });

  it('puts each reference at its send, counting lines the way the editor does', async () => {
    const session: ActiveSession = testActiveSession(gci, handle);
    q.compileClassDefinition(
      session,
      `Object subclass: '${CLS}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session, CLS, false, 'accessing', `${SELECTOR}: a with: b\n\t^a`);
    // A CR LF pair is one line break to the editor; a lone CR is one too.
    q.compileMethod(
      session,
      CLS,
      false,
      'accessing',
      `sendsIt\r\n\t| x |\r\tx := 1.\n\t^self ${SELECTOR}: x with: x`,
    );
    const sessions = {
      getSelectedSession: () => session,
      getSessions: () => [session],
    } as unknown as SessionManager;
    const provider = new GemStoneReferenceProvider(sessions, {
      getSelector: async () => `${SELECTOR}:with:`,
    });
    const document = {
      uri: Uri.parse(`gemstone://${session.id}/UserGlobals/${CLS}/instance/accessing/sendsIt`),
    } as unknown as vscode.TextDocument;

    const [found] = await provider.provideReferences(
      document,
      new Position(3, 8) as unknown as vscode.Position,
    );

    expect(found.range.start).toMatchObject({ line: 3, character: 7 });
    expect(found.range.end).toMatchObject({ line: 3, character: 7 + `${SELECTOR}:`.length });
  });

  it('finds the senders of a selector the compiler inlines, at their first use of it', async () => {
    // The stone keeps no send position for an inlined selector, so the reference is placed
    // where the method's source first names it.
    const session: ActiveSession = testActiveSession(gci, handle);
    q.compileClassDefinition(
      session,
      `Object subclass: '${CLS}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(
      session,
      CLS,
      false,
      'accessing',
      'sendsIt\n\t| x |\n\tx := true.\n\t^x ifFalse: [1] ifTrue: [2]',
    );
    const sessions = {
      getSelectedSession: () => session,
      getSessions: () => [session],
    } as unknown as SessionManager;
    const provider = new GemStoneReferenceProvider(sessions, {
      getSelector: async () => 'ifFalse:ifTrue:',
    });
    const document = {
      uri: Uri.parse(`gemstone://${session.id}/UserGlobals/${CLS}/instance/accessing/sendsIt`),
    } as unknown as vscode.TextDocument;

    const found = await provider.provideReferences(
      document,
      new Position(3, 6) as unknown as vscode.Position,
    );

    const ours = found.find((l) => l.uri.path.includes(`/${CLS}/`));
    expect(ours?.range.start).toMatchObject({ line: 3, character: 4 });
    expect(ours?.range.end).toMatchObject({ line: 3, character: 4 + 'ifFalse:'.length });
  });
});
