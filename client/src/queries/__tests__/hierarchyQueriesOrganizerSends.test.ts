import { describe, it, expect, vi } from 'vitest';
import { getClassHierarchy } from '../getClassHierarchy';
import { getClassDescendantNames } from '../../refactoring/queries/getClassDescendantNames';
import { getSiblingClassNames } from '../../refactoring/queries/getSiblingClassNames';
import { subclassesOfBlock, superclassesOfBlock } from '../classOrganizer';

/**
 * The hierarchy queries read the cached ClassOrganizer only through `subclassesOfBlock` /
 * `superclassesOfBlock` (classOrganizer.ts), which ask it only about a class it already holds.
 * Asking it directly would bring back GemStone's `addClass:`, which drops every same-named class
 * from the cache; only the live classOrganizerSubclasses suite would notice, and only on a stone.
 */
const queries: [string, (exec: (code: string) => string) => unknown][] = [
  ['getClassHierarchy', (exec) => getClassHierarchy(exec, 'Mid', 2)],
  ['getClassDescendantNames', (exec) => getClassDescendantNames(exec, 'Mid', 2)],
  ['getSiblingClassNames', (exec) => getSiblingClassNames(exec, 'Mid', 2)],
];

describe('hierarchy queries and the cached ClassOrganizer', () => {
  it.each(queries)(
    '%s asks the organizer about classes only through the shared blocks',
    (_name, run) => {
      const exec = vi.fn().mockReturnValue('');

      run(exec);

      const code = exec.mock.calls.map((c) => String(c[0])).join('\n');
      expect(code).toContain(subclassesOfBlock('organizer'));
      const outsideTheBlocks = code
        .split(subclassesOfBlock('organizer'))
        .join('')
        .split(superclassesOfBlock('organizer'))
        .join('');
      expect(outsideTheBlocks).not.toMatch(/(subclassesOf|allSuperclassesOf|addClass):/);
    },
  );
});
