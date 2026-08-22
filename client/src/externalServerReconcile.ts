import { GemStoneDatabase } from './sysadminTypes';
import { ForceKillResult } from './processManager';
import {
  ExternalServer,
  ExternalServerFinding,
  ServerIdentity,
  allExternalServersConfirmed,
  externalServersOf,
} from './externalServerScan';

/** One external server, reduced to what the user needs to see about it. */
export interface ExternalServerDetail {
  kind: 'Stone' | 'NetLDI';
  name: string;
  pid: number;
  /** The `locks/` root the server registered in — the directory a `gslist -l`
   *  has to be pointed at to see it. Undefined when we could not read it. */
  registeredIn?: string;
  identity: ServerIdentity;
}

/** Everything the reconcile dialog and its failure paths need to say. */
export interface ExternalServerReport {
  stoneName: string;
  ldiName: string;
  /** The directory Jasper looks in, for contrast with `registeredIn`. */
  jasperRoot: string;
  servers: ExternalServerDetail[];
  /** True when every external server found is confirmed to be this database's,
   *  which is the only case in which Jasper may stop them. */
  confirmed: boolean;
}

/** What the user chose. `undefined` when the dialog was dismissed. */
export type ReconcileChoice = 'restart' | 'as-is' | 'cancel' | undefined;

/** What the caller should do next. */
export type ReconcileOutcome =
  /** The external servers are stopped; start them under Jasper and connect. */
  | { kind: 'stopped' }
  /** Leave them alone and attempt the connect as it stands. */
  | { kind: 'connect-as-is' }
  /** The user backed out, or a stop failed and has already been reported. */
  | { kind: 'abandoned' };

export interface ReconcileDeps {
  confirm(report: ExternalServerReport): Promise<ReconcileChoice>;
  /** Clean `stopstone`/`stopnetldi` against the server's own registration
   *  directory. Rejects when the stop fails. */
  stopExternal(db: GemStoneDatabase, server: ExternalServer): Promise<string>;
  /** Force-stop by PID, for when the clean stop could not reach it. */
  killExternal(server: ExternalServer): Promise<ForceKillResult>;
  /** Progress text for the surrounding "Connecting…" notification. */
  report(message: string): void;
  showError(message: string): void;
}

/** Reduce a scan finding to a report, in the order a user reads it: the stone
 *  first, because that is the row they clicked. */
export function describeExternalServers(
  db: GemStoneDatabase,
  finding: ExternalServerFinding,
  jasperRoot: string,
): ExternalServerReport {
  const detail = (server: ExternalServer, kind: 'Stone' | 'NetLDI'): ExternalServerDetail => ({
    kind,
    name: server.process.name,
    pid: server.process.pid,
    registeredIn: server.process.globalDir,
    identity: server.identity,
  });
  const servers: ExternalServerDetail[] = [];
  if (finding.stone) servers.push(detail(finding.stone, 'Stone'));
  if (finding.netldi) servers.push(detail(finding.netldi, 'NetLDI'));
  return {
    stoneName: db.config.stoneName,
    ldiName: db.config.ldiName,
    jasperRoot,
    servers,
    // The same predicate the reconcile's own gate uses, rather than a second
    // copy of the rule: the flag shown to the user and the check that decides
    // whether anything may be stopped must not be able to disagree.
    confirmed: allExternalServersConfirmed(finding),
  };
}

