// The session gate's bookkeeping (see sessionGate.globalSetup.ts), kept apart
// from its sockets and its watcher session so it can be tested without a stone.
// `K` identifies a file's booking: a socket in the gate, anything in a test.

/**
 * How far outside a refused login's own span, from the call to the refusal, the
 * watcher can date the serial it used.
 */
export const REFUSAL_SPAN_SLACK_MS = 2_000;

/** Smalltalk answering the login serial of the session that runs it. */
export const LOGIN_SERIAL_CODE = '(System descriptionOfSession: System session) at: 9';

/** A test file's path from `client/` on, as messages name it. */
export function testFileName(path: string): string {
  return path.split('/client/')[1] ?? path;
}

/** How many login serials either side of a blamed one {@link SessionLedger.loginsAround} describes. */
export const LOGINS_AROUND_SPAN = 3;

/** A failed login as the test reported it, by the test worker's own clock. */
export type FailedLogin = {
  startedAt: number;
  failedAt: number;
  number: number | undefined;
  message: string;
};

/**
 * A failed login, as reported by the file whose worker made it. One the stone
 * refused used up a serial somewhere between the test's `startedAt` and
 * `failedAt`, and a refusal can take seconds to come back. `at` is when the
 * report reached the gate, which is no guide to when the serial was used: on
 * Windows the report can wait over a second in a worker busy in a GCI call.
 */
export type ReportedFailure = {
  failure: FailedLogin;
  at: number;
  pid: number | undefined;
  file: string | undefined;
  /** What a refusal was matched to, once it was. */
  matchedTo?: string;
};

/** A login serial the gate knows of, and when it first learned of it. */
type KnownSerial = { serial: number; at: number; how: 'seen' | 'reported' | 'run edge' };

/** A login too short for the watcher to see, with what can explain it. */
export type UnseenLogin = {
  serial: number;
  running: string[];
  after: KnownSerial;
  before: KnownSerial;
  /** Refusals reported within {@link UNSEEN_LOGIN_CONTEXT_MS} of the gap, matched or not. */
  refusalsNearby: ReportedFailure[];
};

/** How far either side of an unseen login its report lists refusals. */
export const UNSEEN_LOGIN_CONTEXT_MS = 10_000;

/** How far apart two spans of time are: 0 when they overlap. */
function apart([aFrom, aTo]: [number, number], [bFrom, bTo]: [number, number]): number {
  return Math.max(0, bFrom - aTo, aFrom - bTo);
}

/** When a failed login could have used its serial, by the test's clock: the workers and the gate share one machine's. */
function spanOf(r: ReportedFailure): [number, number] {
  return [r.failure.startedAt, r.failure.failedAt];
}

export type BookingRequest = { file: string; pid: number; n: number };

type Holder = BookingRequest & {
  serials: Set<string>;
  /** Its sessions that have logged out, or whose gem was ended. */
  closed: Set<string>;
  grantedAt: number;
  /** Most of its sessions the watcher has seen on the stone at once still logged in. */
  mostSeen: number;
};
type Waiter<K> = BookingRequest & { key: K; askedAt: number };
/** A user session the watcher saw, and the test worker (GCI client process) that logged it in. */
type Sighting = { pid: number; firstSeen: number };
type Grant = { file: string; n: number; at: number; waitMs: number; holdMs?: number };

