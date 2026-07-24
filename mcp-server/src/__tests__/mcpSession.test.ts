import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('koffi', () => ({
  default: {
    struct: vi.fn(() => ({})),
    array: vi.fn(() => ({})),
    opaque: vi.fn(() => ({})),
    pointer: vi.fn(() => ({})),
    union: vi.fn(() => ({})),
    load: vi.fn(() => ({
      func: vi.fn(() => vi.fn()),
    })),
  },
}));

vi.mock('../../../client/src/gciLibrary', () => {
  return {
    GciLibrary: vi.fn(),
  };
});

import { McpSession, McpSessionConfig } from '../mcpSession';
import { GciLibrary } from '../../../client/src/gciLibrary';
import { GciLibraryError } from '../../../client/src/gciLibraryError';

const noErr = {
  number: 0,
  message: '',
  context: 0n,
  category: 0n,
  fatal: 0,
  argCount: 0,
  exceptionObj: 0n,
  args: [],
  reason: '',
};

function makeConfig(overrides: Partial<McpSessionConfig> = {}): McpSessionConfig {
  return {
    libraryPath: '/path/to/libgcirpc.dylib',
    stoneNrs: '!tcp@localhost#server!gs64stone',
    gemNrs: '!tcp@localhost#netldi:gs64ldi#task!gemnetobject',
    gsUser: 'DataCurator',
    gsPassword: 'swordfish',
    ...overrides,
  };
}

function createMockGci() {
  return {
    GciTsLogin: vi.fn((): { session: unknown; err: typeof noErr } => ({
      session: {},
      err: { ...noErr },
    })),
    logout: vi.fn(),
    executeAndFetchString: vi.fn(() => 'result'),
  };
}

describe('McpSession', () => {
  let mockGci: ReturnType<typeof createMockGci>;

  beforeEach(() => {
    mockGci = createMockGci();
    vi.mocked(GciLibrary).mockImplementation(function (this: unknown) {
      return mockGci as unknown as GciLibrary;
    });
  });

  describe('constructor', () => {
    it('creates a GCI library and logs in', () => {
      const config = makeConfig();
      new McpSession(config);

      expect(GciLibrary).toHaveBeenCalledWith(config.libraryPath);
      expect(mockGci.GciTsLogin).toHaveBeenCalledWith(
        config.stoneNrs,
        null,
        null,
        false,
        config.gemNrs,
        config.gsUser,
        config.gsPassword,
        0,
        0,
      );
    });

    it('passes host credentials when provided', () => {
      const config = makeConfig({ hostUser: 'admin', hostPassword: 'secret' });
      new McpSession(config);

      expect(mockGci.GciTsLogin).toHaveBeenCalledWith(
        config.stoneNrs,
        'admin',
        'secret',
        false,
        config.gemNrs,
        config.gsUser,
        config.gsPassword,
        0,
        0,
      );
    });

    it('throws on login failure', () => {
      mockGci.GciTsLogin.mockReturnValue({
        session: null,
        err: { ...noErr, number: 4065, message: 'Login failed: bad password' },
      });

      expect(() => new McpSession(makeConfig())).toThrow('Login failed: bad password');
    });
  });

  describe('executeFetchString', () => {
    it('executes code and returns the fetched string', () => {
      const session = new McpSession(makeConfig());
      const result = session.executeFetchString('3 + 4');

      expect(mockGci.executeAndFetchString).toHaveBeenCalledWith(expect.anything(), '3 + 4');
      expect(result).toBe('result');
    });

    it('propagates errors from the underlying GCI call', () => {
      mockGci.executeAndFetchString.mockImplementation(() => {
        throw GciLibraryError.withMessage('MessageNotUnderstood');
      });

      const session = new McpSession(makeConfig());
      expect(() => session.executeFetchString('bad code')).toThrow('MessageNotUnderstood');
    });
  });

  describe('logout', () => {
    it('logs the session out', () => {
      const session = new McpSession(makeConfig());
      session.logout();

      expect(mockGci.logout).toHaveBeenCalledWith(expect.anything());
    });
  });
});
