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

The transforms run the same on macOS and Linux — they pipe through a temp file rather than using
`sed -i`, whose argument GNU and BSD sed disagree about (#429). Note that the copy step overwrites
the payload *before* transforming, so if the transforms do fail the working tree holds
untransformed upstream, which will not install into a stone; the script says so and exits non-zero,
and `git checkout -- resources/enhancedInspector` puts it back.
