import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { explainLoginFailure, LOGIN_ERRORS } from '../loginFailureMessage';
import { vendoredRevisions } from '../gciLibrary/headerDeclarations';

/**
 * Each message is what libgcits reported for that mistake, captured against a
 * 3.7.5 stone and NetLDI (the version mismatch from a 3.6.2 client), not a
 * paraphrase: a matcher written from a paraphrase passes its tests and matches
 * nothing GemStone emits.
 */
const CAPTURED = {
  wrongPassword: {
    number: 4051,
    message: 'Login failed:  the userId/password combination is invalid or expired.',
  },
  wrongStone: {
    number: 4065,
    message:
      "The given Stone Repository monitor cannot be reached, could not find server 'no_such_stone' " +
      "on host 'uffda' because  service not found",
  },
  wrongNetldi: {
    number: 4147,
    message:
      "error contacting GemService, NetLDI service 'no_such_ldi' not found on node 'localhost',  " +
      "service not found; NetLDI service 'no_such_ldi' is not running on 'localhost' ",
  },
  wrongHost: {
    number: 4147,
    message:
      "error contacting GemService, NetLDI service 'cl_ldi' not found on node " +
      "'no-such-host.invalid', host not found, service not found",
  },
  versionMismatch: {
    number: 4147,
    message:
      "error contacting GemService, ssl call to netldi failed, ; Netldi 'cl_ldi' on host 'uffda' " +
      "reports the request '' failed: Version mismatch: client build 36200, server is build 37000",
  },
  noHostLogin: {
    number: 4147,
    message:
      "error contacting GemService, ssl call to netldi failed, ; Netldi 'cl_ldi' on host 'uffda' " +
      "reports the request 'gemnetobject' failed: ",
  },
  badHostPassword: {
    number: 4147,
    message:
      "error contacting GemService, ssl call to netldi failed, ; Netldi 'cl_ldi' on host 'uffda' " +
      "reports the request 'gemnetobject' failed: Password validation failed for user ewinger, " +
      'pam_authenticate error:7, Authentication failure',
  },
};

