import { QueryExecutor } from './types';
import { escapeString } from './util';

// Per-method instance-variable access for a class: which instance variables each
// method reads and which it writes, straight from the compiler
// (`GsNMethod>>instVarsRead` / `instVarsWritten`). Both sides are reported; a
// class-side method's sets are its class-instance variables. Methods that touch
// no instance variable are omitted (they can't match a reads:/writes: filter).
// Drives the Methods-pane reads:/writes:/accesses: filter tokens.
export interface MethodInstVarAccess {
  isMeta: boolean;
  selector: string;
  reads: string[];
  writes: string[];
}

export function getMethodInstVarAccess(
  execute: QueryExecutor,
  dictIndex: number,
  className: string,
): MethodInstVarAccess[] {
  // One line per accessing method: <isMeta 0|1> TAB <selector> TAB
  // <reads, comma-joined> TAB <writes, comma-joined>. Names come straight from
  // the compiled method, so they include in-scope inherited ivars by name.
  const code = `| class stream |
class := (System myUserProfile symbolList at: ${dictIndex}) at: #'${escapeString(className)}'.
stream := WriteStream on: Unicode7 new.
{ class. class class. } doWithIndex: [:eachClass :idx |
  | isMeta |
  isMeta := idx = 2.
  eachClass selectors asSortedCollection do: [:sel |
    | m rd wr |
    m := eachClass compiledMethodAt: sel environmentId: 0 otherwise: nil.
    m ifNotNil: [
      rd := m instVarsRead. wr := m instVarsWritten.
      (rd isEmpty and: [wr isEmpty]) ifFalse: [
        stream nextPutAll: (isMeta ifTrue: ['1'] ifFalse: ['0']); tab; nextPutAll: sel; tab.
        rd asSortedCollection do: [:n | stream nextPutAll: n] separatedBy: [stream nextPut: $,].
        stream tab.
        wr asSortedCollection do: [:n | stream nextPutAll: n] separatedBy: [stream nextPut: $,].
        stream lf ] ] ] ].
stream contents`;

  const raw = execute(code);

  const results: MethodInstVarAccess[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const split = (s: string): string[] => (s.length > 0 ? s.split(',') : []);
    results.push({
      isMeta: parts[0] === '1',
      selector: parts[1],
      reads: split(parts[2]),
      writes: split(parts[3]),
    });
  }
  return results;
}
