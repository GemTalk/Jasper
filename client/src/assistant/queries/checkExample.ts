import { QueryExecutor } from '../../queries/types';
import { escapeString } from '../../queries/util';

/** A workspace example's expressions: the blocks between blank lines, each run on its own. */
export function exampleExpressions(code: string): string[] {
  return code
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

/**
 * Check a workspace example on the stone without running it, answering what is wrong with it:
 * an expression that does not compile, or a message no class implements. Empty when it looks
 * right. Running it would prove more, but undoing a run takes an abort, which would also throw
 * away the user's own uncommitted work.
 */
export function checkExample(execute: QueryExecutor, code: string): string[] {
  const expressions = exampleExpressions(code);
  if (expressions.length === 0) return ['The example has no expressions.'];
  const literals = expressions.map((e) => `'${escapeString(e)}'`).join(' . ');
  // A fresh organizer, not the session's cached one (classOrganizerExpr): that one predates
  // the class just created, so it would report the class's own selectors as implemented nowhere.
  const raw = execute(`| ws org symbols |
ws := WriteStream on: Unicode7 new.
symbols := GsCurrentSession currentSession symbolList.
{ ${literals} } doWithIndex: [:src :i |
  [ | m |
    m := src _compileInContext: nil symbolList: symbols.
    m _selectorPool do: [:sel |
      org ifNil: [org := ClassOrganizer new].
      (org implementorsOf: sel) isEmpty ifTrue: [
        ws nextPutAll: 'U'; tab; print: i; tab; nextPutAll: sel; lf]]]
    on: CompileError do: [:e |
      e errorDetails do: [:d |
        ws nextPutAll: 'E'; tab; print: i; tab; nextPutAll: (d at: 3) asString.
        (d size >= 5 and: [(d at: 5) notNil]) ifTrue: [ws space; nextPutAll: (d at: 5) asString].
        ws lf]]].
ws contents`);
  return parseExampleCheck(raw, expressions);
}

export function parseExampleCheck(raw: string, expressions: string[]): string[] {
  const problems: string[] = [];
  for (const line of raw.split('\n')) {
    const [kind, index, text] = line.split('\t');
    const expression = expressions[Number(index) - 1];
    if (expression === undefined) continue;
    if (kind === 'E') {
      problems.push(`Does not compile (${text}): ${expression}`);
    } else if (kind === 'U') {
      problems.push(`No class implements #${text}: ${expression}`);
    }
  }
  return problems;
}
