import { QueryExecutor } from './types';
import { compiledMethodExpr } from './util';

export interface StepPointSelectorInfo {
  stepPoint: number;
  selectorOffset: number;
  selectorLength: number;
  selectorText: string;
}

export function getStepPointSelectorRanges(
  execute: QueryExecutor,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): StepPointSelectorInfo[] {
  const method = compiledMethodExpr(className, isMeta, selector, environmentId, dict);
  // _sourceOffsets returns 1-based; we emit 0-based selectorOffset for JS callers.
  const code = `| method source offsets ws |
method := ${method}.
source := method sourceString.
offsets := method _sourceOffsets.
ws := WriteStream on: String new.
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
      ws nextPutAll: stepIdx printString; tab;
         nextPutAll: (offset1 - 1) printString; tab;
         nextPutAll: (end - offset1) printString; tab;
         nextPutAll: (source copyFrom: offset1 to: end - 1); lf]]].
ws contents`;

  const raw = execute(code);

  const results: StepPointSelectorInfo[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    results.push({
      stepPoint: parseInt(parts[0], 10),
      selectorOffset: parseInt(parts[1], 10),
      selectorLength: parseInt(parts[2], 10),
      selectorText: parts[3],
    });
  }
  return results;
}
