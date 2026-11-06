/**
 * Runs the clicks a test started without awaiting (a click held at a read, or the second
 * report of the same class click) up to the read they wait on, or to their end.
 */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
