// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement. SKIPS on anything else.
//
// What file in preserves, on a live stone.
//
// The fixpoint suite next door proves the round trip for ONE class shape: a plain
// `Object subclass:` in UserGlobals with no options, no pools and no constraints,
// built by hand in the test. Everything outside that shape passed vacuously — and
// three real defects lived in exactly that gap:
//
//   * every BYTE class failed file in, because Rowan answers the class type as
//     'byteSubclass' and the creation map was keyed on 'bytes';
//   * `#gs_options` (145 classes in the shipped 3.7.5 corpus) was written out and
//     silently dropped coming back, so a dbTransient class returned persistent;
//   * the class CATEGORY was dropped the same way, moving the class in the
//     Explorer's Categories pane.
//
// Each case here files a real class out and back in and asserts the property
// survived. They are deliberately NOT text fixpoints: a fixpoint proves the two
// halves agree with each other, and these defects were cases where both halves
// agreed on the wrong thing.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../../gciLibrary';
import * as q from '../../../browserQueries';
import type { ActiveSession } from '../../../sessionManager';
import { fileOutClassTonel } from '../fileOutClassTonel';
import { isTonelFileOutError } from '../rowanLookup';
import { readTonelClass } from '../readTonelClass';
import { applyTonelClass } from '../../../fileTransfer/tonelFileIn';
import { useRowan3Stone } from './useRowan3Stone';

const SOURCE = 'JasperFidelitySource';
const COPY = 'JasperFidelityCopy';

