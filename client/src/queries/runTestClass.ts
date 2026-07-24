import { QueryExecutor } from './types';
import { classLookupOrRaiseExpr, splitLines } from './util';
import { TestRunResult } from './runTestMethod';

export function runTestClass(
  execute: QueryExecutor,
  className: string,
  dictName?: string,
): TestRunResult[] {
  // Resolve the class dictionary-scoped (when dictName is given) rather than
  // by bare name. Two distinct TestCase subclasses can share a name across
  // dictionaries; bare-name `objectNamed:` would silently run only the
  // symbol-list winner and hide the other suite. nil -> raise so the caller
  // surfaces it as an execution error instead of running the wrong class.
  //
  // `result passed`, `result failures`, `result errors` all contain the
  // TestCase instances themselves (only `testSelector` ivar) — verified via
  // probe. Don't send `each testCase`: the wrappers don't respond to it,
  // and on a real failure that branch would DNU. The TestCase instance
  // already carries `class name` and `selector`, same as the passed branch.
  //
  // Round-3 (round-2 ask #3 applied to this tool): for failures and errors
  // we re-run the test with our own AbstractException handler to capture
  // the live exception's class + messageText, instead of emitting the
  // post-run TestCase printString (which is just the SUnit debug recipe).
  // Doubles cost only for failing/erroring tests; passed tests don't re-run.
  //
  // Output is built through a String-class WriteStream (widens for
  // non-ASCII codepoints) and converted to Utf8 once at the boundary.
  // See python.ts for the encoding-model rationale.
  const code = `| cls suite result ws captureMessage |
${classLookupOrRaiseExpr(className, dictName)}
suite := cls suite.
result := suite run.
ws := WriteStream on: Unicode7 new.
captureMessage := [:t |
  | captured |
  captured := nil.
  [t setUp.
   t perform: t selector.
   t tearDown] on: AbstractException do: [:e | captured := e].
  captured isNil
    ifFalse: [
      ws nextPutAll: captured class name asString.
      ws nextPutAll: ': '.
      ws nextPutAll: captured messageText asString]].
result passed do: [:each |
  ws nextPutAll: each class name; tab;
    nextPutAll: each selector; tab;
    nextPutAll: 'passed'; tab; lf].
result failures do: [:each |
  ws nextPutAll: each class name; tab;
    nextPutAll: each selector; tab;
    nextPutAll: 'failed'; tab.
  captureMessage value: each.
  ws lf].
result errors do: [:each |
  ws nextPutAll: each class name; tab;
    nextPutAll: each selector; tab;
    nextPutAll: 'error'; tab.
  captureMessage value: each.
  ws lf].
ws contents encodeAsUTF8`;
  const data = execute(code);
  return splitLines(data).map((line) => {
    const parts = line.split('\t');
    return {
      className: parts[0] || className,
      selector: parts[1] || '',
      status: (parts[2] || 'error') as TestRunResult['status'],
      message: parts[3] || '',
      durationMs: 0,
    };
  });
}
