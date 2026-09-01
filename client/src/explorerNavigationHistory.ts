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

/** Identity of a landing, for the duplicate check. */
export function landingKey(l: ExplorerLanding): string {
  return [
    l.sessionId,
    l.dictName,
    l.classCategory ?? '',
    l.className ?? '',
    l.selector === undefined ? '' : `${l.isMeta ? 'class' : 'instance'}:${l.selector}`,
  ].join('|');
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
}

export class ExplorerNavigationHistory {
  private readonly landings: ExplorerLanding[] = [];
  private cursor = -1;
  private readonly go: (landing: ExplorerLanding) => Promise<boolean>;
  private readonly onChange: () => void;
  // True while back/forward is driving the Explorer. The reveals it runs record
  // landings of their own — including intermediate, coarser ones as the panes
  // cascade — and replaying those back into the chain would corrupt it.
  private restoring = false;

  constructor(options: ExplorerNavigationHistoryOptions) {
    this.go = options.go;
    this.onChange = options.onChange ?? ((): void => {});
  }

  /** The chain, oldest first. */
  entries(): readonly ExplorerLanding[] {
    return this.landings;
  }

  /** Index of the landing currently being shown, or -1 when the chain is empty. */
  currentIndex(): number {
    return this.cursor;
  }

  current(): ExplorerLanding | undefined {
    return this.cursor >= 0 ? this.landings[this.cursor] : undefined;
  }

  /**
   * Record that the Explorer landed somewhere.
   *
   * Ignores anything recorded while back/forward is itself navigating, a repeat
   * of where we already are, and a *coarsening* of it — what a category click
   * that keeps the current class selected records.
   */
  record(landing: ExplorerLanding): void {
    if (this.restoring) return;
    const top = this.current();
    if (top) {
      if (landingKey(top) === landingKey(landing)) return;
      if (refines(landing, top)) return; // coarser than where we are: not a move
      if (refines(top, landing)) {
        this.landings[this.cursor] = landing;
        this.landings.length = this.cursor + 1; // a refinement still ends the forward tail
        this.onChange();
        return;
      }
    }
    this.landings.length = this.cursor + 1; // drop any forward history
    this.landings.push(landing);
    if (this.landings.length > MAX_LANDINGS) this.landings.shift();
    this.cursor = this.landings.length - 1;
    this.onChange();
  }

  canGoBack(): boolean {
    return this.cursor > 0;
  }

  canGoForward(): boolean {
    return this.cursor >= 0 && this.cursor < this.landings.length - 1;
  }

  async back(): Promise<void> {
    if (this.canGoBack()) await this.step(this.cursor - 1);
  }

  async forward(): Promise<void> {
    if (this.canGoForward()) await this.step(this.cursor + 1);
  }

  /** Jump straight to an entry the user clicked in the Actions & Navigation pane. */
  async goToIndex(index: number): Promise<void> {
    if (index < 0 || index >= this.landings.length || index === this.cursor) return;
    await this.step(index);
  }

  private async step(target: number): Promise<void> {
    const landing = this.landings[target];
    const from = this.cursor;
    // Move the cursor first so the pane and the buttons reflect the jump while it
    // runs; `restoring` keeps the reveals it provokes out of the chain.
    this.cursor = target;
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
    this.landings.splice(target, 1);
    this.cursor = target < from ? from - 1 : from;
    this.onChange();
  }
}
