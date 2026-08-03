import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { GciLibrary } from '../gciLibrary';
import * as queries from '../browserQueries';
import type { ActiveSession } from '../sessionManager';
import { useIntegrationTest } from './useIntegrationTest';
import { testActiveSession } from './testActiveSession';

/**
 * The System Browser's queries against a real stone. browserQueries.test.ts
 * asserts the Smalltalk each one builds; these assert what the stone actually
 * answers, which is what catches a selector that no longer exists or a
 * result shape the parser mis-reads.
 *
 * Ungated: every query here needs only a running stone.
 */
describe('browser queries (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;

  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  /**
   * The live session the queries run against, assembled from the same test
   * environment the harness logs in with (`testActiveSession` reads it via
   * `resolveTestConnection`), so it carries a real `login`. Every query here
   * is ungated and needs only a running stone, but building the full session
   * keeps `login`-dependent queries (e.g. `forkGemRunning`) reachable from
   * this file.
   */
  const session = (): ActiveSession => testActiveSession(gci, handle);

  /** The one-based index `getClassNames` wants for the named dictionary. */
  const dictionaryIndexOf = (name: string): number => {
    const index = queries.getDictionaryNames(session()).indexOf(name) + 1;
    // A missing name would answer 0, which reads as a valid argument and fails
    // downstream instead of here.
    expect(index).toBeGreaterThan(0);

    return index;
  };

  describe('getDictionaryNames', () => {
    it('lists the symbol dictionaries the user can see', () => {
      const names = queries.getDictionaryNames(session());

      expect(names).toContain('UserGlobals');
      expect(names).toContain('Globals');
    });
  });

  describe('getClassNames', () => {
    it('lists the classes a dictionary holds', () => {
      const names = queries.getClassNames(session(), dictionaryIndexOf('Globals'));

      expect(names).toContain('Array');
      expect(names).toContain('String');
    });

    it('lists them in alphabetical order', () => {
      const names = queries.getClassNames(session(), dictionaryIndexOf('Globals'));

      expect(names).toEqual([...names].sort());
    });
  });

  describe('getMethodCategories', () => {
    it('lists the instance-side categories of a class', () => {
      const categories = queries.getMethodCategories(session(), 'Array', false);

      expect(categories.length).toBeGreaterThan(0);
    });

    it('answers the class side without error', () => {
      // A class side legitimately has no categories of its own, so completing
      // the round-trip is the whole guarantee here.
      expect(() => queries.getMethodCategories(session(), 'Array', true)).not.toThrow();
    });
  });

  describe('getMethodSource', () => {
    it('returns the source of a method the class implements itself', () => {
      // getAllSelectors includes inherited selectors, which getMethodSource
      // can't look up; getMethodList is scoped to local implementations.
      const [firstMethod] = queries.getMethodList(session(), 'Array').filter((m) => !m.isMeta);
      expect(firstMethod).toBeDefined();

      const source = queries.getMethodSource(session(), 'Array', false, firstMethod.selector);

      expect(source.length).toBeGreaterThan(0);
    });
  });

  describe('getClassDefinition', () => {
    it('returns a definition naming the class it describes', () => {
      const definition = queries.getClassDefinition(session(), 'Array');

      expect(definition).toContain('Array');
    });
  });

  describe('getClassComment', () => {
    it('answers the comment of a class without error', () => {
      // A class is allowed to have an empty comment, and what a kernel class
      // says about itself is the release's business — so completing the
      // round-trip is the whole guarantee here.
      expect(() => queries.getClassComment(session(), 'Array')).not.toThrow();
    });
  });

  describe('compileMethod and deleteMethod', () => {
    // System classes belong to SystemObjectSecurityPolicy and the test user
    // can't modify them, so compile against a class we define here. The
    // harness aborts afterward, so it never reaches the repository.
    const TEST_CLASS = 'VsCodeBrowserTest';
    const TEST_SELECTOR = 'vsCodeTestMethod42';

    const defineTestClass = (): void => {
      const defined = queries.compileClassDefinition(
        session(),
        `Object subclass: '${TEST_CLASS}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`,
      );

      // The query answers the new class's name; anything else means the
      // fixture never got defined and every assertion below is meaningless.
      expect(defined).toBe(TEST_CLASS);
    };

    it('adds a method the class then reports as its own', () => {
      defineTestClass();

      const compiled = queries.compileMethod(
        session(),
        TEST_CLASS,
        false,
        'test-vscode-extension',
        `${TEST_SELECTOR}\n  "test method"\n  ^ 42`,
      );

      expect(compiled).toBe(`Compiled: ${TEST_CLASS} >> ${TEST_SELECTOR}`);
      expect(queries.getMethodSource(session(), TEST_CLASS, false, TEST_SELECTOR)).toContain(
        TEST_SELECTOR,
      );
      expect(queries.getAllSelectors(session(), TEST_CLASS)).toContain(TEST_SELECTOR);
    });

    it('removes a method the class no longer reports', () => {
      defineTestClass();
      queries.compileMethod(
        session(),
        TEST_CLASS,
        false,
        'test-vscode-extension',
        `${TEST_SELECTOR}\n  ^ 42`,
      );

      queries.deleteMethod(session(), TEST_CLASS, false, TEST_SELECTOR);

      expect(queries.getAllSelectors(session(), TEST_CLASS)).not.toContain(TEST_SELECTOR);
    });
  });
});
