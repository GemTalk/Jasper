import { vi } from 'vitest';

/** An in-memory stand-in for `vscode.SecretStorage` whose methods are spies. */
export function fakeSecretStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    get: vi.fn(async (key: string) => entries.get(key)),
    store: vi.fn(async (key: string, value: string) => {
      entries.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      entries.delete(key);
    }),
    keys: vi.fn(async () => [...entries.keys()]),
    onDidChange: vi.fn(),
  };
}
