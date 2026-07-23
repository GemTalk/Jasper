import { describe, it, expect } from 'vitest';

// Real GCI, but stub the `vscode` module the query layer pulls in via gciLog.
import { vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode'));

import { useIntegrationTest } from './useIntegrationTest';
import { GciLibrary } from '../gciLibrary';
import * as q from '../browserQueries';
import type { ActiveSession } from '../sessionManager';

/**
 * Automatic GCI integration tests for the GemStone Explorer's query layer.
 *
 * Every test is fully transient: the useIntegrationTest harness wraps each in a
 * GciTsBegin/GciTsAbort pair, so even the destructive write-path queries
 * (recategorize, reclassify, rename, copy, delete, move, add/remove dictionary)
 * are rolled back and NOTHING is ever committed. Write tests operate on a
 * throwaway class/dictionary created inside the same transaction, so they never
 * mutate kernel classes and any GemStone user can run them.
 *
 * Runs across the whole `npm run test:server:start` matrix (3.6.2 -> 3.7.5), so
 * all emitted Smalltalk is ASCII-only (a non-ASCII char in compiled source
 * trips the 3.6.x ComStrmSetCursor compiler bug). The one assertion that
 * depends on a non-system user (a kernel class is read-only) skips itself under
 * a system profile.
 */
describe('explorer queries (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);

  const isSystemProfile = (): boolean =>
    exec('System myUserProfile isSystemProfile printString').trim() === 'true';
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

  const WIDGET = 'JasperItWidget';
  const GADGET = 'JasperItGadget';

  // Compile a throwaway class into UserGlobals (writable by any user). Uses the
  // base-kernel `subclass:...inDictionary:` selector — the `category:options:`
  // variant only exists in images with certain packages loaded, not the bare
  // test stone — then tags the class-category in a separate step.
  const defineClass = (name: string, category = 'JasperIt-Core'): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${name}' instVarNames: #() classVars: #() ` +
        `classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals`,
    );
    exec(`(UserGlobals at: #'${name}') category: '${category}'. 'ok'`);
  };

  // The standard fixture: WIDGET with one instance method and one class method.
  const defineWidget = (): void => {
    defineClass(WIDGET);
    q.compileMethod(session(), WIDGET, false, 'accessing', 'bar ^42');
    q.compileMethod(session(), WIDGET, true, 'instance creation', 'make ^self new');
  };

  const categoryOf = (className: string): string | undefined =>
    q.getClassesWithCategory(session(), userIndex()).find((e) => e.className === className)
      ?.category;

  const selectorsIn = (className: string, isMeta: boolean, category: string): string[] =>
    q
      .getClassEnvironments(session(), userIndex(), className, 0)
      .filter((l) => l.isMeta === isMeta && l.category === category)
      .flatMap((l) => l.selectors);

  describe('getClassHierarchy', () => {
    it('reports the queried class as the "self" node', () => {
      const self = q.getClassHierarchy(session(), 'Integer').find((e) => e.kind === 'self');

      expect(self?.className).toBe('Integer');
    });

    it('includes Object among the superclasses, root-first', () => {
      const supers = q
        .getClassHierarchy(session(), 'Integer')
        .filter((e) => e.kind === 'superclass');

      expect(supers.map((e) => e.className)).toContain('Object');
    });
  });

  describe('getGrailStubReflection', () => {
    const GRAILC = 'JasperItGrailTarget';
    // A throwaway class with two instVars: `balance` has both an accessor and a
    // mutator, `owner` has neither — plus a plain method, a binary override, and
    // a class-side method, so the reflection exercises every branch.
    const defineGrailTarget = (): void => {
      q.compileClassDefinition(
        session(),
        `Object subclass: '${GRAILC}' instVarNames: #('balance' 'owner') classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );
      q.compileMethod(session(), GRAILC, false, 'accessing', 'balance ^balance');
      q.compileMethod(session(), GRAILC, false, 'accessing', 'balance: aValue balance := aValue');
      q.compileMethod(session(), GRAILC, false, 'ops', 'deposit: n balance := balance + n');
      q.compileMethod(session(), GRAILC, false, 'comparing', '= other ^self == other');
      q.compileMethod(session(), GRAILC, true, 'instance creation', 'make ^self new');
    };

    it('reports own instance variables in order with the accessors the class understands', () => {
      defineGrailTarget();

      const refl = q.getGrailStubReflection(session(), GRAILC, userIndex());

      expect(refl.found).toBe(true);
      expect(refl.instVars).toEqual([
        { name: 'balance', hasGetter: true, hasSetter: true },
        { name: 'owner', hasGetter: false, hasSetter: false },
      ]);
    });

    it('lists own selectors on both sides and names the immediate superclass', () => {
      defineGrailTarget();

      const refl = q.getGrailStubReflection(session(), GRAILC, userIndex());

      expect(refl.superclass).toBe('Object');
      expect(refl.methods).toContainEqual({
        side: 'instance',
        category: 'ops',
        selector: 'deposit:',
      });
      expect(refl.methods).toContainEqual({
        side: 'instance',
        category: 'comparing',
        selector: '=',
      });
      expect(refl.methods).toContainEqual({
        side: 'class',
        category: 'instance creation',
        selector: 'make',
      });
    });

    it('reports an unknown class name as not found', () => {
      const refl = q.getGrailStubReflection(session(), 'JasperItNoSuchClass', userIndex());

      expect(refl.found).toBe(false);
    });
  });

  describe('getClassesWithCategory', () => {
    it('pairs a class in the dictionary with its class-category', () => {
      defineClass(WIDGET, 'JasperIt-Alpha');

      expect(categoryOf(WIDGET)).toBe('JasperIt-Alpha');
    });
  });

  describe('canClassBeWritten', () => {
    it('reports a freshly created user class as writable', () => {
      defineClass(WIDGET);

      expect(q.canClassBeWritten(session(), WIDGET, userIndex())).toBe(true);
    });

    it('reports a kernel class as read-only for a non-system user', () => {
      if (isSystemProfile()) return;

      expect(q.canClassBeWritten(session(), 'Object')).toBe(false);
    });
  });

  describe('getClassEnvironments', () => {
    it("lists a class's own instance and class methods under their categories", () => {
      defineWidget();

      expect(selectorsIn(WIDGET, false, 'accessing')).toContain('bar');
      expect(selectorsIn(WIDGET, true, 'instance creation')).toContain('make');
    });
  });

  describe('recategorizeClass', () => {
    it('moves a class to a new class-category', () => {
      defineWidget();

      const result = q.recategorizeClass(session(), WIDGET, 'JasperIt-Moved');

      expect(result).toContain('Recategorized');
      expect(categoryOf(WIDGET)).toBe('JasperIt-Moved');
    });
  });

  describe('recategorizeMethod', () => {
    it('moves a method into another existing category', () => {
      defineWidget();
      q.compileMethod(session(), WIDGET, false, 'relocated', 'baz ^0'); // makes the target category exist

      q.recategorizeMethod(session(), WIDGET, false, 'bar', 'relocated');

      expect(selectorsIn(WIDGET, false, 'relocated')).toContain('bar');
      expect(selectorsIn(WIDGET, false, 'accessing')).not.toContain('bar');
    });
  });

  describe('renameCategory', () => {
    it('renames a method category, carrying its methods along', () => {
      defineWidget();

      q.renameCategory(session(), WIDGET, false, 'accessing', 'renamed-accessing');

      expect(selectorsIn(WIDGET, false, 'renamed-accessing')).toContain('bar');
      expect(selectorsIn(WIDGET, false, 'accessing')).toEqual([]);
    });
  });

  describe('copyMethodToClass', () => {
    it('copies a method into another class, keeping its category', () => {
      defineWidget();
      defineClass(GADGET);

      const result = q.copyMethodToClass(session(), WIDGET, GADGET, false, 'bar');

      expect(result).toContain('Copied');
      expect(selectorsIn(GADGET, false, 'accessing')).toContain('bar');
    });
  });

  describe('deleteClass', () => {
    it('removes a class from its dictionary', () => {
      defineWidget();

      const result = q.deleteClass(session(), userIndex(), WIDGET);

      expect(result).toContain('Deleted class');
      expect(categoryOf(WIDGET)).toBeUndefined();
    });
  });

  describe('moveClass', () => {
    it('moves a class from one dictionary to another', () => {
      defineWidget();
      q.addDictionary(session(), 'JasperItDest');
      const dest = dictIndexOf('JasperItDest');

      const result = q.moveClass(session(), userIndex(), dest, WIDGET);

      expect(result).toContain('Moved');
      expect(
        q.getClassesWithCategory(session(), userIndex()).find((e) => e.className === WIDGET),
      ).toBeUndefined();
      expect(
        q.getClassesWithCategory(session(), dest).find((e) => e.className === WIDGET),
      ).toBeDefined();
    });
  });

  describe('addDictionary', () => {
    it('appends a new dictionary to the symbol list', () => {
      const result = q.addDictionary(session(), 'JasperItNew');

      expect(result).toContain('Added dictionary');
      expect(dictIndexOf('JasperItNew')).toBeGreaterThan(0);
    });
  });

  describe('removeDictionary', () => {
    it('removes a dictionary from the symbol list', () => {
      q.addDictionary(session(), 'JasperItDoomed');
      expect(dictIndexOf('JasperItDoomed')).toBeGreaterThan(0);

      const result = q.removeDictionary(session(), 'JasperItDoomed');

      expect(result).toContain('Removed dictionary');
      expect(dictIndexOf('JasperItDoomed')).toBe(0);
    });
  });

  describe('moveDictionaryUp', () => {
    it('swaps a dictionary one position earlier', () => {
      q.addDictionary(session(), 'JasperItLower');
      q.addDictionary(session(), 'JasperItUpper');
      expect(dictIndexOf('JasperItLower')).toBeLessThan(dictIndexOf('JasperItUpper'));

      q.moveDictionaryUp(session(), dictIndexOf('JasperItUpper'));

      expect(dictIndexOf('JasperItUpper')).toBeLessThan(dictIndexOf('JasperItLower'));
    });
  });

  describe('moveDictionaryDown', () => {
    it('swaps a dictionary one position later', () => {
      q.addDictionary(session(), 'JasperItFirst');
      q.addDictionary(session(), 'JasperItSecond');
      expect(dictIndexOf('JasperItFirst')).toBeLessThan(dictIndexOf('JasperItSecond'));

      q.moveDictionaryDown(session(), dictIndexOf('JasperItFirst'));

      expect(dictIndexOf('JasperItFirst')).toBeGreaterThan(dictIndexOf('JasperItSecond'));
    });
  });
});
