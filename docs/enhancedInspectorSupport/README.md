# Enhanced Inspector Support for GemStone

Loads enhanced inspector support into a plain-vanilla GemStone server.

> **Note:** the payload `.gs` files now live in `resources/enhancedInspector/`
> (so they ship in the packaged VSIX). The scripts here operate on that
> directory; only the developer scripts remain in `docs/enhancedInspectorSupport/`.

## Scripts

- **`update_enhanced_inspector_support.sh`** — refreshes the `.gs` files from the upstream project checkouts in `$ROWAN_PROJECTS_HOME`. Run this when the upstream projects have been updated.
- **`apply_jasper_transforms.sh`** — re-applies Jasper's post-processing (attribution headers, class placement into the dedicated `GsEnhancedInspector` dictionary) to the payload files. Invoked automatically by the update script; run it manually only if you edited the payload files some other way.

## Updating the .gs Files

Set `$ROWAN_PROJECTS_HOME` to the directory containing the four project clones
(three feenk projects plus GemTalk's RemoteServiceReplication),
pull the latest from each repo (see the comments in that script for the repo list),
then run the update script:
```
./update_enhanced_inspector_support.sh
```
