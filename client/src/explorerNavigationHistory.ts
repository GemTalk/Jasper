/**
 * Go Back / Go Forward over Jasper's OWN navigation landings.
 *
 * A landing is a *coordinate* — session + dictionary + class category + class +
 * side + selector — not a handle on an object. Back recomputes the coordinate
 * against the live stone, so a method that has since been recompiled (or a class
 * that has been reshaped) still resolves; one that has genuinely gone is dropped
 * from the chain instead of erroring.
 *
 * Semantics are the browser's, which is also VS Code's: a linear chain with a
 * cursor, Forward re-walks what Back undid, and a new landing after going Back
 * discards the forward tail. No branching.
 *
 * Two things shape the chain beyond that:
 *
 * - **Back and Forward step method to method.** Browsing is mostly reading
 *   methods, and a dictionary or class you passed through on the way is not a
 *   place you want a press of Back to stop at. Coarser landings are still
 *   recorded — Recent Locations lists the whole chain — they are just stepped
 *   over. Consecutive coarse landings collapse into one, so flipping between two
 *   dictionaries leaves one entry, not two.
 *
 * - **One chain per session.** A landing only means anything against the stone it
 *   was read from, so each session gets its own chain and the pane shows the
 *   selected session's. A session logging out takes its chain with it.
 */
export interface ExplorerLanding {
  sessionId: number;
  dictName: string;
  /** 1-based symbolList position at record time; re-resolved by name on the way back. */
  dictIndex: number;
  /** Selected class category, or undefined for "all classes in the dictionary". */
  classCategory?: string;
  className?: string;
  /** Selected method, when the landing reached one. */
  selector?: string;
  /** Which side the selector lives on; only meaningful with `selector`. */
  isMeta?: boolean;
}

/** Bounded ring: oldest landings fall off the back once the chain is this long. */
export const MAX_LANDINGS = 50;

/**
 * Identity of a landing, for the duplicate check and for the cursor-follow that
 * keeps VS Code's own Back in step with ours.
 *
 * The class category counts only for a landing that names no class. Once a class
 * is named the category is *derived* from it — a class has exactly one, and
 * `revealClass` pins the pane to it on the way back — so including it would give
 * one method two identities: none when you clicked it under "all classes", and
 * the class's category when you walked back to it. Two identities for one method
 * means Back never recognises where it already is.
 */
export function landingKey(l: ExplorerLanding): string {
  return [
    l.sessionId,
    l.dictName,
    l.className === undefined ? (l.classCategory ?? '') : '',
    l.className ?? '',
    l.selector === undefined ? '' : `${l.isMeta ? 'class' : 'instance'}:${l.selector}`,
  ].join('|');
}

/** A landing that reached a method — the only kind Back and Forward stop at. */
export function isMethodLanding(l: ExplorerLanding): boolean {
  return l.className !== undefined && l.selector !== undefined;
}

/**
 * How the trail names a landing.
 *
 * `full` spells the whole coordinate out — `Array class>>new`, `Array`,
 * `Globals · Collections`, `Globals`.
 *
 * `selectors` drops the class from a method landing, leaving just `new`. Walking
 * around inside one class produces a run of landings whose labels are identical
 * but for the selector, and in a sidebar-width pane the repeated class name
 * squeezes out the only part that differs. The class isn't lost — it moves to the
 * dimmed context column (see `landingContext`). Landings that name no method are
 * unaffected: there is nothing to shorten.
 */
export type TrailLabelMode = 'full' | 'selectors';

export function landingLabel(l: ExplorerLanding, mode: TrailLabelMode = 'full'): string {
  if (l.className === undefined) {
    return l.classCategory ? `${l.dictName} · ${l.classCategory}` : l.dictName;
  }
  const target = l.isMeta ? `${l.className} class` : l.className;
  if (l.selector === undefined) return target;
  return mode === 'selectors' ? l.selector : `${target}>>${l.selector}`;
}

/**
 * The dimmed half of a trail row: the context the label leaves out. In `full` that
 * is the dictionary; in `selectors` it is the class the shortened label dropped,
 * for a method landing, and the dictionary for anything else.
 */
