import * as vscode from 'vscode';

/** The highest method environment to look in. */
export function maxEnvironment(): number {
  return vscode.workspace.getConfiguration('gemstone').get<number>('maxEnvironment', 0);
}

/**
 * Run `query` once per method environment, 0..`gemstone.maxEnvironment`, and return
 * everything it found.
 *
 * The setting is a CEILING — "look in environments 0 through N" — not the one environment to
 * ask about. Almost nothing is compiled above 0, so a surface that passes it straight through
 * as an environment id answers nothing at all, for every selector, the moment it is raised;
 * that is how the selector hover and Go to Definition both went silent (#632).
 *
 * The rows come back unfolded, because callers fold differently on purpose:
 * `dedupeMethodResults` counts the environment as part of a method's identity, the omni-search
 * references pivot keeps the lowest-environment copy, and function breakpoints filter as they
 * go. `query` owns its error policy too — a throw propagates, so a caller that has to survive
 * one bad environment catches inside the callback and answers `[]` for it.
 */
export function sweepEnvironments<T>(query: (environmentId: number) => T[]): T[] {
  const maxEnv = maxEnvironment();
  const found: T[] = [];
  for (let environmentId = 0; environmentId <= maxEnv; environmentId++) {
    found.push(...query(environmentId));
  }
  return found;
}
