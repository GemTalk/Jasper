#!/usr/bin/env node
//
// Asserts that the `tsc` on PATH is TypeScript 7.
//
// Two installed packages claim the `tsc` bin: `@typescript/native` (TS 7, the
// compiler every compile:* script and `watch` call) and `@typescript/old` (the
// real typescript@6, hoisted to top level as a dependency of the
// `@typescript/typescript6` alias that typescript-eslint reads). npm resolves
// the collision in favour of the direct dependency, but nothing declares that,
// and the failure mode is silent: all four projects type-check clean on TS 6,
// so a reshuffle would downgrade the whole build with a green CI run and no
// output difference. See docs/how-to/raising-the-version-floor.md.
import { execFileSync } from 'node:child_process';

const out = execFileSync('tsc', ['--version'], { encoding: 'utf8' }).trim();
if (/Version (\d+)\./.exec(out)?.[1] !== '7') {
  console.error(
    `tsc is "${out}" — expected TypeScript 7.\n` +
      'node_modules/.bin/tsc has been linked to the TS 6 package. Reinstall, ' +
      'or point the compile scripts at @typescript/native explicitly.',
  );
  process.exit(1);
}
console.log(`tsc is ${out} — OK`);
