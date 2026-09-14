import { TextEdit } from 'vscode-languageserver';
import { Token, TokenType } from '../lexer/tokens';
import { ParsedDocument, ParsedRegion } from '../utils/documentManager';
import {
  MethodNode,
  MethodBodyNode,
  MessagePatternNode,
  StatementNode,
  AssignmentNode,
  ReturnNode,
  ExpressionNode,
  MessageNode,
  UnaryMessageNode,
  BinaryMessageNode,
  KeywordMessageNode,
  PrimaryNode,
  BlockNode,
  SelectionBlockNode,
  ParenExpressionNode,
  CurlyArrayBuilderNode,
  ArrayLiteralNode,
  ArrayItemNode,
  ByteArrayLiteralNode,
  PragmaNode,
} from '../parser/ast';
import { FormatterSettings, DEFAULT_SETTINGS } from './formatterSettings';

/**
 * Whether Format Document should do anything to this document.
 *
 * Gated on what the document's REGIONS are, not on `doc.format`. Topaz documents and
 * `gemstone://` METHOD editors both reduce to `smalltalk-method` regions the formatter
 * handles, so both format. Tonel is not supported at all.
 *
 * The case this exists for is the other `gemstone://` shape: a definition or comment
 * URI (4- or 5-segment) parses to a single `smalltalk-code` region, and formatting a
 * class COMMENT destroys it — the prose goes through the Smalltalk parser, so
 * sentence-ending periods read as statement separators, every sentence lands on its
 * own line and the paragraph breaks are gone. A class DEFINITION survives but gets
 * reflowed and gains a trailing `.`, which is a change to text the client parses back
 * with `classNameFromDefinition`; that round trip wants checking before definitions
 * are let in, so they are excluded too.
 */
export function isFormattableDocument(doc: ParsedDocument): boolean {
  if (doc.format === 'tonel') return false;
  if (doc.format !== 'smalltalk') return true;
  return (
    doc.topazRegions.length > 0 && doc.topazRegions.every((r) => r.kind === 'smalltalk-method')
  );
}

export function formatDocument(
  doc: ParsedDocument,
  settings: FormatterSettings = DEFAULT_SETTINGS,
): TextEdit[] {
  const lines = doc.text.split('\n');
  const resultLines: string[] = [];
  let nextLine = 0;

  for (const region of doc.topazRegions) {
    while (nextLine < region.startLine) {
      resultLines.push(lines[nextLine]);
      nextLine++;
    }

    if (region.kind === 'topaz') {
      for (let i = region.startLine; i <= region.endLine; i++) {
        resultLines.push(lines[i]);
      }
      nextLine = region.endLine + 1;
    } else {
      const parsed = doc.parsedRegions.find((pr) => pr.region === region);
      if (parsed) {
        const formatted = formatRegion(parsed, settings);
        const formattedLines = formatted.split('\n');
        resultLines.push(...formattedLines);
      } else {
        for (let i = region.startLine; i <= region.endLine; i++) {
          resultLines.push(lines[i]);
        }
      }
      nextLine = region.endLine + 1;
    }
  }

  while (nextLine < lines.length) {
    resultLines.push(lines[nextLine]);
    nextLine++;
  }

  // Collapse consecutive blank lines to at most one
  const collapsed: string[] = [];
  let prevBlank = false;
  for (const line of resultLines) {
    const isBlank = line.trim() === '';
    if (isBlank && prevBlank) continue;
    collapsed.push(line);
    prevBlank = isBlank;
  }

  const newText = collapsed.join('\n');
  if (newText === doc.text) return [];

  const lastLine = lines.length - 1;
  const lastChar = lines[lastLine].length;
  return [
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: lastLine, character: lastChar },
      },
      newText,
    },
  ];
}

function makeIndent(settings: FormatterSettings): string {
  if (!settings.insertSpaces) return '\t';
  return ' '.repeat(settings.tabSize);
}

function formatRegion(parsed: ParsedRegion, settings: FormatterSettings): string {
  if (parsed.region.kind === 'smalltalk-method' && parsed.ast) {
    return formatMethod(parsed.ast, '', parsed.tokens, settings);
  }
  if (parsed.region.kind === 'smalltalk-code' && parsed.statements) {
    return formatStatements(parsed.statements, '', settings);
  }
  return parsed.region.text;
}

// ── Method ──────────────────────────────────────────────────

