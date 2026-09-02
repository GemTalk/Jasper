# Output channels

Jasper writes diagnostics and activity logs to VS Code **Output channels**
(the *Output* view; pick a channel from its dropdown). All but one are created
during `activate()` so the set is discoverable up front — before any of
them has produced a line — rather than appearing only the first time a feature
runs; the exception is **GemStone Refactoring**, created lazily on the first
refactoring-engine install.

| Channel | Created by | What it shows |
|---|---|---|
| **Jasper** | `extension.ts` (`activate`) | Top-level extension activity and general logging. |
| **GemStone GCI** | `gciLog.ts` (`getGciLog`) | Error lines (`logError`) from debug sessions, code execution, and notebooks, plus informational traces (`logInfo`) — session login/logout, debugger stepping, `[FS]` filesystem-provider activity, refactoring commands, object-graph reference scans. Each line is timestamped `[HH:MM:SS.mmm]`. |
| **GemStone Transcript** | `transcriptChannel.ts` (`getTranscriptChannel`) | Server-side `Transcript` output (see [the Transcript sink](../CLAUDE.md)). Live during Execute/Display/Inspect It and notebook cells; buffered-then-drained elsewhere. |
| **GemStone Admin** | `sysadminChannel.ts` (`getSysadminChannel`) | Stone / NetLDI process management — `startstone`, `stopstone`, `gslist`, stale-lock handling. |
| **GemStone Class Sync** | `exportManager.ts` (`ensureLogChannel`) | The incremental `.gemstone` mirror sync (see [incremental-class-sync.md](incremental-class-sync.md)). |
| **GemStone Enhanced Inspector Perf** | `extension.ts` (`activate`) | Enhanced Inspector round-trip counts, for perf tuning. Populated only while perf tracking is enabled. |
| **GemStone Smalltalk Language Server** | `vscode-languageclient` (`client.start()`) | The LSP server's log/trace (parsing, completion, diagnostics). Named from the `LanguageClient` display name; its verbosity follows the `gemstoneSmalltalk.trace.server` setting. |
| **GemStone Refactoring** | `refactoringInstallCommand.ts` (`getReportChannel`) | The refactoring-engine loader's completeness report. Created lazily on the first install rather than during `activate()`. |

## The GemStone GCI channel

`gciLog.ts` is the shared logger for GemStone interaction. It exports two
functions:

- `logError(sessionId, message)` records an error, tagged with the session id
  (e.g. `[Session 1] ERROR: ...`).
- `logInfo(message)` records an informational line; callers include their own
  context tag, e.g. `[Session 1]`, `[FS]`, `[Workspace]`, `[extractMethod]`.

```
[14:03:09.087] [Session 1] Debug: stepOver from level 1
[14:03:09.129] [FS] writeFile → success (method)
```

Every line carries the `[HH:MM:SS.mmm]` timestamp; the logger does not track
call durations.

## Conventions for adding a channel

- Create it during `activate()` (directly, or via a module getter called from
  `activate()`), and push it to `context.subscriptions` for disposal.
- Prefix the display name with `GemStone ` for anything tied to a live session,
  so the channels sort together in the dropdown.
- Add a row to the table above.
