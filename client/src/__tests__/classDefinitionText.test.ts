import { describe, it, expect } from 'vitest';
import {
  splitOutCategory,
  withCategoryLine,
  classNameFromDefinition,
  dictNameFromDefinition,
} from '../classDefinitionText';

const TEMPLATE = `Object subclass: 'Boo'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: MyDict
  category: 'User Classes'
  options: #()`;

describe('splitOutCategory', () => {
  it('removes the category line and returns its value', () => {
    const { source, category } = splitOutCategory(TEMPLATE);

    expect(category).toBe('User Classes');
    expect(source).not.toContain('category:');
    // What remains is the always-valid 7-keyword form.
    expect(source).toContain('inDictionary: MyDict');
    expect(source).toContain('options: #()');
  });

  it('leaves a definition without a category line unchanged', () => {
    const noCategory = `Object subclass: 'Boo'\n  inDictionary: MyDict\n  options: #()`;

    const { source, category } = splitOutCategory(noCategory);

    expect(category).toBeUndefined();
    expect(source).toBe(noCategory);
  });

  it('unescapes doubled single quotes in the category', () => {
    const src = `Object subclass: 'Boo'\n  category: 'O''Brien-Stuff'\n  options: #()`;

    expect(splitOutCategory(src).category).toBe("O'Brien-Stuff");
  });
});

describe('withCategoryLine', () => {
  it('inserts the category immediately before options:', () => {
    const def = `Object subclass: 'Boo'\n  inDictionary: MyDict\n  options: #()\n`;

    const out = withCategoryLine(def, 'Collections-Dictionaries');

    expect(out).toContain("  category: 'Collections-Dictionaries'\n  options: #()");
  });

  it('appends the category when there is no options: line', () => {
    const def = `nil subclass: 'Object'\n  inDictionary: Globals`;

    const out = withCategoryLine(def, 'Kernel-Objects');

    expect(out.trimEnd().endsWith("  category: 'Kernel-Objects'")).toBe(true);
  });

  it('escapes single quotes and round-trips through splitOutCategory', () => {
    const def = `Object subclass: 'Boo'\n  options: #()\n`;

    const shown = withCategoryLine(def, "O'Brien");

    expect(shown).toContain("category: 'O''Brien'");
    expect(splitOutCategory(shown).category).toBe("O'Brien");
  });

  it('returns the definition unchanged for an empty category', () => {
    const def = `Object subclass: 'Boo'\n  options: #()`;
    expect(withCategoryLine(def, '')).toBe(def);
  });
});

describe('classNameFromDefinition', () => {
  it('reads the class name from the subclass clause', () => {
    expect(classNameFromDefinition(TEMPLATE)).toBe('Boo');
    expect(classNameFromDefinition("AbstractDictionary subclass: 'Dictionary'\n …")).toBe(
      'Dictionary',
    );
  });

  it('returns undefined when there is no subclass clause', () => {
    expect(classNameFromDefinition('42 + 1')).toBeUndefined();
  });
});

describe('dictNameFromDefinition', () => {
  it('reads the dictionary bareword from the inDictionary: clause', () => {
    expect(dictNameFromDefinition(TEMPLATE)).toBe('MyDict');
    expect(dictNameFromDefinition("Object subclass: 'Boo'\n  inDictionary: UserGlobals")).toBe(
      'UserGlobals',
    );
  });

  it('reads a dictionary name containing digits and underscores', () => {
    expect(dictNameFromDefinition('  inDictionary: Issue328_Dict2')).toBe('Issue328_Dict2');
  });

  it('returns undefined when there is no inDictionary: clause', () => {
    expect(dictNameFromDefinition("Object subclass: 'Boo'\n  options: #()")).toBeUndefined();
  });
});
