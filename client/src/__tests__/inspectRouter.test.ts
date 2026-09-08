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

const withEnhanced = { id: 1, enhancedInspectorAvailable: true } as unknown as ActiveSession;
const withoutEnhanced = { id: 1, enhancedInspectorAvailable: false } as unknown as ActiveSession;

beforeEach(() => {
  vi.clearAllMocks();
  settings.preferred = undefined;
});

describe('which inspector an Inspect opens', () => {
  it('takes the Enhanced Inspector when the session has it', () => {
    expect(inspectorFor(withEnhanced)).toBe('enhanced');

    routeInspect(withEnhanced, 100n, 'anAccount');

    expect(EnhancedInspector.create).toHaveBeenCalledWith(withEnhanced, 100n, 'anAccount');
    expect(BasicInspector.create).not.toHaveBeenCalled();
  });

  it('takes the basic Inspector when the session has no server support', () => {
    expect(inspectorFor(withoutEnhanced)).toBe('basic');

    routeInspect(withoutEnhanced, 100n, 'anAccount');

    expect(BasicInspector.create).toHaveBeenCalledWith(withoutEnhanced, 100n, 'anAccount');
    expect(EnhancedInspector.create).not.toHaveBeenCalled();
  });

  /** The point of the setting: the basic Inspector on a session that could have the other. */
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

  it('ignores a preference it does not recognise', () => {
    settings.preferred = 'nonsense';

    expect(inspectorFor(withEnhanced)).toBe('enhanced');
  });
});

describe('revealing an inspector already open on a name', () => {
  it('reveals nothing while Inspect opens the Enhanced Inspector', () => {
    expect(revealInspect(withEnhanced, 'Transcript')).toBe(false);
    expect(BasicInspector.revealExisting).not.toHaveBeenCalled();
  });

  it('asks the basic Inspector when that is where an Inspect would go', () => {
    expect(revealInspect(withoutEnhanced, 'Transcript')).toBe(true);
    expect(BasicInspector.revealExisting).toHaveBeenCalledWith(withoutEnhanced, 'Transcript');
  });

  /** The dedup follows the preference — it is the same question as where a new Inspect lands. */
  it('asks the basic Inspector on a forced session too', () => {
    settings.preferred = 'basic';

    expect(revealInspect(withEnhanced, 'Transcript')).toBe(true);
  });
});
