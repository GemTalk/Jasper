import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock vscode since browserQueries → gciLog → vscode
vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
  },
}));

import { GciLibrary } from '../gciLibrary';
import { GCI_LIBRARY_PATH, STONE_NRS, GEM_NRS, GS_USER, GS_PASSWORD } from './gci/gciTestConfig';
import { ActiveSession } from '../sessionManager';
import { GemStoneLogin } from '../loginTypes';
import * as queries from '../browserQueries';

describe('Browser Queries (integration)', () => {
  let gci: GciLibrary;
  let session: ActiveSession;

  beforeAll(() => {
    gci = new GciLibrary(GCI_LIBRARY_PATH);
    const login = gci.GciTsLogin(STONE_NRS, null, null, false, GEM_NRS, GS_USER, GS_PASSWORD, 0, 0);
    expect(login.session).not.toBeNull();

    session = {
      id: 1,
      gci,
      handle: login.session,
      login: { label: 'Test' } as GemStoneLogin,
      stoneVersion: '3.7.2',
    };
  });

  afterAll(() => {
    if (session?.handle) {
      gci.GciTsLogout(session.handle);
    }
    gci.close();
  });

  describe('getDictionaryNames', () => {
    it('returns an array of dictionary names', () => {
      const names = queries.getDictionaryNames(session);
      expect(Array.isArray(names)).toBe(true);
      expect(names.length).toBeGreaterThan(0);
      // DataCurator should have at least UserGlobals and Globals
      expect(names).toContain('UserGlobals');
      expect(names).toContain('Globals');
    });
  });

  describe('getClassNames', () => {
    it('returns class names from Globals', () => {
      const globalsIndex = queries.getDictionaryNames(session).indexOf('Globals') + 1;
      const names = queries.getClassNames(session, globalsIndex);
      expect(Array.isArray(names)).toBe(true);
      expect(names.length).toBeGreaterThan(0);
      // Array and String should be in Globals
      expect(names).toContain('Array');
      expect(names).toContain('String');
    });

    it('returns sorted names', () => {
      const globalsIndex = queries.getDictionaryNames(session).indexOf('Globals') + 1;
      const names = queries.getClassNames(session, globalsIndex);
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    });
  });

  describe('getMethodCategories', () => {
    it('returns categories for instance side', () => {
      const categories = queries.getMethodCategories(session, 'Array', false);
      expect(Array.isArray(categories)).toBe(true);
      expect(categories.length).toBeGreaterThan(0);
    });

    it('returns categories for class side', () => {
      const categories = queries.getMethodCategories(session, 'Array', true);
      expect(Array.isArray(categories)).toBe(true);
      // Class side may have fewer categories but should still have some
    });
  });

  describe('getMethodSource', () => {
    it('returns source for a known method', () => {
      // getAllSelectors includes inherited selectors, which getMethodSource
      // can't look up (it only finds methods Array implements itself) — use
      // getMethodList, which is scoped to locally-implemented methods.
      const instanceMethods = queries.getMethodList(session, 'Array').filter((m) => !m.isMeta);
      expect(instanceMethods.length).toBeGreaterThan(0);

      const source = queries.getMethodSource(session, 'Array', false, instanceMethods[0].selector);
      expect(typeof source).toBe('string');
      expect(source.length).toBeGreaterThan(0);
    });
  });

  describe('getClassDefinition', () => {
    it('returns a definition string for Array', () => {
      const def = queries.getClassDefinition(session, 'Array');
      expect(typeof def).toBe('string');
      expect(def.length).toBeGreaterThan(0);
      // Should mention Array somewhere
      expect(def).toContain('Array');
    });
  });

  describe('getClassComment', () => {
    it('returns a comment string for Array', () => {
      const comment = queries.getClassComment(session, 'Array');
      expect(typeof comment).toBe('string');
      // Comment might be empty for some classes, that's OK
    });
  });

  describe('compileMethod and deleteMethod', () => {
    // Use a user-owned class instead of Array (system classes are protected
    // by SystemObjectSecurityPolicy and DataCurator can't modify them).
    const testClass = 'VsCodeBrowserTest';
    const testCategory = 'test-vscode-extension';
    const testSelector = 'vsCodeTestMethod42';
    const testSource = `${testSelector}\n  "test method"\n  ^ 42`;

    beforeAll(() => {
      // Create a temporary class in UserGlobals that DataCurator owns
      queries.compileClassDefinition(
        session,
        `Object subclass: '${testClass}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`,
      );
    });

    afterAll(() => {
      // Cleanup: remove the test method if it exists, then the class
      try {
        queries.deleteMethod(session, testClass, false, testSelector);
      } catch {
        // ignore if not there
      }
      try {
        const ugIndex = queries.getDictionaryNames(session).indexOf('UserGlobals') + 1;
        queries.deleteClass(session, ugIndex, testClass);
      } catch {
        // ignore
      }
    });

    it('compiles a method, reads it back, then deletes it', () => {
      const compiled = queries.compileMethod(session, testClass, false, testCategory, testSource);
      expect(compiled).not.toBe(0n);

      const source = queries.getMethodSource(session, testClass, false, testSelector);
      expect(source).toContain(testSelector);

      const afterCompile = queries.getAllSelectors(session, testClass);
      expect(afterCompile).toContain(testSelector);

      queries.deleteMethod(session, testClass, false, testSelector);

      const afterDelete = queries.getAllSelectors(session, testClass);
      expect(afterDelete).not.toContain(testSelector);
    });
  });
});
