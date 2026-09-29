import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The GemStone sidebar is a container people scroll all day, so what occupies a
// permanent slot in it is a deliberate decision. Rowan and MCP Server were taken
// out of it without losing their functionality: Rowan's day-to-day surface is
// the Explorer section, and MCP is reported on the Databases section header and
// managed in the MCP Server tab. Pin that here so a re-added contribution is a
// choice rather than an accident.

interface View {
  id: string;
  name: string;
}

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf-8'),
);
const sidebar: View[] = pkg.contributes.views.gemstone;
const explorer: View[] = pkg.contributes.views.explorer;
const ids = (views: View[]) => views.map((v) => v.id);

describe('the GemStone sidebar', () => {
  it('does not contribute a Rowan section', () => {
    expect(ids(sidebar)).not.toContain('gemstoneRowan');
  });

  it('does not contribute an MCP Server section', () => {
    expect(ids(sidebar)).not.toContain('jasperMcpServer');
  });

  it("keeps Rowan's Explorer section, which is the surface that stayed", () => {
    expect(ids(explorer)).toContain('gemstoneRowanProject');
  });

  it('leaves no menu contribution pointing at the removed MCP Server section', () => {
    const menus: Record<string, { when?: string }[]> = pkg.contributes.menus;
    const orphaned = Object.values(menus)
      .flat()
      .filter((m) => /\bjasperMcpServer\b/.test(m.when ?? ''));
    expect(orphaned).toEqual([]);
  });

  it('leaves no menu or welcome contribution pointing at the removed Rowan section', () => {
    const menus: Record<string, { when?: string }[]> = pkg.contributes.menus;
    const orphaned = Object.values(menus)
      .flat()
      .filter((m) => /\bgemstoneRowan\b/.test(m.when ?? ''));
    expect(orphaned).toEqual([]);

    const welcomes: { view: string }[] = pkg.contributes.viewsWelcome;
    expect(welcomes.filter((w) => w.view === 'gemstoneRowan')).toEqual([]);
  });
});

describe('where MCP is contributed instead', () => {
  interface Menu {
    command?: string;
    when?: string;
    group?: string;
  }
  const menus: Record<string, Menu[]> = pkg.contributes.menus;
  const commands: { command: string; icon?: string }[] = pkg.contributes.commands;

  it('opens the MCP Server tab from the Databases section header', () => {
    // Claiming the server is a property of the window, and there is exactly one
    // Databases header per window — unlike a session or a database row, of
    // which a user has several, where a per-window action reads as a per-row one.
    const button = menus['view/title'].find((m) => m.command === 'jasper.showMcpServer');
    expect(button?.when).toBe('view == gemstoneDatabases');
    expect(commands.find((c) => c.command === 'jasper.showMcpServer')?.icon).toBeDefined();
  });

  it('leaves the header button ungated, since an off MCP is what the tab explains', () => {
    // jasper.mcpAvailable hides the commands that would fail. The tab does not
    // fail — with MCP off it is the thing that says so, which is exactly when
    // someone is hunting for why Claude has no GemStone tools.
    const button = menus['view/title'].find((m) => m.command === 'jasper.showMcpServer');
    expect(button?.when).not.toContain('jasper.mcpAvailable');
    const palette = menus['commandPalette'].find((m) => m.command === 'jasper.showMcpServer');
    expect(palette).toBeUndefined();
  });

  it('offers Stop beside Claim, since a held socket is only released by its owner', () => {
    const palette = menus['commandPalette'];
    expect(palette.find((m) => m.command === 'jasper.stopMcpServer')?.when).toBe(
      'jasper.mcpAvailable',
    );
    expect(palette.find((m) => m.command === 'jasper.claimMcpServer')?.when).toBe(
      'jasper.mcpAvailable',
    );
  });

  it('puts nothing MCP on a session row', () => {
    const onRows = menus['view/item/context'].filter((m) => /Mcp/.test(m.command ?? ''));
    expect(onRows).toEqual([]);
    expect(commands.map((c) => c.command)).not.toContain('gemstone.sessionServeMcp');
  });
});
