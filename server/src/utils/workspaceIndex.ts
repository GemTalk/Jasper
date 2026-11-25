import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { parseTopazDocument } from '../topaz/topazParser';
import { parseTonelDocument } from '../tonel/tonelParser';
import { Lexer } from '../lexer/lexer';
import { Parser } from '../parser/parser';
import { collectSentSelectors } from './astUtils';
import { ParsedDocument, DocumentFormat } from './documentManager';

// ── Data structures ─────────────────────────────────────────

export interface MethodEntry {
  uri: string;
  selector: string;
  className?: string;
  isClassSide: boolean;
  startLine: number;
  endLine: number;
  sentSelectors: Set<string>;
}

/** Detect document format from URI file extension or scheme. */
export function detectFormat(uri: string): DocumentFormat {
  if (uri.endsWith('.st')) return 'tonel';
  if (uri.startsWith('gemstone:')) return 'smalltalk';
  return 'topaz';
}

// ── File parsing ────────────────────────────────────────────

export function indexFile(uri: string, text: string): MethodEntry[] {
  const format = detectFormat(uri);
  const topazRegions = format === 'tonel' ? parseTonelDocument(text) : parseTopazDocument(text);
  const methods: MethodEntry[] = [];

  for (const region of topazRegions) {
    if (region.kind !== 'smalltalk-method') continue;

    const lexer = new Lexer(region.text);
    const tokens = lexer.tokenize();
    const parser = new Parser(tokens);
    const { ast } = parser.parse();
    if (!ast) continue;

    methods.push({
      uri,
      selector: ast.pattern.selector,
      className: region.className,
      isClassSide: region.command === 'classmethod',
      startLine: region.startLine,
      endLine: region.endLine,
      sentSelectors: collectSentSelectors(ast),
    });
  }

  return methods;
}

// ── Workspace index ─────────────────────────────────────────

export class WorkspaceIndex {
  private fileIndex = new Map<string, MethodEntry[]>();
  private implementors = new Map<string, MethodEntry[]>();
  private senders = new Map<string, MethodEntry[]>();

  /** Index a file from raw text (for files not open in the editor). */
  indexFileFromDisk(uri: string, text: string): void {
    this.replaceFile(uri, indexFile(uri, text));
  }

  /**
   * Index a file from an already-parsed document (for open editors). A method opened from the
   * stone (`gemstone:`) is skipped: the stone answers for it, so its entries would only list it
   * a second time.
   */
  updateFromParsedDocument(doc: ParsedDocument): void {
    if (doc.uri.startsWith('gemstone:')) return;
    const methods: MethodEntry[] = [];

    for (const pr of doc.parsedRegions) {
      if (pr.region.kind !== 'smalltalk-method') continue;
      if (!pr.ast) continue;

      methods.push({
        uri: doc.uri,
        selector: pr.ast.pattern.selector,
        className: pr.region.className,
        isClassSide: pr.region.command === 'classmethod',
        startLine: pr.region.startLine,
        endLine: pr.region.endLine,
        sentSelectors: collectSentSelectors(pr.ast),
      });
    }

    this.replaceFile(doc.uri, methods);
  }

  /** Replace all index entries for a file. */
  replaceFile(uri: string, methods: MethodEntry[]): void {
    this.removeFile(uri);
    this.fileIndex.set(uri, methods);

    for (const method of methods) {
      pushTo(this.implementors, method.selector, method);
      for (const sent of method.sentSelectors) {
        pushTo(this.senders, sent, method);
      }
    }
  }

  /**
   * Drops what an editor held once it closes. A file the workspace scan covers (`scanned`) is
   * indexed again as saved, or leaves the index if it was deleted meanwhile; any other file
   * leaves it, since nothing would update its entries again. The file watcher can't do this:
   * it ignores a change to a file that is open.
   */
  indexClosedDocument(uri: string, scanned: boolean): void {
    let saved: string | undefined;
    if (scanned) {
      try {
        saved = fs.readFileSync(fileURLToPath(uri), 'utf-8');
      } catch {
        // Deleted, or unreadable: either way it no longer has methods to list.
      }
    }
    if (saved === undefined) this.removeFile(uri);
    else this.indexFileFromDisk(uri, saved);
  }

  /** Remove all entries for a file. */
  removeFile(uri: string): void {
    const existing = this.fileIndex.get(uri);
    if (!existing) return;

    for (const method of existing) {
      removeFrom(this.implementors, method.selector, uri);
      for (const sent of method.sentSelectors) {
        removeFrom(this.senders, sent, uri);
      }
    }

    this.fileIndex.delete(uri);
  }

  /** Find all implementors of a selector. */
  findImplementors(selector: string): MethodEntry[] {
    return this.implementors.get(selector) ?? [];
  }

  /** Find all methods that send a selector. */
  findSenders(selector: string): MethodEntry[] {
    return this.senders.get(selector) ?? [];
  }

  /** Search methods by partial match on "ClassName >> selector". */
  searchMethods(query: string): MethodEntry[] {
    const lower = query.toLowerCase();
    const results: MethodEntry[] = [];
    for (const methods of this.fileIndex.values()) {
      for (const method of methods) {
        const displayName = method.className
          ? `${method.className} >> ${method.selector}`
          : method.selector;
        if (displayName.toLowerCase().includes(lower)) {
          results.push(method);
        }
      }
    }
    return results;
  }
}

// ── Helpers ─────────────────────────────────────────────────

function pushTo(map: Map<string, MethodEntry[]>, key: string, entry: MethodEntry): void {
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  list.push(entry);
}

function removeFrom(map: Map<string, MethodEntry[]>, key: string, uri: string): void {
  const list = map.get(key);
  if (!list) return;
  const filtered = list.filter((m) => m.uri !== uri);
  if (filtered.length === 0) {
    map.delete(key);
  } else {
    map.set(key, filtered);
  }
}
