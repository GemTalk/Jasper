// Writing a Tonel class description into a live stone.
//
// File in has two halves: Rowan's reader parses the file into a TonelClass, then
// applyTonelClass builds the class from it with ordinary GemStone calls. These
// tests build the TonelClass by hand, so they need no Rowan and run on every
// stone in the CI matrix. Rowan's own Rowan-Tests package covers the reader.
//
// The class types are Rowan's spellings (`normal`, `variable`, `byteSubclass`), as
// its reader answers them on a 3.7.5 rowan3 stone — see CREATION_SELECTOR in
// ../tonelFileIn.ts.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';
import { applyTonelClass } from '../tonelFileIn';
import type { TonelClass } from '../../queries/tonel/tonelWire';
import { testActiveSession } from '../../__tests__/testActiveSession';
import { knownGemStoneBugs, skipForKnownGemStoneBug } from '../../__tests__/knownGemStoneBugs';

const PROBE = 'JasperTonelFileInProbe';

/** A byte class has no named instance variables, so this is the method it can keep. */
const MAKE = {
  isMeta: true,
  selector: 'make',
  category: 'instance creation',
  source: 'make\n\t^self new',
};

const probe = (overrides: Partial<TonelClass> = {}): TonelClass => ({
  name: PROBE,
  superclass: 'Object',
  type: 'normal',
  category: 'Jasper-TonelFileIn',
  comment: 'A file-in probe.',
  instVars: ['size'],
  classVars: [],
  classInstVars: [],
  pools: [],
  options: [],
  uncarried: [],
  methods: [
    { isMeta: false, selector: 'size', category: 'accessing', source: 'size\n\t^size' },
    MAKE,
  ],
  ...overrides,
});

