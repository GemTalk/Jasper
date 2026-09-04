import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The Databases tree's running-Stone row exposes inline action buttons whose
// left-to-right order VS Code derives from the `inline@<n>` suffix (ascending —
// lowest number is leftmost). Online Extent Backup — a snapshot of a live,
// locally-managed stone — lives here rather than on the Sessions row: it copies
// the stone's extent files on the stone's own host, so it only makes sense for a
// Jasper-managed local database. Pin its placement so a future package.json edit
// can't quietly move or drop it.

interface MenuItem {
  command: string;
  when?: string;
  group?: string;
}

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf-8'),
);
const itemContext: MenuItem[] = pkg.contributes.menus['view/item/context'];

function inlineRank(group: string): number {
  const match = /inline@(\d+)/.exec(group);
  return match ? Number(match[1]) : 0;
}

function inlineOrderFor(viewItemClause: string): string[] {
  return itemContext
    .filter((m) => m.group?.startsWith('inline') && (m.when ?? '').includes(viewItemClause))
    .sort((a, b) => inlineRank(a.group!) - inlineRank(b.group!))
    .map((m) => m.command);
}

describe('running stone row inline button order', () => {
  it('offers an online extent backup ahead of the lifecycle stop action', () => {
    const order = inlineOrderFor('viewItem == gemstoneDbStoneRunning');

    expect(order).toEqual(['gemstone.onlineExtentBackup', 'gemstone.stopStone']);
  });

  it('surfaces the online extent backup on the running stone, not on the session row', () => {
    const onSession = itemContext.some(
      (m) =>
        m.command === 'gemstone.onlineExtentBackup' &&
        (m.when ?? '').includes('viewItem == gemstoneSession'),
    );
    const onRunningStone = itemContext.some(
      (m) =>
        m.command === 'gemstone.onlineExtentBackup' &&
        (m.when ?? '').includes('viewItem == gemstoneDbStoneRunning'),
    );

    expect(onSession).toBe(false);
    expect(onRunningStone).toBe(true);
  });
});

describe('database row whole-database action', () => {
  // The Databases & Versions panel puts one Start/Stop on a database's summary
  // row; the sidebar's database rows offer the same thing. Which of the two a
  // row gets comes entirely from its context value, so pin both directions and
  // the case that gets neither.
  const whenFor = (command: string) =>
    itemContext.filter((m) => m.command === command).map((m) => m.when ?? '');

  // What a database row with this context value actually shows: its `when`
  // clauses name the value either outright or through a regex, and a row sees
  // both kinds at once.
  function inlineOrderForViewItem(viewItem: string): string[] {
    const applies = (when: string) => {
      const literal = /viewItem == ([A-Za-z]+)/.exec(when);
      if (literal) return literal[1] === viewItem;
      const pattern = /viewItem =~ \/(.+?)\//.exec(when);
      return pattern ? new RegExp(pattern[1]).test(viewItem) : false;
    };
    return itemContext
      .filter((m) => m.group?.startsWith('inline') && applies(m.when ?? ''))
      .sort((a, b) => inlineRank(a.group!) - inlineRank(b.group!))
      .map((m) => m.command);
  }

  it('offers Start on a stopped database and Stop on a running one', () => {
    expect(whenFor('gemstone.startDatabase')).toEqual([
      'view == gemstoneDatabases && viewItem == gemstoneDbStopped',
    ]);
    expect(whenFor('gemstone.stopDatabase')).toEqual([
      'view == gemstoneDatabases && viewItem == gemstoneDbRunning',
    ]);
  });

  it('leads the database row, ahead of the tools that only open things', () => {
    expect(inlineOrderForViewItem('gemstoneDbStopped')).toEqual([
      'gemstone.startDatabase',
      'gemstone.openDbInFinder',
      'gemstone.openDbTerminal',
      'gemstone.createLoginFromDb',
    ]);
    expect(inlineOrderForViewItem('gemstoneDbRunning')).toEqual([
      'gemstone.stopDatabase',
      'gemstone.openDbInFinder',
      'gemstone.openDbTerminal',
      'gemstone.createLoginFromDb',
    ]);
  });

  it('withholds both from a database running outside Jasper', () => {
    // Jasper cannot control those servers — but the row keeps everything that
    // does not try to.
    expect(inlineOrderForViewItem('gemstoneDbExternal')).toEqual([
      'gemstone.openDbInFinder',
      'gemstone.openDbTerminal',
      'gemstone.createLoginFromDb',
    ]);
  });

  it('keeps the per-server actions on the Stone and NetLDI rows', () => {
    // The whole-database control adds to those rows, it does not replace them.
    expect(inlineOrderFor('viewItem == gemstoneDbStoneStopped')).toEqual([
      'gemstone.replaceExtent',
      'gemstone.startStone',
    ]);
    expect(inlineOrderFor('viewItem == gemstoneDbNetldiStopped')).toEqual(['gemstone.startNetldi']);
    expect(inlineOrderFor('viewItem == gemstoneDbNetldiRunning')).toEqual(['gemstone.stopNetldi']);
  });
});
