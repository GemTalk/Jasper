/**
 * Reading the symbol list, and putting a removed dictionary back on it (issue #434).
 *
 * Plain Smalltalk against the kernel, like every other doit in this layer:
 * `symbolList`, `insertDictionary:at:`, and a `SessionTemps` stash.
 *
 * The stash is what makes a removal reversible at all. `symbolList remove:` takes the
 * dictionary off the list but does not destroy it, so the very same object — with every
 * class it holds, under the same keys — goes back; SessionTemps is what keeps it reachable
 * in the meantime, exactly as it does for a removed class.
 *
 * POSITION is captured, not just presence. `insertDictionary:at:` puts it back where it was,
 * because a symbol list is ordered and name resolution walks it in order: appending a
 * dictionary that used to sit first would silently change which class a bare name resolves
 * to. Two things the stone taught us and both are guarded here — an index past the end of the
 * list raises rather than clamping, and inserting a dictionary that is ALREADY on the list is
 * allowed, leaving it there twice.
 */
import { QueryExecutor } from '../../queries/types';
import { escapeString } from '../../queries/util';
import { DictionaryState } from '../undoTypes';

/**
 * Where the dictionary called `name` sits on the session's symbol list right now.
 *
 * `stashKey`, when given, holds the dictionary itself in SessionTemps — pass one when
 * capturing BEFORE a removal, and nothing when reading the live state at undo time, which
 * must not pin anything further.
 *
 * Compared as SYMBOLS. `aDictionary name asString = 'Foo'` raises "Unicode argument
 * disallowed in String comparison" on a stone in legacy string mode.
 */
export function captureDictionary(
  execute: QueryExecutor,
  name: string,
  stashKey?: string,
): DictionaryState {
  const sym = escapeString(name);
  const stash = stashKey ? `SessionTemps current at: #'${escapeString(stashKey)}' put: d.` : '';
  const code = `| sl d |
sl := System myUserProfile symbolList.
d := sl detect: [:each | each name == #'${sym}'] ifNone: [nil].
d isNil ifTrue: [^ '0'].
${stash}
'1', (Character tab asString), (sl indexOf: d) printString`;
  return parseDictionaryCapture(execute(code), name);
}

/** Decode one capture. Exported for tests. */
export function parseDictionaryCapture(raw: string, name: string): DictionaryState {
  const line = raw.trim();
  if (line.length === 0 || line[0] === '0') return { present: false, name, index: 0 };
  const index = Number(line.split('\t')[1] ?? '0');
  return { present: true, name, index: Number.isFinite(index) ? index : 0 };
}

/**
 * Put the stashed dictionary back at `index`. Answers null on success and the reason
 * otherwise — never throws past the caller, so a refused reversal is reported.
 *
 * Refuses rather than duplicating when the dictionary is already on the list, and clamps the
 * position into range: the list is shorter now than it was, and `insertDictionary:at:` raises
 * on an index past the end rather than appending.
 */
export function reinsertDictionary(
  execute: QueryExecutor,
  stashKey: string,
  index: number,
): string | null {
  const code = `| sl d pos |
sl := System myUserProfile symbolList.
d := SessionTemps current at: #'${escapeString(stashKey)}' ifAbsent: [nil].
d isNil ifTrue: [^ 'this session no longer holds the removed dictionary'].
(sl anySatisfy: [:each | each == d])
  ifTrue: [^ 'that dictionary is already on the symbol list'].
(sl anySatisfy: [:each | each name == d name])
  ifTrue: [^ 'the name ', d name asString, ' is already in use on the symbol list'].
pos := ${Math.max(1, Math.trunc(index) || 1)} min: sl size + 1.
[System myUserProfile insertDictionary: d at: pos. 'ok']
  on: Error
  do: [:ex | ex messageText ifNil: ['failed']]`;
  const answer = execute(code).trim();
  return answer === 'ok' ? null : answer;
}
