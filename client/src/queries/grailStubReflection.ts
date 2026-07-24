import { QueryExecutor } from './types';
import { classLookupExpr } from './util';

// One-round-trip reflection backing the "Generate Grail .py Stub" feature.
// Grail's @smalltalk_class attaches Python methods onto an existing Smalltalk
// class, so the stub generator needs, in a single call:
//   - the class's OWN instVarNames, in definition order (for __slots__, which
//     Grail validates name-and-order against `targetClass instVarNames`);
//   - for each own instVar, whether the class understands the unary accessor
//     `x` and the keyword mutator `x:` (so self.x will actually work);
//   - the class's own selectors on both sides (candidates to wrap);
//   - the immediate superclass name and the class comment (for the docstring).
//
// `dict` (a 1-based SymbolList index, or a name) disambiguates a class name
// shadowed across dictionaries — the same scoping the other browser queries use.

export interface GrailInstVar {
  name: string;
  hasGetter: boolean; // class understands the unary accessor `name`
  hasSetter: boolean; // class understands the keyword mutator `name:`
}

export interface GrailStubMethod {
  side: 'instance' | 'class';
  category: string;
  selector: string;
}

export interface GrailStubReflection {
  found: boolean;
  superclass: string; // immediate superclass name; '' when there is none
  comment: string; // class comment; '' when there is none
  instVars: GrailInstVar[]; // own instVars, in definition order
  methods: GrailStubMethod[]; // own selectors, both sides
}

export function getGrailStubReflection(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): GrailStubReflection {
  // Output is line-oriented and tab-delimited, with the (possibly multi-line)
  // class comment last after a sentinel so its newlines don't confuse parsing:
  //   SUPER\t<superclassName>
  //   IVAR\t<name>\t<0|1 getter>\t<0|1 setter>
  //   METHOD\t<i|c>\t<category>\t<selector>
  //   ===COMMENT===
  //   <raw comment to end of output>
  // A missing / non-class lookup answers the bare token MISSING.
  const code = `| cls ws |
cls := ${classLookupExpr(className, dict)}.
(cls isNil or: [cls isBehavior not]) ifTrue: [^ 'MISSING'].
ws := WriteStream on: Unicode7 new.
ws nextPutAll: 'SUPER'; tab;
  nextPutAll: (cls superclass ifNil: [''] ifNotNil: [:s | s name]); lf.
cls instVarNames do: [:iv |
  ws nextPutAll: 'IVAR'; tab; nextPutAll: iv; tab;
    nextPutAll: ((cls canUnderstand: iv asSymbol) ifTrue: ['1'] ifFalse: ['0']); tab;
    nextPutAll: ((cls canUnderstand: (iv, ':') asSymbol) ifTrue: ['1'] ifFalse: ['0']); lf].
{ cls -> 'i'. cls class -> 'c' } do: [:pair |
  pair key categoryNames asSortedCollection do: [:cat |
    (pair key sortedSelectorsIn: cat) do: [:sel |
      ws nextPutAll: 'METHOD'; tab; nextPutAll: pair value; tab;
        nextPutAll: cat; tab; nextPutAll: sel; lf]]].
ws nextPutAll: '===COMMENT==='; lf.
ws nextPutAll: (cls comment ifNil: ['']).
ws contents`;
  return parseGrailStubReflection(execute(code));
}

export function parseGrailStubReflection(raw: string): GrailStubReflection {
  if (raw.trim() === 'MISSING') {
    return { found: false, superclass: '', comment: '', instVars: [], methods: [] };
  }
  const lines = raw.split('\n');
  let superclass = '';
  const commentLines: string[] = [];
  const instVars: GrailInstVar[] = [];
  const methods: GrailStubMethod[] = [];
  let inComment = false;
  for (const line of lines) {
    if (inComment) {
      commentLines.push(line);
      continue;
    }
    if (line === '===COMMENT===') {
      inComment = true;
      continue;
    }
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts[0] === 'SUPER') {
      superclass = parts[1] ?? '';
    } else if (parts[0] === 'IVAR' && parts.length >= 4 && parts[1].length > 0) {
      instVars.push({ name: parts[1], hasGetter: parts[2] === '1', hasSetter: parts[3] === '1' });
    } else if (parts[0] === 'METHOD' && parts.length >= 4 && parts[3].length > 0) {
      methods.push({
        side: parts[1] === 'c' ? 'class' : 'instance',
        category: parts[2],
        selector: parts[3],
      });
    }
  }
  return { found: true, superclass, comment: commentLines.join('\n'), instVars, methods };
}
