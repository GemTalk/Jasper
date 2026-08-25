import { QueryExecutor } from '../../queries/types';
import {
  MethodSearchResult,
  methodSerialization,
  parseMethodSearchResults,
} from '../../queries/methodSearch';
import { classLookupExpr, escapeString } from '../../queries/util';

/** Every method that references a class variable: the instance- AND class-side methods of
 *  the class that declares it and of every subclass, IN THE GIVEN ENVIRONMENT, as browsable
 *  method rows. The caller sweeps the environments it cares about and folds the answers
 *  together.
 *
 *  A class variable is a shared binding, so detection is by literal-frame IDENTITY — a
 *  method references the variable exactly when its literals hold that association object —
 *  the same technique the engine's `methodsAccessingClassVar:inHierarchyOf:` uses. That
 *  excludes a same-named global (a different association), a shadowing temporary or
 *  argument (no association at all), and a mention in a comment.
 *
 *  `className` may be any class the variable is visible to: the scan walks up to the class
 *  that DECLARES the name and starts there, so a subclass row answers the same set as its
 *  ancestor's. A name no class in the chain declares answers nothing.
 *
 *  Like methodsAccessingInstVar this asks the base image directly, so the safe-delete guard
 *  works with or without the server plugin installed, and enumerates selectors with
 *  `selectorsForEnvironment:` rather than `selectors`, which would see environment 0 only. */
export function methodsAccessingClassVar(
  execute: QueryExecutor,
  className: string,
  classVarName: string,
  dict?: number | string,
  environmentId: number = 0,
): MethodSearchResult[] {
  const code = `| cls want owner assoc scanned methods stream limit classDict sl |
want := '${escapeString(classVarName)}' asSymbol.
cls := ${classLookupExpr(className, dict)}.
cls isNil ifTrue: [^ ''].
owner := nil.
[cls notNil and: [owner isNil]] whileTrue: [
  (cls classVarNames anySatisfy: [:e | e asSymbol == want]) ifTrue: [owner := cls].
  cls := cls superclass].
owner isNil ifTrue: [^ ''].
assoc := owner _classVars associationAt: want ifAbsent: [nil].
assoc isNil ifTrue: [^ ''].
scanned := OrderedCollection new.
scanned add: owner.
scanned addAll: owner allSubclasses.
methods := OrderedCollection new.
scanned do: [:each |
  (Array with: each with: each class) do: [:side |
    (side selectorsForEnvironment: ${environmentId}) do: [:sel | | m |
      m := side compiledMethodAt: sel environmentId: ${environmentId} otherwise: nil.
      (m notNil and: [m literals anySatisfy: [:e | e == assoc]])
        ifTrue: [methods add: m]]]].
methods := methods asArray.
${methodSerialization(environmentId)}`;

  return parseMethodSearchResults(execute(code));
}
