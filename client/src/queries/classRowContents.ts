import { NbQueryExecutor } from './types';
import { classLookupExpr } from './util';

/** What an Explorer class row shows when expanded. */
export interface ClassRowContents {
  /** Instance variables the class itself declares, in declared order. */
  instVarNames: string[];
  /** Class variables the class itself declares. */
  classVarNames: string[];
  /**
   * Whether the class's own instance variables can be pushed down: it declares some,
   * and some class in the symbol list has it as its direct superclass. Not a general
   * "has subclasses" answer: a class with no instance variables skips the scan, which
   * spares a walk of every dictionary.
   */
  ivarsCanMoveDown: boolean;
}

/**
 * Everything an expanded class row in the Explorer needs, in one evaluation,
 * so expanding it costs one round trip rather than one per part.
 *
 * The class is resolved through `dict` (a 1-based SymbolList index, or a name)
 * via classLookupExpr, as the per-part queries do. A class the dictionary does
 * not bind answers empty lists and no subclasses.
 *
 * Subclasses are found by scanning the symbol list for a class whose superclass
 * is this one, by identity, rather than through the cached ClassOrganizer the
 * Hierarchy pane uses: measured as fast or faster on 3.6.2 and 3.7.5, with no
 * cache to build or keep fresh. A subclass no dictionary binds is not counted.
 */
export async function classRowContents(
  execute: NbQueryExecutor,
  className: string,
  dict?: number | string,
): Promise<ClassRowContents> {
  const code = `| cls ws hasSubs |
cls := ${classLookupExpr(className, dict)}.
ws := WriteStream on: String new.
cls isNil ifFalse: [
  cls instVarNames do: [:each | ws nextPutAll: each asString; tab].
  ws lf.
  cls classVarNames do: [:each | ws nextPutAll: each asString; tab].
  ws lf.
  hasSubs := cls instVarNames notEmpty and: [
    (System myUserProfile symbolList
      detect: [:d |
        (d detect: [:each | each isBehavior and: [each superclass == cls]] ifNone: [nil]) notNil]
      ifNone: [nil]) notNil].
  ws nextPutAll: hasSubs printString].
ws contents`;
  const [instVars = '', classVars = '', subclasses = ''] = (await execute(code)).split('\n');
  return {
    instVarNames: names(instVars),
    classVarNames: names(classVars),
    ivarsCanMoveDown: subclasses.trim() === 'true',
  };
}

function names(line: string): string[] {
  return line.split('\t').filter((name) => name.length > 0);
}
