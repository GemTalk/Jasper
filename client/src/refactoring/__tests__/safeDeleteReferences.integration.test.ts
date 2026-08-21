import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { testActiveSession } from '../../__tests__/testActiveSession';

/**
 * The reference scans that decide whether a delete is safe, over the real GCI transport.
 * Everything here is base-image reflection — no refactoring engine, so it runs in both CI
 * passes — and the point of each test is the DISCRIMINATION: a comment mentioning the name
 * is not a reference, a same-named global is not the class variable, and a class's own
 * methods are not reasons to keep the class. Fully transient: the harness aborts each test.
 */
describe('safe-delete reference scans (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code);

  const userIndex = (): number => {
    const index = q.getDictionaryNames(session()).indexOf('UserGlobals') + 1;
    expect(index).toBeGreaterThan(0);
    return index;
  };

  const BASE = 'SdItBase';
  const SUB = 'SdItSub';
  const CALLER = 'SdItCaller';

  const defineClass = (definition: string): void => {
    q.compileClassDefinition(session(), definition);
  };

  const compile = (className: string, isMeta: boolean, source: string): void => {
    q.compileMethod(session(), className, isMeta, 'safe-delete-fixture', source);
  };

  /** A base class with an accessed and an unaccessed instance variable, a class variable
   *  used from both sides, a subclass that inherits both, and an unrelated caller. */
  const defineFixture = (): void => {
    // A GLOBAL of the same name as the class variable, so the identity check has
    // something to be wrong about.
    exec(`UserGlobals at: #SdItRegistry put: 42. true printString`);

    defineClass(
      `Object subclass: '${BASE}' instVarNames: #(balance untouched) ` +
        'classVars: #(SdItRegistry) classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()',
    );
    defineClass(
      `${BASE} subclass: '${SUB}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()',
    );
    defineClass(
      `Object subclass: '${CALLER}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()',
    );

    compile(BASE, false, 'readsBalance\n  ^balance');
    compile(BASE, false, 'mentionsBalance\n  "balance is only named in this comment"\n  ^0');
    compile(BASE, false, 'record\n  SdItRegistry := 1');
    compile(BASE, false, 'mentionsRegistry\n  "SdItRegistry is only named in this comment"\n  ^0');
    compile(BASE, true, 'resetRegistry\n  SdItRegistry := nil');
    compile(BASE, false, `makeAnother\n  ^${BASE} new`);
    compile(SUB, false, 'accrue\n  balance := balance + 1');
    compile(CALLER, false, `callsIt\n  ^${BASE} new readsBalance`);
    compile(CALLER, false, 'usesTheGlobal\n  ^SdItRegistry');
  };

  const selectorsIn = (results: { className: string; selector: string }[]): string[] =>
    results.map((r) => `${r.className}>>${r.selector}`).sort();

  describe('methods that send a selector', () => {
    it('finds the sender of a method', () => {
      defineFixture();

      const senders = q.sendersOf(session(), 'readsBalance');

      expect(selectorsIn(senders)).toContain(`${CALLER}>>callsIt`);
    });

    it('finds nothing for a selector nobody sends', () => {
      defineFixture();

      const senders = q.sendersOf(session(), 'mentionsBalance');

      expect(selectorsIn(senders)).not.toContain(`${CALLER}>>callsIt`);
    });
  });

  describe('methods that access an instance variable', () => {
    it('finds the accessors in the declaring class and in a subclass', () => {
      defineFixture();

      const found = q.methodsAccessingInstVar(session(), BASE, 'balance', userIndex());

      expect(selectorsIn(found)).toEqual([`${BASE}>>readsBalance`, `${SUB}>>accrue`].sort());
    });

    it('does not count a method that only names the variable in a comment', () => {
      defineFixture();

      const found = q.methodsAccessingInstVar(session(), BASE, 'balance', userIndex());

      expect(selectorsIn(found)).not.toContain(`${BASE}>>mentionsBalance`);
    });

    it('finds nothing for a variable no method touches', () => {
      defineFixture();

      expect(q.methodsAccessingInstVar(session(), BASE, 'untouched', userIndex())).toEqual([]);
    });
  });

  describe('methods that access a class variable', () => {
    it('finds the accessors on both sides of the hierarchy', () => {
      defineFixture();

      const found = q.methodsAccessingClassVar(session(), BASE, 'SdItRegistry', userIndex());

      expect(selectorsIn(found)).toEqual([`${BASE}>>record`, `${BASE}>>resetRegistry`].sort());
    });

    it('does not count a method that reads a same-named global instead', () => {
      defineFixture();

      const found = q.methodsAccessingClassVar(session(), BASE, 'SdItRegistry', userIndex());

      expect(selectorsIn(found)).not.toContain(`${CALLER}>>usesTheGlobal`);
    });

    it('does not count a method that only names the variable in a comment', () => {
      defineFixture();

      const found = q.methodsAccessingClassVar(session(), BASE, 'SdItRegistry', userIndex());

      expect(selectorsIn(found)).not.toContain(`${BASE}>>mentionsRegistry`);
    });

    it('finds the accessors from a subclass row, resolving to the declaring class', () => {
      defineFixture();

      const found = q.methodsAccessingClassVar(session(), SUB, 'SdItRegistry', userIndex());

      expect(selectorsIn(found)).toContain(`${BASE}>>record`);
    });
  });

  describe('methods that reference a class', () => {
    it('finds the method that names the class', () => {
      defineFixture();

      const found = q.referencesToClassInDict(session(), BASE, userIndex());

      expect(selectorsIn(found)).toContain(`${CALLER}>>callsIt`);
    });

    it("reports the class's own referencing method, for the caller to discount", () => {
      defineFixture();

      const found = q.referencesToClassInDict(session(), BASE, userIndex());

      expect(selectorsIn(found)).toContain(`${BASE}>>makeAnother`);
    });
  });

  // The scan a class delete depends on has to answer for the class the user clicked, not
  // for whatever else happens to carry its name. Two dictionaries in one symbol list, each
  // holding a DIFFERENT class of the same name, with one referencing method compiled
  // against each: a name-based lookup (objectNamed:) would answer the first binding in the
  // list for both, so deleting the second would look unreferenced while a method still
  // needed it — or would report the wrong method as the reason it cannot go.
  describe('methods that reference a class whose name is shadowed in another dictionary', () => {
    const SHADOW = 'SdItShadow';
    const OTHER_DICT = 'SdItOtherDict';
    const USER_CALLER = 'SdItUserCaller';
    const OTHER_CALLER = 'SdItOtherCaller';

    const defineClassIn = (dictExpr: string, className: string): void => {
      exec(
        `| d | d := ${dictExpr}. (Object subclass: '${className}' instVarNames: #() ` +
          'classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: d ' +
          'options: #()) name printString',
      );
    };

    /** The shadow pair. Order matters: the first caller is compiled while only the
     *  UserGlobals class exists, so it binds that one; the second dictionary is then
     *  inserted AHEAD of UserGlobals, so the second caller binds ITS class instead. */
    const defineShadowFixture = (): { userIndex: number; otherIndex: number } => {
      defineClassIn('UserGlobals', SHADOW);
      defineClassIn('UserGlobals', USER_CALLER);
      compile(USER_CALLER, false, `usesIt\n  ^${SHADOW} new`);

      exec(
        `| d | d := SymbolDictionary new. d name: #'${OTHER_DICT}'. ` +
          'System myUserProfile insertDictionary: d at: 1. true printString',
      );
      defineClassIn('System myUserProfile symbolList at: 1', SHADOW);
      defineClassIn('UserGlobals', OTHER_CALLER);
      compile(OTHER_CALLER, false, `usesIt\n  ^${SHADOW} new`);

      // The premise of every assertion below: the two methods really do reference two
      // different classes. Without this the tests could pass on a fixture that never
      // shadowed anything.
      const distinct = exec(
        `| a b |
a := (${USER_CALLER} compiledMethodAt: #usesIt) literals
  detect: [:e | e isKindOf: SymbolAssociation] ifNone: [nil].
b := (${OTHER_CALLER} compiledMethodAt: #usesIt) literals
  detect: [:e | e isKindOf: SymbolAssociation] ifNone: [nil].
(a notNil and: [b notNil and: [a value ~~ b value]]) printString`,
      );
      expect(distinct.trim()).toBe('true');

      const user = parseInt(
        exec('(System myUserProfile symbolList indexOf: UserGlobals) printString').trim(),
        10,
      );
      return { userIndex: user, otherIndex: 1 };
    };

    it('reports only the method that references the class in the dictionary asked about', () => {
      const { userIndex: user } = defineShadowFixture();

      const found = q.referencesToClassInDict(session(), SHADOW, user);

      expect(selectorsIn(found)).toEqual([`${USER_CALLER}>>usesIt`]);
    });

    it('reports the other dictionary’s referencing method when asked about that one', () => {
      const { otherIndex } = defineShadowFixture();

      const found = q.referencesToClassInDict(session(), SHADOW, otherIndex);

      expect(selectorsIn(found)).toEqual([`${OTHER_CALLER}>>usesIt`]);
    });

    it('reports nothing for a dictionary that does not bind the name at all', () => {
      defineShadowFixture();

      const globalsIndex = parseInt(
        exec('(System myUserProfile symbolList indexOf: Globals) printString').trim(),
        10,
      );

      expect(q.referencesToClassInDict(session(), SHADOW, globalsIndex)).toEqual([]);
    });
  });

  // A method can live in an environment other than 0, and the scans loop over the
  // environments the user has configured. Both bugs these cover were live: the class scan
  // built a bare ClassOrganizer (environment 0 whatever it was asked for), and the two
  // variable scans enumerated `selectors`, which lists environment 0 only. Either way a
  // reference in a higher environment was invisible, and safe delete would have deleted the
  // target while reporting that nothing referenced it.
  describe('scanning an environment other than zero', () => {
    const ENV = 1;

    const defineEnvFixture = (): void => {
      defineClass(
        `Object subclass: '${BASE}' instVarNames: #(balance) classVars: #(SdItRegistry) ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()',
      );
      defineClass(
        `Object subclass: '${CALLER}' instVarNames: #() classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()',
      );
      // Compiled into environment 1 only — invisible to an environment-0 scan.
      q.compileMethod(
        session(),
        CALLER,
        false,
        'safe-delete-fixture',
        `usesInEnvOne\n  ^${BASE} new`,
        ENV,
      );
      q.compileMethod(
        session(),
        BASE,
        false,
        'safe-delete-fixture',
        'touchesInEnvOne\n  balance := SdItRegistry',
        ENV,
      );
      // The premise: these really are environment-1 methods and environment 0 cannot see them.
      expect(exec(`(${CALLER} includesSelector: #usesInEnvOne) printString`).trim()).toBe('false');
      expect(exec(`(${CALLER} selectorsForEnvironment: ${ENV}) asArray printString`)).toContain(
        'usesInEnvOne',
      );
    };

    it('finds a class reference that exists only in a higher environment', () => {
      defineEnvFixture();

      const found = q.referencesToClassInDict(session(), BASE, userIndex(), ENV);

      expect(selectorsIn(found)).toContain(`${CALLER}>>usesInEnvOne`);
    });

    it('does not report that environment-1 reference when asked about environment 0', () => {
      defineEnvFixture();

      const found = q.referencesToClassInDict(session(), BASE, userIndex(), 0);

      expect(selectorsIn(found)).not.toContain(`${CALLER}>>usesInEnvOne`);
    });

    it('finds an instance-variable accessor that exists only in a higher environment', () => {
      defineEnvFixture();

      const found = q.methodsAccessingInstVar(session(), BASE, 'balance', userIndex(), ENV);

      expect(selectorsIn(found)).toContain(`${BASE}>>touchesInEnvOne`);
    });

    it('finds a class-variable accessor that exists only in a higher environment', () => {
      defineEnvFixture();

      const found = q.methodsAccessingClassVar(session(), BASE, 'SdItRegistry', userIndex(), ENV);

      expect(selectorsIn(found)).toContain(`${BASE}>>touchesInEnvOne`);
    });

    it('reports the environment each row was found in, so rows stay distinguishable', () => {
      defineEnvFixture();

      const found = q.referencesToClassInDict(session(), BASE, userIndex(), ENV);

      expect(found.every((r) => r.environmentId === ENV)).toBe(true);
    });
  });

  describe('removing a class variable', () => {
    it('removes the named variable', () => {
      defineFixture();

      const result = q.deleteClassVariable(session(), BASE, 'SdItRegistry', userIndex());

      expect(result.trim()).toBe('ok');
      expect(exec(`(${BASE} classVarNames includes: #SdItRegistry) printString`).trim()).toBe(
        'false',
      );
    });

    it("leaves the class's other class variables in place", () => {
      defineFixture();
      exec(`${BASE} addClassVarName: 'SdItKeeper'. true printString`);

      q.deleteClassVariable(session(), BASE, 'SdItRegistry', userIndex());

      expect(exec(`(${BASE} classVarNames includes: #SdItKeeper) printString`).trim()).toBe('true');
    });

    it('does not reshape the class', () => {
      defineFixture();
      const historyBefore = exec(`${BASE} classHistory size printString`).trim();

      q.deleteClassVariable(session(), BASE, 'SdItRegistry', userIndex());

      expect(exec(`${BASE} classHistory size printString`).trim()).toBe(historyBefore);
    });

    it('refuses a variable the class inherits rather than declares', () => {
      defineFixture();

      const result = q.deleteClassVariable(session(), SUB, 'SdItRegistry', userIndex());

      expect(result.trim()).toBe('not-declared');
      expect(exec(`(${BASE} classVarNames includes: #SdItRegistry) printString`).trim()).toBe(
        'true',
      );
    });

    it('answers the not-found sentinel for a class the dictionary does not bind', () => {
      expect(q.deleteClassVariable(session(), 'SdItNoSuchClass', 'X', userIndex()).trim()).toBe(
        'no-class',
      );
    });

    it('leaves the removal uncommitted', () => {
      defineFixture();

      q.deleteClassVariable(session(), BASE, 'SdItRegistry', userIndex());

      expect(q.sessionNeedsCommit(session())).toBe(true);
    });
  });
});
