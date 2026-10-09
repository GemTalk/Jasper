/**
 * Smalltalk that fills the IdentityDictionary in `mapVar` with each class -> the 1-based position
 * of the first dictionary in the symbol list `slVar` that binds the class UNDER ITS OWN NAME.
 *
 * That position is an address: a Hierarchy-row command or a Move Instance Variable destination
 * sends it back, and the far end looks the class up as `(symbolList at: i) at: name`. So it must be
 * a dictionary where that lookup lands on this class. Taking the first dictionary that holds the
 * class under ANY key breaks that when an earlier dictionary also holds it under an alias and binds
 * its name to a different, same-named class: the position then addresses that other class, and
 * nothing downstream can tell. A class held only under aliases gets no entry (callers read 0).
 */
export function classHomeIndexStatement(mapVar: string, slVar: string): string {
  return `${mapVar} := IdentityDictionary new.
1 to: ${slVar} size do: [:i |
  (${slVar} at: i) keysAndValuesDo: [:k :v |
    ((v isBehavior and: [k == v name asSymbol]) and: [(${mapVar} includesKey: v) not])
      ifTrue: [${mapVar} at: v put: i]]].`;
}
