//
// Launcher for the check that the test stone's server plugin is the one in this
// checkout. The real logic lives in `checkServerPluginMain.ts`; this file
// only installs a `vscode` stub first. Outside the extension host there is no
// `vscode` module, yet the GCI code requires it as it loads, and the stub has
// to be in place before any static import runs, hence a separate file. The
// full explanation is in install-server-plugin.mjs. Run before every test run by
// `src/__tests__/serverPluginMatch.globalSetup.ts`, and by hand with:
//
//   npm run test:server:check-plugin

import Module from 'node:module';

const originalModuleLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    // `withProgress` for the install of an engine with no receipt; see
    // install-server-plugin.mjs.
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
