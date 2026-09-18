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
// Lengths are counted in string elements as GemStone sees them, which matches
// JavaScript for everything in practice; a non-BMP character could in principle
// disagree, and the terminator check is what turns that into a visible error
// rather than corruption.
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
  /** Rowan's class type — `normal`, `variable`, `byteSubclass`, … */
  type: string;
  /** Tonel's `#category`: a PACKAGE, not a SymbolDictionary. */
  category: string;
  /** Empty string when the file carried no comment. */
  comment: string;
  instVars: string[];
  classVars: string[];
  classInstVars: string[];
  pools: string[];
  methods: TonelMethod[];
}

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
    const end = start + length;
    // The terminator check: this is what makes a wrong length loud rather than
    // silently yielding a short payload.
    if (end >= wire.length + 1 || wire[end] !== '\n') {
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
      case 'IMETHOD':
        result.methods.push(method(payload, false));
        break;
      case 'CMETHOD':
        result.methods.push(method(payload, true));
        break;
    }
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
  const record = (kind: Kind, payload: string): string =>
    `${kind}\t${payload.length}\n${payload}\n`;
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
    ...cls.methods.map((m) =>
      record(m.isMeta ? 'CMETHOD' : 'IMETHOD', `${m.selector}\n${m.category}\n${m.source}`),
    ),
  ].join('');
}
