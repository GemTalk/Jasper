import * as fs from 'fs';
import * as path from 'path';

// Loads a webview script — plain JS that runs in the webview DOM and is
// deliberately NOT bundled into the extension (read at runtime, see the client
// workspace conventions). The scripts live alongside their owning panels, so a
// feature folder passes its own directory name as `subdir`.
//
// The lookup has to work in two layouts:
//   • Bundled runtime — `extension.js` sits in `client/out/`, so `__dirname` is
//     `client/out` and the scripts are at `../src/<subdir>/`.
//   • From source (unit tests, ts-node) — `__dirname` is `client/src` and the
//     scripts sit in `<subdir>/` beside this module.
// We try the source-adjacent path first, then fall back to the bundled path (and
// let that path surface in the error if neither exists).
export function readWebviewScript(fileName: string, subdir?: string): string {
  const beside = path.join(__dirname, subdir ?? '', fileName);
  if (fs.existsSync(beside)) {
    return fs.readFileSync(beside, 'utf8');
  }
  return fs.readFileSync(path.join(__dirname, '..', 'src', subdir ?? '', fileName), 'utf8');
}
