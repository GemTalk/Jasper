// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED CONFIGURATION — Tonel file out / file in (issue #616)
//
//   GemStone 3.7.5 and later, on a **rowan3** extent. Nothing else.
//   ("rowan3" = Rowan 3 / the RowanV3 project / `extent0.rowan3.dbf` — NOT
//   `extent0.rowan.dbf`, which installs the older Rowan.)
//
// Full statement, and the reasoning: ./tonelCapability.ts
// ─────────────────────────────────────────────────────────────────────────────
//
// File one class out as Tonel — Pharo's and Rowan's one-class-per-file source
// format — so a core developer can put base code in git and read it back.
//
// The unit is THE CLASS: its definition, its comment, and every method a Jasper
// user can see, in one file. There is no methods-only variant. Tonel has no such
// unit — the only shape carrying methods without a class definition is
// `Extension { }`, which means "these methods belong to another package", a
// Rowan concept a Jasper user has no way to see and should not be shown.
//
// We write no formatter. Rowan's own writer produces this text, and it is the
// reference implementation: the same code wrote the 720 `.class.st` files under
// `$GEMSTONE/projects/gemstoneBaseImage/rowan/src/`. What is written here is the
// call sequence around it.
//
// Why every method is populated by hand
// --------------------------------------
// `rwClassDefinitionInSymbolDictionaryNamed:` is documented "Ignore methods",
// and it means it. It has two paths: a Rowan-LOADED class answers
// `loadedClass asDefinition`, methods included; anything else answers a
// definition built from scratch with ZERO method definitions. A plain user class
// in UserGlobals with three methods therefore files out as a header and nothing
// else — silently, no error. That is the case a developer filing out their own
// work hits every time.
//
// So the methods are always populated here from the live class. Measured against
// the reference corpus, populating always:
//
//   * reproduces all 649 resolvable classes' headers byte-identically;
//   * reproduces every shipped method block verbatim — 0 missing, 0 altered;
//   * additionally exports 13,400 methods (median 5/class) that Rowan files into
//     other packages' `.extension.st` files.
//
// That last line is the point, not a defect: a Jasper user looking at a class
// sees all of its methods and has no notion of a package, so the file carries
// what they see. The corpus is a package-partitioned export; this is a
// class-complete one. Comparing the two whole-file is meaningless, which is why
// the integration tests assert header identity, method fidelity and selector
// completeness separately rather than diffing.
//
// What is deliberately left out: trait methods
// ----------------------------------------------
// A method a TRAIT provides is not the class's own code, and traits are not a
// supported Jasper feature. Exporting them would put methods in a class's file
// that the class does not define, and adding a trait would rewrite the whole
// file. They are filtered out by `isFromTrait`, which is in the capability
// contract, so a stone where we cannot tell hides the feature rather than
// quietly exporting them.
//
// Do NOT "optimize" this into a loaded-vs-unloaded branch. Populating over a
// Rowan-loaded definition is what makes the output complete; branching would
// restore the silent method loss above for every unloaded class.
import { QueryExecutor } from '../types';
import { classLookupExpr, escapeString } from '../util';
import { ROWAN_LOOKUP_PRELUDE, rowanLookupExpr } from './rowanLookup';

/** Answered when this session cannot reach the Tonel machinery at all. */
export const TONEL_NO_ROWAN = '!NO_ROWAN';

/** Prefix of an answer that reports a failure rather than carrying Tonel text. */
export const TONEL_ERROR_PREFIX = '!ERR ';

/**
 * Whether `answer` reports a failure instead of being Tonel source.
 *
 * Safe as a prefix test: Tonel starts with `Class {`, `Extension {` or the
 * class's comment, never with `!`.
 */
export function isTonelFileOutError(answer: string): boolean {
  return answer.startsWith(TONEL_ERROR_PREFIX) || answer === TONEL_NO_ROWAN;
}

/**
 * The Tonel source for one class, or a sentinel ({@link isTonelFileOutError}).
 *
 * `dict` scopes the lookup to one dictionary (1-based symbol-list index or
 * name), as the other class queries do; without it the name resolves as a
 * global, first match in the symbol list.
 */
