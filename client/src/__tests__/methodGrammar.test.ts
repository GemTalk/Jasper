import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as oniguruma from 'vscode-oniguruma';
import { Registry, parseRawGrammar, INITIAL, type IGrammar } from 'vscode-textmate';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const onigWasmPath = path.join(
  repoRoot,
  'node_modules',
  'vscode-oniguruma',
  'release',
  'onig.wasm',
);
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

/** scopeName → grammar file, taken from the manifest so this exercises what ships. */
const grammarFiles = new Map<string, string>(
  (pkg.contributes.grammars as { scopeName: string; path: string }[]).map((g) => [
    g.scopeName,
    path.join(repoRoot, g.path),
  ]),
);

const SAMPLE = [
  'at: index put: aValue',
  '  "Store aValue at index."',
  '  | tmp |',
  '  tmp := 42.',
  '  ^ self basicAt: index put: #sym',
].join('\n');

interface Token {
  text: string;
  scopes: string[];
}

// A method editor's language exists so `contributes.breakpoints` can name it
// alone; it is not meant to look any different. Its grammar reaches the Smalltalk
// rules through one `include`, and an include that silently resolves to nothing
// would leave a method editor unhighlighted with no error anywhere — so this
// tokenizes both languages with the real TextMate engine and compares.
describe('a method editor is highlighted as GemStone Smalltalk', () => {
  const unresolved: string[] = [];
  let method: IGrammar;
  let smalltalk: IGrammar;

  beforeAll(async () => {
    await oniguruma.loadWASM(fs.readFileSync(onigWasmPath));
    const registry = new Registry({
      onigLib: Promise.resolve({
        createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
        createOnigString: (s) => new oniguruma.OnigString(s),
      }),
      loadGrammar: async (scope) => {
        const file = grammarFiles.get(scope);
        if (!file) {
          unresolved.push(scope);
          return null;
        }
        return parseRawGrammar(fs.readFileSync(file, 'utf8'), file);
      },
    });
    const [m, s] = await Promise.all([
      registry.loadGrammar('source.gemstone-method'),
      registry.loadGrammar('source.gemstone-smalltalk'),
    ]);
    if (!m || !s) throw new Error('failed to load the method / Smalltalk grammars');
    method = m;
    smalltalk = s;
  });

  function tokenize(grammar: IGrammar): Token[] {
    const out: Token[] = [];
    let stack = INITIAL;
    for (const line of SAMPLE.split('\n')) {
      const result = grammar.tokenizeLine(line, stack);
      stack = result.ruleStack;
      for (const t of result.tokens) {
        out.push({ text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes });
      }
    }
    return out;
  }

  /** What a theme matches on: every scope except the root `source.` one. */
  const themeScopes = (tokens: Token[]): string[] =>
    tokens.map((t) => `${t.text}|${t.scopes.filter((s) => !s.startsWith('source.')).join(',')}`);

  it('resolves every scope the include chain reaches for', () => {
    // The chain is gemstone-method → gemstone-smalltalk → gemstone-topaz#smalltalk.
    // An unresolvable include is not an error in TextMate — it just matches
    // nothing, which is why this is worth asserting rather than assuming.
    expect(unresolved).toEqual([]);
  });

  it('gives a method the same theme scopes a Smalltalk document gets', () => {
    expect(themeScopes(tokenize(method))).toEqual(themeScopes(tokenize(smalltalk)));
  });

  it('actually highlights — the include is not resolving to nothing', () => {
    // Identical-to-Smalltalk would also be satisfied by both highlighting
    // NOTHING, so pin that real token names are produced.
    const scoped = tokenize(method).filter((t) =>
      t.scopes.some((s) => !s.startsWith('source.') && s.length > 0),
    );
    expect(scoped.length).toBeGreaterThan(0);
    const names = scoped.flatMap((t) => t.scopes).filter((s) => !s.startsWith('source.'));
    expect(names).toContain('entity.name.function.keyword.gemstone-smalltalk');
    expect(names).toContain('comment.block.gemstone-smalltalk');
    expect(names).toContain('punctuation.definition.temporaries.begin.gemstone-smalltalk');
  });

  it('keeps the token names of the borrowed grammar, so themes need no new rules', () => {
    // Every scope a theme sees still ends in `.gemstone-smalltalk`. Renaming them
    // to `.gemstone-method` would have needed every theme rule duplicating.
    const names = tokenize(method)
      .flatMap((t) => t.scopes)
      .filter((s) => !s.startsWith('source.'));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((s) => !s.endsWith('.gemstone-smalltalk'))).toEqual([]);
  });

  it('roots the document at its own scope, and does NOT nest the Smalltalk one', () => {
    // Worth stating outright, because it is the one theming difference: including
    // an external grammar by scope name contributes its RULES, not its scope. So
    // a rule targeting `source.gemstone-smalltalk` as a parent selector — a
    // user's editor.tokenColorCustomizations, say — does not reach a method
    // editor. Nothing Jasper ships relies on that (no themes, no
    // semanticTokenScopes, no injections), and the token names above are what
    // themes actually match.
    const roots = new Set(tokenize(method).map((t) => t.scopes[0]));
    expect([...roots]).toEqual(['source.gemstone-method']);
    expect(tokenize(method).some((t) => t.scopes.includes('source.gemstone-smalltalk'))).toBe(
      false,
    );
  });
});
