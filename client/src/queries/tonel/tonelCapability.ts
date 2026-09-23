// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED CONFIGURATION — Tonel file out / file in (issue #616)
//
//   GemStone 3.7.5 and later, on a **rowan3** extent. Nothing else.
//
// "rowan3" means Rowan 3 — the `RowanV3` project, and a stone built from
// `extent0.rowan3.dbf`. NOT `extent0.rowan.dbf`, which installs the older
// Rowan. The distinction is load-bearing, not pedantry: both generations ship
// in the same 3.7.5 tarball, both define a global named `Rowan`, and both
// define classes named `RwModificationTonelWriterVisitorV2` whose headers carry
// different key sets. Reading "rowan" as the older one silently drives the
// wrong API.
//
// This is not graceful degradation. The whole feature calls RowanV3 classes
// that do not exist on a base extent, and the 3.6.x tarballs ship no Rowan
// extent of either generation — a rowan3 3.6.2 stone is not merely unsupported,
// it is not constructible from the product. Where the gate fails the commands
// are HIDDEN, not degraded, and every test for the feature SKIPS.
//
// Audience is core developers doing base-code development, not general users.
// ─────────────────────────────────────────────────────────────────────────────
//
// Why this probe asks about selectors rather than versions
// --------------------------------------------------------
// A version check would freeze the feature to the releases we happened to know
// about when we wrote it, and — worse — would keep the rowan3 test tier dark
// forever after rowan3 reached CI, because nothing would notice it had. Jasper
// runs no CI test against a rowan3 stone today, so this tier is developer-run
// until that changes; gating on the machinery being *present* means the feature
// and its tests switch themselves on the day rowan3 reaches CI or lands in the
// base extent, with no edit and nobody remembering to make one.
//
// So the probe resolves exactly the classes this feature drives and asks
// whether they understand exactly the selectors it sends.
//
// What this probe does NOT claim
// -------------------------------
// It is not a rowan2 detector. Rowan 2 is not a supported configuration and is
// not tested against, so whether this selector list happens to tell the two
// generations apart is unknown and deliberately unasserted — an earlier version
// of this comment claimed it was "the sharpest available discriminator", which
// nothing here demonstrates. What the probe guarantees is narrower and is the
// thing that matters: on a stone where these exact calls are not answerable, the
// feature is hidden.
//
// The classes are resolved through `./rowanLookup`, NOT through the session's
// symbol list directly: on a rowan3 stone the Rowan dictionaries are in
// SystemUser's symbol list only, so a DataCurator session would see nothing and
// hide the feature on a stone that supports it. See that file for the measured
// detail and for every cheaper route that was tried and failed.
//
// Several of these are PRIVATE Rowan API (`_write…`). That is deliberate and
// unavoidable: Rowan's public writer entry points are all project/package
// modification visitors that write into a package directory on disk, and there
// is no public single-class entry point on either side. Pinning the private
// shape here is what turns "Rowan changed under us" from a mysterious runtime
// failure into a named, hidden command and a skipped test.
import { QueryExecutor } from '../types';
import { escapeString, splitLines } from '../util';
import { ROWAN_LOOKUP_PRELUDE, rowanLookupExpr } from './rowanLookup';

/**
 * The class-and-selector pairs the gate probes, written as they read in
 * Smalltalk: `Receiver>>selector` for a message to an instance,
 * `Receiver class>>selector` for one to the class itself.
 *
 * NOT every Rowan message the feature sends. The two doits send about thirty
 * between them, and most carry no information: if `RwClassDefinition` resolves
 * at all it answers `name` and `category`, so probing them tells us nothing the
 * class lookup has not already told us, and a list nobody can keep complete is
 * worse at its job than a short one that is true.
 *
 * What earns a place here is a call that could stop working while its class
 * still resolves: the PRIVATE API (`_write…`, `_packageConvention:`), and the
 * calls whose absence would otherwise surface as a mysterious runtime failure
 * rather than a hidden command. When you add one of those, add it here.
 */
