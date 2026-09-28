import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { __setConfig, CancellationTokenSource } from '../../__mocks__/vscode';
import { GemStoneVersion } from '../../sysadminTypes';

// Shared by the unpack tests: a temp GemStone root holding a small archive,
// fake commands put first on PATH, and a teardown that leaves nothing behind —
// no unpack still running, no child still alive, no files, PATH as it was.

export const VERSION = '3.7.5';

export function which(cmd: string): string | undefined {
  try {
    return execFileSync('which', [cmd], { encoding: 'utf-8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export interface ExtractFixture {
  tmpDir: string;
  rootPath: string;
  binDir: string;
  productDir: string;
  archivePath: string;
  version: GemStoneVersion;
  /** Unpacks started by the test, so teardown can cancel and wait for any still running. */
  inFlight: Array<{ done: Promise<unknown>; cancel: () => void }>;
  savedPath: string | undefined;
}

export function makeFixture(platformSuffix: string, ext: 'zip' | 'dmg'): ExtractFixture {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-extract-'));
  const rootPath = path.join(tmpDir, 'root');
  const binDir = path.join(tmpDir, 'bin');
  fs.mkdirSync(rootPath);
  fs.mkdirSync(binDir);
  __setConfig('gemstone', 'rootPath', rootPath);
  const productDir = path.join(rootPath, `GemStone64Bit${VERSION}${platformSuffix}`);
  const archivePath = `${productDir}.${ext}`;
  const savedPath = process.env.PATH;
  process.env.PATH = `${binDir}:${savedPath}`;
  return {
    tmpDir,
    rootPath,
    binDir,
    productDir,
    archivePath,
    version: {
      version: VERSION,
      fileName: path.basename(archivePath),
      url: '',
      size: 0,
      date: '',
      downloaded: true,
      extracted: false,
    },
    inFlight: [],
    savedPath,
  };
}

/** A few files shaped like a product tree: an executable, a read-only file and directory, a space. */
function buildTree(f: ExtractFixture): string {
  const src = path.join(f.tmpDir, 'src');
  fs.rmSync(src, { recursive: true, force: true });
  const top = path.join(src, path.basename(f.productDir));
  fs.mkdirSync(path.join(top, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(top, 'doc'));
  fs.writeFileSync(path.join(top, 'bin', 'gem'), '#!/bin/sh\n');
  fs.chmodSync(path.join(top, 'bin', 'gem'), 0o755);
  fs.writeFileSync(path.join(top, 'doc', 'read me.txt'), 'hello');
  fs.chmodSync(path.join(top, 'doc', 'read me.txt'), 0o444);
  return src;
}

/** `comment` goes after the zip's end record, which is where the entry count is read from. */
export function buildZip(f: ExtractFixture, python: string, comment = ''): void {
  const src = buildTree(f);
  execFileSync(
    python,
    [
      '-c',
      'import os,sys,zipfile\n' +
        'with zipfile.ZipFile(sys.argv[1],"w") as z:\n' +
        '  z.comment=sys.argv[3].encode()\n' +
        '  for d,ds,fs in os.walk(sys.argv[2]):\n' +
        '    for n in ds+fs:\n' +
        '      p=os.path.join(d,n); z.write(p,os.path.relpath(p,sys.argv[2]))\n',
      f.archivePath,
      src,
      comment,
    ],
    { stdio: 'ignore' },
  );
}

export function buildDmg(f: ExtractFixture, volume: string): void {
  const src = buildTree(f);
  execFileSync('hdiutil', ['create', '-srcfolder', src, '-volname', volume, '-ov', f.archivePath], {
    stdio: 'ignore',
  });
}

/**
 * Put a shell script named `cmd` first on PATH. It records its pid, so a test
 * can check it was stopped and teardown can stop it if the test did not.
 */
export function fakeCommand(f: ExtractFixture, cmd: string, script: string): void {
  const file = path.join(f.binDir, cmd);
  fs.writeFileSync(file, `#!/bin/sh\necho $$ >> "${f.binDir}/pids"\n${script}\n`);
  fs.chmodSync(file, 0o755);
}

export function fakePids(f: ExtractFixture): number[] {
  const file = path.join(f.binDir, 'pids');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).map(Number);
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Script lines that leave a partly written product tree under DEST, with a read-only corner. */
export function partialTree(dest: string): string {
  return `mkdir -p "${dest}/ro" && echo x > "${dest}/ro/f" && chmod 555 "${dest}/ro"`;
}

/** The mock's token, typed as the real one: the only cast these tests need. */
export function cancelSource(): { token: vscode.CancellationToken; cancel: () => void } {
  const source = new CancellationTokenSource();
  return {
    token: source.token as unknown as vscode.CancellationToken,
    cancel: () => source.cancel(),
  };
}

export function progressLog(): {
  progress: vscode.Progress<{ message?: string; increment?: number }>;
  messages: string[];
  increments: number[];
} {
  const messages: string[] = [];
  const increments: number[] = [];
  return {
    progress: {
      report: (v) => {
        messages.push(v.message ?? '');
        if (v.increment !== undefined) increments.push(v.increment);
      },
    },
    messages,
    increments,
  };
}

export async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 25));
}

export async function tearDown(f: ExtractFixture): Promise<void> {
  for (const run of f.inFlight) run.cancel();
  // Killed before waiting, so even code whose cancel does not work cannot hang
  // teardown on a child that never exits.
  for (const pid of fakePids(f)) if (isAlive(pid)) process.kill(pid, 'SIGKILL');
  await Promise.all(f.inFlight.map((run) => run.done.catch(() => undefined)));
  process.env.PATH = f.savedPath;
  if (fs.existsSync(f.tmpDir)) execFileSync('chmod', ['-R', 'u+w', f.tmpDir]);
  fs.rmSync(f.tmpDir, { recursive: true, force: true });
}
