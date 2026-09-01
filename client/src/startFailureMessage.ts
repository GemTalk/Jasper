/**
 * Messages for the two ways starting or stopping a GemStone server fails
 * unhelpfully: an install Jasper cannot locate, and GemStone itself complaining
 * about its own environment.
 *
 * Both are here, free of vscode and of ProcessManager, because the wording *is*
 * the fix — each of these replaced a message that sent users off to debug the
 * wrong thing — and wording is only worth having if it can be pinned down by a
 * test.
 */

/**
 * GemStone's own complaint when a command runs without `GEMSTONE` set.
 *
 * The two alternatives are the real message templates, lifted out of the
 * `startstone` binary rather than paraphrased:
 *
 *     %s[Error]: The environment variable '%s' is not defined.
 *     NRS Parse Error: the environment variable '%s' is not defined.
 *
 * The first form is what actually reaches users; the second fires when an NRS
 * string references an unset variable. An earlier version of this matcher was
 * written from the wording in the issue report — "GEMSTONE environment variable
 * is not defined" — which is a *paraphrase* GemStone never emits, so it matched
 * nothing in practice while its tests passed against the same paraphrase. That
 * wording is kept as a third alternative only so anyone quoting the issue still
 * gets a hit.
 *
 * Deliberately anchored on a `GEMSTONE`-prefixed variable name: an unset `PATH`
 * or `HOME` is a different problem and must not be explained away as this one.
 */
const BARE_GEMSTONE_UNDEFINED =
  /environment variable\s+'?GEMSTONE[A-Z_]*'?\s+is not defined|GEMSTONE[A-Z_]*\s+environment variable is not defined/i;

/** True when a child's output is GemStone's bare environment complaint. */
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
    `not visible to it. Install ${version} from the Databases & Versions panel — or, if it is ` +
    `already installed somewhere else, register that directory as a local version.`
  );
}

/**
 * Replace a child process's bare `GEMSTONE environment variable is not defined`
 * with something that names the real situation, or return undefined to let the
 * original output stand.
 *
 * Jasper's own start path always sets `GEMSTONE` — `getEnvironment` either sets it
 * or throws before anything is spawned — so relaying this verbatim sends the
 * user into a shell profile that is not the problem. It has been seen in
 * practice while a mismatched or externally started server was in the picture.
 */
export function explainStartFailure(
  label: string,
  output: string,
  gemstonePath: string,
): string | undefined {
  if (!isBareGemstoneUndefined(output)) return undefined;
  return (
    `${label} failed. GemStone reported that GEMSTONE is not defined, but Jasper passed it ` +
    `as ${gemstonePath} — so the variable was set and did not reach the command. Your shell ` +
    `profile and your GemStone install are not the problem.\n\n` +
    `Two things are worth checking, in this order:\n` +
    `  • Open Terminal on the database and run "printenv GEMSTONE". That terminal is built ` +
    `from the same environment as this command, so if GEMSTONE is missing there too, the ` +
    `fault is in how Jasper resolved it — please report that.\n` +
    `  • Refresh the Databases view. If a server for this database is shown as started ` +
    `outside Jasper, the command may have reached that one instead, and Jasper can offer to ` +
    `restart it under its own environment.\n\n${output}`
  );
}
