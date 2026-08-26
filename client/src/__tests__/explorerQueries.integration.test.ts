import { describe, it, expect } from 'vitest';

// Real GCI, but stub the `vscode` module the query layer pulls in via gciLog.
import { vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));

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

    // #387 item 11 drives the class row's comment button off this flag, so what
    // counts as "has a comment" has to be decided against a real class, not a
    // mocked line of output: `Class>>comment` SYNTHESISES a placeholder when there
    // is none, and `comment: ''` STORES the empty string rather than dropping the
    // key. Both are engine behaviours a unit test cannot show.
    const commentedOf = (className: string): boolean | undefined =>
      q.getClassesWithCategory(session(), userIndex()).find((e) => e.className === className)
        ?.hasComment;

    it('reports a class that was never commented as uncommented', () => {
      defineClass(WIDGET);

      // Guard: the synthesised accessor answers a non-empty string even here, which
      // is exactly why the flag cannot be read from it.
      expect(exec(`(UserGlobals at: #'${WIDGET}') comment isEmpty printString`).trim()).toBe(
        'false',
      );
      expect(commentedOf(WIDGET)).toBe(false);
    });

    it('reports a class with real comment text as commented', () => {
      defineClass(WIDGET);
      q.setClassComment(session(), WIDGET, 'A widget.', userIndex());

      expect(commentedOf(WIDGET)).toBe(true);
    });

    it('reports a comment emptied by the editor as uncommented', () => {
      defineClass(WIDGET);
      q.setClassComment(session(), WIDGET, 'A widget.', userIndex());
      q.setClassComment(session(), WIDGET, '', userIndex());

      // The key survives the emptying — a nil test would still answer "commented".
      expect(
        exec(`((UserGlobals at: #'${WIDGET}') _extraDictAt: #comment) notNil printString`).trim(),
      ).toBe('true');
      expect(commentedOf(WIDGET)).toBe(false);
    });

    it('reports a whitespace-only comment as uncommented', () => {
      defineClass(WIDGET);
      // What a save can leave behind after the text is deleted (insert-final-newline).
      q.setClassComment(session(), WIDGET, '\n', userIndex());

      expect(commentedOf(WIDGET)).toBe(false);
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

  describe('class comment', () => {
    it('reads back a comment written to a class, scoped to its dictionary', () => {
      defineWidget();

      q.setClassComment(session(), WIDGET, 'Jasper comment round-trip.', userIndex());

      expect(q.getClassComment(session(), WIDGET, userIndex()).trim()).toBe(
        'Jasper comment round-trip.',
      );
    });

    it('reads a comment by bare class name when no dictionary is given', () => {
      defineWidget();

      q.setClassComment(session(), WIDGET, 'Bare-name comment.');

      expect(q.getClassComment(session(), WIDGET).trim()).toBe('Bare-name comment.');
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

  describe('getClassCategory', () => {
    it('returns the class category the definition editor shows on its own line', () => {
      defineClass(WIDGET, 'JasperIt-Shown');

      expect(q.getClassCategory(session(), WIDGET, userIndex())).toBe('JasperIt-Shown');
    });

    it('returns empty for a class that cannot be found', () => {
      expect(q.getClassCategory(session(), 'JasperItNoSuchClass', userIndex())).toBe('');
    });
  });

  describe('classExistsInDictionary', () => {
    it('is true for a class present in the dictionary and false otherwise', () => {
      defineWidget();

      expect(q.classExistsInDictionary(session(), WIDGET, userIndex())).toBe(true);
      expect(q.classExistsInDictionary(session(), 'JasperItAbsent', userIndex())).toBe(false);
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

    it('CREATES a category the class does not have yet, rather than refusing', () => {
      // The Explorer's "+ new category" leaves the stone untouched until something is
      // filed there, so dropping a method on one of those rows targets a category that
      // does not exist yet: bare `moveMethod:toCategory:` answers classErrMethCatNotFound.
      defineWidget();
      expect(q.getMethodCategories(session(), WIDGET, false)).not.toContain('fresh-category');

      q.recategorizeMethod(session(), WIDGET, false, 'bar', 'fresh-category');

      expect(selectorsIn(WIDGET, false, 'fresh-category')).toContain('bar');
      expect(selectorsIn(WIDGET, false, 'accessing')).not.toContain('bar');
    });

    it('does not fall over on a category that IS already there', () => {
      // `addCategory:` raises classErrMethCatExists on one that exists, so it is guarded.
      defineWidget();
      q.compileMethod(session(), WIDGET, false, 'relocated', 'baz ^0');

      expect(q.recategorizeMethod(session(), WIDGET, false, 'bar', 'relocated').trim()).toBe('ok');
    });

    it('creates the category on the CLASS side when that is the side being moved', () => {
      defineWidget();
      q.compileMethod(session(), WIDGET, true, 'instance creation', 'make ^self new');

      q.recategorizeMethod(session(), WIDGET, true, 'make', 'building');

      expect(selectorsIn(WIDGET, true, 'building')).toContain('make');
      // The instance side is left alone — the two sides have separate category lists.
      expect(q.getMethodCategories(session(), WIDGET, false)).not.toContain('building');
    });
  });

  describe('renameCategory', () => {
    it('renames a method category, carrying its methods along', () => {
      defineWidget();

      q.renameCategory(session(), WIDGET, false, 'accessing', 'renamed-accessing');

      expect(selectorsIn(WIDGET, false, 'renamed-accessing')).toContain('bar');
      expect(selectorsIn(WIDGET, false, 'accessing')).toEqual([]);
    });

    // The Explorer's "+ new category" leaves the stone untouched until a method lands
    // there — deliberately, so a category you created and abandoned costs the stone
    // nothing. `renameCategory:to:` therefore raises on one the class does not have,
    // which is exactly why the controller renames still-empty categories locally.
    it('raises when renaming a category the class does not have', () => {
      defineWidget();

      expect(() =>
        q.renameCategory(session(), WIDGET, false, 'no-such-category', 'whatever'),
      ).toThrow();
    });
  });

  // The "+ new method" flow relies on the compiler creating the target category on
  // save — so an Explorer overlay category becomes real once it holds a method.
  describe('compileMethod into a not-yet-existing category', () => {
    it('creates an instance-side category and files the method there', () => {
      defineWidget();

      q.compileMethod(session(), WIDGET, false, 'freshly-made', 'baz ^0');

      expect(selectorsIn(WIDGET, false, 'freshly-made')).toContain('baz');
      expect(q.getMethodCategories(session(), WIDGET, false, userIndex())).toContain(
        'freshly-made',
      );
    });

    it('creates a class-side category and files the method there', () => {
      defineWidget();

      q.compileMethod(session(), WIDGET, true, 'class-side cat', 'zot ^0');

      expect(selectorsIn(WIDGET, true, 'class-side cat')).toContain('zot');
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

  describe('renameDictionary', () => {
    it('renames a dictionary in place, keeping its symbol-list position', () => {
      q.addDictionary(session(), 'JasperItRenameSrc');
      const before = dictIndexOf('JasperItRenameSrc');
      expect(before).toBeGreaterThan(0);

      const result = q.renameDictionary(session(), 'JasperItRenameSrc', 'JasperItRenameDst');

      expect(result).toBe('ok');
      expect(dictIndexOf('JasperItRenameSrc')).toBe(0); // old name gone
      expect(dictIndexOf('JasperItRenameDst')).toBe(before); // new name, same index
    });

    it('keeps the classes it holds reachable under the new name', () => {
      q.addDictionary(session(), 'JasperItRenameSrc');
      const srcIdx = dictIndexOf('JasperItRenameSrc');
      expect(srcIdx).toBeGreaterThan(0);
      // File a class INTO that dictionary (not UserGlobals), so the rename has real
      // contents to preserve. Only a live stone can confirm the self-entry swap left
      // them reachable — that's the point of asserting it here rather than in a unit test.
      q.compileClassDefinition(
        session(),
        `Object subclass: 'JasperItHeld' instVarNames: #() classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() ` +
          `inDictionary: (System myUserProfile symbolList objectNamed: #'JasperItRenameSrc')`,
      );
      expect(q.getClassNames(session(), srcIdx)).toContain('JasperItHeld');

      const result = q.renameDictionary(session(), 'JasperItRenameSrc', 'JasperItRenameDst');
      expect(result).toBe('ok');

      // The class is still there, now found under the NEW name (both via the query
      // and by resolving the dictionary itself under the new name).
      const dstIdx = dictIndexOf('JasperItRenameDst');
      expect(q.getClassNames(session(), dstIdx)).toContain('JasperItHeld');
      expect(
        exec(
          `((System myUserProfile symbolList objectNamed: #'JasperItRenameDst') ` +
            `includesKey: #'JasperItHeld') printString`,
        ).trim(),
      ).toBe('true');
    });

    it('declines when the new name is already in use, leaving both dictionaries intact', () => {
      q.addDictionary(session(), 'JasperItRenameA');
      q.addDictionary(session(), 'JasperItRenameB');

      const result = q.renameDictionary(session(), 'JasperItRenameA', 'JasperItRenameB');

      expect(result).toContain('already in use');
      expect(dictIndexOf('JasperItRenameA')).toBeGreaterThan(0);
      expect(dictIndexOf('JasperItRenameB')).toBeGreaterThan(0);
    });

    it('refuses to rename a system dictionary (UserGlobals)', () => {
      const before = userIndex();
      expect(before).toBeGreaterThan(0);

      const result = q.renameDictionary(session(), before, 'JasperItNotUserGlobals');

      expect(result).toContain('system dictionary');
      expect(dictIndexOf('UserGlobals')).toBe(before);
      expect(dictIndexOf('JasperItNotUserGlobals')).toBe(0);
    });

    it('reports "Dictionary not found" for an out-of-range index', () => {
      const result = q.renameDictionary(session(), 99999, 'JasperItNope');
      expect(result).toContain('not found');
    });
  });

  describe('renameClassCategory', () => {
    it('renames a class category and its subtree, leaving unrelated categories alone', () => {
      defineClass('JasperCatExact', 'JasperIt-Cat');
      defineClass('JasperCatChild', 'JasperIt-Cat-Sub');
      defineClass('JasperCatOther', 'JasperIt-Other');

      const result = q.renameClassCategory(session(), userIndex(), 'JasperIt-Cat', 'JasperIt-Evt');

      expect(result).toBe('renamed: 2');
      expect(categoryOf('JasperCatExact')).toBe('JasperIt-Evt');
      expect(categoryOf('JasperCatChild')).toBe('JasperIt-Evt-Sub');
      expect(categoryOf('JasperCatOther')).toBe('JasperIt-Other');
    });

    it('merges into an existing category name (categories are labels, not bindings)', () => {
      defineClass('JasperCatMoveMe', 'JasperIt-From');
      defineClass('JasperCatAlready', 'JasperIt-To');

      const result = q.renameClassCategory(session(), userIndex(), 'JasperIt-From', 'JasperIt-To');

      expect(result).toBe('renamed: 1');
      expect(categoryOf('JasperCatMoveMe')).toBe('JasperIt-To');
      expect(categoryOf('JasperCatAlready')).toBe('JasperIt-To');
    });

    it('renames nothing (count 0) when no class is in the category', () => {
      const result = q.renameClassCategory(session(), userIndex(), 'JasperIt-Nonexistent', 'X');
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
    const defineShadowPair = (): number => {
      q.compileClassDefinition(
        session(),
        `Object subclass: '${SHADOW}' instVarNames: #() classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals`,
      );
      q.addDictionary(session(), 'JasperItShadowDict');
      const shadowIdx = dictIndexOf('JasperItShadowDict');
      q.compileClassDefinition(
        session(),
        `Array subclass: '${SHADOW}' instVarNames: #() classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: JasperItShadowDict`,
      );
      return shadowIdx;
    };

    const superclassesOf = (dict: number): string[] =>
      q
        .getClassHierarchy(session(), SHADOW, dict)
        .filter((e) => e.kind === 'superclass')
        .map((e) => e.className);

    it('getClassHierarchy returns the lineage of the shadow in the given dictionary (G)', () => {
      const shadowIdx = defineShadowPair();

      // The UserGlobals shadow is a plain Object subclass — no Array in its lineage.
      expect(superclassesOf(userIndex())).toContain('Object');
      expect(superclassesOf(userIndex())).not.toContain('Array');
      // The other dictionary's shadow is an Array subclass — Array is an ancestor.
      expect(superclassesOf(shadowIdx)).toContain('Array');
    });

    it('deleteClass removes only the shadow in the targeted dictionary (I)', () => {
      const shadowIdx = defineShadowPair();

      q.deleteClass(session(), shadowIdx, SHADOW);

      expect(q.classExistsInDictionary(session(), SHADOW, shadowIdx)).toBe(false);
      expect(q.classExistsInDictionary(session(), SHADOW, userIndex())).toBe(true);
    });

    it('compileClassDefinition creates the class in the dictionary its inDictionary: names (F)', () => {
      q.addDictionary(session(), 'JasperItOther');
      const other = dictIndexOf('JasperItOther');

      q.compileClassDefinition(
        session(),
        `Object subclass: '${GADGET}' instVarNames: #() classVars: #() ` +
          `classInstVars: #() poolDictionaries: #() inDictionary: JasperItOther`,
      );

      expect(q.classExistsInDictionary(session(), GADGET, other)).toBe(true);
      expect(q.classExistsInDictionary(session(), GADGET, userIndex())).toBe(false);
    });

    // Compile `super subclass: 'name' ... inDictionary: <dict>` (base-kernel selector).
    const defineIn = (superName: string, name: string, dict: string): void => {
      q.compileClassDefinition(
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

    it('getClassDescendantNames reports a subclass in its own dictionary, not a same-named stranger', () => {
      q.addDictionary(session(), 'JasperItAlt');
      const alt = dictIndexOf('JasperItAlt');
      defineIn('Object', ROOT, 'UserGlobals');
      defineIn(ROOT, LEAF, 'UserGlobals'); // the real subclass, in UserGlobals
      defineIn('Object', LEAF, 'JasperItAlt'); // unrelated class, same name, different dictionary

      const descendants = q.getClassDescendantNames(session(), ROOT, userIndex());

      expect(descendants).toHaveLength(1);
      expect(descendants[0].className).toBe(LEAF);
      expect(descendants[0].dictIndex).toBe(userIndex());
      expect(descendants[0].dictIndex).not.toBe(alt);
    });

    it('getClassDescendantNames reports a subclass that lives in a different dictionary than its root', () => {
      q.addDictionary(session(), 'JasperItAlt');
      const alt = dictIndexOf('JasperItAlt');
      defineIn('Object', ROOT, 'UserGlobals');
      defineIn(ROOT, 'JasperItChild', 'JasperItAlt'); // subclass bound in another dictionary

      const descendants = q.getClassDescendantNames(session(), ROOT, userIndex());

      expect(descendants).toHaveLength(1);
      expect(descendants[0].className).toBe('JasperItChild');
      expect(descendants[0].dictIndex).toBe(alt);
    });

    it('deleting a subtree by each descendant’s reported dictionary spares a same-named stranger', () => {
      q.addDictionary(session(), 'JasperItAlt');
      const alt = dictIndexOf('JasperItAlt');
      defineIn('Object', ROOT, 'UserGlobals');
      defineIn(ROOT, LEAF, 'UserGlobals'); // real subclass
      defineIn('Object', LEAF, 'JasperItAlt'); // unrelated same-named class

      // Delete the subtree the way Remove Class does: each descendant by its OWN
      // reported dictionary index, then the root.
      for (const d of q.getClassDescendantNames(session(), ROOT, userIndex())) {
        q.deleteClass(session(), d.dictIndex, d.className);
      }
      q.deleteClass(session(), userIndex(), ROOT);

      // The real subclass and root are gone; the unrelated same-named class survives.
      expect(q.classExistsInDictionary(session(), LEAF, userIndex())).toBe(false);
      expect(q.classExistsInDictionary(session(), ROOT, userIndex())).toBe(false);
      expect(q.classExistsInDictionary(session(), LEAF, alt)).toBe(true);
    });
  });
});
