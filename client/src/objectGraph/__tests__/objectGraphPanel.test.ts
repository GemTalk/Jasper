// The protocol between the webview and the walk.
//
// The panel is UI-only and stateless with respect to the walk: it hands over a complete
// view plus the handlers for THAT view on every render, and routes what comes back. Two
// things make it worth testing on its own. Every field in a message crosses a trust
// boundary -- the webview is the sender, and a bad payload must be dropped rather than
// passed on as NaN or "undefined". And clicks are serialised, because a scan is a blocking
// GCI call and two overlapping ones trip the session-busy check as an error the user did
// not cause.
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import * as vscode from 'vscode';
import { ObjectGraphPanel } from '../objectGraphPanel';
import type { ObjectGraphActions, ObjectGraphWalkView } from '../objectGraphWalk';

const view = (over: Partial<ObjectGraphWalkView> = {}): ObjectGraphWalkView =>
  ({
    trail: [{ oop: 10n, label: 'GraphDemoProduct' }],
    targetLabel: 'Product(Widget)',
    targetClass: 'GraphDemoProduct',
    targetOop: '10',
    groups: [],
    groupsByOop: {},
    scanMillis: 5,
    canvas: {
      nodes: [{ oop: '10', label: 'Product(Widget)', className: 'GraphDemoProduct' }],
      edges: [],
    },
    positions: {},
    removedCount: 0,
    ...over,
  }) as unknown as ObjectGraphWalkView;

