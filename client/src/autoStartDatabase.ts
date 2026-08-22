import { GemStoneLogin } from './loginTypes';
import { GemStoneDatabase, GemStoneProcess } from './sysadminTypes';
import { findDatabaseForLogin } from './databaseForLogin';
import { classifyStartNeed, inspectDatabaseProcesses } from './autoStartDecision';
import { ExternalServerFinding } from './externalServerScan';
import {
  ExternalServerReport,
  ReconcileDeps,
  reconcileExternalServers,
} from './externalServerReconcile';

/** What the user chose at the "start the database?" prompt. `undefined` when
 *  the prompt was dismissed without choosing. */
export type StartAnswer = 'yes' | 'no' | 'always' | 'never' | undefined;

export type AutoStartMode = 'ask' | 'always' | 'never';

/**
 * Everything the recovery flow needs from the outside world, injected so the
 * whole decision tree can be unit-tested without vscode, gslist, or a stone.
 * Mirrors the dependency-injection shape of maybeOfferEnhancedInspectorInstall.
 */
export interface AutoStartDeps {
  getDatabases(): GemStoneDatabase[];
  /** Must be a *refresh*, not the cache — see the note in the flow below. */
  refreshProcesses(): GemStoneProcess[];
  /** Servers alive on the host but missing from Jasper's gslist. Called after
   *  `refreshProcesses`, so it can be answered from that same reading. */
  getExternalServers(db: GemStoneDatabase): ExternalServerFinding;
  /** Turn a finding into the report its dialog and failure paths need. */
  describeExternalServers(
    db: GemStoneDatabase,
    finding: ExternalServerFinding,
  ): ExternalServerReport;
  /** The reconcile half of the flow: prompt, and stop what the user agreed to. */
  reconcile: Omit<ReconcileDeps, 'report' | 'showError'>;
  startStone(db: GemStoneDatabase): Promise<string>;
  startNetldi(db: GemStoneDatabase): Promise<string>;
  getMode(): AutoStartMode;
  setMode(mode: AutoStartMode): Promise<void>;
  confirm(stoneName: string): Promise<StartAnswer>;
  showError(message: string): void;
  /** Progress text for the surrounding "Connecting…" notification. */
  report(message: string): void;
  retryLogin(): Promise<void>;
  refreshViews(): void;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * True when a start failed only because the process was already up.
 *
 * This matters more than it looks: ProcessManager.refreshProcesses() returns []
 * on *any* internal error, so a broken gslist is indistinguishable from
 * "nothing is running". Without this check, a gslist hiccup would turn a
 * perfectly healthy database into an error dialog.
 */
export function isAlreadyRunning(message: string): boolean {
  return /already (running|exists)|is running/i.test(message);
}

/**
 * Recovery for a login that failed because its database is not running: work
 * out whether Jasper manages that database, offer to start it (honoring the
 * user's saved preference), start what is down, and retry the login once.
 *
 * Responsible for reporting the outcome on every path — including showing
 * `originalError` unchanged whenever it decides not to intervene, so a failure
 * this flow cannot help with looks exactly as it did before.
 */
export async function maybeStartDatabaseAndRetry(
  login: GemStoneLogin,
  originalError: string,
  deps: AutoStartDeps,
): Promise<void> {
  try {
    await recoverLogin(login, originalError, deps);
  } catch (e: unknown) {
    // The steps below only guard the failures they expect, and this runs inside
    // a VS Code command, where an escaping rejection becomes a bare "command
    // failed" notification naming neither the login nor the reason. So anything
    // unanticipated — an unwritable settings.json, an unreadable database root —
    // still leaves through the error the user was owed in the first place.
    deps.showError(`${originalError}\n\nRecovering from it also failed: ${messageOf(e)}`);
  }
}

async function recoverLogin(
  login: GemStoneLogin,
  originalError: string,
  deps: AutoStartDeps,
): Promise<void> {
  const db = findDatabaseForLogin(login, deps.getDatabases());
  if (!db) {
    // Not a Jasper-managed local database — nothing we can start.
    deps.showError(originalError);
    return;
  }

  // isStoneRunning and friends read a cache that only the admin views refresh,
  // so ask for fresh process state rather than trusting whatever was last seen.
  const processes = deps.refreshProcesses();
  const external = deps.getExternalServers(db);
  const need = classifyStartNeed(inspectDatabaseProcesses(db, processes, external));

  if (need.kind === 'external') {
    // Starting is not an option here: the name is already taken by a live
    // process, so startstone collides with it instead of helping. Offer to
    // stop it and start again under Jasper's environment.
    const outcome = await reconcileExternalServers(
      db,
      external,
      deps.describeExternalServers(db, external),
      { ...deps.reconcile, report: deps.report, showError: deps.showError },
    );
    if (outcome.kind === 'abandoned') {
      // Either the user backed out — the dialog explained the situation, so
      // following it with the raw login error would just be nagging — or a stop
      // failed and reconcileExternalServers already said what to do by hand.
      deps.refreshViews();
      return;
    }
    if (outcome.kind === 'connect-as-is') {
      // The user asked us not to touch the servers. Retrying against them is
      // what "as-is" means, and it can genuinely work — a login that does not
      // have to traverse Jasper's view of the NetLDI will connect.
      await retryAndReport(db, deps);
      return;
    }
    // Stopped. Fall through to the ordinary start of both servers, which is
    // now unobstructed, without asking a second time: the reconcile dialog
    // already got consent to restart and connect.
    await startAndConnect(db, { startStone: true, startNetldi: true }, deps);
    return;
  }

  if (need.kind === 'already-running') {
    // The database is up; the login failed for some other reason (wrong
    // password, unknown user). Leave the original error alone.
    deps.showError(originalError);
    return;
  }

  if (need.kind === 'not-responding') {
    const what = need.what === 'stone' ? 'stone' : 'NetLDI';
    deps.showError(
      `The ${what} for ${db.config.stoneName} is running but not responding, so the login ` +
        `cannot complete. Check the Processes view — it may be holding a stale lock that ` +
        `needs to be removed before the database can be restarted.`,
    );
    return;
  }

  const mode = deps.getMode();
  if (mode === 'never') {
    deps.showError(originalError);
    return;
  }

  if (mode === 'ask') {
    const answer = await deps.confirm(db.config.stoneName);
    if (answer === 'never') {
      await deps.setMode('never');
      return;
    }
    if (answer === 'always') {
      await deps.setMode('always');
    } else if (answer !== 'yes') {
      // Declined or dismissed. The prompt already explained the situation, so
      // following it with the raw login error would just be nagging.
      return;
    }
  }

  await startAndConnect(db, need, deps);
}

/** Start whichever servers are down, then connect. Shared by the ordinary
 *  stopped-database path and the reconcile path, which reaches it with both
 *  servers just stopped. */
async function startAndConnect(
  db: GemStoneDatabase,
  need: { startStone: boolean; startNetldi: boolean },
  deps: AutoStartDeps,
): Promise<void> {
  // Each process is started independently: an "already running" stone must not
  // stop us from starting a NetLDI that really is down.
  const startFailure = async (start: () => Promise<string>): Promise<string | undefined> => {
    try {
      await start();
      return undefined;
    } catch (e: unknown) {
      const msg = messageOf(e);
      return isAlreadyRunning(msg) ? undefined : msg;
    }
  };

  let failure: string | undefined;
  if (need.startStone) {
    deps.report(`Starting ${db.config.stoneName}…`);
    failure = await startFailure(() => deps.startStone(db));
  }
  if (!failure && need.startNetldi) {
    deps.report(`Starting NetLDI ${db.config.ldiName}…`);
    failure = await startFailure(() => deps.startNetldi(db));
  }
  if (failure) {
    deps.showError(`Could not start ${db.config.stoneName}: ${failure}`);
    deps.refreshViews();
    return;
  }

  await retryAndReport(db, deps);
}

/** Retry the login once and report whatever it does. */
async function retryAndReport(db: GemStoneDatabase, deps: AutoStartDeps): Promise<void> {
  try {
    deps.report(`Connecting to ${db.config.stoneName}…`);
    await deps.retryLogin();
  } catch (e: unknown) {
    // The retry can fail for reasons that have nothing to do with the start
    // (e.g. the single-session policy). Report its own error verbatim.
    deps.showError(messageOf(e));
  } finally {
    deps.refreshViews();
  }
}
