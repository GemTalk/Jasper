# Enhanced Inspector payload (generated — do not edit by hand)

These `*.gs` files are **vendored, generated build artifacts**, not source written for this repo.
They are the GemStone-side [feenk GToolkit](https://github.com/feenkcom) remote-inspector support
that [`enhancedInspectorInstall.ts`](../../client/src/enhancedInspector/enhancedInspectorInstall.ts)
files into a stone (server-side, via `GsFileIn`) when a user runs the extension's "Install Server
Support" command. They ship as runtime assets in the VSIX, which is why they live under
`resources/` alongside the other shipped bundles (`resources/refactoring/`,
`resources/walkthrough/`, …).

**The source of truth is the four upstream repos referenced from
[`gs-src/enhancedInspector/`](../../gs-src/enhancedInspector/)** — there is no vendored Tonel source
in this repo, unlike `gs-src/refactoring/`. Do not edit these `.gs` files directly — your change will
be overwritten. Instead regenerate from upstream:

```sh
gs-src/enhancedInspector/build/update_enhanced_inspector_support.sh
```

## The payloads (filed in, in this order)

| File | What it is |
|---|---|
| `Announcements.gs` | feenk's Announcement framework, used by the remote-inspector notifications |
| `RemoteServiceReplication.gs` | GemTalk's service-replication bootstrap connecting the stone to the remote-inspector transport |
| `STON.gs` | Smalltalk Object Notation serialization, used to wire-encode inspector data |
| `patch-gemstone.gs` | Small kernel patches GT needs that can't be shipped as extension methods |
| `gtoolkit-wireencoding.gs` | The wire-encoding scheme for GToolkit's remote protocol |
| `gt4gemstone.gs` | The core GT4GemStone remote-inspector views and bindings |
| `gtoolkit-remote.gs` | The GToolkit remote-inspector protocol (`RemotePhlow` objects and friends) |

This order is load-bearing — it must match `ENHANCED_INSPECTOR_FILES` in
[`enhancedInspectorInstall.ts`](../../client/src/enhancedInspector/enhancedInspectorInstall.ts), which
is the sole authority on load order.

See [`gs-src/enhancedInspector/README.md`](../../gs-src/enhancedInspector/README.md) for the
regeneration workflow and its macOS warning.
