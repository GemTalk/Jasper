import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Read the extension manifest and collapse every `contributes.configuration` section's properties
// into one map, so we can assert on a single setting's contributed schema.
const pkgPath = path.resolve(__dirname, '..', '..', '..', '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
const sections: Array<{ properties?: Record<string, unknown> }> = pkg.contributes.configuration;
const properties = Object.assign({}, ...sections.map((s) => s.properties ?? {}));

describe('gemstone.omniSearch.ui setting', () => {
  const ui = properties['gemstone.omniSearch.ui'] as {
    enum: string[];
    enumDescriptions: string[];
    default: string;
  };

  it('offers exactly the two webview UIs — panel and spotter (no quickpick)', () => {
    // The native Quick Pick UI was removed in #428; both remaining UIs run on omniEngine.ts.
    expect([...ui.enum].sort()).toEqual(['panel', 'spotter']);
    expect(ui.enum).not.toContain('quickpick');
  });

  it('keeps one enum description per option and a valid default', () => {
    expect(ui.enumDescriptions).toHaveLength(ui.enum.length);
    expect(ui.enum).toContain(ui.default);
  });
});
