import { ActiveSession } from '../sessionManager';
import { drainTranscript, endClientForwarderMode } from '../transcriptSink';
import { appendTranscriptOutput } from '../transcriptChannel';
import { clearStack } from './debugQueries';

/**
 * Clear a suspended process no debugger will own, in the background. Ends
 * clientForwarder mode first: on 3.7.5 a clean-up that writes to the
 * Transcript while the mode is on stops at that write (measured), and the
 * clear holds the session past the caller's own end anyway.
 */
export function releaseStoppedProcess(session: ActiveSession, gsProcess: bigint): Promise<void> {
  appendTranscriptOutput(endClientForwarderMode(session));
  return clearShowingTranscript(session, gsProcess);
}

/**
 * {@link releaseStoppedProcess} for a caller that has already ended clientForwarder
 * mode. What the clean-up wrote is shown once it is done, before the promise settles.
 */
export function clearShowingTranscript(session: ActiveSession, gsProcess: bigint): Promise<void> {
  return clearStack(session, gsProcess, () => appendTranscriptOutput(drainTranscript(session)));
}
