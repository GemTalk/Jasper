import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../__mocks__/vscode.js'));

import { __resetConfig, __setConfig, ThemeIcon } from '../__mocks__/vscode';
import { LoginStorage } from '../loginStorage';
import { LoginTreeProvider, GemStoneLoginItem } from '../loginTreeProvider';
import { DEFAULT_LOGIN } from '../loginTypes';

const ALPHA = { ...DEFAULT_LOGIN, stone: 'alpha' };
const BETA = { ...DEFAULT_LOGIN, stone: 'beta' };

function roots(provider: LoginTreeProvider): GemStoneLoginItem[] {
  return provider.getChildren() as GemStoneLoginItem[];
}

function iconId(item: GemStoneLoginItem): string {
  return (item.iconPath as ThemeIcon).id;
}

describe('LoginTreeProvider — connecting state', () => {
  let provider: LoginTreeProvider;

  beforeEach(() => {
    __resetConfig();
    provider = new LoginTreeProvider(new LoginStorage());
    __setConfig('gemstone', 'logins', [ALPHA, BETA]);
  });

  it('shows the server icon when idle', () => {
    expect(iconId(roots(provider)[0])).toBe('server');
  });

  it('shows a spinner on the row that is connecting', () => {
    provider.setConnecting(ALPHA, true);

    expect(iconId(roots(provider)[0])).toBe('loading~spin');
  });

  it('leaves other rows alone', () => {
    provider.setConnecting(ALPHA, true);

    expect(iconId(roots(provider)[1])).toBe('server');
  });

  it('returns to the server icon when the attempt finishes', () => {
    provider.setConnecting(ALPHA, true);
    provider.setConnecting(ALPHA, false);

    expect(iconId(roots(provider)[0])).toBe('server');
  });

  it('gives the connecting row a distinct id, so VS Code re-renders it', () => {
    // The provider is stateless and re-derived; VS Code reuses a row whose id is
    // unchanged, which would leave the old icon on screen.
    const idle = roots(provider)[0].id;
    provider.setConnecting(ALPHA, true);
    const busy = roots(provider)[0].id;

    expect(busy).not.toBe(idle);
  });

  it('fires a tree change so the row actually repaints', () => {
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);

    provider.setConnecting(ALPHA, true);

    expect(listener).toHaveBeenCalled();
  });

  it('tracks several logins connecting at once', () => {
    provider.setConnecting(ALPHA, true);
    provider.setConnecting(BETA, true);
    provider.setConnecting(ALPHA, false);

    expect(iconId(roots(provider)[0])).toBe('server');
    expect(iconId(roots(provider)[1])).toBe('loading~spin');
  });

  it('clearing a login that was never connecting is harmless', () => {
    expect(() => provider.setConnecting(BETA, false)).not.toThrow();
    expect(iconId(roots(provider)[1])).toBe('server');
  });

  it('keeps the spinner on the login that is connecting when the list is reordered', () => {
    provider.setConnecting(ALPHA, true);

    __setConfig('gemstone', 'logins', [BETA, ALPHA]);

    const [first, second] = roots(provider);
    expect(iconId(first)).toBe('server');
    expect(iconId(second)).toBe('loading~spin');
  });

  it('stops spinning the login it was told about, whatever moved meanwhile', () => {
    provider.setConnecting(ALPHA, true);
    __setConfig('gemstone', 'logins', [BETA, ALPHA]);

    provider.setConnecting(ALPHA, false);

    expect(roots(provider).map(iconId)).toEqual(['server', 'server']);
  });
});
