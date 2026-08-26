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

// An integration test never acquires a session; it receives one. Every session
// `useIntegrationTest` hands out is armed with GemStone's session-level commit
// guard, so nothing the test does can outlive its automatic abort. A test that
// logs in on its own gets an *unarmed* session -- and unlike a refused commit,
// which fails loudly with GemStone error 2249, that succeeds silently and
// writes to the shared stone. Nothing detects it at runtime, which is why the
// rules below catch it at lint time instead.
//
// Building a session outside the harness takes three things: a library
// instance, a login call, and credentials. Each is banned separately, so
// working around one selector (by renaming the receiver, say) still trips
// another. Committing is deliberately *not* banned -- the harness already
// refuses it, in the stone, with a message naming itself.
const OWN_GCI_LIBRARY =
  'Prefer the loaded library on the test context (`testContext.gciLibrary`). A second GciLibrary instance is the first half of a session the harness never armed.';
const RAW_GCI_LOGIN =
  'Prefer the session on the test context (`testContext.session`), or `withTransientSession(...)` for a second one. The raw GciTs*Login* wrappers return a session the harness never armed with the commit guard.';
const GCI_LIBRARY_LOGIN =
  'Prefer the session on the test context (`testContext.session`), or `withTransientSession(...)` for a second one. `GciLibrary.login` returns a session the harness never armed with the commit guard.';
const LOGIN_CREDENTIALS =
  'Prefer letting `useIntegrationTest` read the connection environment. A test reaching for the password is assembling its own login, and that session is not armed with the commit guard.';
const FORKED_GEM =
  'Prefer running the expression on the test context session. A forked gem runs in a session of its own that the harness never armed, and it outlives the test.';

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
  {
    // Confines every test to the harness's session (see the message constants
    // above for why).
    //
    // Three exemptions, for two different reasons:
    //
    // `client/src/__tests__/gci/**` is being deleted, not fixed. Every file
    // there logs in for itself, so the rule would only collect disables that
    // leave with the files.
    //
    // The other two are the unit tests *of* the login bindings, and they are
    // exempt as whole files because naming those bindings is the whole point of
    // each: `gciLoginQuiet` calls all four raw wrappers to assert the quiet bit
    // reaches the native layer, and `gciOptionalFunctions` calls the ones an
    // older library lacks to assert each throws. Both mock `koffi`, so a call
    // reaches a `vi.fn()` and never a stone -- there is no session to arm, and
    // so nothing for this rule to protect. Matched by basename rather than
    // path, so moving either file keeps its exemption.
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.tsx'],
    ignores: [
      'client/src/__tests__/gci/**',
      '**/gciLoginQuiet.test.ts',
      '**/gciOptionalFunctions.test.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='GciLibrary']", message: OWN_GCI_LIBRARY },
        {
          // Shaped as a call, not a bare member access: `vi.fn()`-mocked
          // libraries are *named* in assertions all over the unit tests
          // (`expect(gci.GciTsLogin).not.toHaveBeenCalled()`), and flagging
          // those would flag the tests that prove a path does not log in. A
          // call is the thing that acquires a session. Pulling the wrapper into
          // a local first would slip past this selector, but not past the
          // `new GciLibrary` and password bans either side of it.
          selector: 'CallExpression[callee.property.name=/^GciTsN?b?Login_?$/]',
          message: RAW_GCI_LOGIN,
        },
        {
          // Keyed on the receiver, not the bare name: `login` is also the
          // harness's own re-login on the test context, and `testContext.login`
          // / `testContext.login()` / a destructured `login()` are all
          // legitimate. Only a `login` sent to the GciLibrary itself is the
          // escape hatch.
          selector:
            "CallExpression[callee.object.name=/^gci(Library)?$/][callee.property.name='login']",
          message: GCI_LIBRARY_LOGIN,
        },
        {
          // The sharpest of the four and the hardest to work around: there is
          // no login without a password, whatever the receiver is called. The
          // other VITE_GEMSTONE_* values stay allowed -- tests read the gem NRS
          // and library path for reasons that have nothing to do with logging in.
          selector: "MemberExpression[property.name='VITE_GEMSTONE_PASSWORD']",
          message: LOGIN_CREDENTIALS,
        },
        {
          // The import ban below only sees the module specifier, so a call
          // that reaches the fork query through a re-export slips past it.
          // Keyed on a call through a receiver: the direct-import form stays
          // the import rule's job, and the fork query's own unit test (bare
          // calls on a mocked executor, no stone) is left alone.
          selector: 'CallExpression[callee.property.name=/^(canForkGem|forkGemRunning)$/]',
          message: FORKED_GEM,
        },
      ],
      // The typescript-eslint drop-in, for `allowTypeImports`: naming a type
      // from the fork query forks nothing.
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/queries/forkGem'], message: FORKED_GEM, allowTypeImports: true },
          ],
        },
      ],
    },
  },
  // Disables stylistic ESLint rules that would conflict with Prettier; must stay last.
  eslintConfigPrettier,
);
