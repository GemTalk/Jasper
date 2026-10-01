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
  const exec = async (code: string): Promise<string> => await q.executeFetchString(session(), code);

  const userIndex = async (): Promise<number> => {
    const index = (await q.getDictionaryNames(session())).indexOf('UserGlobals') + 1;
    expect(index).toBeGreaterThan(0);
    return index;
  };

  const BASE = 'SdItBase';
  const SUB = 'SdItSub';
  const CALLER = 'SdItCaller';

  const defineClass = async (definition: string): Promise<void> => {
    await q.compileClassDefinition(session(), definition);
  };

  const compile = async (className: string, isMeta: boolean, source: string): Promise<void> => {
    await q.compileMethod(session(), className, isMeta, 'safe-delete-fixture', source);
  };

  /** A base class with an accessed and an unaccessed instance variable, a class variable
   *  used from both sides, a subclass that inherits both, and an unrelated caller. */
  const defineFixture = async (): Promise<void> => {
    // A GLOBAL of the same name as the class variable, so the identity check has
    // something to be wrong about.
    await exec(`UserGlobals at: #SdItRegistry put: 42. true printString`);

    await defineClass(
      `Object subclass: '${BASE}' instVarNames: #(balance untouched) ` +
        'classVars: #(SdItRegistry) classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()',
    );
    await defineClass(
      `${BASE} subclass: '${SUB}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()',
    );
    await defineClass(
      `Object subclass: '${CALLER}' instVarNames: #() classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()',
    );

    await compile(BASE, false, 'readsBalance\n  ^balance');
    await compile(BASE, false, 'mentionsBalance\n  "balance is only named in this comment"\n  ^0');
    await compile(BASE, false, 'record\n  SdItRegistry := 1');
    await compile(
      BASE,
      false,
      'mentionsRegistry\n  "SdItRegistry is only named in this comment"\n  ^0',
    );
    await compile(BASE, true, 'resetRegistry\n  SdItRegistry := nil');
    await compile(BASE, false, `makeAnother\n  ^${BASE} new`);
    await compile(SUB, false, 'accrue\n  balance := balance + 1');
    await compile(CALLER, false, `callsIt\n  ^${BASE} new readsBalance`);
    await compile(CALLER, false, 'usesTheGlobal\n  ^SdItRegistry');
  };

  const selectorsIn = (results: { className: string; selector: string }[]): string[] =>
    results.map((r) => `${r.className}>>${r.selector}`).sort();

  describe('methods that send a selector', () => {
    it('finds the sender of a method', async () => {
      await defineFixture();

      const senders = await q.sendersOf(session(), 'readsBalance');

      expect(selectorsIn(senders)).toContain(`${CALLER}>>callsIt`);
    });

    it('finds nothing for a selector nobody sends', async () => {
      await defineFixture();

      const senders = await q.sendersOf(session(), 'mentionsBalance');

      expect(selectorsIn(senders)).not.toContain(`${CALLER}>>callsIt`);
    });
  });

  describe('methods that access an instance variable', () => {
    it('finds the accessors in the declaring class and in a subclass', async () => {
      await defineFixture();

      const found = await q.methodsAccessingInstVar(session(), BASE, 'balance', await userIndex());

      expect(selectorsIn(found)).toEqual([`${BASE}>>readsBalance`, `${SUB}>>accrue`].sort());
    });

    it('does not count a method that only names the variable in a comment', async () => {
      await defineFixture();

      const found = await q.methodsAccessingInstVar(session(), BASE, 'balance', await userIndex());

      expect(selectorsIn(found)).not.toContain(`${BASE}>>mentionsBalance`);
    });

    it('finds nothing for a variable no method touches', async () => {
      await defineFixture();

      expect(
        await q.methodsAccessingInstVar(session(), BASE, 'untouched', await userIndex()),
      ).toEqual([]);
    });
  });

  describe('methods that access a class variable', () => {
    it('finds the accessors on both sides of the hierarchy', async () => {
      await defineFixture();

      const found = await q.methodsAccessingClassVar(
        session(),
        BASE,
        'SdItRegistry',
        await userIndex(),
      );

      expect(selectorsIn(found)).toEqual([`${BASE}>>record`, `${BASE}>>resetRegistry`].sort());
    });

    it('does not count a method that reads a same-named global instead', async () => {
      await defineFixture();

      const found = await q.methodsAccessingClassVar(
        session(),
        BASE,
        'SdItRegistry',
        await userIndex(),
      );

      expect(selectorsIn(found)).not.toContain(`${CALLER}>>usesTheGlobal`);
    });

    it('does not count a method that only names the variable in a comment', async () => {
      await defineFixture();

      const found = await q.methodsAccessingClassVar(
        session(),
        BASE,
        'SdItRegistry',
        await userIndex(),
      );

      expect(selectorsIn(found)).not.toContain(`${BASE}>>mentionsRegistry`);
    });

    it('finds the accessors from a subclass row, resolving to the declaring class', async () => {
      await defineFixture();

      const found = await q.methodsAccessingClassVar(
        session(),
        SUB,
        'SdItRegistry',
        await userIndex(),
      );

      expect(selectorsIn(found)).toContain(`${BASE}>>record`);
    });
  });

  describe('methods that reference a class', () => {
    it('finds the method that names the class', async () => {
      await defineFixture();

      const found = await q.referencesToClassInDict(session(), BASE, await userIndex());

      expect(selectorsIn(found)).toContain(`${CALLER}>>callsIt`);
    });

    it("reports the class's own referencing method, for the caller to discount", async () => {
      await defineFixture();

      const found = await q.referencesToClassInDict(session(), BASE, await userIndex());

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

    const defineClassIn = async (dictExpr: string, className: string): Promise<void> => {
      await exec(
        `| d | d := ${dictExpr}. (Object subclass: '${className}' instVarNames: #() ` +
          'classVars: #() classInstVars: #() poolDictionaries: #() inDictionary: d ' +
          'options: #()) name printString',
      );
    };

    /** The shadow pair. Order matters: the first caller is compiled while only the
     *  UserGlobals class exists, so it binds that one; the second dictionary is then
     *  inserted AHEAD of UserGlobals, so the second caller binds ITS class instead. */
    const defineShadowFixture = async (): Promise<{ userIndex: number; otherIndex: number }> => {
      await defineClassIn('UserGlobals', SHADOW);
      await defineClassIn('UserGlobals', USER_CALLER);
      await compile(USER_CALLER, false, `usesIt\n  ^${SHADOW} new`);

      await exec(
        `| d | d := SymbolDictionary new. d name: #'${OTHER_DICT}'. ` +
          'System myUserProfile insertDictionary: d at: 1. true printString',
      );
      await defineClassIn('System myUserProfile symbolList at: 1', SHADOW);
      await defineClassIn('UserGlobals', OTHER_CALLER);
      await compile(OTHER_CALLER, false, `usesIt\n  ^${SHADOW} new`);

      // The premise of every assertion below: the two methods really do reference two
      // different classes. Without this the tests could pass on a fixture that never
      // shadowed anything.
      const distinct = await exec(
        `| a b |
a := (${USER_CALLER} compiledMethodAt: #usesIt) literals
  detect: [:e | e isKindOf: SymbolAssociation] ifNone: [nil].
b := (${OTHER_CALLER} compiledMethodAt: #usesIt) literals
  detect: [:e | e isKindOf: SymbolAssociation] ifNone: [nil].
(a notNil and: [b notNil and: [a value ~~ b value]]) printString`,
      );
      expect(distinct.trim()).toBe('true');

      const user = parseInt(
        (await exec('(System myUserProfile symbolList indexOf: UserGlobals) printString')).trim(),
        10,
      );
      return { userIndex: user, otherIndex: 1 };
    };

    it('reports only the method that references the class in the dictionary asked about', async () => {
      const { userIndex: user } = await defineShadowFixture();

      const found = await q.referencesToClassInDict(session(), SHADOW, user);

      expect(selectorsIn(found)).toEqual([`${USER_CALLER}>>usesIt`]);
    });

    it('reports the other dictionary’s referencing method when asked about that one', async () => {
      const { otherIndex } = await defineShadowFixture();

      const found = await q.referencesToClassInDict(session(), SHADOW, otherIndex);

      expect(selectorsIn(found)).toEqual([`${OTHER_CALLER}>>usesIt`]);
    });

    it('reports nothing for a dictionary that does not bind the name at all', async () => {
      await defineShadowFixture();

      const globalsIndex = parseInt(
        (await exec('(System myUserProfile symbolList indexOf: Globals) printString')).trim(),
        10,
      );

      expect(await q.referencesToClassInDict(session(), SHADOW, globalsIndex)).toEqual([]);
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

    const defineEnvFixture = async (): Promise<void> => {
      await defineClass(
        `Object subclass: '${BASE}' instVarNames: #(balance) classVars: #(SdItRegistry) ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()',
      );
      await defineClass(
        `Object subclass: '${CALLER}' instVarNames: #() classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals options: #()',
      );
      // Compiled into environment 1 only — invisible to an environment-0 scan.
      await q.compileMethod(
        session(),
        CALLER,
        false,
        'safe-delete-fixture',
        `usesInEnvOne\n  ^${BASE} new`,
        ENV,
      );
      await q.compileMethod(
        session(),
        BASE,
        false,
        'safe-delete-fixture',
        'touchesInEnvOne\n  balance := SdItRegistry',
        ENV,
      );
      // The premise: these really are environment-1 methods and environment 0 cannot see them.
      expect((await exec(`(${CALLER} includesSelector: #usesInEnvOne) printString`)).trim()).toBe(
        'false',
      );
      expect(
        await exec(`(${CALLER} selectorsForEnvironment: ${ENV}) asArray printString`),
      ).toContain('usesInEnvOne');
    };

    it('finds a class reference that exists only in a higher environment', async () => {
      await defineEnvFixture();

      const found = await q.referencesToClassInDict(session(), BASE, await userIndex(), ENV);

      expect(selectorsIn(found)).toContain(`${CALLER}>>usesInEnvOne`);
    });

    it('does not report that environment-1 reference when asked about environment 0', async () => {
      await defineEnvFixture();

      const found = await q.referencesToClassInDict(session(), BASE, await userIndex(), 0);

      expect(selectorsIn(found)).not.toContain(`${CALLER}>>usesInEnvOne`);
    });

    it('finds an instance-variable accessor that exists only in a higher environment', async () => {
      await defineEnvFixture();

      const found = await q.methodsAccessingInstVar(
        session(),
        BASE,
        'balance',
        await userIndex(),
        ENV,
      );

      expect(selectorsIn(found)).toContain(`${BASE}>>touchesInEnvOne`);
    });

    it('finds a class-variable accessor that exists only in a higher environment', async () => {
      await defineEnvFixture();

      const found = await q.methodsAccessingClassVar(
        session(),
        BASE,
        'SdItRegistry',
        await userIndex(),
        ENV,
      );

      expect(selectorsIn(found)).toContain(`${BASE}>>touchesInEnvOne`);
    });

    it('reports the environment each row was found in, so rows stay distinguishable', async () => {
      await defineEnvFixture();

      const found = await q.referencesToClassInDict(session(), BASE, await userIndex(), ENV);

      expect(found.every((r) => r.environmentId === ENV)).toBe(true);
    });
  });

  describe('removing a class variable', () => {
    it('removes the named variable', async () => {
      await defineFixture();

      const result = await q.deleteClassVariable(
        session(),
        BASE,
        'SdItRegistry',
        await userIndex(),
      );

      expect(result.trim()).toBe('ok');
      expect(
        (await exec(`(${BASE} classVarNames includes: #SdItRegistry) printString`)).trim(),
      ).toBe('false');
    });

    it("leaves the class's other class variables in place", async () => {
      await defineFixture();
      await exec(`${BASE} addClassVarName: 'SdItKeeper'. true printString`);

      await q.deleteClassVariable(session(), BASE, 'SdItRegistry', await userIndex());

      expect((await exec(`(${BASE} classVarNames includes: #SdItKeeper) printString`)).trim()).toBe(
        'true',
      );
    });

    it('does not reshape the class', async () => {
      await defineFixture();
      const historyBefore = (await exec(`${BASE} classHistory size printString`)).trim();

      await q.deleteClassVariable(session(), BASE, 'SdItRegistry', await userIndex());

      expect((await exec(`${BASE} classHistory size printString`)).trim()).toBe(historyBefore);
    });

    it('refuses a variable the class inherits rather than declares', async () => {
      await defineFixture();

      const result = await q.deleteClassVariable(session(), SUB, 'SdItRegistry', await userIndex());

      expect(result.trim()).toBe('not-declared');
      expect(
        (await exec(`(${BASE} classVarNames includes: #SdItRegistry) printString`)).trim(),
      ).toBe('true');
    });

    it('answers the not-found sentinel for a class the dictionary does not bind', async () => {
      expect(
        (await q.deleteClassVariable(session(), 'SdItNoSuchClass', 'X', await userIndex())).trim(),
      ).toBe('no-class');
    });

    it('leaves the removal uncommitted', async () => {
      await defineFixture();

      await q.deleteClassVariable(session(), BASE, 'SdItRegistry', await userIndex());

      expect(await q.sessionNeedsCommit(session())).toBe(true);
    });
  });
});
