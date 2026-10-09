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
 * Five things do. Jasper's own class definition and deletion clear it in the same
 * doit that changes the class (`clearClassOrganizerStatement`); a commit or abort
 * clears it, which is how a class another session added arrives; a class-level
 * refactoring's apply or undo clears it (`droppingClassOrganizer`), since both make
 * new class versions without committing;
 * and GemStone Search's ⟳ (either one -- the panel's title bar or its own) clears
 * it, which is the one gesture that covers the case none of those can — a class
 * created by *executing* `subclass:` in a workspace, which announces nothing and
 * needs no commit to be visible to the session that ran it. Commit, abort, undo and
 * ⟳ go through `clearClassOrganizerCode` (`dropCachedClassOrganizer` in
 * classOrganizerCache.ts).
 *
 * That last case is left to the button on purpose. Clearing on every workspace
 * execution would be correct and would also throw the cache away all day for the
 * many doits that create no class at all — which is the cost this file exists to
 * remove. The ⟳ is what the rebuild button was built for, and its tooltip says
 * so; if searches turn out to read stale often enough to complain about, that is
 * the trade to revisit.
 *
 * The hierarchy queries (`getClassHierarchy`, `getSiblingClassNames`,
 * `getClassDescendantNames`) share the cache too, and read it through
 * `subclassesOfBlock` / `superclassesOfBlock` rather than asking it directly (see
 * there for why). Those also rebuild it themselves when asked about a class bound
 * in a dictionary that the cache does not hold -- the workspace case above, for
 * the hierarchy at least.
 *
 * Keyed by environment: an organizer collects its classes under one environment id,
 * so environments cannot share one. `newForEnvironment:` sets that at collection
 * time, which is what the callers setting `environmentId:` after `new` were
 * reaching for — that only relabels an organizer whose classes were already
 * gathered under environment 0.
 */
export function classOrganizerExpr(environmentId: number | string = 0): string {
  return `(SessionTemps current at: ${cacheKey(environmentId)} ifAbsent: [
  ${cacheOrganizerExpr(environmentId)}])`;
}

const cacheKey = (environmentId: number | string): string =>
  `#'JasperClassOrganizer_${environmentId}'`;

/** Build a fresh organizer and cache it, answering it. */
const cacheOrganizerExpr = (environmentId: number | string): string =>
  `SessionTemps current at: ${cacheKey(environmentId)} put: (ClassOrganizer newForEnvironment: ${environmentId})`;

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

/**
 * `code` with the cached organizer dropped first, for an apply that gives a class a new version,
 * binds or unbinds one, or re-parents one: the cache holds class objects and their superclass
 * links, so after such an apply it describes classes that are no longer current, and the next
 * hierarchy query would show the reshaped class's parent listing the old version. Dropped at the
 * START of the doit -- the engines build their own organizer and never read this one -- so an
 * apply that fails part-way, after re-versioning some classes, still leaves no stale cache. Goes
 * after a leading temporaries declaration, which must stay first.
 *
 * Method-level applies do not use it: they change nothing the cache holds, and rebuilding it is
 * not free. Which applies do is pinned in refactoring/__tests__/classCacheAfterApply.test.ts.
 */
export function droppingClassOrganizer(code: string): string {
  const temps = /^\s*\|[^|]*\|/.exec(code);
  const at = temps ? temps[0].length : 0;
  return `${code.slice(0, at)}\n${clearClassOrganizerStatement()}\n${code.slice(at)}`;
}

/** The same, as a whole doit for callers with nothing else to run — a commit, an
 *  abort, and GemStone Search's explicit refresh, none of which have a class
 *  change of their own to append it to. */
export function clearClassOrganizerCode(): string {
  return `${clearClassOrganizerStatement()}
true`;
}

/**
 * The guard both blocks below share: whether `cls` can be read from `organizer`, rebuilding the
 * cached organizer first when it is stale.
 *
 * GemStone's `subclassesOf:` and `allSuperclassesOf:` answer from tables that hold only classes
 * the organizer collected, and only classes WITH subclasses get a subclass entry. For anything
 * else they call `addClass:` -- `subclassesOf:` does it even for a class the organizer already
 * holds -- and `addClass:` drops every class of the same name, as if it were an older version of
 * the one being added. Two different classes of one name (each in its own dictionary) are not
 * versions, so asking about one deleted the other from the cached organizer; and asking about an
 * older version deletes the current one, subclasses and all. 3.6.2 and 3.7.5 behave alike, and
 * the kernel treats it as known behaviour (its own callers order their sends around it).
 *
 * So `addClass:` is never sent. A class the organizer does not hold is one of two things:
 * - bound in a dictionary under its own name -- defined, or given a new version, after the
 *   organizer was built. The organizer is stale, so it is rebuilt (and re-cached) and read fresh.
 * - bound nowhere -- an older version, or a removed class. It is answered from the class itself
 *   (its superclass chain, or a scan of the organizer's classes for its subclasses), leaving the
 *   organizer as it is.
 */
function readableExpr(organizer: string): string {
  return `((${organizer} classes includesIdentical: cls) or: [
    ((System myUserProfile symbolList
        detect: [:d | (d at: cls name ifAbsent: [nil]) == cls] ifNone: [nil]) notNil)
      and: [${organizer} := ${cacheOrganizerExpr(0)}.
        ${organizer} classes includesIdentical: cls]])`;
}

/**
 * A block answering the direct subclasses of a class, for `organizer` (a variable holding a
 * ClassOrganizer, reassigned when the cache is rebuilt) -- what `subclassesOf:` answers, without
 * ever dropping a class from the cache (see `readableExpr`).
 */
export function subclassesOfBlock(organizer: string): string {
  return `[:cls | ${readableExpr(organizer)}
  ifTrue: [(${organizer} hierarchy at: cls otherwise: nil) ifNil: [ClassSet new] ifNotNil: [:s | s copy]]
  ifFalse: [${organizer} classes select: [:c | c superclass == cls]]]`;
}

/**
 * A block answering a class's superclasses root-first -- what `allSuperclassesOf:` answers,
 * without ever dropping a class from the cache (see `readableExpr`).
 */
export function superclassesOfBlock(organizer: string): string {
  return `[:cls | ${readableExpr(organizer)}
  ifTrue: [${organizer} allSuperclassesOf: cls]
  ifFalse: [| chain c | chain := OrderedCollection new. c := cls superclass.
    [c notNil] whileTrue: [chain addFirst: c. c := c superclass].
    chain asArray]]`;
}
