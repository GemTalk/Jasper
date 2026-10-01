import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { __setConfig, __resetConfig } from '../__mocks__/vscode';
import { maxEnvironment, sweepEnvironments } from '../methodEnvironments';

describe('sweepEnvironments', () => {
  beforeEach(() => {
    __resetConfig();
  });

  it('asks environment 0 alone when the setting is at its default', async () => {
    const asked: number[] = [];
    expect(await sweepEnvironments(async (env) => [asked.push(env) && env])).toEqual([0]);
    expect(asked).toEqual([0]);
  });

  it('treats the setting as a ceiling, not the one environment to ask about', async () => {
    // A surface that passed it through as an environment id asked environment 3 alone and
    // answered nothing, since almost nothing is compiled above 0.
    __setConfig('gemstone', 'maxEnvironment', 3);
    const asked: number[] = [];
    await sweepEnvironments(async (env) => {
      asked.push(env);
      return [];
    });
    expect(asked).toEqual([0, 1, 2, 3]);
  });

  it('returns the rows unfolded, in environment order, for the caller to dedupe', async () => {
    __setConfig('gemstone', 'maxEnvironment', 1);
    expect(await sweepEnvironments(async (env) => [`a${env}`, `b${env}`])).toEqual([
      'a0',
      'b0',
      'a1',
      'b1',
    ]);
  });

  it('lets a throw out, so the caller decides whether one bad environment is fatal', async () => {
    __setConfig('gemstone', 'maxEnvironment', 1);
    await expect(
      sweepEnvironments(async (env) => {
        if (env === 1) throw new Error('session busy');
        return [env];
      }),
    ).rejects.toThrow('session busy');
  });

  it('reads the ceiling once per sweep, not once per environment', async () => {
    __setConfig('gemstone', 'maxEnvironment', 2);
    expect(maxEnvironment()).toBe(2);
    const asked: number[] = [];
    await sweepEnvironments(async (env) => {
      __setConfig('gemstone', 'maxEnvironment', 0);
      asked.push(env);
      return [];
    });
    expect(asked).toEqual([0, 1, 2]);
  });
});
