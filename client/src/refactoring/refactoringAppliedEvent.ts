/**
 * The internal command the refactoring family fires once an apply has landed.
 *
 * It exists so the post-apply notice — `refactoringAppliedToast`, the single place every
 * refactoring ends — can tell the GemStone Explorer that something was recompiled, without
 * importing it. The Explorer's handle is created at activation and held by `extension.ts`;
 * a command is the seam the rest of this code already uses across that boundary (the same
 * file reaches the undo command that way).
 *
 * Deliberately NOT declared in `package.json`: an undeclared command is registered and
 * callable but never offered in the palette, which is what internal plumbing should be.
 */
export const REFACTORING_APPLIED_COMMAND = 'gemstone.internal.refactoringApplied';
