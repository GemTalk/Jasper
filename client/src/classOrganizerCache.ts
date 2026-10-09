import { ActiveSession } from './sessionManager';
import { executeFetchString } from './browserQueries';
import { clearClassOrganizerCode } from './queries/classOrganizer';

/**
 * Drop the session's cached `ClassOrganizer` so the next hierarchy, search or senders query builds
 * a fresh one (see `queries/classOrganizer.ts`). For anything that changes the set of classes
 * without Jasper compiling them itself: a commit or abort, an explicit Search refresh. A class-level
 * refactoring's apply, every refactoring undo, and the undo of a class or dictionary edit drop it
 * inside their own doit instead (`droppingClassOrganizer`). Best effort -- it costs one removeKey, and a
 * session that cannot run it has bigger problems than a stale hierarchy.
 */
export function dropCachedClassOrganizer(session: ActiveSession): void {
  try {
    executeFetchString(session, clearClassOrganizerCode());
  } catch {
    // Nothing to report: the next query simply reuses the organizer it had.
  }
}
