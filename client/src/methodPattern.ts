/**
 * Reading a Smalltalk method's selector out of its message pattern.
 *
 * A leaf module on purpose: the System Browser, the code-lens provider and the undo
 * recorder in the file-system provider all need this, and the file-system provider and
 * the System Browser already import each other's URI helpers. Leaving it in
 * `systemBrowser.ts` would have closed that loop into an import cycle.
 */

/**
 * Extract the Smalltalk selector from a message pattern (first line of a method).
 *
 *   "name"                   → "name"       (unary)
 *   "+ anObject"             → "+"          (binary)
 *   "at: index put: value"  → "at:put:"    (keyword)
 */
export function extractSelector(messagePattern: string): string {
  const trimmed = messagePattern.trim();
  if (!trimmed) return '';

  // Keyword messages: one or more word: pairs
  const keywords = trimmed.match(/\b([a-zA-Z_]\w*:)/g);
  if (keywords && keywords.length > 0) return keywords.join('');

  // Binary messages: start with special characters
  const binaryMatch = trimmed.match(/^([~!@%&*\-+=|\\<>,?/]+)/);
  if (binaryMatch) return binaryMatch[1];

  // Unary: just the first word
  const unaryMatch = trimmed.match(/^(\w+)/);
  if (unaryMatch) return unaryMatch[1];

  return trimmed;
}
