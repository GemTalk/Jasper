import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect, beforeAll, vi } from 'vitest';
vi.mock('vscode', () => import('../__mocks__/vscode.js'));
import { __telemetry, ExtensionMode } from '../__mocks__/vscode';
import { EVENT, initTelemetry, reportActivation } from '../telemetry';

// docs/reference/telemetry.md is how people who read the data learn what an
// event means, so it has to keep up with telemetry.ts. This catches an
// event, property or measure added in code and not in the doc. It cannot
// catch a changed meaning; `.claude/rules/telemetry.md` asks for that by
// hand. `extensionMode`'s values come from VS Code's own enum rather than a
// constant here, so only its name is checked.

const DOC_PATH = path.resolve(__dirname, '../../../docs/reference/telemetry.md');
const doc = fs.readFileSync(DOC_PATH, 'utf8');
const headings = doc.split('\n').filter((line) => line.startsWith('### '));

/** Every property and measure name the real `report*` functions send, common.* aside. */
const sentFieldNames = new Set<string>();

beforeAll(() => {
  __telemetry.length = 0;
  initTelemetry({ extensionMode: ExtensionMode.Production, subscriptions: [] } as never);

  reportActivation(1);

  for (const event of __telemetry) {
    for (const name of Object.keys(event.properties)) {
      if (!name.startsWith('common.')) sentFieldNames.add(name);
    }
    for (const name of Object.keys(event.measurements ?? {})) sentFieldNames.add(name);
  }
});

describe('docs/reference/telemetry.md', () => {
  it('gives every event a section of its own', () => {
    const undocumented = Object.values(EVENT).filter(
      (name) => !headings.some((heading) => heading.includes(`\`${name}\``)),
    );

    expect(undocumented, `add a "### \`name\`" section to ${DOC_PATH}`).toEqual([]);
  });

  it('describes every property and measure an event carries', () => {
    const exercised = new Set(__telemetry.map((e) => e.name));
    const undocumented = [...sentFieldNames].filter((name) => !doc.includes(`\`${name}\``));

    expect([...exercised].sort()).toEqual(Object.values(EVENT).sort());
    expect(undocumented, `document these in ${DOC_PATH}`).toEqual([]);
  });
});