export const TONEL_CAPABILITIES = [
  // File out: driving the writer directly, one class at a time.
  'RwModificationTonelWriterVisitorV2>>_writeClassDefinition:on:',
  'RwModificationTonelWriterVisitorV2>>_writeClassSideMethodDefinitions:on:',
  'RwModificationTonelWriterVisitorV2>>_writeInstanceSideMethodDefinitions:on:',
  // Not optional: `methodSortBlock` lazily reads `currentProjectDefinition
  // methodSortOrder`, which is nil on a visitor we built ourselves, so the
  // writer doesNotUnderstand the first time it sorts methods unless we set it.
  'RwModificationTonelWriterVisitorV2>>methodSortBlock:',
  // File in: assembling a reader visitor by hand so the parser can be fed a
  // string, since Rowan's own entry point takes a file path.
  'RwRepositoryResolvedProjectTonelReaderVisitorV2>>currentProjectDefinition:',
  'RwRepositoryResolvedProjectTonelReaderVisitorV2>>currentPackageDefinition:',
  // Private, and the likeliest of these to be renamed. Without it the reader
  // takes the wrong package convention and the parse goes wrong quietly.
  'RwRepositoryResolvedProjectTonelReaderVisitorV2>>_packageConvention:',
  'RwTonelParser class>>on:filePath:forReader:',
  // The parse itself. `on:filePath:forReader:` answers a parser; `start` is what
  // makes it read, so losing it breaks file in with the writer still intact.
  'RwTonelParser>>start',
  'RwResolvedProjectV2>>addPackageNamed:toComponentNamed:',
  'RwResolvedProjectV2>>addLoadComponentNamed:comment:',
  // Building method definitions from a live class, for the file-out header's
  // methods (see fileOutClassTonel for why this is always needed).
  'RwMethodDefinition class>>newForSelector:protocol:source:',
  'Class>>rwClassDefinitionInSymbolDictionaryNamed:',
  // Class options, read from the live class because an unloaded class's definition
  // carries none — see fileOutClassTonel. Without this a dbTransient class files
  // out as an ordinary one.
  'Class>>_rwOptionsArray',
  'RwClassDefinition>>gs_options:',
  // File in: the properties the reader carries across, and the ones it only
  // reports. Listed so a Rowan that stops answering them hides the feature rather
  // than silently filing classes in with the wrong shape.
  'RwClassDefinition>>gs_options',
  'RwClassDefinition>>properties',
  // Telling a trait's methods from the class's own. Traits are not a supported
  // Jasper feature and their methods are excluded from a file-out, so losing this
  // selector must hide the feature rather than silently start exporting them.
  'GsNMethod>>isFromTrait',
] as const;

export type TonelCapability = (typeof TONEL_CAPABILITIES)[number];

export interface TonelCapabilityResult {
  /** Whether every capability is present — the one question callers should ask. */
  available: boolean;
  /** Which capabilities are absent, for a diagnostic the user can act on. */
  missing: string[];
}

/** Split `Receiver class>>selector` into the global to resolve, whether the
 *  message goes to the class itself, and the selector. */
function parse(capability: string): { global: string; isMeta: boolean; selector: string } {
  const [receiver, selector] = capability.split('>>');
  const isMeta = receiver.endsWith(' class');
  return { global: isMeta ? receiver.slice(0, -' class'.length) : receiver, isMeta, selector };
}

/**
 * Which parts of the Tonel machinery this session can reach.
 *
 * Answers the MISSING capabilities rather than a bare boolean so a refusal can
 * say what is absent: "this stone has Rowan but not `RwTonelParser`" is a
 * different problem from "this is a base extent", and a user staring at a
 * hidden menu deserves to be able to tell them apart.
 */
export function tonelCapability(execute: QueryExecutor): TonelCapabilityResult {
  // `canUnderstand:` on the metaclass answers whether the CLASS responds, which
  // is what a `Foo class>>bar` capability means; on the class itself it answers
  // whether its instances do.
  const probes = TONEL_CAPABILITIES.map((capability) => {
    const { global, isMeta, selector } = parse(capability);
    return `probe value: '${escapeString(capability)}' value: ${rowanLookupExpr(global)} value: ${isMeta} value: #'${escapeString(selector)}'.`;
  }).join('\n');

  const code = `| ws probe rwLookup |
ws := WriteStream on: String new.
${ROWAN_LOOKUP_PRELUDE}
probe := [:label :g :meta :sel | | target |
  target := g ifNil: [nil] ifNotNil: [:cls | meta ifTrue: [cls class] ifFalse: [cls]].
  (target notNil and: [target canUnderstand: sel])
    ifFalse: [ws nextPutAll: label; lf]].
${probes}
ws contents`;

  // A blank line is not a missing capability: GCI string answers routinely carry
  // a trailing newline, and treating that as a name would hide the feature on a
  // perfectly good stone.
  const missing = splitLines(execute(code))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return { available: missing.length === 0, missing };
}
