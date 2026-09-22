import { describe, it, expect } from 'vitest';
import { compareGemStoneVersions } from '../gemStoneVersion';

/** Sign of a comparison, so a test says "before"/"after" rather than pinning a
 *  magnitude the contract does not promise. */
function order(a: string, b: string): number {
  return Math.sign(compareGemStoneVersions(a, b));
}

describe('compareGemStoneVersions', () => {
  it('orders plain 3- and 4-part versions', () => {
    expect(order('3.7.5', '3.6.2')).toBe(1);
    expect(order('3.6.2', '3.7.5')).toBe(-1);
    expect(order('3.7.5', '3.7.5')).toBe(0);
    // A missing fourth part is zero, so 3.7.4 precedes every 3.7.4.x patch.
    expect(order('3.7.4.3', '3.7.4')).toBe(1);
    expect(order('3.7.4', '3.7.4.0')).toBe(0);
  });

  it('accepts a pre-release tag attached with a dot or a dash', () => {
    // Both spellings are real: a build says "4.0.0.a2" today and "4.0.0-a3" next.
    // Either threw before, which took out every consumer that sorts or filters.
    expect(() => compareGemStoneVersions('4.0.0.a2', '3.6.2')).not.toThrow();
    expect(() => compareGemStoneVersions('4.0.0-a3', '3.6.2')).not.toThrow();
    expect(order('4.0.0.a2', '3.6.2')).toBe(1);
    expect(order('4.0.0-a3', '3.6.2')).toBe(1);
  });

  it('treats the two spellings of one build as the same version', () => {
    expect(order('4.0.0.a2', '4.0.0-a2')).toBe(0);
  });

  it('sorts a pre-release before the release it leads to, in either argument order', () => {
    // Semver's rule, chosen deliberately — see the comment on the function.
    expect(order('4.0.0-a3', '4.0.0')).toBe(-1);
    expect(order('4.0.0', '4.0.0-a3')).toBe(1);
    expect(order('4.0.0.a2', '4.0.0')).toBe(-1);
    // Still a 4.0 release, so it outranks everything in 3.x.
    expect(order('4.0.0-a3', '3.7.6')).toBe(1);
  });

  it('orders two pre-releases of one release by tag, counting numerically', () => {
    expect(order('4.0.0-a2', '4.0.0-a3')).toBe(-1);
    expect(order('4.0.0.a2', '4.0.0-a3')).toBe(-1);
    // Lexically "a10" would precede "a9"; the tenth alpha is not the ninth's elder.
    expect(order('4.0.0-a9', '4.0.0-a10')).toBe(-1);
  });

  it('still rejects a version string that is genuinely malformed', () => {
    // The guard was loosened, not removed: a directory named something else
    // should still be a loud failure rather than a silently mis-sorted row.
    expect(() => compareGemStoneVersions('garbage', '3.6.2')).toThrow('Invalid version: garbage');
    expect(() => compareGemStoneVersions('4.0', '3.6.2')).toThrow('Invalid version: 4.0');
    expect(() => compareGemStoneVersions('', '3.6.2')).toThrow('Invalid version:');
    expect(() => compareGemStoneVersions('4.0.0.a2.b', '3.6.2')).toThrow('Invalid version');
    // A tag has to start with a letter, which is what keeps a fourth numeric
    // part from being read as one.
    expect(() => compareGemStoneVersions('4.0.0-2a', '3.6.2')).toThrow('Invalid version');
  });
});
