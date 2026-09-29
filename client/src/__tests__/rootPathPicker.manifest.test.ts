import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const pkgPath = path.resolve(__dirname, '..', '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

const commands: { command: string; title: string; category?: string }[] = pkg.contributes.commands;
// The manifest declares configuration as a list of sections.
const sections: { properties: Record<string, Record<string, string>> }[] = Array.isArray(
  pkg.contributes.configuration,
)
  ? pkg.contributes.configuration
  : [pkg.contributes.configuration];
const rootPath = sections
  .map((s) => s.properties?.['gemstone.rootPath'])
  .find((p): p is Record<string, string> => p !== undefined)!;

// The Settings editor renders a string setting as a text box and offers no
// folder picker, so the only way to a dialog from there is a command link in
// the description — the same shape the server-support setting already uses.
describe('choosing the GemStone folder from Settings', () => {
  it('links a command that exists', () => {
    const link = /\(command:([\w.]+)\)/.exec(rootPath.markdownDescription ?? '');
    expect(link).not.toBeNull();
    expect(commands.map((c) => c.command)).toContain(link![1]);
  });

  it('keeps the plain description too, for editors that show no markdown', () => {
    expect(rootPath.description).toBeDefined();
  });
});
