import { QueryExecutor } from '../../queries/types';
import { ClassNameEntry } from '../../queries/getAllClassNames';
import { symbolListIndexOfClassExpr } from '../../queries/util';

/** The most classes one call shows. */
export const CLASSES_FROM_CODE_LIMIT = 5000;

/**
 * Run Smalltalk that answers a collection of classes, and answer each as the entry that opens it:
 * its home dictionary (the symbol-list slot binding it under its own name) and name.
 *
 * `code` runs as the body of a block, as in methodsFromCode. A metaclass stands for its class, each
 * class appears once, and elements that are not classes, or classes no dictionary holds under
 * their own name, are left out.
 */
export function classesFromCode(execute: QueryExecutor, code: string): ClassNameEntry[] {
  // `home`, not `idx`: symbolListIndexOfClassExpr declares an `idx` of its own, and GemStone
  // refuses a name redefined in an enclosing scope.
  const raw = execute(`| classes ws seen count |
classes := [
${code}
] value.
ws := WriteStream on: Unicode7 new.
seen := IdentitySet new.
count := 0.
classes do: [:each | | cls home |
  (count < ${CLASSES_FROM_CODE_LIMIT} and: [each isBehavior]) ifTrue: [
    cls := each theNonMetaClass.
    (seen includes: cls) ifFalse: [
      seen add: cls.
      home := ${symbolListIndexOfClassExpr('cls')}.
      home > 0 ifTrue: [
        count := count + 1.
        ws nextPutAll: home printString; tab;
          nextPutAll: ((System myUserProfile symbolList at: home) name ifNil: ['']) asString; tab;
          nextPutAll: cls name; lf]]]].
ws contents`);
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.split('\t'))
    .filter((parts) => parts.length >= 3)
    .map(([dictIndex, dictName, className]) => ({
      dictIndex: parseInt(dictIndex, 10),
      dictName,
      className,
    }));
}
