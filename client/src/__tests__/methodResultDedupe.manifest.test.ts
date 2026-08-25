import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * A method row is identified by class, side, selector AND environment: the same selector
 * implemented on the same class in two environments is two different methods. Folding them
 * together under-reports the results and leaves one of them unreachable from the list.
 *
 * Every command that sweeps environments runs one query per environment and folds the rounds
 * into one list — Senders, Implementors, hierarchy implementors, References, the method-source
 * search, and the safe-delete reference scans. Each of them used to hand-roll that fold on
 * class/side/selector alone, so each was one edit away from the same bug, and the ones in
 * extension.ts are inside registered command handlers that no unit test can reach without
 * standing up the whole extension. They all call the shared `dedupeMethodResults` now.
 *
 * This scans the source to keep it that way: what it guards is not any single call site but
 * the absence of a second, private copy of the rule. The behaviour of the helper itself is
 * covered in queries/__tests__/methodSearch.test.ts.
 */
describe('folding scan results is done in exactly one place', () => {
  const srcRoot = path.resolve(__dirname, '..');

  const sourceFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === 'node_modules' || entry.name === '__tests__' ? [] : sourceFiles(full);
      }
      return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
    });

  // These fold the same selector across environments into ONE row on purpose, keeping the
  // lowest-environment copy and carrying its environment into the action so it still acts
  // where it was found. Both are a chooser showing one row per thing you can go to — GemStone
  // Search's palette, and the class picker a named breakpoint raises — not a reference list
  // that has to account for every method. A different contract from the commands below,
  // deliberate, and explained at each call site.
  const DELIBERATE_SINGLE_ROW_PER_SELECTOR = [
    'omniSearch/omniSearchCommand.ts',
    'functionBreakpoints.ts',
  ];

  it('has no dedup key that leaves the environment out', () => {
    // The shape the hand-rolled copies used: a template key over the row's class, side and
    // selector with no environment. Written as a pattern rather than a literal so a copy that
    // reorders or renames the parts is still caught.
    const blindKey = /`\$\{\w+\.className\}\|\$\{\w+\.isMeta\}\|\$\{\w+\.selector\}`/;

    const offenders = sourceFiles(srcRoot)
      .map((file) => ({ file, source: fs.readFileSync(file, 'utf-8') }))
      .flatMap(({ file, source }) =>
        source
          .split('\n')
          .map((text, i) => ({
            file: path.relative(srcRoot, file),
            line: i + 1,
            text: text.trim(),
          }))
          .filter(({ text }) => blindKey.test(text)),
      )
      .filter(({ file }) => !DELIBERATE_SINGLE_ROW_PER_SELECTOR.includes(file.replace(/\\/g, '/')));

    expect(
      offenders,
      `dedup keys missing the environment:\n${JSON.stringify(offenders, null, 2)}`,
    ).toEqual([]);
  });

  it('routes every environment-sweeping command through the shared helper', () => {
    const extensionSource = fs.readFileSync(path.join(srcRoot, 'extension.ts'), 'utf-8');
    const calls = extensionSource.match(/dedupeMethodResults\(/g) ?? [];

    // Senders of / Implementors of, both from a selector argument and from the editor
    // selection, plus hierarchy implementors and References to an object.
    expect(calls).toHaveLength(6);
  });
});
