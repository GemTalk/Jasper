import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../sysadminChannel', () => ({ appendSysadmin: vi.fn(), showSysadmin: vi.fn() }));
vi.mock('../../wslBridge', () => ({
  isWindows: () => false,
  needsWsl: () => false,
  getWslInfo: () => ({ available: false }),
  wslPathToWindows: (p: string) => p,
  windowsPathToWsl: (p: string) => p,
  wslExecSync: vi.fn(),
  wslSpawn: vi.fn(),
}));
// The server is faked; the file the download writes is real.
vi.mock('https', () => ({ get: vi.fn() }));

import * as https from 'https';
import { __resetConfig, __setConfig } from '../../__mocks__/vscode';
import { SysadminStorage } from '../../sysadminStorage';
import { GemStoneVersion } from '../../sysadminTypes';
import { InstallCancelledError, VersionManager } from '../versionManager';
import { cancelSource, until } from './extractFixture';

let tmpDir: string;
let body: PassThrough;
let manager: VersionManager;
let version: GemStoneVersion;

beforeEach(() => {
  __resetConfig();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jasper-download-'));
  __setConfig('gemstone', 'rootPath', tmpDir);
  manager = new VersionManager(new SysadminStorage());
  version = {
    version: '3.7.6',
    fileName: 'GemStone64Bit3.7.6-x86_64.Linux.zip',
    url: 'https://downloads.example/GemStone64Bit3.7.6-x86_64.Linux.zip',
    size: 1000,
    date: '',
    downloaded: false,
    extracted: false,
  };
  // A response that sends what the test writes to it and never ends by itself.
  body = new PassThrough();
  vi.mocked(https.get).mockImplementation(((_url: string, onResponse: (res: unknown) => void) => {
    const request = Object.assign(new EventEmitter(), { destroy: () => body.destroy() });
    setImmediate(() =>
      onResponse(Object.assign(body, { statusCode: 200, headers: { 'content-length': '1000' } })),
    );
    return request;
  }) as unknown as typeof https.get);
});

afterEach(() => {
  body.destroy();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Cancelling a GemStone download', () => {
  it('reports the cancel, not a finished download, and removes the partial file', async () => {
    const target = path.join(tmpDir, version.fileName);
    const source = cancelSource();
    const downloading = manager.download(version, { report: vi.fn() }, source.token);
    body.write(Buffer.alloc(100));
    await until(() => fs.existsSync(target) && fs.statSync(target).size > 0);

    source.cancel();
    const outcome = await downloading.then(
      () => 'resolved as downloaded',
      (e: unknown) => e,
    );

    expect(outcome).toBeInstanceOf(InstallCancelledError);
    expect((outcome as Error).message).toBe(
      'Download cancelled. The partly downloaded file was removed.',
    );
    expect(fs.existsSync(target)).toBe(false);
  });

  it('still finishes a download nobody cancelled', async () => {
    const target = path.join(tmpDir, version.fileName);
    const downloading = manager.download(version, { report: vi.fn() }, cancelSource().token);

    body.end(Buffer.alloc(1000));
    await downloading;

    expect(fs.statSync(target).size).toBe(1000);
  });
});
