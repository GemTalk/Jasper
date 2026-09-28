import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { withTemporaryFolderDo } from '../../__tests__/support/file';
import { onSupportedPosixDescribe } from '../../__tests__/platformGates';

// The payload transform script is run by hand when the vendored payload is refreshed, so
// nothing else exercises it — and it once broke silently on macOS, where BSD sed reads
// `sed -i`'s next argument as a backup suffix (#429). Running it over the committed
// payload on every CI platform is what keeps it portable: the committed files are already
// transformed, so a correct run changes nothing.

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = path.join(
  REPO,
  'gs-src',
  'enhancedInspector',
  'build',
  'apply_jasper_transforms.sh',
);
const PAYLOAD = path.join(REPO, 'resources', 'enhancedInspector');
const payloadFiles = (): string[] => fs.readdirSync(PAYLOAD).filter((f) => f.endsWith('.gs'));

function copyPayload(dir: string): void {
  for (const f of payloadFiles()) {
    fs.copyFileSync(path.join(PAYLOAD, f), path.join(dir, f));
    fs.chmodSync(path.join(dir, f), 0o644);
  }
}

const run = (dir: string) => spawnSync('bash', [SCRIPT, dir], { encoding: 'utf8' });

onSupportedPosixDescribe('apply_jasper_transforms.sh', () => {
  it('leaves the committed payload byte-for-byte unchanged', () => {
    withTemporaryFolderDo((dir) => {
      copyPayload(dir);

      const result = run(dir);

      expect(result.status, result.stderr).toBe(0);
      expect(fs.readdirSync(dir).sort()).toEqual(payloadFiles().sort());
      for (const f of payloadFiles()) {
        expect(fs.readFileSync(path.join(dir, f), 'utf8'), f).toBe(
          fs.readFileSync(path.join(PAYLOAD, f), 'utf8'),
        );
      }
    });
  });

  // mktemp creates 0600 files; moving one into place would hide the payload from a gem
  // running as another OS user.
  it('keeps each file readable by others', () => {
    withTemporaryFolderDo((dir) => {
      copyPayload(dir);

      run(dir);

      for (const f of payloadFiles()) {
        expect(fs.statSync(path.join(dir, f)).mode & 0o777, f).toBe(0o644);
      }
    });
  });

  it('retargets upstream Globals placement to GsEnhancedInspector', () => {
    withTemporaryFolderDo((dir) => {
      copyPayload(dir);
      const file = path.join(dir, 'STON.gs');
      const committed = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(
        file,
        committed.replaceAll('inDictionary: GsEnhancedInspector', 'inDictionary: Globals'),
      );

      const result = run(dir);

      expect(result.status, result.stderr).toBe(0);
      expect(fs.readFileSync(file, 'utf8')).toBe(committed);
    });
  });
});
