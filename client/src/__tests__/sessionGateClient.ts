// PROTOTYPE: a test file's side of the session gate (see sessionGate.globalSetup.ts).
import { createConnection, type Socket } from 'node:net';
import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    sessionGateSocket: string;
  }
}

// PROTOTYPE ONLY: in the real design each file declares this through
// useIntegrationTest({ sessions: N }). A map keeps the prototype's diff small.
const BUDGETS: Record<string, number> = {
  'src/__tests__/forceStop.integration.test.ts': 3,
  'src/__tests__/forceStopSurfaces.integration.test.ts': 3,
  'src/__tests__/forceStopLogout.integration.test.ts': 3,
  'src/__tests__/clearStoppedRun.integration.test.ts': 3,
  'src/__tests__/conditionalBreakpointStop.integration.test.ts': 3,
  'src/stoneSessions/__tests__/stoneSessions.integration.test.ts': 3,
  'src/__tests__/browserQueries.integration.test.ts': 2,
  'src/__tests__/activeSession.integration.test.ts': 2,
  'src/__tests__/useIntegrationTest.integration.test.ts': 2,
  'src/__tests__/explorer/gemstoneExplorer.integration.test.ts': 2,
  'src/__tests__/transcriptSink.integration.test.ts': 2,
  'src/__tests__/gciLibrary.test.ts': 2,
  'src/gciLibrary/__tests__/gciAsync.integration.test.ts': 2,
  'src/gciLibrary/__tests__/gciSessionUtils.integration.test.ts': 2,
  'src/gciLibrary/__tests__/gciLogin.integration.test.ts': 2,
  'src/fileTransfer/__tests__/fileIn.integration.test.ts': 2,
  'src/refactoring/__tests__/refactoringInstallDecoy.integration.test.ts': 2,
};

export function budgetFor(testPath: string): number {
  const rel = testPath.slice(testPath.lastIndexOf('/client/') + '/client/'.length);
  return BUDGETS[rel] ?? 1;
}

// One per useIntegrationTest call that is running; nested describes can hold several.
const held: Socket[] = [];

/** Waits until the stone has room for `n` sessions, then holds them until {@link releaseSessions}. */
export async function acquireSessions(file: string, n: number): Promise<Socket | undefined> {
  const path = inject('sessionGateSocket');
  if (!path) return undefined;
  const socket = createConnection(path);
  const answer = await new Promise<{ granted?: boolean; error?: string }>((resolve, reject) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const nl = buffer.indexOf('\n');
      if (nl >= 0) resolve(JSON.parse(buffer.slice(0, nl)));
    });
    socket.on('error', reject);
    socket.write(JSON.stringify({ op: 'acquire', file, n }) + '\n');
  });
  if (answer.error) {
    socket.destroy();
    throw new Error(`Session gate: ${answer.error}`);
  }
  held.push(socket);
  return socket;
}

/** Tells the gate that a session with login serial `serial` belongs to this file. */
export function reportSession(serial: string | bigint, socket = held.at(-1)): void {
  socket?.write(JSON.stringify({ op: 'opened', serial: String(serial) }) + '\n');
}

/** Gives the file's sessions back; the gate frees them once their gems have left the stone. */
export function releaseSessions(socket: Socket | undefined): void {
  if (!socket) return;
  const i = held.indexOf(socket);
  if (i >= 0) held.splice(i, 1);
  socket.end();
}
