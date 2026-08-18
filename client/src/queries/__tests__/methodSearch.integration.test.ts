// Integration test for the Literals-scope symbol search (`literalSymbolReferences`) against a live
// stone, over the release matrix (3.6.2 and 3.7.5). Base-image reflection only — no server plugin —
// so it runs in both the bare and plugin CI passes.
//
// Regression guard for Omni Search triage #9: searching the Literals scope for a *symbol* returned
// methods that only SEND the selector, never using it as a data literal — so their source doesn't
// contain the symbol at all. The reproduction case is `#not`: `ClassOrganizer sendersOf: #not`
// reports 0 senders while `referencesToLiteral: #not` reports hundreds (the selector still sits in
// each method's literal frame), so the "literal refs MINUS senders" heuristic subtracted nothing and
// every `x not` method leaked in as a bogus literal hit.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { defaultQueryExecutorUsing } from '../../browserQueries';
import { literalSymbolReferences } from '../methodSearch';
import type { ActiveSession } from '../../sessionManager';

describe('literalSymbolReferences (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;

  const CLS = 'Issue9SymbolLiteralDemo';

  // A transient fixture (rolled back by the harness's abort). One method uses `#not` as a genuine
  // DATA literal; the other only SENDS `not`. Selector spellings are unique to the fixture.
  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${CLS}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    const m = (src: string): void => {
      q.compileMethod(session(), CLS, false, 'accessing', src);
    };
    m('usesNotAsLiteral\n\t^Array with: #not'); // #not is a data literal — source contains "#not"
    m('onlySendsNot: aFlag\n\t^aFlag not'); // sends not to a variable — source has "not", never "#not"
  };

  it('returns methods that use the symbol as a data literal, not ones that merely send it', () => {
    defineFixture();

    const rows = literalSymbolReferences(defaultQueryExecutorUsing(session()), '#not');
    const fixtureRow = (selector: string) =>
      rows.find((r) => r.className === CLS && !r.isMeta && r.selector === selector);

    expect(fixtureRow('usesNotAsLiteral')).toBeDefined();
    expect(fixtureRow('onlySendsNot:')).toBeUndefined();
  });
});
