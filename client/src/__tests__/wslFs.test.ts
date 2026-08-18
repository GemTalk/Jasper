import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  symlinkSync: vi.fn(),
  statSync: vi.fn(),
  lstatSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  copyFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmSync: vi.fn(),
  chmodSync: vi.fn(),
}));

vi.mock('../wslBridge', () => ({
  needsWsl: vi.fn(),
  windowsPathToWsl: vi.fn((p: string) => {
    const m = p.match(/^\\\\wsl(?:\$|\.localhost)\\[^\\]+(.*)$/i);
    return m ? m[1].replace(/\\/g, '/') : p;
  }),
  wslExecSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

import * as fs from 'fs';
import { needsWsl, wslExecSync } from '../wslBridge';
import { spawnSync } from 'child_process';
import {
  wslExistsSync,
  wslIsDirectory,
  wslIsFile,
  wslReaddirSync,
  wslListFilesSync,
  wslMkdirSync,
  wslWriteFileSync,
  wslCopyFileSync,
  wslImportFileSync,
  wslUnlinkSync,
  wslRmSync,
  wslChmodSync,
  wslSymlinkSync,
  toWslPath,
} from '../wslFs';

const UNC = '\\\\wsl$\\Ubuntu\\home\\james\\db-1';
const UNC_LOCALHOST = '\\\\wsl.localhost\\Ubuntu\\home\\james\\db-1';

describe('wslFs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('UNC path detection via routing', () => {
    it('routes \\\\wsl$\\... through WSL when on Windows', () => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(wslExecSync).mockReturnValue('');
      wslExistsSync(UNC);
      expect(wslExecSync).toHaveBeenCalledOnce();
      expect(vi.mocked(wslExecSync).mock.calls[0][0]).toContain("test -e '/home/james/db-1'");
    });

    it('routes \\\\wsl.localhost\\... through WSL when on Windows', () => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(wslExecSync).mockReturnValue('');
      wslExistsSync(UNC_LOCALHOST);
      expect(wslExecSync).toHaveBeenCalledOnce();
    });

    it('does NOT route a plain Windows drive path', () => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(fs.existsSync).mockReturnValue(false);
      wslExistsSync('C:\\Users\\x');
      expect(wslExecSync).not.toHaveBeenCalled();
      expect(fs.existsSync).toHaveBeenCalledWith('C:\\Users\\x');
    });

    it('does NOT route anything when not on Windows', () => {
      vi.mocked(needsWsl).mockReturnValue(false);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      wslExistsSync(UNC);
      expect(wslExecSync).not.toHaveBeenCalled();
      expect(fs.existsSync).toHaveBeenCalledWith(UNC);
    });
  });

  describe('existence/kind checks translate failures to false', () => {
    beforeEach(() => vi.mocked(needsWsl).mockReturnValue(true));

    it('wslExistsSync returns false when test -e exits non-zero', () => {
      vi.mocked(wslExecSync).mockImplementation(() => {
        throw new Error('exit 1');
      });
      expect(wslExistsSync(UNC)).toBe(false);
    });

    it('wslIsDirectory calls test -d', () => {
      vi.mocked(wslExecSync).mockReturnValue('');
      expect(wslIsDirectory(UNC)).toBe(true);
      expect(vi.mocked(wslExecSync).mock.calls[0][0]).toContain('test -d');
    });

    it('wslIsFile calls test -f', () => {
      vi.mocked(wslExecSync).mockReturnValue('');
      expect(wslIsFile(UNC)).toBe(true);
      expect(vi.mocked(wslExecSync).mock.calls[0][0]).toContain('test -f');
    });
  });

  describe('wslReaddirSync', () => {
    it('parses ls -A1 output and drops blank lines', () => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(wslExecSync).mockReturnValue('a.log\nb.conf\n\n  c.dbf  \n');
      expect(wslReaddirSync(UNC)).toEqual(['a.log', 'b.conf', 'c.dbf']);
    });

    it('returns [] on error', () => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(wslExecSync).mockImplementation(() => {
        throw new Error();
      });
      expect(wslReaddirSync(UNC)).toEqual([]);
    });
  });

  describe('wslListFilesSync', () => {
    it('lists the files of a directory, sorted, leaving out its subdirectories', () => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(wslExecSync).mockReturnValue('c.dbf\nolder/\na.log\n\n  b.conf  \n');

      expect(wslListFilesSync(UNC)).toEqual(['a.log', 'b.conf', 'c.dbf']);
    });

    it('asks the WSL side once, however many files the directory holds', () => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(wslExecSync).mockReturnValue('a.log\nb.log\nc.log\nd.log\n');

      wslListFilesSync(UNC);

      expect(vi.mocked(wslExecSync)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(wslExecSync).mock.calls[0][0]).toContain('ls -A1p');
    });

    it('lists a native directory without stating each name in turn', () => {
      vi.mocked(needsWsl).mockReturnValue(false);
      vi.mocked(fs.readdirSync).mockReturnValue([
        { name: 'b.log', isFile: () => true },
        { name: 'archive', isFile: () => false },
        { name: 'a.log', isFile: () => true },
      ] as unknown as ReturnType<typeof fs.readdirSync>);

      expect(wslListFilesSync('/gs/db-1/log')).toEqual(['a.log', 'b.log']);
      expect(vi.mocked(fs.statSync)).not.toHaveBeenCalled();
    });

    it('has nothing to list when the directory cannot be read', () => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(wslExecSync).mockImplementation(() => {
        throw new Error('No such file or directory');
      });

      expect(wslListFilesSync(UNC)).toEqual([]);
    });
  });

  describe('wslMkdirSync', () => {
    it('passes -p when recursive', () => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(wslExecSync).mockReturnValue('');
      wslMkdirSync(UNC, { recursive: true });
      expect(vi.mocked(wslExecSync).mock.calls[0][0]).toMatch(/mkdir -p /);
    });

    it('omits -p when not recursive', () => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(wslExecSync).mockReturnValue('');
      wslMkdirSync(UNC);
      expect(vi.mocked(wslExecSync).mock.calls[0][0]).not.toMatch(/mkdir -p /);
    });
  });

  describe('wslWriteFileSync', () => {
    it('pipes content to sh -c "cat > path" via stdin', () => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(spawnSync).mockReturnValue({ status: 0, stderr: '' } as never);
      wslWriteFileSync(UNC, 'hello');
      expect(spawnSync).toHaveBeenCalledOnce();
      const [cmd, args, opts] = vi.mocked(spawnSync).mock.calls[0];
      expect(cmd).toBe('wsl.exe');
      expect(args).toEqual(['-e', 'sh', '-c', "cat > '/home/james/db-1'"]);
      expect((opts as { input: string }).input).toBe('hello');
    });

    it('throws with stderr on non-zero exit', () => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(spawnSync).mockReturnValue({ status: 1, stderr: 'no space' } as never);
      expect(() => wslWriteFileSync(UNC, 'x')).toThrow(/no space/);
    });
  });

  describe('wslCopyFileSync', () => {
    beforeEach(() => vi.mocked(needsWsl).mockReturnValue(true));

    it('runs cp -p inside WSL for two UNC paths', () => {
      vi.mocked(wslExecSync).mockReturnValue('');
      wslCopyFileSync(UNC, UNC + '.bak');
      expect(vi.mocked(wslExecSync).mock.calls[0][0]).toMatch(/^cp -p '/);
    });

    it('rejects mixed Windows/WSL copies', () => {
      expect(() => wslCopyFileSync(UNC, 'C:\\out.bin')).toThrow(/cannot copy between/);
    });
  });

  describe('wslImportFileSync', () => {
    it('bridges a Windows-side source into a WSL-side destination via cp inside WSL', () => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(wslExecSync).mockReturnValue('');
      wslImportFileSync('C:\\seed\\extent0.dbf', UNC + '\\data\\extent0.dbf');
      expect(vi.mocked(wslExecSync).mock.calls[0][0]).toBe(
        "cp -p '/mnt/c/seed/extent0.dbf' '/home/james/db-1/data/extent0.dbf'",
      );
    });

    it('falls back to fs.copyFileSync on non-Windows hosts', () => {
      vi.mocked(needsWsl).mockReturnValue(false);
      wslImportFileSync('/seed/extent0.dbf', '/home/james/db-1/data/extent0.dbf');
      expect(fs.copyFileSync).toHaveBeenCalledWith(
        '/seed/extent0.dbf',
        '/home/james/db-1/data/extent0.dbf',
      );
      expect(wslExecSync).not.toHaveBeenCalled();
    });
  });

  describe('wslUnlinkSync / wslRmSync / wslChmodSync', () => {
    beforeEach(() => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(wslExecSync).mockReturnValue('');
    });

    it('wslUnlinkSync runs rm -f', () => {
      wslUnlinkSync(UNC);
      expect(vi.mocked(wslExecSync).mock.calls[0][0]).toMatch(/^rm -f /);
    });

    it('wslRmSync runs rm -rf when options set', () => {
      wslRmSync(UNC, { recursive: true, force: true });
      expect(vi.mocked(wslExecSync).mock.calls[0][0]).toMatch(/^rm -rf /);
    });

    it('wslChmodSync converts numeric mode to octal', () => {
      wslChmodSync(UNC, 0o644);
      expect(vi.mocked(wslExecSync).mock.calls[0][0]).toMatch(/^chmod 644 /);
    });
  });

  describe('wslSymlinkSync', () => {
    beforeEach(() => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(wslExecSync).mockReturnValue('');
    });

    it('creates a symlink inside WSL with UNC → linux translation', () => {
      const target = '\\\\wsl$\\Ubuntu\\opt\\gemstone\\3.7.5';
      wslSymlinkSync(target, UNC);
      expect(vi.mocked(wslExecSync).mock.calls[0][0]).toBe(
        "ln -s '/opt/gemstone/3.7.5' '/home/james/db-1'",
      );
    });

    it('translates a Windows drive target to /mnt/<drive>/...', () => {
      wslSymlinkSync('C:\\Products\\GemStone', UNC);
      expect(vi.mocked(wslExecSync).mock.calls[0][0]).toBe(
        "ln -s '/mnt/c/Products/GemStone' '/home/james/db-1'",
      );
    });

    it('falls back to fs.symlinkSync when linkPath is not UNC', () => {
      vi.mocked(needsWsl).mockReturnValue(false);
      wslSymlinkSync('/src', '/dst');
      expect(fs.symlinkSync).toHaveBeenCalledWith('/src', '/dst');
      expect(wslExecSync).not.toHaveBeenCalled();
    });
  });

  describe('toWslPath', () => {
    it('translates \\\\wsl$\\distro\\path → /path', () => {
      expect(toWslPath('\\\\wsl$\\Ubuntu\\home\\x')).toBe('/home/x');
    });

    it('translates \\\\wsl.localhost\\distro\\path → /path', () => {
      expect(toWslPath('\\\\wsl.localhost\\Ubuntu\\home\\x')).toBe('/home/x');
    });

    it('translates C:\\foo\\bar → /mnt/c/foo/bar', () => {
      expect(toWslPath('C:\\foo\\bar')).toBe('/mnt/c/foo/bar');
    });

    it('lowercases the drive letter', () => {
      expect(toWslPath('D:\\x')).toBe('/mnt/d/x');
    });

    it('leaves a Linux path unchanged', () => {
      expect(toWslPath('/already/linux')).toBe('/already/linux');
    });
  });

  describe('shell quoting', () => {
    it('escapes single quotes in a path', () => {
      vi.mocked(needsWsl).mockReturnValue(true);
      vi.mocked(wslExecSync).mockReturnValue('');
      // windowsPathToWsl mock preserves the Linux-side portion verbatim
      wslExistsSync("\\\\wsl$\\Ubuntu\\home\\o'brien");
      expect(vi.mocked(wslExecSync).mock.calls[0][0]).toContain("'/home/o'\\''brien'");
    });
  });
});
