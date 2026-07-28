// Orchestrates the incremental class-sync engine in client/src/sync/ (manifest
// build/diff, chunked transport, and file-out of changed classes).
// Full design: docs/incremental-class-sync.md
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActiveSession } from './sessionManager';
import { shouldSyncClasses } from './loginTypes';
import { boundLimitExecutor } from './browserQueries';
import { fetchBlob, newStats, RequestTiming } from './sync/syncTransport';
import {
  MANIFEST_BUILD_EXPR,
  contentBuildExpr,
  syncClassBuildExpr,
  SYNC_REFS_PER_BATCH,
  ClassRef,
} from './sync/syncProtocol';
import { parseManifest, parseContent, ClassSource } from './sync/syncFraming';
import {
  diffManifest,
  emptyState,
  entryKey,
  splitKey,
  chunkRefs,
  MirrorState,
} from './sync/manifestDiff';

const STATE_FILE = '.manifest.json';
const STATE_VERSION = 1;

// Files written/deleted concurrently during a sync. Overlapping per-file latency
// keeps a slow or network filesystem from serializing thousands of tiny writes.
const SYNC_WRITE_CONCURRENCY = 32;

interface PersistedState {
  version: number;
  classes: Record<string, string>;
}

// Restrict a path segment derived from connection metadata to filesystem-safe
// characters (also blocks `..` traversal from an oddly named stone/user).
function safeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, '_') || '_';
}

/**
 * Maintains a local `.gemstone` mirror of a session's classes as read-only
 * Topaz file-out (`.gs`) files, so VS Code's Find in Files, Go to Definition,
 * and workspace symbol search work over the source.
 *
 * The mirror is kept current with an incremental sync (see client/src/sync/):
 * one server-built manifest of per-class md5 hashes is diffed against a persisted
 * state, and only changed/new classes are re-fetched (in batches, through a
 * chunked transport). This collapses the old per-class round trips — the cost
 * that made large, remote images take minutes — into a handful of round trips.
 *
 * Default file structure (keyed by connection target, shared across that
 * target's sessions and persisted across logout):
 *   {workspaceRoot}/.gemstone/{host}/{stone}/{user}/{index}-{dictName}/{ClassName}.gs
 *
 * The `gemstone.exportPath` setting overrides this with variable substitution:
 *   {workspaceRoot}, {session}, {host}, {stone}, {user}, {index}, {dictName}
 */
export class ExportManager {
  // Suppress file-watcher events while we are writing the mirror.
  private writing = false;

  private logChannel: vscode.OutputChannel | undefined;

  // Debounced full re-syncs, keyed by session, for structural changes where a
  // targeted patch is fiddlier than re-running the (cheap) manifest diff.
  private refreshTimers = new Map<number, ReturnType<typeof setTimeout>>();

  get isWriting(): boolean {
    return this.writing;
  }

  /**
   * Create (once) and return the "GemStone Class Sync" output channel. Called
   * from activate() so the channel is listed in the Output dropdown up front —
   * not only after the first sync — and by log() as a fallback. Returns
   * undefined only in the test environment, where createOutputChannel is absent.
   */
  ensureLogChannel(): vscode.OutputChannel | undefined {
    if (!this.logChannel && vscode.window.createOutputChannel) {
      this.logChannel = vscode.window.createOutputChannel('GemStone Class Sync');
    }
    return this.logChannel;
  }

  private log(message: string): void {
    const channel = this.ensureLogChannel();
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    channel?.appendLine(`[${ts}] ${message}`);
  }

  /**
   * Resolved export path template for a session. Uses `gemstone.exportPath` with
   * session-level variables resolved; {index} and {dictName} remain placeholders.
   */
  getResolvedTemplate(session: ActiveSession): string | undefined {
    const config = vscode.workspace.getConfiguration('gemstone');
    const custom = config.get<string>('exportPath', '').trim();
    const folders = vscode.workspace.workspaceFolders;
    const wsRoot = folders?.[0]?.uri.fsPath;
    const { gem_host, stone, gs_user } = session.login;
    const sessionId = String(session.id);

    if (custom) {
      let resolved = custom
        .replace(/\{workspaceRoot}/g, wsRoot ?? '')
        .replace(/\{session}/g, sessionId)
        .replace(/\{host}/g, gem_host)
        .replace(/\{stone}/g, stone)
        .replace(/\{user}/g, gs_user);
      resolved = path.normalize(resolved);
      const testPath = resolved.replace(/\{index}/g, '0').replace(/\{dictName}/g, 'X');
      if (!path.isAbsolute(testPath)) {
        if (!wsRoot) return undefined;
        resolved = path.resolve(wsRoot, resolved);
      }
      return resolved;
    }

    // Default: keyed by connection target so sessions to the same stone share one
    // mirror that survives logout. {index} and {dictName} stay as placeholders.
    if (!wsRoot) return undefined;
    return path.join(
      wsRoot,
      '.gemstone',
      safeSegment(gem_host),
      safeSegment(stone),
      safeSegment(gs_user),
      '{index}-{dictName}',
    );
  }

