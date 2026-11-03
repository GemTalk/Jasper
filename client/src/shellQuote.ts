/** Wrap a value in single quotes, escaping any single quotes it contains,
 *  so it survives verbatim through a POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
