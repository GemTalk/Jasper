---
paths:
  - 'gs-src/refactoring/**'
  - 'client/src/refactoring/**'
  - 'client/src/__tests__/gci/**'
---

# Refactoring (RB) tests: cover APPLY, not just PREVIEW

Every RB refactoring has two server round-trips — build the change-set **preview**, then **apply** the
selected changes. Preview-only coverage is the standing gap here; a refactoring is not done until it
has an apply-path test.

- **[GS SUnit]** in `gs-src/refactoring/tests/` — apply the change set, then assert the resulting
  state of the stone, not the change set that was staged.
- **[GCI integration]** in `client/src/refactoring/__tests__/*.integration.test.ts` — drive apply
  through the client path end to end, gated with `requireServerPluginFeature`. This is the default
  home: it runs in CI over the whole release matrix. A scenario that must COMMIT is a candidate for a
  `*.committing.integration.test.ts` file using `allowedCommits` — but check it against
  [the harness reference](../../docs/reference/integration-test-harness.md)'s exclusions first; a scenario that doesn't fit still
  belongs in the on-demand `client/src/__tests__/gci/` project rather than being forced into `allowedCommits`.
- Both boundaries: 3.6.2 **and** 3.7.5.

## What an apply test must assert

"The right changes were staged" (preview) and "the stone ended up right" (apply) are different
questions. At minimum:

1. **Nothing was silently lost.** Compare the full selector set before and after, **both sides**
   (`cls selectors` and `cls class selectors`). Reshaping a class creates a new class version whose
   method dictionary starts EMPTY — methods survive only because something copies them forward.
   Assert survivors by name, **including methods the refactoring has no reason to touch**; those are
   the ones no change set mentions, so nothing else will catch their loss.
2. **Categories survived** — a copied-forward method lands in `as yet unclassified` if the category
   wasn't carried.
3. **Deselection removes only what was deselected**, and everything else is intact.
4. **What could not be recompiled is reported**, not dropped in silence (`dropped` /
   `willNotRecompile`).
5. **Subclasses too** — reshaping a superclass re-versions every subclass, so each needs the same
   survival assertions.

Anything that reshapes a class and does not copy methods forward is a data-loss bug, however correct
its preview looks.

## Patterns to copy

- `GsRenameClassRefactoring>>copyMethodsFrom:to:` — the copy-forward that makes survival possible.
- `GsInstVarRefactoringTest>>testApplyRemoveDropsBrokenMethodsAndReportsThem` — asserts the broken
  method is gone AND an unrelated one survives.
- `client/src/refactoring/__tests__/refactoringInstVar.integration.test.ts` — the client-side apply
  shape: reports the methods that will not recompile, drops exactly those, and asserts an unrelated
  method survived the new class version.
