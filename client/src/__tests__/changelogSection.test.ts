import { it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withTemporaryFolderDo } from './support/file';
import { onSupportedPosixDescribe } from './platformGates';

// Tests for scripts/changelog-section.sh — the text that becomes a GitHub Release's notes,
// and (since it also runs as a guard in the workflow's `package` job) the thing that decides
// whether a release starts at all.
//
// The guard is the reason these matter. `validate` makes a cheaper pre-check over the API
// that only requires a dated heading to exist, so the two are not the same test: a section
// that is dated but empty passes validate and fails here. That gap used to open up one step
// AFTER the tag was created; the guard closes it, and these pin the behaviour the guard is
// relying on.
//
// Black-box, like lintSupplyChain.test.ts and publishToRegistry.test.ts. POSIX-only: the
// release workflow runs on ubuntu-latest.
//
// __dirname is client/src/__tests__, so the repo root is three levels up.
const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'changelog-section.sh');

function run(changelog: string, version = '1.9.1') {
  return withTemporaryFolderDo((dir) => {
    const changelogPath = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(changelogPath, changelog);

    const result = spawnSync('bash', [SCRIPT, version], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, CHANGELOG_PATH: changelogPath },
    });

    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  });
}

const RELEASED = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '## [1.9.1] - 2026-09-11',
  '',
  '### Added',
  '',
  '- The thing this release adds.',
  '',
  '## [1.9.0] - 2026-09-10',
  '',
  '### Fixed',
  '',
  '- An older fix that must not leak into the notes.',
  '',
].join('\n');

onSupportedPosixDescribe('changelog-section.sh', () => {
  it('prints the body of the requested version and stops at the next heading', () => {
    const { status, stdout } = run(RELEASED);

    expect(status).toBe(0);
    expect(stdout).toContain('- The thing this release adds.');
    expect(stdout).not.toContain('An older fix');
    expect(stdout).not.toContain('## [1.9.0]');
  });

  // The case the `package` guard exists for: `validate`'s grep is satisfied by the heading
  // alone, so without this check a dated-but-empty section reached `release` and failed on
  // the step straight after the tag was created — the one failure the docs' table says has
  // to be cleaned up by hand.
  it('fails on a dated section with nothing under it', () => {
    const { status, stderr } = run(
      [
        '# Changelog',
        '',
        '## [1.9.1] - 2026-09-11',
        '',
        '## [1.9.0] - 2026-09-10',
        '',
        '- Old.',
        '',
      ].join('\n'),
    );

    expect(status).toBe(1);
    expect(stderr).toContain("no dated '## [1.9.1] - <date>' section");
  });

  // An entry still sitting under [Unreleased] means the changelog was never promoted, and
  // publishing it would ship a version whose own changelog calls it unreleased.
  it('fails when the version was never promoted out of [Unreleased]', () => {
    const { status, stderr } = run(
      ['# Changelog', '', '## [Unreleased]', '', '### Added', '', '- Not promoted yet.', ''].join(
        '\n',
      ),
    );

    expect(status).toBe(1);
    expect(stderr).toContain('Promote the [Unreleased] section');
  });

  // The date is what distinguishes a promoted section from [Unreleased], so a bracketed
  // heading with no date must not count as one.
  it('fails on a heading that carries no date', () => {
    const { status } = run(
      ['# Changelog', '', '## [1.9.1]', '', '- Undated, so not released.', ''].join('\n'),
    );

    expect(status).toBe(1);
  });

  it('rejects being called without exactly one version', () => {
    const withoutVersion = withTemporaryFolderDo((dir) =>
      spawnSync('bash', [SCRIPT], { cwd: dir, encoding: 'utf8' }),
    );

    expect(withoutVersion.status).toBe(2);
    expect(withoutVersion.stderr).toContain('usage:');
  });
});
