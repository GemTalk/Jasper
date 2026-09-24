import { vi } from 'vitest';

// Replaces the real @vscode/extension-telemetry with
// src/__mocks__/@vscode/extension-telemetry.ts in every suite. This is about
// loadability, not about suppressing events: the package's compiled entry
// point calls Node's own `require('vscode')` at evaluation time, which no
// suite's `vi.mock('vscode', ...)` can reach, so any module graph that
// reaches telemetry.ts fails to load without it. Applied here via
// `setupFiles` rather than per test file, since which files happen to reach
// telemetry.ts is an implementation detail, not something each test should
// have to know.
//
// An explicit factory, not vitest's automock-discovery convention
// (`vi.mock('@vscode/extension-telemetry')` with no factory), because that
// convention resolves the mock from a `__mocks__` folder next to this
// project's vitest.config.ts (i.e. `client/__mocks__`), which sits outside
// `client/tsconfig.json`'s `rootDir: "./src"` and fails typed lint.
vi.mock('@vscode/extension-telemetry', () => import('../__mocks__/@vscode/extension-telemetry.js'));
