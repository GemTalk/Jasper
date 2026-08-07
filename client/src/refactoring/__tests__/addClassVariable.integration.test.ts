import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';

/**
 * Automatic GCI integration test for Add Class Variable, over the real GCI
 * transport. Unlike Add Instance Variable this needs no refactoring engine
 * (`addClassVarName:` is a base-image method) and no gate — so it runs in both CI
 * passes. Confirms the crown-jewel claim that made it "lightweight": adding a class
 * variable adds the shared binding WITHOUT reshaping the class — no new class
 * version, existing instances stay current — and the new variable is visible to
 * subclasses. Fully transient: the harness aborts each test.
 */
describe('add class variable (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code);

  const dictIndexOf = (name: string): number =>
    parseInt(
      exec(
        `| sl d | sl := System myUserProfile symbolList. ` +
          `d := sl detect: [:x | x name = #'${name}'] ifNone: [nil]. ` +
          `(d ifNil: [0] ifNotNil: [sl indexOf: d]) printString`,
      ),
      10,
    );
  const userIndex = (): number => dictIndexOf('UserGlobals');

  const BASE = 'AcvItBase';
  const SUB = 'AcvItSub';

  const defineFixture = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${BASE}' instVarNames: #(x) classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileClassDefinition(
      session(),
      `${BASE} subclass: '${SUB}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
  };

  it('adds the class variable without reshaping the class (no new version, instance intact)', () => {
    defineFixture();
    // A live instance whose identity must survive: a reshape would re-version the
    // class and it would no longer be an instance of the current class.
    exec(`UserGlobals at: #AcvItInst put: ${BASE} new. true printString`);
    const historyBefore = exec(`${BASE} classHistory size printString`).trim();

    const result = q.addClassVariable(session(), BASE, 'Registry', userIndex());

    expect(result.trim()).toBe('ok');
    expect(exec(`(${BASE} classVarNames includes: #Registry) printString`).trim()).toBe('true');
    expect(exec(`${BASE} classHistory size printString`).trim()).toBe(historyBefore);
    expect(exec(`((UserGlobals at: #AcvItInst) class == ${BASE}) printString`).trim()).toBe('true');
  });

  it('makes the class variable visible to a subclass', () => {
    defineFixture();

    q.addClassVariable(session(), BASE, 'Registry', userIndex());

    expect(q.getVisibleClassVarNames(session(), SUB, userIndex())).toContain('Registry');
    // A class variable is not an instance variable — it must not appear as one.
    expect(q.getInstVarNames(session(), SUB)).not.toContain('Registry');
  });

  it('answers no-class for a name that is not a bound class', () => {
    expect(q.addClassVariable(session(), 'NoSuchClassAcv', 'Registry', userIndex()).trim()).toBe(
      'no-class',
    );
  });
});
