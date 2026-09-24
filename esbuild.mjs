import * as esbuild from 'esbuild';

/**
 * An assertion this file makes about a build, distinct from an esbuild
 * diagnostic -- the catch block below needs to tell the two apart to know
 * what still needs printing.
 */
class BuildAssertionError extends Error {}

/**
 * Neither telemetry.ts nor the `@vscode/extension-telemetry` package it wraps
 * may reach the server or MCP server bundles: neither runs inside the
 * extension host, so there is nothing there to enforce the user's telemetry
 * setting (see client/src/telemetry.ts). ESLint's `no-restricted-imports`
 * catches a direct import of telemetry.ts, but not a rename, a re-export, or
 * a facade module -- checking the graph esbuild actually built catches all of
 * those. The package check is the ultimate guard: it also catches a file that
 * imports `@vscode/extension-telemetry` directly, bypassing telemetry.ts
 * entirely -- that package requires `vscode` itself, and constructing its
 * reporter is exactly what would ship real events with nothing enforcing
 * consent.
 */
function assertNoTelemetryInBundle(outfile, result) {
  if (!result.metafile) return;
  const inputs = Object.keys(result.metafile.inputs);
  const reachedOwnModule = inputs.some((input) => input.endsWith('client/src/telemetry.ts'));
  const reachedPackage = inputs.some((input) =>
    input.includes('node_modules/@vscode/extension-telemetry/'),
  );
  if (reachedOwnModule || reachedPackage) {
    throw new BuildAssertionError(
      `${outfile} pulled in ${reachedOwnModule ? 'client/src/telemetry.ts' : '@vscode/extension-telemetry'}. ` +
        "There is no extension host there to enforce the user's telemetry setting -- this must never ship.",
    );
  }
}

try {
  const serverResult = await esbuild.build({
    entryPoints: ['server/src/server.ts'],
    bundle: true,
    outfile: 'server/out/server.js',
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
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
} catch (e) {
  // esbuild has already printed its own diagnostics; rethrowing would bury
  // them under a Node stack trace that says nothing extra. A
  // BuildAssertionError is not an esbuild diagnostic, so it still needs to be
  // seen.
  if (e instanceof BuildAssertionError) console.error(e.message);
  process.exit(1);
}