describe('tonel file in (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => testActiveSession(gci, handle);
  const exec = (code: string): string => q.executeFetchString(session(), code);
  const value = (expr: string): string => exec(`(${expr}) printString`).trim();

  const fileIn = (tonelClass: TonelClass, dictionary = 'UserGlobals') =>
    applyTonelClass(session(), tonelClass, dictionary);

  describe('replacing the class', () => {
    it('removes a method the file does not carry', () => {
      fileIn(probe());
      q.compileMethod(session(), PROBE, false, 'accessing', 'addedLater\n\t^42');
      q.compileMethod(session(), PROBE, true, 'accessing', 'addedLater\n\t^42');

      const outcome = fileIn(probe());

      expect(outcome.errors).toEqual([]);
      expect(value(`${PROBE} includesSelector: #addedLater`)).toBe('false');
      expect(value(`${PROBE} class includesSelector: #addedLater`)).toBe('false');
      expect(value(`${PROBE} includesSelector: #size`)).toBe('true');
    });

    it('reports an unresolvable superclass and creates nothing', () => {
      const outcome = fileIn(probe({ superclass: 'JasperNoSuchSuperclass' }));

      expect(outcome.errors).toHaveLength(1);
      expect(outcome.errors[0].message).toContain('JasperNoSuchSuperclass');
      expect(q.dictionariesContainingClass(session(), PROBE)).toEqual([]);
    });

    it('files into the dictionary it is told to, not one the category names', () => {
      // Tonel's #category is a package, never a SymbolDictionary, so a category
      // that happens to spell a dictionary's name must not pick the target.
      fileIn(probe({ category: 'Globals' }), 'UserGlobals');

      expect(q.dictionariesContainingClass(session(), PROBE)).toEqual(['UserGlobals']);
    });

    it('leaves the session dirty rather than committing', () => {
      // The harness's commit guard would fail the run on a commit; this states the
      // intent outright.
      fileIn(probe());

      expect(value('System needsCommit')).toBe('true');
    });
  });

  describe('the class shape', () => {
    it('builds a byte class from a byte class description', () => {
      const outcome = fileIn(probe({ type: 'byteSubclass', instVars: [], methods: [MAKE] }));

      expect(outcome.errors).toEqual([]);
      expect(value(`${PROBE} isBytes`)).toBe('true');
    });

    it('builds an indexable class from a variable class description', () => {
      const outcome = fileIn(probe({ type: 'variable' }));

      expect(outcome.errors).toEqual([]);
      expect(value(`${PROBE} isIndexable`)).toBe('true');
      expect(value(`${PROBE} isBytes`)).toBe('false');
    });

    it('builds a plain class that is neither indexable nor byte', () => {
      // The other direction, so a map that answered `byteSubclass:` for everything
      // could not pass.
      const outcome = fileIn(probe({ type: 'normal' }));

      expect(outcome.errors).toEqual([]);
      expect(value(`${PROBE} isIndexable`)).toBe('false');
      expect(value(`${PROBE} isBytes`)).toBe('false');
    });
  });

  describe('the class properties', () => {
    it('applies the class options the file carries', () => {
      // The live property, not the option list, so an option that travelled as
      // text but did not take effect still fails.
      const outcome = fileIn(probe({ options: ['dbTransient'] }));

      expect(outcome.errors).toEqual([]);
      expect(value(`${PROBE} instancesDbTransient`)).toBe('true');
    });

    it('applies the class category', () => {
      // No creation selector carries a category, so it is applied separately.
      const outcome = fileIn(probe({ category: 'Jasper-TonelFileIn-Category' }));

      expect(outcome.errors).toEqual([]);
      expect(value(`${PROBE} category`)).toBe("'Jasper-TonelFileIn-Category'");
    });

    it('names a property it does not apply, and still files the class in', () => {
      const outcome = fileIn(probe({ uncarried: ['gs_reservedoop'] }));

      expect(outcome.errors.map((e) => e.message).join('\n')).toContain('gs_reservedoop');
      expect(q.dictionariesContainingClass(session(), PROBE)).toEqual(['UserGlobals']);
    });
  });

  describe('non-ASCII content', () => {
    it('carries the comment and method source in intact', (ctx) => {
      skipForKnownGemStoneBug(knownGemStoneBugs.nonAsciiSourceCompile, ctx, session());
      const label = "label\n\t^'café 中文 😀'";

      const outcome = fileIn(
        probe({
          comment: 'Comment with café, 中文 and 😀.',
          methods: [{ isMeta: false, selector: 'label', category: 'accessing', source: label }],
        }),
      );

      expect(outcome.errors).toEqual([]);
      expect(exec(`${PROBE} comment`)).toBe('Comment with café, 中文 and 😀.');
      expect(exec(`(${PROBE} compiledMethodAt: #label) sourceString`)).toBe(label);
    });
  });

  describe('two dictionaries holding the same class name', () => {
    // Only the class definition once honoured the chosen dictionary: the comment,
    // the method clear and every compile resolved the bare name, which binds to the
    // first dictionary in the symbol list, so filing into the second gutted the
    // first one's class.
    const FIRST = 'JasperTonelFileInFirstDict';

    /** A writable dictionary AHEAD of UserGlobals, holding its own PROBE with `marker`. */
    const earlierDictionaryWithProbe = (): void => {
      exec(
        `| d | d := SymbolDictionary new name: #'${FIRST}'; yourself. ` +
          `UserGlobals at: #'${FIRST}' put: d. ` +
          `System myUserProfile insertDictionary: d at: 1. 'ok'`,
      );
      q.compileClassDefinition(
        session(),
        `Object subclass: '${PROBE}' instVarNames: #() classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: ${FIRST}`,
      );
      // Scoped deliberately: an unscoped compile binds the bare name to whatever
      // dictionary comes first, which is the bug under test.
      q.compileMethod(session(), PROBE, false, 'accessing', 'marker\n\t^#first', 0, FIRST);
      q.compileClassDefinition(
        session(),
        `Object subclass: '${PROBE}' instVarNames: #() classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals`,
      );
    };

    const withMarker = (): TonelClass =>
      probe({
        instVars: [],
        methods: [
          {
            isMeta: false,
            selector: 'marker',
            category: 'accessing',
            source: 'marker\n\t^#second',
          },
        ],
      });

    it('leaves the same-named class in the earlier dictionary untouched', () => {
      earlierDictionaryWithProbe();
      expect(q.dictionariesContainingClass(session(), PROBE)).toEqual([FIRST, 'UserGlobals']);

      const outcome = fileIn(withMarker(), 'UserGlobals');

      expect(outcome.errors).toEqual([]);
      expect(value(`(${FIRST} at: #'${PROBE}') selectors size`)).toBe('1');
      expect(value(`(${FIRST} at: #'${PROBE}') new marker`)).toBe("#'first'");
    });

    it('writes the methods into the chosen dictionary’s class', () => {
      // The chosen class starts WITHOUT `marker`, so only the file can supply it.
      earlierDictionaryWithProbe();
      expect(value(`(UserGlobals at: #'${PROBE}') includesSelector: #marker`)).toBe('false');

      const outcome = fileIn(withMarker(), 'UserGlobals');

      expect(outcome.compiled).toBe(1);
      expect(value(`(UserGlobals at: #'${PROBE}') new marker`)).toBe("#'second'");
    });
  });
});
