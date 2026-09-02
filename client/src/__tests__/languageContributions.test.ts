import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..', '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

const SMALLTALK = 'gemstone-smalltalk';
const METHOD = 'gemstone-method';

interface LanguageContribution {
  id: string;
  extensions?: string[];
  mimeTypes?: string[];
  configuration?: string;
}
interface GrammarContribution {
  language: string;
  scopeName: string;
  path: string;
}

const languages: LanguageContribution[] = pkg.contributes.languages;
const grammars: GrammarContribution[] = pkg.contributes.grammars;
const language = (id: string) => languages.find((l) => l.id === id);
const grammar = (id: string) => grammars.find((g) => g.language === id);

// VS Code decides where the breakpoint gutter is offered by LANGUAGE, and offers
// no way to narrow that by URI scheme or document. Jasper shows GemStone
// Smalltalk in a workspace, a .gst file, the debugger's read-only source views
// and a gemstone:// method editor — and only the last of those can carry a
// breakpoint, since a GemStone breakpoint is a step point in a compiled method.
// Method editors therefore have a language id of their own, named by
// `contributes.breakpoints` alone. These tests hold that line in the manifest;
// languageIds.test.ts holds the matching rule about which document gets which id.
describe('the breakpoint gutter is offered for method editors alone', () => {
  it('names gemstone-method, and nothing else, in contributes.breakpoints', () => {
    expect(pkg.contributes.breakpoints).toEqual([{ language: METHOD }]);
  });

  it('does not name gemstone-smalltalk — the language of every other document', () => {
    const named = (pkg.contributes.breakpoints as { language: string }[]).map((b) => b.language);
    expect(named).not.toContain(SMALLTALK);
  });

  it('lets nothing on disk resolve to the method language', () => {
    // A file extension would put a .gst-like file on gemstone-method and hand it
    // a gutter. A method editor is only ever tagged explicitly, in code.
    expect(language(METHOD)?.extensions).toBeUndefined();
  });

  it('lets nothing resolve to the method language by mime type', () => {
    // The debug adapter returns 'text/x-gemstone-smalltalk' for a frame's source
    // to get it highlighted; that must land on gemstone-smalltalk, never here,
    // or the read-only frame view would be offered a gutter again.
    expect(language(METHOD)?.mimeTypes).toBeUndefined();
    expect(language(SMALLTALK)?.mimeTypes).toEqual(['text/x-gemstone-smalltalk']);
  });
});

describe('a method editor is still GemStone Smalltalk in every other respect', () => {
  it('is declared as a language', () => {
    expect(language(METHOD)).toBeDefined();
  });

  it('shares the Smalltalk language configuration (brackets, comments, indent)', () => {
    expect(language(METHOD)?.configuration).toBe(language(SMALLTALK)?.configuration);
  });

  it('has a grammar, so a method editor is syntax highlighted', () => {
    expect(grammar(METHOD)).toBeDefined();
  });

  it('reaches the Smalltalk rules by including that grammar, rather than copying it', () => {
    const g = grammar(METHOD)!;
    const file = JSON.parse(fs.readFileSync(path.join(root, g.path), 'utf-8'));
    expect(file.scopeName).toBe(g.scopeName);
    // One include of the real grammar: its rules and token names apply verbatim,
    // so themes and every scope-based rule keep matching in a method editor.
    expect(file.patterns).toEqual([{ include: grammar(SMALLTALK)!.scopeName }]);
  });

  it('is not injected into any other language', () => {
    // A grammar with `injectTo` reaches into the languages it names. This one
    // must be reachable only by a document explicitly tagged gemstone-method —
    // adding a language is not licence to change how anything else is rendered.
    expect(grammar(METHOD)).not.toHaveProperty('injectTo');
  });

  it('leaves the Smalltalk grammar it borrows from untouched', () => {
    // The include is one-directional: gemstone-method reads those rules, and
    // nothing about gemstone-smalltalk (or the Topaz grammar under it) changes.
    expect(grammar(SMALLTALK)).toEqual({
      language: SMALLTALK,
      scopeName: 'source.gemstone-smalltalk',
      path: './syntaxes/gemstone-smalltalk.tmLanguage.json',
    });
  });

  it('gets the same per-language editor defaults', () => {
    const defaults = pkg.contributes.configurationDefaults;
    expect(defaults[`[${METHOD}]`]).toEqual(defaults[`[${SMALLTALK}]`]);
  });

  it('is a language the GemStone debugger serves', () => {
    expect(pkg.contributes.debuggers[0].languages).toContain(METHOD);
    expect(pkg.contributes.debuggers[0].languages).toContain(SMALLTALK);
  });

  it('keeps Execute It / Display It / Inspect It and friends in every editor command', () => {
    // The split is about the gutter and nothing else: a `when` clause that named
    // only gemstone-smalltalk would silently drop these out of the context menu
    // in method editors — where they are used most.
    const items: { command: string; when: string }[] = pkg.contributes.menus['editor/context'];
    const languageGated = items.filter((i) => i.when.includes('resourceLangId'));

    expect(languageGated.length).toBeGreaterThan(0);
    const missing = languageGated
      .filter((i) => !i.when.includes(`resourceLangId == ${METHOD}`))
      .map((i) => i.command);
    expect(missing).toEqual([]);
  });

  it('keeps those commands working in a workspace and a .gst file too', () => {
    const items: { command: string; when: string }[] = pkg.contributes.menus['editor/context'];
    const missing = items
      .filter((i) => i.when.includes('resourceLangId'))
      .filter((i) => !i.when.includes(`resourceLangId == ${SMALLTALK}`))
      .map((i) => i.command);
    expect(missing).toEqual([]);
  });
});
