import { QueryExecutor } from '../../queries/types';
import { escapeString } from '../../queries/util';

// True when `name` resolves to a KERNEL/system class — one bound in the base
// `Globals` system dictionary. GemStone's kernel classes live in `Globals`, while
// user code lives in `UserGlobals` (or user-created dictionaries), so Globals
// membership is the discriminator. (`isModifiable` is NOT used: it is false even
// for ordinary user classes, so it can't distinguish kernel from user code.)
// Renaming a kernel class is hazardous — pervasive references, and some kernel
// histories are deliberately size 1 — so the Explorer warns before proceeding.
export function isKernelClass(execute: QueryExecutor, name: string): boolean {
  const esc = escapeString(name);
  const code = `| c |
c := System myUserProfile symbolList objectNamed: #'${esc}'.
(c notNil and: [c isBehavior and: [(Globals at: #'${esc}' ifAbsent: [nil]) == c]]) printString`;
  return execute(code).trim() === 'true';
}
