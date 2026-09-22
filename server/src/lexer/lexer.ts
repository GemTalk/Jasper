import { Token, TokenType, SourcePosition, createPosition, createRange } from './tokens';

/**
 * The server's Smalltalk tokenizer, and the server's only scanner — anything here
 * that needs to walk source past its strings, comments and character literals
 * goes through this rather than rolling its own loop.
 *
 * ── Keeping this in step with the client ──────────────────────────────────
 * The client has a scanner of its own, `client/src/smalltalkScan.ts`, and it must
 * agree with this one about where a quoted span begins and ends. It cannot import
 * this file: `client/tsconfig.json` and `server/tsconfig.json` each pin `rootDir`
 * to their own `src`, so sharing code would take a third workspace and a build
 * change.
 *
 * What holds the two together instead is `test-fixtures/smalltalkLiteralCorpus.json`.
 * It declares where every string, comment and character literal in a set of tricky
 * snippets begins and ends, and both sides assert against it:
 *
 *   server/src/lexer/__tests__/literalCorpusAgreement.test.ts
 *   client/src/__tests__/smalltalkScan.test.ts
 *
 * So: teaching this lexer a new Smalltalk quirk means adding the case to that
 * corpus, which will fail the client's test until `skipLiteral` learns it too (and
 * the other way round). Do not fix one side alone, and do not add the case to only
 * one of the two test files — the corpus is the shared contract.
 */

const SELECTOR_CHARS = new Set([
  '+',
  '-',
  '\\',
  '*',
  '~',
  '<',
  '>',
  '=',
  '|',
  '/',
  '&',
  '@',
  '%',
  ',',
  '?',
  '!',
]);

const SPECIAL_LITERALS: Record<string, boolean> = {
  true: true,
  false: true,
  nil: true,
  _remoteNil: true,
};

export class Lexer {
  private source: string;
  private pos: number;
  private line: number;
  private col: number;
  private length: number;

