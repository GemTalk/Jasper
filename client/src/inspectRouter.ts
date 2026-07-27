import { ActiveSession } from './sessionManager';
import { EnhancedInspector } from './enhancedInspector/enhancedInspector';
import { InspectorTreeProvider } from './inspectorTreeProvider';

/**
 * Open `oop` in the right inspector for this session: the Enhanced Inspector
 * (a webview) when the image has its support installed — returning the handle
 * so an owner (e.g. the debugger) can track it — else the classic Inspector
 * tree view in the primary sidebar (returns undefined). This is the single
 * routing point behind every "Inspect" surface: editor, global, and debugger.
 */
export function routeInspect(
  session: ActiveSession,
  oop: bigint,
  label: string,
  inspectorProvider: InspectorTreeProvider,
): EnhancedInspector | undefined {
  if (session.enhancedInspectorAvailable) {
    return EnhancedInspector.create(session, oop, label);
  }
  inspectorProvider.addRoot(session.id, oop, label);
  return undefined;
}
