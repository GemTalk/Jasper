import { ActiveSession } from './sessionManager';
import { EnhancedInspector } from './enhancedInspector/enhancedInspector';
import { BasicInspector } from './basicInspector/basicInspector';

/**
 * An open inspector panel, from the point of view of whatever opened it. The
 * debugger holds these so it can close the inspectors it spawned when it goes
 * away; nothing else about either panel is any of its business.
 */
export interface InspectorHandle {
  close(): void;
}

/**
 * Open `oop` in the right inspector for this session and return the handle, so
 * an owner (e.g. the debugger) can track it: the Enhanced Inspector when the
 * image has its support installed and the stone is new enough, else the basic
 * tabbed Inspector, which needs no server support at all.
 *
 * This is the single routing point behind every "Inspect" surface — editor,
 * global, and debugger. Both are editor-tab webviews presenting the object as
 * tabs over a miller-column strip, so which one a session gets is a difference
 * in how much the *stone* can tell us, not a different kind of tool.
 */
export function routeInspect(session: ActiveSession, oop: bigint, label: string): InspectorHandle {
  return session.enhancedInspectorAvailable
    ? EnhancedInspector.create(session, oop, label)
    : BasicInspector.create(session, oop, label);
}