export function landingContext(l: ExplorerLanding, mode: TrailLabelMode = 'full'): string {
  if (mode === 'selectors' && l.className !== undefined && l.selector !== undefined) {
    return l.isMeta ? `${l.className} class` : l.className;
  }
  return l.dictName;
}

/**
 * The whole coordinate spelled out as a breadcrumb — `Globals · Collections ·
 * Array class>>new`. Used where a row has the width for it and no column beside
 * it to carry the context: the pinned current-location line, and Recent
 * Locations, which is the one place the coarse landings Back steps over are on
 * show and so has to say which dictionary and category each one is.
 */
export function landingPath(l: ExplorerLanding): string {
  const parts = [l.dictName];
  if (l.classCategory !== undefined) parts.push(l.classCategory);
  if (l.className !== undefined) parts.push(landingLabel(l));
  return parts.join(' · ');
}

/**
 * True when `next` lands on the same place as `top`, only more precisely —
 * a dictionary or category refined to a class in it, or a class refined to one
 * of its methods. Such a pair is ONE navigation seen mid-cascade (clicking a
 * class then a method in it, or the two records a single `revealClass` makes),
 * so the refinement replaces its parent rather than pushing a second entry.
 * Without this, Back would need two presses to leave a method.
 */
function refines(top: ExplorerLanding, next: ExplorerLanding): boolean {
  if (top.sessionId !== next.sessionId || top.dictName !== next.dictName) return false;
  if (top.className === undefined) {
    // Dictionary/category → a class under it (a category-less top matches any class).
    return (
      next.className !== undefined &&
      (top.classCategory === undefined || top.classCategory === next.classCategory)
    );
  }
  // Class → one of its own methods.
  return (
    top.className === next.className && top.selector === undefined && next.selector !== undefined
  );
}

/** One session's chain and where in it we are. */
interface SessionChain {
  landings: ExplorerLanding[];
  cursor: number;
}

/** Extra facts about a landing that change how it joins the chain. */
export interface RecordOptions {
  /**
   * The landing came from an editor gaining focus rather than a click in the
   * Explorer — VS Code's own Back/Forward, a click on a tab, Ctrl+Tab. Such a
   * landing on the entry either side of the cursor is the native history walking
   * the same chain we are, so it MOVES the cursor instead of pushing a duplicate.
   * A tree click on the same method is a fresh navigation and still pushes.
   */
  fromEditor?: boolean;
}

export interface ExplorerNavigationHistoryOptions {
  /**
   * Navigate the Explorer to a landing. Resolves true when it landed, false when
   * the coordinate no longer resolves (dead session, dropped class, removed
   * method) so its entry can be pruned.
   */
  go(landing: ExplorerLanding): Promise<boolean>;
  /** Fired whenever the chain or the cursor moved, so the pane and the button
   *  enablement can be repainted. */
  onChange?(): void;
  /** Run when Back or Forward is pressed with nowhere left to go in this chain,
   *  so the press can fall through to VS Code's own history instead of dead-ending. */
  passThrough?(direction: 'back' | 'forward'): void;
}

export class ExplorerNavigationHistory {
  // One chain per session id. A session that logs out has its chain deleted, so
  // this never accumulates chains for stones that are gone.
  private readonly chains = new Map<number, SessionChain>();
  private activeSessionId: number | undefined;
  private readonly go: (landing: ExplorerLanding) => Promise<boolean>;
  private readonly onChange: () => void;
  private readonly passThrough: (direction: 'back' | 'forward') => void;
  // True while back/forward is driving the Explorer. The reveals it runs record
  // landings of their own — including intermediate, coarser ones as the panes
  // cascade — and replaying those back into the chain would corrupt it.
  private restoring = false;

  constructor(options: ExplorerNavigationHistoryOptions) {
    this.go = options.go;
    this.onChange = options.onChange ?? ((): void => {});
    this.passThrough = options.passThrough ?? ((): void => {});
  }

  /** Which session's chain the pane and the buttons are showing. */
  currentSessionId(): number | undefined {
    return this.activeSessionId;
  }

