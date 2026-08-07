// Integration test for getMethodInstVarAccess against a live stone. Confirms the
// synthesized Smalltalk actually runs and that GsNMethod>>instVarsRead /
// instVarsWritten report reader / writer / both / neither correctly — over the
// whole release matrix (3.6.2 and 3.7.5). No server plugin needed: this is
// base-image reflection, so it runs in both the bare and plugin CI passes.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';

describe('getMethodInstVarAccess (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;

  const CLS = 'IvarAccessDemo';

  // A transient fixture (rolled back by the harness's abort) with one method per
  // access shape. Selector spellings are unique to the fixture.
  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${CLS}' instVarNames: #( count name ) classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    const m = (src: string): void => {
      q.compileMethod(session(), CLS, false, 'accessing', src);
    };
    m('ivaCount\n\t^count'); // reads count
    m('ivaSetCount: aValue\n\tcount := aValue'); // writes count
    m('ivaBump\n\tcount := count + 1'); // reads + writes count
    m("ivaGreeting\n\t^'hi'"); // touches no ivar
  };

  const dictIndex = (): number => q.getDictionaryNames(session()).indexOf('UserGlobals') + 1;

  it('reports each method reader / writer / both / neither', () => {
    defineFixture();

    const rows = q.getMethodInstVarAccess(session(), dictIndex(), CLS, 0);
    const by = (selector: string) => rows.find((r) => !r.isMeta && r.selector === selector);

    expect(by('ivaCount')).toMatchObject({ reads: ['count'], writes: [] });
    expect(by('ivaSetCount:')).toMatchObject({ reads: [], writes: ['count'] });
    expect(by('ivaBump')).toMatchObject({ reads: ['count'], writes: ['count'] });
    // A method that touches no instance variable is omitted entirely.
    expect(by('ivaGreeting')).toBeUndefined();
  });
});
