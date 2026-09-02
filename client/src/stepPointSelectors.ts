import { StepPointSelectorInfo } from './browserQueries';

/**
 * Find the step point whose selector range contains the cursor offset,
 * or failing that the one whose selector start is nearest to the cursor.
 */
export function findNearestStepPoint(
  infos: StepPointSelectorInfo[],
  cursorOffset: number,
): StepPointSelectorInfo | null {
  if (infos.length === 0) return null;

  // First: exact containment — cursor is within a selector token
  for (const info of infos) {
    if (
      cursorOffset >= info.selectorOffset &&
      cursorOffset <= info.selectorOffset + info.selectorLength
    ) {
      return info;
    }
  }

  // Second: nearest by absolute distance to selector midpoint
  let nearest = infos[0];
  let minDist = Math.abs(cursorOffset - (infos[0].selectorOffset + infos[0].selectorLength / 2));
  for (let i = 1; i < infos.length; i++) {
    const mid = infos[i].selectorOffset + infos[i].selectorLength / 2;
    const dist = Math.abs(cursorOffset - mid);
    if (dist < minDist) {
      minDist = dist;
      nearest = infos[i];
    }
  }
  return nearest;
}

function isIdentStart(ch: string): boolean {
  return /[a-zA-Z_]/.test(ch);
}

function isTokenChar(ch: string): boolean {
  return /[a-zA-Z0-9_:]/.test(ch);
}

/**
 * For keyword messages (e.g., `assert:equals:`), the GCI query only returns
 * the first keyword (`assert:`) at the step point offset. This function scans
 * the source text to find continuation keywords (`equals:`) at the same
 * nesting depth and adds them as additional entries with the same step point.
 *
 * The scan runs to the end of the statement, which is the next `.` or `;` *at
 * the top level*. Separators nested inside parentheses or a block belong to an
 * inner expression and are scanned past, since the keyword send continues after
 * the bracket closes.
 */
export function expandKeywordParts(
  source: string,
  infos: StepPointSelectorInfo[],
): StepPointSelectorInfo[] {
  const expanded: StepPointSelectorInfo[] = [];
  for (const info of infos) {
    expanded.push(info);
    if (!info.selectorText.endsWith(':')) continue;

    let pos = info.selectorOffset + info.selectorLength;
    let depth = 0;

    while (pos < source.length && depth >= 0) {
      const ch = source[pos];

      if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
        pos++;
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        if (depth < 0) break;
        pos++;
        continue;
      }
      // A statement or cascade separator ends the keyword message only at the top
      // level. Inside parentheses or a block it belongs to an inner expression —
      // `self foo: (s add: 1; yourself) bar: 2` and `self foo: [a bar. c] qux: 2`
      // are each one keyword send — so stopping there would lose every keyword
      // after it, leaving that part of the send with no step point to hover,
      // number or aim a breakpoint at. Depth-gated to match the identifier scan
      // below, which has always only looked at depth 0.
      if (depth === 0 && (ch === '.' || ch === ';')) break;

      // Skip string literals (handle embedded '' quotes)
      if (ch === "'") {
        pos++;
        while (pos < source.length) {
          if (source[pos] === "'") {
            pos++;
            if (pos >= source.length || source[pos] !== "'") break;
          }
          pos++;
        }
        continue;
      }

      // Skip comments
      if (ch === '"') {
        pos++;
        while (pos < source.length && source[pos] !== '"') pos++;
        if (pos < source.length) pos++;
        continue;
      }

      // Skip symbol literals (#word or #'string')
      if (ch === '#') {
        pos++;
        if (pos < source.length && source[pos] === "'") {
          pos++;
          while (pos < source.length && source[pos] !== "'") pos++;
          if (pos < source.length) pos++;
        } else if (pos < source.length && isIdentStart(source[pos])) {
          while (pos < source.length && isTokenChar(source[pos])) pos++;
        }
        continue;
      }

      // At depth 0, check for continuation keyword
      if (depth === 0 && isIdentStart(ch)) {
        const start = pos;
        pos++;
        while (pos < source.length && isTokenChar(source[pos])) pos++;
        const token = source.substring(start, pos);
        if (token.endsWith(':')) {
          expanded.push({
            stepPoint: info.stepPoint,
            selectorOffset: start,
            selectorLength: token.length,
            selectorText: token,
          });
        }
        continue;
      }

      pos++;
    }
  }
  return expanded;
}
