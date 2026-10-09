import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  canClassBeWritten: vi.fn(() => true),
  deleteMethod: vi.fn(() => 'Deleted: Array >> at:'),
  getClassEnvironments: vi.fn(() => []),
  defaultQueryExecutorUsing: vi.fn(() => () => ''),
  sendersOf: vi.fn(() => []),
  hierarchyImplementorsOf: vi.fn(() => []),
}));
vi.mock('../../undo/queries/methodSlotQueries', () => ({
  captureMethodSlots: vi.fn(),
  applyMethodSlotOps: vi.fn(),
}));
vi.mock('../../methodResultsPicker', () => ({
  showMethodResults: vi.fn(),
  describeMethodResult: (r: { className: string; isMeta: boolean; selector: string }) =>
    `${r.className}${r.isMeta ? ' class' : ''} >> #${r.selector}`,
}));

import { ExplorerController, MethodItem } from '../../gemstoneExplorer';
import * as queries from '../../browserQueries';
import { window, __resetConfig, __setConfig } from '../../__mocks__/vscode';
import { captureMethodSlots } from '../../undo/queries/methodSlotQueries';
import { resetUndoStacks } from '../../undo/undoStack';
import type { SessionManager, ActiveSession } from '../../sessionManager';
import type { MethodSearchResult } from '../../queries/methodSearch';
import type { MethodSlot } from '../../undo/undoTypes';
import type { MessageOptions } from 'vscode';

/**
 * What removing a selection of methods costs before the user is asked anything.
 *
 * A row that is not an override is checked by scanning the whole image for senders. Walking
 * the selection a row at a time, and sweeping every configured method environment for each,
 * multiplied the two: ten methods over three environments was thirty whole-image scans and ten
 * progress notifications, run one after another while the user waited on a dialog that had not
 * appeared yet.
 *
 * The cost belongs to the SELECTION, not to each row in it — so what is pinned here is that
 * neither the scanning nor the notification grows with how many rows were picked. Both are
 * stated as comparisons between a small selection and a larger one, which is the invariant
 * itself.
 *
 * What the scan FINDS matters as much, so the last selector in a selection is checked to still
 * reach the confirmation.
 */

type SelectorInfo = {
  selector: string;
  category: string;
  overrideBits: number;
  sessionBit: number;
};

const SESSION = { id: 1 } as ActiveSession;

function makeController(): ExplorerController {
  const sessionManager = { getSelectedSession: () => SESSION } as unknown as SessionManager;
  const ctl = new ExplorerController(sessionManager);
  ctl.state.dictName = 'UserGlobals';
  ctl.state.dictIndex = 1;
  ctl.state.className = 'Array';
  return ctl;
}

function row(selector: string): MethodItem {
  const info: SelectorInfo = { selector, category: 'accessing', overrideBits: 0, sessionBit: 0 };
  return new MethodItem(false, info, info.category);
}

const rows = (n: number): MethodItem[] => Array.from({ length: n }, (_, i) => row(`selector${i}:`));

const removeMethods = (ctl: ExplorerController, picked: MethodItem[]) =>
  (ctl as unknown as { removeMethods: (n: MethodItem[]) => Promise<void> }).removeMethods(picked);

const sendersOf = queries.sendersOf as ReturnType<typeof vi.fn>;
const hierarchyImplementorsOf = queries.hierarchyImplementorsOf as ReturnType<typeof vi.fn>;
// `showWarningMessage` is overloaded and `vi.mocked` types the mock via the last
// (`MessageItem`) overload; removeMethods uses the string one, so narrow to it.
const showStringWarning: (
  message: string,
  options: MessageOptions,
  ...items: string[]
) => Thenable<string | undefined> = window.showWarningMessage;
const showWarningMessage = vi.mocked(showStringWarning);
const withProgress = window.withProgress as ReturnType<typeof vi.fn>;

/** How many whole-image sender scans the run issued: one per `sendersOf` call, which takes the
 *  whole list of selectors at once. */
