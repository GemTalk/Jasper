/** Decide whether a gslist-reported version matches a database's configured
 *  version. They usually come from different sources (the gslist Version column
 *  vs. the version parsed out of the product directory name), so we treat them
 *  as matching when the shorter one is a dotted-component prefix of the longer
 *  (e.g. "3.7.4" matches "3.7.4.3"). This keeps genuinely different installs —
 *  "3.6.2" vs "3.7.5" — distinct, which is what lets the Databases panel tie a
 *  running stone to the version that actually started it.
 *
 *  Lives in its own module, free of vscode, so both ProcessManager and the
 *  process-table scan that cross-checks it can use the one comparison without
 *  importing each other. */
export function versionsMatch(a: string, b: string): boolean {
  const as = a.split('.');
  const bs = b.split('.');
  const shared = Math.min(as.length, bs.length);
  for (let i = 0; i < shared; i++) {
    if (as[i] !== bs[i]) return false;
  }
  return shared > 0;
}
