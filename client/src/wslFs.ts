import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { needsWsl, windowsPathToWsl, wslExecSync } from './wslBridge';

/**
 * Filesystem helpers that transparently route through WSL when the target
 * path is on the WSL side (\\wsl$\... or \\wsl.localhost\...). VS Code's
 * Node-side UNC enforcement can silently block or reject fs operations on
 * those paths even when the host is in security.allowedUNCHosts, so we run
 * the operation inside WSL to avoid the UNC surface entirely.
 *
 * On non-Windows hosts, and for paths that aren't on the WSL UNC share, each
 * helper falls through to the standard fs call.
 */

function isWslUncPath(p: string): boolean {
  return /^\\\\wsl(\$|\.localhost)\\/i.test(p);
}

function shouldRoute(p: string): boolean {
  return needsWsl() && isWslUncPath(p);
}

function shellQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

export function wslExistsSync(p: string): boolean {
  if (!shouldRoute(p)) return fs.existsSync(p);
  try {
    wslExecSync(`test -e ${shellQuote(windowsPathToWsl(p))}`);
    return true;
  } catch {
    return false;
  }
}

export function wslIsDirectory(p: string): boolean {
  if (!shouldRoute(p)) {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  }
  try {
    wslExecSync(`test -d ${shellQuote(windowsPathToWsl(p))}`);
    return true;
  } catch {
    return false;
  }
}

export function wslIsFile(p: string): boolean {
  if (!shouldRoute(p)) {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  }
  try {
    wslExecSync(`test -f ${shellQuote(windowsPathToWsl(p))}`);
    return true;
  } catch {
    return false;
  }
}

export function wslIsSymlink(p: string): boolean {
  if (!shouldRoute(p)) {
    try {
      return fs.lstatSync(p).isSymbolicLink();
    } catch {
      return false;
    }
  }
  try {
    wslExecSync(`test -L ${shellQuote(windowsPathToWsl(p))}`);
    return true;
  } catch {
    return false;
  }
}

export function wslFileSize(p: string): number {
  if (!shouldRoute(p)) {
    try {
      return fs.statSync(p).size;
    } catch {
      return -1;
    }
  }
  try {
    const out = wslExecSync(`stat -c %s ${shellQuote(windowsPathToWsl(p))}`).trim();
    const n = parseInt(out, 10);
    return Number.isFinite(n) ? n : -1;
  } catch {
    return -1;
  }
}

