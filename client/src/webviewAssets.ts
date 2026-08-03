import * as fs from 'fs';
import * as path from 'path';

// Loads a webview script — plain JS that runs in the webview DOM and is
// deliberately NOT bundled into the extension (read at runtime, see the client
// workspace conventions). The scripts live alongside their owning panels, so a
// feature folder passes its own directory name as `subdir`.
//
// The lookup has to work in three layouts:
//   • Bundled runtime — `extension.js` sits in `client/out/`, so `__dirname` is
//     `client/out` and the scripts are at `../src/<subdir>/`.
//   • From source (unit tests, ts-node) — `__dirname` is `client/src` and the
//     scripts sit in `<subdir>/` beside this module; `../src/<subdir>/` collapses
//     back to the same place.
//   • tsc's per-file `client/out` emit (the F5 debug build) — `allowJs` compiles
//     these scripts into `client/out/<subdir>/` too, but that copy is stamped as
//     a CJS module (`exports` reference) and throws in the webview DOM, which has
//     no module system. We must not pick it up, so we always resolve against
//     `../src/` first and never fall back to the `__dirname`-adjacent path.
export function readWebviewScript(fileName: string, subdir?: string): string {
  return fs.readFileSync(path.join(__dirname, '..', 'src', subdir ?? '', fileName), 'utf8');
}
