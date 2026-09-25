import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import eslintConfigPrettier from 'eslint-config-prettier';
import gitignore from 'eslint-config-flat-gitignore';
import vitest from '@vitest/eslint-plugin';
// The gated set of the GCI optionality rule below, read from the registry
// itself rather than restated here -- the drift that registry exists to end.
// Imported as `.ts` on purpose: Node strips the types, so the config reads the
// same module `gciLibrary.ts` does. Keep that file free of non-erasable syntax
// (`enum`, `namespace`), which would break lint while still compiling.
import { GCI_OPTIONAL_FUNCTIONS } from './client/src/gciLibrary/optionalFunctions.ts';
// Same reasoning as the import above: Node strips the types, so this reads
// the same module the codebase does. Imported as `.ts` on purpose.
import { absenceHazard } from './client/src/gciLibrary/absenceHazard.ts';

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
// instance, a login call, and credentials. Each is banned separately, and none
// of the selectors keys on a receiver's name, so renaming or re-routing the
// receiver does not shake any of them off -- and working around one still
// trips another. Committing is deliberately *not* banned -- the harness already
// refuses it, in the stone, with a message naming itself.
const OWN_GCI_LIBRARY =
  'Prefer the loaded library on the test context (`testContext.gciLibrary`). A second GciLibrary instance is the first half of a session the harness never armed.';
const RAW_GCI_LOGIN =
  'Prefer the session on the test context (`testContext.session`), or `withTransientSession(...)` for a second one. The raw GciTs*Login* wrappers return a session the harness never armed with the commit guard.';
const GCI_LIBRARY_LOGIN =
  'Prefer the session on the test context (`testContext.session`), or `withTransientSession(...)` for a second one. `GciLibrary.login` returns a session the harness never armed with the commit guard.';
const LOGIN_CREDENTIALS =
  'Prefer letting `useIntegrationTest` read the connection environment. A test reaching for the password is assembling its own login, and that session is not armed with the commit guard.';
// Every name the connection helpers give the password. Shared by the two
// selectors below, which differ only in the syntax they read it with.
const PASSWORD_NAMES = '/^(VITE_GEMSTONE_PASSWORD|gsPassword|GS_PASSWORD)$/';
// Every raw login wrapper on `GciLibrary`, including the non-blocking
// completion call: a test holding a socket from a non-blocking start finishes
// its login through `GciTsNbLoginFinished`, and that session is unarmed too.
const RAW_LOGIN_NAMES = '/^GciTsN?b?Login(_|Finished)?$/';
const FORKED_GEM =
  'Prefer running the expression on the test context session. A forked gem runs in a session of its own that the harness never armed, and it outlives the test.';
// Only a raw-wrapper test -- one that exercises the GCI binding layer
// directly, under client/src/gciLibrary/__tests__/ -- may legitimately skip
// on a missing symbol. One level up, a missing symbol is a *behavior* (a
// fallback, a refusal message) that a feature-level test must assert on every
// version; skipping there hides a missing fallback instead of exercising it.
const HAND_ROLLED_CAPABILITY_CHECK =
  'Use requireGciCapability from client/src/gciLibrary/__tests__/, not a hand-rolled isAvailable/supportsNonBlockingLogin check. Only a raw-wrapper test exercising the GCI binding layer directly may skip on a missing symbol -- a feature-level test should assert the fallback instead.';
const IMPORT_REQUIRE_GCI_CAPABILITY =
  'A capability check belongs one level down, in client/src/gciLibrary/__tests__/, wrapped in requireGciCapability -- not imported and hand-rolled up here. Only a raw-wrapper test exercising the GCI binding layer directly may skip on a missing symbol; a feature-level test should assert the fallback instead.';
// The two hand-rolled capability checks the mechanism above replaces. Shared
// by the selectors below, which differ only in the syntax they read a name
// with -- the same split as `PASSWORD_NAMES`/`RAW_LOGIN_NAMES`.
const CAPABILITY_CHECK_NAMES = '/^(isAvailable|supportsNonBlockingLogin)$/';