export function wslReaddirSync(p: string): string[] {
  if (!shouldRoute(p)) {
    try {
      return fs.readdirSync(p);
    } catch {
      return [];
    }
  }
  try {
    // -A includes dotfiles except . and ..; -1 one-per-line; -- ends options
    const out = wslExecSync(`ls -A1 -- ${shellQuote(windowsPathToWsl(p))}`);
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function wslReadFileSync(p: string): string | undefined {
  if (!shouldRoute(p)) {
    try {
      return fs.readFileSync(p, 'utf-8');
    } catch {
      return undefined;
    }
  }
  try {
    return wslExecSync(`cat ${shellQuote(windowsPathToWsl(p))}`);
  } catch {
    return undefined;
  }
}

export function wslMkdirSync(p: string, options?: { recursive?: boolean }): void {
  if (!shouldRoute(p)) {
    fs.mkdirSync(p, options);
    return;
  }
  const flag = options?.recursive ? '-p' : '';
  wslExecSync(`mkdir ${flag} ${shellQuote(windowsPathToWsl(p))}`.trim());
}

/**
 * Write a file by piping content to `sh -c "cat > path"` inside WSL.
 * This avoids any dependence on VS Code's UNC allowlist.
 */
export function wslWriteFileSync(p: string, content: string): void {
  if (!shouldRoute(p)) {
    fs.writeFileSync(p, content);
    return;
  }
  const wslPath = windowsPathToWsl(p);
  const result = spawnSync('wsl.exe', ['-e', 'sh', '-c', `cat > ${shellQuote(wslPath)}`], {
    input: content,
    encoding: 'utf-8',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Failed to write ${p} via WSL (exit ${result.status}): ${result.stderr || 'no stderr'}`,
    );
  }
}

/**
 * Copy a file. If either endpoint is a \\wsl$\ path, runs `cp` inside WSL.
 * Both paths must be on the WSL side (or both native); mixed copies aren't
 * supported here — they aren't needed by current callers.
 */
export function wslCopyFileSync(src: string, dst: string): void {
  const srcRoute = shouldRoute(src);
  const dstRoute = shouldRoute(dst);
  if (!srcRoute && !dstRoute) {
    fs.copyFileSync(src, dst);
    return;
  }
  if (srcRoute !== dstRoute) {
    throw new Error(
      `wslCopyFileSync: cannot copy between Windows and WSL filesystems (src=${src}, dst=${dst})`,
    );
  }
  wslExecSync(`cp -p ${shellQuote(windowsPathToWsl(src))} ${shellQuote(windowsPathToWsl(dst))}`);
}

/**
 * Copy a file when either endpoint may live on the Windows filesystem
 * (C:\...) or the WSL filesystem (\\wsl$\...). On Windows the copy runs as
 * `cp -p` inside WSL with both endpoints translated via toWslPath (Windows
 * drives map to /mnt/<drive>), so a user-selected extent on C:\ can land in a
 * WSL-side database — the cross-filesystem case wslCopyFileSync rejects.
 * On non-Windows hosts this is a plain fs.copyFileSync.
 */
export function wslImportFileSync(src: string, dst: string): void {
  if (!needsWsl()) {
    fs.copyFileSync(src, dst);
    return;
  }
  wslExecSync(`cp -p ${shellQuote(toWslPath(src))} ${shellQuote(toWslPath(dst))}`);
}

export function wslUnlinkSync(p: string): void {
  if (!shouldRoute(p)) {
    fs.unlinkSync(p);
    return;
  }
  wslExecSync(`rm -f ${shellQuote(windowsPathToWsl(p))}`);
}

export function wslRmSync(p: string, options?: { recursive?: boolean; force?: boolean }): void {
  if (!shouldRoute(p)) {
    fs.rmSync(p, options);
    return;
  }
  const flags = [options?.recursive ? 'r' : '', options?.force ? 'f' : ''].join('');
  const arg = flags ? `-${flags}` : '';
  wslExecSync(`rm ${arg} ${shellQuote(windowsPathToWsl(p))}`.trim());
}

/**
 * Translate a path into something usable from inside WSL.
 *   \\wsl$\Ubuntu\home\x   → /home/x
 *   C:\Users\x             → /mnt/c/Users/x
 *   /already/linux         → unchanged
 * Only meaningful on Windows; on other platforms returns the input.
 */
export function toWslPath(p: string): string {
  if (isWslUncPath(p)) return windowsPathToWsl(p);
  const drive = p.match(/^([A-Za-z]):[\\/](.*)$/);
  if (drive) return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, '/')}`;
  return p;
}

/**
 * Create a symlink at `linkPath` pointing at `target`. When `linkPath` is a
 * WSL UNC path, runs `ln -s` inside WSL (with `target` translated via
 * toWslPath so Windows-side sources end up as /mnt/c/... on the Linux side).
 */
export function wslSymlinkSync(target: string, linkPath: string): void {
  if (!shouldRoute(linkPath)) {
    fs.symlinkSync(target, linkPath);
    return;
  }
  wslExecSync(`ln -s ${shellQuote(toWslPath(target))} ${shellQuote(windowsPathToWsl(linkPath))}`);
}

export function wslChmodSync(p: string, mode: number | string): void {
  if (!shouldRoute(p)) {
    fs.chmodSync(p, mode);
    return;
  }
  const modeStr = typeof mode === 'number' ? mode.toString(8) : mode;
  wslExecSync(`chmod ${modeStr} ${shellQuote(windowsPathToWsl(p))}`);
}
/**
 * The plain files directly inside `p`, sorted, with directories left out.
 *
 * Callers that want this list have to have it in one round trip: a readdir
 * followed by a wslIsFile per entry costs one `wsl.exe` spawn per file, which
 * a directory of stone logs turns into seconds of a frozen extension host.
 * `ls -A1p` marks directories with a trailing `/`, and readdir's Dirent answers
 * the same question natively, so neither side needs a stat per name.
 */
export function wslListFilesSync(p: string): string[] {
  if (!shouldRoute(p)) {
    try {
      return fs
        .readdirSync(p, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }
  try {
    const out = wslExecSync(`ls -A1p -- ${shellQuote(windowsPathToWsl(p))}`);
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s && !s.endsWith('/'))
      .sort();
  } catch {
    return [];
  }
}

/**
 * The files directly in a directory, each with when it was last written.
 *
 * `wslListFilesSync` answers names only, which is enough to open a file but not
 * to say which of forty log files is the one from this morning. Reported in
 * epoch milliseconds so the caller can order and format them however it likes.
 * A directory that cannot be read answers an empty list, as the name-only
 * listing does — an unreadable log folder is not worth an error.
 */
export function wslStatFilesSync(p: string): { name: string; modifiedMs: number }[] {
  if (!shouldRoute(p)) {
    try {
      return fs
        .readdirSync(p, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => {
          try {
            return { name: e.name, modifiedMs: fs.statSync(path.join(p, e.name)).mtimeMs };
          } catch {
            // Vanished between the listing and the stat, or unreadable: it is
            // still a file worth showing, just without a time.
            return { name: e.name, modifiedMs: 0 };
          }
        });
    } catch {
      return [];
    }
  }
  try {
    // `find -printf` rather than `ls`, whose columns move with locale and file
    // age. %T@ is the epoch seconds with a fractional part; the tab keeps names
    // containing spaces intact.
    const out = wslExecSync(
      `find ${shellQuote(windowsPathToWsl(p))} -maxdepth 1 -type f -printf '%T@\t%f\n'`,
    );
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf('\t');
        if (tab < 0) return { name: line, modifiedMs: 0 };
        const seconds = Number(line.slice(0, tab));
        return {
          name: line.slice(tab + 1),
          modifiedMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0,
        };
      });
  } catch {
    return [];
  }
}
