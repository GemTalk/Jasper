import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * vitest has to be able to import `jsdom` (#434).
 *
 * It loads the jsdom test environment by importing 'jsdom' from wherever vitest itself is
 * installed, so npm has to place the two together. Twice now it has not: this workspace's
 * `@vitest/coverage-v8` hoists vitest to the root, while a jsdom bump can leave jsdom nested
 * under `client`, and then every test needing a browser dies at once with "Cannot find
 * package 'jsdom'" — which reads as a broken branch rather than a placement problem.
 *
 * The root `package.json` declares jsdom for that reason alone: it pins jsdom beside vitest.
 * Nothing at the root imports it, so it looks removable, and removing it breaks the whole
 * client suite. This fails first, and says why.
 */
describe('the jsdom test environment', () => {
  it('is resolvable from wherever vitest is installed', () => {
    const fromVitest = createRequire(require.resolve('vitest'));

    expect(() => fromVitest.resolve('jsdom')).not.toThrow();
  });
});
