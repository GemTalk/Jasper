// The walk: which objects are on the graph, and why.
//
// Everything the panel draws is decided here -- what the centre is, which referrers get
// promoted onto the canvas, what a removal takes with it, and what comes back. It talks to
// the stone only through the four non-blocking queries and to VS Code only through an
// injected `deps`, so all of it is reachable with fakes.
//
// Most of these pin a rule that exists because the picture was once wrong: boxes that
// vanished, a removal that silently withheld part of a later answer, a re-centre that
// emptied the canvas it should have kept.
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('vscode', () => import('../../__mocks__/vscode.js'));
vi.mock('../../browserQueries', () => ({
  referrersOfNb: vi.fn(),
  referrerObjectsOfNb: vi.fn(),
  referrerCollectionOfNb: vi.fn(),
  slotEdgesAmongNb: vi.fn(),
}));

import * as vscode from 'vscode';
import * as queries from '../../browserQueries';
import {
  ObjectGraphWalk,
  ObjectGraphWalkDeps,
  ObjectGraphWalkView,
  ObjectGraphActions,
} from '../objectGraphWalk';
import type { ActiveSession } from '../../sessionManager';
import type { ReferrerGroup, SlotEdge } from '../../queries/objectGraph';

const group = (
  referrerClass: string,
  referrerClassOop: string,
  count: number,
  sole?: { oop: string; printString: string },
): ReferrerGroup => ({
  referrerClass,
  referrerClassOop,
  count,
  ...(sole ? { soleOop: sole.oop, solePrintString: sole.printString } : {}),
});

