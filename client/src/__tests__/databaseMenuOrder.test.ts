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

// Whether a `when` clause fires for a row carrying this context value. Both
// forms are in use — an outright `viewItem == x` and a `viewItem =~ /…/` — and a
// row sees both kinds at once, so the clause is evaluated rather than matched as
// text. Matching as text is what stopped telling the truth the moment a clause
// grew its `(Registered)?` alternative.
function applies(when: string, viewItem: string): boolean {
  const literal = /viewItem == ([A-Za-z]+)/.exec(when);
  if (literal) return literal[1] === viewItem;
  const pattern = /viewItem =~ \/(.+?)\//.exec(when);
  return pattern ? new RegExp(pattern[1]).test(viewItem) : false;
}

/** The inline buttons a row with this context value shows, left to right. */
function inlineOrderForViewItem(viewItem: string): string[] {
  return itemContext
    .filter((m) => m.group?.startsWith('inline') && applies(m.when ?? '', viewItem))
    .sort((a, b) => inlineRank(a.group!) - inlineRank(b.group!))
    .map((m) => m.command);
}

/** Every command a row with this context value offers, inline or in its menu. */
function commandsForViewItem(viewItem: string): string[] {
  return itemContext.filter((m) => applies(m.when ?? '', viewItem)).map((m) => m.command);
}

describe('running stone row inline button order', () => {
  it('offers an online extent backup ahead of the lifecycle stop action', () => {
    const order = inlineOrderForViewItem('gemstoneDbStoneRunning');

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
        applies(m.when ?? '', 'gemstoneDbStoneRunning'),
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

  it('offers Start on a stopped database and Stop on a running one', () => {
    expect(whenFor('gemstone.startDatabase')).toEqual([
      'view == gemstoneDatabases && viewItem =~ /^gemstoneDbStopped(Registered)?$/',
    ]);
    expect(whenFor('gemstone.stopDatabase')).toEqual([
      'view == gemstoneDatabases && viewItem =~ /^gemstoneDbRunning(Registered)?$/',
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
    expect(inlineOrderForViewItem('gemstoneDbStoneStopped')).toEqual([
      'gemstone.replaceExtent',
      'gemstone.startStone',
    ]);
    expect(inlineOrderForViewItem('gemstoneDbNetldiStopped')).toEqual(['gemstone.startNetldi']);
    expect(inlineOrderForViewItem('gemstoneDbNetldiRunning')).toEqual(['gemstone.stopNetldi']);
  });
});

// A row's provenance decides which of two opposite actions can succeed at all:
// Delete removes files Jasper laid out, Unregister drops a record of files it
// must not touch. Offering both on every row means the wrong one is always
// available and always fails with an error message — the panel greys the
// impossible one and says why, so the sidebar has to agree. The `Registered`
// suffix on the context value is what carries the distinction.
describe('registered databases in the sidebar', () => {
  it('offers Unregister on a registered database and Delete on one Jasper made', () => {
    expect(commandsForViewItem('gemstoneDbStopped')).toContain('gemstone.deleteDatabase');
    expect(commandsForViewItem('gemstoneDbStopped')).not.toContain('gemstone.unregisterDatabase');

    expect(commandsForViewItem('gemstoneDbStoppedRegistered')).toContain(
      'gemstone.unregisterDatabase',
    );
    expect(commandsForViewItem('gemstoneDbStoppedRegistered')).not.toContain(
      'gemstone.deleteDatabase',
    );
  });

  it('keeps every action a registered database can actually perform', () => {
    // Start/stop and the tools that only open things work the same on an
    // installation Jasper adopted as on one it created.
    expect(inlineOrderForViewItem('gemstoneDbStoppedRegistered')).toEqual([
      'gemstone.startDatabase',
      'gemstone.openDbInFinder',
      'gemstone.openDbTerminal',
      'gemstone.createLoginFromDb',
    ]);
    expect(inlineOrderForViewItem('gemstoneDbRunningRegistered')).toEqual([
      'gemstone.stopDatabase',
      'gemstone.openDbInFinder',
      'gemstone.openDbTerminal',
      'gemstone.createLoginFromDb',
    ]);
    expect(inlineOrderForViewItem('gemstoneDbStoneStoppedRegistered')).toEqual([
      'gemstone.startStone',
    ]);
    expect(inlineOrderForViewItem('gemstoneDbNetldiRunningRegistered')).toEqual([
      'gemstone.stopNetldi',
    ]);
  });

  it('withholds the two actions aimed at files the installation owns', () => {
    // Replace Extent overwrites the user's own extent; the online copy reads a
    // data directory Jasper's record does not have. Both are refused in the
    // command, and neither is offered here.
    expect(inlineOrderForViewItem('gemstoneDbStoneStoppedRegistered')).not.toContain(
      'gemstone.replaceExtent',
    );
    expect(inlineOrderForViewItem('gemstoneDbStoneRunningRegistered')).not.toContain(
      'gemstone.onlineExtentBackup',
    );
  });
});
