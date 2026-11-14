import { describe, it, expect } from 'vitest';
import { Location } from 'vscode-languageserver';
import { DocumentManager } from '../../utils/documentManager';
import { WorkspaceIndex, detectFormat } from '../../utils/workspaceIndex';
import { getWorkspaceReferences, resolveDefinition } from '../definition';

// A GemStone source file in the open folder, implementing #size.
const diskUri = 'file:///project/kernel.gs';
const stoneUri = 'gemstone://1/UserGlobals/DemoCustomer/instance/accessing/orderCount';

function definitionAt(uri: string, source: string, line: number, character: number) {
  const index = new WorkspaceIndex();
  index.indexFileFromDisk(diskUri, 'method: Collection\nsize\n  ^0\n%');
  const dm = new DocumentManager();
  const doc = dm.update(uri, 1, source, detectFormat(uri));
  const region = dm.findRegionAt(doc, line);
  return resolveDefinition(doc, { line, character }, region, index);
}

const uris = (result: Location | Location[] | null): string[] =>
  result === null ? [] : (Array.isArray(result) ? result : [result]).map((l) => l.uri);

describe('resolveDefinition', () => {
  it('leaves a selector in a method opened from the stone to the stone, not files on disk', () => {
    // `orderCount  ^orders size`, cursor inside `size`.
    expect(definitionAt(stoneUri, 'orderCount\n  ^orders size', 1, 13)).toBeNull();
  });

  it('still finds a local variable in a method opened from the stone', () => {
    const result = definitionAt(stoneUri, 'total\n  | sum |\n  sum := 0.\n  ^sum', 3, 4);

    expect(uris(result)).toEqual([stoneUri]);
    expect((result as Location).range.start.line).toBe(1);
  });

  it('lists implementors from the workspace for a selector in a file on disk', () => {
    const fileUri = 'file:///project/customer.gs';
    const result = definitionAt(
      fileUri,
      'method: DemoCustomer\norderCount\n  ^orders size\n%',
      2,
      13,
    );

    expect(uris(result)).toEqual([diskUri]);
  });
});

// A GemStone source file in the open folder, sending #size.
const senderUri = 'file:///project/sender.gs';

function referencesAt(uri: string, source: string, line: number, character: number) {
  const index = new WorkspaceIndex();
  index.indexFileFromDisk(senderUri, 'method: Collection\ncount\n  ^items size\n%');
  const dm = new DocumentManager();
  const doc = dm.update(uri, 1, source, detectFormat(uri));
  const region = dm.findRegionAt(doc, line);
  return getWorkspaceReferences(doc, { line, character }, region, index);
}

describe('getWorkspaceReferences', () => {
  it('leaves the senders of a selector in a method opened from the stone to the stone', () => {
    expect(referencesAt(stoneUri, 'orderCount\n  ^orders size', 1, 13)).toBeNull();
  });

  it('lists senders from the workspace for a selector in a file on disk', () => {
    const result = referencesAt(
      'file:///project/customer.gs',
      'method: DemoCustomer\norderCount\n  ^orders size\n%',
      2,
      13,
    );

    expect(uris(result)).toEqual([senderUri]);
  });
});
