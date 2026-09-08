import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The GemStone sidebar is a container people scroll all day, so what occupies a
// permanent slot in it is a deliberate decision. Rowan and MCP Server were taken
// out of it without losing their functionality: Rowan's day-to-day surface is
// the Explorer section, and MCP is now set up and reported on the session rows
// in Logins & Sessions. Pin that here so a re-added contribution is a choice
// rather than an accident.

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