export class SessionLedger<K> {
  private readonly holders = new Map<K, Holder>();
  private readonly queue: Waiter<K>[] = [];
  private live: Set<string> | undefined;
  // Sessions already on the stone at the watcher's first look belong to no test file.
  private before: Map<string, number> | undefined;
  // Workers that had asked for a booking by the first look. Only their sessions
  // in `before` can be their own unreported logins: a pid that turns up later
  // may be a reused one matching a gem a killed run left behind.
  private pidsAtFirstLook: Set<number> | undefined;
  private readonly sightings = new Map<string, Sighting>();
  // Login serial -> when a file reported it, and which file.
  private readonly reported = new Map<string, { at: number; file: string | undefined }>();
  // Logins files reported the stone refused, each of which used up a serial,
  // and may have been seen on the stone, with no user yet, before it was refused.
  private readonly refusals: ReportedFailure[] = [];
  // Logins that failed some other way. They use up no serial, so nothing is
  // matched to them; they are kept for the report on a blamed file.
  private readonly otherFailures: ReportedFailure[] = [];
  private readonly excused = new Set<string>();
  private readonly blamed = new Set<string>();
  private readonly workerPids = new Set<number>();
  private readonly overBudgetFiles = new Map<string, { booked: number; seen: number }>();
  readonly grants: Grant[] = [];
  peakCommitted = 0;
  peakLive = 0;
  private startedAt: number;

  /** `capacity` can be set later, once the stone has said how many sessions it takes, but before any {@link request}. */
  constructor(
    public capacity: number,
    private readonly clock: () => number = Date.now,
  ) {
    this.startedAt = clock();
  }

  /** Starts the run's clock again, as the watcher logs in: times in the run are counted from here. */
  restartClock(): void {
    this.startedAt = this.clock();
  }

  /** Puts `key` in line for `request.n` sessions; {@link grant} answers who gets in. */
  request(key: K, request: BookingRequest): void {
    this.workerPids.add(request.pid);
    this.queue.push({ ...request, key, askedAt: this.clock() });
  }

  /** Takes `key` out of the line, as when its wait runs out. Answers whether it was waiting. */
  withdraw(key: K): boolean {
    const i = this.queue.findIndex((w) => w.key === key);
    if (i < 0) return false;
    this.queue.splice(i, 1);
    return true;
  }

  /**
   * Books sessions for the files at the head of the line, in arrival order, as
   * long as the next one fits; a file behind one that doesn't fit waits too.
   * Answers the keys booked.
   */
  grant(): K[] {
    const granted: K[] = [];
    while (this.queue.length > 0) {
      const head = this.queue[0];
      const used = this.committed();
      if (used + head.n > this.capacity) break;
      this.queue.shift();
      const now = this.clock();
      this.holders.set(head.key, {
        file: head.file,
        pid: head.pid,
        n: head.n,
        serials: new Set(),
        closed: new Set(),
        grantedAt: now,
        mostSeen: 0,
      });
      this.grants.push({ file: head.file, n: head.n, at: now, waitMs: now - head.askedAt });
      this.peakCommitted = Math.max(this.peakCommitted, used + head.n);
      granted.push(head.key);
    }
    return granted;
  }

  /** Gives `key`'s sessions back. Its gems still on the stone keep counting until they leave. */
  release(key: K): void {
    const h = this.holders.get(key);
    if (h) {
      const g = this.grants.findLast((x) => x.file === h.file && x.holdMs === undefined);
      if (g) g.holdMs = this.clock() - h.grantedAt;
    }
    this.holders.delete(key);
    this.withdraw(key);
  }

  /**
   * `key`'s file logged in the session with login serial `serial`, reported at
   * `reportedAt` by the test's clock: the report itself can reach the gate late
   * (see {@link ReportedFailure}).
   */
  opened(key: K, serial: string, reportedAt?: number): void {
    // As in `sample`: serial 0 would read as the start of the run's serials,
    // and is what the stone describes a session that has already gone with.
    if (!(Number(serial) > 0)) return;
    const h = this.holders.get(key);
    h?.serials.add(serial);
    this.reported.set(serial, { at: this.testTime(reportedAt), file: h?.file });
  }

  /** `key`'s file logged out the session with login serial `serial`, or ended its gem. */
  closed(key: K, serial: string): void {
    this.holders.get(key)?.closed.add(serial);
  }

