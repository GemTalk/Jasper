import { QueryExecutor } from '../types';

// The connected gem's temp-object cache ceiling, in KB. This is what caps a
// Rowan load: the whole project's transient objects live in it uncommitted
// until the load's final commit, so an under-provisioned gem overflows
// ("VM temporary object memory is full"). Jasper compares this against a
// project's declared minimum to warn before a load that can't fit.
//
// GemStone reports GemTempObjCacheSize in bytes; return KB to match the
// GEM_TEMPOBJ_CACHE_SIZE config unit. Returns undefined if it can't be read.
export function getGemCacheKB(execute: QueryExecutor): number | undefined {
  const raw = execute('(System configurationAt: #GemTempObjCacheSize) // 1024').trim();
  const kb = Number(raw);
  return Number.isFinite(kb) && kb > 0 ? kb : undefined;
}