  /** Full path for a specific dictionary directory. */
  getDictPath(session: ActiveSession, dictIndex: number, dictName: string): string | undefined {
    const template = this.getResolvedTemplate(session);
    if (!template) return undefined;
    return template.replace(/\{index}/g, String(dictIndex)).replace(/\{dictName}/g, dictName);
  }

  /** Per-target root directory (parent of all dictionary directories). */
  getSessionRoot(session: ActiveSession): string | undefined {
    const template = this.getResolvedTemplate(session);
    if (!template) return undefined;
    return path.dirname(template);
  }

  /**
   * Sync the class mirror for a session: fetch the manifest, diff against the
   * persisted state, and re-fetch only what changed. Cancellable; a cancelled
   * run leaves a consistent partial mirror that the next sync completes.
   *
   * @param silent when true, skip the "no workspace" warning and completion toast
   *   (used for the automatic syncs on login / commit / abort).
   */
  async exportSession(session: ActiveSession, silent = false): Promise<void> {
    if (!shouldSyncClasses(session.login)) {
      this.log(
        `Sync skipped for ${session.login.gs_user}@${session.login.stone}: disabled for this login.`,
      );
      return;
    }

    const sessionRoot = this.getSessionRoot(session);
    if (!sessionRoot) {
      if (!silent) {
        vscode.window.showWarningMessage(
          'No workspace folder open. Open a folder (File > Open Folder) or set `gemstone.exportPath` to enable class sync.',
        );
      }
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Syncing GemStone classes',
        cancellable: true,
      },
      async (progress, token) => {
        const startMs = Date.now();
        const exec = boundLimitExecutor(session);
        const readOnly = vscode.workspace
          .getConfiguration('gemstone')
          .get<boolean>('classSync.readOnlyMirror', true);

        // Per-request timing line, so a slow sync can be localized to the server
        // (build) vs the network (net ≈ wall − server).
        const reqLog = (t: RequestTiming) => {
          const net = Math.max(0, t.wallMs - t.serverMs);
          this.log(
            `  ${t.label}: server=${t.serverMs}ms wall=${t.wallMs}ms net≈${net}ms ${formatBytes(t.bytes)}`,
          );
        };

        // 1. Fetch the manifest (md5 of every class) and diff against local state.
        progress.report({ message: 'checking for changes…' });
        const manifestStats = newStats();
        let manifestText: string;
        try {
          manifestText = fetchBlob(
            exec,
            'manifest',
            MANIFEST_BUILD_EXPR,
            undefined,
            manifestStats,
            reqLog,
          );
        } catch (e) {
          this.reportError(e, silent);
          return;
        }
        if (token.isCancellationRequested) return;

        const manifest = parseManifest(manifestText);
        if (manifest.classCount !== null && manifest.classCount !== manifest.classes.length) {
          this.log(
            `WARNING: manifest looks truncated — server declared ${manifest.classCount} ` +
              `classes but only ${manifest.classes.length} parsed.`,
          );
        }
        const dictNameByIndex = new Map<number, string>();
        for (const d of manifest.dictionaries) dictNameByIndex.set(d.dictIndex, d.dictName);

        const local = this.loadState(sessionRoot);
        const { toFetch, toDeleteKeys, unchanged } = diffManifest(manifest, local);

        // Evolving state — persisted even on cancel so it always reflects disk.
        const newState: MirrorState = { classes: { ...local.classes } };
        const hashByKey = new Map<string, string>();
        for (const c of manifest.classes) {
          hashByKey.set(entryKey(c.dictIndex, c.dictName, c.className), c.hash);
        }

        const contentStats = newStats();
        let fetched = 0;
        let deleted = 0;
        // Audit: classes we asked for but didn't get back, and batch parse errors.
        const missing: ClassRef[] = [];
        const parseErrors: string[] = [];
        // Local-disk time, measured separately from the GCI requests: on a slow
        // or network filesystem this — not the network — can dominate the sync.
        let writeMs = 0;
        let deleteMs = 0;

        this.writing = true;
        try {
          // 2. Create all dictionary directories (including empty ones).
          const currentDictDirs = new Set<string>();
          for (const d of manifest.dictionaries) {
            const dir = this.getDictPath(session, d.dictIndex, d.dictName)!;
            fs.mkdirSync(dir, { recursive: true });
            currentDictDirs.add(dir);
          }

          // 3. Delete classes that no longer exist (in parallel).
          const deletePaths: string[] = [];
          for (const key of toDeleteKeys) {
            const { dictIndex, dictName, className } = splitKey(key);
            const dir = this.getDictPath(session, dictIndex, dictName);
            if (dir) deletePaths.push(path.join(dir, `${className}.gs`));
            delete newState.classes[key];
            deleted++;
          }
          const delT0 = Date.now();
          await runPool(deletePaths, SYNC_WRITE_CONCURRENCY, (fp) => this.deleteClassFileAsync(fp));
          deleteMs += Date.now() - delT0;

          // 4. Fetch & write changed/new classes in batches.
          const batches = chunkRefs(toFetch, SYNC_REFS_PER_BATCH);
          for (const batch of batches) {
            if (token.isCancellationRequested) break;
            let payload: string;
            try {
              payload = fetchBlob(
                exec,
                'content',
                contentBuildExpr(batch),
                undefined,
                contentStats,
                reqLog,
              );
            } catch (e) {
              this.reportError(e, silent);
              break;
            }
            const parsed = parseContent(payload);
            if (parsed.error) parseErrors.push(parsed.error);

            // Resolve write targets (cheap), then write them in parallel.
            const writes: { rec: ClassSource; dictName: string; filePath: string }[] = [];
            for (const rec of parsed.records) {
              const dictName = dictNameByIndex.get(rec.dictIndex);
              if (dictName === undefined) continue;
              const dir = this.getDictPath(session, rec.dictIndex, dictName)!;
              writes.push({ rec, dictName, filePath: path.join(dir, `${rec.className}.gs`) });
            }
            const got = new Set<string>();
            const wt0 = Date.now();
            await runPool(writes, SYNC_WRITE_CONCURRENCY, async (w) => {
              const ok = await this.writeClassFileAsync(w.filePath, w.rec.source, readOnly);
              if (!ok) return;
              const key = entryKey(w.rec.dictIndex, w.dictName, w.rec.className);
              const h = hashByKey.get(key);
              if (h !== undefined) newState.classes[key] = h;
              got.add(`${w.rec.dictIndex}\t${w.rec.className}`);
              fetched++;
            });
            writeMs += Date.now() - wt0;

            for (const ref of batch) {
              if (!got.has(`${ref.dictIndex}\t${ref.className}`)) missing.push(ref);
            }
            progress.report({
              message: `${fetched}/${toFetch.length} classes`,
              increment: toFetch.length > 0 ? (batch.length / toFetch.length) * 100 : 0,
            });
          }

          // 5. Prune dictionary directories that no longer exist.
          this.removeStaleDictDirs(sessionRoot, currentDictDirs);
        } finally {
          this.writing = false;
          // 6. Persist state reflecting exactly what's on disk (resumable).
          this.saveState(sessionRoot, newState);
        }

        const elapsed = Date.now() - startMs;
        const cancelled = token.isCancellationRequested;
        const serverMs = manifestStats.serverMs + contentStats.serverMs;
        const wallMs = manifestStats.wallMs + contentStats.wallMs;
        const roundTrips = manifestStats.roundTrips + contentStats.roundTrips;
        this.log(
          `${session.login.gs_user}@${session.login.stone}` +
            (cancelled ? ' (cancelled)' : '') +
            ` — ${manifest.classes.length} classes` +
            (manifest.methodCount !== null ? ` / ${manifest.methodCount} methods` : '') +
            `, ${unchanged} unchanged, ${fetched} fetched, ${deleted} deleted; ` +
            `${roundTrips} requests; server ${serverMs}ms, wall ${wallMs}ms, net≈${Math.max(0, wallMs - serverMs)}ms; ` +
            `disk ${writeMs + deleteMs}ms (write ${writeMs}ms, delete ${deleteMs}ms); ` +
            `total ${elapsed}ms; content ${formatBytes(contentStats.chars)}`,
        );

        // 7. Audit: report (loudly) any requested class we failed to write.
        const auditFailed = !cancelled && (missing.length > 0 || parseErrors.length > 0);
        if (auditFailed) {
          this.log(
            `AUDIT FAILED: ${missing.length} requested class(es) not written; ` +
              `${parseErrors.length} batch parse error(s).`,
          );
          for (const e of parseErrors) this.log(`  parse error: ${e}`);
          for (const m of missing.slice(0, 50)) this.log(`  missing: ${m.dictName}/${m.className}`);
          if (missing.length > 50) this.log(`  …and ${missing.length - 50} more`);
          if (!silent) {
            vscode.window.showWarningMessage(
              `GemStone class sync: ${missing.length} class(es) could not be written. ` +
                `See the "GemStone Class Sync" output for details.`,
            );
          }
        }

        if (!silent && !cancelled && !auditFailed) {
          vscode.window.showInformationMessage(
            fetched + deleted === 0
              ? 'GemStone classes already up to date.'
              : `Synced GemStone classes: ${fetched} updated, ${deleted} removed.`,
          );
        }
      },
    );
  }

  /** Re-sync after a commit or abort (another session's changes may be visible). */
  async refreshSession(session: ActiveSession): Promise<void> {
    return this.exportSession(session, true);
  }

  /**
   * Update one class's mirror file in place (and its persisted hash), keeping
   * the mirror in step with a single mutation — a method save, a deleted/moved
   * method, a recategorize. Resolves the dictionary index by name server-side so
   * the file lands under the same `{index}-{dictName}` dir the manifest uses.
   * Cheap (one round trip) and silent; failures are logged, not surfaced.
   */
  async syncClass(session: ActiveSession, dictName: string, className: string): Promise<void> {
    if (!shouldSyncClasses(session.login)) return;
    const sessionRoot = this.getSessionRoot(session);
    if (!sessionRoot) return;
    try {
      const exec = boundLimitExecutor(session);
      const payload = fetchBlob(exec, 'class', syncClassBuildExpr(dictName, className));
      const nl = payload.indexOf('\n');
      if (nl < 0) return; // dictionary/class not found — nothing to write
      const header = payload.slice(0, nl);
      const tab = header.indexOf('\t');
      if (tab < 0) return;
      const dictIndex = parseInt(header.slice(0, tab), 10);
      const hash = header.slice(tab + 1);
      const source = payload.slice(nl + 1);
      const dir = this.getDictPath(session, dictIndex, dictName);
      if (!dir) return;
      const readOnly = vscode.workspace
        .getConfiguration('gemstone')
        .get<boolean>('classSync.readOnlyMirror', true);

      this.writing = true;
      try {
        fs.mkdirSync(dir, { recursive: true });
        await this.writeClassFileAsync(path.join(dir, `${className}.gs`), source, readOnly);
      } finally {
        this.writing = false;
      }

      const state = this.loadState(sessionRoot);
      state.classes[entryKey(dictIndex, dictName, className)] = hash;
      this.saveState(sessionRoot, state);
    } catch (e) {
      this.log(
        `syncClass failed for ${dictName}/${className}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Remove one class's mirror file (and its persisted hash) after the class is
   * deleted or moved out of a dictionary. The index is known by the caller, so
   * no server round trip is needed.
   */
  removeClassFile(
    session: ActiveSession,
    dictIndex: number,
    dictName: string,
    className: string,
  ): void {
    if (!shouldSyncClasses(session.login)) return;
    const sessionRoot = this.getSessionRoot(session);
    if (!sessionRoot) return;
    const dir = this.getDictPath(session, dictIndex, dictName);
    this.writing = true;
    try {
      if (dir) this.deleteClassFile(dir, className);
    } finally {
      this.writing = false;
    }
    const state = this.loadState(sessionRoot);
    const key = entryKey(dictIndex, dictName, className);
    if (state.classes[key] !== undefined) {
      delete state.classes[key];
      this.saveState(sessionRoot, state);
    }
  }

  /**
   * Debounced full re-sync, for structural changes (dictionary add/remove/
   * reorder, class move, file-in) where indices shift and the manifest diff is
   * the simplest correct reconciliation. Coalesces rapid changes.
   */
  scheduleRefresh(session: ActiveSession, delayMs = 400): void {
    if (!shouldSyncClasses(session.login)) return;
    const prev = this.refreshTimers.get(session.id);
    if (prev) clearTimeout(prev);
    this.refreshTimers.set(
      session.id,
      setTimeout(() => {
        this.refreshTimers.delete(session.id);
        void this.refreshSession(session);
      }, delayMs),
    );
  }

  /**
   * Delete the mirror for a session's target (explicit "clear mirror"). No longer
   * called on logout — the mirror persists so reconnects sync incrementally.
   */
  deleteSessionFiles(session: ActiveSession): void {
    const sessionRoot = this.getSessionRoot(session);
    if (!sessionRoot || !fs.existsSync(sessionRoot)) return;

    this.writing = true;
    try {
      fs.rmSync(sessionRoot, { recursive: true, force: true });
    } finally {
      this.writing = false;
    }

    // Remove now-empty ancestor directories up to (and excluding) the workspace.
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let dir = path.dirname(sessionRoot);
    while (wsRoot && dir.startsWith(wsRoot) && dir !== wsRoot) {
      try {
        if (fs.readdirSync(dir).length > 0) break;
        fs.rmdirSync(dir);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
  }

  // ── persisted state ────────────────────────────────────────────────────────

  private statePath(sessionRoot: string): string {
    return path.join(sessionRoot, STATE_FILE);
  }

  private loadState(sessionRoot: string): MirrorState {
    try {
      const raw = fs.readFileSync(this.statePath(sessionRoot), 'utf-8');
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed && parsed.version === STATE_VERSION && parsed.classes) {
        return { classes: parsed.classes };
      }
    } catch {
      /* missing or unreadable — treat as a full sync */
    }
    return emptyState();
  }

  private saveState(sessionRoot: string, state: MirrorState): void {
    const payload: PersistedState = { version: STATE_VERSION, classes: state.classes };
    try {
      fs.mkdirSync(sessionRoot, { recursive: true });
      fs.writeFileSync(this.statePath(sessionRoot), JSON.stringify(payload), 'utf-8');
    } catch (e) {
      this.log(`Failed to persist sync state: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── file helpers ─────────────────────────────────────────────────────────────

  // Write one mirror file. Skips an upfront existsSync (one fewer syscall per
  // file) by writing directly and, only if that fails because the file is an
  // existing read-only mirror file, making it writable and retrying. Returns
  // false (and logs) if the class could not be written, so the audit catches it.
  private async writeClassFileAsync(
    filePath: string,
    source: string,
    readOnly: boolean,
  ): Promise<boolean> {
    try {
      await fs.promises.writeFile(filePath, source, 'utf-8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EPERM') {
        try {
          await fs.promises.chmod(filePath, 0o644);
          await fs.promises.writeFile(filePath, source, 'utf-8');
        } catch (e2) {
          this.log(
            `Failed to write ${path.basename(filePath)}: ${e2 instanceof Error ? e2.message : String(e2)}`,
          );
          return false;
        }
      } else {
        this.log(
          `Failed to write ${path.basename(filePath)}: ${e instanceof Error ? e.message : String(e)}`,
        );
        return false;
      }
    }
    if (readOnly) {
      try {
        await fs.promises.chmod(filePath, 0o444);
      } catch {
        /* best effort — a writable mirror file is still usable */
      }
    }
    return true;
  }

  private async deleteClassFileAsync(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return; // already gone
      if (code === 'EACCES' || code === 'EPERM') {
        try {
          await fs.promises.chmod(filePath, 0o644);
          await fs.promises.unlink(filePath);
        } catch {
          /* ignore */
        }
      }
    }
  }

  private deleteClassFile(dir: string, className: string): void {
    const filePath = path.join(dir, `${className}.gs`);
    if (!fs.existsSync(filePath)) return;
    try {
      fs.chmodSync(filePath, 0o644);
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }

  private removeStaleDictDirs(sessionRoot: string, currentDirs: Set<string>): void {
    if (!fs.existsSync(sessionRoot)) return;
    for (const entry of fs.readdirSync(sessionRoot)) {
      const full = path.join(sessionRoot, entry);
      let isDir: boolean;
      try {
        isDir = fs.statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (!isDir || currentDirs.has(full)) continue;
      try {
        fs.rmSync(full, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  private reportError(e: unknown, silent: boolean): void {
    const msg = e instanceof Error ? e.message : String(e);
    this.log(`Sync error: ${msg}`);
    if (!silent) vscode.window.showErrorMessage(`GemStone class sync failed: ${msg}`);
  }

  dispose(): void {
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
    this.logChannel?.dispose();
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Run `fn` over `items` with at most `limit` promises in flight at once.
async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      await fn(items[next++]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

// Re-exported so callers/tests can reference the ref shape without reaching into
// the sync internals.
export type { ClassRef };
