import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTestEnv } from './loadTestEnv';

describe('loadTestEnv', () => {
  let dir: string;
  const write = (file: string, body: string) => writeFileSync(join(dir, file), body);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loadTestEnv-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // The install script used to read only .env.test, so with an override it
  // installed into a different stone from the one the tests and the check use.
  it('lets .env.test.local override .env.test, as vitest does', () => {
    write('.env.test', 'VITE_GEMSTONE_STONE_NRS=fromTest\n');
    write('.env.test.local', 'VITE_GEMSTONE_STONE_NRS=fromTestLocal\n');
    const env: NodeJS.ProcessEnv = {};

    loadTestEnv(dir, env);

    expect(env.VITE_GEMSTONE_STONE_NRS).toBe('fromTestLocal');
  });

  it('ranks .env.test above .env.local above .env, filling keys the others leave out', () => {
    write('.env.test', 'A=fromTest\n');
    write('.env.local', 'A=fromLocal\nB=fromLocal\n');
    write('.env', 'A=fromEnv\nB=fromEnv\nC=fromEnv\n');
    const env: NodeJS.ProcessEnv = {};

    loadTestEnv(dir, env);

    expect(env).toMatchObject({ A: 'fromTest', B: 'fromLocal', C: 'fromEnv' });
  });

  it('never overrides a variable already set', () => {
    write('.env.test.local', 'VITE_GEMSTONE_USER=fromFile\n');
    const env: NodeJS.ProcessEnv = { VITE_GEMSTONE_USER: 'fromShell' };

    loadTestEnv(dir, env);

    expect(env.VITE_GEMSTONE_USER).toBe('fromShell');
  });

  it('loads nothing, without failing, when there are no files', () => {
    const env: NodeJS.ProcessEnv = {};

    loadTestEnv(dir, env);

    expect(env).toEqual({});
  });

  it('copies VITE_GEMSTONE_GLOBAL_DIR to GEMSTONE_GLOBAL_DIR', () => {
    write('.env.test', 'VITE_GEMSTONE_GLOBAL_DIR=/gs/global\n');
    const env: NodeJS.ProcessEnv = { GEMSTONE_GLOBAL_DIR: '/elsewhere' };

    loadTestEnv(dir, env);

    expect(env.GEMSTONE_GLOBAL_DIR).toBe('/gs/global');
  });
});