// Call-shaped for the reason the raw-login selector below states: a
// `vi.fn()`-mocked binding is legitimately *named* in assertions
// (`expect(gci.isAvailable).toHaveBeenCalledWith(...)`), and only a call
// hand-rolls a skip. The two routes past it are closed as the password
// selectors close them: computed access (`.value`, no `.name`), and the
// destructuring bind, which is no `CallExpression` at all.
// `ObjectPattern`-anchored, so a mock *definition* stays legal:
// `makeGci({ isAvailable: ... })` in codeExecutor.test.ts.
const CAPABILITY_CHECK_SELECTORS = [
  {
    selector: `CallExpression:matches([callee.property.name=${CAPABILITY_CHECK_NAMES}], [callee.property.value=${CAPABILITY_CHECK_NAMES}])`,
    message: HAND_ROLLED_CAPABILITY_CHECK,
  },
  {
    selector: `ObjectPattern > Property:matches([key.name=${CAPABILITY_CHECK_NAMES}], [key.value=${CAPABILITY_CHECK_NAMES}])`,
    message: HAND_ROLLED_CAPABILITY_CHECK,
  },
];

// A halt offers ONE debugger -- the GemStone Debugger panel. The DAP debugger is
// still registered (`registerDebugAdapterDescriptorFactory('gemstone', ...)` in
// extension.ts, plus the `gemstone` entry under contributes.debuggers), but
// registration is not a way in: attaching needs the `sessionId` and `gsProcess`
// attributes, and nothing supplies them any more, so it is dormant. What is
// fenced off here is the extension re-growing a caller that puts it in front of
// the user unasked -- the two lines that would do it, on a halt path where no
// per-path unit test would be looking.
const DAP_ENTRY_POINT =
  'Nothing in the extension may open the DAP debugger for the user: a halt offers the GemStone Debugger panel (DebuggerPanel.create). The `gemstone` debug type stays registered rather than torn out, but with no caller to supply its `sessionId`/`gsProcess` attach attributes it is dormant, not a second way in.';

// `rewriteRelativeImportExtensions` in tsconfig.base.json makes a `.ts`
// specifier legal in every workspace, but it is wanted in only the few modules
// that must also load under Node's type-stripping, which resolves nothing else.
// Everywhere else it is the wrong idiom, so the flag is fenced off here rather
// than left to convention. Per-file `files:` overrides mark the exceptions.
//
// Repeated in each block that configures this rule: flat config *replaces* a
// rule's options rather than merging them, so a block setting
// `@typescript-eslint/no-restricted-imports` for its own reason would otherwise
// drop this ban for the files it matches.
const TS_EXTENSION_IMPORT = {
  regex: String.raw`^\.{1,2}/.*\.ts$`,
  message:
    'Import the module without the `.ts` extension. An explicit `.ts` specifier is for modules that must also load under Node type-stripping, and the exceptions are listed in eslint.config.mjs.',
};

