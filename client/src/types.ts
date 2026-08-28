/** Rejects a Promise-returning (async) type at the type level, resolving to `never` instead. */
export type NotPromise<T> = T extends Promise<unknown> ? never : T;
