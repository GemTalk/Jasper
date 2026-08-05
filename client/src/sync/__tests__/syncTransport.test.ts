import { describe, it, expect } from 'vitest';
import { fetchBlob, newStats, LimitExecutor } from '../syncTransport';
import { SYNC_BLOB_KEY } from '../syncProtocol';

// A fake GemStone implementing the prepare/fetch/release protocol, including the
// `serverMs \t total \n` (prepare) and `serverMs \n` (fetch) response framing.
function makeFakeGem(
  payload: string,
  serverMs = { prepare: 7, fetch: 3 },
): { exec: LimitExecutor } {
  let stored: string | null = null;
  const cps = [...payload]; // code points

  const exec: LimitExecutor = (label, code, _maxBytes) => {
    if (label.endsWith(':prepare')) {
      const m = code.match(/firstEnd := payload size min: (\d+)/);
      const chunk = m ? parseInt(m[1], 10) : cps.length;
      if (cps.length > chunk) stored = payload;
      const first = cps.slice(0, Math.min(chunk, cps.length)).join('');
      return `${serverMs.prepare}\t${cps.length}\n${first}`;
    }
    if (label.endsWith(':fetch')) {
      const m = code.match(/copyFrom: (\d+) to: (\d+)/);
      const start = parseInt(m![1], 10);
      const end = parseInt(m![2], 10);
      return `${serverMs.fetch}\n${[...(stored ?? '')].slice(start - 1, end).join('')}`;
    }
    if (label.endsWith(':release')) {
      stored = null;
      return '';
    }
    throw new Error(`unexpected label ${label}`);
  };
  return { exec };
}

describe('fetchBlob', () => {
  it('returns a payload that fits in one chunk with a single round trip', () => {
    const { exec } = makeFakeGem('small payload');
    const stats = newStats();
    const out = fetchBlob(exec, 'manifest', 'BUILD', 1000, stats);
    expect(out).toBe('small payload');
    expect(stats.roundTrips).toBe(1); // prepare only, nothing stored/released
    expect(stats.chars).toBe('small payload'.length);
    expect(stats.serverMs).toBe(7); // build time from prepare
  });

  it('streams a large payload across chunks and releases', () => {
    const payload = 'x'.repeat(25);
    const { exec } = makeFakeGem(payload);
    const stats = newStats();
    const out = fetchBlob(exec, 'content', 'BUILD', 10, stats);
    expect(out).toBe(payload);
    // prepare + 2 fetches + release
    expect(stats.roundTrips).toBe(4);
    expect(stats.chars).toBe(25);
    // 7 (prepare build) + 3 + 3 (two fetches); release reports no server time
    expect(stats.serverMs).toBe(13);
  });

  it('reassembles astral characters split across chunk boundaries by code point', () => {
    const payload = '😀😀😀😀😀'; // 5 code points, 10 UTF-16 units
    const { exec } = makeFakeGem(payload);
    const out = fetchBlob(exec, 'content', 'BUILD', 2);
    expect(out).toBe(payload);
    expect([...out].length).toBe(5);
  });

  it('reports each request through the onRequest callback', () => {
    const { exec } = makeFakeGem('x'.repeat(25));
    const labels: string[] = [];
    fetchBlob(exec, 'content', 'BUILD', 10, undefined, (t) => labels.push(t.label));
    expect(labels).toEqual([
      'content:prepare',
      'content:fetch',
      'content:fetch',
      'content:release',
    ]);
  });

  it('handles an empty payload', () => {
    const { exec } = makeFakeGem('');
    const stats = newStats();
    const out = fetchBlob(exec, 'manifest', 'BUILD', 10, stats);
    expect(out).toBe('');
    expect(stats.roundTrips).toBe(1);
  });

  it('uses the configured blob key in generated code', () => {
    let prepareCodeSeen = '';
    const exec: LimitExecutor = (label, code) => {
      if (label.endsWith(':prepare')) {
        prepareCodeSeen = code;
        return '0\t0\n';
      }
      return '';
    };
    fetchBlob(exec, 'manifest', 'BUILD');
    expect(prepareCodeSeen).toContain(SYNC_BLOB_KEY);
  });
});
