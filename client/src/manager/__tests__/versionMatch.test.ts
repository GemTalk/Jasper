import { describe, it, expect } from 'vitest';
import { versionsMatch } from '../versionMatch';

/** Covered indirectly through ProcessManager's re-export as well; tested here
 *  directly so the extraction documents itself, and so the comparison can be
 *  read without a stone or the editor API in the way. */
describe('versionsMatch', () => {
  it('matches two versions recorded at different precisions', () => {
    // gslist reports the Version column; database.yaml records what the product
    // directory name said. The two rarely agree digit for digit.
    expect(versionsMatch('3.7.4', '3.7.4.3')).toBe(true);
    expect(versionsMatch('3.7.4.3', '3.7.4')).toBe(true);
  });

  it('matches a version with itself', () => {
    expect(versionsMatch('3.7.5', '3.7.5')).toBe(true);
  });

  it('keeps genuinely different installs apart', () => {
    expect(versionsMatch('3.6.2', '3.7.5')).toBe(false);
  });

  it('does not match on a shared leading digit alone', () => {
    expect(versionsMatch('3.7', '3.6')).toBe(false);
  });

  it('refuses to match when either version is missing', () => {
    expect(versionsMatch('', '3.7.5')).toBe(false);
    expect(versionsMatch('3.7.5', '')).toBe(false);
  });
});
