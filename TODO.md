# Open Issues & Future Work

## MCP Server Feedback

External feedback (see `Grail/docs/MCP_Server_Feedback.md`) from a Claude Code session that
exercised the `gemstone` MCP server retroactively after a CLI workflow. Items grouped by impact.

### Shipped

- `execute_code` block-wraps input — multi-statement bodies and temp declarations parse.
- `find_implementors` / `find_senders` / `find_references_to` hint at env 1 when env 0 search is empty.
- `status`, `run_test_class`, `run_test_method`, `list_failing_tests` auto-refresh-if-clean
  before reading. New `refresh` tool exposes the same primitive explicitly.
- `list_failing_tests` (with optional `classNames`) runs the suite and returns only failures —
  iteration happens in Smalltalk so it's a single GCI round-trip.
- `list_test_classes` enumerates TestCase subclasses for filtering before `list_failing_tests`.
- Actionable validator errors. Per-schema zod error map (not global — global breaks the SDK's
  protocol parsing) rewrites missing-parameter and wrong-type messages to name the offending
  field, e.g. `"Missing required parameter 'isMeta' (expected boolean)."`. A typo like
  `methodName` for `selector` surfaces as a missing-required error on `selector`, which is
  enough for an agent to recover.
- `describe_test_failure` — re-runs a single test with its own `AbstractException` handler
  (bypasses `TestCase>>run`, which would swallow the exception) and returns structured details:
  `exceptionClass`, GemStone `errorNumber`, clean `messageText`, `description`, plus
  `mnuReceiver` and `mnuSelector` for `MessageNotUnderstood`, and a multi-line `stackReport`
  with frames in `Class >> selector @ip line N [GsNMethod oop]` format. Stack capture is
  enabled by toggling `GemExceptionSignalCapturesStack` on around the run and restoring it
  via `ensure:` so the gem isn't left in a different state.
- Bug fix: `runTestClass.ts` and `runFailingTests.ts` were sending `each testCase class name`
  to objects that don't respond to `#testCase` (the items in `result failures` / `result errors`
  are TestCase instances themselves with only `testSelector` ivar). On a real failure the
  queries would silently DNU; tests mock the output so it wasn't caught. Now uses the direct
  `each class name` / `each selector`, matching the `passed` branch.
- `eval_python` / `compile_python` — register unconditionally on both surfaces, gracefully
  detect Grail (GemStone-Python) by `objectNamed:` lookup of `ModuleAst`. With Grail loaded:
  `eval_python` returns `(ModuleAst evaluateSource: src) printString`, `compile_python`
  returns `(ModuleAst parseSource: src) smalltalkSource`. Without Grail: returns a
  human-readable hint pointing at the missing class. Grail-side compile / runtime errors
  are caught and reported inline as `Error: <class> — <messageText>`. Direct class
  references (`ModuleAst evaluateSource: ...`) wouldn't work — that's a compile-time symbol
  in our query source, not a runtime send, so a missing `ModuleAst` would fail the parse
  before any handler could run. Dynamic resolution makes Grail's absence a runtime branch.

### Still open

(none)

### Rejected (with rationale)

- **`compile_method_from_file` + `save_to_file`.** The original feedback came from a Grail
  session running outside an editor, with a hot loop of `edit .gs file → install.sh
  (recompiles 114 classes, ~30s) → test`. The proposed tools were shortcuts around that
  install.sh roundtrip. Jasper's workflow is different: [fileInManager.ts](client/src/fileInManager.ts)
  already auto-files-in `.gs` saves to the running stone, so the agent's existing `Edit` tool
  + VS Code save covers the same need. Adding `save_to_file` would actively introduce a
  second write path competing with the editor's save handler — a stale-disk-vs-stale-stone
  race the existing pipeline already avoids. `compile_method_from_file` would offer
  parser-aware "extract just method X" extraction over what `Read` + `compile_method`
  already does, but the gap is small and not worth the new surface area for Jasper users.

