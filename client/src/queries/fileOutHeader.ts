import { QueryExecutor } from './types';

// The Topaz preamble that goes at the head of a file-out: the `fileformat utf8`
// directive Topaz needs in order to read the file back in, then comment lines
// naming the image the code came out of and when it was written.
//
// Jadeite writes the same preamble (Rowan's `RowanService>>writeFileOutHeaderOn:`),
// so a Jasper file-out and a Jadeite one open the same way. The one deviation is
// cosmetic: Jadeite prefixes every `System _version` line with `! ` and *then*
// writes `! From ` in front of the result, so its first line reads
// `! From ! GemStone/S ...` with the marker doubled. Here the first line reads
// `! From GemStone/S ...` and continuation lines carry a bare `! `. Only the
// `fileformat` line is functional; everything under it is a comment either way.
//
// Returned separately from the bodies (rather than folded into each file-out
// query) so a file-out that concatenates several bodies — a class category's
// classes, a multi-selection of methods — carries exactly one header, and so
// `fileOutClass` keeps answering the same bytes for the same class: the class-sync
// engine md5s that text, and a timestamp in it would make every class look changed
// on every sync.
export function fileOutHeader(execute: QueryExecutor): string {
  const code = `| ws lines |
ws := WriteStream on: String new.
ws nextPutAll: 'fileformat utf8'; lf.
ws nextPutAll: '!'; lf.
lines := System _version subStrings: (Array with: Character lf).
1 to: lines size do: [:i |
  ws nextPutAll: (i = 1 ifTrue: ['! From '] ifFalse: ['! ']);
    nextPutAll: (lines at: i);
    lf].
ws nextPutAll: '! On ';
  nextPutAll: Date today printString;
  nextPutAll: ', ';
  nextPutAll: Time now printString;
  lf.
ws nextPutAll: '!'; lf.
ws contents`;
  return execute(code);
}
