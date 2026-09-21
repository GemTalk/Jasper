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

// The same species of crash, one type further along: a handler that declares
// its tree item as required (`item: GemStoneSessionItem`) reads `activeSession`
// off `undefined` the moment the Command Palette runs it with no argument —
// which is what GemStone: Commit and GemStone: Abort did
// (https://github.com/GemTalk/Jasper/issues/455). Declaring the parameter
// optional is what makes the compiler insist on a fallback for the palette
// case, so pin that here.
describe('tree-item command handlers accept being invoked without an item', () => {
  const extensionPath = path.resolve(__dirname, '..', 'extension.ts');
  const source = fs.readFileSync(extensionPath, 'utf-8');

  it('never declares a required GemStoneSessionItem in a command callback', () => {
    // Scoped to a callback's parameter list — `(item: GemStoneSessionItem)`. A
    // plain function that legitimately REQUIRES a session item is not what this
    // guards: it is reached from code that has one, not from a palette entry
    // that has nothing, and telling it to make its parameter optional would be
    // wrong advice.
    //
    // Scanned over the WHOLE source rather than line by line, because a
    // parameter list that Prettier has wrapped puts the `(` and the parameter on
    // different lines — and a guard that a line break walks past is no guard.
    // `\s` spans newlines, so the same shape is matched either way; the match
    // index is turned back into a line number for the failure message.
    const lineOf = (index: number) => source.slice(0, index).split('\n').length;
    const required = [...source.matchAll(/\(\s*item:\s*GemStoneSessionItem\b/g)].map((m) => ({
      line: lineOf(m.index),
      text: source
        .slice(m.index, m.index + 80)
        .split('\n')
        .map((l) => l.trim())
        .join(' '),
    }));

    expect(
      required,
      'a command callback cannot require its tree item: the Command Palette invokes it ' +
        `with none. Declare these \`item?: GemStoneSessionItem\`:\n${JSON.stringify(required, null, 2)}`,
    ).toEqual([]);
  });

  // The guard above is load-bearing — there is no activation harness, so this
  // scan is the only thing standing between a required tree item and the crash
  // https://github.com/GemTalk/Jasper/issues/455 reported. Prove it still sees
  // the wrapped form, rather than trusting that Prettier will never produce one.
  it('catches a required item even when the parameter list is wrapped', () => {
    const wrapped = [
      "vscode.commands.registerCommand('gemstone.sessionCommit', async (",
      '  item: GemStoneSessionItem,',
      ") => sessionTransactionCommand(deps, 'Commit', item));",
    ].join('\n');

    expect(/\(\s*item:\s*GemStoneSessionItem\b/.test(wrapped)).toBe(true);
  });
});