## Ideas

Several former entries now live in the issue tracker or as roadmap themes (see
[ROADMAP.md](ROADMAP.md)); those are pointers below. The rest are still-unfiled ideas.

- **Configurable Rowan repo location** — Rowan repos currently always land in the open
  workspace (git clones and copied-in local folders alike), and the sidebar Repositories list
  is filtered to the workspace. Make this configurable: open workspace vs the extension's
  global storage vs tracking a local folder in place. See `rowanWorkspaceDest` /
  `workspaceRepos` (both marked `TODO` in the source).
- **Code Snippets** — tracked as [#305](https://github.com/GemTalk/Jasper/issues/305).
- **Lint / Warnings** — tracked under roadmap theme [#294](https://github.com/GemTalk/Jasper/issues/294) (code critics / lint).
- **Bookmarks** — tracked as [#306](https://github.com/GemTalk/Jasper/issues/306).
- **Notebook API for Workspaces** — Smalltalk workspace with persistent bindings per cell.
- **Method History / Versions** — tracked under roadmap theme [#290](https://github.com/GemTalk/Jasper/issues/290) (method-level code history).
- **Split systemBrowser.ts** — Extract HTML and handlers into separate files.
- **Code Actions (Lightbulb)** — Quick fixes: "Define method", "Declare temp", "Extract to method".
- **Rename Symbol** — the rename-method/class refactorings themselves shipped
  (`gs-src/refactoring/engine/` plus the editor/Explorer commands); the remaining piece,
  LSP F2 rename, is tracked under roadmap theme [#291](https://github.com/GemTalk/Jasper/issues/291) via [#231](https://github.com/GemTalk/Jasper/issues/231).
- **Inlay Hints** — Show return types and argument names inline.
- **Signature Help** — Keyword argument hints as you type.
- **Call Hierarchy** — Senders and implementors as incoming/outgoing call trees.
- **Source Control API** — GemStone method versions as a timeline provider.
- **Workspace Variables** — Persistent bindings across evaluations (like Jade). Not yet
  tracked as an issue.
- **All Instances / References** — Jade-style object queries.
- **Breakpoint Conditions** — tracked under roadmap theme [#277](https://github.com/GemTalk/Jasper/issues/277) (debugging parity).
- **System Administration** — the base tooling shipped (Databases view, Quick Setup,
  backup/restore, process management); further work is tracked as the `sysadmin` roadmap
  themes in [ROADMAP.md](ROADMAP.md) ([#279](https://github.com/GemTalk/Jasper/issues/279)–[#282](https://github.com/GemTalk/Jasper/issues/282), [#298](https://github.com/GemTalk/Jasper/issues/298)–[#300](https://github.com/GemTalk/Jasper/issues/300)).

## Bugs

(none currently listed here — bugs are tracked as [GitHub issues](https://github.com/GemTalk/Jasper/issues))

## Known Limitations

- **Detecting in-session commit/abort/continue**: If a user executes `System commit`, `System abort`, or `System continueTransaction` from a workspace (directly or indirectly via other code), the exported files become stale without the extension knowing. Possible approaches:
  - Poll `System transactionMode` periodically
  - Hook into GCI execution to inspect post-execution state
  - Require users to use the extension's commit/abort commands (document as limitation)

  Tracked as roadmap theme [#278](https://github.com/GemTalk/Jasper/issues/278) (transaction awareness in the IDE).

- **Multiple sessions with same credentials**: If two sessions are logged in with the same host/stone/user (and no per-login `exportPath`), they will share the same export directory. Edits in one session's files will be filed in to whichever session matches first. Use distinct `exportPath` templates on each login to avoid this.

## Deferred Optimizations

- **Method-level diffing**: Instead of filing in the entire class on save, diff against the previous version and only compile changed methods. Defer until whole-class file-in proves too slow.

