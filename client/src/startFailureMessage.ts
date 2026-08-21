/**
 * Messages for the two ways starting or stopping a GemStone server fails
 * unhelpfully: an install Jasper cannot locate, and a GemStone shell script
 * complaining about its own environment.
 *
 * Both are here, free of vscode and of ProcessManager, because the wording *is*
 * the fix — each of these replaced a message that sent users off to debug the
 * wrong thing — and wording is only worth having if it can be pinned down by a
 * test.
 */

/** The GemStone shell scripts' own complaint when they are run without
 *  `GEMSTONE` set. Relayed verbatim it reads as a broken shell profile, which
 *  is almost never what is wrong. */
const BARE_GEMSTONE_UNDEFINED = /GEMSTONE environment variable is not defined/i;

/** True when a child's output is the shell scripts' bare environment complaint. */
export function isBareGemstoneUndefined(output: string): boolean {
  return BARE_GEMSTONE_UNDEFINED.test(output);
}

/**
 * What to say when Jasper has no install directory for a version.
 *
 * Deliberately not phrased as "the install path isn't configured": a user who
 * just installed that version reads that as Jasper losing a setting, and goes
 * looking through Settings for a path field that does not exist. What actually
 * happened is that Jasper looked for a directory of a particular name under the
 * root it manages and did not find one — so the message says where it looked,
 * which is both the diagnosis and the fix.
 */
export function explainMissingInstall(version: string, rootPath: string): string {
  return (
    `Jasper has no GemStone ${version} install under ${rootPath}. It looks for a ` +
    `"GemStone64Bit${version}…" directory there, and installs elsewhere on this machine are ` +
    `not visible to it. Download or extract ${version} in the Versions view — or, if it is ` +
    `already installed somewhere else, register that directory as a local version.`
  );
}

/**
 * Replace a child process's bare `GEMSTONE environment variable is not defined`
 * with something that names the real situation, or return undefined to let the
 * original output stand.
 *
 * Jasper's own start path always sets `GEMSTONE` — a clean Jasper start and
 * connect works even with `GEMSTONE` unset in the shell — so this error never
 * means what it says. In practice it shows up when the command was aimed at a
 * server that is registered outside Jasper's environment: the script gets far
 * enough to hand off to another script that inherits a different environment,
 * and complains about the variable rather than about the mismatch. Passing that
 * through sends the user into their shell profile after a problem that is not
 * there.
 */
export function explainStartFailure(
  label: string,
  output: string,
  gemstonePath: string,
): string | undefined {
  if (!isBareGemstoneUndefined(output)) return undefined;
  return (
    `${label} failed. GemStone reported that its GEMSTONE environment variable is not ` +
    `defined, but Jasper did set it, to ${gemstonePath} — so this is not a problem with ` +
    `your shell profile or your GemStone install.\n\n` +
    `This usually means the command reached a server that was started outside Jasper's ` +
    `environment and is registered where Jasper's own gslist does not look. Refresh the ` +
    `Databases view: a server in that state is shown as started outside Jasper, and Jasper ` +
    `can offer to restart it under its own environment.\n\n${output}`
  );
}