describe('ObjectGraphWalk', () => {
  /** Referrer groups keyed by the OOP asked about, so a walk can go more than one hop. */
  let groupsFor: Record<string, ReferrerGroup[]>;
  let edges: SlotEdge[];
  let rendered: ObjectGraphWalkView[];
  let actions: ObjectGraphActions;
  let pinned: Set<string>;
  let deps: ObjectGraphWalkDeps;
  let walk: ObjectGraphWalk;

  const nodeOops = (): string[] => rendered[rendered.length - 1].canvas.nodes.map((n) => n.oop);
  const centre = (): string => rendered[rendered.length - 1].targetOop;
  const view = (): ObjectGraphWalkView => rendered[rendered.length - 1];

  beforeEach(async () => {
    vi.clearAllMocks();
    groupsFor = {};
    edges = [];
    rendered = [];
    pinned = new Set();

    vi.mocked(queries.referrersOfNb).mockImplementation(async (_s, oop) => ({
      kind: 'ok',
      groups: groupsFor[oop.toString()] ?? [],
      scanMillis: 5,
    }));
    vi.mocked(queries.slotEdgesAmongNb).mockImplementation(async (_s, oops) => ({
      kind: 'ok',
      edges: edges.filter((e) => oops.includes(e.fromOop) && oops.includes(e.toOop)),
    }));

    deps = {
      inspect: vi.fn(),
      revealClass: vi.fn(async () => undefined),
      // The user always says yes; the declining path is its own test.
      withCleanSession: vi.fn(async (run) => (await run()) as never),
      pin: vi.fn((oop: bigint) => pinned.add(oop.toString())),
      unpin: vi.fn((oop: bigint) => pinned.delete(oop.toString())),
      withProgress: vi.fn(async (_title, work) => work()),
      render: vi.fn((v: ObjectGraphWalkView, a: ObjectGraphActions) => {
        rendered.push(v);
        actions = a;
      }),
      openWalk: vi.fn(async () => undefined),
      describe: vi.fn((oop: bigint) => ({
        className: `Class${oop}`,
        printString: `Object(${oop})`,
      })),
    };
    walk = new ObjectGraphWalk({ id: 1 } as unknown as ActiveSession, deps);
  });

  /** Centre on 1, whose only referrer class holds exactly the one object 2. */
  const startWithOneReferrer = async (): Promise<void> => {
    groupsFor['1'] = [group('Holder', '90', 1, { oop: '2', printString: 'Holder(2)' })];
    await walk.start(1n);
  };

  describe('starting a walk', () => {
    it('centres on the object and reports what points at it', async () => {
      groupsFor['1'] = [group('GsNMethod', '90', 496), group('Association', '91', 3)];

      await walk.start(1n);

      expect(centre()).toBe('1');
      expect(view().groups.map((g) => g.referrerClass)).toEqual(['GsNMethod', 'Association']);
      expect(view().scanMillis).toBe(5);
    });

    it('draws a class holding one object as that object, without a second scan', async () => {
      await startWithOneReferrer();

      expect(nodeOops()).toEqual(['1', '2']);
      // The scan already resolved it, so no per-object query was needed.
      expect(queries.referrerObjectsOfNb).not.toHaveBeenCalled();
    });

    it('promotes only a bounded number of them', async () => {
      // The class Object answers over three thousand referrer groups and most hold one
      // object, so promoting every one would bury the picture it exists to clarify.
      groupsFor['1'] = Array.from({ length: 40 }, (_, i) =>
        group(`C${i}`, String(i), 1, { oop: String(100 + i), printString: `O(${100 + i})` }),
      );

      await walk.start(1n);

      expect(nodeOops().length).toBeLessThan(40);
      expect(nodeOops().length).toBeGreaterThan(1);
    });

    it('pins what it can still act on, so an abort cannot reuse the OOP', async () => {
      // A repository scan aborts, and an abort can scavenge an unreferenced object and
      // hand its OOP number to another -- a breadcrumb would then point somewhere else.
      await startWithOneReferrer();

      expect(pinned).toContain('1');
      expect(pinned).toContain('2');
    });

    it('leaves the walk untouched when the user declines to clean the session', async () => {
      deps.withCleanSession = vi.fn(async () => undefined);
      walk = new ObjectGraphWalk({ id: 1 } as unknown as ActiveSession, deps);

      await walk.start(1n);

      expect(rendered).toHaveLength(0);
      expect(pinned.size).toBe(0);
    });

    it('says so, rather than drawing nothing, when the stone declines', async () => {
      vi.mocked(queries.referrersOfNb).mockResolvedValue({
        kind: 'unavailable',
        reason: 'argument is not a Pom oop',
      });

      await walk.start(1n);

      expect(rendered).toHaveLength(0);
      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('argument is not a Pom oop'),
      );
    });
  });

  describe('re-centring', () => {
    it('keeps everything already drawn', async () => {
      // Following "what points at this, and at that, and at that" builds one connected
      // picture; clearing the canvas threw away the chain the user was building.
      await startWithOneReferrer();
      groupsFor['2'] = [group('Other', '92', 7)];

      await actions.focusNode('2');

      expect(centre()).toBe('2');
      expect(nodeOops()).toEqual(['1', '2']);
    });

    it('does not re-root the drawing on the new centre', async () => {
      // Rooting at the centre emptied the page whenever you focused something nothing
      // descends from, while the counter still claimed the boxes were there.
      await startWithOneReferrer();
      groupsFor['2'] = [];

      await actions.focusNode('2');

      expect(view().canvas.nodes.find((n) => n.oop === '2')?.parentOop).toBe('1');
    });

    it('forgets which class was expanded, since it belonged to the old centre', async () => {
      await startWithOneReferrer();
      vi.mocked(queries.referrerObjectsOfNb).mockResolvedValue({
        kind: 'ok',
        objects: [{ oop: '3', printString: 'O(3)', isClass: false }],
        total: 1,
        scanMillis: 1,
      });
      await actions.expand('1', '90', 'Holder');
      expect(view().expanded).toBeDefined();

      groupsFor['2'] = [];
      await actions.focusNode('2');

      expect(view().expanded).toBeUndefined();
    });
  });

  describe('taking boxes off the graph', () => {
    /** 1 <- 2 <- 3: each object promoted as the sole referrer of the one before it. */
    const chainOfThree = async (): Promise<void> => {
      groupsFor['1'] = [group('Holder', '90', 1, { oop: '2', printString: 'Holder(2)' })];
      groupsFor['2'] = [group('Outer', '91', 1, { oop: '3', printString: 'Outer(3)' })];
      await walk.start(1n);
      await actions.focusNode('2');
    };

    it('takes everything found under an object with it', async () => {
      // Those boxes are on the graph because of it. Re-parenting them onto its parent left
      // the picture implying references they were never listed under.
      await chainOfThree();
      expect(nodeOops()).toEqual(['1', '2', '3']);

      await actions.removeFromCanvas('2');

      expect(nodeOops()).toEqual(['1']);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Removed 2 objects'),
      );
    });

    it('re-centres on what a removed centre hung off', async () => {
      // So the listing below always describes something actually on the picture.
      await chainOfThree();
      await actions.focusNode('3');
      expect(centre()).toBe('3');

      await actions.removeFromCanvas('3');

      expect(centre()).toBe('2');
    });

    it('refuses a removal that would take the whole graph', async () => {
      await startWithOneReferrer();

      await actions.removeFromCanvas('1');

      expect(nodeOops()).toEqual(['1', '2']);
      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('whole graph'),
      );
    });

    it('says something better than nothing when one box is all there is', async () => {
      groupsFor['1'] = [];
      await walk.start(1n);

      await actions.removeFromCanvas('1');

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Show Reference Graph on something else'),
      );
    });

    it('remembers a removal, so the next scan does not put it straight back', async () => {
      // A single-object group is promoted on EVERY scan, so without this "take it off the
      // graph" visibly undid itself.
      await chainOfThree();
      await actions.removeFromCanvas('3');
      expect(nodeOops()).toEqual(['1', '2']);

      await actions.focusNode('1');

      expect(nodeOops()).not.toContain('3');
    });

    it('answers in full when asked about that object again', async () => {
      // A removal must never quietly withhold part of the answer to a later question.
      await chainOfThree();
      await actions.removeFromCanvas('3');

      await actions.focusNode('2');

      expect(nodeOops()).toContain('3');
    });

    it('puts everything back on request', async () => {
      await chainOfThree();
      await actions.removeFromCanvas('3');
      expect(view().removedCount).toBeGreaterThan(0);

      await actions.restoreRemoved();

      expect(nodeOops()).toContain('3');
      expect(view().removedCount).toBe(0);
    });

    it('strips back to the focused object, not to the first one added', async () => {
      await chainOfThree();
      expect(centre()).toBe('2');

      await actions.clearCanvas();

      expect(nodeOops()).toEqual(['2']);
    });
  });

  describe('the references it draws between boxes', () => {
    it('re-derives them from the whole node set, not from the click that added one', async () => {
      // Adding a node can create edges that have nothing to do with that click -- put a
      // line item beside a product and an order and all three appear at once.
      edges = [
        { fromOop: '2', toOop: '1', via: 'product' },
        { fromOop: '3', toOop: '1', via: '[7]' },
        { fromOop: '3', toOop: '2', via: 'order' },
      ];
      groupsFor['1'] = [group('Holder', '90', 1, { oop: '2', printString: 'Holder(2)' })];
      await walk.start(1n);
      expect(view().canvas.edges).toHaveLength(1);

      await actions.addToCanvas('3');

      expect(view().canvas.edges).toHaveLength(3);
    });

    it('asks for none while there is nothing they could run between', async () => {
      groupsFor['1'] = [];

      await walk.start(1n);

      expect(queries.slotEdgesAmongNb).not.toHaveBeenCalled();
      expect(view().canvas.edges).toEqual([]);
    });

    it('draws no edges rather than wrong ones when the stone cannot answer', async () => {
      vi.mocked(queries.slotEdgesAmongNb).mockResolvedValue({
        kind: 'unavailable',
        reason: 'nope',
      });

      await startWithOneReferrer();

      expect(view().canvas.edges).toEqual([]);
      expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    });
  });

  describe('hand-placed boxes', () => {
    it('keeps a position across the redraw the drag causes', async () => {
      await startWithOneReferrer();

      await actions.moveBox('o:2', 400, 250);

      expect(view().positions['o:2']).toEqual({ x: 400, y: 250 });
    });

    it('gives them all up on request', async () => {
      await startWithOneReferrer();
      await actions.moveBox('o:2', 400, 250);

      await actions.resetLayout();

      expect(view().positions).toEqual({});
    });

    it('drops a placement for a box that no longer exists', async () => {
      // It described a position chosen for a picture that is gone.
      groupsFor['1'] = [group('Holder', '90', 1, { oop: '2', printString: 'Holder(2)' })];
      groupsFor['2'] = [group('Outer', '91', 1, { oop: '3', printString: 'Outer(3)' })];
      await walk.start(1n);
      await actions.focusNode('2');
      await actions.moveBox('o:3', 400, 250);

      await actions.removeFromCanvas('3');

      expect(view().positions['o:3']).toBeUndefined();
    });
  });

  describe('releasing the session', () => {
    it('lets go of every OOP it pinned', async () => {
      await startWithOneReferrer();
      expect(pinned.size).toBeGreaterThan(0);

      walk.releaseAll();

      expect(pinned.size).toBe(0);
    });
  });
});