  /**
   * `key`'s file had a login fail. One the stone `denied` used up a login serial
   * with no session to show for it; any other failure is only kept for
   * {@link loginsAround}.
   */
  loginFailed(key: K, failure: FailedLogin, denied: boolean): void {
    const h = this.holders.get(key);
    const at = this.clock();
    const times = {
      startedAt: this.testTime(failure.startedAt),
      failedAt: this.testTime(failure.failedAt),
    };
    const reported = { failure: { ...failure, ...times }, at, pid: h?.pid, file: h?.file };
    (denied ? this.refusals : this.otherFailures).push(reported);
  }

  /** A time the test sent, or, if it sent none, when its report reached the gate. */
  private testTime(at: number | undefined): number {
    return Number.isFinite(at) ? at! : this.clock();
  }

  /** Matches an unmatched refusal by worker `pid` near `at` to `what`, if there is one. */
  private refusalNear(at: number, pid: number, what: string): boolean {
    const r = this.refusals.find(
      (x) =>
        x.matchedTo === undefined &&
        x.pid === pid &&
        apart(spanOf(x), [at, at]) <= REFUSAL_SPAN_SLACK_MS,
    );
    if (r) r.matchedTo = what;
    return r !== undefined;
  }

  /**
   * The watcher's look at the stone: each user session's login serial and its
   * GCI client's process id. The first look is what was there before any file booked.
   * Answers the sessions that were there before, on the first look only.
   */
  sample(sessions: Map<string, number>): Map<string, number> | undefined {
    // A session part way into its login can show serial 0, which would read as
    // the start of the run's serials.
    sessions = new Map([...sessions].filter(([serial]) => Number(serial) > 0));
    const serials = new Set(sessions.keys());
    let leftOver: Map<string, number> | undefined;
    if (!this.before) {
      this.before = sessions;
      this.pidsAtFirstLook = new Set(this.workerPids);
      leftOver = sessions;
    }
    const now = this.clock();
    for (const [serial, pid] of sessions) {
      if (!this.before.has(serial) && !this.sightings.has(serial))
        this.sightings.set(serial, { pid, firstSeen: now });
    }
    this.live = serials;
    this.peakLive = Math.max(this.peakLive, serials.size);
    for (const h of this.holders.values()) {
      h.mostSeen = Math.max(h.mostSeen, this.onStone(h, { loggedIn: true }));
      if (h.mostSeen > h.n) {
        const prev = this.overBudgetFiles.get(h.file);
        this.overBudgetFiles.set(h.file, {
          booked: h.n,
          seen: Math.max(h.mostSeen, prev?.seen ?? 0),
        });
      }
    }
    return leftOver;
  }

  /**
   * How many of `h`'s sessions are on the stone: all of them, or only those
   * still logged in. A logged-out gem lingers a moment, for as long as the stone
   * takes, so only the logged-in count is the same from one run to the next.
   */
  private onStone(h: Holder, { loggedIn = false } = {}): number {
    let seen = 0;
    for (const s of h.serials) if (this.live?.has(s) && !(loggedIn && h.closed.has(s))) seen++;
    return seen;
  }

  /**
   * Sessions in use: each running file counts what it booked or what it has on
   * the stone, whichever is more, so a file over its booking can't make the gate
   * give its extra slot to another file. Every session on the stone that no
   * running file reported counts too: gems still leaving, sessions from outside
   * the run. Before the watcher's first look, everything is taken.
   */
  committed(): number {
    if (!this.live) return Infinity;
    let reserved = 0;
    const owned = new Set<string>();
    for (const h of this.holders.values()) {
      reserved += Math.max(h.n, this.onStone(h));
      for (const s of h.serials) owned.add(s);
    }
    let unowned = 0;
    for (const s of this.live) if (!owned.has(s)) unowned++;
    return reserved + unowned;
  }

  /** The most sessions `key`'s file had logged in at once, if more than it booked. */
  overBudgetOf(key: K): { booked: number; seen: number } | undefined {
    const h = this.holders.get(key);
    return h && h.mostSeen > h.n ? { booked: h.n, seen: h.mostSeen } : undefined;
  }

  /** Every file that went over its booking during the run. */
  overBudget(): Map<string, { booked: number; seen: number }> {
    return this.overBudgetFiles;
  }