export function fileOutClassTonel(
  execute: QueryExecutor,
  className: string,
  dict?: number | string,
): string {
  const code = `| rwLookup writerCls mdefCls cls defn visitor ws dictName |
${ROWAN_LOOKUP_PRELUDE}
writerCls := ${rowanLookupExpr('RwModificationTonelWriterVisitorV2')}.
mdefCls := ${rowanLookupExpr('RwMethodDefinition')}.
(writerCls isNil or: [mdefCls isNil]) ifTrue: [^'${TONEL_NO_ROWAN}'].
cls := ${classLookupExpr(className, dict)}.
cls ifNil: [^'${TONEL_ERROR_PREFIX}Class not found: ${escapeString(className)}'].
[
  "The dictionary the class actually lives in. Tonel carries no dictionary, but
   rwClassDefinitionInSymbolDictionaryNamed: wants one, and it is also the most
   useful fallback #category for a class that has no class category."
  dictName := nil.
  System myUserProfile symbolList do: [:d |
    (dictName isNil and: [(d at: #'${escapeString(className)}' ifAbsent: [nil]) == cls])
      ifTrue: [dictName := d name asString]].
  dictName ifNil: [dictName := 'UserGlobals'].
  defn := cls rwClassDefinitionInSymbolDictionaryNamed: dictName.
  "Never leave it nil: '#category : nil' is not valid Tonel and will not read back."
  defn category ifNil: [defn category: dictName].
  "Class options (dbTransient, subclassesDisallowed, selfCanBeSpecial, ...) are
   populated from the LIVE class for the same reason the methods are: for a class
   Rowan has not loaded, rwClassDefinitionInSymbolDictionaryNamed: answers a
   definition built from scratch, whose gs_options is empty regardless of how the
   class was actually created. A dbTransient class then filed out as an ordinary
   one -- silently, and the file read back as a persistent class.
   _rwOptionsArray is Rowan's own accessor for this, and agrees with the shipped
   corpus for loaded classes: Object answers #(selfCanBeSpecial) and its
   Object.class.st carries exactly that, so populating always keeps header
   identity rather than breaking it.
   Sent unguarded: swallowing an error here would file a dbTransient class out as
   an ordinary one, which is the silent loss this line exists to prevent. Nothing
   to swallow, either -- on 3.7.5 _rwOptionsArray is ^self _optionsArrayForDefinition,
   set arithmetic with no error path, and all 1127 classes in Globals answer it.
   The receivers that do not understand it, a metaclass and a non-class, never
   reach this line: rwClassDefinitionInSymbolDictionaryNamed: above rejects them
   first, and the outer handler reports that as a failed file out."
  defn gs_options: cls _rwOptionsArray.
  "Start from NO methods. For a Rowan-loaded class the definition already carries
   its own package's methods, and Rowan keys them by the #selector property -- as
   SYMBOLS. Adding ours alongside without clearing put each method in twice: a
   String key and a Symbol key are different keys, so nothing replaced and nothing
   complained. Clearing makes the live class the single source, which is the
   intent, and makes the outcome independent of how Rowan happens to key them."
  defn instanceMethodDefinitions:
    (defn instanceMethodDefinitions ifNil: [Dictionary new] ifNotNil: [:d | d class new]).
  defn classMethodDefinitions:
    (defn classMethodDefinitions ifNil: [Dictionary new] ifNotNil: [:d | d class new]).

  "Every method the class itself defines, both sides -- see the header."
  #(false true) do: [:meta | | target |
    target := meta ifTrue: [cls class] ifFalse: [cls].
    target selectors do: [:sel | | m md |
      m := target compiledMethodAt: sel otherwise: nil.
      "Trait-provided methods are NOT the class's own code -- see the header."
      (m notNil and: [m isFromTrait not]) ifTrue: [
        md := mdefCls
          newForSelector: sel
          protocol: (target categoryOfSelector: sel) asString
          source: m sourceString.
        meta
          ifTrue: [defn addClassMethodDefinition: md]
          ifFalse: [defn addInstanceMethodDefinition: md]]]].
  visitor := writerCls new
    methodSortBlock: [:a :b | a selector _unicodeLessThan: b selector];
    yourself.
  ws := WriteStream on: Unicode16 new.
  visitor _writeClassDefinition: defn on: ws.
  visitor _writeClassSideMethodDefinitions: defn on: ws.
  visitor _writeInstanceSideMethodDefinitions: defn on: ws.
  ws contents asString ]
  on: Error do: [:e | ^'${TONEL_ERROR_PREFIX}' , e messageText]`;
  return execute(code);
}
