# npm supply-chain threat model

Background for the controls listed in [docs/reference/supply-chain-controls.md](../reference/supply-chain-controls.md): what they defend against, and why they are shaped the way they are. Worth reading before loosening one.

## The threat: install-time execution

A compromised npm dependency can execute arbitrary code on a developer's or CI runner's machine at **install time**, before any lint, test, or code review ever runs against it — via a `preinstall`, `install`, or `postinstall` script (`prepare` too, for non-registry sources). The Shai-Hulud ("SHA1-Hulud") worm used exactly this: a `preinstall` script that harvested credentials and republished itself into the victim's own packages. `npm audit` and a clean lockfile don't help here — they evaluate known-vulnerable *versions*, not the install-time behavior of a version nobody has flagged yet.

## Version-pinning is the load-bearing part

`allowScripts` entries are version-pinned by default (`allow-scripts-pin=true`), and that pin is the actual worm defense: approving `esbuild@0.28.1`'s install script does not approve `0.28.2`'s. A compromised patch of an already-approved package becomes an *unreviewed* verdict and fails the install with `ESTRICTALLOWSCRIPTS`, rather than running silently because the package name was already trusted. Package identity for the check comes from the lockfile's `resolved` URL, not the tarball's self-reported name, so a package can't spoof its way past an approval meant for something else.

The corollary is that every Dependabot bump of an approved package fails CI until a human re-approves it. That friction is the control working ([how to clear it](../how-to/add-a-dependency-with-install-scripts.md)), not a bug to route around.

## Why `strict-allow-scripts` rather than `ignore-scripts`

`ignore-scripts=true` blocks every install script unconditionally, including for approved packages that legitimately need one (e.g. `koffi`'s platform-binary linking) — recovering from that means a manual `npm rebuild` bootstrap on every install, forever.

`strict-allow-scripts=true` instead makes npm's per-package `allowScripts` allowlist **fail-closed**: an unreviewed script throws `ESTRICTALLOWSCRIPTS` before reify (before any dependency script runs), while an approved one runs exactly as it would without the control. Steady-state work carries no added friction; only adding or bumping an install-script dependency does.

npm 12 makes `strict-allow-scripts`, `allow-git` and `allow-remote` its out-of-the-box defaults, but it is not reachable here: its `engines.node` excludes Node 22.15.1, which the CI floor job deliberately runs (the Node bundled by the oldest VS Code we support). The controls themselves are the same either way, so nothing is lost by configuring them explicitly on npm 11.

## What these controls do not cover

`strict-allow-scripts` gates install-time script execution only. It does nothing about dependency code that runs at:

- **Build or test time** — ESLint plugins, the Vitest config, `tsx` and lefthook hooks all execute arbitrary JS as part of normal development, entirely outside the install-script gate.
- **Runtime, in the extension host** — once a dependency is loaded and running as part of the extension, no install-time control applies.

`allow-remote=none` restricts dependency *specs* that point at a URL instead of a registry version, and still permits the configured registry hostname — so a scoped `@foo:registry=` override slips past it. It is not a network sandbox either: an approved install script can still make outbound requests.
