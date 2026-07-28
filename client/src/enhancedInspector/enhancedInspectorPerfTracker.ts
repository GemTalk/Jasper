// Enhanced Inspector Perf Tracker: counts GCI round trips for enhanced inspector performance tuning.
// This module is a singleton — every importer shares the same counter instance.
// The proxy wraps a GciLibrary instance so all round-trip methods are counted
// without modifying gciLibrary.ts. Enable/disable via gemstone.enhancedInspectorPerfTracking.

import { GciLibrary } from '../gciLibrary';

// Methods that make actual network round trips to the GemStone server.
// Local-only methods (OopIsSpecial, I32ToOop, Encrypt, CallInProgress, etc.) are excluded.
const ROUND_TRIP_METHODS = new Set([
  'GciTsAbort',
  'GciTsBegin',
  'GciTsCommit',
  'GciTsExecute',
  'GciTsExecute_',
  'GciTsExecuteFetchBytes',
  'GciTsPerform',
  'GciTsPerformFetchBytes',
  'GciTsPerformFetchOops',
  'GciTsNbExecute',
  'GciTsNbPerform',
  'GciTsNbResult',
  'GciTsFetchBytes',
  'GciTsFetchChars',
  'GciTsFetchUtf8Bytes',
  'GciTsFetchOops',
  'GciTsFetchNamedOops',
  'GciTsFetchVaryingOops',
  'GciTsFetchObjInfo',
  'GciTsFetchGbjInfo',
  'GciTsFetchSize',
  'GciTsFetchVaryingSize',
  'GciTsFetchClass',
  'GciTsFetchUnicode',
  'GciTsFetchUtf8',
  'GciTsIsKindOf',
  'GciTsIsSubclassOf',
  'GciTsIsKindOfClass',
  'GciTsIsSubclassOfClass',
  'GciTsObjExists',
  'GciTsResolveSymbolObj',
  'GciTsNewObj',
  'GciTsNewByteArray',
  'GciTsNewString',
  'GciTsNewString_',
  'GciTsNewSymbol',
  'GciTsNewUnicodeString',
  'GciTsNewUnicodeString_',
  'GciTsNewUtf8String',
  'GciTsNewUtf8String_',
  'GciTsNewStringFromUtf16',
  'GciTsStoreBytes',
  'GciTsStoreOops',
  'GciTsStoreNamedOops',
  'GciTsStoreIdxOops',
  'GciTsCompileMethod',
  'GciTsClassRemoveAllMethods',
  'GciTsProtectMethods',
  'GciTsFetchTraversal',
  'GciTsMoreTraversal',
  'GciTsStoreTrav',
  'GciTsStoreTravDoTravRefs',
  'GciTsGetFreeOops',
  'GciTsSaveObjs',
  'GciTsReleaseObjs',
  'GciTsReleaseAllObjs',
  'GciTsAddOopsToNsc',
  'GciTsRemoveOopsFromNsc',
  'GciTsDirtyObjsInit',
  'GciTsDirtyExportedObjs',
  'GciTsBreak',
  'GciTsClearStack',
  'GciTsGemTrace',
  'GciTsContinueWith',
  'GciTsContinueWithAsync',
  'GciTsWaitForEvent',
  'GciTsCancelWaitForEvent',
  'GciTsKeepAliveCount',
  'GciTsKeyfilePermissions',
  'GciTsDebugConnectToGem',
  'GciTsDebugStartDebugService',
  'GciTsDoubleToOop',
  'GciTsOopToDouble',
  'GciTsI64ToOop',
  'GciTsOopToI64',
]);

export interface EnhancedInspectorPerfTracker {
  enabled: boolean;
  count: number;
  methodCounts: Map<string, number>;
  onCountChanged: (() => void) | undefined;
  increment(methodName: string): void;
  reset(): void;
  setEnabled(val: boolean): void;
}

export interface EnhancedInspectorPerfQuickPickItem {
  label: string;
  description?: string;
  isSeparator?: boolean;
}

export const RESET_LABEL = '$(debug-restart) Reset Counter';
export const COPY_LABEL = '$(copy) Copy to Clipboard';

export function buildEnhancedInspectorPerfStatusBarText(count: number): string {
  return `$(record) Enhanced Inspector Perf: ${count}`;
}

export function buildEnhancedInspectorPerfClipboardText(
  tracker: EnhancedInspectorPerfTracker,
): string {
  const sorted = [...tracker.methodCounts.entries()].sort((a, b) => b[1] - a[1]);
  return [
    `Enhanced Inspector Perf: ${tracker.count} total GCI calls`,
    ...sorted.map(([method, count]) => `  ${method}: ${count}`),
  ].join('\n');
}

export function buildEnhancedInspectorPerfQuickPickItems(
  tracker: EnhancedInspectorPerfTracker,
): EnhancedInspectorPerfQuickPickItem[] {
  const sorted = [...tracker.methodCounts.entries()].sort((a, b) => b[1] - a[1]);
  return [
    { label: RESET_LABEL, description: `clear all ${tracker.count} counts` },
    { label: COPY_LABEL, description: 'copy breakdown to clipboard' },
    { label: '', isSeparator: true },
    ...sorted.map(([method, count]) => ({ label: method, description: String(count) })),
  ];
}

export const enhancedInspectorPerfTracker: EnhancedInspectorPerfTracker = {
  enabled: false,
  count: 0,
  methodCounts: new Map(),
  onCountChanged: undefined,

  increment(methodName: string) {
    if (this.enabled) {
      this.count++;
      this.methodCounts.set(methodName, (this.methodCounts.get(methodName) ?? 0) + 1);
      this.onCountChanged?.();
    }
  },

  reset() {
    this.count = 0;
    this.methodCounts.clear();
    this.onCountChanged?.();
  },

  setEnabled(val: boolean) {
    this.enabled = val;
    if (!val) {
      this.count = 0;
      this.methodCounts.clear();
    }
    this.onCountChanged?.();
  },
};

/**
 * Wraps `gci` in a Proxy that increments {@link enhancedInspectorPerfTracker}
 * for every call to a method in {@link ROUND_TRIP_METHODS}.
 *
 * Methods returned from the `get` trap are bound to `receiver` (the proxy
 * itself), not `target`. Ergonomic GciLibrary methods (e.g. `resolveSymbol`)
 * make their own nested calls to raw `GciTsXxx` round trips via `this`;
 * binding to `receiver` means a nested `this.GciTsXxx()` call re-enters this
 * same `get` trap and gets tracked individually, instead of silently
 * bypassing it by running on the unwrapped `target`. This is safe because
 * `GciLibrary` has no real `#`-private fields (only compile-time-only TS
 * `private`) and this proxy defines no `set` trap, so property reads/writes
 * still resolve to the one real `target` object either way.
 */
export function wrapWithEnhancedInspectorPerfProxy(gci: GciLibrary): GciLibrary {
  return new Proxy(gci, {
    get(target, prop: string | symbol, receiver) {
      const val = (target as unknown as Record<string, unknown>)[prop as string];
      if (typeof val === 'function' && ROUND_TRIP_METHODS.has(prop as string)) {
        return (...args: unknown[]) => {
          enhancedInspectorPerfTracker.increment(prop as string);
          return (val as (...a: unknown[]) => unknown).apply(receiver, args);
        };
      }
      return typeof val === 'function'
        ? (val as (...args: unknown[]) => unknown).bind(receiver)
        : val;
    },
  });
}
