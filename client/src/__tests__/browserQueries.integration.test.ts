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

    /**
     * What the doit does when there is no method to read.
     *
     * Unguarded, it sent `compiledMethodAt:` to whatever the lookup answered and
     * raised `a UndefinedObject does not understand #compiledMethodAt:` into the
     * GCI log, with nothing in the UI to say what had happened — the error a
     * session abort produced on VS Code's next `stat` of a discarded method. The
     * unit tests assert the Smalltalk the guard builds; these assert that a real
     * stone answers `''` rather than raising.
     *
     * The class here is defined and removed inside the harness's own transaction,
     * so nothing is committed and the repository never sees it.
     */
    const GONE_CLASS = 'VsCodeMethodSourceGuardTest';
    const GONE_SELECTOR = 'vsCodeGuardMethod42';

    const defineGuardClass = (): void => {
      const defined = queries.compileClassDefinition(
        session(),
        `Object subclass: '${GONE_CLASS}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`,
      );
      expect(defined).toBe(GONE_CLASS);
    };

    it('answers nothing for a class the symbol list does not bind', () => {
      let source: string | undefined;

      expect(() => {
        source = queries.getMethodSource(session(), 'VsCodeNoSuchClassAtAll', false, 'balance');
      }).not.toThrow();
      expect(source).toBe('');
    });

    it('answers nothing for a class that does not implement the selector', () => {
      defineGuardClass();

      let source: string | undefined;

      expect(() => {
        source = queries.getMethodSource(session(), GONE_CLASS, false, 'neverImplemented');
      }).not.toThrow();
      expect(source).toBe('');
    });

    /**
     * The abort case in miniature: the method reads fine, then the class it lived
     * on goes, and the same read must answer nothing rather than raising. Removing
     * the class in-session is what an abort does to an uncommitted one.
     */
    it('answers nothing once the class the method lived on is gone', () => {
      defineGuardClass();
      queries.compileMethod(
        session(),
        GONE_CLASS,
        false,
        'test-vscode-extension',
        `${GONE_SELECTOR}\n  ^ 42`,
      );
      // The positive control: without it, "answers ''" below would pass just as
      // well if the method had never compiled.
      expect(queries.getMethodSource(session(), GONE_CLASS, false, GONE_SELECTOR)).toContain(
        GONE_SELECTOR,
      );

      expect(queries.deleteClass(session(), 'UserGlobals', GONE_CLASS)).toContain('Deleted class:');

      let source: string | undefined;
      expect(() => {
        source = queries.getMethodSource(session(), GONE_CLASS, false, GONE_SELECTOR);
      }).not.toThrow();
      expect(source).toBe('');
    });

    it('answers nothing for the class side of a class that is gone', () => {
      let source: string | undefined;

      expect(() => {
        source = queries.getMethodSource(session(), 'VsCodeNoSuchClassAtAll', true, 'new');
      }).not.toThrow();
      // `nil class` is UndefinedObject rather than nil, so the receiver guard
      // cannot catch this one — the `otherwise: nil` on the lookup does.
      expect(source).toBe('');
    });

    it('answers nothing when the dictionary it is scoped to does not hold the class', () => {
      defineGuardClass();
      const globals = dictionaryIndexOf('Globals');

      let source: string | undefined;
      expect(() => {
        source = queries.getMethodSource(session(), GONE_CLASS, false, GONE_SELECTOR, 0, globals);
      }).not.toThrow();
      expect(source).toBe('');
    });
  });

  /**
   * GemStone Search's match chip over the Source scope, against a real stone.
   *
   * Every mode is Smalltalk sent to the engine, so the unit tests can only assert
   * the code that gets built. What the engine makes of it — that `substringSearch:`
   * finds all five fixtures, that the boundary filter keeps exactly the two that
   * start a token, and that the fuzzy scan reaches methods the substring scan
   * cannot — is the part only a stone can answer.
   *
   * The term is deliberately distinctive: `foo` returns thousands of image-wide
   * hits and the fixtures drown under the server-side result cap.
   *
   * The class is defined inside the harness's transaction; nothing is committed.
   */
  describe('searchMethodSource scan modes (live)', () => {
    const SRC_CLASS = 'VsCodeSourceScopeProbe';
    const TERM = 'qqzfoo';

    // Each body puts the term in a different lexical position. The selector names
    // deliberately do NOT contain the term — a selector match would make these pass
    // through the selector scan rather than the source scan.
    const BODIES: Record<string, string> = {
      afterLetter: `afterLetter\n  ^ 'bar${TERM}'`,
      afterHump: `afterHump\n  ^ 'doQqzfooling'`,
      afterUnderscore: `afterUnderscore\n  ^ 'x_${TERM}'`,
      atSpace: `atSpace\n  ^ '${TERM} bar'`,
      afterPunctuation: `afterPunctuation\n  ^ '(${TERM})'`,
    };

    const defineProbe = (): void => {
      expect(
        queries.compileClassDefinition(
          session(),
          `Object subclass: '${SRC_CLASS}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`,
        ),
      ).toBe(SRC_CLASS);
      for (const body of Object.values(BODIES)) {
        queries.compileMethod(session(), SRC_CLASS, false, 'test-vscode-extension', body);
      }
      // No explicit organizer reset needed: the cached organizer's class list is a
      // snapshot, and compileClassDefinition already drops it (clearClassOrganizerStatement).
    };

    const selectorsFound = (mode: 'substring' | 'wordStart' | 'fuzzyToken'): string[] =>
      queries
        .searchMethodSource(session(), TERM, true, mode)
        .filter((r) => r.className === SRC_CLASS)
        .map((r) => r.selector)
        .sort();

    it('finds the term wherever it appears when not narrowed', () => {
      defineProbe();

      // The positive control: without it, the narrowed assertion below would pass
      // just as well if the fixtures had never compiled.
      expect(selectorsFound('substring')).toEqual(Object.keys(BODIES).sort());
    });

    it('keeps only the matches that start a token when narrowed', () => {
      defineProbe();

      expect(selectorsFound('wordStart')).toEqual(['afterPunctuation', 'atSpace']);
    });

    /**
     * The camelCase case on its own, because it is the one that separates this rule
     * from `omniMatch.isWordStart`: that helper counts a hump as a word start, which
     * would keep `doQqzfooling` — the mid-word noise the setting exists to remove.
     */
    it('does not count a camelCase hump as the start of a token', () => {
      defineProbe();

      expect(selectorsFound('substring')).toContain('afterHump');
      expect(selectorsFound('wordStart')).not.toContain('afterHump');
    });

    /**
     * Fuzzy is a SUBSEQUENCE, so it cannot ride on the engine's substring scan —
     * the methods it must find contain no contiguous run of the query. It is also
     * per-identifier rather than per-body: letters-in-order across 370 characters
     * of source matches nearly anything, which is what makes the naive reading
     * useless. These assert both halves against a real stone.
     */
    it('finds a token whose characters contain the query in order', () => {
      defineProbe();
      // 'qfo' is a subsequence of 'qqzfoo' (q…f-o) but appears in no body as a
      // contiguous run, so the engine's substring scan finds nothing. That control is
      // what proves fuzzy is a different scan and not the substring one renamed.
      expect(
        queries.searchMethodSource(session(), 'qfo', true, 'substring').map((r) => r.className),
      ).not.toContain(SRC_CLASS);

      const fuzzy = queries
        .searchMethodSource(session(), 'qfo', true, 'fuzzyToken')
        .filter((r) => r.className === SRC_CLASS)
        .map((r) => r.selector);

      expect(fuzzy).toContain('atSpace');
    });

    it('does not let a subsequence straddle two identifiers', () => {
      defineProbe();

      // 'qb' is in 'qqzfoo bar' letter-by-letter, but only by crossing the space —
      // per-identifier matching is the whole reason fuzzy over source is usable.
      const fuzzy = queries
        .searchMethodSource(session(), 'qzb', true, 'fuzzyToken')
        .filter((r) => r.className === SRC_CLASS);

      expect(fuzzy).toEqual([]);
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

  /**
   * What a comment EDITOR opens on, as opposed to what the hover shows.
   *
   * `Class>>comment` synthesises a placeholder ("No class-specific documentation
   * for X…", plus a rendered hierarchy) for a class with no `#comment` key, so it
   * cannot answer "is there a comment?" and must not reach an editable document:
   * Ctrl+Z would land on the boilerplate and saving would write it in as a real
   * comment. The divergence between the two accessors is the whole basis of that
   * fix, and only a live stone can show that the placeholder is really there.
   *
   * The class is defined inside the harness's transaction; nothing is committed.
   */
  describe('getStoredClassComment', () => {
    const COMMENT_CLASS = 'VsCodeStoredCommentTest';

    const defineCommentClass = (): void => {
      expect(
        queries.compileClassDefinition(
          session(),
          `Object subclass: '${COMMENT_CLASS}'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: UserGlobals
  options: #()`,
        ),
      ).toBe(COMMENT_CLASS);
    };

    it('answers empty for a class with no comment, where getClassComment does not', () => {
      defineCommentClass();

      expect(queries.getStoredClassComment(session(), COMMENT_CLASS)).toBe('');
      // The other half of the contract: the accessor the hover uses really does
      // invent text here, so "both answer the same thing" cannot be why this passes.
      const synthesised = queries.getClassComment(session(), COMMENT_CLASS);
      expect(synthesised.length).toBeGreaterThan(0);
      expect(synthesised).toContain(COMMENT_CLASS);
    });

    it('answers the text a save actually stored', () => {
      defineCommentClass();
      queries.setClassComment(session(), COMMENT_CLASS, 'A stored comment.');

      expect(queries.getStoredClassComment(session(), COMMENT_CLASS)).toBe('A stored comment.');
    });

    /** The undo round trip: a comment added and then emptied leaves no comment. */
    it('goes back to empty once the comment is emptied', () => {
      defineCommentClass();
      queries.setClassComment(session(), COMMENT_CLASS, 'A stored comment.');
      expect(queries.getStoredClassComment(session(), COMMENT_CLASS)).not.toBe('');

      queries.setClassComment(session(), COMMENT_CLASS, '');

      expect(queries.getStoredClassComment(session(), COMMENT_CLASS)).toBe('');
      // Not an empty comment but NO comment — so the placeholder is back.
      expect(queries.getClassComment(session(), COMMENT_CLASS)).toContain(COMMENT_CLASS);
    });

    it('answers empty for a class that does not exist at all', () => {
      let stored: string | undefined;

      expect(() => {
        stored = queries.getStoredClassComment(session(), 'VsCodeNoSuchClassAtAll');
      }).not.toThrow();
      expect(stored).toBe('');
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