// Production code must not call a `GciTs*` binding that may be absent from the
// loaded library. Those bind through `optionalFunc`, so Jasper still *loads*
// against a library missing them -- it's the call that throws, and neither a
// 3.7.5 dev image nor a macOS/Linux dev machine ever shows you that. Every
// entry of the registry is gated, on all three of its axes.
//
// Selectors generated from the registry rather than a custom rule, so the
// gated names live in the *rule options*: `eslint`'s result cache keys each
// file on a hash of its resolved config (`lint-result-cache.js`), which sees
// options but not data a rule closed over -- so a rule reading the registry
// internally would leave a cached file green after a new entry lands.
//
// Background: `docs/explanation/gci-version-compatibility.md`.
//
// The hazard-message rendering (including both throw-guards: an unknown
// `absentOn` value, and an entry whose every axis renders nothing) lives in
// `client/src/gciLibrary/absenceHazard.ts`, so it is shared with anything
// else that needs to explain why a GCI symbol may be absent.
const OPTIONAL_GCI_CALL = Object.entries(GCI_OPTIONAL_FUNCTIONS).flatMap(([name, reason]) => {
  const hazard = absenceHazard(name, reason);
  const message = `${name} may be absent from the loaded library (${hazard}). Put the cross-version conditional inside client/src/gciLibrary/ and call a helper from there, so this call site doesn't have to know about optionality.`;
  // Gated on the *mention*, not the call shape. The `RAW_LOGIN_NAMES`
  // selectors below are call-shaped because a test legitimately names a mocked
  // binding (`expect(gci.GciTsLogin).not.toHaveBeenCalled()`); this block's
  // `files`/`ignores` already exclude tests and mocks, so in the files it
  // covers there is no innocent reason to name one of these at all. A bare
  // member access is the hazard whatever wraps it -- a cast, `.call`, `.bind`
  // or a renaming destructure all reach the native library just the same.
  //
  // One selector per syntax the name can wear: `.name` for `gci.GciTsNbPoll`,
  // `.value` for the `Literal` in `gci['GciTsNbPoll']` (as the password
  // selectors below are matched both ways), `callee.name` for a destructured
  // local, the `ObjectPattern` clause for the destructure that binds it, and
  // `quasis` for a template-literal key. The `ObjectPattern >` prefix is
  // load-bearing: a bare `Property[key.name]` would flag the registry's own
  // object literal in `gciLibrary/optionalFunctions.ts`, which this block
  // covers -- only `gciLibrary.ts` is exempt.
  //
  // Where the fence ends: genuinely dynamic dispatch still slips through --
  // `gci[k](...)` for a computed `k`, `Reflect.get(gci, name)`, a name
  // assembled at runtime. No syntactic selector can see those, and the deleted
  // test documented the same blind spot; this is that sentence.
  return [
    { selector: `MemberExpression[property.name='${name}']`, message },
    { selector: `MemberExpression[property.value='${name}']`, message },
    { selector: `CallExpression[callee.name='${name}']`, message },
    { selector: `ObjectPattern > Property[key.name='${name}']`, message },
    { selector: `MemberExpression[property.quasis.0.value.raw='${name}']`, message },
  ];
});

// Shared by both harness-session blocks below, which must exempt the same
// files, so each restates its whole `ignores` array (see TS_EXTENSION_IMPORT
// above for why).
//
// `client/src/__tests__/gci/**` is being deleted, not fixed -- every file
// there logs in for itself, so the rule would only collect disables that
// leave with the files. The other three are the unit tests *of* the bindings,
// where constructing a `GciLibrary` is the point; all three mock `koffi`, so
// a call reaches a `vi.fn()` and never a stone -- no session to arm, nothing
// for this rule to protect. `gciLogin.integration.test.ts` does reach a stone:
// its subject is the raw login entry points themselves, including logins that
// fail, which `withTransientSession` can't express -- so it arms each
// successful session by hand instead. Matched by basename, so moving one keeps
// its exemption.
const HARNESS_SESSION_IGNORES = [
  'client/src/__tests__/gci/**',
  '**/gciLogin.integration.test.ts',
  '**/gciLoginQuiet.test.ts',
  '**/missingGciFunctions.test.ts',
  '**/optionalFuncSignature.test.ts',
];

