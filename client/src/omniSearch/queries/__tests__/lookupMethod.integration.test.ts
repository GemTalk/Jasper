// Integration test for `lookupMethod`, the query behind pasting `Class>>selector` into GemStone
// Search. Base-image classes only, so it runs in both the bare and plugin CI passes.
//
// Which ancestor defines an inherited method differs between releases (OrderedCollection's
// printString comes from Collection on 3.7.5), so the inherited case asserts that the class named
// really defines the selector rather than pinning the class.
import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => import('../../../__mocks__/vscode.js'));

import { useIntegrationTest } from '../../../__tests__/useIntegrationTest';
import { GciLibrary } from '../../../gciLibrary';
import { defaultQueryExecutorUsing } from '../../../browserQueries';
import { lookupMethod } from '../lookupMethod';
import { testActiveSession } from '../../../__tests__/testActiveSession';

describe('lookupMethod (integration)', () => {
  let gci: GciLibrary;
  let handle: unknown;
  useIntegrationTest((testContext) => {
    gci = testContext.gciLibrary;
    handle = testContext.session;
  });

  const exec = (code: string): string =>
    defaultQueryExecutorUsing(testActiveSession(gci, handle))(code);

  it('finds a method the class defines itself', () => {
    const rows = lookupMethod(exec, 'Object', false, 'printString');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dictName: 'Globals',
      className: 'Object',
      isMeta: false,
      selector: 'printString',
    });
    expect(rows[0].category).not.toBe('');
    expect(rows[0].inheritedBy).toBeUndefined();
  });

  it('finds an inherited method on the ancestor that defines it', () => {
    const rows = lookupMethod(exec, 'OrderedCollection', false, 'printString');
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.inheritedBy).toBe('OrderedCollection');
    expect(row.className).not.toBe('OrderedCollection');
    const definer = `${row.className}${row.isMeta ? ' class' : ''}`;
    expect(exec(`(${definer} includesSelector: #printString) printString`).trim()).toBe('true');
    expect(exec(`(OrderedCollection inheritsFrom: ${row.className}) printString`).trim()).toBe(
      'true',
    );
  });

  it('finds a class-side method', () => {
    const rows = lookupMethod(exec, 'String', true, 'new');
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.selector).toBe('new');
    // The metaclass chain ends in Class, so an inherited `new` can come back instance-side.
    const definer = `${row.className}${row.isMeta ? ' class' : ''}`;
    expect(exec(`(${definer} includesSelector: #new) printString`).trim()).toBe('true');
  });

  // Temporary classes for the cases the base image can't pin down. The harness aborts after each
  // test, which also drops the dictionary added to the symbol list.
  const defineClass = (dict: string) =>
    exec(
      `Object subclass: 'Jasper677Lookup' instVarNames: #() classVars: #() classInstVars: #() ` +
        `poolDictionaries: #() inDictionary: ${dict} options: #(). 'ok'`,
    );

  it('names the class side in inheritedBy when a class-side reference inherits the method', () => {
    defineClass('UserGlobals');
    const rows = lookupMethod(exec, 'Jasper677Lookup', true, 'new');
    expect(rows).toHaveLength(1);
    expect(rows[0].inheritedBy).toBe('Jasper677Lookup class');
  });

  it('reports the dictionary of a class outside Globals that defines the method', () => {
    defineClass('UserGlobals');
    exec(
      `Jasper677Lookup compileMethod: 'own677 ^ 1' dictionaries: System myUserProfile symbolList ` +
        `category: #testing environmentId: 0. 'ok'`,
    );
    expect(lookupMethod(exec, 'Jasper677Lookup', false, 'own677')).toEqual([
      {
        dictName: 'UserGlobals',
        className: 'Jasper677Lookup',
        isMeta: false,
        selector: 'own677',
        category: 'testing',
      },
    ]);
  });

  it('gives one row when two same-named classes inherit the method from the same class', () => {
    defineClass('UserGlobals');
    exec(
      `| d | d := SymbolDictionary new. d name: #Jasper677Dict. ` +
        `System myUserProfile symbolList add: d. 'ok'`,
    );
    defineClass('Jasper677Dict');
    expect(
      exec(
        `((UserGlobals at: #Jasper677Lookup) == (Jasper677Dict at: #Jasper677Lookup)) printString`,
      ),
    ).toBe('false');
    const rows = lookupMethod(exec, 'Jasper677Lookup', false, 'printString');
    expect(rows).toHaveLength(1);
    expect(rows[0].className).not.toBe('Jasper677Lookup');
  });

  it('creates no symbol for a class or selector the stone has never seen', () => {
    // Fresh names each run: a symbol, once made, outlives the transaction the harness aborts.
    const unseen = `jasper677Unseen${Date.now()}`;
    const unseenClass = `Jasper677Unseen${Date.now()}`;
    expect(lookupMethod(exec, 'Object', false, unseen)).toEqual([]);
    expect(lookupMethod(exec, unseenClass, false, 'printString')).toEqual([]);
    expect(exec(`(Symbol _existingWithAll: '${unseen}') printString`)).toBe('nil');
    expect(exec(`(Symbol _existingWithAll: '${unseenClass}') printString`)).toBe('nil');
  });

  it('finds nothing for a selector no class in the chain defines', () => {
    expect(lookupMethod(exec, 'Object', false, 'noSuchSelector677')).toEqual([]);
  });

  it('finds nothing for a class that does not exist', () => {
    expect(lookupMethod(exec, 'NoSuchClass677', false, 'printString')).toEqual([]);
  });

  it('matches the class name exactly, case included', () => {
    expect(lookupMethod(exec, 'object', false, 'printString')).toEqual([]);
  });
});
