import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  DocumentSymbol,
  DidChangeConfigurationNotification,
  DidChangeWatchedFilesNotification,
  FileChangeType,
  SymbolInformation,
  SymbolKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { fileURLToPath, pathToFileURL } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import { DocumentManager } from './utils/documentManager';
import { WorkspaceIndex, detectFormat } from './utils/workspaceIndex';
import { toDiagnostics } from './services/diagnostics';
import { getDocumentSymbols } from './services/documentSymbols';
import { getCompletions } from './services/completion';
import { getHover } from './services/hover';
import {
  getDefinition,
  getWorkspaceDefinition,
  getWorkspaceReferences,
} from './services/definition';
import { findSelectorAtPosition } from './utils/astUtils';
import { getFoldingRanges } from './services/folding';
import { formatDocument, isFormattableDocument } from './services/formatting';
import { FormatterSettings, DEFAULT_SETTINGS } from './services/formatterSettings';
import {
  collectSemanticTokens,
  encodeSemanticTokens,
  SEMANTIC_TOKEN_TYPES,
  SEMANTIC_TOKEN_MODIFIERS,
} from './services/semanticTokens';
import { ScopeAnalyzer } from './utils/scopeAnalyzer';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const documentManager = new DocumentManager();
const workspaceIndex = new WorkspaceIndex();

let formatterSettings: FormatterSettings = { ...DEFAULT_SETTINGS };
let hasConfigurationCapability = false;
let workspaceFolders: { uri: string; name: string }[] = [];

const SMALLTALK_EXTENSIONS = ['.gs', '.st', '.tpz'];

connection.onInitialize((params: InitializeParams): InitializeResult => {
  hasConfigurationCapability = !!(
    params.capabilities.workspace && params.capabilities.workspace.configuration
  );

  workspaceFolders = params.workspaceFolders ?? [];

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      completionProvider: {
        triggerCharacters: [':', '.', '#', '$', '@'],
        resolveProvider: false,
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      foldingRangeProvider: true,
      documentFormattingProvider: true,
      semanticTokensProvider: {
        legend: {
          tokenTypes: SEMANTIC_TOKEN_TYPES,
          tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
        },
        full: true,
      },
    },
  };
});

connection.onInitialized(async () => {
  if (hasConfigurationCapability) {
    await connection.client.register(DidChangeConfigurationNotification.type, {
      section: 'gemstoneSmalltalk',
    });
    await updateFormatterSettings();
  }

  // Register file watchers for Smalltalk files
  await connection.client.register(DidChangeWatchedFilesNotification.type, {
    watchers: SMALLTALK_EXTENSIONS.map((ext) => ({
      globPattern: `**/*${ext}`,
    })),
  });

  // Initial workspace scan
  scanWorkspace();
});

// ── Configuration ─────────────────────────────────────────

connection.onDidChangeConfiguration(async (_change) => {
  if (hasConfigurationCapability) {
    await updateFormatterSettings();
  }
});

async function updateFormatterSettings(): Promise<void> {
  const config = await connection.workspace.getConfiguration({
    section: 'gemstoneSmalltalk.formatter',
  });
  if (config) {
    formatterSettings = {
      ...DEFAULT_SETTINGS,
      ...config,
    };
  }
}

// ── Workspace scanning ────────────────────────────────────

function scanWorkspace(): void {
  for (const folder of workspaceFolders) {
    const folderPath = fileURLToPath(folder.uri);
    const files = findFiles(folderPath, SMALLTALK_EXTENSIONS);
    for (const filePath of files) {
      try {
        const text = fs.readFileSync(filePath, 'utf-8');
        const uri = pathToFileURL(filePath).toString();
        workspaceIndex.indexFileFromDisk(uri, text);
      } catch {
        // Skip files that can't be read
      }
    }
  }
}

function findFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      results.push(...findFiles(fullPath, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Document Lifecycle ──────────────────────────────────────

documents.onDidChangeContent((change) => {
  const format = detectFormat(change.document.uri);
  const parsed = documentManager.update(
    change.document.uri,
    change.document.version,
    change.document.getText(),
    format,
  );
  void connection.sendDiagnostics({
    uri: parsed.uri,
    diagnostics: toDiagnostics(parsed.errors),
  });

  // Update workspace index from the already-parsed document
  workspaceIndex.updateFromParsedDocument(parsed);
});

documents.onDidClose((event) => {
  documentManager.remove(event.document.uri);
  void connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// ── File watcher ────────────────────────────────────────────

connection.onDidChangeWatchedFiles((params) => {
  for (const change of params.changes) {
    const uri = change.uri;

    // Skip files that are currently open (handled by onDidChangeContent)
    if (documentManager.get(uri)) continue;

    switch (change.type) {
      case FileChangeType.Created:
      case FileChangeType.Changed: {
        try {
          const filePath = fileURLToPath(uri);
          const text = fs.readFileSync(filePath, 'utf-8');
          workspaceIndex.indexFileFromDisk(uri, text);
        } catch {
          // File may have been deleted between notification and read
        }
        break;
      }
      case FileChangeType.Deleted: {
        workspaceIndex.removeFile(uri);
        break;
      }
    }
  }
});

// ── Completion ──────────────────────────────────────────────

connection.onCompletion((params) => {
  const doc = documentManager.get(params.textDocument.uri);
  if (!doc) return [];

  // Find the region at the cursor position
  const region = documentManager.findRegionAt(doc, params.position.line);
  if (!region) return []; // Cursor is in Topaz command area

  return getCompletions(doc, params.position, region);
});

// ── Hover ───────────────────────────────────────────────────

connection.onHover((params) => {
  const doc = documentManager.get(params.textDocument.uri);
  if (!doc) return null;

  const region = documentManager.findRegionAt(doc, params.position.line);
  if (!region) return null;

  return getHover(doc, params.position, region);
});

// ── Go to Definition ────────────────────────────────────────

connection.onDefinition((params) => {
  const doc = documentManager.get(params.textDocument.uri);
  if (!doc) return null;

  const region = documentManager.findRegionAt(doc, params.position.line);
  if (!region) return null;

  // Try local variable definition first
  const localDef = getDefinition(doc, params.position, region);
  if (localDef) return localDef;

  // Fall through to workspace-wide implementor lookup
  return getWorkspaceDefinition(doc, params.position, region, workspaceIndex);
});

// ── Find References (Senders) ───────────────────────────────

connection.onReferences((params) => {
  const doc = documentManager.get(params.textDocument.uri);
  if (!doc) return null;

  const region = documentManager.findRegionAt(doc, params.position.line);
  if (!region) return null;

  return getWorkspaceReferences(doc, params.position, region, workspaceIndex);
});

// ── Document Symbols ────────────────────────────────────────

connection.onDocumentSymbol((params) => {
  const doc = documentManager.get(params.textDocument.uri);
  if (!doc) return [];

  const allSymbols: DocumentSymbol[] = [];
  for (const pr of doc.parsedRegions) {
    if (pr.ast && pr.region.kind !== 'smalltalk-code') {
      const symbols = getDocumentSymbols(pr.ast, pr.region);
      allSymbols.push(...symbols);
    }
  }
  return allSymbols;
});

// ── Workspace Symbols ───────────────────────────────────────

connection.onWorkspaceSymbol((params) => {
  const query = params.query;
  if (!query) return [];

  const methods = workspaceIndex.searchMethods(query);

  return methods.map((method): SymbolInformation => {
    const name = method.className ? `${method.className} >> ${method.selector}` : method.selector;

    return {
      name,
      kind: SymbolKind.Method,
      location: {
        uri: method.uri,
        range: {
          start: { line: method.startLine, character: 0 },
          end: { line: method.endLine, character: 0 },
        },
      },
      containerName: method.className,
    };
  });
});

// ── Folding Ranges ──────────────────────────────────────────

connection.onFoldingRanges((params) => {
  const doc = documentManager.get(params.textDocument.uri);
  if (!doc) return [];
  return getFoldingRanges(doc);
});

// ── Formatting ──────────────────────────────────────────────

connection.onDocumentFormatting((params) => {
  const doc = documentManager.get(params.textDocument.uri);
  if (!doc) return [];

  if (!isFormattableDocument(doc)) return [];

  const settings: FormatterSettings = {
    ...formatterSettings,
    tabSize: params.options.tabSize,
    insertSpaces: params.options.insertSpaces,
  };

  return formatDocument(doc, settings);
});

// ── Semantic Tokens ─────────────────────────────────────────

connection.languages.semanticTokens.on((params) => {
  const doc = documentManager.get(params.textDocument.uri);
  if (!doc) return { data: [] };

  const allTokens: ReturnType<typeof collectSemanticTokens> = [];
  const analyzer = new ScopeAnalyzer();

  for (const pr of doc.parsedRegions) {
    if (!pr.ast) continue;

    const lineOffset = pr.region.startLine - (pr.region.kind === 'smalltalk-code' ? 1 : 0);

    const scopeRoot = analyzer.analyze(pr.ast);
    const regionTokens = collectSemanticTokens(
      pr.ast,
      pr.tokens,
      lineOffset,
      scopeRoot,
      pr.region.selectorColumnOffset ?? 0,
      pr.region.kind !== 'smalltalk-code',
    );
    allTokens.push(...regionTokens);
  }

  return { data: encodeSemanticTokens(allTokens) };
});

// ── Custom: Selector at Position ─────────────────────────

connection.onRequest(
  'gemstone/selectorAtPosition',
  (params: {
    textDocument: { uri: string };
    position: { line: number; character: number };
  }): string | null => {
    const doc = documentManager.get(params.textDocument.uri);
    if (!doc) return null;

    const region = documentManager.findRegionAt(doc, params.position.line);
    if (!region) return null;

    const lineOffset = region.region.startLine - (region.region.kind === 'smalltalk-code' ? 1 : 0);

    return findSelectorAtPosition(region.tokens, region.ast, params.position, lineOffset);
  },
);

// ── Start ───────────────────────────────────────────────────

documents.listen(connection);
connection.listen();
