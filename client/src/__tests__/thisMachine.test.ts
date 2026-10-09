import { describe, it, expect, vi } from 'vitest';
vi.mock('../wslBridge', () => ({ getWslNetworkInfoCached: vi.fn(() => undefined) }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, networkInterfaces: vi.fn(actual.networkInterfaces) };
});
import * as os from 'os';
import { getWslNetworkInfoCached, WslNetworkInfo } from '../wslBridge';
import { isThisMachine } from '../thisMachine';

describe('isThisMachine', () => {
  const hostname = os.hostname();

  it.each([
    ['localhost', true],
    [' LocalHost ', true],
    ['0.0.0.0', true],
    [hostname, true],
    [hostname.split('.')[0], true],
    ['127.0.0.1', true],
    ['127.0.1.1', true],
    ['127.0.0.2', true],
    ['::1', true],
    ['[::1]', true],
    ['0:0:0:0:0:0:0:1', true],
    ['::ffff:127.0.0.1', true],
    ['192.168.1.50', false],
    ['db.example.com', false],
    ['', false],
  ])('says whether a host names this machine', (host, expected) => {
    expect(isThisMachine(host)).toBe(expected);
  });

  // Not every machine has a non-loopback interface (a CI container may not).
  const lanAddress = Object.values(os.networkInterfaces())
    .flat()
    .find((a) => a && !a.internal)?.address;
  it.skipIf(!lanAddress)("counts an address on one of this machine's interfaces", () => {
    expect(isThisMachine(lanAddress!)).toBe(true);
  });

  it('judges the host by name alone when the OS refuses to list interfaces', async () => {
    const actual = await vi.importActual<typeof import('os')>('os');
    vi.mocked(os.networkInterfaces).mockImplementation(() => {
      throw new Error('uv_interface_addresses failed');
    });
    try {
      expect(isThisMachine('localhost')).toBe(true);
      expect(isThisMachine('db.example.com')).toBe(false);
    } finally {
      vi.mocked(os.networkInterfaces).mockImplementation(actual.networkInterfaces);
    }
  });

  describe('with a stone in WSL under NAT networking', () => {
    const wslIp = '172.20.1.5';

    it("counts the WSL VM's address", () => {
      vi.mocked(getWslNetworkInfoCached).mockReturnValueOnce({ ip: wslIp } as WslNetworkInfo);

      expect(isThisMachine(wslIp)).toBe(true);
    });

    it('does not count it before any WSL probe has run', () => {
      expect(isThisMachine(wslIp)).toBe(false);
    });
  });
});
