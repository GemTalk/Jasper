/**
 * Parses a Tonel format file (.st) into a sequence of regions.
 *
 * A Tonel file consists of:
 *   - An optional leading comment ("...")
 *   - A file header: Class { ... }, Extension { ... }, or Package { ... }
 *   - Zero or more method definitions, each preceded by { #category : '...' }
 *
 * Method definitions use the form:
 *   ClassName >> selector [
 *     body
 *   ]
 * or for class-side:
 *   ClassName class >> selector [
 *     body
 *   ]
 */

import { TopazRegion } from '../topaz/topazParser';

export interface TonelHeader {
  type: 'Class' | 'Extension' | 'Package';
  name: string;
  superclass?: string;
  instVars?: string[];
  classVars?: string[];
  category?: string;
  startLine: number;
  endLine: number;
}

export function parseTonelDocument(text: string): TopazRegion[] {
  const lines = text.split('\n');
  const regions: TopazRegion[] = [];
  let i = 0;

  // Skip optional leading comment ("...")
  if (i < lines.length) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith('"')) {
      // Check if the comment closes on the same line
      const afterQuote = trimmed.slice(1);
      if (afterQuote.includes('"')) {
        i++;
      } else {
        i++;
        while (i < lines.length && !lines[i].includes('"')) {
          i++;
        }
        if (i < lines.length) i++; // skip closing quote line
      }
      // Skip blank lines after comment
      while (i < lines.length && lines[i].trim() === '') i++;
    }
  }

  // Parse file header: Class { ... }, Extension { ... }, or Package { ... }
  const headerMatch = i < lines.length ? lines[i].match(/^(Class|Extension|Package)\s*\{/) : null;

  let headerClassName: string | undefined;

  if (headerMatch) {
    const headerStartLine = i;

    // Find closing } — it could be on the same line or on a later line
    let headerEndLine = i;
    let braceDepth = 0;
    for (let h = i; h < lines.length; h++) {
      for (const ch of lines[h]) {
        if (ch === '{') braceDepth++;
        if (ch === '}') {
          braceDepth--;
          if (braceDepth === 0) {
            headerEndLine = h;
            break;
          }
        }
      }
      if (braceDepth === 0) break;
    }

    // Extract header content for metadata
    const headerLines = lines.slice(headerStartLine, headerEndLine + 1);
    const headerText = headerLines.join('\n');
    headerClassName = extractSTONValue(headerText, 'name');

    regions.push({
      kind: 'tonel-header',
      startLine: headerStartLine,
      endLine: headerEndLine,
      text: headerText,
      className: headerClassName,
    });

    i = headerEndLine + 1;
  }

  // Parse methods
  while (i < lines.length) {
    // Skip blank lines
    if (lines[i].trim() === '') {
      i++;
      continue;
    }

    // Look for method annotation: { #category : '...' }
    let annotationStartLine: number | undefined;
    const annotTrimmed = lines[i].trimStart();
    if (annotTrimmed.startsWith('{') && !annotTrimmed.match(/^(Class|Extension|Package)\s*\{/)) {
      annotationStartLine = i;
      // Find closing }
      let braceDepth = 0;
      for (let a = i; a < lines.length; a++) {
        for (const ch of lines[a]) {
          if (ch === '{') braceDepth++;
          if (ch === '}') {
            braceDepth--;
            if (braceDepth === 0) {
              i = a + 1;
              break;
            }
          }
        }
        if (braceDepth === 0) break;
      }
      // Skip blank lines after annotation
      while (i < lines.length && lines[i].trim() === '') i++;
    }

    if (i >= lines.length) break;

    // Look for method signature: ClassName [class] >> selectorPattern [
    const sigMatch = parseMethodSignature(lines[i]);
    if (!sigMatch) {
      // Not a method signature — skip this line
      i++;
      continue;
    }

    const signatureLine = i;
    const {
      className: sigClassName,
      isClassSide,
      selectorPattern,
      selectorColumnOffset,
    } = sigMatch;
    const className = sigClassName || headerClassName;

    // Find the matching ] via bracket counting
    const closingLine = findMethodEnd(lines, signatureLine);

    // Extract body text (lines between [ and ])
    const bodyLines = lines.slice(signatureLine + 1, closingLine);
    const methodText = selectorPattern + '\n' + bodyLines.join('\n');

    // endLine is the last line of the method body (before ])
    const endLine = closingLine > signatureLine + 1 ? closingLine - 1 : signatureLine;

    regions.push({
      kind: 'smalltalk-method',
      startLine: signatureLine,
      endLine,
      text: methodText,
      className,
      command: isClassSide ? 'classmethod' : 'method',
      annotationStartLine,
      closingBracketLine: closingLine,
      selectorColumnOffset,
    });

    i = closingLine + 1;
  }

  return regions;
}

/**
 * Parse a Tonel method signature line.
 * Matches: ClassName >> selector [
 *          ClassName class >> selector [
 */
function parseMethodSignature(line: string): {
  className: string;
  isClassSide: boolean;
  selectorPattern: string;
  selectorColumnOffset: number;
} | null {
  // Match: ClassName [class] >> selectorPattern [
  const match = line.match(/^(\w+)(\s+class)?\s*>>\s*(.+?)\s*\[\s*$/);
  if (!match) return null;

  const selectorPattern = match[3].trim();
  // Calculate the column where selectorPattern begins in the original line.
  // This is needed so that semantic tokens on the selector line get correct document columns.
  const prefixLen = match[1].length + (match[2] ?? '').length;
  const selectorColumnOffset = line.indexOf(selectorPattern, prefixLen);

  return {
    className: match[1],
    isClassSide: !!match[2],
    selectorPattern,
    selectorColumnOffset: selectorColumnOffset >= 0 ? selectorColumnOffset : 0,
  };
}

/**
 * Find the line of the closing ] that ends a method body.
 * Uses bracket counting, respecting strings ('...'), comments ("...") and
 * character literals ($x) — the character after a $ is data, never a
 * delimiter, so $' does not open a string and $[ does not open a block.
 */
function findMethodEnd(lines: string[], openLine: number): number {
  let depth = 0;
  let inString = false;
  let inComment = false;

  for (let i = openLine; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];

      if (inString) {
        if (ch === "'") {
          // Check for escaped quote ''
          if (j + 1 < line.length && line[j + 1] === "'") {
            j++; // skip escaped quote
          } else {
            inString = false;
          }
        }
        continue;
      }

      if (inComment) {
        if (ch === '"') {
          inComment = false;
        }
        continue;
      }

      if (ch === '$') {
        j++; // the character literal's value, whatever it is
        continue;
      }

      if (ch === "'") {
        inString = true;
        continue;
      }

      if (ch === '"') {
        inComment = true;
        continue;
      }

      if (ch === '[') {
        depth++;
      } else if (ch === ']') {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }
  }

  // Unclosed bracket — return last line
  return lines.length - 1;
}

/**
 * Extract a value from STON-like text for a given key.
 * e.g., extractSTONValue(text, 'name') for "#name : 'Foo'" returns 'Foo'
 */
function extractSTONValue(text: string, key: string): string | undefined {
  const regex = new RegExp(`#${key}\\s*:\\s*'([^']*)'`);
  const match = text.match(regex);
  return match ? match[1] : undefined;
}