  /**
   * Show a different session's chain — wired to the session picker, so switching
   * sessions switches the trail with it rather than showing another stone's
   * methods. A session with nothing recorded yet simply shows an empty chain.
   */
  setActiveSession(sessionId: number | undefined): void {
    if (this.activeSessionId === sessionId) return;
    this.activeSessionId = sessionId;
    this.onChange();
  }

  /**
   * A session has gone: throw its chain away. If it was the one on show, fall back
   * to whichever remaining session was recorded into most recently, so logging out
   * of one of two sessions leaves the other's trail up rather than a blank pane.
   */
  dropSession(sessionId: number): void {
    const had = this.chains.delete(sessionId);
    if (this.activeSessionId !== sessionId) {
      if (had) this.onChange();
      return;
    }
    // Map iteration is insertion-ordered and `record` re-inserts on every landing,
    // so the last key is the most recently used session.
    let mostRecent: number | undefined;
    for (const id of this.chains.keys()) mostRecent = id;
    this.activeSessionId = mostRecent;
    this.onChange();
  }

  /** Forget the shown session's chain, leaving other sessions' chains alone. */
  clear(): void {
    if (this.activeSessionId === undefined) return;
    this.chains.delete(this.activeSessionId);
    this.onChange();
  }

  private chain(): SessionChain | undefined {
    return this.activeSessionId === undefined ? undefined : this.chains.get(this.activeSessionId);
  }

  /** The shown session's chain, oldest first. Includes the coarse landings that
   *  Back and Forward step over; Recent Locations lists all of them. */
  entries(): readonly ExplorerLanding[] {
    return this.chain()?.landings ?? [];
  }

  /** Index of the landing currently being shown, or -1 when the chain is empty. */
  currentIndex(): number {
    return this.chain()?.cursor ?? -1;
  }

  current(): ExplorerLanding | undefined {
    const chain = this.chain();
    return chain && chain.cursor >= 0 ? chain.landings[chain.cursor] : undefined;
  }

  /** True when the shown session has recorded anything at all. */
  isEmpty(): boolean {
    return this.entries().length === 0;
  }

  /**
   * Record that the Explorer landed somewhere.
   *
   * Ignores anything recorded while back/forward is itself navigating, a repeat
   * of where we already are, and a *coarsening* of it — what a category click
   * that keeps the current class selected records.
   */
  record(landing: ExplorerLanding, options: RecordOptions = {}): void {
    if (this.restoring) return;
    // A landing is always recorded against its own session's chain, and showing it
    // is what makes that session's trail the one on screen.
    const switched = this.activeSessionId !== landing.sessionId;
    this.activeSessionId = landing.sessionId;
    let chain = this.chains.get(landing.sessionId);
    if (chain) {
      // Re-insert so the most recently used session is last, which is what
      // dropSession falls back to.
      this.chains.delete(landing.sessionId);
    } else {
      chain = { landings: [], cursor: -1 };
    }
    this.chains.set(landing.sessionId, chain);

    const top = chain.cursor >= 0 ? chain.landings[chain.cursor] : undefined;
    if (top) {
      // Neither of these is a move, so the chain is left alone — but a repaint is
      // still owed when the landing arrived from a session we were not showing.
      if (landingKey(top) === landingKey(landing)) {
        if (switched) this.onChange();
        return;
      }
      if (refines(landing, top)) {
        if (switched) this.onChange();
        return; // coarser than where we are: not a move
      }
      if (options.fromEditor && this.followNative(chain, landing)) return;
      // A refinement of where we are, or one coarse landing after another (flipping
      // between dictionaries), replaces the entry rather than adding one — and
      // still ends the forward tail, being a fresh navigation.
      if (refines(top, landing) || (!isMethodLanding(top) && !isMethodLanding(landing))) {
        chain.landings[chain.cursor] = landing;
        this.settle(chain, chain.cursor);
        this.onChange();
        return;
      }
    }
    chain.landings[chain.cursor + 1] = landing;
    this.settle(chain, chain.cursor + 1);
    this.onChange();
  }

