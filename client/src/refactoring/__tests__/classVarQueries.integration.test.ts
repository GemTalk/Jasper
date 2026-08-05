import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import { getDefinedClassVarNames } from '../queries/getDefinedClassVarNames';
import { getDefinedClassVarCounts } from '../queries/getDefinedClassVarCounts';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';

/**
 * Automatic GCI integration test for the Explorer's class-variable row queries
 * (added for R4): getDefinedClassVarNames and getDefinedClassVarCounts. These
 * build Smalltalk that runs against the stone, so — like the other query
 * integration tests — they catch selector/behavior misfires the pure-string unit
 * tests can't (e.g. classVarNames returning Symbols vs Strings).
 *
 * Ungated: the queries need only a running stone, not the refactoring engine.
 * Fully transient: the harness aborts each test, so nothing is committed.
 */
describe('class-variable Explorer queries (integration)', () => {
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

  const BASE = 'JasperCvItBase';
  const SUB = 'JasperCvItSub';

  // A base class with two class variables and a subclass declaring none, so the
  // "defined here, not inherited" semantics are observable.
  const defineFixture = (): void => {
    exec(
      `Object subclass: '${BASE}' instVarNames: #() classVars: #(Alpha Beta) ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals. true printString',
    );
    exec(
      `${BASE} subclass: '${SUB}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals. true printString',
    );
  };

  it('lists a class its own class variables', () => {
    defineFixture();

    const names = getDefinedClassVarNames(exec, BASE);

    expect(names).toContain('Alpha');
    expect(names).toContain('Beta');
  });

  it('does not list inherited class variables on a subclass', () => {
    defineFixture();

    const names = getDefinedClassVarNames(exec, SUB);

    expect(names).not.toContain('Alpha');
    expect(names).toHaveLength(0);
  });

  it('counts the class variables defined in each class of a dictionary', () => {
    defineFixture();

    const counts = getDefinedClassVarCounts(exec, userIndex());

    expect(counts.get(BASE)).toBe(2);
    expect(counts.get(SUB)).toBe(0);
  });

  it('reads class-variable names as strings, never leaving the transaction dirtier than found', () => {
    defineFixture();
    const before = exec('System needsCommit printString').trim();

    getDefinedClassVarNames(exec, BASE);
    getDefinedClassVarCounts(exec, userIndex());

    expect(exec('System needsCommit printString').trim()).toBe(before);
  });
});
