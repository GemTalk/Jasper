import { QueryExecutor } from './types';
import { classLookupOrRaiseExpr, escapeString } from './util';

export interface TestRunResult {
  className: string;
  selector: string;
  status: 'passed' | 'failed' | 'error';
  message: string;
  durationMs: number;
}

export function runTestMethod(
  execute: QueryExecutor,
  className: string,
  selector: string,
  dictName?: string,
): TestRunResult {
  const sel = escapeString(selector);
  // Resolve dictionary-scoped (see runTestClass for the rationale): a bare
  // name can resolve to the wrong same-named class in another dictionary.
  //
  // Round-3 (and round-2 ask #3 applied to this tool): capture the live
  // exception's class + messageText instead of the SUnit framework's
  // post-run TestCase printString (which is just the debug recipe). We
  // bypass `testCase run` and replicate setUp / perform / tearDown with our
  // own AbstractException handler — same pattern as describe_test_failure.
  // The TestFailure-vs-other-Exception kind discriminates failed/error.
  //
  // Output is built through a String-class WriteStream (which widens
  // transparently for non-ASCII codepoints) and converted to Utf8 once at
  // the boundary. See python.ts for the encoding-model rationale.
  const code = `| cls testCase captured tdEx ws status startMs endMs |
${classLookupOrRaiseExpr(className, dictName)}
testCase := cls selector: #'${sel}'.
startMs := Time millisecondClockValue.
captured := nil.
[testCase setUp] on: AbstractException do: [:e | captured := e].
captured isNil ifTrue: [
  [testCase perform: #'${sel}'] on: AbstractException do: [:e | captured := e].
  tdEx := nil.
  [testCase tearDown] on: AbstractException do: [:e | tdEx := e].
  (captured isNil and: [tdEx notNil]) ifTrue: [captured := tdEx]].
endMs := Time millisecondClockValue.

ws := WriteStream on: Unicode7 new.
captured isNil
  ifTrue: [ws nextPutAll: 'passed'; tab; tab]
  ifFalse: [
    status := (captured isKindOf: TestFailure) ifTrue: ['failed'] ifFalse: ['error'].
    ws nextPutAll: status; tab.
    ws nextPutAll: captured class name asString.
    ws nextPutAll: ': '.
    ws nextPutAll: captured messageText asString.
    ws tab].
ws nextPutAll: (endMs - startMs) printString.
ws contents encodeAsUTF8`;
  const data = execute(code);
  const parts = data.split('\t');
  return {
    className,
    selector,
    status: (parts[0] || 'error') as TestRunResult['status'],
    message: parts[1] || '',
    durationMs: parseInt(parts[2] || '0', 10) || 0,
  };
}