function formatMethod(
  method: MethodNode,
  indent: string,
  tokens: Token[],
  settings: FormatterSettings,
): string {
  const INDENT = makeIndent(settings);
  const parts: string[] = [];

  parts.push(indent + formatPattern(method.pattern));

  const methodComment = findMethodComment(method, tokens);
  if (methodComment) {
    parts.push(indent + INDENT + methodComment.text);
  }

  if (settings.blankLineAfterMethodPattern) {
    parts.push('');
  }

  parts.push(formatBodyWithStatements(method.body, method.body.statements, indent, settings));
  return parts.join('\n');
}

function findMethodComment(method: MethodNode, tokens: Token[]): Token | undefined {
  const patternEnd = method.pattern.range.end.offset;
  const bodyStart = method.body.range.start.offset;
  for (const token of tokens) {
    if (
      token.type === TokenType.Comment &&
      token.range.start.offset >= patternEnd &&
      token.range.start.offset <= bodyStart
    ) {
      return token;
    }
  }
  return undefined;
}

function formatPattern(pattern: MessagePatternNode): string {
  switch (pattern.kind) {
    case 'UnaryPattern':
      return pattern.selector;
    case 'BinaryPattern':
      return `${pattern.selector} ${pattern.parameter.name}`;
    case 'KeywordPattern':
      return pattern.keywords.map((kw, i) => `${kw} ${pattern.parameters[i].name}`).join(' ');
  }
}

function formatBodyWithStatements(
  body: MethodBodyNode,
  stmts: StatementNode[],
  indent: string,
  settings: FormatterSettings,
): string {
  const INDENT = makeIndent(settings);
  const parts: string[] = [];

  for (const pragma of body.pragmas) {
    parts.push(indent + INDENT + formatPragma(pragma, settings));
  }

  if (body.temporaries.length > 0) {
    const names = body.temporaries.map((t) => t.name).join(' ');
    parts.push(`${indent + INDENT}| ${names} |`);
  }

  if (stmts.length > 0) {
    parts.push(formatStatements(stmts, indent + INDENT, settings));
  }

  return parts.join('\n');
}

// ── Statements ──────────────────────────────────────────────

function formatStatements(
  stmts: StatementNode[],
  indent: string,
  settings: FormatterSettings,
): string {
  const lines: string[] = [];
  for (const stmt of stmts) {
    const text = formatStatement(stmt, indent, settings);
    if (stmt.kind === 'Return') {
      lines.push(indent + text);
    } else {
      lines.push(indent + text + '.');
    }
  }
  return lines.join('\n');
}

function formatStatement(stmt: StatementNode, indent: string, settings: FormatterSettings): string {
  switch (stmt.kind) {
    case 'Assignment':
      return formatAssignment(stmt, indent, settings);
    case 'Return':
      return formatReturn(stmt, indent, settings);
    case 'Expression':
      return formatExpression(stmt, indent, settings);
  }
}

function formatAssignment(
  node: AssignmentNode,
  indent: string,
  settings: FormatterSettings,
): string {
  const value = formatStatement(node.value, indent, settings);
  if (settings.spacesAroundAssignment) {
    return `${node.variable.name} := ${value}`;
  }
  return `${node.variable.name}:=${value}`;
}

function formatReturn(node: ReturnNode, indent: string, settings: FormatterSettings): string {
  const expr = formatExpression(node.expression, indent, settings);
  if (settings.spaceAfterCaret) {
    return `^ ${expr}`;
  }
  return `^${expr}`;
}

// ── Expression ──────────────────────────────────────────────

type ExpressionContext = 'standalone' | 'binary-arg' | 'keyword-arg';

function formatExpression(
  expr: ExpressionNode,
  indent: string,
  settings: FormatterSettings,
  context: ExpressionContext = 'standalone',
): string {
  const INDENT = makeIndent(settings);

  let receiver: string;
  if (
    settings.removeUnnecessaryParens &&
    expr.receiver.kind === 'ParenExpression' &&
    canRemoveParens(expr.receiver, expr.messages, context)
  ) {
    receiver = formatStatement(expr.receiver.expression, indent, settings);
  } else {
    receiver = formatPrimary(expr.receiver, indent, settings);
  }

  const result = formatWithMessages(receiver, expr.messages, indent, settings);

  if (expr.cascades.length > 0) {
    const parts = [result];
    for (const cascade of expr.cascades) {
      parts.push(';\n' + indent + INDENT + formatSingleMessage(cascade, indent + INDENT, settings));
    }
    return parts.join('');
  }

  return result;
}

