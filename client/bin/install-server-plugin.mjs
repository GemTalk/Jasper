//
// Launcher for the CI provisioning script that installs the Jasper Server
// Plugin so the integration suite runs a second time in the "plugin present"
// world. The real logic lives in `installServerPluginMain.ts`, imported
// straight from `client/src` (type-checked via `client/tsconfig.bin.json`,
// no compiled-output staleness to worry about). Runs only under `tsx` — see
// `npm run test:server:install-plugin` below — plain `node` can't resolve
// the `.ts` import.
//
// This file exists only to install a `vscode` stub via `Module._load` before
// that import runs: static imports evaluate before any module-body code, so
// the patch can't live in the same file as the imports it must precede. Some
// modules reachable from the main script (transitively, gciLog.ts) `require
// ('vscode')` at load time to get an output channel for incidental logging we
// don't care about here; there's no real `vscode` module outside the
// extension host.
//
// Follow-up ticket (Grail): retire this stub by making the GCI install path
// loadable outside the extension host, so this indirection goes away too.
//
//   npm run test:server:install-plugin

import Module from 'node:module';

const originalModuleLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      window: {
        createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }),
      },
    };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

await import('./installServerPluginMain.ts');
