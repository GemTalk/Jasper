/**
 * The 1-based SymbolList position of the dictionary `dictName`, given the symbol list's names in
 * order and, when the caller has one, the position the dictionary was recorded at. Answers 0 when
 * no dictionary of that name is on the list.
 *
 * A dictionary NAME does not identify a dictionary — two can share one — so the recorded position
 * is kept whenever the dictionary there still carries the recorded name. Only when it does not (a
 * commit elsewhere inserted, removed or reordered dictionaries) is the name looked up, and then the
 * first dictionary of that name is the best answer there is. Looking the name up unconditionally
 * lands on the first of two same-named dictionaries even when the caller knew it meant the second
 * (#396).
 */
export function resolveDictionaryIndex(
  names: readonly string[],
  dictName: string,
  recordedIndex?: number,
): number {
  if (
    recordedIndex !== undefined &&
    recordedIndex >= 1 &&
    recordedIndex <= names.length &&
    names[recordedIndex - 1] === dictName
  ) {
    return recordedIndex;
  }
  return names.indexOf(dictName) + 1;
}
