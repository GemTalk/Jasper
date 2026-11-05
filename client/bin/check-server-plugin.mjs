//
// Launcher for the test-run check that the test stone's server plugin is this
// checkout's; the logic is in `checkServerPluginMain.ts`. This file only installs
// a `vscode` stub first: outside the extension host there is no `vscode` module,
// yet the GCI code requires it as it loads, and the stub must be in place before
// any static import runs. Full explanation in install-server-plugin.mjs.
//
//   npm run test:server:check-plugin

import Module from 'node:module';

const originalModuleLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    // `withProgress`: installing over a plugin with no receipt reports progress.
    return {
      ProgressLocation: { Notification: 15 },
      window: {
        createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }),
        withProgress: (_options, task) =>
          task(
            { report: () => {} },
            {
              isCancellationRequested: false,
              onCancellationRequested: () => ({ dispose: () => {} }),
            },
          ),
      },
    };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};

await import('./checkServerPluginMain.ts');
