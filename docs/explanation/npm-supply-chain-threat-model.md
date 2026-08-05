# npm supply-chain threat model

## The worm class

A compromised npm dependency can execute arbitrary code on a developer's or CI runner's machine at **install time**, before any lint, test, or code review ever runs against it — via a `preinstall`, `install`, or `postinstall` script (`prepare` too, for non-registry sources). The Shai-Hulud ("SHA1-Hulud") worm class used exactly this: a `preinstall` script that harvested credentials and republished itself into the victim's own packages. `npm audit` and a clean lockfile don't help here — they evaluate known-vulnerable *versions*, not *install-time behavior* of a version nobody's flagged yet.

## Why version-pinning is the load-bearing part

`allowScripts` entries are version-pinned by default (`allow-scripts-pin=true`). This is the actual worm defense: approving `esbuild@0.28.1`'s install script once does not approve `esbuild@0.28.2`'s. A compromised patch of an already-approved package becomes an *unreviewed* verdict and fails the install with `ESTRICTALLOWSCRIPTS`, rather than silently running because the package name was already trusted. Package identity for this check comes from the lockfile's `resolved` URL, not the tarball's self-reported name, so a malicious package can't spoof its way past an approval meant for something else.

The corollary: every Dependabot bump of an approved package fails CI until a human re-approves it. That friction is the control working as intended (see [docs/how-to/add-a-dependency-with-install-scripts.md](../how-to/add-a-dependency-with-install-scripts.md)), not a bug to route around.

## Why `strict-allow-scripts`, not `ignore-scripts`

`ignore-scripts=true` blocks every install script unconditionally, which also breaks approved packages that legitimately need one (e.g. `koffi`'s platform-binary linking) — recovering from that means a manual `npm rebuild` bootstrap on every install, forever.

`strict-allow-scripts=true` instead makes npm's per-package `allowScripts` allowlist **fail-closed**: an unreviewed script throws `ESTRICTALLOWSCRIPTS` before reify (before any dependency script runs), while an *approved* one runs exactly as it would without the control. Steady-state work — approved packages installing normally — has zero added friction; only adding or bumping an install-script dependency does.

## Why npm 12 was rejected

npm 12's `engines.node` (`^22.22.2 || ^24.15.0 || >=26.0.0`) excludes Node 22.15.1, which the CI floor job deliberately runs (the Node bundled by the oldest VS Code we support). Reaching npm 12 there would mean raising the VS Code floor — a separate, unrelated decision. It would also buy nothing: npm 12 only makes the same defaults (`strict-allow-scripts`, `allow-git`, `allow-remote`) the out-of-the-box behavior; the controls themselves are unchanged.

## What these controls do not cover

`strict-allow-scripts` gates install-time script execution only. It does nothing about dependency code that runs at:

- **Build or test time** — ESLint plugins, the Vitest config, `tsx`, lefthook hooks all execute arbitrary JS as part of normal development, entirely outside the install-script gate.
- **Runtime, in the extension host** — once a dependency is loaded and its code runs as part of the extension, no install-time control applies.

`allow-remote=none` restricts dependency *specs* that point at a URL instead of a registry version; it is not a network sandbox — an approved script can still make outbound requests. SHA1-Hulud specifically used a `preinstall` script, so this PR's controls target the actual worm mechanism — but they are not a general-purpose sandbox, and documentation should not imply they are.
