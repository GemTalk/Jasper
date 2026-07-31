import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// VS Code passes command arguments as `any`, so TypeScript can't catch the
// case where a tree-view command is invoked from the Command Palette with
// `undefined`. Commands that read `node.kind` without a guard crash with
// "Cannot read properties of undefined (reading 'kind')" — which is what
// https://github.com/GemTalk/Jasper (gemstone.stopStone) hit in 1.3.2.
//
// Every handler must guard with either `!node ||` or optional chaining
// (`node?.kind`). This test scans extension.ts to keep it that way.

describe('extension command handlers guard against undefined node', () => {
  const extensionPath = path.resolve(__dirname, '..', 'extension.ts');
  const source = fs.readFileSync(extensionPath, 'utf-8');

  it('never reads `node.kind` without a ? or an explicit !node check', () => {
    const lines = source.split('\n');
    const unguarded: { line: number; text: string }[] = [];
    lines.forEach((text, i) => {
      // Match `node.kind` but not `node?.kind`. The look-behind keeps
      // matches on `!node || node.kind` out of the offender list, since the
      // `!node ||` prefix already shields the read.
      if (/(?<!\?)\bnode\.kind\b/.test(text) && !/!node\s*\|\|/.test(text)) {
        unguarded.push({ line: i + 1, text: text.trim() });
      }
    });
    expect(unguarded, `unguarded node.kind reads:\n${JSON.stringify(unguarded, null, 2)}`).toEqual(
      [],
    );
  });
});
