import type { ReportedGciError } from './gciLibraryError';

/**
 * What to tell the user when a login fails: a line on what went wrong and what
 * to do, then GemStone's own text and error number.
 *
 * Advice is firm only where GemStone names the cause (a refused password, an
 * unknown host, a version mismatch). Where it only says what failed — no stone
 * or NetLDI of that name answered, a NetLDI refused without a reason — the
 * advice says GemStone didn't say why and offers it as something to try:
 * Jasper can't tell a mistyped name from a server that isn't running on a host
 * it doesn't manage. For a database Jasper manages, `maybeStartDatabaseAndRetry`
 * looks at the processes first.
 *
 * A number alone never earns advice when its text is known: the text has to
 * agree too, so a release that gives a number a new meaning gets GemStone's
 * raw text rather than advice for the wrong problem. 4053, 4039 and 4050 have
 * never been captured, so their advice is worded as what the number usually
 * means, from `gcierr.ht`.
 *
 * The patterns are matched against messages captured from libgcits (3.6.2 and
 * 3.7.5 clients, 3.7.5 server), not paraphrased. 4147 covers a wrong host, a
 * wrong or stopped NetLDI, a refused host login and a version mismatch, so for
 * it the text decides the advice. Topaz reports the same failures as 4042;
 * libgcits does not. Nothing else in the error carries text: its `reason` is
 * `LgcException` or empty, and there is no session to read its `args` in.
 */

/** Named as in `gcierr.ht`; a test checks each against every vendored release. */
export const LOGIN_ERRORS = {
  GS_ERR_MAX_SESSIONS_LIMIT: 4039,
  GS_ERR_ACTIVE_USER_LIMIT: 4050,
  GS_ERR_LOGIN_DENIAL: 4051,
  GS_ERR_LOGINS_DISABLED: 4053,
  NET_ERR_NO_SUCH_STN: 4065,
  ERR_IN_LOGIN: 4147,
} as const;
const {
  GS_ERR_MAX_SESSIONS_LIMIT,
  GS_ERR_ACTIVE_USER_LIMIT,
  GS_ERR_LOGIN_DENIAL,
  GS_ERR_LOGINS_DISABLED,
  NET_ERR_NO_SUCH_STN,
  ERR_IN_LOGIN,
} = LOGIN_ERRORS;

const LOGIN_DENIED = /userId\/password combination is invalid/;
const STONE_MISSING = /could not find server '([^']*)' on host '([^']*)'/;
const NETLDI_MISSING = /NetLDI service '([^']*)' not found on node '([^']*)'/;
const VERSION_MISMATCH = /Version mismatch: client build (\d+), server is build (\d+)/;
const HOST_LOGIN_REFUSED = /Password validation failed for user/;
// The NetLDI refused to start a gem and gave no reason: what an authenticating
// NetLDI answers when the login carries no host user, among other causes.
const GEM_REFUSED_SILENTLY =
  /Netldi '([^']*)' on host '([^']*)' reports the request '\w*' failed:\s*$/;

/** GemStone named only what failed, not why: `tryThis` is a guess. */
function guess(whatFailed: string, tryThis: string): string {
  return `${whatFailed} GemStone didn't say why, so this is only something to try: ${tryThis}`;
}

/** GemStone's words as they go in the brackets: no "Login failed:" (the caller says it). */
function gemstoneWords(message: string): string {
  return message
    .trim()
    .replace(/^Login failed:\s*/, '')
    .replace(/[\s.]+$/, '');
}

/** Advice from the number alone, for an error whose text has never been seen. */
function usually(number: number, meaning: string, tryThis: string, said: string): string {
  const askToCompare = said ? "If GemStone's text in brackets agrees, something" : 'Something';
  return `GemStone error ${number} usually means ${meaning}. ${askToCompare} to try: ${tryThis}`;
}

function adviceFor(err: ReportedGciError): string | undefined {
  const text = err.message;
  const said = gemstoneWords(text);
  switch (err.number) {
    case GS_ERR_LOGIN_DENIAL:
      if (!LOGIN_DENIED.test(text)) return undefined;
      return (
        'GemStone says the user name or password is wrong, or the password has expired. ' +
        'Check the GemStone user and password in this login; both are case-sensitive.'
      );
    case NET_ERR_NO_SUCH_STN: {
      const missing = STONE_MISSING.exec(text);
      if (!missing) return undefined;
      return guess(
        `No stone named "${missing[1]}" answered on ${missing[2]}.`,
        'check the stone name in this login, and whether the stone is running on that host.',
      );
    }
    case GS_ERR_LOGINS_DISABLED:
      return usually(
        GS_ERR_LOGINS_DISABLED,
        'the stone has logins turned off',
        'ask its administrator to allow logins.',
        said,
      );
    case GS_ERR_MAX_SESSIONS_LIMIT:
      return usually(
        GS_ERR_MAX_SESSIONS_LIMIT,
        'the stone already has as many sessions as it allows',
        'log out a session you no longer need, or ask its administrator.',
        said,
      );
    case GS_ERR_ACTIVE_USER_LIMIT:
      return usually(
        GS_ERR_ACTIVE_USER_LIMIT,
        'this user already has as many sessions as it is allowed',
        'log out one of them, or use another user.',
        said,
      );
    case ERR_IN_LOGIN:
      return adviceForGemService(text);
    default:
      return undefined;
  }
}

function adviceForGemService(text: string): string | undefined {
  if (/host not found/.test(text)) {
    const host = NETLDI_MISSING.exec(text)?.[2];
    return `GemStone could not find the host${host ? ` "${host}"` : ''}. Check the host name in this login.`;
  }
  const missing = NETLDI_MISSING.exec(text);
  if (missing) {
    return guess(
      `No NetLDI named "${missing[1]}" is running on ${missing[2]}.`,
      'check the NetLDI name in this login, and whether that NetLDI is running.',
    );
  }
  if (VERSION_MISMATCH.test(text)) {
    return (
      "GemStone says this login's version doesn't match the server's. Set the login's " +
      'GemStone version to the one the server runs.'
    );
  }
  if (HOST_LOGIN_REFUSED.test(text)) {
    return 'The NetLDI refused the host user and password. Check them in this login.';
  }
  const refused = GEM_REFUSED_SILENTLY.exec(text);
  if (refused) {
    return guess(
      `The NetLDI "${refused[1]}" on ${refused[2]} would not start a session for this login.`,
      'if that NetLDI asks for a host login, enter the host user and password in this login. ' +
        "The NetLDI's log on that host should say what went wrong.",
    );
  }
  return undefined;
}

/**
 * The message a failed login is reported with: advice first when there is any,
 * with GemStone's own words in brackets after it. Brackets rather than a blank
 * line, because a VS Code notification drops line breaks. With no advice, the
 * text is left exactly as GemStone gave it.
 */
export function explainLoginFailure(err: ReportedGciError): string {
  const text = err.message.trim();
  const advice = adviceFor(err);
  if (!advice) return text || `Login failed (error ${err.number})`;
  const said = gemstoneWords(text);
  return said
    ? `${advice} (GemStone error ${err.number}: ${said}.)`
    : `${advice} (GemStone error ${err.number}.)`;
}
