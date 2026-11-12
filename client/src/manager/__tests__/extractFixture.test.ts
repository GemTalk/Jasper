import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { buildDmg } from './extractFixture';

const product = 'GemStone64Bit3.7.5-arm64.Darwin';
const savedPath = process.env.PATH;
let dir: string;

function fakeHdiutil(script: string): void {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'hdiutil'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
}

describe.runIf(process.platform === 'darwin')(
  'Building the unpack tests’ disk image',
  { timeout: 30_000 },
  () => {
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-builddmg-'));
    });

    afterEach(() => {
      process.env.PATH = savedPath;
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('tries again, over what it left, when creating the image fails once', () => {
      // The image path is hdiutil's last argument.
      fakeHdiutil(
        `if [ ! -f "${dir}/failed" ]; then touch "${dir}/failed"\n` +
          '  for a; do last="$a"; done; echo junk > "$last"\n' +
          '  echo "hdiutil: create failed - Resource busy" >&2; exit 1\n' +
          'fi\nexec /usr/bin/hdiutil "$@"',
      );

      const image = buildDmg(dir, product, `JasperRetry${process.pid}${Date.now()}`);

      expect(fs.existsSync(path.join(dir, 'failed'))).toBe(true);
      expect(fs.readFileSync(image, 'utf8')).not.toBe('junk\n');
    });

    it('fails with hdiutil’s own words when creating the image fails twice', () => {
      fakeHdiutil('echo "hdiutil: create failed - Resource busy" >&2; exit 1');

      expect(() => buildDmg(dir, product, 'JasperRetry')).toThrow(/create failed - Resource busy/);
    });
  },
);