  /**
   * Finish a landing that has just been written at `at`: end the forward tail,
   * drop any earlier visit to the same place, and leave the cursor on it.
   *
   * One row per place, at its most recent visit — going back to a method you read
   * earlier moves its row rather than listing it twice, which in a chain this long
   * is the difference between a trail you can read and one full of repeats.
   */
  private settle(chain: SessionChain, at: number): void {
    chain.landings.length = at + 1; // drop any forward history
    const key = landingKey(chain.landings[at]);
    for (let i = at - 1; i >= 0; i--) {
      if (landingKey(chain.landings[i]) === key) chain.landings.splice(i, 1);
    }
    if (chain.landings.length > MAX_LANDINGS) chain.landings.shift();
    chain.cursor = chain.landings.length - 1;
  }

  /**
   * VS Code's Back or Forward just walked onto the entry beside ours: move the
   * cursor with it instead of pushing a duplicate, so the two histories stay on
   * the same step. Answers whether it matched.
   */
  private followNative(chain: SessionChain, landing: ExplorerLanding): boolean {
    const key = landingKey(landing);
    for (const neighbour of [chain.cursor - 1, chain.cursor + 1]) {
      if (neighbour < 0 || neighbour >= chain.landings.length) continue;
      if (landingKey(chain.landings[neighbour]) !== key) continue;
      chain.cursor = neighbour;
      this.onChange();
      return true;
    }
    return false;
  }

  /**
   * The chain positions Back and Forward stop at: the method landings, plus the
   * newest entry whatever it is. That last part matters when the newest entry is
   * a dictionary or a class — going Back from it to the method before it has to
   * leave a Forward that returns to it, or the place you were standing when you
   * pressed Back becomes unreachable.
   */
  private stops(chain: SessionChain): number[] {
    const newest = chain.landings.length - 1;
    return chain.landings
      .map((landing, index) => (isMethodLanding(landing) || index === newest ? index : -1))
      .filter((index) => index >= 0);
  }

  private nextStop(direction: 'back' | 'forward'): number | undefined {
    const chain = this.chain();
    if (!chain) return undefined;
    const stops = this.stops(chain);
    return direction === 'back'
      ? stops.filter((i) => i < chain.cursor).pop()
      : stops.find((i) => i > chain.cursor);
  }

  canGoBack(): boolean {
    return this.nextStop('back') !== undefined;
  }

  canGoForward(): boolean {
    return this.nextStop('forward') !== undefined;
  }

  async back(): Promise<void> {
    await this.walk('back');
  }

  async forward(): Promise<void> {
    await this.walk('forward');
  }

  private async walk(direction: 'back' | 'forward'): Promise<void> {
    const target = this.nextStop(direction);
    // Nothing of ours left that way: hand the press to VS Code's own history
    // rather than swallowing it, since our commands take over its keybindings
    // wherever the Explorer or a gemstone:// editor has focus.
    if (target === undefined) {
      this.passThrough(direction);
      return;
    }
    await this.step(target);
  }

  /** Jump straight to an entry the user clicked in the Actions & Navigation pane
   *  or picked from Recent Locations. */
  async goToIndex(index: number): Promise<void> {
    const chain = this.chain();
    if (!chain) return;
    if (index < 0 || index >= chain.landings.length || index === chain.cursor) return;
    await this.step(index);
  }

  private async step(target: number): Promise<void> {
    const chain = this.chain();
    if (!chain) return;
    const landing = chain.landings[target];
    const from = chain.cursor;
    // Move the cursor first so the pane and the buttons reflect the jump while it
    // runs; `restoring` keeps the reveals it provokes out of the chain.
    chain.cursor = target;
    this.onChange();
    let ok = false;
    this.restoring = true;
    try {
      ok = await this.go(landing);
    } catch {
      ok = false;
    } finally {
      this.restoring = false;
    }
    if (ok) return;
    // Couldn't get there: drop the stale entry and put the cursor back where it
    // was, so a second press tries the next landing along instead of sticking.
    chain.landings.splice(target, 1);
    chain.cursor = target < from ? from - 1 : from;
    this.onChange();
  }
}
