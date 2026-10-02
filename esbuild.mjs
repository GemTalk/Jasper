import * as esbuild from 'esbuild';

/**
 * Neither telemetry.ts nor the `@vscode/extension-telemetry` package it wraps
 * may reach the server or MCP server bundles: neither runs inside the
 * extension host, so there is nothing there to enforce the user's telemetry
 * setting (see client/src/telemetry.ts). The LSP server reports an event by
 * sending a `telemetry/event` notification, which the client receives in
 * `client.onTelemetry` and passes to a `report*` function in telemetry.ts.
 * ESLint's `no-restricted-imports` catches a direct import of telemetry.ts,
 * but not a rename, a re-export, or a facade module -- checking the graph
 * esbuild actually built catches all of those. The package check is the
 * ultimate guard: it also catches a file that imports
 * `@vscode/extension-telemetry` directly, bypassing telemetry.ts entirely --
 * that package requires `vscode` itself, and constructing its reporter is
 * exactly what would ship real events with nothing enforcing consent.
 */
function assertNoTelemetryInBundle(outfile, result) {
  if (!result.metafile) return;
  const inputs = Object.keys(result.metafile.inputs);
  const reachedOwnModule = inputs.some((input) => input.endsWith('client/src/telemetry.ts'));
  const reachedPackage = inputs.some((input) =>
    input.includes('node_modules/@vscode/extension-telemetry/'),
  );
  if (reachedOwnModule || reachedPackage) {
    throw new Error(
      `${outfile} pulled in ${reachedOwnModule ? 'client/src/telemetry.ts' : '@vscode/extension-telemetry'}. ` +
        "There is no extension host there to enforce the user's telemetry setting -- this must never ship.",
    );
  }
}

const serverResult = await esbuild.build({
  entryPoints: ['server/src/server.ts'],
  bundle: true,
  outfile: 'server/out/server.js',
  platform: 'node',
  format: 'cjs',
  sourcemap: true,
  target: 'node22.15.1',
  metafile: true,
});
assertNoTelemetryInBundle('server/out/server.js', serverResult);

await esbuild.build({
  entryPoints: ['client/src/extension.ts'],
  bundle: true,
  outfile: 'client/out/extension.js',
  platform: 'node',
  format: 'cjs',
  external: ['vscode', 'koffi'],
  sourcemap: true,
  target: 'node22.15.1',
});

const mcpResult = await esbuild.build({
  entryPoints: ['mcp-server/src/index.ts'],
  bundle: true,
  outfile: 'mcp-server/out/index.js',
  platform: 'node',
  format: 'cjs',
  external: ['koffi'],
  sourcemap: true,
  metafile: true,
});
assertNoTelemetryInBundle('mcp-server/out/index.js', mcpResult);
