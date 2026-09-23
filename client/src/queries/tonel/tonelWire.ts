// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED CONFIGURATION — Tonel file out / file in (issue #616)
//
//   GemStone 3.7.5 and later, on a **rowan3** extent. Nothing else.
//   ("rowan3" = Rowan 3 / the RowanV3 project / `extent0.rowan3.dbf`.)
//
// Full statement, and the reasoning: ./tonelCapability.ts
// ─────────────────────────────────────────────────────────────────────────────
//
// How a parsed Tonel class travels back from the stone.
//
// Why not the usual tab-and-newline framing
// ------------------------------------------
// Almost every query in this project answers tab- or newline-delimited records,
// and that is fine when the values are names. Here one of the values is METHOD
// SOURCE, which is arbitrary text: it contains newlines by definition, tabs by
// convention, single quotes, square brackets, and — in the base image —
// occasional control characters. There is no delimiter that method source cannot
// contain, so a delimited format cannot be made correct, only unlikely to break.
//
// So every value is LENGTH-PREFIXED:
//
//     <KIND>\t<length>\n<payload>\n
//
// The reader consumes exactly `length` characters and then REQUIRES the newline
// that must follow. That check is what makes a wrong length loud: a truncated or
// mis-counted payload fails immediately instead of silently yielding a shorter
// method list. This matters more here than in a read-only query, because file-in
// REPLACES — a quietly dropped method is a deleted method.
//
// Lengths are counted in CODE POINTS, which is what GemStone counts: `aString
// size` answers elements, and a Unicode16/QuadByteString element is one code
// point. JavaScript's `length` and `slice` count UTF-16 code units instead, so
// the two agree for everything in the Basic Multilingual Plane and disagree by
// one for every character outside it — an emoji in a class comment being the
// case that actually turns up. The reader therefore advances the declared number
// of code points (see `endOfPayload`) rather than slicing by `length`.
//
// This was not theoretical: a comment containing a single 😀 made GemStone
// declare 28 and JavaScript see 29, the terminator check failed, and file in
// refused the entire file. The terminator check did its job — it turned the
// disagreement into a loud error rather than corruption — but the format was
// still unreadable for that file, so the counting itself is now right.
//
// Unknown record kinds are an ERROR, not something to skip. Skipping is how a
// field added on the server gets dropped on the floor by an older client with
// nobody noticing.

/** One method as the stone described it. */
export interface TonelMethod {
  /** True for a class-side method. */
  isMeta: boolean;
  selector: string;
  /** The method's protocol, from the Tonel `#category` pragma. */
  category: string;
  /** Source exactly as Tonel carried it, pattern line included. */
  source: string;
}

/** A class as the stone parsed it out of Tonel text. */
export interface TonelClass {
  name: string;
  superclass: string;
  /**
   * Rowan's class type, verbatim from `clsDef classType`: `normal`, `variable`,
   * `byteSubclass` or `immediate`. These are Rowan's spellings, not GemStone's
   * creation selectors — `tonelFileIn.ts` maps them.
   */
  type: string;
  /** Tonel's `#category`: a PACKAGE, not a SymbolDictionary. */
  category: string;
  /** Empty string when the file carried no comment. */
  comment: string;
  instVars: string[];
  classVars: string[];
  classInstVars: string[];
  /**
   * Always empty in practice. Rowan's Tonel reader does not carry pool
   * dictionaries -- `newClassDefinitionFrom:` passes `pools: #()` and leaves the
   * header's own read commented out -- so nothing filed in through it ever has
   * them. That is Rowan's decision about what Tonel represents, not a gap here.
   */
  pools: string[];
  /**
   * GemStone class options from Tonel's `#gs_options` — `dbTransient`,
   * `instancesNonPersistent`, `disallowGciStore`, … Empty when the header carried
   * none, which is the common case and means "no options", not "unknown".
   *
   * Carried because they change what the class IS: a `dbTransient` class filed back
   * in without them is an ordinary persistent class that looks like it filed in
   * cleanly. 145 classes in the shipped 3.7.5 corpus carry them.
   */
  options: string[];
  /**
   * Header properties this reader understands to exist but does NOT apply on file
   * in, present in this particular file — see `UNCARRIED_PROPERTIES`.
   *
   * Reported so the loss is stated rather than silent. Empty for almost every
   * class a developer writes.
   */
  uncarried: string[];
  methods: TonelMethod[];
}

/**
 * Tonel header properties Jasper deliberately does not restore on file in.
 *
 * `gs_reservedoop` pins a class to a specific object OOP. It is an identity the
 * base image assigns; re-applying it to a class being created from a file would at
 * best fail and at worst collide with the object that already holds it.
 *
 * `gs_constraints` and `gs_foreignKeys` describe per-instance-variable constraints.
 * GemStone can express them, but they are not part of what Jasper shows a user, and
 * applying them from a file has no tested path. Named here rather than ignored, so
 * a file carrying them says so.
 */
export const UNCARRIED_PROPERTIES = ['gs_reservedoop', 'gs_constraints', 'gs_foreignKeys'];

/** Record kinds, in the order the server emits them. */
const KINDS = [
  'NAME',
  'SUPER',
  'TYPE',
  'CATEGORY',
  'COMMENT',
  'IVARS',
  'CVARS',
  'CIVARS',
  'POOLS',
  'OPTIONS',
  'UNCARRIED',
  'IMETHOD',
  'CMETHOD',
] as const;

type Kind = (typeof KINDS)[number];

/** A variable list travels as space-separated names — names cannot contain spaces. */
const names = (payload: string): string[] => payload.split(' ').filter((n) => n.length > 0);

