// The session gate's bookkeeping (see sessionGate.globalSetup.ts), kept apart
// from its sockets and its watcher session so it can be tested without a stone.
// `K` identifies a file's booking: a socket in the gate, anything in a test.

/** How long after its login a refusal's report can arrive (see loginsNeverSeen). */
export const REFUSAL_REPORT_SLACK_MS = 2_000;

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
  // Sessions already on the stone when the run started belong to no test file.
  private before: Set<string> | undefined;
  private readonly sightings = new Map<string, Sighting>();
  // Login serial -> when a file reported it.
  private readonly reported = new Map<string, number>();
  // Logins files reported the stone refused, each of which used up a serial,
  // and may have been seen on the stone, with no user yet, before it was refused.
  private readonly refusals: { at: number; pid: number | undefined; used: boolean }[] = [];
  private readonly excused = new Set<string>();
  private readonly blamed = new Set<string>();
  private readonly workerPids = new Set<number>();
  private readonly overBudgetFiles = new Map<string, { booked: number; seen: number }>();
  readonly grants: Grant[] = [];
  peakCommitted = 0;
  peakLive = 0;

  constructor(
    readonly capacity: number,
    private readonly clock: () => number = Date.now,
  ) {}

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

  /** `key`'s file logged in the session with login serial `serial`. */
  opened(key: K, serial: string): void {
    this.holders.get(key)?.serials.add(serial);
    this.reported.set(serial, this.clock());
  }

  /** `key`'s file logged out the session with login serial `serial`, or ended its gem. */
  closed(key: K, serial: string): void {
    this.holders.get(key)?.closed.add(serial);
  }

  /** `key`'s file had a login refused, using up a login serial with no session to show for it. */
  refused(key: K): void {
    this.refusals.push({ at: this.clock(), pid: this.holders.get(key)?.pid, used: false });
  }

  /** Spends an unused refusal by worker `pid` near `at`, if there is one. */
  private refusalNear(at: number, pid?: number): boolean {
    const r = this.refusals.find(
      (x) =>
        !x.used &&
        (pid === undefined || x.pid === pid) &&
        Math.abs(x.at - at) <= REFUSAL_REPORT_SLACK_MS,
    );
    if (r) r.used = true;
    return r !== undefined;
  }

  /**
   * The watcher's look at the stone: each user session's login serial and its
   * GCI client's process id. The first look is what was there before the run.
   * Answers the sessions that were there before, on the first look only.
   */
  sample(sessions: Map<string, number>): Map<string, number> | undefined {
    // A session part way into its login can show serial 0, which would read as
    // the start of the run's serials.
    sessions = new Map([...sessions].filter(([serial]) => Number(serial) > 0));
    const serials = new Set(sessions.keys());
    let leftOver: Map<string, number> | undefined;
    if (!this.before) {
      this.before = serials;
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
      if (this.refusalNear(s.firstSeen, h.pid)) {
        this.excused.add(serial);
        continue;
      }
      this.blamed.add(serial);
      found.push({ serial, firstSeen: s.firstSeen });
    }
    return found;
  }

  /** Logins from test workers no file reported and no file was blamed for, such as one made after its file gave its booking back. */
  stray(): { serial: string; pid: number }[] {
    return [...this.sightings]
      .filter(
        ([serial, s]) =>
          this.workerPids.has(s.pid) &&
          !this.reported.has(serial) &&
          !this.blamed.has(serial) &&
          !this.excused.has(serial),
      )
      .map(([serial, s]) => ({ serial, pid: s.pid }));
  }

  /**
   * Login serials go up by one per login on the stone, so a serial between two
   * the gate knows of that it never saw nor was told about is a login too short
   * for the watcher's look. `firstSerial` and `endSerial` bound the run's logins.
   * Answers each with the files that held bookings in the time it can have
   * happened. Each reported refusal not already matched to a session the
   * watcher saw accounts for one such serial.
   */
  loginsNeverSeen(
    firstSerial: number | undefined,
    endSerial: number,
  ): { serial: number; running: string[] }[] {
    const when = new Map<number, number>();
    if (firstSerial !== undefined) when.set(firstSerial, 0);
    when.set(endSerial, this.clock());
    for (const [serial, s] of this.sightings) when.set(Number(serial), s.firstSeen);
    for (const [serial, at] of this.reported) {
      const n = Number(serial);
      when.set(n, Math.min(at, when.get(n) ?? Infinity));
    }
    const known = [...when.keys()].sort((a, b) => a - b);
    const missed: { serial: number; from: number; to: number; running: string[] }[] = [];
    for (let i = 1; i < known.length; i++) {
      for (let serial = known[i - 1] + 1; serial < known[i]; serial++) {
        const from = when.get(known[i - 1])!;
        const to = when.get(known[i])!;
        const running = this.grants
          .filter((g) => g.at <= to && (g.holdMs === undefined || g.at + g.holdMs >= from))
          .map((g) => g.file.split('/client/')[1] ?? g.file);
        missed.push({ serial, from, to, running: [...new Set(running)] });
      }
    }
    // Nearest gap, not the one containing it: a refusal is reported once the
    // stone answers, which can be after the next login was already seen.
    const distance = (m: { from: number; to: number }, at: number) =>
      at < m.from ? m.from - at : at > m.to ? at - m.to : 0;
    for (const refusal of this.refusals) {
      if (refusal.used) continue;
      let best = -1;
      for (let i = 0; i < missed.length; i++) {
        if (best < 0 || distance(missed[i], refusal.at) < distance(missed[best], refusal.at))
          best = i;
      }
      if (best >= 0 && distance(missed[best], refusal.at) <= REFUSAL_REPORT_SLACK_MS) {
        refusal.used = true;
        missed.splice(best, 1);
      }
    }
    return missed.map(({ serial, running }) => ({ serial, running }));
  }

  describeHolders(): string {
    return (
      [...this.holders.values()].map((h) => `${h.file} (${h.n})`).join(', ') || 'no running file'
    );
  }
}