function formatWithMessages(
  receiver: string,
  messages: MessageNode[],
  indent: string,
  settings: FormatterSettings,
): string {
  let result = receiver;
  for (const msg of messages) {
    switch (msg.kind) {
      case 'UnaryMessage':
        result += ' ' + formatUnaryMessage(msg);
        break;
      case 'BinaryMessage':
        result += ' ' + formatBinaryMessage(msg, indent, settings);
        break;
      case 'KeywordMessage':
        result = formatKeywordMessage(result, msg, indent, settings);
        break;
    }
  }
  return result;
}

function formatSingleMessage(
  msg: MessageNode,
  indent: string,
  settings: FormatterSettings,
): string {
  switch (msg.kind) {
    case 'UnaryMessage':
      return formatUnaryMessage(msg);
    case 'BinaryMessage':
      return formatBinaryMessage(msg, indent, settings);
    case 'KeywordMessage':
      return formatKeywordMessage('', msg, indent, settings).trimStart();
  }
}

function formatUnaryMessage(msg: UnaryMessageNode): string {
  const env = msg.envSpecifier ? msg.envSpecifier : '';
  return env + msg.selector;
}

function formatBinaryMessage(
  msg: BinaryMessageNode,
  indent: string,
  settings: FormatterSettings,
): string {
  const env = msg.envSpecifier ? msg.envSpecifier : '';
  const arg = formatExpression(msg.argument, indent, settings, 'binary-arg');
  if (settings.spacesAroundBinarySelectors) {
    return `${env}${msg.selector} ${arg}`;
  }
  return `${env}${msg.selector}${arg}`;
}

function formatKeywordMessage(
  receiver: string,
  msg: KeywordMessageNode,
  indent: string,
  settings: FormatterSettings,
): string {
  const env = msg.envSpecifier ? msg.envSpecifier : '';

  // Check if all arguments are blocks
  const blocks = msg.parts.map((part) => getBlockFromExpression(part.value));
  const allBlockArgs = blocks.every((b) => b !== null);

  if (allBlockArgs && msg.parts.length >= 2) {
    const blockList = blocks;

    // Tier 1: All blocks are trivial (empty or single variable/literal)
    // → keep everything on one line
    if (blockList.every(isTrivialBlock)) {
      const inlineParts = msg.parts.map((part, i) => {
        const blockStr = formatBlock(blockList[i], indent, settings);
        return `${env}${part.keyword} ${blockStr}`;
      });
      return `${receiver} ${inlineParts.join(' ')}`;
    }

    // Tier 2: All blocks have a single statement (no params/temps)
    // → each keyword on its own line with inline block
    if (blockList.every(isSingleStatementBlock)) {
      const contIndent = indent + ' '.repeat(settings.continuationIndent);
      const inlineBlocks = blockList.map((b) => formatBlockInline(b, contIndent, settings));

      // Only use tier 2 if all blocks format to a single line
      if (inlineBlocks.every((s) => !s.includes('\n'))) {
        const lines = [receiver];
        for (let i = 0; i < msg.parts.length; i++) {
          lines.push(`${contIndent}${env}${msg.parts[i].keyword} ${inlineBlocks[i]}`);
        }
        return lines.join('\n');
      }
    }

    // Tier 3: Bracket-flow style
    // → receiver ifTrue: [\n...\n] ifFalse: [\n...\n]
    return formatBracketFlowMessage(receiver, msg, blockList, indent, env, settings);
  }

  if (msg.parts.length < settings.multiKeywordThreshold) {
    const inlineParts = msg.parts.map((part) => {
      const arg = formatExpression(part.value, indent, settings, 'keyword-arg');
      return `${env}${part.keyword} ${arg}`;
    });
    return `${receiver} ${inlineParts.join(' ')}`;
  }

  const contIndent = indent + ' '.repeat(settings.continuationIndent);
  const lines = [receiver];
  for (const part of msg.parts) {
    const arg = formatExpression(part.value, contIndent, settings, 'keyword-arg');
    lines.push(`${contIndent}${env}${part.keyword} ${arg}`);
  }
  return lines.join('\n');
}

// ── Block-arg keyword message helpers ───────────────────────

function getBlockFromExpression(expr: ExpressionNode): BlockNode | null {
  if (expr.receiver.kind === 'Block' && expr.messages.length === 0 && expr.cascades.length === 0) {
    return expr.receiver;
  }
  return null;
}

function isTrivialBlock(block: BlockNode): boolean {
  if (block.parameters.length > 0 || block.temporaries.length > 0) return false;
  if (block.statements.length === 0) return true;
  if (block.statements.length !== 1) return false;
  const stmt = block.statements[0];
  if (stmt.kind !== 'Expression') return false;
  if (stmt.messages.length > 0 || stmt.cascades.length > 0) return false;
  return isSimplePrimary(stmt.receiver);
}

