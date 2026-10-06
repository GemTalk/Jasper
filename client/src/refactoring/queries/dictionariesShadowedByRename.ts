import { QueryExecutor } from '../../queries/types';
import {
  classLookupExpr,
  escapeString,
  splitLines,
  symbolListIndexOfClassExpr,
} from '../../queries/util';

/**
 * The dictionaries that already hold a class called `newName`, EXCLUDING the one the class being
 * renamed lives in — in symbol-list order, each as `<position>\t<name>`.
 *
 * This is what the shadowing warning is asking: renaming onto a name some other dictionary
 * already binds leaves two classes of that name, and which one an unqualified reference then
 * means depends on symbol-list order.
 *
 * It excludes the class's own dictionary IN THE STONE, by identity. Doing it on the client meant
 * dropping every dictionary whose NAME matched the destination's, so a second dictionary of that
 * same name — holding a real, clashing class — was filtered out along with the destination and
 * the rename went ahead with no warning at all (#396). A name cannot pick between two
 * dictionaries that share one, which is the whole reason this branch exists; the symbol list can,
 * because the dictionaries are different objects.
 *
 * The POSITION comes back too, so the caller can say which of them the symbol list reaches first
 * without looking any names up again — and so two holders that share a name are still two rows.
 * A dictionary with no name is reported as `(unnamed)`: it is a real holder and saying nothing
 * about it would be the same silence this fixes.
 */
export interface ShadowingHolder {
  /** 1-based SymbolList position. */
  position: number;
  /** The dictionary's name, or `(unnamed)` when it has none. */
  name: string;
}

export async function dictionariesShadowedByRename(
  execute: QueryExecutor,
  newName: string,
  oldName: string,
  dict?: number | string,
): Promise<ShadowingHolder[]> {
  const code = `| cls home ws sl |
cls := ${classLookupExpr(oldName, dict)}.
home := cls isNil ifTrue: [0] ifFalse: [${symbolListIndexOfClassExpr('cls')}].
sl := System myUserProfile symbolList.
ws := WriteStream on: String new.
1 to: sl size do: [:i | | d found |
  d := sl at: i.
  found := d at: #'${escapeString(newName)}' ifAbsent: [nil].
  (found notNil and: [found isBehavior and: [i ~= home]])
    ifTrue: [
      ws nextPutAll: i printString; tab;
        nextPutAll: (d name ifNil: ['(unnamed)'] ifNotNil: [:n | n asString]); lf]].
ws contents`;
  const holders: ShadowingHolder[] = [];
  for (const line of splitLines(await execute(code))) {
    const parts = line.trim().split('\t');
    if (parts.length < 2) continue;
    const position = parseInt(parts[0], 10);
    if (!(position > 0)) continue;
    holders.push({ position, name: parts[1] });
  }
  return holders;
}
