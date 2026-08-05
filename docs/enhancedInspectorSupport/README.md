# Enhanced Inspector Support for GemStone

Loads enhanced inspector support into a plain-vanilla GemStone server.

> **Note:** the payload `.gs` files now live in `resources/enhancedInspector/`
> (so they ship in the packaged VSIX). The scripts here operate on that
> directory; only the developer scripts remain in `docs/enhancedInspectorSupport/`.

## Quick Start

1. Start your stone and ensure a `.topazini` file is present in the current directory.
2. Set `$GEMSTONE` to the GemStone product directory.
3. Run:
   ```
   /path/to/enhancedInspectorSupport/load_enhanced_inspector_support.sh
   ```

## Scripts

- **`load_enhanced_inspector_support.sh`** — loads the seven `.gs` files into a running stone. This is all you need.
- **`update_enhanced_inspector_support.sh`** — refreshes the `.gs` files from the upstream project checkouts in `$ROWAN_PROJECTS_HOME`. Run this when the upstream projects have been updated.
- **`apply_jasper_transforms.sh`** — re-applies Jasper's post-processing (attribution headers, Globals→Published placement) to the payload files. Invoked automatically by the update script; run it manually only if you edited the payload files some other way.

## Updating the .gs Files

Set `$ROWAN_PROJECTS_HOME` to the directory containing the four project clones
(three feenk projects plus GemTalk's RemoteServiceReplication),
pull the latest from each repo (see the comments in that script for the repo list),
then run the update script:
```
./update_enhanced_inspector_support.sh
```

## Use with Acme Licensing Demo

Log in to Topaz as DataCurator and input `IMCSystem-gtViews.gs` (no script for this one).
