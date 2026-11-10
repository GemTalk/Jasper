/**
 * Runs the clicks a test started without awaiting (a click held at a read, or the second
 * report of the same class click) up to the read they wait on, or to their end.
 */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Holds every reveal on the given pane in flight until the test calls `finish()`, so a
 * highlight move-back stays in progress. The hold isn't limited to the first reveal: a
 * later one, such as highlighting a committed click's row again, waits on the same
 * `finish()`.
 */
export function highlightMoveHeldBack(view: {
  reveal: { mockImplementation: (f: () => Promise<void>) => unknown };
}) {
  let finish!: () => void;
  const held = new Promise<void>((resolve) => (finish = resolve));
  view.reveal.mockImplementation(() => held);
  return { finish };
}
