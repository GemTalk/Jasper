---
paths:
  - "gs-src/refactoring/**"
  - "client/src/refactoring/**"
---

# Refactoring (RB) pre-merge checklist

Codifies what the RB refactoring family has verified ad hoc on every PR. Run through
this before merging any change under `client/src/refactoring/**`,
`gs-src/refactoring/**`, or the Explorer/System-Browser wiring that drives them.
Companion to `.claude/rules/refactoring-tests.md` (which covers the apply-path test
requirement in depth).

## Engine (`gs-src/refactoring/**`)

- [ ] **SUnit green on BOTH boundaries** — 3.6.2 **and** 3.7.5. Rebuild the payloads
      (`gs-src/refactoring/build/build-refactoring.sh`) and run the affected
      `Gs*RefactoringTest` (transient file-in + `System abortTransaction`, no commit).
      A change that only shows on one release is not done.
- [ ] **Payloads regenerated and committed** — `resources/refactoring/*.gs` are
      GENERATED; rebuild and commit them with the source. The diff should be minimal
      (only the classes/methods you touched); unexpected churn means a stale build.
- [ ] **No Pharo-isms on 3.6.2** — a selector that resolves on 3.7.5 but not 3.6.2
      DNUs only on the path that reaches it. Comparisons on category/ivar/classvar
      names use `asSymbol ==`, never `String =` (raises 2718 on a wide string); no
      `#instanceClass` (use `#thisClass`), no `String>>includesSubstring:` in engine
      code (use the per-test-class `assert:includesSubstring:` helper), no
      `String>>startsWith:`. Untested class-side/error paths are where these hide.
- [ ] **Nothing silently lost on reshape** — a refactoring that re-versions a class
      copies every method forward (survival asserted by name, both sides, including
      methods it has no reason to touch); categories carried; what could not be
      recompiled is REPORTED (`dropped`/`willNotRecompile`/`failed`), not dropped.
- [ ] **No commit** — building a change set compiles/commits nothing; apply compiles
      but never commits (the user commits explicitly).

## Client (`client/src/refactoring/**`)

- [ ] **Everything disposed** — every `registerCommand` / listener / webview panel is
      added to `context.subscriptions` (or disposed on its own completion path).
- [ ] **Webview hardening** — each panel sets a strict CSP + per-open `nonce` +
      `localResourceRoots: []`, and validates the SHAPE of every inbound message
      (runtime guard, not a bare `as` cast — see `isRenameClassScope`).
- [ ] **Escaping at both boundaries** — user strings interpolated into generated
      Smalltalk go through `escapeString`; strings put into webview HTML go through
      `escapeHtml`. Never interpolate a raw name into either.
- [ ] **Engine-availability gate** — an engine-backed command calls `ensureRbSupport`
      (offers install when absent) before it previews; menu `when` clauses include
      `gemstone.rbSupportAvailable` where the action needs the engine.
- [ ] **Apply is one-shot** — the apply round-trip is latched (a re-entry guard while
      in flight, or `settled` + immediate dispose) so a double click cannot fire two
      applies.
- [ ] **Reselect after apply** — the affected row/method is re-revealed; cancel/decline
      paths re-focus the original so focus is never left dangling.
- [ ] **Full unit gate** — `npm run lint && npm run format:check && npm run compile`
      clean, and `npm test` (client) green, including the co-located
      `*.integration.test.ts` exercised against an engine-loaded stone (see
      `.claude/rules/refactoring-tests.md`).

## Both

- [ ] **Tests cover APPLY, not just preview** — see `.claude/rules/refactoring-tests.md`.
- [ ] **New engine-gated integration tests skip WITH A REASON** (`ctx.skip(...)`) when
      the engine is absent, never a bare `return` (which reports as passed).