/**
 * A method record's payload is `selector\ncategory\nsource`.
 *
 * Safe as two line splits and a remainder: a selector cannot contain a newline
 * and neither can a protocol, while the source — which can — is everything left,
 * so it is never split at all.
 */
function method(payload: string, isMeta: boolean): TonelMethod {
  const firstBreak = payload.indexOf('\n');
  const secondBreak = payload.indexOf('\n', firstBreak + 1);
  if (firstBreak < 0 || secondBreak < 0) {
    throw new Error('Incomplete method record: expected selector, category and source');
  }
  return {
    isMeta,
    selector: payload.slice(0, firstBreak),
    category: payload.slice(firstBreak + 1, secondBreak),
    source: payload.slice(secondBreak + 1),
  };
}

/**
 * The index just past `codePoints` code points starting at `start`, or -1 if the
 * string ends first.
 *
 * The one place this reader bridges GemStone's element count and JavaScript's
 * UTF-16 indexing. Walking rather than slicing is what lets a payload containing
 * a non-BMP character (an emoji) be read at its declared length.
 */
function endOfPayload(wire: string, start: number, codePoints: number): number {
  let at = start;
  for (let n = 0; n < codePoints; n += 1) {
    if (at >= wire.length) return -1;
    // Surrogate pairs are two UTF-16 units and one code point.
    at += (wire.codePointAt(at) as number) > 0xffff ? 2 : 1;
  }
  return at > wire.length ? -1 : at;
}

/**
 * Decode what {@link tonelClassQuery}'s answer describes.
 *
 * Throws on anything it cannot read exactly — see the header for why a partial
 * decode is not an acceptable outcome here.
 */
export function decodeTonelClass(wire: string): TonelClass {
  const result: TonelClass = {
    name: '',
    superclass: '',
    type: '',
    category: '',
    comment: '',
    instVars: [],
    classVars: [],
    classInstVars: [],
    pools: [],
    options: [],
    uncarried: [],
    methods: [],
  };

  let at = 0;
  while (at < wire.length) {
    const headerEnd = wire.indexOf('\n', at);
    if (headerEnd < 0) throw new Error(`Truncated record header at ${at}`);
    const [kind, rawLength] = wire.slice(at, headerEnd).split('\t');
    if (!KINDS.includes(kind as Kind)) throw new Error(`Unknown record kind: ${kind}`);
    const length = Number(rawLength);
    if (!Number.isInteger(length) || length < 0) {
      throw new Error(`Bad record length for ${kind}: ${rawLength}`);
    }

    const start = headerEnd + 1;
    // Code points, not UTF-16 units — see the header. `end` is -1 when the payload
    // runs past the end of the wire.
    const end = endOfPayload(wire, start, length);
    // The terminator check: this is what makes a wrong length loud rather than
    // silently yielding a short payload.
    if (end < 0 || wire[end] !== '\n') {
      throw new Error(`Truncated payload for ${kind}: declared ${length} characters`);
    }
    const payload = wire.slice(start, end);
    at = end + 1;

    switch (kind as Kind) {
      case 'NAME':
        result.name = payload;
        break;
      case 'SUPER':
        result.superclass = payload;
        break;
      case 'TYPE':
        result.type = payload;
        break;
      case 'CATEGORY':
        result.category = payload;
        break;
      case 'COMMENT':
        result.comment = payload;
        break;
      case 'IVARS':
        result.instVars = names(payload);
        break;
      case 'CVARS':
        result.classVars = names(payload);
        break;
      case 'CIVARS':
        result.classInstVars = names(payload);
        break;
      case 'POOLS':
        result.pools = names(payload);
        break;
      case 'OPTIONS':
        result.options = names(payload);
        break;
      case 'UNCARRIED':
        result.uncarried = names(payload);
        break;
      case 'IMETHOD':
        result.methods.push(method(payload, false));
        break;
      case 'CMETHOD':
        result.methods.push(method(payload, true));
        break;
    }
  }

  // A class cannot define one selector twice on a side. A file that carries it
  // twice is malformed, and must not reach file in: REPLACE means the last one
  // silently wins, so the developer would never learn the file was wrong. This
  // also backstops the file-out — it shipped duplicates for days because every
  // comparison in the test suite collapsed them.
  const seen = new Set<string>();
  for (const m of result.methods) {
    const key = `${m.isMeta ? 'class' : 'instance'}:${m.selector}`;
    if (seen.has(key)) {
      throw new Error(`${result.name} defines ${m.isMeta ? 'class-side ' : ''}${m.selector} twice`);
    }
    seen.add(key);
  }
  return result;
}

/**
 * The encoder, for tests only.
 *
 * The real encoder is the Smalltalk in `tonelClassQuery`; this exists so the
 * decoder can be tested against gnarly payloads without a stone, and so the two
 * sides' agreement is written down in one place a reader can check.
 */
export function encodeTonelClassForTest(cls: TonelClass): string {
  // Code points, matching what the stone counts — see the header.
  const record = (kind: Kind, payload: string): string =>
    `${kind}\t${[...payload].length}\n${payload}\n`;
  return [
    record('NAME', cls.name),
    record('SUPER', cls.superclass),
    record('TYPE', cls.type),
    record('CATEGORY', cls.category),
    record('COMMENT', cls.comment),
    record('IVARS', cls.instVars.join(' ')),
    record('CVARS', cls.classVars.join(' ')),
    record('CIVARS', cls.classInstVars.join(' ')),
    record('POOLS', cls.pools.join(' ')),
    record('OPTIONS', cls.options.join(' ')),
    record('UNCARRIED', cls.uncarried.join(' ')),
    ...cls.methods.map((m) =>
      record(m.isMeta ? 'CMETHOD' : 'IMETHOD', `${m.selector}\n${m.category}\n${m.source}`),
    ),
  ].join('');
}