  /**
   * Sessions `key`'s worker logged in during its booking that no file reported,
   * each answered once. One its file reported refused near when it was seen is
   * a refused login, not an unreported one.
   */
  unreportedFrom(key: K): { serial: string; firstSeen: number }[] {
    const h = this.holders.get(key);
    if (!h) return [];
    const found: { serial: string; firstSeen: number }[] = [];
    for (const [serial, s] of this.sightings) {
      if (s.pid !== h.pid || s.firstSeen < h.grantedAt) continue;
      if (this.reported.has(serial) || this.blamed.has(serial) || this.excused.has(serial))
        continue;
      // A login seen on the stone before the stone refused it.
      if (this.refusalNear(s.firstSeen, h.pid, `login serial ${serial}, seen on the stone`)) {
        this.excused.add(serial);
        continue;
      }
      this.blamed.add(serial);
      found.push({ serial, firstSeen: s.firstSeen });
    }
    return found;
  }

  /**
   * What the gate knew of `key`'s logins, for the report on a file blamed for
   * `blamed`: each login the file reported failed, then each login serial within
   * {@link LOGINS_AROUND_SPAN} of a blamed one, whoever made it. Times are
   * seconds into the run.
   */
  loginsAround(key: K, blamed: string[]): string[] {
    const h = this.holders.get(key);
    if (!h) return [];
    const its = (r: ReportedFailure) => r.pid === h.pid && r.file === h.file && r.at >= h.grantedAt;
    const failures = [
      ...this.refusals.filter(its).map((r) => ({ r, denied: true })),
      ...this.otherFailures.filter(its).map((r) => ({ r, denied: false })),
    ].sort((a, b) => a.r.failure.startedAt - b.r.failure.startedAt);
    const lines = failures.length
      ? failures.map(({ r, denied }) => this.describeFailure(r, denied))
      : ['no failed login reported from this test worker'];
    const serials = new Set<number>();
    for (const b of blamed) {
      for (let n = Number(b) - LOGINS_AROUND_SPAN; n <= Number(b) + LOGINS_AROUND_SPAN; n++) {
        if (n > 0) serials.add(n);
      }
    }
    for (const n of [...serials].sort((a, b) => a - b)) {
      lines.push(this.describeSerial(String(n), h.pid));
    }
    return lines;
  }

  private describeFailure(r: ReportedFailure, denied: boolean): string {
    const f = r.failure;
    const when = `called ${this.secondsIn(f.startedAt)} and failed ${this.secondsIn(f.failedAt)} by the test's clock, reported to the gate ${this.secondsIn(r.at)}`;
    const error = `error ${f.number ?? 'with no number'}: ${f.message}`;
    let outcome: string;
    if (!denied) outcome = 'not refused by the stone, so matched to nothing';
    // The end of the run can still match it to a login too short for the watcher to see.
    else outcome = r.matchedTo ? `matched to ${r.matchedTo}` : 'not matched yet';
    return `failed login: ${when}; ${error}; ${outcome}`;
  }

  private describeSerial(serial: string, ownPid: number): string {
    const facts: string[] = [];
    if (this.before?.has(serial)) facts.push('on the stone before the run');
    const s = this.sightings.get(serial);
    if (s) {
      const whose = s.pid === ownPid ? 'this test worker' : `worker ${s.pid}`;
      facts.push(`seen ${this.secondsIn(s.firstSeen)} from ${whose}`);
    }
    const r = this.reported.get(serial);
    if (r)
      facts.push(
        `reported ${this.secondsIn(r.at)}${r.file ? ` from ${testFileName(r.file)}` : ''}`,
      );
    if (this.excused.has(serial)) facts.push('excused as a refused login');
    if (this.blamed.has(serial)) facts.push('blamed');
    return `login serial ${serial}: ${facts.join(', ') || 'never seen or reported'}`;
  }

