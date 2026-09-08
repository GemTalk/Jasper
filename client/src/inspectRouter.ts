import * as vscode from 'vscode';
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
 * What the user wants Inspect to open. `auto` takes whichever the session can
 * have; `basic` asks for the tabbed Inspector even where the Enhanced one is
 * installed. `enhanced` is the same as `auto` in effect — no setting can
 * conjure server support that isn't in the image — and exists so the choice
 * reads as a choice rather than as "auto, or off".
 */
export type InspectorPreference = 'auto' | 'enhanced' | 'basic';

/**
 * Which inspector this session's Inspect will open. The stone decides what is
 * possible and the user decides among what's possible: only `basic` overrides,
 * because it is the one that always works.
 */
export function inspectorFor(session: ActiveSession): 'enhanced' | 'basic' {
  const preferred = vscode.workspace
    .getConfiguration('gemstone')
    .get<InspectorPreference>('inspector.preferred', 'auto');
  if (preferred === 'basic') return 'basic';
  return session.enhancedInspectorAvailable ? 'enhanced' : 'basic';
}

/**
 * Open `oop` in the right inspector for this session and return the handle, so
 * an owner (e.g. the debugger) can track it: the Enhanced Inspector when the
 * image has its support installed and the stone is new enough — and the user
 * hasn't asked for the basic one — else the basic tabbed Inspector, which needs
 * no server support at all.
 *
 * This is the single routing point behind every "Inspect" surface — editor,
 * global, and debugger. Both are editor-tab webviews presenting the object as
 * tabs over a miller-column strip, so which one a session gets is a difference
 * in how much the *stone* can tell us, not a different kind of tool.
 */
export function routeInspect(session: ActiveSession, oop: bigint, label: string): InspectorHandle {
  return inspectorFor(session) === 'enhanced'
    ? EnhancedInspector.create(session, oop, label)
    : BasicInspector.create(session, oop, label);
}

/**
 * Focus an inspector this session already has open on `label` — the name an
 * "Inspect" was asked for, not the object — and answer whether it took focus,
 * so a caller can skip opening a second one.
 *
 * Only the Explorer's Globals view asks, and only the basic Inspector answers —
 * which is the same question as "where would a new Inspect go", so it follows
 * the preference too. The Enhanced Inspector has always opened a fresh panel per
 * Inspect, including from that view (the classic tree's reveal-existing rule was
 * explicitly skipped for it), and this keeps it that way.
 */
export function revealInspect(session: ActiveSession, label: string): boolean {
  return inspectorFor(session) === 'basic' ? BasicInspector.revealExisting(session, label) : false;
}
