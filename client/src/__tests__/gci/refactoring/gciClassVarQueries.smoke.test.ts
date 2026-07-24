// End-to-end (live GCI) smoke test for the Explorer's class-variable row queries:
// getDefinedClassVarNames and getDefinedClassVarCounts (added for R4). These build
// Smalltalk that runs against the stone, so — like the other query smoke tests —
// this catches selector/behavior misfires the "expect(code).toContain(...)" unit
// tests can't (e.g. classVarNames returning Symbols vs Strings).
//
// Safe / fully transient: it defines a throwaway class hierarchy in the session's
// uncommitted transaction, reads from it, and aborts — nothing is ever committed,
// and the fixture is discarded on abort/logout.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HarnessSession, login } from '../queryHarness';
import { getDefinedClassVarNames } from '../../../refactoring/queries/getDefinedClassVarNames';
import { getDefinedClassVarCounts } from '../../../refactoring/queries/getDefinedClassVarCounts';

const BASE = 'JasperCvSmokeBase';
const SUB = 'JasperCvSmokeSub';

describe('class-variable Explorer queries (live GCI)', () => {
  let s: HarnessSession;
  let userIndex: number;

  beforeAll(() => {
    s = login();
    userIndex = parseInt(
      s.exec(
        '| sl d | sl := System myUserProfile symbolList. ' +
          "d := sl detect: [:x | x name = #'UserGlobals'] ifNone: [nil]. " +
          '(d ifNil: [0] ifNotNil: [sl indexOf: d]) printString',
      ),
      10,
    );
    // A base class with two class variables and a subclass declaring none, so the
    // "defined here, not inherited" semantics are observable.
    s.exec(
      `Object subclass: '${BASE}' instVarNames: #() classVars: #(Alpha Beta) ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals. true printString',
    );
    s.exec(
      `${BASE} subclass: '${SUB}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals. true printString',
    );
  });

  afterAll(() => {
    try {
      s?.exec('System abortTransaction. true printString');
    } catch {
      /* best-effort — logout discards the uncommitted fixture regardless */
    }
    s?.logout();
  });

  it('lists a class its own class variables', () => {
    const names = getDefinedClassVarNames(s.exec, BASE);

    expect(names).toContain('Alpha');
    expect(names).toContain('Beta');
  });

  it('does not list inherited class variables on a subclass', () => {
    const names = getDefinedClassVarNames(s.exec, SUB);

    expect(names).not.toContain('Alpha');
    expect(names).toHaveLength(0);
  });

  it('counts the class variables defined in each class of a dictionary', () => {
    const counts = getDefinedClassVarCounts(s.exec, userIndex);

    expect(counts.get(BASE)).toBe(2);
    expect(counts.get(SUB)).toBe(0);
  });

  it('reads class-variable names as strings, never leaving the transaction dirtier than found', () => {
    const before = s.exec('System needsCommit printString').trim();

    getDefinedClassVarNames(s.exec, BASE);
    getDefinedClassVarCounts(s.exec, userIndex);

    expect(s.exec('System needsCommit printString').trim()).toBe(before);
  });
});