describe('explainLoginFailure', () => {
  it.each([
    ['a wrong password', CAPTURED.wrongPassword, /user name or password is wrong/],
    ['a wrong or stopped stone', CAPTURED.wrongStone, /stone name in this login/],
    [
      'a wrong or stopped NetLDI',
      CAPTURED.wrongNetldi,
      /No NetLDI named "no_such_ldi" is running on localhost/,
    ],
    [
      'a host that does not exist',
      CAPTURED.wrongHost,
      /could not find the host "no-such-host.invalid"/,
    ],
    ['a version that does not match the server', CAPTURED.versionMismatch, /version doesn't match/],
    ['a NetLDI that wants a host login', CAPTURED.noHostLogin, /enter the host user and password/],
    ['a refused host password', CAPTURED.badHostPassword, /refused the host user and password/],
  ])('says what to check for %s', (_label, err, advice) => {
    expect(explainLoginFailure(err)).toMatch(advice);
  });

  it("puts the advice first and keeps GemStone's own text and number after it", () => {
    const message = explainLoginFailure(CAPTURED.wrongStone);

    expect(message).toMatch(/^No stone named "no_such_stone" answered on uffda\./);
    expect(message).toMatch(
      new RegExp(
        `\\(GemStone error 4065: The given Stone Repository monitor .* service not found\\.\\)$`,
      ),
    );
  });

  it('gives a wrong host its own advice, not the missing-NetLDI one', () => {
    // A wrong host's message also says "NetLDI service ... not found", so
    // which advice fires depends on the host check coming first.
    expect(explainLoginFailure(CAPTURED.wrongHost)).not.toMatch(/No NetLDI named/);
  });

  it('does not take a refused host password for a missing host login', () => {
    expect(explainLoginFailure(CAPTURED.badHostPassword)).not.toMatch(/enter the host user/);
  });

  it.each([
    ['a wrong or stopped stone', CAPTURED.wrongStone],
    ['a wrong or stopped NetLDI', CAPTURED.wrongNetldi],
    ['a NetLDI that refuses without a reason', CAPTURED.noHostLogin],
  ])('offers advice for %s only as something to try', (_label, err) => {
    // GemStone says what failed but not why, so a confident "check X" could
    // send the user to fix something that was never wrong.
    expect(explainLoginFailure(err)).toMatch(
      /GemStone didn't say why, so this is only something to try/,
    );
  });

  it.each([
    ['a wrong password', CAPTURED.wrongPassword],
    ['a host that does not exist', CAPTURED.wrongHost],
    ['a version that does not match the server', CAPTURED.versionMismatch],
    ['a refused host password', CAPTURED.badHostPassword],
  ])('gives firm advice for %s, whose cause GemStone names', (_label, err) => {
    expect(explainLoginFailure(err)).not.toMatch(/didn't say why/);
  });

  it('keeps the advice and GemStone\'s words apart on one line, without saying "Login failed" twice', () => {
    // A VS Code notification drops line breaks, and the caller already
    // starts the message with "Login failed:".
    const message = explainLoginFailure(CAPTURED.wrongPassword);

    expect(message).not.toContain('\n');
    expect(message).not.toMatch(/Login failed/);
    expect(message).toMatch(
      /case-sensitive\. \(GemStone error 4051: the userId\/password combination is invalid or expired\.\)$/,
    );
  });

  it.each([
    ['4051', 4051],
    ['4065', 4065],
  ])('gives no advice for %s when its text says something else', (_label, number) => {
    // What a release that gave the number a new meaning would report.
    const err = { number, message: 'Some new failure GemStone has never reported before' };

    expect(explainLoginFailure(err)).toBe(err.message);
  });

  // For a number whose text was never captured, the meaning is the whole
  // diagnosis, so each one is pinned, not just the shape of the sentence.
  it.each([
    ['logins turned off', 4053, /usually means the stone has logins turned off\./],
    [
      'the stone at its session limit',
      4039,
      /usually means the stone already has as many sessions/,
    ],
    ['the user at its session limit', 4050, /usually means this user already has as many sessions/],
  ])('words the never-captured %s as what the number usually means', (_label, number, meaning) => {
    const message = explainLoginFailure({ number, message: 'whatever GemStone says' });

    expect(message).toMatch(new RegExp(`^GemStone error ${number} usually means`));
    expect(message).toMatch(meaning);
    expect(message).toContain("If GemStone's text in brackets agrees, something to try");
    expect(message).toContain('(GemStone error ' + number + ': whatever GemStone says.)');
  });

  it.each([
    ['no text', ''],
    ['only "Login failed:"', 'Login failed: '],
  ])('leaves out the brackets and the comparison when GemStone gave %s', (_label, message) => {
    const explained = explainLoginFailure({ number: 4053, message });

    expect(explained).toMatch(/usually means the stone has logins turned off\. Something to try:/);
    expect(explained).not.toMatch(/in brackets agrees/);
    expect(explained).toMatch(/\(GemStone error 4053\.\)$/);
  });

  it('gives no advice to a NetLDI refusal that now gives a reason', () => {
    // The host-login advice is for a refusal with nothing after "failed:"; a
    // reason GemStone adds later is its own diagnosis.
    const err = { number: 4147, message: CAPTURED.noHostLogin.message + 'some future reason' };

    expect(explainLoginFailure(err)).toBe(err.message.trim());
  });

  it('leaves an error it has no advice for as GemStone reported it', () => {
    const err = { number: 4147, message: 'error contacting GemService, something new' };

    expect(explainLoginFailure(err)).toBe(err.message);
  });

  it('names the error number when GemStone gave no text', () => {
    expect(explainLoginFailure({ number: 4999, message: '' })).toBe('Login failed (error 4999)');
  });
});

/**
 * The advice for each number assumes what GemStone means by it, so a release
 * that renumbers one, or gives its number a new meaning, must fail here rather
 * than get confident advice for the wrong problem. Each phrase is from that
 * error's description in `gcierr.ht`. Adding a release vendors its headers
 * (vendor/gci-headers/README.md), so it is checked from then on.
 */
const HEADER_MEANING: Record<keyof typeof LOGIN_ERRORS, string> = {
  GS_ERR_MAX_SESSIONS_LIMIT: 'the maximum number of sessions are already logged in',
  GS_ERR_ACTIVE_USER_LIMIT: 'Too many sessions already logged in with given userId',
  GS_ERR_LOGIN_DENIAL: 'invalid userId/password combination',
  GS_ERR_LOGINS_DISABLED: 'all logins are currently disabled',
  NET_ERR_NO_SUCH_STN: 'The given GemStone does not exist',
  ERR_IN_LOGIN: 'Fatal error during login',
};

const headersRoot = path.resolve(__dirname, '..', '..', '..', 'vendor', 'gci-headers');

describe('the login error numbers, in every vendored GemStone release', () => {
  const revisions = vendoredRevisions(headersRoot);

  it('finds the vendored releases', () => {
    expect(revisions.length).toBeGreaterThan(0);
  });

  describe.each(revisions)('%s', (revision) => {
    const header = fs.readFileSync(path.join(headersRoot, revision, 'gcierr.ht'), 'utf8');

    it.each(Object.entries(LOGIN_ERRORS))(
      '%s is still %i, with the same meaning',
      (name, number) => {
        // The #define and the comment that follows it, up to the next #define.
        const entry = new RegExp(`#define\\s+${name}\\s+(\\d+)([\\s\\S]*?)(?=#define|$)`).exec(
          header,
        );

        expect(entry, `${name} is not defined in ${revision}`).not.toBeNull();
        expect(Number(entry![1])).toBe(number);
        // Without the comment's ` * ` line prefixes, so a rewrapped comment still matches.
        expect(entry![2].replace(/\n\s*\*/g, ' ').replace(/\s+/g, ' ')).toContain(
          HEADER_MEANING[name as keyof typeof LOGIN_ERRORS],
        );
      },
    );
  });
});