const imageScans = (): number => sendersOf.mock.calls.length;

/** Every selector the run scanned for, whether asked about one at a time or as a list. */
const scannedSelectors = (): string[] =>
  sendersOf.mock.calls.flatMap((c) =>
    Array.isArray(c[1]) ? (c[1] as string[]) : [c[1] as string],
  );

const confirm = () =>
  showWarningMessage.mockImplementation((_m: string, _o: unknown, ...buttons: string[]) =>
    Promise.resolve(buttons.find((b) => /^Remove/.test(b))),
  );

/** Everything the one confirmation said: its message and its detail. */
const dialogText = (): string => {
  const [message, opts] = showWarningMessage.mock.calls[0] as [string, { detail?: string }];
  return `${message}\n${opts?.detail ?? ''}`;
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetConfig();
  resetUndoStacks();
  window.tabGroups.all = [];
  // Three method environments the user can see. The removal still scans environment 0 only,
  // so seeing more environments must not add scans either.
  __setConfig('gemstone', 'maxEnvironment', 2);
  vi.mocked(queries.canClassBeWritten).mockReturnValue(true);
  vi.mocked(queries.deleteMethod).mockReturnValue('Deleted: Array >> at:');
  // Nothing is an override, so every row takes the scan — the case the cost is about.
  hierarchyImplementorsOf.mockReturnValue([]);
  sendersOf.mockReturnValue([]);
  vi.mocked(captureMethodSlots).mockImplementation((_exec: unknown, slots: MethodSlot[]) =>
    slots.map((sl) => ({ exists: true, source: `${sl.selector}\n\t^1`, category: 'accessing' })),
  );
  confirm();
});

describe('the cost of removing a selection of methods', () => {
  it('scans the image the same number of times however many methods were picked', async () => {
    await removeMethods(makeController(), rows(2));
    const small = imageScans();
    vi.clearAllMocks();
    confirm();

    await removeMethods(makeController(), rows(6));

    expect(imageScans()).toBe(small);
  });

  it('shows one progress notification for the whole selection', async () => {
    await removeMethods(makeController(), rows(4));

    expect(withProgress).toHaveBeenCalledTimes(1);
  });

  it('shows the same number of progress notifications however many methods were picked', async () => {
    await removeMethods(makeController(), rows(2));
    const small = withProgress.mock.calls.length;
    vi.clearAllMocks();
    confirm();

    await removeMethods(makeController(), rows(6));

    expect(withProgress.mock.calls.length).toBe(small);
  });

  it('does not scan at all when every method picked is an override', async () => {
    // An override's senders simply resolve to the inherited implementation, so the scan is
    // beside the point. That saving is what makes the common case free, and it has to survive
    // whatever replaces the loop.
    hierarchyImplementorsOf.mockReturnValue([
      { className: 'Object', isMeta: false, selector: 'selector0:', environmentId: 0 },
    ]);

    await removeMethods(makeController(), rows(3));

    expect(imageScans()).toBe(0);
  });
});

describe('what the scan finds for a selection', () => {
  it('asks about every selector picked, not only the first', async () => {
    await removeMethods(makeController(), rows(3));

    expect(new Set(scannedSelectors())).toEqual(
      new Set(['selector0:', 'selector1:', 'selector2:']),
    );
  });

  it('names a sender of the last selector picked in the one confirmation', async () => {
    const senderOfLast: MethodSearchResult = {
      dictName: 'UserGlobals',
      className: 'Caller',
      isMeta: false,
      selector: 'usesTheLastOne',
      category: 'accessing',
      environmentId: 0,
    };
    sendersOf.mockImplementation((_s: unknown, selector: string | string[]) =>
      (Array.isArray(selector) ? selector : [selector]).includes('selector2:')
        ? [senderOfLast]
        : [],
    );

    await removeMethods(makeController(), rows(3));

    expect(dialogText()).toContain('usesTheLastOne');
  });
});
