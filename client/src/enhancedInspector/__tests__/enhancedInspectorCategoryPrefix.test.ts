/**
 * Ties the three places the payload's extension-method category prefix appears together.
 *
 * The prefix is written into the `.gs` files at build time by
 * `gs-src/enhancedInspector/build/apply_jasper_transforms.sh`, and matched at uninstall time by
 * `ENHANCED_INSPECTOR_CATEGORY_PREFIX`. Nothing at runtime connects them: the payload is
 * pre-built, so a rename on either side goes unnoticed until an uninstall silently stops finding
 * the payload's kernel methods. These checks fail instead.
 *
 * @see docs/explanation/enhanced-inspector.md#filing-in-on-a-rowan-extent
 */
import { describe, it, expect, vi } from 'vitest';

// Importing the installer pulls in the extension's session/query modules and through them
// `vscode`, which does not resolve outside the extension host. Stubbed as its own suite stubs them.
vi.mock('vscode', () => ({
  window: { createOutputChannel: () => ({ appendLine: () => {} }) },
}));

vi.mock('../../browserQueries', () => ({
  executeFetchString: vi.fn(),
}));

vi.mock('../../wslBridge', () => ({
  needsWsl: vi.fn(() => false),
}));

import * as fs from 'fs';
import * as path from 'path';
import {
  ENHANCED_INSPECTOR_CATEGORY_PREFIX,
  ENHANCED_INSPECTOR_FILES,
} from '../enhancedInspectorInstall';

const REPO = path.resolve(__dirname, '../../../..');
const PAYLOAD_DIR = path.join(REPO, 'resources/enhancedInspector');
const TRANSFORM_SCRIPT = path.join(
  REPO,
  'gs-src/enhancedInspector/build/apply_jasper_transforms.sh',
);

function payloadCategories(): string[] {
  return ENHANCED_INSPECTOR_FILES.flatMap((file) =>
    fs
      .readFileSync(path.join(PAYLOAD_DIR, file), 'utf8')
      .split('\n')
      .flatMap((line) => line.match(/^category: '(.*)'$/)?.[1] ?? []),
  );
}

describe('the payload category prefix', () => {
  it('is the one the build script writes into the payload', () => {
    const script = fs.readFileSync(TRANSFORM_SCRIPT, 'utf8');

    const declared = script.match(/^CATEGORY_PREFIX="(.*)"$/m)?.[1];

    expect(declared).toBe(ENHANCED_INSPECTOR_CATEGORY_PREFIX);
  });

  it('is the one the committed payload actually carries', () => {
    const prefixed = payloadCategories().filter((c) =>
      c.startsWith(ENHANCED_INSPECTOR_CATEGORY_PREFIX),
    );

    expect(prefixed.length).toBeGreaterThan(0);
  });

  // GToolkit is not a Rowan project in any stone, so a surviving `*GToolkit-…` category resolves
  // to no package and Rowan refuses the compile outright on a RowanHybrid-packaged class — the
  // install failure this whole transform exists to prevent.
  it('has replaced every GToolkit extension category in the payload', () => {
    const stars = payloadCategories().filter((c) => c.startsWith('*GToolkit'));

    expect(stars).toEqual([]);
  });

  // The other half of the rule: these name projects GemStone ships and already owns the selectors
  // of, and Rowan requires their category stay `*<that package>`. Prefixing them fails the file-in
  // with "does not follow the expected package convention".
  it('has left the upstream STON and Announcements categories alone', () => {
    const kept = [...new Set(payloadCategories().filter((c) => c.startsWith('*')))];

    expect(kept.length).toBeGreaterThan(0);
    for (const category of kept) {
      expect(category.toLowerCase()).toMatch(/^\*(ston|announcements)/);
    }
  });
});
