# Incremental class sync (the `.gemstone` mirror)

## Why

The `.gemstone` directory is a local, read-only-by-default mirror of a session's classes as
Topaz file-out (`.gs`) files. It exists so VS Code's native tooling — **Find in
Files**, **Go to Definition**, workspace symbol search — has real files to work
over. (Editing still goes through the `gemstone://` virtual filesystem, which
compiles on save.)

The original implementation filed out **one class per GCI round trip**. That is
fine on a fast local connection but catastrophic on a slow/remote one: the cost
is `round-trip-latency × class-count`. A customer with ~5500 classes on a slow
link saw multi-minute syncs (≈ `5500 × ~40 ms`). The same full re-export ran on
**every login, commit, and abort**.

Measured on a live 1266-class image: 1266 classes, 11 MB of total file-out,
manifest build (file-out + md5 of every class) **448 ms** of server CPU.
Extrapolated to 5500 classes: ~48 MB content, ~330 KB manifest, ~2 s server CPU.
The bottleneck was never the data volume — it was the per-class round trips.

## How

A **manifest + delta** sync (`client/src/sync/`, orchestrated by
`ExportManager`):

1. **Manifest** — one server-built payload listing every dictionary and the md5
   of each class's file-out. Built in the user's session, so it reflects that
   session's view (including its own uncommitted edits). md5 of an ASCII
   file-out equals standard MD5; the file-out is deterministic (methods emitted
   in sorted-selector order, no timestamps), so an unchanged class hashes the
   same across sessions.
2. **Diff** — the manifest is compared against persisted state
   (`<root>/.manifest.json`). Only changed/new classes are fetched; vanished
   classes are deleted. Entries are keyed by `(dictIndex, dictName, className)`,
   so dictionary **reorders and renames self-correct** (old keys pruned, new
   ones fetched).
3. **Delta fetch** — changed classes are fetched in batches through a chunked
   **transport**: the server builds the payload once and either returns it
   inline (one round trip) or streams it by code-point offset. This collapses
   ~5500 round trips into a handful.

Result: first sync is bandwidth-bound (one ~48 MB transfer) instead of
latency-bound; reconnects/commits transfer only the ~330 KB manifest plus the
classes that actually changed.

### Transport details

- One primitive (`fetchBlob`) used for both the manifest and content. Server
  stashes large payloads in `SessionTemps` and serves code-point slices;
  small payloads come back in the prepare call with nothing stored to release.
- Slicing happens on **code-point** boundaries, and each chunk is then
  `encodeAsUTF8`'d server-side so the GCI wrapper's UTF-8 decode is always
  correct. This last part is essential: a file-out containing any non-ASCII
  character is a wide (`Unicode16`) GemStone string whose raw bytes are *not*
  UTF-8, so returning it directly corrupts the decode and desyncs the parser
  (it silently dropped such classes before this was fixed). Content records are
  **length-framed** (header line + N code points), never delimiter-scanned, so
  Topaz `% ! \n \t` in bodies are safe. A class larger than a chunk (e.g.
  `Object` ≈ 220 KB) simply spans chunks. This also fixes a latent truncation
  bug: the old single-fetch path silently cut off any class whose file-out
  exceeded the 256 KB result cap.
- `browserQueries.executeFetchStringWithLimit` raises the result-buffer size
  per call (the default 256 KB cap is ours, not GCI's).
- **Self-audit + timing.** Each payload carries a count header (`S`/`N` lines)
  so the client can verify it received every class it asked for and that the
  framing parsed cleanly — any shortfall is surfaced as a warning with the
  missing names, never dropped silently. Each server response is also prefixed
  with its build time (`Time millisecondsElapsedTime:`); combined with the
  client wall-clock, the "GemStone Class Sync" output attributes a slow sync to
  the server (build) vs the network (net ≈ wall − server) vs the local disk,
  whose write/delete time is measured outside the request wall-clock and
  reported separately (`disk Nms (write Nms, delete Nms)`).

### Lifecycle and layout

- Default path: `{workspaceRoot}/.gemstone/{host}/{stone}/{user}/{index}-{dictName}/{Class}.gs`,
  keyed by connection target — shared across that target's sessions and **kept
  across logout** (re-synced incrementally next login). Overridable via
  `gemstone.exportPath`.
- Foreground, **cancellable** progress; the loop yields between batches so the
  Cancel button stays responsive (the GCI calls are synchronous and block the
  event loop). A cancelled sync leaves a consistent partial mirror that the next
  sync completes (state is persisted to reflect exactly what's on disk).
- Per-login **`sync_classes`** flag (checkbox in the login editor, defaults on).
  Turn it off for slow/remote connections; server-side search still works.
- Mirror files are written read-only (`chmod 0o444`) by default so they aren't
  edited directly. The **`gemstone.classSync.readOnlyMirror`** setting (default
  `true`) turns that off, which roughly halves the filesystem operations per
  class — a noticeable win on slow or network filesystems.
- Per-sync size/round-trip/timing is logged to the **"GemStone Class Sync"**
  output channel for tuning.

### Tuning knobs (`client/src/sync/syncProtocol.ts`)

- `SYNC_CHUNK_CHARS` (4 M) — code points per transport chunk. Bigger ⇒ fewer
  round trips (latency win) but a larger client buffer and a longer per-chunk
  event-loop stall on slow links.
- `SYNC_REFS_PER_BATCH` (400) — classes per content build (keeps the generated
  literal modest, each batch near one chunk).

## Keeping the mirror in step with mutations

Every code mutation now updates the mirror immediately, so Find in Files reflects
a change without waiting for the next commit/abort. `ExportManager` exposes three
targeted operations, all of which update the persisted `.manifest.json` state:

- `syncClass(session, dictName, className)` — re-file-out one class (resolving its
  dictionary index by name server-side, one round trip). Used for a method save,
  delete, recategorize, or class-comment/definition edit.
- `removeClassFile(session, dictIndex, dictName, className)` — drop a deleted/moved
  class's file and hash (index known by the caller, no round trip).
- `scheduleRefresh(session)` — debounced full re-sync for structural changes
  (dictionary add/remove/reorder, file-in) where indices shift and the manifest
  diff is the simplest correct reconciliation.

Wiring: `gemstoneFileSystemProvider.writeFile` (editor save → `syncClass`, or
`scheduleRefresh` for a brand-new class whose name isn't in the URI); the System
Browser context-menu/drag-drop handlers (delete class → `removeClassFile`; method
delete/recategorize/category-rename → `syncClass`; class move → remove+sync; dict
add/remove/reorder → `scheduleRefresh`, replacing the old raw `mkdir`/`rmSync`);
and `fileInManager` (file-in/dict-delete → `scheduleRefresh`, class-delete →
`removeClassFile`). The single-class hash equals the manifest's, so a follow-up
sync sees the class as unchanged and skips it. MCP mutations run in a separate
session and still reconcile on the IDE session's next sync.

## Deferred / follow-ups

- **Search-scope isolation.** With multiple persisted mirrors under `.gemstone`,
  native Find in Files searches all of them. When multi-login becomes common,
  set workspace `search.exclude` on login to hide all but the active mirror.
- **Async GCI for the manifest fetch.** The manifest build (~2 s on 5500
  classes) is one synchronous call that briefly stalls the event loop. Moving
  the transport to the async GCI path ("Display It") removes the stall.
- **Server-side change tracking.** The manifest re-hashes every class each sync
  (server CPU, O(classes)). A GemStone "what changed since commit N" primitive
  would make refresh O(changes). Not available today.
