import { QueryExecutor } from './types';
import { dictLookupExpr, escapeString } from './util';

/**
 * The Topaz chunk that makes sure a dictionary exists before anything is filed into it.
 *
 * **GemStone's own `ClassOrganizer>>fileOutClassesAndMethodsInDictionary:on:` does not
 * write one**, and that gap cannot be left to the reader. Every class definition it
 * writes ends `inDictionary: <Name>` — a bare global reference — so filing the result
 * into a stone that does not already have that dictionary fails on the very first
 * chunk with an undefined symbol, and takes the whole file with it.
 *
 * Only the absent case does anything: an existing dictionary is left exactly where and
 * as it is. A dictionary this has to create goes in at position 1, matching the
 * many-files export the System Browser writes (see `planDictionaryFileOut`) — code
 * being loaded should win a name contest against what is already in the image, which
 * is what loading it means.
 *
 * `SymbolDictionary new name: #Foo` binds the dictionary in itself under its own name;
 * that self-binding is what later lets `inDictionary: Foo` resolve, so creating it and
 * putting it in the symbol list is genuinely all this has to do.
 *
 * Built here rather than in the doit that fetches the file-out: composing it
 * server-side means a `$'` character literal and runs of doubled quotes inside the
 * doit, and 3.6.x's compiler fails on those with an internal `ComStrmSetCursor` error
 * (CompileError 1001) rather than compiling them.
 */
export function dictionaryPreamble(dictName: string): string {
  const name = escapeString(dictName);
  return [
    `! ------------------- Dictionary ${dictName}`,
    '! Created here if this stone does not have it: every class definition below names',
    '! it, so without it the file cannot be read at all. An existing one is left alone.',
    'run',
    '| dict |',
    `dict := System myUserProfile symbolList objectNamed: #'${name}'.`,
    'dict isNil ifTrue: [',
    `  dict := SymbolDictionary new name: #'${name}'; yourself.`,
    '  System myUserProfile insertDictionary: dict at: 1.',
    '].',
    'dict',
    '%',
  ].join('\n');
}

/**
 * Topaz file-out source for a whole SymbolDictionary: the preamble above, then every
 * class the dictionary binds, with definitions, comments and methods.
 *
 * No forward-reference stubs, which the many-files export does need: the organizer
 * writes EVERY class definition before ANY method, so a method referring to a sibling
 * class — even circularly — compiles against a class that already exists. Classes come
 * superclass-first as well, so the file reads back in as-is.
 *
 * Non-class bindings in the dictionary are not exported: a file-out reproduces code,
 * and there is no Topaz form for an arbitrary object's value.
 *
 * The query answers the dictionary's name on its first line and the organizer's output
 * after it, because a caller may have addressed the dictionary by index and so not
 * know the name the preamble has to say.
 *
 * Accepts a dictionary by 1-based SymbolList index (canonical for Jasper's IDE) or by
 * name. Raises when there is no such dictionary — the tree has gone stale, and a
 * silent empty file would look like a dictionary that legitimately holds no classes —
 * and when it has no name, which there is no way to write an `inDictionary:` for.
 */
export function fileOutDictionary(execute: QueryExecutor, dict: number | string): string {
  const code = `| ws d |
d := ${dictLookupExpr(dict)}.
d ifNil: [^ Error signal: 'Dictionary not found'].
d name ifNil: [^ Error signal: 'Dictionary has no name'].
ws := WriteStream on: String new.
ws nextPutAll: d name asString; lf.
ClassOrganizer new fileOutClassesAndMethodsInDictionary: d on: ws.
ws contents`;
  const answer = execute(code);
  const split = answer.indexOf('\n');
  const name = split < 0 ? answer : answer.slice(0, split);
  const body = split < 0 ? '' : answer.slice(split + 1);
  return `${dictionaryPreamble(name)}\n\n${body}`;
}
