// SUPPORTED CONFIGURATION: GemStone 3.7.5+ on a rowan3 extent — see
// `../tonelCapability` for the full statement. SKIPS on anything else, which is
// the correct outcome there, not a pass.
//
// Tonel class file-out against a live stone, judged by the three oracles in
// `./tonelOracles` rather than a whole-file diff — see that file for why a diff
// is the wrong test.
//
// Runs as the harness's configured user (DataCurator), deliberately NOT
// SystemUser: DataCurator cannot see the Rowan dictionaries directly, so passing
// here is what proves the reach-through in `../rowanLookup` works for the user
// who needs it.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../../__mocks__/vscode.js'));

import * as fs from 'fs';
import * as path from 'path';
import { useIntegrationTest } from '../../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../../gciLibrary';
import * as q from '../../../browserQueries';
import type { ActiveSession } from '../../../sessionManager';
import { fileOutClassTonel, isTonelFileOutError } from '../fileOutClassTonel';
import {
  headerOf,
  methodBlocksOf,
  declarationsOf,
  declarationSequenceOf,
  duplicateDeclarationsOf,
} from './tonelOracles';
import { useRowan3Stone } from './useRowan3Stone';

// Reference files are named by PACKAGE, never found by class name alone:
// `GsRowanImageTool` and `GsTopazRowanTool` each exist twice in the corpus, once
// under GemStone-RowanV2-Tools and once under GemStone-RowanV3-Tools, and the
// image holds the V3 one. Searching by name picks whichever comes first and
// compares against the wrong file.
const FIXTURES = [
  // Chosen for header shape: instVars, and a comment above the Class block.
  // (It carries neither #gs_reservedoop nor #gs_options — an earlier version of
  // this comment said it did. Classes that carry those are covered by
  // tonelFileInFidelity.integration.test.ts, which asserts they survive a round
  // trip rather than only that they are written.)
  //
  // `Message` carries a second job: it DISCRIMINATES between the two plausible
  // method comparators. The corpus emits `sends:` before `sendTo:`
  // (`_unicodeLessThan:`); `codePointCompareTo:` orders them the other way. So
  // the method-order case below actually fails if the sort is changed, rather
  // than passing by luck — as it would on a class where the two agree.
  { className: 'Message', package: 'Filein1C' },
  { className: 'SystemLoginNotification', package: 'Filein2A' },
  { className: 'NscBuilder', package: 'Filein2A' },
] as const;

