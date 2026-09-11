import * as fs from 'fs';
import * as path from 'path';
import { extensionPathFrom } from './extensionPath';

// Lives next to the MCP socket so every Jasper window can answer
// "if not me, who owns the MCP server?" without IPC. Written by the owning
// window on claim, deleted on dispose. A stale sidecar (owner crashed) is
// detected by probing the pid; any subsequent claimant overwrites it.

/**
 * What `workspacePath` says when the owning window had no folder open. The MCP
 * Server tab cannot offer to open such a window, so it checks for this rather
 * than trying to open a path that names nothing.
 */
export const NO_WORKSPACE_RECORDED = '(no workspace)';

export interface McpOwnerInfo {
  pid: number;
  workspacePath: string;
  socketPath: string;
  claimedAt: string; // ISO 8601
  /**
   * Human-readable label of the owning window's currently selected GemStone
   * session — e.g. `"foo (id 12)"`. Omitted when the owner has no session
   * selected. Lets passive Jasper windows show "MCP is owned by /path/to/X —
   * no session selected" so the user can spot the wrong-window-owner case.
   */
  selectedSession?: string;
}

export function defaultSidecarPath(): string {
  return extensionPathFrom('mcp.owner.json');
}

export function writeOwnerSidecar(
  info: McpOwnerInfo,
  sidecarPath: string = defaultSidecarPath(),
): void {
  const dir = path.dirname(sidecarPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${sidecarPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(info, null, 2) + '\n');
  fs.renameSync(tmp, sidecarPath);
}

export function readOwnerSidecar(
  sidecarPath: string = defaultSidecarPath(),
): McpOwnerInfo | undefined {
  if (!fs.existsSync(sidecarPath)) return undefined;
  try {
    const raw = fs.readFileSync(sidecarPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.pid === 'number' &&
      typeof parsed.workspacePath === 'string' &&
      typeof parsed.socketPath === 'string' &&
      typeof parsed.claimedAt === 'string'
    ) {
      // selectedSession is optional; only carry it through if it's a string.
      const result: McpOwnerInfo = {
        pid: parsed.pid,
        workspacePath: parsed.workspacePath,
        socketPath: parsed.socketPath,
        claimedAt: parsed.claimedAt,
      };
      if (typeof parsed.selectedSession === 'string') {
        result.selectedSession = parsed.selectedSession;
      }
      return result;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function deleteOwnerSidecar(
  expectedPid: number,
  sidecarPath: string = defaultSidecarPath(),
): boolean {
  const info = readOwnerSidecar(sidecarPath);
  if (!info) return false;
  // Only remove if it still names us as owner. Avoids deleting a sidecar a
  // second Jasper has since written after taking over.
  if (info.pid !== expectedPid) return false;
  try {
    fs.unlinkSync(sidecarPath);
    return true;
  } catch {
    return false;
  }
}

// A pid is "alive" if `kill(pid, 0)` succeeds (signal 0 = check only, no
// signal delivered). Permission errors (EPERM) also mean the process exists
// but is owned by someone else — still counts as live. Anything else (ESRCH)
// means it's gone and the sidecar is stale.
export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}