  /**
   * Logins from test workers no file reported and no file was blamed for, such
   * as one made after its file gave its booking back, or one a worker that had
   * already asked for a booking made before any file booked, still on the stone
   * at the first look.
   */
  stray(): { serial: string; pid: number }[] {
    const fromSightings = [...this.sightings]
      .filter(
        ([serial, s]) =>
          this.workerPids.has(s.pid) &&
          !this.reported.has(serial) &&
          !this.blamed.has(serial) &&
          !this.excused.has(serial),
      )
      .map(([serial, s]) => ({ serial, pid: s.pid }));
    const fromBefore = [...(this.before ?? [])]
      .filter(([, pid]) => this.pidsAtFirstLook?.has(pid))
      .map(([serial, pid]) => ({ serial, pid }));
    return [...fromBefore, ...fromSightings];
  }

  /**
   * Login serials go up by one per login on the stone, so a serial between two
   * the gate knows of that it never saw nor was told about is a login too short
   * for the watcher's look. `firstSerial` and `endSerial` bound the run's logins.
   * Answers each with the files that held bookings in the time it can have
   * happened, the known serials either side, and the refusals reported near it.
   * Each reported refusal not already matched to a session the watcher saw
   * accounts for one such serial.
   *
   * A login the watcher's look leaves out (GcUser, SymbolUser), or one made
   * between the watcher's own login and its first look, would show here too.
   */
  loginsNeverSeen(firstSerial: number | undefined, endSerial: number): UnseenLogin[] {
    const when = new Map<number, KnownSerial>();
    const know = (serial: number, at: number, how: KnownSerial['how']) => {
      const prev = when.get(serial);
      if (!prev || at < prev.at) when.set(serial, { serial, at, how });
    };
    if (firstSerial !== undefined) know(firstSerial, this.startedAt, 'run edge');
    know(endSerial, this.clock(), 'run edge');
    for (const [serial, s] of this.sightings) know(Number(serial), s.firstSeen, 'seen');
    for (const [serial, r] of this.reported) know(Number(serial), r.at, 'reported');
    const known = [...when.keys()].sort((a, b) => a - b);
    const missed: UnseenLogin[] = [];
    for (let i = 1; i < known.length; i++) {
      const after = when.get(known[i - 1])!;
      const before = when.get(known[i])!;
      for (let serial = known[i - 1] + 1; serial < known[i]; serial++) {
        const running = this.grants
          .filter(
            (g) => g.at <= before.at && (g.holdMs === undefined || g.at + g.holdMs >= after.at),
          )
          .map((g) => testFileName(g.file));
        missed.push({ serial, running: [...new Set(running)], after, before, refusalsNearby: [] });
      }
    }
    // Nearest gap, not the one containing it: the watcher dates a serial when it
    // sees or hears of it, after the login that used it.
    const distance = (m: UnseenLogin, r: ReportedFailure) =>
      apart(spanOf(r), [m.after.at, m.before.at]);
    const unexplained = [...missed];
    for (const refusal of this.refusals) {
      if (refusal.matchedTo !== undefined) continue;
      let best = -1;
      for (let i = 0; i < unexplained.length; i++) {
        if (best < 0 || distance(unexplained[i], refusal) < distance(unexplained[best], refusal))
          best = i;
      }
      if (best >= 0 && distance(unexplained[best], refusal) <= REFUSAL_SPAN_SLACK_MS) {
        refusal.matchedTo = `unseen login serial ${unexplained[best].serial}`;
        unexplained.splice(best, 1);
      }
    }
    for (const m of unexplained) {
      m.refusalsNearby = this.refusals.filter((r) => distance(m, r) <= UNSEEN_LOGIN_CONTEXT_MS);
    }
    return unexplained;
  }

  /** `at`, a time from this ledger's clock, as seconds into the run. */
  secondsIn(at: number): string {
    return `${((at - this.startedAt) / 1000).toFixed(2)} s`;
  }

  describeHolders(): string {
    return (
      [...this.holders.values()].map((h) => `${testFileName(h.file)} (${h.n})`).join(', ') ||
      'no running file'
    );
  }
}
