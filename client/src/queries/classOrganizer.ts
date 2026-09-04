/**
 * The Smalltalk for reaching a `ClassOrganizer` — built once per gem session and
 * reused, rather than constructed per query.
 *
 * `ClassOrganizer new` walks the whole symbol list and builds the class list,
 * hierarchy and category index for the entire image, so its cost scales with the
 * image rather than with the question being asked. Every search, senders,
 * implementors and references query built its own; the Source scope built one per
 * search, and `literalSymbolReferences` builds two in a single doit. On a large
 * image that fills the gem's temporary object memory, which surfaces as
 * `AlmostOutOfMemoryError` (6022) and "VM temporary object memory is full … too
 * many markSweeps since last successful scavenge" — and once the gem dies,
 * everything else in the session reports a broken connection instead of its own
 * result, which is why an exhausted Search shows up as a failed SUnit discovery.
 *
 * Measured on a live stone of 593 classes, 25 substring searches:
 * a fresh organizer each time grew temporary object space by 1,395,736 bytes;
 * one reused organizer ended 986,048 bytes *below* where it started, the searches
 * themselves allocating little enough that ordinary scavenging stayed ahead. The
 * saving is per-class, so it grows with the image the error appears on.
 *
 * Reuse is safe across method edits: `substringSearch:ignoreCase:` answers
 * `self _substringSearch: aString in: classes ignoreCase:`, walking the class list
 * it captured but reading each class's methods as they are now. What it cannot see
 * is a class *added or removed* after it was built, since that list is a snapshot —
 * so anything that changes the set of classes has to drop it.
 *
 * Four things do. Jasper's own class definition and deletion clear it in the same
 * doit that changes the class (`clearClassOrganizerStatement`); a commit or abort
 * clears it, which is how a class another session added arrives; and GemStone
 * Search's ⟳ clears it, which is the one gesture that covers the case neither of
 * those can — a class created by *executing* `subclass:` in a workspace, which
 * announces nothing and needs no commit to be visible to the session that ran it.
 * The last two go through `clearClassOrganizerCode`.
 *
 * That last case is left to the button on purpose. Clearing on every workspace
 * execution would be correct and would also throw the cache away all day for the
 * many doits that create no class at all — which is the cost this file exists to
 * remove. The ⟳ is what the rebuild button was built for, and its tooltip says
 * so; if searches turn out to read stale often enough to complain about, that is
 * the trade to revisit.
 *
 * The hierarchy queries (`getClassHierarchy`, `getSiblingClassNames`,
 * `getClassDescendantNames`) share the cache too. They ask `subclassesOf:` and
 * `allSuperclassesOf:`, which read the snapshot, and every refactoring that
 * creates the class they would then ask about compiles it through
 * `compileClassDefinition` — which clears the cache in the doit that creates it.
 *
 * Keyed by environment: an organizer collects its classes under one environment id,
 * so environments cannot share one. `newForEnvironment:` sets that at collection
 * time, which is what the callers setting `environmentId:` after `new` were
 * reaching for — that only relabels an organizer whose classes were already
 * gathered under environment 0.
 */
export function classOrganizerExpr(environmentId: number | string = 0): string {
  const key = `#'JasperClassOrganizer_${environmentId}'`;
  return `(SessionTemps current at: ${key} ifAbsent: [
  SessionTemps current at: ${key} put: (ClassOrganizer newForEnvironment: ${environmentId})])`;
}

/**
 * Smalltalk that drops every cached organizer, so the next query builds a fresh
 * one. Run after anything that adds or removes a class: the cached organizer's
 * class list is a snapshot, and a stale one answers questions about an image that
 * no longer exists. Method edits do not need this — see `classOrganizerExpr`.
 */
export function clearClassOrganizerStatement(): string {
  // `beginsWith:`, not `match:`. Session temps are keyed by Symbol — `keys` answers
  // a SymbolSet — and `'prefix*' match:` answers false for a Symbol, with or
  // without `asString`, so a pattern match here silently cleared nothing and left
  // a stale organizer behind. `isString` guards the send: session temps are a
  // shared namespace and nothing promises every key in it is a String.
  return `SessionTemps current keys asArray do: [:k |
  (k isString and: [k asString beginsWith: 'JasperClassOrganizer_'])
    ifTrue: [SessionTemps current removeKey: k ifAbsent: [nil]]].`;
}

/** The same, as a whole doit for callers with nothing else to run — a commit, an
 *  abort, and GemStone Search's explicit refresh, none of which have a class
 *  change of their own to append it to. */
export function clearClassOrganizerCode(): string {
  return `${clearClassOrganizerStatement()}
true`;
}
