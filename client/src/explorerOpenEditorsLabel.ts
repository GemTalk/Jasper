import type { ParsedUri } from './gemstoneFileSystemProvider';

// The kinds of GemStone editor the Open Editors pane groups by.
export type OpenEditorKind = 'class' | 'comment' | 'method';

export interface OpenEditorEntry {
  kind: OpenEditorKind;
  label: string;
}

// Pure. Classifies an open gemstone:// source tab for the Open Editors pane:
// a class-definition editor ('class', labelled by class name) or a method
// source editor ('method', labelled `Class>>selector` — `Class (class)>>…` for
// the class side, with a " (base)" suffix when it shows the persistent base
// source) or a class comment editor ('comment', labelled by class name).
// Returns undefined for tabs that are not browsable — the new-class / new-method
// templates or the read-only override-diff comparison view — so the pane omits
// them.
export function classifyGemstoneUri(parsed: ParsedUri): OpenEditorEntry | undefined {
  switch (parsed.kind) {
    case 'method': {
      if (parsed.diffView) return undefined; // read-only comparison view
      const receiver = parsed.isMeta ? `${parsed.className} (class)` : parsed.className;
      const suffix = parsed.base ? ' (base)' : '';
      return { kind: 'method', label: `${receiver}>>${parsed.selector}${suffix}` };
    }
    case 'definition':
      return { kind: 'class', label: parsed.className };
    case 'comment':
      return { kind: 'comment', label: parsed.className };
    case 'new-class':
    case 'new-method':
      return undefined;
  }
}