function isSingleStatementBlock(block: BlockNode): boolean {
  if (block.parameters.length > 0 || block.temporaries.length > 0) return false;
  return block.statements.length <= 1;
}

function formatBlockInline(block: BlockNode, indent: string, settings: FormatterSettings): string {
  if (block.statements.length === 0) return '[]';
  const stmt = formatStatement(block.statements[0], indent, settings);
  if (settings.spacesInsideBrackets) {
    return `[ ${stmt} ]`;
  }
  return `[${stmt}]`;
}

function formatBlockOpener(block: BlockNode): string {
  let opener = '[';
  if (block.parameters.length > 0) {
    const params = block.parameters.map((p) => ':' + p.name).join(' ');
    opener += params + ' |';
  }
  if (block.temporaries.length > 0) {
    const temps = block.temporaries.map((t) => t.name).join(' ');
    if (block.parameters.length > 0) {
      opener += ` | ${temps} |`;
    } else {
      opener += `| ${temps} |`;
    }
  }
  return opener;
}

function formatBracketFlowMessage(
  receiver: string,
  msg: KeywordMessageNode,
  blocks: BlockNode[],
  indent: string,
  env: string,
  settings: FormatterSettings,
): string {
  const INDENT = makeIndent(settings);
  const bodyIndent = indent + INDENT;
  const lines: string[] = [];

  for (let i = 0; i < msg.parts.length; i++) {
    const kw = msg.parts[i];
    const block = blocks[i];
    const opener = formatBlockOpener(block);

    if (i === 0) {
      lines.push(`${receiver} ${env}${kw.keyword} ${opener}`);
    } else {
      lines.push(`${indent}] ${env}${kw.keyword} ${opener}`);
    }

    if (block.statements.length > 0) {
      lines.push(formatStatements(block.statements, bodyIndent, settings));
    }
  }

  lines.push(indent + ']');
  return lines.join('\n');
}

// ── Primary ─────────────────────────────────────────────────

function formatPrimary(node: PrimaryNode, indent: string, settings: FormatterSettings): string {
  switch (node.kind) {
    case 'Variable':
      return node.name;
    case 'Path':
      return node.segments.join('.');
    case 'NumberLiteral':
      return node.value;
    case 'StringLiteral':
      return node.value;
    case 'SymbolLiteral':
      return `#${node.value}`;
    case 'CharacterLiteral':
      return node.value;
    case 'SpecialLiteral':
      return node.value;
    case 'ArrayLiteral':
      return formatArrayLiteral(node);
    case 'ByteArrayLiteral':
      return formatByteArrayLiteral(node);
    case 'Block':
      return formatBlock(node, indent, settings);
    case 'SelectionBlock':
      return formatSelectionBlock(node, indent, settings);
    case 'ParenExpression':
      return formatParenExpression(node, indent, settings);
    case 'CurlyArrayBuilder':
      return formatCurlyArray(node, indent, settings);
  }
}

function formatArrayLiteral(node: ArrayLiteralNode): string {
  const items = node.items.map(formatArrayItem).join(' ');
  return `#(${items})`;
}

function formatArrayItem(item: ArrayItemNode): string {
  switch (item.kind) {
    case 'NumberLiteral':
      return item.value;
    case 'StringLiteral':
      return item.value;
    case 'SymbolLiteral':
      return item.value;
    case 'CharacterLiteral':
      return item.value;
    case 'SpecialLiteral':
      return item.value;
    case 'ArrayLiteral':
      return formatArrayLiteral(item);
    case 'ByteArrayLiteral':
      return formatByteArrayLiteral(item);
  }
}

function formatByteArrayLiteral(node: ByteArrayLiteralNode): string {
  const values = node.values.map((v) => v.value).join(' ');
  return `#[${values}]`;
}

// ── Block ───────────────────────────────────────────────────

function formatBlock(block: BlockNode, indent: string, settings: FormatterSettings): string {
  const INDENT = makeIndent(settings);

  if (
    block.parameters.length === 0 &&
    block.temporaries.length === 0 &&
    block.statements.length === 0
  ) {
    return '[]';
  }

  // Single simple statement with no params/temps — keep inline
  if (
    block.parameters.length === 0 &&
    block.temporaries.length === 0 &&
    block.statements.length === 1 &&
    isSimpleStatement(block.statements[0])
  ) {
    const stmt = formatStatement(block.statements[0], indent, settings);
    if (settings.spacesInsideBrackets) {
      return `[ ${stmt} ]`;
    }
    return `[${stmt}]`;
  }

  const parts: string[] = [];
  parts.push(formatBlockOpener(block));

  const bodyIndent = indent + INDENT;
  parts.push(formatStatements(block.statements, bodyIndent, settings));

  parts.push(indent + ']');
  return parts.join('\n');
}