describe('tonel file in fidelity (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = async (code: string): Promise<string> => await q.executeFetchString(session(), code);
  const rowan3 = useRowan3Stone(() => exec);

  const fileOut = async (className: string, dict?: string): Promise<string> => {
    const tonel = await fileOutClassTonel(exec, className, dict);
    expect(isTonelFileOutError(tonel), `file out failed: ${tonel}`).toBe(false);
    return tonel;
  };

  const renamed = (tonel: string): string => tonel.split(SOURCE).join(COPY);

  const fileIn = async (tonel: string, dictionary = 'UserGlobals') => {
    const read = await readTonelClass(exec, tonel);
    expect(read.ok, `parse failed: ${read.ok ? '' : read.error}`).toBe(true);
    if (!read.ok) throw new Error(read.error);
    return await applyTonelClass(session(), read.tonelClass, dictionary);
  };

  /** `expr` evaluated on the stone, trimmed. */
  const value = async (expr: string): Promise<string> =>
    (await exec(`(${expr}) printString`)).trim();

  describe('the class SHAPE survives', () => {
    it('a byte class comes back a byte class', async (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      // The defect: Rowan writes `#type : 'byteSubclass'` and the creation map was
      // keyed on 'bytes', so this failed with "Unsupported class type". Keying it
      // right then hit the second half — `byteSubclass:` takes no instVarNames:.
      await q.compileClassDefinition(
        session(),
        `Object byteSubclass: '${SOURCE}' classVars: #() classInstVars: #() ` +
          `poolDictionaries: #() inDictionary: UserGlobals`,
      );
      await q.compileMethod(session(), SOURCE, false, 'accessing', 'tag\n\t^42');

      const tonel = renamed(await fileOut(SOURCE));
      expect(tonel).toContain("#type : 'byteSubclass'");

      const outcome = await fileIn(tonel);
      expect(outcome.errors).toEqual([]);
      expect(await value(`${COPY} isBytes`)).toBe('true');
    });

    it('an indexable class comes back indexable', async (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      await q.compileClassDefinition(
        session(),
        `Object indexableSubclass: '${SOURCE}' instVarNames: #('a') classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals`,
      );

      const outcome = await fileIn(renamed(await fileOut(SOURCE)));
      expect(outcome.errors).toEqual([]);
      expect(await value(`${COPY} isIndexable`)).toBe('true');
      expect(await value(`${COPY} isBytes`)).toBe('false');
    });

    it('a plain class does NOT come back indexable or byte', async (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      // The other direction, so a map that answered `byteSubclass:` for everything
      // could not pass this suite.
      await q.compileClassDefinition(
        session(),
        `Object subclass: '${SOURCE}' instVarNames: #('a') classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals`,
      );

      await fileIn(renamed(await fileOut(SOURCE)));
      expect(await value(`${COPY} isIndexable`)).toBe('false');
      expect(await value(`${COPY} isBytes`)).toBe('false');
    });
  });

  describe('the class PROPERTIES survive', () => {
    it('#gs_options survives the round trip', async (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      // dbTransient changes what the class IS. Dropped silently, the copy is an
      // ordinary persistent class that looks like it filed in cleanly.
      await q.compileClassDefinition(
        session(),
        `Object subclass: '${SOURCE}' instVarNames: #('a') classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals ` +
          `options: #(dbTransient)`,
      );

      const tonel = renamed(await fileOut(SOURCE));
      expect(tonel).toContain('dbTransient');

      const outcome = await fileIn(tonel);
      expect(outcome.errors).toEqual([]);
      // The live behavioural property, not the option list we wrote — so this
      // fails if the option travelled as text but did not take effect.
      expect(await value(`${COPY} instancesDbTransient`)).toBe('true');
      expect(await fileOut(COPY)).toContain('dbTransient');
    });

    it('the class category survives the round trip', async (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      // No creation selector carries #category, so it has to be applied separately.
      // Dropped, the class lands with no category and moves in the Categories pane.
      await q.compileClassDefinition(
        session(),
        `Object subclass: '${SOURCE}' instVarNames: #('a') classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals`,
      );
      await q.recategorizeClass(session(), SOURCE, 'Jasper-Fidelity-Category');

      const outcome = await fileIn(renamed(await fileOut(SOURCE)));
      expect(outcome.errors).toEqual([]);
      expect(await value(`${COPY} category`)).toBe("'Jasper-Fidelity-Category'");
    });

    it('names a property it does not apply rather than dropping it silently', async (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      await q.compileClassDefinition(
        session(),
        `Object subclass: '${SOURCE}' instVarNames: #('a') classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals`,
      );
      // Rowan writes gs_reservedoop for base classes; inject it so the case does
      // not depend on finding a writable base class.
      const withOop = renamed(await fileOut(SOURCE)).replace(
        "#superclass : 'Object',",
        "#superclass : 'Object',\n\t#gs_reservedoop : '12345',",
      );

      const outcome = await fileIn(withOop);
      expect(outcome.errors.map((e) => e.message).join('\n')).toContain('gs_reservedoop');
      // Named, but the class still files in.
      expect(await q.dictionariesContainingClass(session(), COPY)).toEqual(['UserGlobals']);
    });
  });

  describe('non-ASCII content', () => {
    it('survives file out and file in', async (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      // `ws contents asString` on the file-out side was suspected of raising for a
      // codepoint above 255. It does not — GemStone promotes the String — but
      // nothing pinned it, in either direction.
      await q.compileClassDefinition(
        session(),
        `Object subclass: '${SOURCE}' instVarNames: #('a') classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals`,
      );
      await q.setClassComment(session(), SOURCE, 'Comment with café, 中文 and 😀.');
      await q.compileMethod(session(), SOURCE, false, 'accessing', "label\n\t^'café 中文 😀'");

      const tonel = renamed(await fileOut(SOURCE));
      expect(tonel).toContain('café');
      expect(tonel).toContain('中文');
      expect(tonel).toContain('😀');

      const outcome = await fileIn(tonel);
      expect(outcome.errors).toEqual([]);
      expect((await fileOut(COPY)).split(COPY).join(SOURCE)).toBe(tonel.split(COPY).join(SOURCE));
    });
  });

  describe('the chosen dictionary is the one written', () => {
    // The defect: only the class DEFINITION honoured the choice. The comment, the
    // method clear and every compile resolved the bare name, which binds to the
    // FIRST dictionary in the symbol list — so choosing the second one gutted the
    // first one's class and left the chosen one with a definition and no methods.
    const FIRST = 'JasperFidelityFirstDict';

    /** Put a writable dictionary AHEAD of UserGlobals, holding its own SOURCE. */
    const twoDictionaries = async (): Promise<void> => {
      await exec(
        `| d | d := SymbolDictionary new name: #'${FIRST}'; yourself. ` +
          `UserGlobals at: #'${FIRST}' put: d. ` +
          `System myUserProfile insertDictionary: d at: 1. 'ok'`,
      );
      await q.compileClassDefinition(
        session(),
        `Object subclass: '${SOURCE}' instVarNames: #() classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: ${FIRST}`,
      );
      // Scoped deliberately: an unscoped compile here would bind the bare name to
      // the dictionary at position 1 and put both markers on the same class,
      // making the fixture agree with the bug it is meant to catch.
      await q.compileMethod(session(), SOURCE, false, 'accessing', 'marker\n\t^#first', 0, FIRST);
      await q.compileClassDefinition(
        session(),
        `Object subclass: '${SOURCE}' instVarNames: #() classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals`,
      );
      await q.compileMethod(
        session(),
        SOURCE,
        false,
        'accessing',
        'marker\n\t^#second',
        0,
        'UserGlobals',
      );
    };

    it('leaves the same-named class in the earlier dictionary untouched', async (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      await twoDictionaries();
      expect(await q.dictionariesContainingClass(session(), SOURCE)).toEqual([
        FIRST,
        'UserGlobals',
      ]);

      const outcome = await fileIn(await fileOut(SOURCE, 'UserGlobals'), 'UserGlobals');
      expect(outcome.errors).toEqual([]);

      // With the bug this answered an empty method list: removeAllMethods bound
      // the bare name to the FIRST dictionary and emptied the wrong class.
      expect(await value(`(${FIRST} at: #'${SOURCE}') selectors size`)).toBe('1');
      expect(await value(`(${FIRST} at: #'${SOURCE}') new marker`)).toBe("#'first'");
    });

    it('writes the methods into the chosen dictionary’s class', async (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      await twoDictionaries();

      const outcome = await fileIn(await fileOut(SOURCE, 'UserGlobals'), 'UserGlobals');
      expect(outcome.compiled).toBe(1);
      expect(await value(`(UserGlobals at: #'${SOURCE}') new marker`)).toBe("#'second'");
    });
  });
});