describe('tonel class file out (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);
  const rowan3 = useRowan3Stone(() => exec);

  /** The shipped `.class.st` this class was written from. */
  const referenceFor = (fixture: (typeof FIXTURES)[number]): string => {
    const gemstone = path.resolve(
      path.dirname(process.env.VITE_GEMSTONE_GCI_LIBRARY_PATH ?? ''),
      '..',
    );
    const file = path.join(
      gemstone,
      'projects/gemstoneBaseImage/rowan/src',
      fixture.package,
      `${fixture.className}.class.st`,
    );
    // Asserted rather than skipped: if the capability probe passed we are on a
    // 3.7.5 rowan3 stone, so the corpus is part of that product tree. Its absence
    // is a real problem worth failing on.
    expect(fs.existsSync(file), `reference corpus missing: ${file}`).toBe(true);
    return fs.readFileSync(file, 'utf8');
  };

  /**
   * What the class itself defines, both sides — the completeness contract.
   *
   * Trait-provided methods are excluded, matching the file-out: traits are not a
   * supported Jasper feature and a trait's methods are not the class's own code.
   */
  const imageSelectors = (className: string): { instance: string[]; meta: string[] } => {
    const read = (receiver: string): string[] => {
      const raw = exec(
        `| c ws | c := System myUserProfile symbolList objectNamed: #'${className}'. ` +
          `ws := WriteStream on: String new. ` +
          `${receiver} selectors do: [:s | | m | ` +
          `m := ${receiver} compiledMethodAt: s otherwise: nil. ` +
          `(m notNil and: [m isFromTrait not]) ifTrue: [ws nextPutAll: s asString; lf]]. ` +
          `ws contents`,
      );
      return raw
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .sort();
    };
    return { instance: read('c'), meta: read('c class') };
  };

  const fileOut = (className: string): string => {
    const tonel = fileOutClassTonel(exec, className);
    expect(isTonelFileOutError(tonel), `file out failed: ${tonel}`).toBe(false);
    return tonel;
  };

  describe.each(FIXTURES)('$className', (fixture) => {
    it('writes a header byte-identical to the shipped file', (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      expect(headerOf(fileOut(fixture.className))).toBe(headerOf(referenceFor(fixture)));
    });

    it('carries every shipped method verbatim', (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      const ours = methodBlocksOf(fileOut(fixture.className));
      const shipped = methodBlocksOf(referenceFor(fixture));
      expect(shipped.size).toBeGreaterThan(0);
      for (const [declaration, block] of shipped) {
        expect(ours.get(declaration), `missing or altered: ${declaration}`).toBe(block);
      }
    });

    it('emits each method exactly once', (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      // Every other comparison here answers a Map or a sorted set and therefore
      // cannot see a doubled method. This is the only one that can.
      expect(duplicateDeclarationsOf(fileOut(fixture.className))).toEqual([]);
    });

    it('emits the shipped methods in the shipped order', (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      // Order matters because these files go into git: a different — or merely
      // unstable — order turns every later diff into noise. Our file is a
      // superset, so the check is that the shipped methods keep their RELATIVE
      // order among ours; the extra methods may interleave.
      const shipped = declarationSequenceOf(referenceFor(fixture));
      const shippedSet = new Set(shipped);
      const ours = declarationSequenceOf(fileOut(fixture.className)).filter((d) =>
        shippedSet.has(d),
      );
      expect(shipped.length).toBeGreaterThan(0);
      expect(ours).toEqual(shipped);
    });

    it('writes the same bytes when run twice', (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      // Determinism is the other half of a usable git diff. Selectors come out of
      // a Set in the image, so anything that let that iteration order reach the
      // file would make an unchanged class look modified on every file-out.
      expect(fileOut(fixture.className)).toBe(fileOut(fixture.className));
    });

    it('exports every selector the Explorer would show', (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      // The actual product requirement, and the one the corpus cannot express:
      // a Jasper user sees every method on the class, so the file carries them —
      // including the ones Rowan files into other packages' .extension.st.
      expect(declarationsOf(fileOut(fixture.className))).toEqual(imageSelectors(fixture.className));
    });
  });

  // The classes where the duplication bug was worst, and where a declaration key
  // taken from one line collides: `Array class` alone defines two
  // `byteSubclass: aString …` methods that differ only in later keywords. Each of
  // these has hundreds of methods and many wrapped declarations.
  //
  // This is the case that would have caught the shipped bug. The three
  // shape-fixtures above have neither hundreds of methods nor wrapped
  // declarations, so they missed it; checking three small classes was not enough
  // for a defect that doubled every method of every Rowan-loaded class.
  describe.each(['Array', 'Behavior', 'Class', 'Object', 'System', 'CharacterCollection'])(
    '%s',
    (className) => {
      it('emits each method exactly once', (ctx) => {
        rowan3.skipUnlessAvailable(ctx);
        const tonel = fileOutClassTonel(exec, className);
        expect(isTonelFileOutError(tonel), `file out failed: ${tonel}`).toBe(false);
        expect(duplicateDeclarationsOf(tonel)).toEqual([]);
      });

      it('matches the image selector for selector', (ctx) => {
        rowan3.skipUnlessAvailable(ctx);
        // Counting, not set comparison: the point is that the number of method
        // blocks equals the number of selectors, which a duplicate breaks and a
        // Map-keyed comparison cannot see.
        const tonel = fileOutClassTonel(exec, className);
        const image = imageSelectors(className);
        expect(declarationSequenceOf(tonel).length).toBe(image.instance.length + image.meta.length);
      });
    },
  );

  it('reports a class that does not resolve instead of writing a file', (ctx) => {
    rowan3.skipUnlessAvailable(ctx);
    const answer = fileOutClassTonel(exec, 'JasperNoSuchClassAnywhere');
    expect(isTonelFileOutError(answer)).toBe(true);
    expect(answer).toContain('Class not found');
  });

  describe('a class Rowan has not loaded', () => {
    // The case every developer filing out their OWN work hits, and the one the
    // reference corpus cannot cover, since everything in it is Rowan-loaded. For an
    // unloaded class `rwClassDefinitionInSymbolDictionaryNamed:` answers a
    // definition built from scratch — no methods, no category, no options — so
    // everything here is something the file-out has to supply itself.
    const PROBE = 'JasperUnloadedProbe';

    const defineProbe = (): void => {
      q.compileClassDefinition(
        session(),
        `Object subclass: '${PROBE}' instVarNames: #('a') classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals`,
      );
      q.compileMethod(session(), PROBE, false, 'accessing', 'a\n\t^a');
      q.compileMethod(session(), PROBE, false, 'accessing', 'a: x\n\ta := x');
      q.compileMethod(session(), PROBE, true, 'instance creation', 'make\n\t^self new');
    };

    it('exports all its methods, which the definition alone carries none of', (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      defineProbe();
      const tonel = fileOutClassTonel(exec, PROBE);
      expect(isTonelFileOutError(tonel)).toBe(false);

      const declared = declarationSequenceOf(tonel);
      expect(declared).toHaveLength(3);
      expect(tonel).toContain(`${PROBE} >> a [`);
      expect(tonel).toContain(`${PROBE} >> a: x [`);
      expect(tonel).toContain(`${PROBE} class >> make [`);
    });

    it('emits a real category, never #category : nil', (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      // An unloaded class with no class category set answers nil, and
      // "#category : nil" is not valid Tonel — the file would not read back at all.
      defineProbe();
      const tonel = fileOutClassTonel(exec, PROBE);
      expect(tonel).not.toContain('#category : nil');
      // Falls back to the dictionary the class lives in.
      expect(tonel).toContain("#category : 'UserGlobals'");
    });

    it('prefers the class category over the dictionary when one is set', (ctx) => {
      rowan3.skipUnlessAvailable(ctx);
      defineProbe();
      q.recategorizeClass(session(), PROBE, 'Jasper-Unloaded-Cat');
      expect(fileOutClassTonel(exec, PROBE)).toContain("#category : 'Jasper-Unloaded-Cat'");
    });
  });
});
