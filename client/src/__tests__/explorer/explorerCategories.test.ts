import { describe, it, expect } from 'vitest';
import { categoryChildNodes, categoryParentPath, categoryMatches } from '../../explorerCategories';

const PATHS = [
  'Kernel-Numbers',
  'Kernel-Numbers-Float',
  'Kernel-Collections',
  'Announcements-Core',
  'Announcements',
];

describe('categoryChildNodes', () => {
  it('returns the distinct top-level segments, sorted', () => {
    const nodes = categoryChildNodes(PATHS);

    expect(nodes.map((n) => n.segment)).toEqual(['Announcements', 'Kernel']);
  });

  it('marks a segment that has deeper paths as having children', () => {
    const nodes = categoryChildNodes(PATHS);

    expect(nodes.find((n) => n.segment === 'Kernel')?.hasChildren).toBe(true);
  });

  it('descends into a parent and returns only its direct children', () => {
    const nodes = categoryChildNodes(PATHS, 'Kernel');

    expect(nodes.map((n) => n.segment)).toEqual(['Collections', 'Numbers']);
  });

  it('flags a child that itself has a deeper level', () => {
    const nodes = categoryChildNodes(PATHS, 'Kernel');

    expect(nodes.find((n) => n.segment === 'Numbers')?.hasChildren).toBe(true);
  });

  it('reports a childless leaf as having no children', () => {
    const nodes = categoryChildNodes(PATHS, 'Kernel');

    expect(nodes.find((n) => n.segment === 'Collections')?.hasChildren).toBe(false);
  });

  it('excludes a bare category that merely equals the parent path', () => {
    const nodes = categoryChildNodes(PATHS, 'Announcements');

    expect(nodes.map((n) => n.segment)).toEqual(['Core']);
  });

  it('builds each child node with its full dash-joined path', () => {
    const nodes = categoryChildNodes(PATHS, 'Kernel');

    expect(nodes.find((n) => n.segment === 'Numbers')?.fullPath).toBe('Kernel-Numbers');
  });

  it('returns nothing when the parent path matches no category', () => {
    expect(categoryChildNodes(PATHS, 'Nonexistent')).toEqual([]);
  });
});

describe('categoryParentPath', () => {
  it('returns the immediate parent segment and its full path', () => {
    expect(categoryParentPath('Kernel-Numbers-Float')).toEqual({
      segment: 'Numbers',
      fullPath: 'Kernel-Numbers',
    });
  });

  it('returns undefined for a top-level segment with no parent', () => {
    expect(categoryParentPath('Kernel')).toBeUndefined();
  });
});

describe('categoryMatches', () => {
  it('matches everything when no category is selected', () => {
    expect(categoryMatches('Kernel-Numbers', undefined)).toBe(true);
  });

  it('matches a category against itself', () => {
    expect(categoryMatches('Kernel', 'Kernel')).toBe(true);
  });

  it('matches a sub-category beneath the selected one', () => {
    expect(categoryMatches('Kernel-Numbers', 'Kernel')).toBe(true);
  });

  it('does not match an unrelated category', () => {
    expect(categoryMatches('Announcements', 'Kernel')).toBe(false);
  });

  it('does not match a sibling that merely shares a name prefix', () => {
    expect(categoryMatches('KernelExtras', 'Kernel')).toBe(false);
  });
});
