import { QueryExecutor } from '../types';
import { escapeString } from '../util';

// Where a difference lives, from the user's "my image vs disk" viewpoint.
// Rowan's patch is computed base=disk → target=image, so an addition is
// something only the image has, and a removal is something only disk has.
export type RowanDiffLocation = 'image' | 'disk' | 'changed';

export interface RowanDiffOp {
  location: RowanDiffLocation;
  package: string;
  // The affected class or method, e.g. "STONReader" or "STONReader>>next".
  target: string;
}

export interface RowanDiff {
  // false when Rowan is absent or the diff couldn't be computed (see `error`).
  ok: boolean;
  error: string;
  operations: RowanDiffOp[];
}

const NO_ROWAN = '!NO_ROWAN';
const ERR_PREFIX = '!ERR ';

// Compute the difference between a loaded project's image state and its on-disk
// repository (read-only — no SystemUser needed). Each operation is emitted as
// `<code>\t<package>\t<targetPrintString>`, code I(mage-only) / D(isk-only) /
// M(odified).
export function diffRowanProject(execute: QueryExecutor, projectName: string): RowanDiff {
  const code = `| r ws patches |
r := System myUserProfile symbolList objectNamed: #'Rowan'.
r isNil ifTrue: [^'${NO_ROWAN}'].
patches := [r projectTools diff patchesForProjectNamed: '${escapeString(projectName)}']
  on: Error do: [:e | ^'${ERR_PREFIX}' , e messageText].
ws := WriteStream on: Unicode7 new.
patches do: [:assoc | | pkg |
  pkg := assoc key.
  assoc value operations do: [:op | | c |
    c := op class name = 'CypressAddition'
      ifTrue: ['I']
      ifFalse: [op class name = 'CypressRemoval' ifTrue: ['D'] ifFalse: ['M']].
    ws nextPutAll: c; tab; nextPutAll: pkg asString; tab;
       nextPutAll: ([op definition printString] on: Error do: [:e | '?']); lf]].
ws contents`;

  const raw = execute(code);
  const trimmed = raw.trimStart();
  if (trimmed.startsWith(NO_ROWAN))
    return { ok: false, error: 'Rowan is not installed in this image.', operations: [] };
  if (trimmed.startsWith(ERR_PREFIX))
    return { ok: false, error: raw.trim().slice(ERR_PREFIX.length), operations: [] };

  const operations: RowanDiffOp[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const location: RowanDiffLocation =
      parts[0] === 'I' ? 'image' : parts[0] === 'D' ? 'disk' : 'changed';
    operations.push({ location, package: parts[1], target: cleanTarget(parts[2]) });
  }
  return { ok: true, error: '', operations };
}

// Pull the class/method out of a definition printString like
// "a RwCypressMethodDefinition(STONReader>>next)" → "STONReader>>next".
function cleanTarget(printString: string): string {
  const m = printString.match(/\(([^()]*)\)\s*$/);
  return (m ? m[1] : printString).trim();
}

const LABEL: Record<RowanDiffLocation, string> = {
  image: '+ only in image',
  disk: '− only on disk',
  changed: '~ changed',
};

// Render a diff as a readable plain-text report, grouped by package.
export function formatRowanDiff(projectName: string, diff: RowanDiff): string {
  const header = `Rowan diff — ${projectName}  (image vs disk)`;
  if (!diff.ok) return `${header}\n\n${diff.error}\n`;
  if (diff.operations.length === 0)
    return `${header}\n\nNo differences — the image matches the on-disk source.\n`;

  const byPackage = new Map<string, RowanDiffOp[]>();
  for (const op of diff.operations) {
    const list = byPackage.get(op.package);
    if (list) list.push(op);
    else byPackage.set(op.package, [op]);
  }

  const lines = [
    header,
    '',
    `${diff.operations.length} difference(s) across ${byPackage.size} package(s).`,
  ];
  for (const pkg of [...byPackage.keys()].sort()) {
    lines.push('', pkg);
    const ops = byPackage
      .get(pkg)!
      .slice()
      .sort((a, b) => a.location.localeCompare(b.location) || a.target.localeCompare(b.target));
    for (const op of ops) lines.push(`  ${LABEL[op.location]}:  ${op.target}`);
  }
  return lines.join('\n') + '\n';
}
