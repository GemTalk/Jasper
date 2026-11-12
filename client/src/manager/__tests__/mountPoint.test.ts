import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => import('../../__mocks__/vscode.js'));

import { mountPointFromAttachPlist } from '../versionManager';

/** `hdiutil attach -plist` output holding these system entities, in this order. */
function attachPlist(...entities: { dev: string; hint: string; mount?: string }[]): string {
  const dicts = entities.map(
    (e) =>
      '\t\t<dict>\n' +
      `\t\t\t<key>content-hint</key>\n\t\t\t<string>${e.hint}</string>\n` +
      `\t\t\t<key>dev-entry</key>\n\t\t\t<string>${e.dev}</string>\n` +
      (e.mount ? `\t\t\t<key>mount-point</key>\n\t\t\t<string>${e.mount}</string>\n` : '') +
      '\t\t</dict>\n',
  );
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n<dict>\n\t<key>system-entities</key>\n\t<array>\n' +
    dicts.join('') +
    '\t</array>\n</dict>\n</plist>\n'
  );
}

describe('the mount point hdiutil attach reports', () => {
  it('is found wherever its entry falls, including before the outer disk the text form prints last', () => {
    // The disk9 / disk10 numbering that sorted the text form's mounted line out of last place.
    const plist = attachPlist(
      { dev: '/dev/disk10', hint: 'EF57347C-0000-11AA-AA11-00306543ECAC' },
      {
        dev: '/dev/disk10s1',
        hint: '41504653-0000-11AA-AA11-00306543ECAC',
        mount: '/Volumes/GemStone64Bit3.7.5-arm64.Darwin',
      },
      { dev: '/dev/disk9', hint: 'GUID_partition_scheme' },
      { dev: '/dev/disk9s1', hint: 'Apple_APFS' },
    );

    expect(mountPointFromAttachPlist(plist)).toBe('/Volumes/GemStone64Bit3.7.5-arm64.Darwin');
  });

  it('is undefined when the image attached but no volume mounted', () => {
    const plist = attachPlist(
      { dev: '/dev/disk9', hint: 'GUID_partition_scheme' },
      { dev: '/dev/disk9s1', hint: 'Apple_APFS' },
    );

    expect(mountPointFromAttachPlist(plist)).toBeUndefined();
  });
});
