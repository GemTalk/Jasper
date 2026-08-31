import { QueryExecutor } from './types';
import { symbolListIndexOfClassExpr } from './util';

/** One method breakpoint as the gem currently holds it. */
export interface GemStoneBreakpoint {
  /** The gem's own breakpoint number, as topaz reports it. */
  breakNumber: number;
  /** Base class name; '' for a breakpoint in executed code (a doit). */
  className: string;
  isMeta: boolean;
  /** '' for a breakpoint in executed code (a doit). */
  selector: string;
  stepPoint: number;
  /** Set but not currently signalling — the gem stores this as a negative ip. */
  disabled: boolean;
  environmentId: number;
  /** OOP of the home method, for operating on a method we can't name. */
  methodOop: string;
  /** Symbol dictionary binding the class; '' when it isn't in the symbol list. */
  dictName: string;
  /** Method category, for building the method's editor URI; '' when unknown. */
  category: string;
}

/**
 * Every method breakpoint set in this session's gem.
 *
 * Breakpoints are per-gem VM state: they do not survive logout and a `commit`
 * does not persist them, so this is a view of one session, never of the
 * repository. Jasper's durable model is the VS Code breakpoint list, which
 * `BreakpointManager` applies to each session; this query is the other
 * direction — what the gem actually has right now, including breakpoints Jasper
 * did not set (topaz, another tool, or a `halt` compiled into the code).
 *
 * Reads `GsNMethod class >> _breakReport: true`, whose second element is one
 * descriptor per breakpoint: `{ breakNumber . class . selector . stepPoint .
 * method . disabled }`. Going through `_breakReport:` rather than decoding
 * `_allMethodBreakpoints` directly is deliberate — **that primitive's tuple
 * stride changes between GemStone releases** (3 fields on 3.6.2, 4 on 3.7.5,
 * which gained `breakpointLevel`), so hand-decoding it walks off the end of the
 * array on the older release. `_breakReport:` is part of the same kernel as the
 * primitive and always knows its own stride; the six descriptor slots this reads
 * are identical on both.
 *
 * Breakpoints on a **superseded** version of a method are left out. Recompiling
 * does not clear the old `GsNMethod`'s breakpoints, and the gem keeps reporting
 * them under the same class and selector — so a method edited twice with a
 * breakpoint in it accumulates duplicate rows that can never fire, since nothing
 * will execute that method object again. They are noise in a breakpoint manager,
 * and indistinguishable from the live one to anyone reading the list.
 *
 * Dictionary and category come back too, so a caller can open the method in an
 * editor without a second round trip per breakpoint. The dictionary is matched
 * by class *identity* through the shared `symbolListIndexOfClassExpr`, not by
 * name, so a class name shadowed in two dictionaries resolves to the one
 * actually holding this class.
 */
export function getAllBreakpoints(execute: QueryExecutor): GemStoneBreakpoint[] {
  const code = `| ws sl dictOf isCurrent |
ws := WriteStream on: String new.
sl := System myUserProfile symbolList.
dictOf := [:aCls | | base idx |
  base := aCls isMeta ifTrue: [aCls thisClass] ifFalse: [aCls].
  idx := ${symbolListIndexOfClassExpr('base')}.
  idx = 0 ifTrue: [''] ifFalse: [((sl at: idx) name ifNil: ['']) asString]].
"Is this GsNMethod still the one installed for its class and selector? A
 recompile leaves the old method object holding its breakpoints, and the gem
 goes on reporting them."
isCurrent := [:meth :cls :sel |
  (cls isNil or: [sel isNil])
    ifTrue: [true]
    ifFalse: [[(cls compiledMethodAt: sel environmentId: meth environmentId) == meth]
                on: Error do: [:ex | false]]].
((GsNMethod _breakReport: true) at: 2) do: [:d |
  | brkNum cls sel stepPt home disabled |
  brkNum := d at: 1.
  cls := d at: 2.
  sel := d at: 3.
  stepPt := d at: 4.
  home := d at: 5.
  disabled := d at: 6.
  (isCurrent value: home value: cls value: sel) ifTrue: [
    ws nextPutAll: brkNum printString; tab;
       nextPutAll: (cls
         ifNil: ['']
         ifNotNil: [:c | c isMeta ifTrue: [c thisClass name asString] ifFalse: [c name asString]]); tab;
       nextPutAll: (cls ifNil: ['false'] ifNotNil: [:c | c isMeta printString]); tab;
       nextPutAll: (sel ifNil: [''] ifNotNil: [:s | s asString]); tab;
       nextPutAll: stepPt printString; tab;
       nextPutAll: disabled printString; tab;
       nextPutAll: home environmentId printString; tab;
       nextPutAll: home asOop printString; tab;
       nextPutAll: (cls ifNil: [''] ifNotNil: [:c | dictOf value: c]); tab;
       nextPutAll: ((cls isNil or: [sel isNil])
         ifTrue: ['']
         ifFalse: [(cls categoryOfSelector: sel) ifNil: [''] ifNotNil: [:c | c asString]]); lf]].
ws contents`;

  const raw = execute(code);

  const results: GemStoneBreakpoint[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 10) continue;
    results.push({
      breakNumber: parseInt(parts[0], 10),
      className: parts[1],
      isMeta: parts[2] === 'true',
      selector: parts[3],
      stepPoint: parseInt(parts[4], 10),
      disabled: parts[5] === 'true',
      environmentId: parseInt(parts[6], 10),
      methodOop: parts[7],
      dictName: parts[8],
      category: parts[9],
    });
  }
  return results;
}
