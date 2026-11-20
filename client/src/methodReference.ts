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
  String.raw`^(?:${NAME}\s*\(\s*(${NAME})\s*\)|(${NAME}))\s*>>\s*#?\s*([^#].*)$`,
);

// What the debugger's Copy Stack and Copy Frame add around a frame label: `[3] ` before it, and the
// step point and line after it (`  @2 line 12`).
const COPIED_FRAME_NUMBER = /^\[\d+\]\s+/;
const COPIED_FRAME_POSITION = /\s+(?:@\d+(?:\s+line\s+\d+)?|line\s+\d+)$/;

/**
 * Read a qualified method name as Smalltalk writes it, including the forms people paste: a
 * GsNMethod's printString (`GsNMethod [] in Foo class>>bar`) and a debugger frame label
 * (`[] in Foo>>#bar`, `Receiver (Foo)>>#bar`), as Copy Frame and Copy Stack copy it.
 *
 * Returns null for anything else — a bare selector, a bare class name, or a doit block
 * (`[] in <nil>>><anonymous>`). The selector half is taken as written, not checked: binary
 * selectors have no length limit (`PPParser>>==>`), and a name no method has just finds nothing.
 */
export function parseMethodReference(raw: string): MethodReference | null {
  const text = raw.trim().replace(COPIED_FRAME_NUMBER, '').replace(COPIED_FRAME_POSITION, '');
  // Read as written first: in `GsNMethod class>>new` the word names the class, not a print prefix.
  return parseFrameLabel(text) ?? parseFrameLabel(text.replace(/^GsNMethod\s+/, ''));
}

function parseFrameLabel(label: string): MethodReference | null {
  let text = label;
  const block = /^\[\]\s+in\s+/.exec(text);
  if (block) text = text.slice(block[0].length);

  const m = QUALIFIED.exec(text);
  if (!m) return null;
  const classPart = m[1] ?? m[2];
  const selector = m[3].trim();
  const isMeta = /\s+class$/.test(classPart);
  return {
    className: isMeta ? classPart.replace(/\s+class$/, '') : classPart,
    isMeta,
    selector,
    inBlock: block !== null,
  };
}
