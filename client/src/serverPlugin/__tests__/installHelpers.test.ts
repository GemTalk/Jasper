import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../wslBridge', () => ({
  needsWsl: vi.fn(),
  windowsPathToWsl: vi.fn((p: string) => {
    const m = p.match(/^\\\\wsl(?:\$|\.localhost)\\[^\\]+(.*)$/i);
    return m ? m[1].replace(/\\/g, '/') : p;
  }),
}));

vi.mock('../../browserQueries', () => ({
  executeFetchString: vi.fn(),
}));

import { needsWsl } from '../../wslBridge';
import { toLocalGemPath } from '../installHelpers';

describe('toLocalGemPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('translates a Windows drive path to its WSL mount when the gem runs inside WSL', () => {
    vi.mocked(needsWsl).mockReturnValue(true);

    expect(toLocalGemPath('D:\\a\\Jasper\\Jasper\\resources\\refactoring')).toBe(
      '/mnt/d/a/Jasper/Jasper/resources/refactoring',
    );
  });

  it('translates a WSL UNC path to its Linux-side form when the gem runs inside WSL', () => {
    vi.mocked(needsWsl).mockReturnValue(true);

    expect(toLocalGemPath('\\\\wsl$\\Ubuntu\\home\\x')).toBe('/home/x');
  });

  it('leaves the path unchanged when the gem does not run inside WSL', () => {
    vi.mocked(needsWsl).mockReturnValue(false);

    expect(toLocalGemPath('/home/runner/work/Jasper/Jasper/resources/refactoring')).toBe(
      '/home/runner/work/Jasper/Jasper/resources/refactoring',
    );
  });
});
