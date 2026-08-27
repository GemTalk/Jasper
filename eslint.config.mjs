import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import eslintConfigPrettier from 'eslint-config-prettier';
import gitignore from 'eslint-config-flat-gitignore';
import vitest from '@vitest/eslint-plugin';

// `vitest/no-restricted-matchers` matches the *whole* modifier chain, and for a
// plain matcher name it compares by exact equality — so a `toBeTruthy` key does
// not catch `not.toBeTruthy`, `resolves.toBeTruthy`, etc. Every chain that can
// reach the matcher has to be listed for the ban to actually hold.
const RESTRICTED_MODIFIERS = ['', 'not.', 'resolves.', 'rejects.', 'resolves.not.', 'rejects.not.'];

// The advice has to name the matcher that states the intent, which depends on
// the value's type — so spell the dispatch out rather than saying "be specific"
// and leaving the reader to pick, since the easiest pick (toBeDefined) is the
// one that silently changes meaning on a `T | null`.
const TRUTHY_ADVICE =
  'Prefer a matcher that states the intent: not.toBeNull() for `T | null`, toBeDefined() for `T | undefined`, toBe(true) for a boolean, toContain(...) for a message.';
const FALSY_ADVICE =
  'Prefer a matcher that states the intent: toBeNull(), toBeUndefined(), toBe(false), or toHaveLength(0).';

// A `not.`-bearing chain asserts the opposite of its matcher, so it takes the
// opposite advice: `not.toBeTruthy()` is a falsy assertion and wants the falsy
// replacements, not the truthy ones.
const banChain = (matcher, message, negatedMessage) =>
  Object.fromEntries(
    RESTRICTED_MODIFIERS.map((prefix) => [
      prefix + matcher,
      prefix.includes('not.') ? negatedMessage : message,
    ]),
  );