/** "<stone> and <netldi>" / "<stone>" — whichever of them is actually external. */
function serverList(report: ExternalServerReport): string {
  const names = report.servers.map((s) => `"${s.name}"`);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** One line per server: what it is, its PID, and where it registered. Shared by
 *  the dialog and the resolve-it-by-hand message, so the two never disagree
 *  about which processes are meant. */
function serverLines(report: ExternalServerReport): string {
  return report.servers
    .map((s) => {
      const where = s.registeredIn
        ? `registered in ${s.registeredIn}`
        : 'registration directory unknown';
      return `  • ${s.kind} ${s.name} — PID ${s.pid}, ${where}`;
    })
    .join('\n');
}

/**
 * The body of the reconcile dialog.
 *
 * Worded as a *mismatch*, never as a missing install: the servers are plainly
 * running, and telling someone their GemStone is not installed when they can
 * see the processes in `ps` is what sent users off to debug their shell profile
 * in the first place. It explains that Jasper's `gslist` and the host's can
 * disagree, because without that the "Stopped" the tree showed makes no sense.
 */
export function reconcileMessage(report: ExternalServerReport): string {
  const lines = [
    `${serverList(report)} are running, but were started outside Jasper's environment, so ` +
      `they're registered where Jasper's own gslist doesn't look.`,
    '',
    `Jasper runs its own gslist against ${report.jasperRoot}, which can differ from gslist on ` +
      `the host — so a server can look Stopped to Jasper while it's alive on the host, and a ` +
      `login that has to traverse the NetLDI fails as though nothing were running.`,
    '',
    serverLines(report),
  ];
  if (report.confirmed) {
    lines.push(
      '',
      "Restarting them under Jasper's environment drops any uncommitted sessions on the " +
        'stone — anything not committed is lost.',
    );
  } else {
    lines.push(
      '',
      unconfirmedWarning(report),
      '',
      'Jasper will not stop it on a guess, so "Restart & Connect" is not offered. Stop it by ' +
        'hand if you are sure it is the right one, or connect as-is.',
    );
  }
  return lines.join('\n');
}

/** Why a same-named server cannot be assumed to be this database's. Identity by
 *  name alone is ambiguous — two databases can use the same stone name — and
 *  the only evidence available is the conf/log paths the process was started
 *  with, which a stone started against a different extent will not have. */
function unconfirmedWarning(report: ExternalServerReport): string {
  const different = report.servers.filter((s) => s.identity === 'different');
  if (different.length > 0) {
    return (
      `Warning: the paths ${different.map((s) => s.kind.toLowerCase()).join(' and ')} was ` +
      `started with point outside this database's directory, so this is probably a different ` +
      `database that happens to share the name.`
    );
  }
  return (
    `Warning: Jasper could not confirm this is "${report.stoneName}" rather than a different ` +
    `stone of the same name — the running process gave nothing away about which database it ` +
    `has open.`
  );
}

/**
 * What to show when Jasper could not stop an external server.
 *
 * The point is not to dead-end: everything needed to finish the job by hand —
 * both names, the PIDs, the directory each server registered in, the `gslist`
 * invocation that will actually show them, and the lock files a kill leaves
 * behind — goes in the message, so the user is not left hunting for a server
 * Jasper has just told them it cannot see.
 */
export function manualResolutionMessage(report: ExternalServerReport, failure: string): string {
  const dirs = [...new Set(report.servers.map((s) => s.registeredIn).filter(Boolean))];
  const gslistHint =
    dirs.length > 0
      ? dirs.map((d) => `  GEMSTONE_GLOBAL_DIR=${d} gslist -cvl`).join('\n')
      : '  gslist -cvl   (in the shell the servers were started from)';
  // Killing a server leaves its lock behind, and a lock nobody mentions is the
  // next surprise: gslist keeps listing the dead server and the next startstone
  // refuses. Name the files so following the "kill the PIDs" half of this advice
  // does not land the user back where they started.
  const lockHint = report.servers
    .filter((s) => s.registeredIn)
    .map((s) => `  ${s.registeredIn}/locks/${s.name}..LCK`)
    .join('\n');
  return (
    `Could not stop the externally started servers for "${report.stoneName}": ${failure}\n\n` +
    `Stone: ${report.stoneName}\nNetLDI: ${report.ldiName}\n${serverLines(report)}\n\n` +
    `To inspect them where they are actually registered:\n${gslistHint}\n\n` +
    `Stop them from a shell with that GEMSTONE_GLOBAL_DIR (stopstone / stopnetldi), or kill ` +
    `the PIDs above, then start the database from Jasper.` +
    (lockHint
      ? `\n\nIf you kill them, remove the lock files they leave behind, or gslist there will ` +
        `keep reporting a server that is gone and the next start will refuse:\n${lockHint}`
      : '')
  );
}

/**
 * Offer to reconcile external servers, and stop them if the user agrees.
 *
 * Stops the stone before the NetLDI, the order GemStone documents: the stone is
 * what sessions are attached to, and taking its listener away first leaves them
 * nothing to shut down through. Each stop is tried cleanly first and force-
 * stopped only if that fails, which matters more here than usual — a clean
 * `stopstone` commits nothing but does let sessions finish, while a kill loses
 * whatever was uncommitted.
 *
 * Never stops anything whose identity is unconfirmed; that case is offered as
 * connect-as-is or cancel only, and the dialog says why.
 *
 * Dependency-injected in the shape of maybeStartDatabaseAndRetry, so the whole
 * decision tree is testable without vscode, `ps`, or a stone.
 */
export async function reconcileExternalServers(
  db: GemStoneDatabase,
  finding: ExternalServerFinding,
  report: ExternalServerReport,
  deps: ReconcileDeps,
): Promise<ReconcileOutcome> {
  const choice = await deps.confirm(report);
  if (choice === 'as-is') return { kind: 'connect-as-is' };
  if (choice !== 'restart') return { kind: 'abandoned' };

  // Gated on `finding`, not on `report.confirmed` — deliberately, because
  // `finding` is what the loop below actually stops. A report is only a
  // description, and taking permission from the description while acting on the
  // servers lets a mismatch between the two authorize stopping a server nobody
  // confirmed. The dialog does not offer Restart when identity is unconfirmed
  // anyway, but a caller with its own prompt could, and stopping the wrong
  // stone is not a mistake worth leaving to a dialog's wording.
  if (!allExternalServersConfirmed(finding)) {
    deps.showError(
      `Jasper did not stop anything: ${unconfirmedWarning(report)} ` +
        `Stop it by hand if you are sure, then start the database from Jasper.`,
    );
    return { kind: 'abandoned' };
  }

  for (const server of externalServersOf(finding)) {
    const what = server.process.type === 'stone' ? 'stone' : 'NetLDI';
    deps.report(`Stopping externally started ${what} ${server.process.name}…`);
    try {
      await deps.stopExternal(db, server);
      continue;
    } catch {
      // Expected often enough not to be worth reporting on its own: a clean
      // stop needs the DataCurator password (the stock one is all we have) and
      // a reachable NetLDI, and an external server may offer neither.
    }
    const killed = await deps.killExternal(server);
    if (!killed.killed) {
      deps.showError(manualResolutionMessage(report, killed.reason));
      return { kind: 'abandoned' };
    }
  }
  return { kind: 'stopped' };
}
