# Enhanced Inspector support (build tooling)

The Enhanced Inspector payload is [feenk's GToolkit](https://github.com/feenkcom) remote-inspector
support, vendored into a stone as GemStone Smalltalk (`.gs`) and filed into the dedicated
`GsEnhancedInspector` dictionary. See
[`enhancedInspectorInstall.ts`](../../client/src/enhancedInspector/enhancedInspectorInstall.ts) for
how the extension installs it into a running stone.

Unlike [`gs-src/refactoring/`](../refactoring/), **this directory holds no vendored source** — only
the build tooling. The source of truth is four upstream repos, cloned locally into
`$ROWAN_PROJECTS_HOME`:

- `gt4gemstone` — github.com/feenkcom/gt4gemstone
- `gtoolkit-remote` — github.com/feenkcom/gtoolkit-remote
- `gtoolkit-wireencoding` — github.com/feenkcom/gtoolkit-wireencoding
- `RemoteServiceReplication` — github.com/GemTalk/RemoteServiceReplication

`build/update_enhanced_inspector_support.sh` copies the relevant files out of those checkouts,
re-applies Jasper's post-processing (attribution headers, class placement into
`GsEnhancedInspector`) via `build/apply_jasper_transforms.sh`, and writes the result to
[`resources/enhancedInspector/`](../../resources/enhancedInspector/) — commit the regenerated
`.gs` files there alongside any upstream bump.

## Regenerating

```sh
export ROWAN_PROJECTS_HOME=/path/to/your/checkouts   # gt4gemstone, gtoolkit-remote,
                                                       # gtoolkit-wireencoding, RemoteServiceReplication
gs-src/enhancedInspector/build/update_enhanced_inspector_support.sh
```

> ⚠️ **Known broken on macOS.** Both `sed -i` calls in `apply_jasper_transforms.sh` (lines 49 and 53)
> use GNU syntax; BSD sed consumes the next argument as a backup suffix. Line 49 silently no-ops the
> placement rewrite and leaves a stray `<file>.gs-E`; line 53 hard-errors. Because `update_…sh` copies
> pristine upstream over the payload *before* transforming and has no `set -e`, running it on macOS
> **destroys the committed payload and still prints `Update complete.`** Run on Linux until this is
> fixed.