  /**
   * `startOffset` and `startLine` let a caller lex a tail of `source` without
   * slicing it first — the Tonel parser walks method after method through one
   * document, and copying the remaining text for each would be quadratic.
   * Offsets and line numbers in the tokens stay absolute to `source`, so they
   * can be used against the whole document. `startOffset` must sit at the start
   * of `startLine` for the line numbers to mean anything.
   */
  constructor(source: string, startOffset = 0, startLine = 0) {
    this.source = source;
    this.pos = startOffset;
    this.line = startLine;
    this.col = 0;
    this.length = source.length;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];
    while (true) {
      const token = this.nextToken();
      tokens.push(token);
      if (token.type === TokenType.EOF) break;
    }
    return tokens;
  }

  nextToken(): Token {
    if (this.pos >= this.length) {
      return this.makeToken(TokenType.EOF, '', this.currentPosition());
    }

    const ch = this.source[this.pos];

    // Whitespace
    if (this.isWhitespace(ch)) {
      return this.scanWhitespace();
    }

    // Comment: "..."
    if (ch === '"') {
      return this.scanComment();
    }

    // String: '...'
    if (ch === "'") {
      return this.scanString();
    }

    // Character literal: $x
    if (ch === '$') {
      return this.scanCharacterLiteral();
    }

    // Hash: #(...), #[...], #'...', #symbol
    if (ch === '#') {
      return this.scanHash();
    }

    // Number: starts with digit
    if (this.isDigit(ch)) {
      return this.scanNumber();
    }

    // Identifier, keyword, or special literal
    if (this.isLetter(ch)) {
      return this.scanIdentifier();
    }

    // Underscore: could be assignment or start of identifier (_remoteNil)
    if (ch === '_') {
      return this.scanUnderscore();
    }

    // @ - env specifier
    if (ch === '@') {
      return this.scanAtSign();
    }

    // : or :=
    if (ch === ':') {
      return this.scanColon();
    }

    // Single character tokens
    if (ch === '^') return this.singleCharToken(TokenType.Caret);
    if (ch === '.') return this.singleCharToken(TokenType.Period);
    if (ch === ';') return this.singleCharToken(TokenType.Semicolon);
    if (ch === '(') return this.singleCharToken(TokenType.LeftParen);
    if (ch === ')') return this.singleCharToken(TokenType.RightParen);
    if (ch === '[') return this.singleCharToken(TokenType.LeftBracket);
    if (ch === ']') return this.singleCharToken(TokenType.RightBracket);
    if (ch === '{') return this.singleCharToken(TokenType.LeftBrace);
    if (ch === '}') return this.singleCharToken(TokenType.RightBrace);
    if (ch === '|') return this.singleCharToken(TokenType.Pipe);

    // Binary selectors (including <, >, -, etc.)
    if (SELECTOR_CHARS.has(ch)) {
      return this.scanBinarySelector();
    }

    // Unknown character
    const start = this.currentPosition();
    this.advance();
    return this.makeToken(TokenType.Error, ch, start);
  }

  private scanWhitespace(): Token {
    const start = this.currentPosition();
    const startPos = this.pos;
    while (this.pos < this.length && this.isWhitespace(this.source[this.pos])) {
      this.advance();
    }
    return this.makeToken(TokenType.Whitespace, this.source.slice(startPos, this.pos), start);
  }

  private scanComment(): Token {
    const start = this.currentPosition();
    const startPos = this.pos;
    this.advance(); // skip opening "
    // A comment escapes its own delimiter by doubling it, the same way a string
    // does, so `""` inside one is an embedded quote rather than the close. The
    // class comments under gs-src/refactoring/ rely on this — RBBlockNode's says
    // it `represents a block ""[...]""`. An empty comment is still written `""`:
    // at the second quote there is no third one following, so it closes.
    while (this.pos < this.length) {
      if (this.source[this.pos] === '"') {
        this.advance();
        if (this.pos < this.length && this.source[this.pos] === '"') {
          this.advance();
          continue;
        }
        break;
      }
      this.advance();
    }
    return this.makeToken(TokenType.Comment, this.source.slice(startPos, this.pos), start);
  }

  private scanString(): Token {
    const start = this.currentPosition();
    const startPos = this.pos;
    this.advance(); // skip opening '
    while (this.pos < this.length) {
      if (this.source[this.pos] === "'") {
        this.advance();
        // Check for escaped quote ''
        if (this.pos < this.length && this.source[this.pos] === "'") {
          this.advance();
          continue;
        }
        break;
      }
      this.advance();
    }
    return this.makeToken(TokenType.String, this.source.slice(startPos, this.pos), start);
  }

  private scanCharacterLiteral(): Token {
    const start = this.currentPosition();
    const startPos = this.pos;
    this.advance(); // skip $
    if (this.pos < this.length) {
      this.advance(); // consume the character
    }
    return this.makeToken(TokenType.Character, this.source.slice(startPos, this.pos), start);
  }

  private scanHash(): Token {
    const start = this.currentPosition();
    const startPos = this.pos;
    this.advance(); // skip #

    if (this.pos >= this.length) {
      return this.makeToken(TokenType.Hash, '#', start);
    }

    const next = this.source[this.pos];

    // #( - array literal
    if (next === '(') {
      this.advance();
      return this.makeToken(TokenType.HashLeftParen, '#(', start);
    }

    // #[ - byte array literal
    if (next === '[') {
      this.advance();
      return this.makeToken(TokenType.HashLeftBracket, '#[', start);
    }

    // #'...' - symbol string
    if (next === "'") {
      this.advance(); // skip '
      while (this.pos < this.length) {
        if (this.source[this.pos] === "'") {
          this.advance();
          if (this.pos < this.length && this.source[this.pos] === "'") {
            this.advance();
            continue;
          }
          break;
        }
        this.advance();
      }
      return this.makeToken(TokenType.Symbol, this.source.slice(startPos, this.pos), start);
    }

    // #identifier or #keyword:keyword: or #binarySelector
    if (this.isLetter(next) || next === '_') {
      // Scan identifier(s) and optional colons for keyword symbols
      while (
        this.pos < this.length &&
        (this.isLetterOrDigit(this.source[this.pos]) || this.source[this.pos] === '_')
      ) {
        this.advance();
      }
      // Check for keyword symbol: #at:put:
      while (this.pos < this.length && this.source[this.pos] === ':') {
        this.advance(); // consume ':'
        // After colon, scan next identifier part if present
        if (
          this.pos < this.length &&
          (this.isLetter(this.source[this.pos]) || this.source[this.pos] === '_')
        ) {
          while (
            this.pos < this.length &&
            (this.isLetterOrDigit(this.source[this.pos]) || this.source[this.pos] === '_')
          ) {
            this.advance();
          }
        }
      }
      return this.makeToken(TokenType.Symbol, this.source.slice(startPos, this.pos), start);
    }

    // #+ #- #~= etc. - binary selector symbol
    if (SELECTOR_CHARS.has(next)) {
      this.advance();
      if (this.pos < this.length && SELECTOR_CHARS.has(this.source[this.pos])) {
        this.advance();
      }
      return this.makeToken(TokenType.Symbol, this.source.slice(startPos, this.pos), start);
    }

    return this.makeToken(TokenType.Hash, '#', start);
  }

  private scanNumber(): Token {
    const start = this.currentPosition();
    const startPos = this.pos;

    // Scan initial digits
    this.scanDigits();

    if (this.pos < this.length) {
      const ch = this.source[this.pos];

      // Radixed literal: 16rFF or 16#FF
      if (ch === 'r' || ch === 'R' || ch === '#') {
        // Check if # looks like radixed (digits before it)
        if (ch === '#') {
          // Only treat as radixed if we have valid numerics after
          const peekPos = this.pos + 1;
          if (peekPos < this.length && this.isAlphanumeric(this.source[peekPos])) {
            this.advance(); // skip 'r'/'#'
            this.scanNumerics();
            return this.makeToken(TokenType.Integer, this.source.slice(startPos, this.pos), start);
          }
        } else {
          this.advance(); // skip 'r'/'R'
          this.scanNumerics();
          return this.makeToken(TokenType.Integer, this.source.slice(startPos, this.pos), start);
        }
      }

      // Fractional part: 3.14
      if (ch === '.' && this.pos + 1 < this.length && this.isDigit(this.source[this.pos + 1])) {
        this.advance(); // skip '.'
        this.scanDigits();
        // Check for exponent after fractional part
        if (this.pos < this.length) {
          const expType = this.tryExponent();
          if (expType === 'scaled') {
            return this.makeToken(
              TokenType.ScaledDecimal,
              this.source.slice(startPos, this.pos),
              start,
            );
          }
        }
        return this.makeToken(TokenType.Float, this.source.slice(startPos, this.pos), start);
      }

      // Exponent without fractional part
      const expType = this.tryExponent();
      if (expType === 'scaled') {
        return this.makeToken(
          TokenType.ScaledDecimal,
          this.source.slice(startPos, this.pos),
          start,
        );
      }
      if (expType === 'float') {
        return this.makeToken(TokenType.Float, this.source.slice(startPos, this.pos), start);
      }
    }

    return this.makeToken(TokenType.Integer, this.source.slice(startPos, this.pos), start);
  }

  private tryExponent(): 'float' | 'scaled' | null {
    if (this.pos >= this.length) return null;
    const ch = this.source[this.pos];

    // Binary/decimal exponents: e E d D q f F
    if ('eEdDqQ'.includes(ch)) {
      this.advance();
      if (this.pos < this.length && this.source[this.pos] === '-') {
        this.advance();
      }
      this.scanDigits();
      return 'float';
    }

    if ('fF'.includes(ch)) {
      this.advance();
      if (this.pos < this.length && this.source[this.pos] === '-') {
        this.advance();
      }
      this.scanDigits();
      return 'float';
    }

    // Scaled decimal: s
    if (ch === 's') {
      this.advance();
      if (
        this.pos < this.length &&
        (this.source[this.pos] === '-' || this.isDigit(this.source[this.pos]))
      ) {
        if (this.source[this.pos] === '-') this.advance();
        this.scanDigits();
      }
      return 'scaled';
    }

    // Fixed point: p
    if (ch === 'p') {
      this.advance();
      if (
        this.pos < this.length &&
        (this.source[this.pos] === '-' || this.isDigit(this.source[this.pos]))
      ) {
        if (this.source[this.pos] === '-') this.advance();
        this.scanDigits();
      }
      return 'float';
    }

    return null;
  }

  private scanDigits(): void {
    while (this.pos < this.length && this.isDigit(this.source[this.pos])) {
      this.advance();
    }
  }

  private scanNumerics(): void {
    while (this.pos < this.length && this.isAlphanumeric(this.source[this.pos])) {
      this.advance();
    }
  }

  private scanIdentifier(): Token {
    const start = this.currentPosition();
    const startPos = this.pos;

    while (
      this.pos < this.length &&
      (this.isLetterOrDigit(this.source[this.pos]) || this.source[this.pos] === '_')
    ) {
      this.advance();
    }

    const text = this.source.slice(startPos, this.pos);

    // Check for keyword (identifier followed by colon, but not :=)
    if (
      this.pos < this.length &&
      this.source[this.pos] === ':' &&
      (this.pos + 1 >= this.length || this.source[this.pos + 1] !== '=')
    ) {
      this.advance(); // consume ':'
      return this.makeToken(TokenType.Keyword, text + ':', start);
    }

    // Check for special literals
    if (SPECIAL_LITERALS[text]) {
      return this.makeToken(TokenType.SpecialLiteral, text, start);
    }

    return this.makeToken(TokenType.Identifier, text, start);
  }

  private scanUnderscore(): Token {
    const start = this.currentPosition();
    const startPos = this.pos;

    // Check if it starts an identifier (_remoteNil, _var, etc.)
    if (
      this.pos + 1 < this.length &&
      (this.isLetter(this.source[this.pos + 1]) || this.source[this.pos + 1] === '_')
    ) {
      this.advance(); // skip _
      while (
        this.pos < this.length &&
        (this.isLetterOrDigit(this.source[this.pos]) || this.source[this.pos] === '_')
      ) {
        this.advance();
      }
      const text = this.source.slice(startPos, this.pos);

      // Check for keyword
      if (
        this.pos < this.length &&
        this.source[this.pos] === ':' &&
        (this.pos + 1 >= this.length || this.source[this.pos + 1] !== '=')
      ) {
        this.advance();
        return this.makeToken(TokenType.Keyword, text + ':', start);
      }

      if (SPECIAL_LITERALS[text]) {
        return this.makeToken(TokenType.SpecialLiteral, text, start);
      }
      return this.makeToken(TokenType.Identifier, text, start);
    }

    // Standalone underscore (legacy assignment)
    this.advance();
    return this.makeToken(TokenType.Underscore, '_', start);
  }

  private scanAtSign(): Token {
    const start = this.currentPosition();
    const startPos = this.pos;

    // Check for @env\d+:
    if (this.source.startsWith('@env', this.pos)) {
      this.pos += 4;
      this.col += 4;
      if (this.pos < this.length && this.isDigit(this.source[this.pos])) {
        this.scanDigits();
        if (this.pos < this.length && this.source[this.pos] === ':') {
          this.advance();
          return this.makeToken(
            TokenType.EnvSpecifier,
            this.source.slice(startPos, this.pos),
            start,
          );
        }
      }
      // Not a valid env specifier, treat as binary selector
      this.pos = startPos + 1;
      this.col = start.column + 1;
    } else {
      this.advance();
    }

    // @ as binary selector character
    if (this.pos < this.length && SELECTOR_CHARS.has(this.source[this.pos])) {
      this.advance();
    }
    return this.makeToken(TokenType.BinarySelector, this.source.slice(startPos, this.pos), start);
  }

  private scanColon(): Token {
    const start = this.currentPosition();
    this.advance(); // skip ':'
    if (this.pos < this.length && this.source[this.pos] === '=') {
      this.advance();
      return this.makeToken(TokenType.Assign, ':=', start);
    }
    return this.makeToken(TokenType.Colon, ':', start);
  }

  private scanBinarySelector(): Token {
    const start = this.currentPosition();
    const startPos = this.pos;
    const first = this.source[this.pos];

    // Handle < and > specially (could be pragma delimiters)
    if (first === '<') {
      this.advance();
      // Check for <=
      if (this.pos < this.length && this.source[this.pos] === '=') {
        this.advance();
        return this.makeToken(TokenType.BinarySelector, '<=', start);
      }
      return this.makeToken(TokenType.LessThan, '<', start);
    }

    if (first === '>') {
      this.advance();
      // Check for >=
      if (this.pos < this.length && this.source[this.pos] === '=') {
        this.advance();
        return this.makeToken(TokenType.BinarySelector, '>=', start);
      }
      return this.makeToken(TokenType.GreaterThan, '>', start);
    }

    // Handle - specially: could be negative number prefix (handled by parser)
    if (first === '-') {
      this.advance();
      // Check for second selector char
      if (
        this.pos < this.length &&
        SELECTOR_CHARS.has(this.source[this.pos]) &&
        this.source[this.pos] !== '-'
      ) {
        this.advance();
        return this.makeToken(
          TokenType.BinarySelector,
          this.source.slice(startPos, this.pos),
          start,
        );
      }
      return this.makeToken(TokenType.Minus, '-', start);
    }

    this.advance();
    // Second selector character
    if (this.pos < this.length && SELECTOR_CHARS.has(this.source[this.pos])) {
      // Don't consume second char if it's a special single char like < or >
      const second = this.source[this.pos];
      if (second !== '<' && second !== '>') {
        this.advance();
      }
    }
    return this.makeToken(TokenType.BinarySelector, this.source.slice(startPos, this.pos), start);
  }

  private singleCharToken(type: TokenType): Token {
    const start = this.currentPosition();
    const ch = this.source[this.pos];
    this.advance();
    return this.makeToken(type, ch, start);
  }

  private advance(): void {
    if (this.pos < this.length) {
      if (this.source[this.pos] === '\n') {
        this.line++;
        this.col = 0;
      } else {
        this.col++;
      }
      this.pos++;
    }
  }

  private currentPosition(): SourcePosition {
    return createPosition(this.pos, this.line, this.col);
  }

  private makeToken(type: TokenType, text: string, start: SourcePosition): Token {
    return {
      type,
      text,
      range: createRange(start, this.currentPosition()),
    };
  }

  private isWhitespace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isLetter(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isLetterOrDigit(ch: string): boolean {
    return this.isLetter(ch) || this.isDigit(ch);
  }

  private isAlphanumeric(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9');
  }
}
