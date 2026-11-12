import { Location, Position } from 'vscode-languageserver';
import { ParsedDocument, ParsedRegion } from '../utils/documentManager';
import { ScopeAnalyzer } from '../utils/scopeAnalyzer';
import { TokenType, createPosition } from '../lexer/tokens';
import { findTokenAt, findSelectorAtPosition } from '../utils/astUtils';
import { WorkspaceIndex } from '../utils/workspaceIndex';

export function getDefinition(
  doc: ParsedDocument,
  position: Position,
  region?: ParsedRegion,
): Location | null {
  const ast = region?.ast ?? doc.ast;
  if (!ast) return null;

  const tokens = region?.tokens ?? doc.tokens;
  const token = findTokenAt(tokens, position);
  if (!token) return null;

  // For identifiers, try local variable definition first
  if (token.type === TokenType.Identifier) {
    const analyzer = new ScopeAnalyzer();
    const root = analyzer.analyze(ast);
    const pos = createPosition(0, position.line, position.character);
    const varInfo = analyzer.findVariableAt(root, token.text, pos);

    if (varInfo) {
      return {
        uri: doc.uri,
        range: {
          start: {
            line: varInfo.definitionRange.start.line,
            character: varInfo.definitionRange.start.column,
          },
          end: {
            line: varInfo.definitionRange.end.line,
            character: varInfo.definitionRange.end.column,
          },
        },
      };
    }
  }

  return null;
}

/**
 * Go to Definition: a local variable's declaration first, then implementors from the workspace
 * index. Not for a method opened from the stone (`gemstone:`): the client asks the stone for its
 * implementors, and VS Code lists `file:` answers ahead of `gemstone:` ones, so the files on disk
 * would bury the code that actually runs.
 */
export function resolveDefinition(
  doc: ParsedDocument,
  position: Position,
  region: ParsedRegion | undefined,
  index: WorkspaceIndex,
): Location | Location[] | null {
  const localDef = getDefinition(doc, position, region);
  if (localDef) return localDef;
  if (doc.uri.startsWith('gemstone:')) return null;
  return getWorkspaceDefinition(doc, position, region, index);
}

/** Cross-file definition: find implementors of the selector at the cursor. */
export function getWorkspaceDefinition(
  doc: ParsedDocument,
  position: Position,
  region: ParsedRegion | undefined,
  index: WorkspaceIndex,
): Location[] | null {
  const ast = region?.ast ?? doc.ast;
  if (!ast) return null;

  const tokens = region?.tokens ?? doc.tokens;
  const lineOffset = region
    ? region.region.startLine - (region.region.kind === 'smalltalk-code' ? 1 : 0)
    : 0;

  const selector = findSelectorAtPosition(tokens, ast, position, lineOffset);
  if (!selector) return null;

  const implementors = index.findImplementors(selector);
  if (implementors.length === 0) return null;

  return implementors.map((m) => ({
    uri: m.uri,
    range: {
      start: { line: m.startLine, character: 0 },
      end: { line: m.endLine, character: 0 },
    },
  }));
}

/** Cross-file references: find senders of the selector at the cursor. */
export function getWorkspaceReferences(
  doc: ParsedDocument,
  position: Position,
  region: ParsedRegion | undefined,
  index: WorkspaceIndex,
): Location[] | null {
  const ast = region?.ast ?? doc.ast;
  if (!ast) return null;

  const tokens = region?.tokens ?? doc.tokens;
  const lineOffset = region
    ? region.region.startLine - (region.region.kind === 'smalltalk-code' ? 1 : 0)
    : 0;

  const selector = findSelectorAtPosition(tokens, ast, position, lineOffset);
  if (!selector) return null;

  const senders = index.findSenders(selector);
  if (senders.length === 0) return null;

  return senders.map((m) => ({
    uri: m.uri,
    range: {
      start: { line: m.startLine, character: 0 },
      end: { line: m.endLine, character: 0 },
    },
  }));
}