export default tseslint.config(
  // Keep lint ignores in sync with every `.gitignore` in the repo, instead of
  // a hand-maintained duplicate list that drifts (e.g. missed `.vscode-test/`
  // choking the parser on a downloaded test binary).
  gitignore({ recursive: true }),
  {
    // Tracked files that are intentionally excluded from lint, not from git —
    // no `.gitignore` equivalent, so these stay explicit.
    ignores: ['**/*.d.ts', 'resources/**'],
  },
  // `eslint .` only auto-targets extensions it has a language for by default;
  // this makes the intent explicit and future-proofs against config drift.
  { files: ['**/*.{ts,mts,cts,js,mjs,cjs}'] },
  js.configs.recommended,
  ...tseslint.configs.recommended, // non-type-checked only — no `projectService`/type-aware rules for now
  {
    // Type-aware linting, scoped to `**/*.ts` (the files covered by a workspace
    // tsconfig.json — client/server/mcp-server/acceptance). `projectService`
    // finds the nearest tsconfig per file rather than needing an explicit list.
    // Enabling type-aware rules individually rather than the full
    // `recommendedTypeChecked` set, which surfaces ~2k pre-existing findings
    // across the codebase that need separate triage
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: {
          // vitest.config.ts files aren't included in any tsconfig's `include`,
          // so type-aware linting can't otherwise parse them. `defaultProject`
          // is the fallback used for those globs too, not just `client/bin/*.ts`
          // — a mismatch (it's `client/tsconfig.bin.json`, not a vitest config)
          // that's benign because only `compilerOptions` matter for these
          // inline programs, and both configs extend `tsconfig.base.json`.
          // Don't "fix" this to look more consistent.
          allowDefaultProject: ['vitest.config.ts', '*/vitest.config.ts', 'client/bin/*.ts'],
          defaultProject: 'client/tsconfig.bin.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    // Catches stale `eslint-disable` comments that no longer suppress anything.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    plugins: { 'eslint-comments': eslintComments },
    rules: {
      // Require a `-- reason` on every eslint-disable comment, so suppressions
      // must be justified inline instead of silently added.
      'eslint-comments/require-description': 'error',
    },
  },
  {
    rules: {
      // Real dead-code signal, so this stays an error. The `^_` patterns let
      // intentionally-unused params/locals/catch bindings (required by a
      // signature or destructure) opt out by prefixing with `_`, instead of
      // disabling the rule outright.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // Plain (non-TS) sources split by runtime so `no-undef` reflects the globals
  // actually available at runtime instead of flagging everything or nothing.
  {
    // Webview-side JS bundled into the extension UI (runs in a browser-like webview).
    files: ['client/src/**/*.js'],
    // Shared with a Node bin script below — not a webview global consumer.
    ignores: ['client/src/gemStoneVersion.js'],
    // `acquireVsCodeApi` is the VS Code webview host bridge, injected into the
    // webview global scope — not part of `globals.browser`.
    languageOptions: { globals: { ...globals.browser, acquireVsCodeApi: 'readonly' } },
  },
  {
    // Config/build scripts and CLI bin scripts, plus gemStoneVersion.js: a plain
    // CJS module `require()`'d directly by client/bin/gemstone-integration-versions.js
    // (see that file's header) so it can't depend on compiled TS output.
    files: [
      '**/*.mjs',
      '**/*.cjs',
      'client/bin/**/*.js',
      'client/bin/**/*.ts',
      '**/*.config.{ts,js,mjs}',
      'client/src/gemStoneVersion.js',
      // Server-side refactoring-engine build tooling (Node CLI scripts that
      // transform Tonel sources into `.gs` payloads).
      'gs-src/**/*.js',
    ],
    languageOptions: { globals: { ...globals.node } },
    // These are CJS/Node runtime scripts where `require()` is the correct module
    // system — they can't `import` compiled TS output — so `require()` isn't a
    // lint smell here.
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // jsdom test setup: runs under Node but polyfills the simulated browser
    // `window`, so it needs both Node globals (from the `**/*.cjs` block above,
    // which still applies) and browser globals (added here) to satisfy `no-undef`.
    files: ['client/src/__tests__/vitest.windowSetup.cjs'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Vitest-specific best-practice rules, scoped to test files across all
    // workspaces. Only a subset of `vitest.configs.recommended` is enabled:
    // `no-conditional-expect` has been triaged and turned on; the rest
    // (expect-expect, no-standalone-expect, no-mocks-import,
    // no-disabled-tests) currently have real violations across ~90 test
    // files that need separate triage before they can be turned on.
    files: ['**/__tests__/**/*.test.ts'],
    plugins: { vitest },
    rules: {
      'vitest/no-conditional-expect': 'error',
      'vitest/no-commented-out-tests': 'error',
      'vitest/no-focused-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/no-import-node-test': 'error',
      'vitest/no-interpolation-in-snapshots': 'error',
      'vitest/no-unneeded-async-expect-function': 'error',
      'vitest/prefer-called-exactly-once-with': 'error',
      // toBeTruthy/toBeFalsy are vague: they pass for any truthy/falsy value,
      // so a misuse can assert the wrong thing without failing (e.g. a typo'd
      // getter that returns '' instead of undefined), and a real failure just
      // reports "expected truthy, got falsy" instead of showing the value.
      // Ban them and require a matcher that states the actual intent.
      'vitest/no-restricted-matchers': [
        'error',
        {
          ...banChain('toBeTruthy', TRUTHY_ADVICE, FALSY_ADVICE),
          ...banChain('toBeFalsy', FALSY_ADVICE, TRUTHY_ADVICE),
        },
      ],
      'vitest/require-local-test-context-for-concurrent-snapshots': 'error',
      'vitest/valid-describe-callback': 'error',
      'vitest/valid-expect': 'error',
      'vitest/valid-expect-in-promise': 'error',
      'vitest/valid-title': 'error',
    },
  },
  {
    // client/src/__tests__/gci/** is mid-migration to a different test
    // approach; no-conditional-expect violations there are being replaced,
    // not fixed in place.
    files: ['client/src/__tests__/gci/**/*.test.ts'],
    rules: { 'vitest/no-conditional-expect': 'off' },
  },
  // Disables stylistic ESLint rules that would conflict with Prettier; must stay last.
  eslintConfigPrettier,
);
