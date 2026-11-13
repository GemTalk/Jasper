import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { ExtractFixture, buildDmg, fakeCommand, makeFixture, tearDown } from './extractFixture';

const product = 'GemStone64Bit3.7.5-arm64.Darwin';
let f: ExtractFixture;

describe.runIf(process.platform === 'darwin')(
  'Building the unpack tests’ disk image',
  { timeout: 30_000 },
  () => {
    beforeEach(() => {
      f = makeFixture('-arm64.Darwin', 'dmg');
    });

    afterEach(async () => {
      await tearDown(f);
    });

    it('tries again, over what it left, when creating the image fails once', () => {
      // The image path is hdiutil's last argument.
      fakeCommand(
        f,
        'hdiutil',
        `if [ ! -f "${f.tmpDir}/failed" ]; then touch "${f.tmpDir}/failed"\n` +
          '  for a; do last="$a"; done; echo junk > "$last"\n' +
          '  echo "hdiutil: create failed - Resource busy" >&2; exit 1\n' +
          'fi\nexec /usr/bin/hdiutil "$@"',
      );

      const image = buildDmg(f.tmpDir, product, `JasperRetry${process.pid}${Date.now()}`);

      expect(fs.existsSync(path.join(f.tmpDir, 'failed'))).toBe(true);
      expect(fs.readFileSync(image, 'utf8')).not.toBe('junk\n');
    });

    it('fails with hdiutil’s words from both attempts when creating the image fails twice', () => {
      fakeCommand(
        f,
        'hdiutil',
        `if [ ! -f "${f.tmpDir}/failed" ]; then touch "${f.tmpDir}/failed"\n` +
          '  echo "hdiutil: create failed - Resource busy" >&2; exit 1\n' +
          'fi\necho "hdiutil: create failed - No space left on device" >&2; exit 1',
      );

      expect(() => buildDmg(f.tmpDir, product, 'JasperRetry')).toThrow(
        /Resource busy[\s\S]*No space left on device/,
      );
    });
  },
);
