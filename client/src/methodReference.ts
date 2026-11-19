import { isValidSelector } from './queries/util';

/** A method named in text — `Object>>printString`, `String class>>new`. */
export interface MethodReference {
  className: string;
  isMeta: boolean;
  selector: string;
  /** The text named a block (`[] in Object>>foo`); the reference is to the method holding it. */
  inBlock: boolean;
}

const NAME = String.raw`[A-Za-z_]\w*(?:\s+class)?`;
// `Name>>sel`, or a debugger frame's `Receiver (DefiningClass)>>sel`, whose method lives on the
// class in parentheses. `>>` splits at its first occurrence, so `Integer>>>>` names the `>>` selector.
const QUALIFIED = new RegExp(
  String.raw`^(?:${NAME}\s*\(\s*(${NAME})\s*\)|(${NAME}))\s*>>\s*#?\s*(.+)$`,
);

// What the debugger's Copy Stack and Copy Frame add around a frame label: `[3] ` before it, and the
// step point and line after it (`  @2 line 12`).
const COPIED_FRAME_NUMBER = /^\[\d+\]\s+/;
const COPIED_FRAME_POSITION = /\s+@\d+(?:\s+line\s+\d+)?$/;

/**
 * Read a qualified method name as Smalltalk writes it, including the forms people paste: a
 * GsNMethod's printString (`GsNMethod [] in Foo class>>bar`) and a debugger frame label
 * (`[] in Foo>>#bar`, `Receiver (Foo)>>#bar`), as Copy Frame and Copy Stack copy it.
 *
 * Returns null for anything else — a bare selector, a bare class name, a doit block
 * (`[] in <nil>>><anonymous>`), or a selector that isn't legal Smalltalk.
 */
export function parseMethodReference(raw: string): MethodReference | null {
  let text = raw
    .trim()
    .replace(COPIED_FRAME_NUMBER, '')
    .replace(COPIED_FRAME_POSITION, '')
    .replace(/^GsNMethod\s+/, '');
  const block = /^\[\]\s+in\s+/.exec(text);
  if (block) text = text.slice(block[0].length);

  const m = QUALIFIED.exec(text);
  if (!m) return null;
  const classPart = m[1] ?? m[2];
  const selector = m[3].trim();
  if (!isValidSelector(selector)) return null;
  const isMeta = /\s+class$/.test(classPart);
  return {
    className: isMeta ? classPart.replace(/\s+class$/, '') : classPart,
    isMeta,
    selector,
    inBlock: block !== null,
  };
}
