import * as net from 'net';
import * as os from 'os';
import { getWslNetworkInfoCached } from './wslBridge';

const loopback = new net.BlockList();
loopback.addSubnet('127.0.0.0', 8, 'ipv4');
loopback.addAddress('::1', 'ipv6');

/**
 * Whether a login's host names this machine, for telemetry's `serverLocation`.
 * Deliberately broader than `isLocalHost` in databaseForLogin.ts, which gates
 * starting a stone and must stay narrow. Names are never resolved through DNS:
 * that would put a network round trip on the connect path.
 */
export function isThisMachine(host: string): boolean {
  const h = normalizeHost(host);
  return (
    namesThisMachine(h) ||
    isLoopbackAddress(h) ||
    isCachedWslAddress(h) ||
    isOnThisMachinesInterfaces(h)
  );
}

function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1');
}

function namesThisMachine(h: string): boolean {
  const hostname = os.hostname().toLowerCase();
  return ['localhost', '0.0.0.0', hostname, hostname.split('.')[0]].includes(h);
}

function isLoopbackAddress(h: string): boolean {
  // Node 24's BlockList already matches the IPv4-mapped form; the Node inside
  // VS Code's Electron may not, so unwrap it rather than rely on that.
  const address = h.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  const family = net.isIP(address);
  return family !== 0 && loopback.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * A stone in WSL under NAT networking is reached at the WSL VM's IP, which is
 * on no Windows interface. Only the cached probe is read, for the same
 * no-round-trip reason; before the first probe lands, such a login still
 * counts as remote.
 */
function isCachedWslAddress(h: string): boolean {
  return h === getWslNetworkInfoCached()?.ip;
}

/** If the OS refuses to list interfaces, the host is judged on its name alone rather than losing the event. */
function isOnThisMachinesInterfaces(h: string): boolean {
  try {
    return Object.values(os.networkInterfaces()).some((addrs) =>
      addrs?.some((a) => a.address.toLowerCase() === h),
    );
  } catch {
    return false;
  }
}
