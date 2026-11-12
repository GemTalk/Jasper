import { defineConfig } from 'vitest/config';
import { BaseSequencer } from 'vitest/node';

// Every project shuffles test order (sequence.shuffle) to surface hidden
// order-dependencies. To keep a shuffled failure reproducible, we pick ONE seed
// here — in the main config, before any worker spawns — and pin it into every
// project so every worker shuffles identically. The seed is printed on each
// run; re-run with `VITEST_SEED=<seed>` (e.g. in CI) to replay that exact order.
const shuffleSeed = process.env.VITEST_SEED ? Number(process.env.VITEST_SEED) : Date.now();
console.log(
  `vitest: shuffling test order with seed ${shuffleSeed} — re-run with VITEST_SEED=${shuffleSeed} to reproduce this order`,
);
// Every project uses this, so a new project can't leave the seed out.
const projectSequence = { shuffle: true, seed: shuffleSeed };

// Small seeded PRNG (mulberry32) for a deterministic file shuffle.
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// vitest's built-in RandomSequencer shuffles the file list in whatever order it
// was discovered, and that discovery order isn't stable across runs — so the
// same seed can still yield a different FILE order. This sequencer first sorts
// specs into a stable order (by module path), THEN applies a seed-driven
// Fisher-Yates, so a run's file order is fully reproducible from its seed. This
// matters for the gci suite, which runs serially (fileParallelism: false)
// against one live stone, where cross-file order can expose isolation bugs.
class SeededSequencer extends BaseSequencer {
  async sort(files: Parameters<BaseSequencer['sort']>[0]) {
    const stable = [...files].sort((a, b) =>
      a.moduleId < b.moduleId ? -1 : a.moduleId > b.moduleId ? 1 : 0,
    );
    const rand = mulberry32(this.ctx.config.sequence.seed ?? 0);
    for (let i = stable.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [stable[i], stable[j]] = [stable[j], stable[i]];
    }
    return stable;
  }
}

// Three projects so the VS Code Testing panel discovers every tier from a single
// config (no second config file, which the extension would also auto-detect and
// double-count):
//   - 'default' : the default suite (unit tests + the automatic GCI test that
//              uses useIntegrationTest). `npm test` runs this and 'supply-chain'.
//   - 'supply-chain' : lintSupplyChain.test.ts, which needs no stone and behaves
//              the same on every OS and GemStone version. health-check.yml runs
//              it once in the Linux lint job and sets JASPER_SKIP_SUPPLY_CHAIN_TEST
//              on the matrix legs, which leaves the project out. Locally it
//              stays in `npm test`.
//   - 'gci'  : the on-demand GCI suite (src/__tests__/gci/**). It shows up in the
//              panel and can be run interactively, but is deliberately kept OUT
//              of `npm test` (the "test" script pins --project default and
//              --project supply-chain). Run it with
//              `npm run test:gci` (which pins --project gci).
export default defineConfig({
  test: {
    // File ordering is decided once, globally, by the root sequencer (vitest
    // reads sequence.sequencer/seed from the root config, not per-project), so
    // the seeded file shuffle lives here. Per-project sequence blocks below
    // still drive the within-file test shuffle.
    sequence: {
      shuffle: true,
      seed: shuffleSeed,
      sequencer: SeededSequencer,
    },
    // CI sets VITEST_JSON_OUTPUT (an absolute path — workspaces run in their
    // own cwd, so a relative outputFile resolved against the config dir would
    // be fragile) to also emit a machine-readable JSON report alongside the
    // normal console output, which health-check.yml's report-skips job
    // aggregates across matrix cells to find tests skipped everywhere, and
    // report-retried-tests.mjs reads. Local `npm test` leaves this unset, so
    // its output is unchanged (the key must be omitted, not set to undefined —
    // vitest requires `reporters` to be iterable when the key is present at
    // all).
    ...(process.env.VITEST_JSON_OUTPUT
      ? {
          reporters: [
            ['default'],
            ['json', { outputFile: process.env.VITEST_JSON_OUTPUT }],
          ] as const,
        }
      : {}),
    projects: [
      {
        test: {
          name: 'default',
          include: ['src/**/__tests__/**/*.test.ts'],
          exclude: ['src/__tests__/gci/**', 'src/__tests__/lintSupplyChain.test.ts'],
          globalSetup: [
            'src/__tests__/gciTraceLogs.globalSetup.ts',
            // Before the gate: the check's own login would count as one no file reported.
            'src/__tests__/serverPluginMatch.globalSetup.ts',
            'src/__tests__/sessionGate.globalSetup.ts',
          ],
          setupFiles: [
            'src/__tests__/vitest.windowSetup.cjs',
            'src/__tests__/vitest.uriSetup.ts',
            'src/__tests__/vitest.customErrorMatchers.ts',
            'src/__tests__/vitest.telemetrySetup.ts',
          ],
          sequence: projectSequence,
          // health-check.yml sets VITEST_RETRY=1 in the merge queue only.
          retry: Number(process.env.VITEST_RETRY ?? 0),
        },
      },
      ...(process.env.JASPER_SKIP_SUPPLY_CHAIN_TEST === '1'
        ? []
        : [
            {
              test: {
                name: 'supply-chain',
                include: ['src/__tests__/lintSupplyChain.test.ts'],
                sequence: projectSequence,
              },
            },
          ]),
      {
        test: {
          name: 'gci',
          include: ['src/__tests__/gci/**/*.test.ts'],
          setupFiles: ['src/__tests__/vitest.telemetrySetup.ts'],
          maxConcurrency: 5,
          fileParallelism: false,
          sequence: projectSequence,
        },
      },
    ],
  },
});
