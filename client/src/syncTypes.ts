/** Rejects a Promise-returning (async) type at the type level, resolving to `never` instead. */
export type NotPromise<T> = T extends Promise<unknown> ? never : T;

/** A callback that takes no arguments and cannot be a promise-returning (async) function. */
export type SyncThunk<T> = () => NotPromise<T>;
