/**
 * The wire format the undo doits use for method source (issue #434).
 *
 * Source has to travel to the client (to be held in the undo stack) and back again (to
 * be recompiled), and it contains the two characters a tab-delimited, line-oriented
 * result cannot carry: newlines and tabs. It may also contain non-ASCII text, which is
 * the sharper problem — a Unicode-promoted GemStone result trips the client's
 * non-blocking GCI fetch, which reads characters rather than raw bytes. The refactoring
 * engine solves that for its preview payload by emitting pure ASCII; this does the same,
 * but LOSSLESSLY, because what comes back here is recompiled rather than displayed.
 *
 * The encoding is deliberately tiny: a backslash escapes itself, and anything outside
 * printable ASCII becomes `\uXXXX` (or `\UXXXXXXXX` above the BMP). Nothing else is
 * touched, so an ordinary ASCII method travels as itself and stays readable in a log.
 *
 * `SMALLTALK_ESCAPER` is the emitting half, written once and shared by both doits.
 */

/** A Smalltalk block, bound to `esc`, that writes an escaped string onto a stream:
 *  `esc value: someString value: aWriteStream`. Paste it into a doit's preamble. */
export const SMALLTALK_ESCAPER = `hex := [:n :width | | s v digits |
  s := ''. v := n. digits := '0123456789ABCDEF'.
  1 to: width do: [:i | s := (digits at: (v \\\\ 16) + 1) asString, s. v := v // 16].
  s].
esc := [:str :stream |
  str do: [:ch | | code |
    code := ch asInteger.
    ch == $\\
      ifTrue: [stream nextPutAll: '\\\\']
      ifFalse: [
        (code >= 32 and: [code <= 126])
          ifTrue: [stream nextPut: ch]
          ifFalse: [
            code > 65535
              ifTrue: [stream nextPutAll: '\\U'; nextPutAll: (hex value: code value: 8)]
              ifFalse: [stream nextPutAll: '\\u'; nextPutAll: (hex value: code value: 4)]]]]].`;

/** The temps `SMALLTALK_ESCAPER` needs declared. */
export const SMALLTALK_ESCAPER_TEMPS = 'hex esc';

/** Turn one escaped field back into the text it stands for. */
export function decodeEscaped(field: string): string {
  let out = '';
  let i = 0;
  while (i < field.length) {
    const ch = field[i];
    if (ch !== '\\') {
      out += ch;
      i += 1;
      continue;
    }
    const marker = field[i + 1];
    if (marker === '\\') {
      out += '\\';
      i += 2;
    } else if (marker === 'u') {
      out += String.fromCodePoint(parseInt(field.slice(i + 2, i + 6), 16));
      i += 6;
    } else if (marker === 'U') {
      out += String.fromCodePoint(parseInt(field.slice(i + 2, i + 10), 16));
      i += 10;
    } else {
      // Not an escape this encoder produces. Keep the backslash rather than eat it —
      // dropping a character silently is worse than passing one through.
      out += ch;
      i += 1;
    }
  }
  return out;
}