describe('ObjectGraphPanel', () => {
  let panel: ObjectGraphPanel;
  let onClose: Mock;
  let actions: { [K in keyof ObjectGraphActions]: Mock };

  /** The panel VS Code handed back, so a test can drive its webview. */
  const created = (): {
    title: string;
    webview: { html: string; onDidReceiveMessage: Mock };
    onDidDispose: Mock;
  } => (vscode.window.createWebviewPanel as Mock).mock.results[0].value;

  /** Deliver one message from the view and let the handler settle. */
  const send = async (message: unknown): Promise<void> => {
    created().webview.onDidReceiveMessage.mock.calls[0][0](message);
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    onClose = vi.fn();
    actions = {
      expand: vi.fn(async () => undefined),
      dive: vi.fn(async () => undefined),
      goTo: vi.fn(async () => undefined),
      inspectObject: vi.fn(async () => undefined),
      inspectCollection: vi.fn(async () => undefined),
      revealClass: vi.fn(async () => undefined),
      revealClassByOop: vi.fn(async () => undefined),
      addToCanvas: vi.fn(async () => undefined),
      focusNode: vi.fn(async () => undefined),
      removeFromCanvas: vi.fn(async () => undefined),
      clearCanvas: vi.fn(async () => undefined),
      moveBox: vi.fn(async () => undefined),
      resetLayout: vi.fn(async () => undefined),
      removeGroup: vi.fn(async () => undefined),
      restoreRemoved: vi.fn(async () => undefined),
    };
    panel = new ObjectGraphPanel(onClose);
  });

  describe('the tab', () => {
    it('names itself after the object it is showing', () => {
      panel.render(view(), actions);

      expect(created().title).toBe('Reference Graph: GraphDemoProduct');
    });

    it('writes the whole document on every render, the view holding no state of its own', () => {
      panel.render(view(), actions);
      const first = created().webview.html;
      panel.render(view({ targetClass: 'DemoEmployee' }), actions);

      expect(created().webview.html).not.toBe(first);
      expect(created().webview.html).toContain('DemoEmployee');
      expect(created().webview.html).toContain('</html>');
    });

    it('gives each render its own nonce, since each is a fresh document', () => {
      panel.render(view(), actions);
      const nonceOf = (html: string): string => /nonce-([0-9a-f]+)/.exec(html)?.[1] ?? '';
      const first = nonceOf(created().webview.html);

      panel.render(view(), actions);

      expect(nonceOf(created().webview.html)).not.toBe(first);
      expect(first).toMatch(/^[0-9a-f]{32}$/);
    });

    it('tells the walk to release its pinned objects when the tab closes', () => {
      created().onDidDispose.mock.calls[0][0]();

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('routing what the view sends', () => {
    beforeEach(() => {
      panel.render(view(), actions);
    });

    it('acts on every message the view can send', async () => {
      await send({ command: 'expand', ownerOop: '10', classOop: '90', className: 'Array' });
      await send({ command: 'dive', oop: '11' });
      await send({ command: 'goTo', index: 0 });
      await send({ command: 'inspectObject', oop: '12' });
      await send({ command: 'inspectCollection', classOop: '90', className: 'Array' });
      await send({ command: 'revealClass', className: 'Array' });
      await send({ command: 'revealClassByOop', oop: '90' });
      await send({ command: 'addToCanvas', oop: '13' });
      await send({ command: 'focusNode', oop: '14' });
      await send({ command: 'removeFromCanvas', oop: '15' });
      await send({ command: 'removeGroup', ownerOop: '10', className: 'Array' });
      await send({ command: 'clearCanvas' });
      await send({ command: 'moveBox', boxId: 'o:10', x: 400, y: 250 });
      await send({ command: 'resetLayout' });
      await send({ command: 'restoreRemoved' });

      // Ordered as the walk sees them, and with the arguments the walk expects.
      expect(actions.expand).toHaveBeenCalledWith('10', '90', 'Array');
      expect(actions.dive).toHaveBeenCalledWith('11');
      expect(actions.goTo).toHaveBeenCalledWith(0);
      expect(actions.inspectObject).toHaveBeenCalledWith('12');
      expect(actions.inspectCollection).toHaveBeenCalledWith('90', 'Array');
      expect(actions.revealClass).toHaveBeenCalledWith('Array');
      expect(actions.revealClassByOop).toHaveBeenCalledWith('90');
      expect(actions.addToCanvas).toHaveBeenCalledWith('13');
      expect(actions.focusNode).toHaveBeenCalledWith('14');
      expect(actions.removeFromCanvas).toHaveBeenCalledWith('15');
      expect(actions.removeGroup).toHaveBeenCalledWith('10', 'Array');
      expect(actions.clearCanvas).toHaveBeenCalled();
      expect(actions.moveBox).toHaveBeenCalledWith('o:10', 400, 250);
      expect(actions.resetLayout).toHaveBeenCalled();
      expect(actions.restoreRemoved).toHaveBeenCalled();
    });

    it('drops a message whose OOP is not one', async () => {
      await send({ command: 'focusNode', oop: 'Array new' });
      await send({ command: 'focusNode', oop: '' });
      await send({ command: 'focusNode' });

      expect(actions.focusNode).not.toHaveBeenCalled();
    });

    it('drops an expand missing any of the three things it needs', async () => {
      await send({ command: 'expand', ownerOop: '10', classOop: '90' });
      await send({ command: 'expand', ownerOop: '10', className: 'Array' });
      await send({ command: 'expand', classOop: '90', className: 'Array' });

      expect(actions.expand).not.toHaveBeenCalled();
    });

    it('drops a drag that would place a box nowhere', async () => {
      // A NaN coordinate would take the box's edges with it.
      await send({ command: 'moveBox', boxId: 'o:10', x: NaN, y: 10 });
      await send({ command: 'moveBox', boxId: 'o:10', x: 10, y: Infinity });
      await send({ command: 'moveBox', boxId: 'o:10', x: -5, y: 10 });
      await send({ command: 'moveBox', boxId: '', x: 10, y: 10 });

      expect(actions.moveBox).not.toHaveBeenCalled();
    });

    it('rounds a drag to whole pixels', async () => {
      await send({ command: 'moveBox', boxId: 'o:10', x: 400.6, y: 249.4 });

      expect(actions.moveBox).toHaveBeenCalledWith('o:10', 401, 249);
    });

    it('ignores a command it does not know', async () => {
      await send({ command: 'dropDatabase', oop: '10' });
      await send(undefined);

      for (const action of Object.values(actions)) expect(action).not.toHaveBeenCalled();
    });

    it('ignores a click that arrives before anything has been drawn', async () => {
      // The handlers belong to a render; before the first one there is nothing to act on,
      // and a click must be dropped rather than reaching a stale or absent closure.
      const own = { ...actions, focusNode: vi.fn(async () => undefined) };
      const fresh = new ObjectGraphPanel(vi.fn());
      const its = (vscode.window.createWebviewPanel as Mock).mock.results[1].value;

      its.webview.onDidReceiveMessage.mock.calls[0][0]({ command: 'focusNode', oop: '10' });
      await Promise.resolve();
      expect(own.focusNode).not.toHaveBeenCalled();

      // And once it HAS been drawn, the very same message lands.
      fresh.render(view(), own);
      its.webview.onDidReceiveMessage.mock.calls[0][0]({ command: 'focusNode', oop: '10' });
      await Promise.resolve();
      expect(own.focusNode).toHaveBeenCalledWith('10');

      fresh.dispose();
    });

    it('ignores a click that arrives after the tab has gone', async () => {
      // An action can outlive its panel: a scan is 20-150 ms and the commit prompt in
      // front of it is modal. The walk has already released its objects by then.
      created().onDidDispose.mock.calls[0][0]();

      await send({ command: 'focusNode', oop: '10' });

      expect(actions.focusNode).not.toHaveBeenCalled();
    });

    it('does not draw into a webview that has been disposed', () => {
      created().onDidDispose.mock.calls[0][0]();
      const before = created().webview.html;

      panel.render(view({ targetClass: 'Something else' }), actions);

      expect(created().webview.html).toBe(before);
    });
  });

  describe('one click at a time', () => {
    it('drops a second click while the first is still scanning', async () => {
      // A scan is a blocking GCI call; two on one session trip the busy check and surface
      // as an error the user did not cause.
      let release = (): void => {};
      actions.focusNode = vi.fn(() => new Promise<void>((r) => (release = r)));
      panel.render(view(), actions);
      const deliver = created().webview.onDidReceiveMessage.mock.calls[0][0];

      deliver({ command: 'focusNode', oop: '11' });
      await Promise.resolve();
      deliver({ command: 'focusNode', oop: '12' });
      await Promise.resolve();

      expect(actions.focusNode).toHaveBeenCalledTimes(1);
      release();
    });

    it('takes clicks again once the first finishes', async () => {
      panel.render(view(), actions);

      await send({ command: 'focusNode', oop: '11' });
      await send({ command: 'focusNode', oop: '12' });

      expect(actions.focusNode).toHaveBeenCalledTimes(2);
    });

    it('reports a handler that throws, and keeps taking clicks', async () => {
      // Without the release in `finally`, one failure would silently freeze the panel.
      actions.focusNode = vi
        .fn()
        .mockRejectedValueOnce(new Error('the session went away'))
        .mockResolvedValue(undefined);
      panel.render(view(), actions);

      await send({ command: 'focusNode', oop: '11' });
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        'Reference Graph: the session went away',
      );

      await send({ command: 'focusNode', oop: '12' });
      expect(actions.focusNode).toHaveBeenCalledTimes(2);
    });
  });
});
