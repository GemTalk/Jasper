import { describe, it, expect, vi } from 'vitest';

// Real GCI, but stub the `vscode` module the query layer pulls in via gciLog.
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../gciLibrary';
import * as q from '../../browserQueries';
import type { ActiveSession } from '../../sessionManager';

/**
 * The file-out queries against a live stone (issue #539).
 *
 * These exercise the four GemStone entry points behind File Out — `fileOutClass`,
 * `fileOutMethod:environmentId:`, `fileOutCategory:` and
 * `ClassOrganizer>>fileOutClassesAndMethodsInDictionary:on:` — which is the half a
 * unit test cannot reach: the unit tests pin the Smalltalk we emit, only a stone can
 * say whether the image answers Topaz chunks for it.
 *
 * Every test is transient. The harness wraps each in a GciTsBegin/GciTsAbort pair,
 * and the fixture class is compiled inside that transaction, so nothing is committed
 * and no kernel class is touched. Emitted Smalltalk stays ASCII-only, since the suite
 * also runs on 3.6.x (a non-ASCII char in compiled source trips its compiler bug).
 */
describe('file out queries (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const session = (): ActiveSession => ({ id: 1, gci, handle }) as unknown as ActiveSession;
  const exec = (code: string): string => q.executeFetchString(session(), code);

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

  const WIDGET = 'JasperFileOutWidget';

  // A throwaway class in UserGlobals (writable by any user) with one instance
  // method and one class method, in known categories.
  const defineWidget = (): void => {
    q.compileClassDefinition(
      session(),
      `Object subclass: '${WIDGET}' instVarNames: #('size') classVars: #() ` +
        'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
    );
    q.compileMethod(session(), WIDGET, false, 'accessing', 'size ^size');
    q.compileMethod(session(), WIDGET, false, 'accessing', 'size: aValue size := aValue');
    q.compileMethod(session(), WIDGET, true, 'instance creation', 'make ^self new');
  };

  describe('fileOutHeader', () => {
    it('opens with the fileformat directive Topaz needs to read the file back', () => {
      const header = q.fileOutHeader(session());

      expect(header.split('\n')[0]).toBe('fileformat utf8');
    });

    it('names the image it came out of, as a comment', () => {
      const header = q.fileOutHeader(session());

      expect(header).toContain('! From ');
      expect(header).toContain('GemStone');
      // Everything under the directive is comment, so nothing there can be executed.
      const nonComment = header
        .split('\n')
        .slice(1)
        .filter((line) => line.length > 0 && !line.startsWith('!'));
      expect(nonComment).toEqual([]);
    });
  });

  describe('fileOutClass', () => {
    it('answers a definition and the methods, in Topaz chunk form', () => {
      defineWidget();

      const source = q.fileOutClass(session(), WIDGET, userIndex());

      expect(source).toContain(`Object subclass: '${WIDGET}'`);
      expect(source).toContain(`method: ${WIDGET}`);
      expect(source).toContain(`classmethod: ${WIDGET}`);
      expect(source).toContain('size ^size');
      expect(source).toContain('make ^self new');
    });
  });

  describe('fileOutMethod', () => {
    it('answers one method chunk, with no class definition around it', () => {
      defineWidget();

      const source = q.fileOutMethod(session(), WIDGET, false, 'size', userIndex());

      expect(source).toContain(`method: ${WIDGET}`);
      expect(source).toContain("category: 'accessing'");
      expect(source).toContain('size ^size');
      // A method file-out reads back into a stone that already has the class —
      // redefining it here would drop every method the class has.
      expect(source).not.toContain('subclass:');
      expect(source).not.toContain('size: aValue');
    });

    it('answers the class-side method as a classmethod chunk', () => {
      defineWidget();

      const source = q.fileOutMethod(session(), WIDGET, true, 'make', userIndex());

      expect(source).toContain(`classmethod: ${WIDGET}`);
      expect(source).toContain('make ^self new');
    });

    it('fails loudly on a class that does not resolve', () => {
      expect(() => q.fileOutMethod(session(), 'JasperFileOutNoSuchClass', false, 'x')).toThrow(
        /Class not found/,
      );
    });
  });

  describe('fileOutMethodCategory', () => {
    it('answers every method in the category and nothing from another one', () => {
      defineWidget();

      const source = q.fileOutMethodCategory(session(), WIDGET, false, 'accessing', userIndex());

      expect(source).toContain('size ^size');
      expect(source).toContain('size: aValue');
      expect(source).not.toContain('make ^self new');
    });

    it('answers the class-side category', () => {
      defineWidget();

      const source = q.fileOutMethodCategory(
        session(),
        WIDGET,
        true,
        'instance creation',
        userIndex(),
      );

      expect(source).toContain(`classmethod: ${WIDGET}`);
      expect(source).toContain('make ^self new');
    });

    it('fails loudly on a category no symbol exists for', () => {
      defineWidget();

      expect(() =>
        q.fileOutMethodCategory(session(), WIDGET, false, 'no such category at all', userIndex()),
      ).toThrow(/Method category not found/);
    });
  });

  describe('fileOutDictionary', () => {
    it('answers the definition and methods of the classes the dictionary binds', () => {
      defineWidget();

      const source = q.fileOutDictionary(session(), userIndex());

      expect(source).toContain(`Object subclass: '${WIDGET}'`);
      expect(source).toContain('size ^size');
      expect(source).toContain('make ^self new');
    });

    it('orders a class after its superclass, so the file reads back in as-is', () => {
      defineWidget();
      q.compileClassDefinition(
        session(),
        `${WIDGET} subclass: 'JasperFileOutSubWidget' instVarNames: #() classVars: #() ` +
          'classInstVars: #() poolDictionaries: #() inDictionary: UserGlobals',
      );

      const source = q.fileOutDictionary(session(), userIndex());

      expect(source.indexOf(`Object subclass: '${WIDGET}'`)).toBeLessThan(
        source.indexOf(`${WIDGET} subclass: 'JasperFileOutSubWidget'`),
      );
    });

    it('fails loudly on a dictionary index that no longer exists', () => {
      expect(() => q.fileOutDictionary(session(), 9999)).toThrow(/Dictionary not found/);
    });
  });
});
