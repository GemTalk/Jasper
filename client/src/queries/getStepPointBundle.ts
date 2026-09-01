import { QueryExecutor } from './types';
import { compiledMethodExpr } from './util';
import { StepPointSelectorInfo } from './getStepPointSelectorRanges';

/** Everything the step point model needs about one method, from one round trip. */
export interface StepPointBundle {
  source: string;
  /** GemStone's 1-based source positions, exactly as `_sourceOffsets` gives them. */
  offsets: number[];
  selectors: StepPointSelectorInfo[];
}

/**
 * Source, step point offsets and selector ranges for one method, in a single
 * query.
 *
 * These three were fetched separately, which cost three sequential GCI round
 * trips per method. They are read on the extension host from `provideInlayHints`
 * and `provideHover` — synchronously, because the GCI binding is synchronous —
 * so the first hover on a freshly opened method stalled the host for all three
 * in a row. The stone already computes the first two to answer the third, so
 * asking once is strictly less work for it as well.
 *
 * The reply puts the variable-length, anything-goes part last so nothing has to
 * be escaped: line 1 is the offsets, line 2 is how many selector rows follow,
 * then that many rows, and **everything after them is the source verbatim** —
 * newlines, tabs and all.
 */
export function getStepPointBundle(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): StepPointBundle {
  const method = compiledMethodExpr(className, isMeta, selector, environmentId, dict);
  // _sourceOffsets is 1-based; selectorOffset is emitted 0-based for JS callers,
  // matching what getStepPointSelectorRanges has always returned.
  const code = `| method source offsets ws rows count |
method := ${method}.
source := method sourceString.
offsets := method _sourceOffsets.
ws := WriteStream on: String new.
1 to: offsets size do: [:i |
  i > 1 ifTrue: [ws nextPut: $,].
  ws nextPutAll: (offsets at: i) printString].
ws lf.
rows := WriteStream on: String new.
count := 0.
1 to: offsets size do: [:stepIdx |
  | offset1 end ch |
  offset1 := offsets at: stepIdx.
  (offset1 >= 1 and: [offset1 <= source size]) ifTrue: [
    ch := source at: offset1.
    (ch isLetter or: [ch = $_]) ifTrue: [
      end := offset1 + 1.
      [end <= source size and: [
        | c |
        c := source at: end.
        c isLetter or: [c isDigit or: [c = $: or: [c = $_]]]]]
          whileTrue: [end := end + 1].
      count := count + 1.
      rows nextPutAll: stepIdx printString; tab;
           nextPutAll: (offset1 - 1) printString; tab;
           nextPutAll: (end - offset1) printString; tab;
           nextPutAll: (source copyFrom: offset1 to: end - 1); lf]]].
ws nextPutAll: count printString; lf.
ws nextPutAll: rows contents.
ws nextPutAll: source.
ws contents`;

  return parseStepPointBundle(execute(code));
}

/**
 * Split the reply back into its three parts. Exported for the tests, which pin
 * the framing — a source whose own text looks like a header row is exactly what
 * a length-counted format has to survive.
 */
export function parseStepPointBundle(raw: string): StepPointBundle {
  const nl = (from: number) => {
    const at = raw.indexOf('\n', from);
    return at === -1 ? raw.length : at;
  };

  const offsetsEnd = nl(0);
  const offsetsLine = raw.slice(0, offsetsEnd);
  const offsets =
    offsetsLine.length === 0 ? [] : offsetsLine.split(',').map((n) => parseInt(n, 10));

  const countEnd = nl(offsetsEnd + 1);
  const count = parseInt(raw.slice(offsetsEnd + 1, countEnd), 10) || 0;

  const selectors: StepPointSelectorInfo[] = [];
  let pos = countEnd + 1;
  for (let i = 0; i < count; i++) {
    const end = nl(pos);
    const parts = raw.slice(pos, end).split('\t');
    pos = end + 1;
    if (parts.length < 4) continue;
    selectors.push({
      stepPoint: parseInt(parts[0], 10),
      selectorOffset: parseInt(parts[1], 10),
      selectorLength: parseInt(parts[2], 10),
      selectorText: parts[3],
    });
  }

  return { source: raw.slice(Math.min(pos, raw.length)), offsets, selectors };
}
