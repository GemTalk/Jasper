import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import { pollReadable, __resetForTest } from '../socketPoll';
import { onSupportedPosixIt } from './platformGates';

describe('socketPoll.pollReadable', () => {
  afterEach(() => __resetForTest());

  it('returns -1 for a negative fd without touching the native poll', () => {
    expect(pollReadable(-1, 0)).toBe(-1);
  });

  // The native poll path differs on Windows (WSAPoll, sockets only); the
  // regular-file readability check below is meaningful only on POSIX.
  onSupportedPosixIt('reports a ready fd as readable via the native poll', () => {
    // Regular files always poll as readable (POLLIN) on POSIX, so this
    // exercises the real koffi-bound poll() and its revents decoding.
    const fd = fs.openSync(__filename, 'r');
    try {
      expect(pollReadable(fd, 0)).toBe(1);
    } finally {
      fs.closeSync(fd);
    }
  });
});
