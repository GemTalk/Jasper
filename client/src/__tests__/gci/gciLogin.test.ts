import { describe, it, expect, afterAll } from 'vitest';
import { GciLibrary } from '../../gciLibrary';
import { GCI_LOGIN_PW_ENCRYPTED } from '../../gciConstants';
import {
  GCI_LIBRARY_PATH,
  STONE_NRS,
  GEM_NRS,
  GS_USER,
  GS_PASSWORD,
  NETLDI_NAME,
} from './gciTestConfig';

function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() + 'n' : value;
}

describe('GciTsLogin / GciTsLogout', () => {
  const gci = new GciLibrary(GCI_LIBRARY_PATH);

  afterAll(() => {
    gci.close();
  });

  describe('successful login and logout', () => {
    it('logs in and returns a non-null session, then logs out', () => {
      const { session, executedSessionInit, err } = gci.GciTsLogin(
        STONE_NRS,
        null,
        null,
        false,
        GEM_NRS,
        GS_USER,
        GS_PASSWORD,
        0,
        0,
      );

      console.log('Login success - executedSessionInit:', executedSessionInit);
      console.log('Login success - err:', JSON.stringify(err, bigIntReplacer, 2));

      expect(session).not.toBeNull();

      const logout = gci.GciTsLogout(session);
      console.log('Logout - success:', logout.success);
      console.log('Logout - err:', JSON.stringify(logout.err, bigIntReplacer, 2));

      expect(logout.success).toBe(true);
    });
  });

  describe('blocking login with netldiName (GciTsLogin_)', () => {
    it('logs in and returns a non-null session, then logs out', () => {
      const { session, executedSessionInit, err } = gci.GciTsLogin_(
        STONE_NRS,
        null,
        null,
        false,
        GEM_NRS,
        GS_USER,
        GS_PASSWORD,
        NETLDI_NAME,
        0,
        0,
      );

      console.log('Login_ - executedSessionInit:', executedSessionInit);
      console.log('Login_ - err:', JSON.stringify(err, bigIntReplacer, 2));

      expect(session).not.toBeNull();

      const logout = gci.GciTsLogout(session);
      expect(logout.success).toBe(true);
    });
  });

  describe('non-blocking login (GciTsNbLogin)', () => {
    it('starts login, polls for completion, then logs out', () => {
      const { session, loginPollSocket } = gci.GciTsNbLogin(
        STONE_NRS,
        null,
        null,
        false,
        GEM_NRS,
        GS_USER,
        GS_PASSWORD,
        0,
        0,
      );

      console.log('NbLogin - session:', session);
      console.log('NbLogin - loginPollSocket:', loginPollSocket);

      expect(session).not.toBeNull();

      let finished;
      do {
        finished = gci.GciTsNbLoginFinished(session);
      } while (finished.result === 0);

      console.log('NbLoginFinished - result:', finished.result);
      console.log('NbLoginFinished - err:', JSON.stringify(finished.err, bigIntReplacer, 2));

      expect(finished.result).toBe(1);

      const logout = gci.GciTsLogout(session);
      expect(logout.success).toBe(true);
    });
  });

  describe('non-blocking login with netldiName (GciTsNbLogin_)', () => {
    it('starts login, polls for completion, then logs out', () => {
      const { session, loginPollSocket } = gci.GciTsNbLogin_(
        STONE_NRS,
        null,
        null,
        false,
        GEM_NRS,
        GS_USER,
        GS_PASSWORD,
        NETLDI_NAME,
        0,
        0,
      );

      console.log('NbLogin_ - session:', session);
      console.log('NbLogin_ - loginPollSocket:', loginPollSocket);

      expect(session).not.toBeNull();

      // Poll until login completes
      let finished;
      do {
        finished = gci.GciTsNbLoginFinished(session);
      } while (finished.result === 0);

      console.log('NbLoginFinished - result:', finished.result);
      console.log('NbLoginFinished - executedSessionInit:', finished.executedSessionInit);
      console.log('NbLoginFinished - err:', JSON.stringify(finished.err, bigIntReplacer, 2));

      expect(finished.result).toBe(1);

      const logout = gci.GciTsLogout(session);
      expect(logout.success).toBe(true);
    });
  });

  describe('GciTsEncrypt and login with encrypted password', () => {
    it('encrypts a password and returns a non-empty string', () => {
      const encrypted = gci.GciTsEncrypt(GS_PASSWORD);
      console.log('Encrypted password:', encrypted);

      expect(encrypted).not.toBeNull();
      expect(encrypted!.length).toBeGreaterThan(0);
      expect(encrypted).not.toBe(GS_PASSWORD);
    });

    it('returns null for an empty string', () => {
      expect(gci.GciTsEncrypt('')).toBeNull();
    });

    it('produces consistent output for the same input', () => {
      const a = gci.GciTsEncrypt(GS_PASSWORD);
      const b = gci.GciTsEncrypt(GS_PASSWORD);
      expect(a).toBe(b);
    });

    it('logs in with the encrypted password and GCI_LOGIN_PW_ENCRYPTED', () => {
      const encrypted = gci.GciTsEncrypt(GS_PASSWORD);
      expect(encrypted).not.toBeNull();

      const { session, err } = gci.GciTsLogin(
        STONE_NRS,
        null,
        null,
        false,
        GEM_NRS,
        GS_USER,
        encrypted!,
        GCI_LOGIN_PW_ENCRYPTED,
        0,
      );

      console.log('Encrypted login - err:', JSON.stringify(err, bigIntReplacer, 2));

      expect(session).not.toBeNull();

      const logout = gci.GciTsLogout(session);
      expect(logout.success).toBe(true);
    });
  });

  describe('GciTsSessionIsRemote', () => {
    it('returns 1 (RPC) for an active session', () => {
      const { session } = gci.GciTsLogin(
        STONE_NRS,
        null,
        null,
        false,
        GEM_NRS,
        GS_USER,
        GS_PASSWORD,
        0,
        0,
      );

      expect(session).not.toBeNull();
      expect(gci.GciTsSessionIsRemote(session)).toBe(1);

      gci.GciTsLogout(session);
    });

    it('returns -1 for a logged-out session', () => {
      const { session } = gci.GciTsLogin(
        STONE_NRS,
        null,
        null,
        false,
        GEM_NRS,
        GS_USER,
        GS_PASSWORD,
        0,
        0,
      );

      expect(session).not.toBeNull();
      gci.GciTsLogout(session);

      expect(gci.GciTsSessionIsRemote(session)).toBe(-1);
    });
  });

  describe('non-blocking logout (GciTsNbLogout)', () => {
    it('logs in then performs a non-blocking logout', () => {
      const { session } = gci.GciTsLogin(
        STONE_NRS,
        null,
        null,
        false,
        GEM_NRS,
        GS_USER,
        GS_PASSWORD,
        0,
        0,
      );

      expect(session).not.toBeNull();

      const logout = gci.GciTsNbLogout(session);
      console.log('NbLogout - success:', logout.success);
      console.log('NbLogout - err:', JSON.stringify(logout.err, bigIntReplacer, 2));

      expect(logout.success).toBe(true);
    });
  });

  describe('GciTsAbort / GciTsBegin / GciTsCommit / GciTsContinueWith', () => {
    it('abort succeeds on a clean session', () => {
      const { session } = gci.GciTsLogin(
        STONE_NRS,
        null,
        null,
        false,
        GEM_NRS,
        GS_USER,
        GS_PASSWORD,
        0,
        0,
      );
      expect(session).not.toBeNull();

      const abort = gci.GciTsAbort(session);
      console.log('Abort - success:', abort.success);
      console.log('Abort - err:', JSON.stringify(abort.err, bigIntReplacer, 2));
      expect(abort.success).toBe(true);

      gci.GciTsLogout(session);
    });

    it('begin succeeds on a clean session', () => {
      const { session } = gci.GciTsLogin(
        STONE_NRS,
        null,
        null,
        false,
        GEM_NRS,
        GS_USER,
        GS_PASSWORD,
        0,
        0,
      );
      expect(session).not.toBeNull();

      const begin = gci.GciTsBegin(session);
      console.log('Begin - success:', begin.success);
      console.log('Begin - err:', JSON.stringify(begin.err, bigIntReplacer, 2));
      expect(begin.success).toBe(true);

      gci.GciTsLogout(session);
    });

    it('commit succeeds on a clean session', () => {
      const { session } = gci.GciTsLogin(
        STONE_NRS,
        null,
        null,
        false,
        GEM_NRS,
        GS_USER,
        GS_PASSWORD,
        0,
        0,
      );
      expect(session).not.toBeNull();

      const commit = gci.GciTsCommit(session);
      console.log('Commit - success:', commit.success);
      console.log('Commit - err:', JSON.stringify(commit.err, bigIntReplacer, 2));
      expect(commit.success).toBe(true);

      gci.GciTsLogout(session);
    });

    it('continueWith returns OOP_ILLEGAL with no active process', () => {
      const { session } = gci.GciTsLogin(
        STONE_NRS,
        null,
        null,
        false,
        GEM_NRS,
        GS_USER,
        GS_PASSWORD,
        0,
        0,
      );
      expect(session).not.toBeNull();

      const OOP_NIL = 0x14n;
      const OOP_ILLEGAL = 0x01n;
      const result = gci.GciTsContinueWith(session, OOP_NIL, OOP_ILLEGAL, null, 0);
      console.log('ContinueWith - result:', result.result);
      console.log('ContinueWith - err:', JSON.stringify(result.err, bigIntReplacer, 2));
      expect(result.result).toBe(OOP_ILLEGAL);
      expect(result.err.number).not.toBe(0);

      gci.GciTsLogout(session);
    });
  });

  describe('login with wrong stone NRS', () => {
    it('returns null session and populates err', () => {
      const { session, err } = gci.GciTsLogin(
        '!tcp@localhost#server!nonExistentStone',
        null,
        null,
        false,
        GEM_NRS,
        GS_USER,
        GS_PASSWORD,
        0,
        0,
      );

      console.log('Wrong stone NRS - err:', JSON.stringify(err, bigIntReplacer, 2));

      expect(session).toBeNull();
      expect(err.number).not.toBe(0);
    });
  });

  describe('login with wrong password', () => {
    it('returns null session and populates err', () => {
      const { session, err } = gci.GciTsLogin(
        STONE_NRS,
        null,
        null,
        false,
        GEM_NRS,
        GS_USER,
        'wrongPassword',
        0,
        0,
      );

      console.log('Wrong password - err:', JSON.stringify(err, bigIntReplacer, 2));

      expect(session).toBeNull();
      expect(err.number).not.toBe(0);
    });
  });

  describe('login with wrong gem NRS', () => {
    it('returns null session and populates err', () => {
      const { session, err } = gci.GciTsLogin(
        STONE_NRS,
        null,
        null,
        false,
        '!tcp@localhost#netldi:99999#task!gemnetobject',
        GS_USER,
        GS_PASSWORD,
        0,
        0,
      );

      console.log('Wrong gem NRS - err:', JSON.stringify(err, bigIntReplacer, 2));

      expect(session).toBeNull();
      expect(err.number).not.toBe(0);
    });
  });
});
