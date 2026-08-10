import { QueryExecutor } from './types';
import { escapeString, dictLookupExpr } from './util';

// Rename a SymbolDictionary on the user's symbol list. Not committed automatically.
//
// A SymbolDictionary has no `name` slot: its name is a self-referential entry
// (`#Name -> theDict`) held inside the dictionary itself, and every symbol list
// holds the dictionary BY IDENTITY. So renaming is a two-step swap of that
// self-entry -- add the new one, drop the old -- after which the dictionary
// resolves under the new name for every session automatically (once committed).
//
// This does NOT rewrite source that names the dictionary literally (e.g.
// `objectNamed: #OldName`, or the dictionary referenced as a bareword global):
// such references are rare (code references the CLASSES in a dictionary, not the
// namespace object) but are the one thing a reflective rename cannot fix, so the
// caller warns the user. The rename is guarded against the system dictionaries and
// name collisions.
//
// `dict` accepts a 1-based symbol-list index or the current dictionary name.
export function renameDictionary(
  execute: QueryExecutor,
  dict: number | string,
  newName: string,
): string {
  const dictExpr = dictLookupExpr(dict);
  const code = `| sl d newSym oldKey |
sl := System myUserProfile symbolList.
d := ${dictExpr}.
d ifNil: [^ 'Dictionary not found'].
((d == Globals) or: [(d == Published) or: [d == UserGlobals]])
  ifTrue: [^ 'Cannot rename a system dictionary (Globals, Published, or UserGlobals)'].
newSym := #'${escapeString(newName)}'.
d name == newSym ifTrue: [^ 'ok'].
(sl objectNamed: newSym) ifNotNil: [:o | ^ 'The name ${escapeString(newName)} is already in use in the symbol list'].
oldKey := d keyAtValue: d ifAbsent: [nil].
d name: newSym.
(oldKey notNil and: [oldKey ~~ newSym]) ifTrue: [d removeKey: oldKey ifAbsent: []].
'ok'`;
  return execute(code);
}
