import { describe, it, expect } from 'vitest';

// Real GCI, but stub the `vscode` module the query layer pulls in via gciLog.
import { vi } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';

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
  const exec = async (code: string): Promise<string> => await q.executeFetchString(session(), code);

  const isSystemProfile = async (): Promise<boolean> =>
    (await exec('System myUserProfile isSystemProfile printString')).trim() === 'true';
  const dictIndexOf = async (name: string): Promise<number> =>
    parseInt(
      await exec(
        `| sl d | sl := System myUserProfile symbolList. ` +
          `d := sl detect: [:x | x name = #'${name}'] ifNone: [nil]. ` +
          `(d ifNil: [0] ifNotNil: [sl indexOf: d]) printString`,
      ),
      10,
    );
  const userIndex = async (): Promise<number> => await dictIndexOf('UserGlobals');

  const WIDGET = 'JasperItWidget';
  const GADGET = 'JasperItGadget';

  // Compile a throwaway class into UserGlobals (writable by any user). Uses the
  // base-kernel `subclass:...inDictionary:` selector — the `category:options:`
  // variant only exists in images with certain packages loaded, not the bare
  // test stone — then tags the class-category in a separate step.
  const defineClass = async (name: string, category = 'JasperIt-Core'): Promise<void> => {
    await q.compileClassDefinition(
      session(),
      `Object subclass: '${name}' instVarNames: #() classVars: #() ` +
        `classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals`,
    );
    await exec(`(UserGlobals at: #'${name}') category: '${category}'. 'ok'`);
  };

  // The standard fixture: WIDGET with one instance method and one class method.
  const defineWidget = async (): Promise<void> => {
    await defineClass(WIDGET);
    await q.compileMethod(session(), WIDGET, false, 'accessing', 'bar ^42');
    await q.compileMethod(session(), WIDGET, true, 'instance creation', 'make ^self new');
  };

  const categoryOf = async (className: string): Promise<string | undefined> =>
    (await q.getClassesWithCategory(session(), await userIndex())).find(
      (e) => e.className === className,
    )?.category;

  const selectorsIn = async (
    className: string,
    isMeta: boolean,
    category: string,
  ): Promise<string[]> =>
    (await q.getClassEnvironments(session(), await userIndex(), className, 0))
      .filter((l) => l.isMeta === isMeta && l.category === category)
      .flatMap((l) => l.selectors);

  describe('getClassHierarchy', () => {
    it('reports the queried class as the "self" node', async () => {
      const self = (await q.getClassHierarchy(session(), 'Integer')).find((e) => e.kind === 'self');

      expect(self?.className).toBe('Integer');
    });

    it('includes Object among the superclasses, root-first', async () => {
      const supers = (await q.getClassHierarchy(session(), 'Integer')).filter(
        (e) => e.kind === 'superclass',
      );

      expect(supers.map((e) => e.className)).toContain('Object');
    });
  });

  describe('getGrailStubReflection', () => {
    const GRAILC = 'JasperItGrailTarget';
    // A throwaway class with two instVars: `balance` has both an accessor and a
    // mutator, `owner` has neither — plus a plain method, a binary override, and
    // a class-side method, so the reflection exercises every branch.
    const defineGrailTarget = async (): Promise<void> => {
      await q.compileClassDefinition(
        session(),
        `Object subclass: '${GRAILC}' instVarNames: #('balance' 'owner') classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );
      await q.compileMethod(session(), GRAILC, false, 'accessing', 'balance ^balance');
      await q.compileMethod(
        session(),
        GRAILC,
        false,
        'accessing',
        'balance: aValue balance := aValue',
      );
      await q.compileMethod(session(), GRAILC, false, 'ops', 'deposit: n balance := balance + n');
      await q.compileMethod(session(), GRAILC, false, 'comparing', '= other ^self == other');
      await q.compileMethod(session(), GRAILC, true, 'instance creation', 'make ^self new');
    };

    it('reports own instance variables in order with the accessors the class understands', async () => {
      await defineGrailTarget();

      const refl = await q.getGrailStubReflection(session(), GRAILC, await userIndex());

      expect(refl.found).toBe(true);
      expect(refl.instVars).toEqual([
        { name: 'balance', hasGetter: true, hasSetter: true },
        { name: 'owner', hasGetter: false, hasSetter: false },
      ]);
    });

    it('lists own selectors on both sides and names the immediate superclass', async () => {
      await defineGrailTarget();

      const refl = await q.getGrailStubReflection(session(), GRAILC, await userIndex());

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

    it('reports an unknown class name as not found', async () => {
      const refl = await q.getGrailStubReflection(
        session(),
        'JasperItNoSuchClass',
        await userIndex(),
      );

      expect(refl.found).toBe(false);
    });
  });

  describe('getClassesWithCategory', () => {
    it('pairs a class in the dictionary with its class-category', async () => {
      await defineClass(WIDGET, 'JasperIt-Alpha');

      expect(await categoryOf(WIDGET)).toBe('JasperIt-Alpha');
    });

    // The class row's comment button is driven off this flag, so what counts as
    // "has a comment" has to be decided against a real class, not a mocked line of
    // output. Two engine behaviours a unit test cannot show: `Class>>comment`
    // SYNTHESISES a placeholder when there is none, and the raw `comment: ''`
    // message STORES the empty string rather than dropping the key — which is why
    // setClassComment removes the key itself for an empty comment rather than
    // sending that message.
    // ([#387](https://github.com/GemTalk/Jasper/issues/387))
    const commentedOf = async (className: string): Promise<boolean | undefined> =>
      (await q.getClassesWithCategory(session(), await userIndex())).find(
        (e) => e.className === className,
      )?.hasComment;

    it('reports a class that was never commented as uncommented', async () => {
      await defineClass(WIDGET);

      // Guard: the synthesised accessor answers a non-empty string even here, which
      // is exactly why the flag cannot be read from it.
      expect(
        (await exec(`(UserGlobals at: #'${WIDGET}') comment isEmpty printString`)).trim(),
      ).toBe('false');
      expect(await commentedOf(WIDGET)).toBe(false);
    });

    it('reports a class with real comment text as commented', async () => {
      await defineClass(WIDGET);
      await q.setClassComment(session(), WIDGET, 'A widget.', await userIndex());

      expect(await commentedOf(WIDGET)).toBe(true);
    });

    // Emptying the editor takes the key away, so the class is left exactly as it
    // was found: `comment` goes back to answering the synthesised placeholder, and
    // a file-out shows no comment rather than an empty one.
    it('takes the comment away when the editor is emptied', async () => {
      await defineClass(WIDGET);
      await q.setClassComment(session(), WIDGET, 'A widget.', await userIndex());
      await q.setClassComment(session(), WIDGET, '', await userIndex());

      expect(
        (
          await exec(`((UserGlobals at: #'${WIDGET}') _extraDictAt: #comment) isNil printString`)
        ).trim(),
      ).toBe('true');
      expect(await commentedOf(WIDGET)).toBe(false);
      // Back to the placeholder — which is what an uncommented class answers.
      expect(
        (await exec(`(UserGlobals at: #'${WIDGET}') comment isEmpty printString`)).trim(),
      ).toBe('false');
    });

    it('reports a whitespace-only comment as uncommented', async () => {
      await defineClass(WIDGET);
      // What a save can leave behind after the text is deleted (insert-final-newline).
      await q.setClassComment(session(), WIDGET, '\n', await userIndex());

      expect(await commentedOf(WIDGET)).toBe(false);
    });

    // Emptying an already-uncommented class removes a key that was never there.
    it('does nothing when a class with no comment is saved empty', async () => {
      await defineClass(WIDGET);

      expect(await q.setClassComment(session(), WIDGET, '', await userIndex())).toContain(
        'Comment set:',
      );
      expect(await commentedOf(WIDGET)).toBe(false);
    });
  });

  describe('canClassBeWritten', () => {
    it('reports a freshly created user class as writable', async () => {
      await defineClass(WIDGET);

      expect(await q.canClassBeWritten(session(), WIDGET, await userIndex())).toBe(true);
    });

    it('reports a kernel class as read-only for a non-system user', async () => {
      if (await isSystemProfile()) return;

      expect(await q.canClassBeWritten(session(), 'Object')).toBe(false);
    });
  });

  describe('getClassEnvironments', () => {
    it("lists a class's own instance and class methods under their categories", async () => {
      await defineWidget();

      expect(await selectorsIn(WIDGET, false, 'accessing')).toContain('bar');
      expect(await selectorsIn(WIDGET, true, 'instance creation')).toContain('make');
    });
  });

  describe('class comment', () => {
    it('reads back a comment written to a class, scoped to its dictionary', async () => {
      await defineWidget();

      await q.setClassComment(session(), WIDGET, 'Jasper comment round-trip.', await userIndex());

      expect((await q.getClassComment(session(), WIDGET, await userIndex())).trim()).toBe(
        'Jasper comment round-trip.',
      );
    });

    it('reads a comment by bare class name when no dictionary is given', async () => {
      await defineWidget();

      await q.setClassComment(session(), WIDGET, 'Bare-name comment.');

      expect((await q.getClassComment(session(), WIDGET)).trim()).toBe('Bare-name comment.');
    });
  });

  describe('recategorizeClass', () => {
    it('moves a class to a new class-category', async () => {
      await defineWidget();

      const result = await q.recategorizeClass(session(), WIDGET, 'JasperIt-Moved');

      expect(result).toContain('Recategorized');
      expect(await categoryOf(WIDGET)).toBe('JasperIt-Moved');
    });
  });

  describe('getClassCategory', () => {
    it('returns the class category the definition editor shows on its own line', async () => {
      await defineClass(WIDGET, 'JasperIt-Shown');

      expect(await q.getClassCategory(session(), WIDGET, await userIndex())).toBe('JasperIt-Shown');
    });

    it('returns empty for a class that cannot be found', async () => {
      expect(await q.getClassCategory(session(), 'JasperItNoSuchClass', await userIndex())).toBe(
        '',
      );
    });
  });

  describe('classExistsInDictionary', () => {
    it('is true for a class present in the dictionary and false otherwise', async () => {
      await defineWidget();

      expect(await q.classExistsInDictionary(session(), WIDGET, await userIndex())).toBe(true);
      expect(await q.classExistsInDictionary(session(), 'JasperItAbsent', await userIndex())).toBe(
        false,
      );
    });
  });

  describe('recategorizeMethod', () => {
    it('moves a method into another existing category', async () => {
      await defineWidget();
      await q.compileMethod(session(), WIDGET, false, 'relocated', 'baz ^0'); // makes the target category exist

      await q.recategorizeMethod(session(), WIDGET, false, 'bar', 'relocated');

      expect(await selectorsIn(WIDGET, false, 'relocated')).toContain('bar');
      expect(await selectorsIn(WIDGET, false, 'accessing')).not.toContain('bar');
    });

    it('CREATES a category the class does not have yet, rather than refusing', async () => {
      // The Explorer's "+ new category" leaves the stone untouched until something is
      // filed there, so dropping a method on one of those rows targets a category that
      // does not exist yet: bare `moveMethod:toCategory:` answers classErrMethCatNotFound.
      await defineWidget();
      expect(await q.getMethodCategories(session(), WIDGET, false)).not.toContain('fresh-category');

      await q.recategorizeMethod(session(), WIDGET, false, 'bar', 'fresh-category');

      expect(await selectorsIn(WIDGET, false, 'fresh-category')).toContain('bar');
      expect(await selectorsIn(WIDGET, false, 'accessing')).not.toContain('bar');
    });

    it('does not fall over on a category that IS already there', async () => {
      // `addCategory:` raises classErrMethCatExists on one that exists, so it is guarded.
      await defineWidget();
      await q.compileMethod(session(), WIDGET, false, 'relocated', 'baz ^0');

      expect(
        (await q.recategorizeMethod(session(), WIDGET, false, 'bar', 'relocated')).trim(),
      ).toBe('ok');
    });

    it('moves back into a category a RENAME emptied out of existence', async () => {
      // The exact sequence that failed in the Explorer: rename `accessing` away, which
      // takes its methods AND the category itself with it, then create a fresh `accessing`
      // with the "+" button (client overlay only) and drag a method into it. The target
      // category has a familiar name but no server existence at all.
      await defineWidget();
      await q.renameCategory(session(), WIDGET, false, 'accessing', 'accessing-renamed');
      expect(await q.getMethodCategories(session(), WIDGET, false)).not.toContain('accessing');

      await q.recategorizeMethod(session(), WIDGET, false, 'bar', 'accessing');

      expect(await selectorsIn(WIDGET, false, 'accessing')).toContain('bar');
      expect(await selectorsIn(WIDGET, false, 'accessing-renamed')).not.toContain('bar');
    });

    it('creates the category on the CLASS side when that is the side being moved', async () => {
      await defineWidget();
      await q.compileMethod(session(), WIDGET, true, 'instance creation', 'make ^self new');

      await q.recategorizeMethod(session(), WIDGET, true, 'make', 'building');

      expect(await selectorsIn(WIDGET, true, 'building')).toContain('make');
      // The instance side is left alone — the two sides have separate category lists.
      expect(await q.getMethodCategories(session(), WIDGET, false)).not.toContain('building');
    });
  });

  describe('removeMethodCategory', () => {
    it('removes an empty category', async () => {
      await defineWidget();
      // Emptied by moving its one method away — the category itself survives that.
      await q.recategorizeMethod(session(), WIDGET, false, 'bar', 'elsewhere');
      expect(await q.getMethodCategories(session(), WIDGET, false)).toContain('accessing');

      expect((await q.removeMethodCategory(session(), WIDGET, false, 'accessing')).trim()).toBe(
        'ok',
      );

      expect(await q.getMethodCategories(session(), WIDGET, false)).not.toContain('accessing');
    });

    it('REFUSES a category that holds methods, and leaves them alone', async () => {
      // The fact the guard exists for: GemStone's `removeCategory:` does not refuse a
      // category with methods in it, it deletes them along with the category. Pinned here so
      // it cannot change underneath the undo that relies on being told first.
      await defineWidget();

      expect((await q.removeMethodCategory(session(), WIDGET, false, 'accessing')).trim()).toBe(
        'holds:1',
      );

      expect(await q.getMethodCategories(session(), WIDGET, false)).toContain('accessing');
      expect(await selectorsIn(WIDGET, false, 'accessing')).toContain('bar');
    });

    it('bare removeCategory: really does take the methods with it', async () => {
      // The unguarded behaviour, stated outright so the guard above reads as necessary
      // rather than defensive.
      await defineWidget();

      await exec(`(UserGlobals at: #'${WIDGET}') removeCategory: 'accessing'. 'ok'`);

      expect(
        (await exec(`((UserGlobals at: #'${WIDGET}') includesSelector: #bar) printString`)).trim(),
      ).toBe('false');
    });

    it('answers not-found rather than raising on a category the class does not have', async () => {
      await defineWidget();

      expect(
        (await q.removeMethodCategory(session(), WIDGET, false, 'no-such-category')).trim(),
      ).toBe('not-found');
    });

    it('keeps the two sides apart', async () => {
      await defineWidget();

      expect((await q.removeMethodCategory(session(), WIDGET, true, 'accessing')).trim()).toBe(
        'not-found',
      );
      expect(await q.getMethodCategories(session(), WIDGET, false)).toContain('accessing');
    });
  });

  describe('renameCategory', () => {
    it('renames a method category, carrying its methods along', async () => {
      await defineWidget();

      await q.renameCategory(session(), WIDGET, false, 'accessing', 'renamed-accessing');

      expect(await selectorsIn(WIDGET, false, 'renamed-accessing')).toContain('bar');
      expect(await selectorsIn(WIDGET, false, 'accessing')).toEqual([]);
    });

    // The Explorer's "+ new category" is client-only until a method lands: a
    // never-populated category was never created on the server, so renaming one
    // there raises — which is why the controller renames those locally. (A category
    // that HELD methods and was emptied is different: the server keeps it. See the
    // removeCategory tests below.)
    it('raises when renaming a category the class does not have', async () => {
      await defineWidget();

      await expect(
        q.renameCategory(session(), WIDGET, false, 'no-such-category', 'whatever'),
      ).rejects.toThrow();
    });
  });

  describe('removeCategory', () => {
    // The leftover this action exists to clear: GemStone keeps a category listed
    // after its last method moves out, so it lingers in the Methods pane.
    const emptyAccessing = async (): Promise<void> => {
      await defineWidget();
      await q.compileMethod(session(), WIDGET, false, 'relocated', 'other ^1');
      await q.recategorizeMethod(session(), WIDGET, false, 'bar', 'relocated');
    };

    it('leaves an emptied category listed until it is removed', async () => {
      await emptyAccessing();

      expect(await selectorsIn(WIDGET, false, 'accessing')).toEqual([]);
      expect(await q.getMethodCategories(session(), WIDGET, false, await userIndex())).toContain(
        'accessing',
      );
    });

    it('removes the emptied category and nothing else', async () => {
      await emptyAccessing();

      expect(
        (await q.removeCategory(session(), WIDGET, false, 'accessing', await userIndex())).trim(),
      ).toBe('ok');
      const categories = await q.getMethodCategories(session(), WIDGET, false, await userIndex());
      expect(categories).not.toContain('accessing');
      expect(categories).toContain('relocated');
      expect(await selectorsIn(WIDGET, false, 'relocated')).toContain('bar');
    });

    it('refuses a category that still holds methods, and keeps them', async () => {
      await defineWidget();

      expect(
        (await q.removeCategory(session(), WIDGET, false, 'accessing', await userIndex())).trim(),
      ).toBe('has-methods:1');
      // The refusal is the point: GemStone's removeCategory: would have taken the
      // method with it.
      expect(await selectorsIn(WIDGET, false, 'accessing')).toContain('bar');
    });

    it('removes a class-side category', async () => {
      await defineWidget();
      await q.compileMethod(session(), WIDGET, true, 'other', 'zip ^1');
      await q.recategorizeMethod(session(), WIDGET, true, 'make', 'other');

      expect(
        (
          await q.removeCategory(session(), WIDGET, true, 'instance creation', await userIndex())
        ).trim(),
      ).toBe('ok');
      expect(await q.getMethodCategories(session(), WIDGET, true, await userIndex())).not.toContain(
        'instance creation',
      );
    });

    it('answers no-category for a category the class does not have', async () => {
      await defineWidget();

      expect(
        (
          await q.removeCategory(session(), WIDGET, false, 'no-such-category', await userIndex())
        ).trim(),
      ).toBe('no-category');
    });

    // `includesCategory:`, `selectorsIn:` and `removeCategory:` all read environment
    // 0, while the Methods pane is built from `_unifiedCategorys: env` over
    // `0 to: maxEnvironment` — so a category can be on screen, and hold methods, in a
    // place the env-0 shorthands cannot see. Only a live stone can prove the sweep.
    describe('across method environments', () => {
      // The categories the pane would list for a side, in one environment.
      const categoriesInEnv = async (isMeta: boolean, envId: number): Promise<string[]> =>
        (await q.getClassEnvironments(session(), await userIndex(), WIDGET, 1))
          .filter((l) => l.isMeta === isMeta && l.envId === envId)
          .map((l) => l.category);
      const selectorsInEnv = async (
        isMeta: boolean,
        envId: number,
        category: string,
      ): Promise<string[]> =>
        (await q.getClassEnvironments(session(), await userIndex(), WIDGET, 1))
          .filter((l) => l.isMeta === isMeta && l.envId === envId && l.category === category)
          .flatMap((l) => l.selectors);

      it('refuses a category emptied in environment 0 that still holds a method in 1', async () => {
        // The dangerous case: env 0 sees an empty 'accessing' and would remove it,
        // leaving the environment-1 method filed under a category the user was told
        // had gone.
        await emptyAccessing();
        await q.compileMethod(
          session(),
          WIDGET,
          false,
          'accessing',
          'toolOnly ^1',
          1,
          await userIndex(),
        );

        expect(
          (
            await q.removeCategory(session(), WIDGET, false, 'accessing', await userIndex(), 1)
          ).trim(),
        ).toBe('has-methods:1');
        expect(await selectorsInEnv(false, 1, 'accessing')).toContain('toolOnly');
        expect(await categoriesInEnv(false, 0)).toContain('accessing');
      });

      it('removes a category that exists only in a non-zero environment', async () => {
        // Its row is on screen — getClassEnvironments iterates every environment —
        // but `includesCategory:` answers false for it, so the user used to be told
        // the class no longer had a category they could see.
        await defineWidget();
        await q.compileMethod(
          session(),
          WIDGET,
          false,
          'envonly',
          'toolOnly ^1',
          1,
          await userIndex(),
        );
        await q.compileMethod(
          session(),
          WIDGET,
          false,
          'elsewhere',
          'other ^1',
          1,
          await userIndex(),
        );
        await exec(
          `(UserGlobals at: #'${WIDGET}') moveMethod: #toolOnly toCategory: 'elsewhere' environmentId: 1. 'ok'`,
        );
        expect(await categoriesInEnv(false, 1)).toContain('envonly');

        expect(
          (
            await q.removeCategory(session(), WIDGET, false, 'envonly', await userIndex(), 1)
          ).trim(),
        ).toBe('ok');
        expect(await categoriesInEnv(false, 1)).not.toContain('envonly');
        expect(await selectorsInEnv(false, 1, 'elsewhere')).toContain('toolOnly');
      });

      it('clears an empty category from every environment that has it', async () => {
        await defineWidget();
        for (const env of [0, 1]) {
          await q.compileMethod(
            session(),
            WIDGET,
            false,
            'scratch',
            `s${env} ^1`,
            env,
            await userIndex(),
          );
          await q.compileMethod(
            session(),
            WIDGET,
            false,
            'keeper',
            `k${env} ^1`,
            env,
            await userIndex(),
          );
          await exec(
            `(UserGlobals at: #'${WIDGET}') moveMethod: #s${env} toCategory: 'keeper' environmentId: ${env}. 'ok'`,
          );
        }

        expect(
          (
            await q.removeCategory(session(), WIDGET, false, 'scratch', await userIndex(), 1)
          ).trim(),
        ).toBe('ok');
        expect(await categoriesInEnv(false, 0)).not.toContain('scratch');
        expect(await categoriesInEnv(false, 1)).not.toContain('scratch');
      });

      it('still answers no-category when no environment in range has it', async () => {
        await defineWidget();

        expect(
          (
            await q.removeCategory(
              session(),
              WIDGET,
              false,
              'no-such-category',
              await userIndex(),
              1,
            )
          ).trim(),
        ).toBe('no-category');
      });
    });
  });

  // The "+ new method" flow relies on the compiler creating the target category on
  // save — so an Explorer overlay category becomes real once it holds a method.
  describe('compileMethod into a not-yet-existing category', () => {
    it('creates an instance-side category and files the method there', async () => {
      await defineWidget();

      await q.compileMethod(session(), WIDGET, false, 'freshly-made', 'baz ^0');

      expect(await selectorsIn(WIDGET, false, 'freshly-made')).toContain('baz');
      expect(await q.getMethodCategories(session(), WIDGET, false, await userIndex())).toContain(
        'freshly-made',
      );
    });

    it('creates a class-side category and files the method there', async () => {
      await defineWidget();

      await q.compileMethod(session(), WIDGET, true, 'class-side cat', 'zot ^0');

      expect(await selectorsIn(WIDGET, true, 'class-side cat')).toContain('zot');
    });
  });

  describe('copyMethodToClass', () => {
    it('copies a method into another class, keeping its category', async () => {
      await defineWidget();
      await defineClass(GADGET);

      const result = await q.copyMethodToClass(session(), WIDGET, GADGET, false, 'bar');

      expect(result).toContain('Copied');
      expect(await selectorsIn(GADGET, false, 'accessing')).toContain('bar');
    });
  });

  describe('deleteClass', () => {
    it('removes a class from its dictionary', async () => {
      await defineWidget();

      const result = await q.deleteClass(session(), await userIndex(), WIDGET);

      expect(result).toContain('Deleted class');
      expect(await categoryOf(WIDGET)).toBeUndefined();
    });
  });

  describe('moveClass', () => {
    it('moves a class from one dictionary to another', async () => {
      await defineWidget();
      await q.addDictionary(session(), 'JasperItDest');
      const dest = await dictIndexOf('JasperItDest');

      const result = await q.moveClass(session(), await userIndex(), dest, WIDGET);

      expect(result).toContain('Moved');
      expect(
        (await q.getClassesWithCategory(session(), await userIndex())).find(
          (e) => e.className === WIDGET,
        ),
      ).toBeUndefined();
      expect(
        (await q.getClassesWithCategory(session(), dest)).find((e) => e.className === WIDGET),
      ).toBeDefined();
    });
  });

  describe('addDictionary', () => {
    it('appends a new dictionary to the symbol list', async () => {
      const result = await q.addDictionary(session(), 'JasperItNew');

      expect(result).toContain('Added dictionary');
      expect(await dictIndexOf('JasperItNew')).toBeGreaterThan(0);
    });
  });

  describe('removeDictionary', () => {
    it('removes a dictionary from the symbol list', async () => {
      await q.addDictionary(session(), 'JasperItDoomed');
      expect(await dictIndexOf('JasperItDoomed')).toBeGreaterThan(0);

      const result = await q.removeDictionary(session(), 'JasperItDoomed');

      expect(result).toContain('Removed dictionary');
      expect(await dictIndexOf('JasperItDoomed')).toBe(0);
    });
  });

  describe('moveDictionaryUp', () => {
    it('swaps a dictionary one position earlier', async () => {
      await q.addDictionary(session(), 'JasperItLower');
      await q.addDictionary(session(), 'JasperItUpper');
      expect(await dictIndexOf('JasperItLower')).toBeLessThan(await dictIndexOf('JasperItUpper'));

      await q.moveDictionaryUp(session(), await dictIndexOf('JasperItUpper'));

      expect(await dictIndexOf('JasperItUpper')).toBeLessThan(await dictIndexOf('JasperItLower'));
    });
  });

  describe('moveDictionaryDown', () => {
    it('swaps a dictionary one position later', async () => {
      await q.addDictionary(session(), 'JasperItFirst');
      await q.addDictionary(session(), 'JasperItSecond');
      expect(await dictIndexOf('JasperItFirst')).toBeLessThan(await dictIndexOf('JasperItSecond'));

      await q.moveDictionaryDown(session(), await dictIndexOf('JasperItFirst'));

      expect(await dictIndexOf('JasperItFirst')).toBeGreaterThan(
        await dictIndexOf('JasperItSecond'),
      );
    });
  });

  describe('renameDictionary', () => {
    it('renames a dictionary in place, keeping its symbol-list position', async () => {
      await q.addDictionary(session(), 'JasperItRenameSrc');
      const before = await dictIndexOf('JasperItRenameSrc');
      expect(before).toBeGreaterThan(0);

      const result = await q.renameDictionary(session(), 'JasperItRenameSrc', 'JasperItRenameDst');

      expect(result).toBe('ok');
      expect(await dictIndexOf('JasperItRenameSrc')).toBe(0); // old name gone
      expect(await dictIndexOf('JasperItRenameDst')).toBe(before); // new name, same index
    });

    it('keeps the classes it holds reachable under the new name', async () => {
      await q.addDictionary(session(), 'JasperItRenameSrc');
      const srcIdx = await dictIndexOf('JasperItRenameSrc');
      expect(srcIdx).toBeGreaterThan(0);
      // File a class INTO that dictionary (not UserGlobals), so the rename has real
      // contents to preserve. Only a live stone can confirm the self-entry swap left
      // them reachable — that's the point of asserting it here rather than in a unit test.
      await q.compileClassDefinition(
        session(),
        `Object subclass: 'JasperItHeld' instVarNames: #() classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() ` +
          `inDictionary: (System myUserProfile symbolList objectNamed: #'JasperItRenameSrc')`,
      );
      expect(await q.getClassNames(session(), srcIdx)).toContain('JasperItHeld');

      const result = await q.renameDictionary(session(), 'JasperItRenameSrc', 'JasperItRenameDst');
      expect(result).toBe('ok');

      // The class is still there, now found under the NEW name (both via the query
      // and by resolving the dictionary itself under the new name).
      const dstIdx = await dictIndexOf('JasperItRenameDst');
      expect(await q.getClassNames(session(), dstIdx)).toContain('JasperItHeld');
      expect(
        (
          await exec(
            `((System myUserProfile symbolList objectNamed: #'JasperItRenameDst') ` +
              `includesKey: #'JasperItHeld') printString`,
          )
        ).trim(),
      ).toBe('true');
    });

    it('declines when the new name is already in use, leaving both dictionaries intact', async () => {
      await q.addDictionary(session(), 'JasperItRenameA');
      await q.addDictionary(session(), 'JasperItRenameB');

      const result = await q.renameDictionary(session(), 'JasperItRenameA', 'JasperItRenameB');

      expect(result).toContain('already in use');
      expect(await dictIndexOf('JasperItRenameA')).toBeGreaterThan(0);
      expect(await dictIndexOf('JasperItRenameB')).toBeGreaterThan(0);
    });

    it('refuses to rename a system dictionary (UserGlobals)', async () => {
      const before = await userIndex();
      expect(before).toBeGreaterThan(0);

      const result = await q.renameDictionary(session(), before, 'JasperItNotUserGlobals');

      expect(result).toContain('system dictionary');
      expect(await dictIndexOf('UserGlobals')).toBe(before);
      expect(await dictIndexOf('JasperItNotUserGlobals')).toBe(0);
    });

    it('reports "Dictionary not found" for an out-of-range index', async () => {
      const result = await q.renameDictionary(session(), 99999, 'JasperItNope');
      expect(result).toContain('not found');
    });
  });

  describe('renameClassCategory', () => {
    it('renames a class category and its subtree, leaving unrelated categories alone', async () => {
      await defineClass('JasperCatExact', 'JasperIt-Cat');
      await defineClass('JasperCatChild', 'JasperIt-Cat-Sub');
      await defineClass('JasperCatOther', 'JasperIt-Other');

      const result = await q.renameClassCategory(
        session(),
        await userIndex(),
        'JasperIt-Cat',
        'JasperIt-Evt',
      );

      expect(result).toBe('renamed: 2');
      expect(await categoryOf('JasperCatExact')).toBe('JasperIt-Evt');
      expect(await categoryOf('JasperCatChild')).toBe('JasperIt-Evt-Sub');
      expect(await categoryOf('JasperCatOther')).toBe('JasperIt-Other');
    });

    it('merges into an existing category name (categories are labels, not bindings)', async () => {
      await defineClass('JasperCatMoveMe', 'JasperIt-From');
      await defineClass('JasperCatAlready', 'JasperIt-To');

      const result = await q.renameClassCategory(
        session(),
        await userIndex(),
        'JasperIt-From',
        'JasperIt-To',
      );

      expect(result).toBe('renamed: 1');
      expect(await categoryOf('JasperCatMoveMe')).toBe('JasperIt-To');
      expect(await categoryOf('JasperCatAlready')).toBe('JasperIt-To');
    });

    it('renames nothing (count 0) when no class is in the category', async () => {
      const result = await q.renameClassCategory(
        session(),
        await userIndex(),
        'JasperIt-Nonexistent',
        'X',
      );
      expect(result).toBe('renamed: 0');
    });
  });

  // Shadowed class names — the same name bound in two dictionaries. This session's
  // Explorer fixes (hierarchy pane, class deletion, and creating a class in a
  // non-selected dictionary) rely on the query layer resolving by the SELECTED
  // dictionary index rather than the global first match. These prove that
  // dict-scoping end-to-end on a live stone.
  describe('dictionary-scoped resolution for a shadowed class name', () => {
    const SHADOW = 'JasperItShadowed';

    // Bind SHADOW twice: an Object subclass in UserGlobals and an Array subclass in
    // a second dictionary. Returns the second dictionary's 1-based index.
    const defineShadowPair = async (): Promise<number> => {
      await q.compileClassDefinition(
        session(),
        `Object subclass: '${SHADOW}' instVarNames: #() classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals`,
      );
      await q.addDictionary(session(), 'JasperItShadowDict');
      const shadowIdx = await dictIndexOf('JasperItShadowDict');
      await q.compileClassDefinition(
        session(),
        `Array subclass: '${SHADOW}' instVarNames: #() classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: JasperItShadowDict`,
      );
      return shadowIdx;
    };

    const superclassesOf = async (dict: number): Promise<string[]> =>
      (await q.getClassHierarchy(session(), SHADOW, dict))
        .filter((e) => e.kind === 'superclass')
        .map((e) => e.className);

    it('getClassHierarchy returns the lineage of the shadow in the given dictionary (G)', async () => {
      const shadowIdx = await defineShadowPair();

      // The UserGlobals shadow is a plain Object subclass — no Array in its lineage.
      expect(await superclassesOf(await userIndex())).toContain('Object');
      expect(await superclassesOf(await userIndex())).not.toContain('Array');
      // The other dictionary's shadow is an Array subclass — Array is an ancestor.
      expect(await superclassesOf(shadowIdx)).toContain('Array');
    });

    it("getClassHierarchy answers each shadow's own dictionary position", async () => {
      // The name alone cannot say which dictionary binds which shadow when two dictionaries
      // share a name, so the node carries the position of the one that binds it (#396).
      const shadowIdx = await defineShadowPair();
      const selfIn = async (dict: number) =>
        (await q.getClassHierarchy(session(), SHADOW, dict)).find((e) => e.kind === 'self');

      expect((await selfIn(await userIndex()))?.dictIndex).toBe(await userIndex());
      expect((await selfIn(shadowIdx))?.dictIndex).toBe(shadowIdx);
    });

    it('deleteClass removes only the shadow in the targeted dictionary (I)', async () => {
      const shadowIdx = await defineShadowPair();

      await q.deleteClass(session(), shadowIdx, SHADOW);

      expect(await q.classExistsInDictionary(session(), SHADOW, shadowIdx)).toBe(false);
      expect(await q.classExistsInDictionary(session(), SHADOW, await userIndex())).toBe(true);
    });

    it('compileClassDefinition creates the class in the dictionary its inDictionary: names (F)', async () => {
      await q.addDictionary(session(), 'JasperItOther');
      const other = await dictIndexOf('JasperItOther');

      await q.compileClassDefinition(
        session(),
        `Object subclass: '${GADGET}' instVarNames: #() classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: JasperItOther`,
      );

      expect(await q.classExistsInDictionary(session(), GADGET, other)).toBe(true);
      expect(await q.classExistsInDictionary(session(), GADGET, await userIndex())).toBe(false);
    });

    // Compile `super subclass: 'name' ... inDictionary: <dict>` (base-kernel selector).
    const defineIn = async (superName: string, name: string, dict: string): Promise<void> => {
      await q.compileClassDefinition(
        session(),
        `${superName} subclass: '${name}' instVarNames: #() classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: ${dict}`,
      );
    };

    // getClassDescendantNames / Remove Class must resolve each subclass by CLASS OBJECT
    // IDENTITY, so a subclass whose name is also bound (as an unrelated class) in another
    // dictionary reports its OWN dictionary — never the same-named stranger. (Fixes the
    // show-stopper on PR #397: a name-keyed lookup would delete the wrong class.)
    const ROOT = 'JasperItRoot';
    const LEAF = 'JasperItLeaf';

    it('getClassDescendantNames reports a subclass in its own dictionary, not a same-named stranger', async () => {
      await q.addDictionary(session(), 'JasperItAlt');
      const alt = await dictIndexOf('JasperItAlt');
      await defineIn('Object', ROOT, 'UserGlobals');
      await defineIn(ROOT, LEAF, 'UserGlobals'); // the real subclass, in UserGlobals
      await defineIn('Object', LEAF, 'JasperItAlt'); // unrelated class, same name, different dictionary

      const descendants = await q.getClassDescendantNames(session(), ROOT, await userIndex());

      expect(descendants).toHaveLength(1);
      expect(descendants[0].className).toBe(LEAF);
      expect(descendants[0].dictIndex).toBe(await userIndex());
      expect(descendants[0].dictIndex).not.toBe(alt);
    });

    it('getClassDescendantNames reports a subclass that lives in a different dictionary than its root', async () => {
      await q.addDictionary(session(), 'JasperItAlt');
      const alt = await dictIndexOf('JasperItAlt');
      await defineIn('Object', ROOT, 'UserGlobals');
      await defineIn(ROOT, 'JasperItChild', 'JasperItAlt'); // subclass bound in another dictionary

      const descendants = await q.getClassDescendantNames(session(), ROOT, await userIndex());

      expect(descendants).toHaveLength(1);
      expect(descendants[0].className).toBe('JasperItChild');
      expect(descendants[0].dictIndex).toBe(alt);
    });

    it('deleting a subtree by each descendant’s reported dictionary spares a same-named stranger', async () => {
      await q.addDictionary(session(), 'JasperItAlt');
      const alt = await dictIndexOf('JasperItAlt');
      await defineIn('Object', ROOT, 'UserGlobals');
      await defineIn(ROOT, LEAF, 'UserGlobals'); // real subclass
      await defineIn('Object', LEAF, 'JasperItAlt'); // unrelated same-named class

      // Delete the subtree the way Remove Class does: each descendant by its OWN
      // reported dictionary index, then the root.
      for (const d of await q.getClassDescendantNames(session(), ROOT, await userIndex())) {
        await q.deleteClass(session(), d.dictIndex, d.className);
      }
      await q.deleteClass(session(), await userIndex(), ROOT);

      // The real subclass and root are gone; the unrelated same-named class survives.
      expect(await q.classExistsInDictionary(session(), LEAF, await userIndex())).toBe(false);
      expect(await q.classExistsInDictionary(session(), ROOT, await userIndex())).toBe(false);
      expect(await q.classExistsInDictionary(session(), LEAF, alt)).toBe(true);
    });
  });
});