// Extracted so the capability-confinement block below can restate it: the
// second block has to carry its own full copy of every selector here, not
// just the two new ones it adds (see TS_EXTENSION_IMPORT above for why).
const HARNESS_SESSION_SELECTORS = [
  { selector: "NewExpression[callee.name='GciLibrary']", message: OWN_GCI_LIBRARY },
  // `callee.name` reads a bare identifier only, so a namespace import
  // (`new gciLib.GciLibrary(...)`) walks past it. The three selectors
  // here close the aliasing routes at their narrowest point -- the
  // namespaced construction, the renaming import itself, and the
  // assignment to a local -- rather than banning the import outright,
  // which would also hit the many tests that name `GciLibrary` purely as
  // a type annotation and the few that use its statics.
  { selector: "NewExpression[callee.property.name='GciLibrary']", message: OWN_GCI_LIBRARY },
  {
    selector: "ImportSpecifier[imported.name='GciLibrary'][local.name!='GciLibrary']",
    message: OWN_GCI_LIBRARY,
  },
  {
    selector:
      "VariableDeclarator:matches([init.name='GciLibrary'], [init.property.name='GciLibrary'])",
    message: OWN_GCI_LIBRARY,
  },
  {
    // Shaped as a call, not a bare member access: `vi.fn()`-mocked
    // libraries are *named* in assertions all over the unit tests
    // (`expect(gci.GciTsLogin).not.toHaveBeenCalled()`), and flagging
    // those would flag the tests that prove a path does not log in. A
    // call is the thing that acquires a session. Matched by `.name` and
    // `.value` both, as the password selectors below are: in
    // `gci['GciTsLogin'](...)` the property is a `Literal`, which carries
    // `.value` and no `.name`.
    selector: `CallExpression:matches([callee.property.name=${RAW_LOGIN_NAMES}], [callee.property.value=${RAW_LOGIN_NAMES}])`,
    message: RAW_GCI_LOGIN,
  },
  {
    // Keyed on the method and its arity, not the receiver's name: a
    // receiver-name selector only reads `callee.object.name`, which does
    // not exist on a `MemberExpression` receiver, so it would miss
    // `testContext.gciLibrary.login(...)` -- the most natural spelling
    // inside a `useIntegrationTest` callback -- along with every receiver
    // not spelled `gci`/`gciLibrary`. Arity is what actually identifies
    // it: `GciLibrary.login` takes exactly four arguments, while the
    // logins a test may legitimately call take other counts. Both member and bare
    // call forms, so pulling `login` out of the library into a local
    // first does not slip past.
    selector: "CallExpression[callee.property.name='login'][arguments.length=4]",
    message: GCI_LIBRARY_LOGIN,
  },
  {
    selector: "CallExpression[callee.name='login'][arguments.length=4]",
    message: GCI_LIBRARY_LOGIN,
  },
  {
    // The password read off something, for a test that goes to the
    // environment (or a config object) instead of through the helper. A
    // property selector, so the receiver is irrelevant -- but a `.name`
    // one alone matches only a *non-computed* access: in
    // `process.env['VITE_GEMSTONE_PASSWORD']` the property is a
    // `Literal`, which carries `.value` and no `.name`, so both are
    // matched. The other VITE_GEMSTONE_* values stay allowed -- tests
    // read the gem NRS and library path for reasons that have nothing to
    // do with logging in.
    selector: `MemberExpression:matches([property.name=${PASSWORD_NAMES}], [property.value=${PASSWORD_NAMES}])`,
    message: LOGIN_CREDENTIALS,
  },
  {
    // `const { VITE_GEMSTONE_PASSWORD } = process.env` is not a
    // `MemberExpression` at all, and destructuring the environment is
    // ordinary enough in test setup to be the next thing reached for once
    // the selector above stops the direct read. Anchored on
    // `ObjectPattern` so it only reads the binding side: the mock-env
    // object literal in testConnection.test.ts is an `ObjectExpression`
    // and stays legal.
    selector: `ObjectPattern > Property:matches([key.name=${PASSWORD_NAMES}], [key.value=${PASSWORD_NAMES}])`,
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
];

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
    files: ['**/*.ts'],
    rules: {
      // The typescript-eslint drop-in rather than the core rule, to match the
      // other configuration of it below.
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: [TS_EXTENSION_IMPORT] }],
    },
  },
  {
    // The one module that names a `.ts` specifier, because eslint.config.mjs
    // reaches its generated half through Node's type-stripping. Its import
    // comment carries the full reason. Turned off wholesale rather than
    // re-stated minus that pattern: no other configuration of this rule applies
    // to a non-test file, so there is nothing else here to lose.
    files: ['client/src/gciLibrary/optionalFunctions.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
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
    // webview global scope — not part of `globals.browser`. `MillerColumns` is
    // the shared column-strip model (webview/millerColumns.js) and `EvaluatePane`
    // the shared evaluate-pane behaviour (webview/evaluatePane.js); each is
    // injected as its own <script> tag ahead of the scripts that use it, so they
    // are globals to them in exactly the same way.
    languageOptions: {
      globals: {
        ...globals.browser,
        acquireVsCodeApi: 'readonly',
        EvaluatePane: 'readonly',
        MillerColumns: 'readonly',
      },
    },
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
    // Read as syntax rather than as text: the guard this replaced scanned the
    // source with a regex, which cannot tell a call from the same words inside a
    // comment or a string -- so a doc-comment naming `debug.startDebugging` to
    // explain why nothing calls it read as a violation. Tests and mocks are
    // excluded: `client/src/__mocks__/vscode.ts` has to DEFINE `debug.startDebugging`
    // for the mocked API to be shaped like the real one, and a test asserting that
    // nothing reveals the Run and Debug view has to name the command id to look
    // for it.
    //
    // Matched by basename, not by path: most client tests live in a nested
    // `__tests__` (client/src/enhancedInspector/__tests__/ and its siblings), which
    // `client/src/__tests__/**` does not cover -- those files were exempt only
    // because the `**/*.test.ts` block further down configures this same rule
    // (see TS_EXTENSION_IMPORT above for why that drops these selectors). That left the
    // exclusion true by accident and false for a `__tests__/support/` helper, which
    // is not a `*.test.ts` and so was covered by neither.
    files: ['client/src/**/*.ts'],
    ignores: ['**/__tests__/**', '**/__mocks__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Matched on the property, not the receiver: the call is written
          // `vscode.debug.startDebugging(...)` today, but pulling `debug` out of
          // the namespace into a local first must not shake the ban off.
          selector: "CallExpression[callee.property.name='startDebugging']",
          message: DAP_ENTRY_POINT,
        },
        {
          // The destructured form (`const { startDebugging } = vscode.debug`)
          // calls a bare identifier, which the property selector above cannot
          // see. Neither could the regex guard this replaced.
          selector: "CallExpression[callee.name='startDebugging']",
          message: DAP_ENTRY_POINT,
        },
        {
          // Revealing the Run and Debug view is the other way in, and it is a
          // command id rather than a call -- so the string itself is what gets
          // banned, wherever it is passed. `.value` reads the literal in both
          // `executeCommand('workbench.view.debug')` and a `const` holding it.
          selector: "Literal[value='workbench.view.debug']",
          message: DAP_ENTRY_POINT,
        },
        {
          // A template literal is not a `Literal` node, so the selector above
          // walks straight past `` `workbench.view.debug` `` -- which the regex
          // guard this replaced did catch (it accepted backticks explicitly).
          // Matching the text of the quasi keeps that half of the ban.
          selector: "TemplateElement[value.raw='workbench.view.debug']",
          message: DAP_ENTRY_POINT,
        },
      ],
    },
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
      // Default caps expect() at exactly 1 argument, which also blocks Chai's
      // legitimate expect(actual, message) form (vitest's own type defs. keep
      // it: `<T>(actual: T, message?: string) => Assertion<T>`). Raise the
      // ceiling to 2 so a descriptive failure message stays available; a 0-
      // or 3+-arg call is still a real mistake and still flagged.
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
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
    // The GCI optionality gate (see OPTIONAL_GCI_CALL above). Scoped to the
    // three workspaces' production sources; tests and mocks are exempt because
    // an absent-world test's whole job is to call the symbol and watch it
    // throw. `gciLibrary.ts` is exempt because the bindings *are* its subject:
    // it holds every `this._optional.GciTsX(...)` call there is. Once a
    // cross-version helper lives under `client/src/gciLibrary/`, this exemption
    // widens to that directory -- and belongs to the commit that puts one there.
    files: ['client/src/**/*.ts', 'server/src/**/*.ts', 'mcp-server/src/**/*.ts'],
    ignores: [
      '**/__tests__/**',
      '**/__mocks__/**',
      // A test file outside `__tests__/` is exempt too, and has to be listed
      // here to say so: the test-session block below configures
      // `no-restricted-syntax` for these globs, which drops these selectors
      // for such a file regardless (see TS_EXTENSION_IMPORT above for why). Stated
      // explicitly rather than left to fall out of block ordering, which is
      // invisible at the call site. Not `**/*.test.tsx`: the `files` above are
      // all `*.ts`, so it could never match.
      '**/*.test.ts',
      '**/*.spec.ts',
      // Path-anchored rather than a `**/` basename glob: the bindings are this
      // one module's subject, and a future `server/src/gciLibrary.ts` should be
      // gated like any other production source.
      'client/src/gciLibrary.ts',
    ],
    rules: { 'no-restricted-syntax': ['error', ...OPTIONAL_GCI_CALL] },
  },
  {
    // Confines every test to the harness's session (see the message constants
    // above for why). Exemptions are `HARNESS_SESSION_IGNORES` above -- see
    // that const's comment for why each of the five is there.
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.tsx'],
    ignores: HARNESS_SESSION_IGNORES,
    rules: {
      'no-restricted-syntax': ['error', ...HARNESS_SESSION_SELECTORS],
      // The typescript-eslint drop-in, for `allowTypeImports`: naming a type
      // from the fork query forks nothing.
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/queries/forkGem'], message: FORKED_GEM, allowTypeImports: true },
            TS_EXTENSION_IMPORT,
          ],
        },
      ],
    },
  },
  {
    // Confines the GCI capability-skip mechanism (`requireGciCapability`, and
    // the `isAvailable`/`supportsNonBlockingLogin` checks it wraps) to
    // raw-wrapper tests under `client/src/gciLibrary/__tests__/**` -- see the
    // message constants above for why a feature-level test must not use it.
    //
    // This is a separate block layered over the harness-session block above,
    // rather than the two new selectors/pattern added straight into that
    // block's arrays, because flat config *replaces* a rule's options per
    // block (see TS_EXTENSION_IMPORT above for why). Widening that block's own `ignores` to exempt
    // `gciLibrary/__tests__/**` would have exempted it from the *raw-login*
    // selectors too, which must keep firing there. So this block restates
    // (`HARNESS_SESSION_SELECTORS`, plus the same `forkGem`/`.ts`-extension
    // import patterns) everything the block above configures, adds the two
    // new selectors and the new import pattern, and its own `ignores` widens
    // `HARNESS_SESSION_IGNORES` by one entry, only for this concern.
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.tsx'],
    ignores: [...HARNESS_SESSION_IGNORES, 'client/src/gciLibrary/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...HARNESS_SESSION_SELECTORS,
        ...CAPABILITY_CHECK_SELECTORS,
      ],
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/queries/forkGem'], message: FORKED_GEM, allowTypeImports: true },
            {
              group: ['**/gciLibrary/__tests__/requireGciCapability'],
              message: IMPORT_REQUIRE_GCI_CAPABILITY,
            },
            TS_EXTENSION_IMPORT,
          ],
        },
      ],
    },
  },
  {
    // The same confinement for test *helpers*: not being test files, they miss
    // the globs above, and factoring a repeated skip into one is the likeliest
    // route around the rule. Carries only the capability selectors -- these
    // helpers are the harness `HARNESS_SESSION_SELECTORS` points every test at,
    // so those would fire on the legitimate library construction and login in
    // `useIntegrationTest.ts`, `testConnection.ts` and `testActiveSession.ts`.
    // `ignores` subtracts the test files back out, so this block never overlaps
    // the one above (whose options it would otherwise replace, per above).
    files: ['client/src/**/__tests__/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      '**/*.spec.ts',
      'client/src/__tests__/gci/**',
      'client/src/gciLibrary/__tests__/**',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...CAPABILITY_CHECK_SELECTORS],
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/gciLibrary/__tests__/requireGciCapability'],
              message: IMPORT_REQUIRE_GCI_CAPABILITY,
            },
            TS_EXTENSION_IMPORT,
          ],
        },
      ],
    },
  },
  // Disables stylistic ESLint rules that would conflict with Prettier; must stay last.
  eslintConfigPrettier,
);