function isSimpleStatement(stmt: StatementNode): boolean {
  if (stmt.kind === 'Expression') {
    if (stmt.messages.length === 0 && stmt.cascades.length === 0) {
      return isSimplePrimary(stmt.receiver);
    }
    if (stmt.cascades.length > 0) return false;
    if (stmt.messages.every((m) => m.kind === 'UnaryMessage') && isSimplePrimary(stmt.receiver)) {
      return true;
    }
    return false;
  }
  if (stmt.kind === 'Assignment') {
    return isSimpleStatement(stmt.value);
  }
  return false;
}

function isSimplePrimary(node: PrimaryNode): boolean {
  return (
    node.kind === 'Variable' ||
    node.kind === 'NumberLiteral' ||
    node.kind === 'StringLiteral' ||
    node.kind === 'SymbolLiteral' ||
    node.kind === 'CharacterLiteral' ||
    node.kind === 'SpecialLiteral' ||
    node.kind === 'Path'
  );
}

function formatSelectionBlock(
  node: SelectionBlockNode,
  indent: string,
  settings: FormatterSettings,
): string {
  const pred = formatExpression(node.predicate, indent, settings);
  if (settings.spacesInsideBraces) {
    return `{ :${node.parameter.name} | ${pred} }`;
  }
  return `{:${node.parameter.name} | ${pred}}`;
}

function formatParenExpression(
  node: ParenExpressionNode,
  indent: string,
  settings: FormatterSettings,
): string {
  const inner = formatStatement(node.expression, indent, settings);
  if (settings.spacesInsideParens) {
    return `( ${inner} )`;
  }
  return `(${inner})`;
}

// ── Paren removal helpers ───────────────────────────────────

function canRemoveParens(
  paren: ParenExpressionNode,
  outerMessages: MessageNode[],
  context: ExpressionContext,
): boolean {
  const inner = paren.expression;
  if (inner.kind !== 'Expression') return false;
  if (inner.cascades.length > 0) return false;

  const level = effectiveExpressionLevel(inner);

  if (outerMessages.length > 0) {
    const firstMsg = outerMessages[0];
    switch (firstMsg.kind) {
      case 'UnaryMessage':
        return level <= 1;
      case 'BinaryMessage':
        return level <= 2;
      case 'KeywordMessage':
        return level <= 2;
    }
  }

  switch (context) {
    case 'standalone':
      return true;
    case 'binary-arg':
      return level <= 1;
    case 'keyword-arg':
      return level <= 2;
  }
}

function effectiveExpressionLevel(expr: ExpressionNode): number {
  if (expr.messages.length > 0) return expressionLevel(expr);
  if (expr.cascades.length > 0) return 4;
  if (expr.receiver.kind === 'ParenExpression' && expr.receiver.expression.kind === 'Expression') {
    return effectiveExpressionLevel(expr.receiver.expression);
  }
  return 0;
}

function expressionLevel(expr: ExpressionNode): number {
  for (const msg of expr.messages) {
    if (msg.kind === 'KeywordMessage') return 3;
  }
  for (const msg of expr.messages) {
    if (msg.kind === 'BinaryMessage') return 2;
  }
  if (expr.messages.length > 0) return 1;
  return 0;
}

function formatCurlyArray(
  node: CurlyArrayBuilderNode,
  indent: string,
  settings: FormatterSettings,
): string {
  if (node.expressions.length === 0) return '{}';
  const items = node.expressions.map((e) => formatExpression(e, indent, settings));
  if (settings.spacesInsideBraces) {
    return `{ ${items.join('. ')} }`;
  }
  return `{${items.join('. ')}}`;
}

// ── Pragmas ─────────────────────────────────────────────────

function formatPragma(pragma: PragmaNode, settings: FormatterSettings): string {
  if (pragma.body.kind === 'UnaryPragma') {
    return `<${pragma.body.selector}>`;
  }
  const pairs = pragma.body.pairs
    .map((p) => `${p.keyword} ${formatPrimary(p.literal, '', settings)}`)
    .join(' ');
  return `<${pairs}>`;
}
