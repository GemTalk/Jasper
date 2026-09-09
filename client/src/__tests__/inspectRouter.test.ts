import { describe, it, expect, vi, beforeEach } from 'vitest';

/** The setting the router reads, so a test can stand in for the user's own. */
const settings = vi.hoisted(() => ({ preferred: undefined as string | undefined }));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) =>
        key === 'inspector.preferred' && settings.preferred !== undefined
          ? settings.preferred
          : fallback,
    }),
  },
}));

vi.mock('../enhancedInspector/enhancedInspector', () => ({
  EnhancedInspector: { create: vi.fn(() => ({ close: vi.fn(), which: 'enhanced' })) },
}));

vi.mock('../basicInspector/basicInspector', () => ({
  BasicInspector: {
    create: vi.fn(() => ({ close: vi.fn(), which: 'basic' })),
    revealExisting: vi.fn(() => true),
  },
}));

import { EnhancedInspector } from '../enhancedInspector/enhancedInspector';
import { BasicInspector } from '../basicInspector/basicInspector';
import { ActiveSession } from '../sessionManager';
import { inspectorFor, routeInspect, revealInspect } from '../inspectRouter';
import * as fs from 'fs';
import * as path from 'path';

const withEnhanced = { id: 1, enhancedInspectorAvailable: true } as unknown as ActiveSession;
const withoutEnhanced = { id: 1, enhancedInspectorAvailable: false } as unknown as ActiveSession;

beforeEach(() => {
  vi.clearAllMocks();
  settings.preferred = undefined;
});

describe('which inspector an Inspect opens', () => {
  /**
   * The default, and the whole point of it: the tabbed Inspector even on a
   * session that could have the Enhanced one, so which inspector you get does
   * not depend on what a particular image has installed.
   */
  it('takes the basic Inspector by default, even where the Enhanced one is available', () => {
    expect(inspectorFor(withEnhanced)).toBe('basic');

    routeInspect(withEnhanced, 100n, 'anAccount');

    expect(BasicInspector.create).toHaveBeenCalledWith(withEnhanced, 100n, 'anAccount');
    expect(EnhancedInspector.create).not.toHaveBeenCalled();
  });

  it('takes the basic Inspector when the session has no server support', () => {
    expect(inspectorFor(withoutEnhanced)).toBe('basic');

    routeInspect(withoutEnhanced, 100n, 'anAccount');

    expect(BasicInspector.create).toHaveBeenCalledWith(withoutEnhanced, 100n, 'anAccount');
    expect(EnhancedInspector.create).not.toHaveBeenCalled();
  });

  /** Reaching the Enhanced Inspector is a deliberate `auto`. */
  it('takes the Enhanced Inspector when the user asks for auto and the session has it', () => {
    settings.preferred = 'auto';

    expect(inspectorFor(withEnhanced)).toBe('enhanced');

    routeInspect(withEnhanced, 100n, 'anAccount');

    expect(EnhancedInspector.create).toHaveBeenCalledWith(withEnhanced, 100n, 'anAccount');
    expect(BasicInspector.create).not.toHaveBeenCalled();
  });

  it('still takes the basic Inspector on auto when the session has no server support', () => {
    settings.preferred = 'auto';

    expect(inspectorFor(withoutEnhanced)).toBe('basic');
  });

  it('takes the basic Inspector when the user asks for it outright', () => {
    settings.preferred = 'basic';

    routeInspect(withEnhanced, 100n, 'anAccount');

    expect(BasicInspector.create).toHaveBeenCalled();
    expect(EnhancedInspector.create).not.toHaveBeenCalled();
  });

  /**
   * Asking for the Enhanced Inspector cannot install its server support, so on a
   * session without it the request degrades rather than opening nothing.
   */
  it('still opens the basic Inspector when the Enhanced one is asked for but absent', () => {
    settings.preferred = 'enhanced';

    routeInspect(withoutEnhanced, 100n, 'anAccount');

    expect(BasicInspector.create).toHaveBeenCalled();
  });

  it('opens the Enhanced Inspector when it is asked for and is there', () => {
    settings.preferred = 'enhanced';

    expect(inspectorFor(withEnhanced)).toBe('enhanced');
  });

  /**
   * A preference nobody can read falls to the inspector that cannot be missing,
   * rather than to the one that depends on what the image has installed.
   */
  it('falls back to the basic Inspector on a preference it does not recognise', () => {
    settings.preferred = 'nonsense';

    expect(inspectorFor(withEnhanced)).toBe('basic');
  });
});

/**
 * The router reads the preference through `get(key, fallback)`, so the value a
 * user who never set it gets is the one VS Code takes from the contribution —
 * not the fallback in the call. Both have to say `basic` for the tabbed
 * Inspector to actually be the default in a real window.
 */
describe('the contributed setting', () => {
  const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  // Across all configuration blocks, since VS Code merges their properties and
  // the block order is not something a test should depend on.
  const setting = pkg.contributes.configuration
    .map(
      (c: { properties?: Record<string, unknown> }) =>
        c.properties?.['gemstone.inspector.preferred'],
    )
    .find((s: unknown) => s !== undefined);

  it('defaults to the tabbed Inspector', () => {
    expect(setting.default).toBe('basic');
  });

  it('offers exactly the preferences the router understands', () => {
    expect(setting.enum).toEqual(['auto', 'enhanced', 'basic']);
  });

  it('documents each of them, in the same order', () => {
    expect(setting.enumDescriptions).toHaveLength(setting.enum.length);
  });
});

describe('revealing an inspector already open on a name', () => {
  it('reveals nothing while Inspect opens the Enhanced Inspector', () => {
    settings.preferred = 'auto';

    expect(revealInspect(withEnhanced, 'Transcript')).toBe(false);
    expect(BasicInspector.revealExisting).not.toHaveBeenCalled();
  });

  it('asks the basic Inspector when that is where an Inspect would go', () => {
    expect(revealInspect(withoutEnhanced, 'Transcript')).toBe(true);
    expect(BasicInspector.revealExisting).toHaveBeenCalledWith(withoutEnhanced, 'Transcript');
  });

  /** The dedup follows the preference — it is the same question as where a new Inspect lands. */
  it('asks the basic Inspector on a session that has the Enhanced one too', () => {
    expect(revealInspect(withEnhanced, 'Transcript')).toBe(true);
  });
});
