import { ActiveSession } from './sessionManager';
import { OOP_ILLEGAL, OOP_NIL } from './gciConstants';
import { logError } from './gciLog';
import { runNbCall } from './nbRunner';

import { QueryExecutor } from './queries/types';

// Read-path shared queries.
import { getMethodSource as sharedGetMethodSource } from './queries/getMethodSource';
import { getBaseMethodSource as sharedGetBaseMethodSource } from './queries/getBaseMethodSource';
import { getDictionaryNames as sharedGetDictionaryNames } from './queries/getDictionaryNames';
import { getClassNames as sharedGetClassNames } from './queries/getClassNames';
import {
  ClassCategoryEntry,
  getClassesWithCategory as sharedGetClassesWithCategory,
} from './queries/getClassesWithCategory';
import { getDictionaryClassFileOutOrder as sharedGetDictionaryClassFileOutOrder } from './queries/getDictionaryClassFileOutOrder';
import { getDictionaryEntries as sharedGetDictionaryEntries } from './queries/getDictionaryEntries';
import { getGlobalsForDictionary as sharedGetGlobalsForDictionary } from './queries/getGlobalsForDictionary';
import { getMethodCategories as sharedGetMethodCategories } from './queries/getMethodCategories';
import { getClassEnvironments as sharedGetClassEnvironments } from './queries/getClassEnvironments';
import { getClassDefinition as sharedGetClassDefinition } from './queries/getClassDefinition';
import { getClassComment as sharedGetClassComment } from './queries/getClassComment';
import { canClassBeWritten as sharedCanClassBeWritten } from './queries/canClassBeWritten';
import { getAllClassNames as sharedGetAllClassNames } from './queries/getAllClassNames';
import { getClassHierarchy as sharedGetClassHierarchy } from './queries/getClassHierarchy';
import { fileOutClass as sharedFileOutClass } from './queries/fileOutClass';
import { describeClass as sharedDescribeClass } from './queries/describeClass';
import { getInstVarNames as sharedGetInstVarNames } from './queries/getInstVarNames';
import { getDefinedInstVarNames as sharedGetDefinedInstVarNames } from './queries/getDefinedInstVarNames';
import { getDefinedInstVarCounts as sharedGetDefinedInstVarCounts } from './queries/getDefinedInstVarCounts';
import { getDefinedClassVarNames as sharedGetDefinedClassVarNames } from './refactoring/queries/getDefinedClassVarNames';
import { getVisibleClassVarNames as sharedGetVisibleClassVarNames } from './refactoring/queries/getVisibleClassVarNames';
import { getDefinedClassVarCounts as sharedGetDefinedClassVarCounts } from './refactoring/queries/getDefinedClassVarCounts';
import {
  getClassVersions as sharedGetClassVersions,
  ClassVersionInfo,
} from './refactoring/queries/getClassVersions';
import {
  startRenameInstVarPreview as sharedStartRenameInstVarPreview,
  applyRenameInstVar as sharedApplyRenameInstVar,
  clearRenameInstVarPreview as sharedClearRenameInstVarPreview,
} from './refactoring/queries/previewRenameInstVar';
import {
  startRenameMethodPreview as sharedStartRenameMethodPreview,
  pageRenameMethodPreview as sharedPageRenameMethodPreview,
  applyRenameMethod as sharedApplyRenameMethod,
  clearRenameMethodPreview as sharedClearRenameMethodPreview,
  RenameMethodScope,
} from './refactoring/queries/previewRenameMethod';
import {
  analyzeChangeSignature as sharedAnalyzeChangeSignature,
  startChangeSignaturePreview as sharedStartChangeSignaturePreview,
  pageChangeSignaturePreview as sharedPageChangeSignaturePreview,
  applyChangeSignature as sharedApplyChangeSignature,
  clearChangeSignaturePreview as sharedClearChangeSignaturePreview,
  ChangeSignatureScope,
} from './refactoring/queries/previewChangeSignature';
import {
  analyzePushMethod as sharedAnalyzePushMethod,
  startPushMethodPreview as sharedStartPushMethodPreview,
  pagePushMethodPreview as sharedPagePushMethodPreview,
  applyPushMethod as sharedApplyPushMethod,
  clearPushMethodPreview as sharedClearPushMethodPreview,
  PushDirection,
} from './refactoring/queries/previewPushMethod';
import {
  startRenameClassPreview as sharedStartRenameClassPreview,
  pageRenameClassPreview as sharedPageRenameClassPreview,
  applyRenameClass as sharedApplyRenameClass,
  clearRenameClassPreview as sharedClearRenameClassPreview,
  RenameClassScope,
  RenameClassOptions,
} from './refactoring/queries/previewRenameClass';
import {
  startRenameClassVarPreview as sharedStartRenameClassVarPreview,
  pageRenameClassVarPreview as sharedPageRenameClassVarPreview,
  applyRenameClassVar as sharedApplyRenameClassVar,
  clearRenameClassVarPreview as sharedClearRenameClassVarPreview,
} from './refactoring/queries/previewRenameClassVar';
import {
  startRenameTemporaryPreview as sharedStartRenameTemporaryPreview,
  pageRenameTemporaryPreview as sharedPageRenameTemporaryPreview,
  applyRenameTemporary as sharedApplyRenameTemporary,
  clearRenameTemporaryPreview as sharedClearRenameTemporaryPreview,
  renameTemporaryDeclineReason as sharedRenameTemporaryDeclineReason,
} from './refactoring/queries/previewRenameTemporary';
import {
  analyzeExtractSelection as sharedAnalyzeExtractSelection,
  startExtractMethodPreview as sharedStartExtractMethodPreview,
  pageExtractMethodPreview as sharedPageExtractMethodPreview,
  applyExtractMethod as sharedApplyExtractMethod,
  clearExtractMethodPreview as sharedClearExtractMethodPreview,
} from './refactoring/queries/previewExtractMethod';
import {
  analyzeInlineSend as sharedAnalyzeInlineSend,
  startInlineMethodPreview as sharedStartInlineMethodPreview,
  pageInlineMethodPreview as sharedPageInlineMethodPreview,
  applyInlineMethod as sharedApplyInlineMethod,
  clearInlineMethodPreview as sharedClearInlineMethodPreview,
} from './refactoring/queries/previewInlineMethod';
import {
  analyzeMoveMethod as sharedAnalyzeMoveMethod,
  startMoveMethodPreview as sharedStartMoveMethodPreview,
  pageMoveMethodPreview as sharedPageMoveMethodPreview,
  applyMoveMethod as sharedApplyMoveMethod,
  clearMoveMethodPreview as sharedClearMoveMethodPreview,
} from './refactoring/queries/previewMoveMethod';
import {
  InstVarOp,
  analyzeInstVar as sharedAnalyzeInstVar,
  startInstVarPreview as sharedStartInstVarPreview,
  pageInstVarPreview as sharedPageInstVarPreview,
  applyInstVar as sharedApplyInstVar,
  clearInstVarPreview as sharedClearInstVarPreview,
} from './refactoring/queries/previewInstVar';
import {
  analyzeExtractTemporary as sharedAnalyzeExtractTemporary,
  startExtractTemporaryPreview as sharedStartExtractTemporaryPreview,
  pageExtractTemporaryPreview as sharedPageExtractTemporaryPreview,
  applyExtractTemporary as sharedApplyExtractTemporary,
  clearExtractTemporaryPreview as sharedClearExtractTemporaryPreview,
} from './refactoring/queries/previewExtractTemporary';
import {
  analyzeInlineTemporary as sharedAnalyzeInlineTemporary,
  startInlineTemporaryPreview as sharedStartInlineTemporaryPreview,
  pageInlineTemporaryPreview as sharedPageInlineTemporaryPreview,
  applyInlineTemporary as sharedApplyInlineTemporary,
  clearInlineTemporaryPreview as sharedClearInlineTemporaryPreview,
} from './refactoring/queries/previewInlineTemporary';
import {
  analyzeInstVarStructure as sharedAnalyzeInstVarStructure,
  startInstVarStructurePreview as sharedStartInstVarStructurePreview,
  pageInstVarStructurePreview as sharedPageInstVarStructurePreview,
  applyInstVarStructure as sharedApplyInstVarStructure,
  clearInstVarStructurePreview as sharedClearInstVarStructurePreview,
  IvarStructureOp,
  ConvertTempArgs,
  MoveArgs,
} from './refactoring/queries/previewInstVarStructure';
import {
  getClassDescendantNames as sharedGetClassDescendantNames,
  DescendantClass,
} from './refactoring/queries/getClassDescendantNames';
import { getSiblingClassNames as sharedGetSiblingClassNames } from './refactoring/queries/getSiblingClassNames';
import {
  analyzeExtractSuperclass as sharedAnalyzeExtractSuperclass,
  candidatesForExtractSuperclass as sharedCandidatesForExtractSuperclass,
  startExtractSuperclassPreview as sharedStartExtractSuperclassPreview,
  pageExtractSuperclassPreview as sharedPageExtractSuperclassPreview,
  applyExtractSuperclass as sharedApplyExtractSuperclass,
  clearExtractSuperclassPreview as sharedClearExtractSuperclassPreview,
  HoistSets,
} from './refactoring/queries/previewExtractSuperclass';
import {
  getClassHistory as sharedGetClassHistory,
  revertClassToVersion as sharedRevertClassToVersion,
  removeClassVersion as sharedRemoveClassVersion,
} from './refactoring/queries/classHistory';
import { globalNameInUse as sharedGlobalNameInUse } from './refactoring/queries/globalNameInUse';
import { isKernelClass as sharedIsKernelClass } from './refactoring/queries/isKernelClass';
import {
  getGrailStubReflection as sharedGetGrailStubReflection,
  GrailStubReflection,
} from './queries/grailStubReflection';
import { getAllSelectors as sharedGetAllSelectors } from './queries/getAllSelectors';
import { getMethodList as sharedGetMethodList } from './queries/getMethodList';
import { getSourceOffsets as sharedGetSourceOffsets } from './queries/getSourceOffsets';
import { getStepPointSelectorRanges as sharedGetStepPointSelectorRanges } from './queries/getStepPointSelectorRanges';
import { listRowanProjects as sharedListRowanProjects } from './queries/rowan/listRowanProjects';
import { getGemCacheKB as sharedGetGemCacheKB } from './queries/rowan/getGemCacheKB';
import { exportRowanProject as sharedExportRowanProject } from './queries/rowan/exportRowanProject';
import { findRowanClassOwners as sharedFindRowanClassOwners } from './queries/rowan/findRowanClassOwners';
import { listAllRowanClasses as sharedListAllRowanClasses } from './queries/rowan/listAllRowanClasses';
import {
  buildLoadRowanProjectCode,
  parseRowanLoadResult,
  RowanLoadResult,
} from './queries/rowan/loadRowanProject';
import { diffRowanProject as sharedDiffRowanProject } from './queries/rowan/diffRowanProject';
import { unloadRowanProject as sharedUnloadRowanProject } from './queries/rowan/unloadRowanProject';
import {
  canForkGem as sharedCanForkGem,
  forkGemRunning as sharedForkGemRunning,
} from './queries/forkGem';
import { gemNrsFor } from './loginTypes';
import {
  hierarchyImplementorsOf as sharedHierarchyImplementorsOf,
  implementorsOf as sharedImplementorsOf,
  referencesToObject as sharedReferencesToObject,
  searchMethodSource as sharedSearchMethodSource,
  sendersOf as sharedSendersOf,
} from './queries/methodSearch';

// Write-path shared queries.
import { compileMethod as sharedCompileMethod } from './queries/compileMethod';
import { compileClassDefinition as sharedCompileClassDefinition } from './queries/compileClassDefinition';
import { setClassComment as sharedSetClassComment } from './queries/setClassComment';
import { deleteMethod as sharedDeleteMethod } from './queries/deleteMethod';
import { recategorizeMethod as sharedRecategorizeMethod } from './queries/recategorizeMethod';
import { recategorizeClass as sharedRecategorizeClass } from './queries/recategorizeClass';
import { copyMethodToClass as sharedCopyMethodToClass } from './queries/copyMethodToClass';
import { renameCategory as sharedRenameCategory } from './queries/renameCategory';
import { deleteClass as sharedDeleteClass } from './queries/deleteClass';
import { moveClass as sharedMoveClass } from './queries/moveClass';
import { addDictionary as sharedAddDictionary } from './queries/addDictionary';
import { removeDictionary as sharedRemoveDictionary } from './queries/removeDictionary';
import { moveDictionaryUp as sharedMoveDictionaryUp } from './queries/moveDictionaryUp';
import { moveDictionaryDown as sharedMoveDictionaryDown } from './queries/moveDictionaryDown';
import { setBreakAtStepPoint as sharedSetBreakAtStepPoint } from './queries/setBreakAtStepPoint';
import { clearBreakAtStepPoint as sharedClearBreakAtStepPoint } from './queries/clearBreakAtStepPoint';
import { clearAllBreaks as sharedClearAllBreaks } from './queries/clearAllBreaks';

// Re-export shared types so existing callers (extension.ts, systemBrowser.ts, etc.)
// can continue to import them from './browserQueries'.
export type { DictEntry } from './queries/getDictionaryEntries';
export type { GlobalEntry } from './queries/getGlobalsForDictionary';
export type { ClassNameEntry } from './queries/getAllClassNames';
export type { ClassCategoryEntry } from './queries/getClassesWithCategory';
export type { EnvCategoryLine } from './queries/getClassEnvironments';
export type { ClassHierarchyEntry } from './queries/getClassHierarchy';
export type { DescendantClass } from './refactoring/queries/getClassDescendantNames';
export type { MoveArgs } from './refactoring/queries/previewInstVarStructure';
export type { MethodEntry } from './queries/getMethodList';
export type { StepPointSelectorInfo } from './queries/getStepPointSelectorRanges';
export type { MethodSearchResult } from './queries/methodSearch';
export type { RowanProject, RowanProjectList } from './queries/rowan/listRowanProjects';
export type { RowanExportResult } from './queries/rowan/exportRowanProject';
export type { RowanClassOwner, RowanClassOwners } from './queries/rowan/findRowanClassOwners';
export type { RowanClassLocation } from './queries/rowan/listAllRowanClasses';
export type { RowanLoadResult } from './queries/rowan/loadRowanProject';
export type { RowanDiff, RowanDiffOp } from './queries/rowan/diffRowanProject';
export { formatRowanDiff } from './queries/rowan/diffRowanProject';
export type { RowanUnloadResult } from './queries/rowan/unloadRowanProject';
export type {
  RenameClassScope,
  RenameClassOptions,
} from './refactoring/queries/previewRenameClass';
export type { ClassVersionInfo } from './refactoring/queries/getClassVersions';

const MAX_RESULT = 256 * 1024;

export class BrowserQueryError extends Error {
  constructor(
    message: string,
    public readonly gciErrorNumber: number = 0,
  ) {
    super(message);
  }
}

function resolveClassUtf8(session: ActiveSession): bigint {
  return session.gci.utf8ClassOop(session.handle);
}

// Evaluates `code` and fetches its result as a UTF-8 string via
// GciLibrary.executeAndFetchString, which explicitly encodes the evaluated
// result as UTF-8 in Smalltalk before paging it out, so results decode
// correctly regardless of their original encoding and are not capped at a
// single fixed-size buffer.
export function executeFetchString(session: ActiveSession, code: string): string {
  // Check if session is busy with an async operation (e.g., Display It)
  const { result: inProgress } = session.gci.GciTsCallInProgress(session.handle);
  if (inProgress !== 0) {
    const msg = 'Session is busy with another operation. Please wait or use a different session.';
    logError(session.id, msg);
    throw new BrowserQueryError(msg);
  }

  try {
    return session.gci.executeAndFetchString(session.handle, code);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError(session.id, msg);
    throw new BrowserQueryError(msg);
  }
}

// Non-blocking variant of executeFetchString for LONG-RUNNING queries (e.g. a
// Rowan project load, which can take minutes). The synchronous GCI call would
// freeze the whole extension host for the duration; this one starts the
// execution with GciTsNbExecute and polls via the shared nb runner, which keeps
// VS Code responsive and, past ~2s, shows a cancellable progress notification
// (soft break on first Cancel, hard break on second — see nbRunner). The result
// must be a String, fetched verbatim (no printString quoting) for parity with
// executeFetchString.
export async function executeFetchStringNb(
  session: ActiveSession,
  label: string,
  code: string,
  progressTitle?: string,
  suppressNotification = false,
): Promise<string> {
  const { result: inProgress } = session.gci.GciTsCallInProgress(session.handle);
  if (inProgress !== 0) {
    const msg = 'Session is busy with another operation. Please wait or use a different session.';
    logError(session.id, msg);
    throw new BrowserQueryError(msg);
  }

  const oopClassUtf8 = resolveClassUtf8(session);

  const data = await runNbCall(
    session,
    () =>
      session.gci.GciTsNbExecute(session.handle, code, oopClassUtf8, OOP_ILLEGAL, OOP_NIL, 0, 0),
    () => {
      const { result: resultOop, err } = session.gci.GciTsNbResult(session.handle);
      if (err.number !== 0) {
        const msg = err.message || `GCI error ${err.number}`;
        logError(session.id, msg);
        throw new BrowserQueryError(msg, err.number);
      }
      const fetched = session.gci.GciTsFetchChars(session.handle, resultOop, 1n, MAX_RESULT);
      if (fetched.err.number !== 0) {
        const msg = fetched.err.message || `GCI error ${fetched.err.number}`;
        logError(session.id, msg);
        throw new BrowserQueryError(msg, fetched.err.number);
      }
      return fetched.data;
    },
    { title: progressTitle ?? `GemStone: ${label}…`, suppressNotification },
  );

  return data;
}

// Like executeFetchString but with a caller-chosen result-buffer size instead
// of executeAndFetchString's own paging. The class-sync transport (see
// client/src/sync/) moves multi-MB chunks well above the 256 KB size used
// elsewhere in this file, slicing on code-point boundaries so the UTF-8
// decode here is always lossless. Result data is not logged — chunks can be
// megabytes.
export function executeFetchStringWithLimit(
  session: ActiveSession,
  label: string,
  code: string,
  maxBytes: number,
): string {
  const { result: inProgress } = session.gci.GciTsCallInProgress(session.handle);
  if (inProgress !== 0) {
    const msg = 'Session is busy with another operation. Please wait or use a different session.';
    logError(session.id, msg);
    throw new BrowserQueryError(msg);
  }

  const oopClassUtf8 = resolveClassUtf8(session);

  const { data, err } = session.gci.GciTsExecuteFetchBytes(
    session.handle,
    code,
    -1,
    oopClassUtf8,
    OOP_ILLEGAL,
    OOP_NIL,
    maxBytes,
  );

  if (err.number !== 0) {
    const msg = err.message || `GCI error ${err.number}`;
    logError(session.id, msg);
    throw new BrowserQueryError(msg, err.number);
  }
  return data;
}

// A LimitExecutor bound to a session, for the sync transport.
export function boundLimitExecutor(session: ActiveSession) {
  return (label: string, code: string, maxBytes: number) =>
    executeFetchStringWithLimit(session, label, code, maxBytes);
}

export function checkEnhancedInspectorAvailable(session: ActiveSession): boolean {
  try {
    const result = executeFetchString(
      session,
      "[GtRemotePhlowViewedObject notNil printString] on: Error do: [:e | 'false']",
    );
    return result.trim() === 'true';
  } catch {
    return false;
  }
}

/** Whether the server-side refactoring engine is loaded in this session's stone.
 *  Probes for the rename-instance-variable refactoring class, the entry point the
 *  Explorer's rename command drives. The engine ships as an optional, separately-
 *  installed payload, so the class name is looked up through the symbol list rather
 *  than referenced directly.
 *
 *  The lookup passes the class name as a STRING, not a `#symbol` literal: an
 *  uninterned symbol literal forces symbol creation when the expression is
 *  compiled, which throws (error 2391) on a stone whose symbol-creation gem is
 *  down — so a `#symbol` probe would blow up on exactly the bare stones this is
 *  meant to report `false` for. A String literal never creates a symbol, and
 *  `objectNamed:` resolves it against existing symbols only. */
export function checkRefactoringSupportAvailable(session: ActiveSession): boolean {
  try {
    const result = executeFetchString(
      session,
      "(System myUserProfile symbolList objectNamed: 'GsRenameInstanceVariableRefactoring') notNil printString",
    );
    return result.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Tri-state probe of whether the session's transaction holds uncommitted changes
 * that an abort or logout would discard: `true` = pending work, `false` = clean,
 * `undefined` = couldn't tell (session busy, unreachable, or an unrecognized reply).
 *
 * Callers must treat `undefined` like `true` — prompt rather than silently
 * discard — since a failed probe is not evidence that the transaction is clean.
 */
export function sessionNeedsCommit(session: ActiveSession): boolean | undefined {
  try {
    const result = executeFetchString(session, 'System needsCommit printString').trim();
    if (result === 'true') return true;
    if (result === 'false') return false;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Binds a session to the {@link QueryExecutor} shape shared queries expect,
 * backed by {@link executeFetchString}. This is the shared entry point used
 * across browserQueries, pythonQueries, and sunitQueries.
 *
 * @param activeSession - The active GCI session to execute against.
 * @returns A {@link QueryExecutor} that runs `code` in `session` and returns
 * its String result.
 * @throws {@link BrowserQueryError} if the session is busy, the code fails to
 * compile or execute, or the result cannot be resolved to a String.
 */
export function defaultQueryExecutorUsing(activeSession: ActiveSession): QueryExecutor {
  return (code) => executeFetchString(activeSession, code);
}

// ── Read-only queries (thin delegates to client/src/queries/) ─────────────

export function getDictionaryNames(session: ActiveSession): string[] {
  return sharedGetDictionaryNames(defaultQueryExecutorUsing(session));
}

// ── Rowan browser queries ─────────────────────────────────────────────────

export function getGemCacheKB(session: ActiveSession) {
  return sharedGetGemCacheKB(defaultQueryExecutorUsing(session));
}

export function listRowanProjects(session: ActiveSession) {
  return sharedListRowanProjects(defaultQueryExecutorUsing(session));
}

export function exportRowanProject(session: ActiveSession, projectName: string, targetDir: string) {
  return sharedExportRowanProject(defaultQueryExecutorUsing(session), projectName, targetDir);
}

export function findRowanClassOwners(session: ActiveSession, className: string) {
  return sharedFindRowanClassOwners(defaultQueryExecutorUsing(session), className);
}

export function listAllRowanClasses(session: ActiveSession) {
  return sharedListAllRowanClasses(defaultQueryExecutorUsing(session));
}

// Non-blocking load for the extension: same Smalltalk, run via
// executeFetchStringNb so a minutes-long load doesn't freeze the extension host
// and the user gets a cancellable progress notification.
export async function loadRowanProjectNb(
  session: ActiveSession,
  specPath: string,
  diskPath: string,
  progressTitle: string,
): Promise<RowanLoadResult> {
  const raw = await executeFetchStringNb(
    session,
    `loadRowanProject(${specPath})`,
    buildLoadRowanProjectCode(specPath, diskPath),
    progressTitle,
  );
  return parseRowanLoadResult(raw);
}

export function diffRowanProject(session: ActiveSession, projectName: string) {
  return sharedDiffRowanProject(defaultQueryExecutorUsing(session), projectName);
}

export function unloadRowanProject(session: ActiveSession, projectName: string) {
  return sharedUnloadRowanProject(defaultQueryExecutorUsing(session), projectName);
}

/**
 * Run `expression` in a gem of its own, as this session's user, and answer the
 * new gem's stone session id. The NetLDI comes from the session's own login —
 * GemStone's default name is wrong for most stones.
 */
/** Whether this stone's version can fork a gem at all (3.6.2 cannot). */
export function canForkGem(session: ActiveSession) {
  return sharedCanForkGem(defaultQueryExecutorUsing(session));
}

export function forkGemRunning(session: ActiveSession, expression: string) {
  return sharedForkGemRunning(
    defaultQueryExecutorUsing(session),
    expression,
    gemNrsFor(session.login),
  );
}

export function getClassNames(session: ActiveSession, dict: number | string): string[] {
  return sharedGetClassNames(defaultQueryExecutorUsing(session), dict);
}

export function getClassesWithCategory(
  session: ActiveSession,
  dict: number | string,
): ClassCategoryEntry[] {
  return sharedGetClassesWithCategory(defaultQueryExecutorUsing(session), dict);
}

export function getDictionaryClassFileOutOrder(
  session: ActiveSession,
  dict: number | string,
): string[] {
  return sharedGetDictionaryClassFileOutOrder(defaultQueryExecutorUsing(session), dict);
}

export function getDictionaryEntries(session: ActiveSession, dict: number | string) {
  return sharedGetDictionaryEntries(defaultQueryExecutorUsing(session), dict);
}

export function getGlobalsForDictionary(session: ActiveSession, dictIndex: number) {
  return sharedGetGlobalsForDictionary(defaultQueryExecutorUsing(session), dictIndex);
}

export function getMethodCategories(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  dict?: number | string,
): string[] {
  return sharedGetMethodCategories(defaultQueryExecutorUsing(session), className, isMeta, dict);
}

export function getClassEnvironments(
  session: ActiveSession,
  dictIndex: number,
  className: string,
  maxEnv: number,
) {
  return sharedGetClassEnvironments(
    defaultQueryExecutorUsing(session),
    dictIndex,
    className,
    maxEnv,
  );
}

export function getMethodSource(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedGetMethodSource(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    environmentId,
    dict,
  );
}

export function getBaseMethodSource(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedGetBaseMethodSource(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    environmentId,
    dict,
  );
}

export function getClassDefinition(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string {
  return sharedGetClassDefinition(defaultQueryExecutorUsing(session), className, dict);
}

export function getClassComment(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string {
  return sharedGetClassComment(defaultQueryExecutorUsing(session), className, dict);
}

export function canClassBeWritten(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): boolean {
  return sharedCanClassBeWritten(defaultQueryExecutorUsing(session), className, dict);
}

export function getAllClassNames(session: ActiveSession) {
  return sharedGetAllClassNames(defaultQueryExecutorUsing(session));
}

export function getClassHierarchy(
  session: ActiveSession,
  className: string,
  dict?: number | string,
) {
  return sharedGetClassHierarchy(defaultQueryExecutorUsing(session), className, dict);
}

export function getClassDescendantNames(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): DescendantClass[] {
  return sharedGetClassDescendantNames(defaultQueryExecutorUsing(session), className, dict);
}

export function getSiblingClassNames(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string[] {
  return sharedGetSiblingClassNames(defaultQueryExecutorUsing(session), className, dict);
}

export function fileOutClass(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string {
  return sharedFileOutClass(defaultQueryExecutorUsing(session), className, dict);
}

export function describeClass(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string {
  return sharedDescribeClass(defaultQueryExecutorUsing(session), className, dict);
}

export function getInstVarNames(session: ActiveSession, className: string): string[] {
  return sharedGetInstVarNames(defaultQueryExecutorUsing(session), className);
}

export function getDefinedInstVarNames(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string[] {
  return sharedGetDefinedInstVarNames(defaultQueryExecutorUsing(session), className, dict);
}

export function getDefinedInstVarCounts(
  session: ActiveSession,
  dict: number | string,
): Map<string, number> {
  return sharedGetDefinedInstVarCounts(defaultQueryExecutorUsing(session), dict);
}

export function getDefinedClassVarNames(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string[] {
  return sharedGetDefinedClassVarNames(defaultQueryExecutorUsing(session), className, dict);
}

export function getVisibleClassVarNames(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): string[] {
  return sharedGetVisibleClassVarNames(defaultQueryExecutorUsing(session), className, dict);
}

export function getDefinedClassVarCounts(
  session: ActiveSession,
  dict: number | string,
): Map<string, number> {
  return sharedGetDefinedClassVarCounts(defaultQueryExecutorUsing(session), dict);
}

export function getClassVersions(
  session: ActiveSession,
  dict: number | string,
): Map<string, ClassVersionInfo> {
  return sharedGetClassVersions(defaultQueryExecutorUsing(session), dict);
}

export function startRenameInstVarPreview(
  session: ActiveSession,
  className: string,
  oldName: string,
  newName: string,
  token: string,
  dict?: number | string,
): string {
  return sharedStartRenameInstVarPreview(
    defaultQueryExecutorUsing(session),
    className,
    oldName,
    newName,
    token,
    dict,
  );
}

export function applyRenameInstVar(
  session: ActiveSession,
  token: string,
  deselectedIds: string[],
): string {
  return sharedApplyRenameInstVar(defaultQueryExecutorUsing(session), token, deselectedIds);
}

export function clearRenameInstVarPreview(session: ActiveSession, token: string): string {
  return sharedClearRenameInstVarPreview(defaultQueryExecutorUsing(session), token);
}

// Paginated rename-method preview: fetched NON-BLOCKING so a slow build shows a
// progress notification and keeps the extension host responsive. Pages are
// byte-bounded (PREVIEW_PAGE_BYTES) to stay under the non-blocking fetch cap.
export function startRenameMethodPreview(
  session: ActiveSession,
  className: string,
  oldSelector: string,
  newParts: string[],
  permutation: number[],
  scope: RenameMethodScope,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, `Previewing rename of ${oldSelector}…`);
  return sharedStartRenameMethodPreview(
    exec,
    className,
    oldSelector,
    newParts,
    permutation,
    scope,
    token,
    maxBytes,
    dict,
  );
}

export function pageRenameMethodPreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageRenameMethodPreview(exec, token, offset, maxBytes);
}

export function applyRenameMethod(
  session: ActiveSession,
  token: string,
  deselectedIds: string[],
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying rename…');
  return sharedApplyRenameMethod(exec, token, deselectedIds);
}

export function clearRenameMethodPreview(session: ActiveSession, token: string): string {
  return sharedClearRenameMethodPreview(defaultQueryExecutorUsing(session), token);
}

// Change-method-signature (M5) wrappers: mirror the rename-method ones, adding a
// pre-flight analyze (to pre-populate the signature editor) and the arity-changing
// argNames/defaults/meta arguments. Paginated preview fetched NON-BLOCKING; apply is
// server-side (no commit).
export function analyzeChangeSignature(
  session: ActiveSession,
  className: string,
  selector: string,
  isMeta: boolean,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Analysing signature…');
  return sharedAnalyzeChangeSignature(exec, className, selector, isMeta, dict);
}

export function startChangeSignaturePreview(
  session: ActiveSession,
  className: string,
  oldSelector: string,
  newParts: string[],
  permutation: number[],
  argNames: string[],
  defaults: string[],
  scope: ChangeSignatureScope,
  token: string,
  maxBytes: number,
  isMeta: boolean,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, `Previewing signature change of ${oldSelector}…`);
  return sharedStartChangeSignaturePreview(
    exec,
    className,
    oldSelector,
    newParts,
    permutation,
    argNames,
    defaults,
    scope,
    token,
    maxBytes,
    isMeta,
    dict,
  );
}

export function pageChangeSignaturePreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageChangeSignaturePreview(exec, token, offset, maxBytes);
}

export function applyChangeSignature(
  session: ActiveSession,
  token: string,
  deselectedIds: string[],
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying signature change…');
  return sharedApplyChangeSignature(exec, token, deselectedIds);
}

export function clearChangeSignaturePreview(session: ActiveSession, token: string): string {
  return sharedClearChangeSignaturePreview(defaultQueryExecutorUsing(session), token);
}

// Push-up / push-down method (M7 / M8) wrappers: mirror the move-method shape but with
// the target(s) resolved server-side (the superclass, or the immediate subclasses).
// Paginated preview fetched NON-BLOCKING; apply is server-side (no commit).
export function analyzePushMethod(
  session: ActiveSession,
  direction: PushDirection,
  sourceClass: string,
  selectors: string[],
  isMeta: boolean,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Analysing push…');
  return sharedAnalyzePushMethod(exec, direction, sourceClass, selectors, isMeta, dict);
}

export function startPushMethodPreview(
  session: ActiveSession,
  direction: PushDirection,
  sourceClass: string,
  selectors: string[],
  isMeta: boolean,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, `Previewing push of ${sourceClass}…`);
  return sharedStartPushMethodPreview(
    exec,
    direction,
    sourceClass,
    selectors,
    isMeta,
    token,
    maxBytes,
    dict,
  );
}

export function pagePushMethodPreview(
  session: ActiveSession,
  direction: PushDirection,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPagePushMethodPreview(exec, direction, token, offset, maxBytes);
}

export function applyPushMethod(
  session: ActiveSession,
  direction: PushDirection,
  token: string,
  deselectedIds: string[],
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying push…');
  return sharedApplyPushMethod(exec, direction, token, deselectedIds);
}

export function clearPushMethodPreview(
  session: ActiveSession,
  direction: PushDirection,
  token: string,
): string {
  return sharedClearPushMethodPreview(defaultQueryExecutorUsing(session), direction, token);
}

// Paginated rename-class preview: fetched NON-BLOCKING (progress + responsive),
// byte-bounded pages, server-side apply. Mirrors the rename-method wrappers.
export function startRenameClassPreview(
  session: ActiveSession,
  className: string,
  newName: string,
  scope: RenameClassScope,
  options: RenameClassOptions,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, `Previewing rename of ${className}…`);
  return sharedStartRenameClassPreview(
    exec,
    className,
    newName,
    scope,
    options,
    token,
    maxBytes,
    dict,
  );
}

export function pageRenameClassPreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageRenameClassPreview(exec, token, offset, maxBytes);
}

export function applyRenameClass(
  session: ActiveSession,
  token: string,
  deselectedIds: string[],
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying rename…');
  return sharedApplyRenameClass(exec, token, deselectedIds);
}

export function clearRenameClassPreview(session: ActiveSession, token: string): string {
  return sharedClearRenameClassPreview(defaultQueryExecutorUsing(session), token);
}

// Paginated rename-class-variable preview: fetched NON-BLOCKING (progress +
// responsive), byte-bounded pages, server-side value-preserving apply. Mirrors the
// rename-method/class wrappers; the rename is all-or-nothing, so the apply always
// passes an empty deselected set.
export function startRenameClassVarPreview(
  session: ActiveSession,
  className: string,
  oldName: string,
  newName: string,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, `Previewing rename of ${oldName}…`);
  return sharedStartRenameClassVarPreview(exec, className, oldName, newName, token, maxBytes, dict);
}

export function pageRenameClassVarPreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageRenameClassVarPreview(exec, token, offset, maxBytes);
}

export function applyRenameClassVar(session: ActiveSession, token: string): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying rename…');
  return sharedApplyRenameClassVar(exec, token);
}

export function clearRenameClassVarPreview(session: ActiveSession, token: string): string {
  return sharedClearRenameClassVarPreview(defaultQueryExecutorUsing(session), token);
}

// Paginated rename-temporary/argument (R5) preview: method-local, a single
// methodRecompile change, fetched NON-BLOCKING, server-side apply. All-or-nothing,
// so the apply passes an empty deselected set.
export function startRenameTemporaryPreview(
  session: ActiveSession,
  className: string,
  selector: string,
  isMeta: boolean,
  oldName: string,
  newName: string,
  offset: number,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, `Previewing rename of ${oldName}…`);
  return sharedStartRenameTemporaryPreview(
    exec,
    className,
    selector,
    isMeta,
    oldName,
    newName,
    offset,
    token,
    maxBytes,
    dict,
  );
}

export function pageRenameTemporaryPreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageRenameTemporaryPreview(exec, token, offset, maxBytes);
}

export function applyRenameTemporary(session: ActiveSession, token: string): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying rename…');
  return sharedApplyRenameTemporary(exec, token);
}

export function clearRenameTemporaryPreview(session: ActiveSession, token: string): string {
  return sharedClearRenameTemporaryPreview(defaultQueryExecutorUsing(session), token);
}

export function renameTemporaryDeclineReason(
  session: ActiveSession,
  className: string,
  selector: string,
  isMeta: boolean,
  oldName: string,
  offset: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Checking…');
  return sharedRenameTemporaryDeclineReason(
    exec,
    className,
    selector,
    isMeta,
    oldName,
    offset,
    dict,
  );
}

// Extract-method (M1) preview: pre-flight analysis, paginated start/page fetched
// NON-BLOCKING, server-side apply. The two core changes always apply; the apply
// passes the deselected DUPLICATE ids only.
export function analyzeExtractSelection(
  session: ActiveSession,
  className: string,
  selector: string,
  isMeta: boolean,
  selStart: number,
  selStop: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Analysing selection…');
  return sharedAnalyzeExtractSelection(exec, className, selector, isMeta, selStart, selStop, dict);
}

export function startExtractMethodPreview(
  session: ActiveSession,
  className: string,
  selector: string,
  isMeta: boolean,
  selStart: number,
  selStop: number,
  newSelector: string,
  replaceSimilar: boolean,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, `Previewing extract of ${newSelector}…`);
  return sharedStartExtractMethodPreview(
    exec,
    className,
    selector,
    isMeta,
    selStart,
    selStop,
    newSelector,
    replaceSimilar,
    token,
    maxBytes,
    dict,
  );
}

export function pageExtractMethodPreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageExtractMethodPreview(exec, token, offset, maxBytes);
}

export function applyExtractMethod(
  session: ActiveSession,
  token: string,
  deselectedIds: string[],
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying extraction…');
  return sharedApplyExtractMethod(exec, token, deselectedIds);
}

export function clearExtractMethodPreview(session: ActiveSession, token: string): string {
  return sharedClearExtractMethodPreview(defaultQueryExecutorUsing(session), token);
}

export function analyzeInlineSend(
  session: ActiveSession,
  className: string,
  selector: string,
  isMeta: boolean,
  offset: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Analysing send…');
  return sharedAnalyzeInlineSend(exec, className, selector, isMeta, offset, dict);
}

export function startInlineMethodPreview(
  session: ActiveSession,
  className: string,
  selector: string,
  isMeta: boolean,
  offset: number,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Previewing inline…');
  return sharedStartInlineMethodPreview(
    exec,
    className,
    selector,
    isMeta,
    offset,
    token,
    maxBytes,
    dict,
  );
}

export function pageInlineMethodPreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageInlineMethodPreview(exec, token, offset, maxBytes);
}

export function applyInlineMethod(
  session: ActiveSession,
  token: string,
  deselectedIds: string[],
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying inline…');
  return sharedApplyInlineMethod(exec, token, deselectedIds);
}

export function clearInlineMethodPreview(session: ActiveSession, token: string): string {
  return sharedClearInlineMethodPreview(defaultQueryExecutorUsing(session), token);
}

// Move-method (M6) preview: pre-flight analysis (which selectors move, and why the
// rest can't), paginated start/page fetched NON-BLOCKING, server-side apply. Per
// movable selector a methodAdd (on the target) + a methodRemove (from the source);
// apply passes an empty deselected set (every change is required).
export function analyzeMoveMethod(
  session: ActiveSession,
  sourceClass: string,
  selectors: string[],
  isMeta: boolean,
  targetName: string,
  toMeta: boolean,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Analysing move…');
  return sharedAnalyzeMoveMethod(exec, sourceClass, selectors, isMeta, targetName, toMeta, dict);
}

export function startMoveMethodPreview(
  session: ActiveSession,
  sourceClass: string,
  selectors: string[],
  isMeta: boolean,
  targetName: string,
  toMeta: boolean,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Previewing move…');
  return sharedStartMoveMethodPreview(
    exec,
    sourceClass,
    selectors,
    isMeta,
    targetName,
    toMeta,
    token,
    maxBytes,
    dict,
  );
}

export function pageMoveMethodPreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageMoveMethodPreview(exec, token, offset, maxBytes);
}

export function applyMoveMethod(
  session: ActiveSession,
  token: string,
  deselectedIds: string[],
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying move…');
  return sharedApplyMoveMethod(exec, token, deselectedIds);
}

export function clearMoveMethodPreview(session: ActiveSession, token: string): string {
  return sharedClearMoveMethodPreview(defaultQueryExecutorUsing(session), token);
}

// Add / remove instance-variable (V1) preview: pre-flight analysis (decline reason,
// affected count, how many methods will not recompile), paginated start/page fetched
// NON-BLOCKING, server-side apply. The structural change never commits; migrate /
// delete-history do (and are opt-in). `options` (or null) replaces the acted-on class's
// class options.
export function analyzeInstVar(
  session: ActiveSession,
  op: InstVarOp,
  className: string,
  ivarName: string,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Analysing…');
  return sharedAnalyzeInstVar(exec, op, className, ivarName, dict);
}

export function startInstVarPreview(
  session: ActiveSession,
  op: InstVarOp,
  className: string,
  ivarName: string,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Previewing…');
  return sharedStartInstVarPreview(exec, op, className, ivarName, token, maxBytes, dict);
}

export function pageInstVarPreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageInstVarPreview(exec, token, offset, maxBytes);
}

export function applyInstVar(
  session: ActiveSession,
  token: string,
  deselectedIds: string[],
  options: string[] | null,
  migrate: boolean,
  deleteHistory: boolean,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying…');
  return sharedApplyInstVar(exec, token, deselectedIds, options, migrate, deleteHistory);
}

export function clearInstVarPreview(session: ActiveSession, token: string): string {
  return sharedClearInstVarPreview(defaultQueryExecutorUsing(session), token);
}

// Extract-temporary (M3) preview: pre-flight analysis, paginated start/page fetched
// NON-BLOCKING, server-side apply. Method-local, a single methodRecompile change,
// all-or-nothing (apply passes an empty deselected set).
export function analyzeExtractTemporary(
  session: ActiveSession,
  className: string,
  selector: string,
  isMeta: boolean,
  selStart: number,
  selStop: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Analysing selection…');
  return sharedAnalyzeExtractTemporary(exec, className, selector, isMeta, selStart, selStop, dict);
}

export function startExtractTemporaryPreview(
  session: ActiveSession,
  className: string,
  selector: string,
  isMeta: boolean,
  selStart: number,
  selStop: number,
  newName: string,
  replaceAll: boolean,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, `Previewing extract of ${newName}…`);
  return sharedStartExtractTemporaryPreview(
    exec,
    className,
    selector,
    isMeta,
    selStart,
    selStop,
    newName,
    replaceAll,
    token,
    maxBytes,
    dict,
  );
}

export function pageExtractTemporaryPreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageExtractTemporaryPreview(exec, token, offset, maxBytes);
}

export function applyExtractTemporary(session: ActiveSession, token: string): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying extraction…');
  return sharedApplyExtractTemporary(exec, token);
}

export function clearExtractTemporaryPreview(session: ActiveSession, token: string): string {
  return sharedClearExtractTemporaryPreview(defaultQueryExecutorUsing(session), token);
}

// Inline-temporary (M4) preview: pre-flight analysis, paginated start/page fetched
// NON-BLOCKING, server-side apply. Method-local, a single methodRecompile change,
// all-or-nothing (apply passes an empty deselected set).
export function analyzeInlineTemporary(
  session: ActiveSession,
  className: string,
  selector: string,
  isMeta: boolean,
  offset: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Analysing temporary…');
  return sharedAnalyzeInlineTemporary(exec, className, selector, isMeta, offset, dict);
}

export function startInlineTemporaryPreview(
  session: ActiveSession,
  className: string,
  selector: string,
  isMeta: boolean,
  offset: number,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Previewing inline…');
  return sharedStartInlineTemporaryPreview(
    exec,
    className,
    selector,
    isMeta,
    offset,
    token,
    maxBytes,
    dict,
  );
}

export function pageInlineTemporaryPreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageInlineTemporaryPreview(exec, token, offset, maxBytes);
}

export function applyInlineTemporary(session: ActiveSession, token: string): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying inline…');
  return sharedApplyInlineTemporary(exec, token);
}

export function clearInlineTemporaryPreview(session: ActiveSession, token: string): string {
  return sharedClearInlineTemporaryPreview(defaultQueryExecutorUsing(session), token);
}

// Instance-variable structure (V2 push up / V3 push down / V5 convert temporary) wrappers.
// One engine parametrized by operation; new class versions are created server-side (no
// commit). Paginated preview fetched NON-BLOCKING.
export function analyzeInstVarStructure(
  session: ActiveSession,
  op: IvarStructureOp,
  className: string,
  varName: string,
  dict?: number | string,
  extra?: ConvertTempArgs,
  moveAccessors = false,
  move?: MoveArgs,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Analysing…');
  return sharedAnalyzeInstVarStructure(
    exec,
    op,
    className,
    varName,
    dict,
    extra,
    moveAccessors,
    move,
  );
}

export function startInstVarStructurePreview(
  session: ActiveSession,
  op: IvarStructureOp,
  className: string,
  varName: string,
  token: string,
  maxBytes: number,
  dict?: number | string,
  extra?: ConvertTempArgs,
  moveAccessors = false,
  move?: MoveArgs,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, `Previewing change to ${className}…`);
  return sharedStartInstVarStructurePreview(
    exec,
    op,
    className,
    varName,
    token,
    maxBytes,
    dict,
    extra,
    moveAccessors,
    move,
  );
}

export function pageInstVarStructurePreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageInstVarStructurePreview(exec, token, offset, maxBytes);
}

export function applyInstVarStructure(
  session: ActiveSession,
  token: string,
  migrateInstances = false,
  removeOldFromHistory = false,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying change…');
  return sharedApplyInstVarStructure(exec, token, migrateInstances, removeOldFromHistory);
}

export function clearInstVarStructurePreview(session: ActiveSession, token: string): string {
  return sharedClearInstVarStructurePreview(defaultQueryExecutorUsing(session), token);
}

// Extract-superclass (V6 insert superclass / V7 extract superclass) wrappers. One engine
// (GsExtractSuperclassRefactoring) drives both; the new superclass is created server-side (no
// commit). Paginated preview fetched NON-BLOCKING.
export function candidatesForExtractSuperclass(
  session: ActiveSession,
  className: string,
  siblings: string[],
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Classifying members…');
  return sharedCandidatesForExtractSuperclass(exec, className, siblings, dict);
}

export function analyzeExtractSuperclass(
  session: ActiveSession,
  className: string,
  newName: string,
  siblings: string[],
  hoist: HoistSets,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Analysing…');
  return sharedAnalyzeExtractSuperclass(exec, className, newName, siblings, hoist, dict);
}

export function startExtractSuperclassPreview(
  session: ActiveSession,
  className: string,
  newName: string,
  siblings: string[],
  hoist: HoistSets,
  token: string,
  maxBytes: number,
  dict?: number | string,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, `Previewing new superclass for ${className}…`);
  return sharedStartExtractSuperclassPreview(
    exec,
    className,
    newName,
    siblings,
    hoist,
    token,
    maxBytes,
    dict,
  );
}

export function pageExtractSuperclassPreview(
  session: ActiveSession,
  token: string,
  offset: number,
  maxBytes: number,
): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Loading more changes…');
  return sharedPageExtractSuperclassPreview(exec, token, offset, maxBytes);
}

export function applyExtractSuperclass(session: ActiveSession, token: string): Promise<string> {
  const exec = (label: string, code: string): Promise<string> =>
    executeFetchStringNb(session, label, code, 'Applying change…');
  return sharedApplyExtractSuperclass(exec, token);
}

export function clearExtractSuperclassPreview(session: ActiveSession, token: string): string {
  return sharedClearExtractSuperclassPreview(defaultQueryExecutorUsing(session), token);
}

// Class-definition history (native classHistory, this-stone-only, read-only) and
// the redo (restore a historical version as a new version, no commit).
export function getClassHistory(session: ActiveSession, className: string): string {
  return sharedGetClassHistory(defaultQueryExecutorUsing(session), className);
}

export function revertClassToVersion(
  session: ActiveSession,
  className: string,
  index: number,
): string {
  return sharedRevertClassToVersion(defaultQueryExecutorUsing(session), className, index);
}

export function globalNameInUse(session: ActiveSession, name: string): boolean {
  return sharedGlobalNameInUse(defaultQueryExecutorUsing(session), name);
}

export function isKernelClass(session: ActiveSession, name: string): boolean {
  return sharedIsKernelClass(defaultQueryExecutorUsing(session), name);
}

export function removeClassVersion(
  session: ActiveSession,
  className: string,
  index: number,
): string {
  return sharedRemoveClassVersion(defaultQueryExecutorUsing(session), className, index);
}

export function getGrailStubReflection(
  session: ActiveSession,
  className: string,
  dict?: number | string,
): GrailStubReflection {
  return sharedGetGrailStubReflection(defaultQueryExecutorUsing(session), className, dict);
}

export function getAllSelectors(session: ActiveSession, className: string): string[] {
  return sharedGetAllSelectors(defaultQueryExecutorUsing(session), className);
}

export function getMethodList(session: ActiveSession, className: string) {
  return sharedGetMethodList(defaultQueryExecutorUsing(session), className);
}

export function getSourceOffsets(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): number[] {
  return sharedGetSourceOffsets(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    environmentId,
    dict,
  );
}

export function getStepPointSelectorRanges(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
) {
  return sharedGetStepPointSelectorRanges(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    environmentId,
    dict,
  );
}

export function searchMethodSource(session: ActiveSession, term: string, ignoreCase: boolean) {
  return sharedSearchMethodSource(defaultQueryExecutorUsing(session), term, ignoreCase);
}

export function sendersOf(session: ActiveSession, selector: string, environmentId: number = 0) {
  return sharedSendersOf(defaultQueryExecutorUsing(session), selector, environmentId);
}

export function implementorsOf(
  session: ActiveSession,
  selector: string,
  environmentId: number = 0,
) {
  return sharedImplementorsOf(defaultQueryExecutorUsing(session), selector, environmentId);
}

export function hierarchyImplementorsOf(
  session: ActiveSession,
  dictIndex: number,
  className: string,
  selector: string,
  isMeta: boolean,
  direction: 'up' | 'down',
  environmentId: number = 0,
) {
  return sharedHierarchyImplementorsOf(
    defaultQueryExecutorUsing(session),
    dictIndex,
    className,
    selector,
    isMeta,
    direction,
    environmentId,
  );
}

export function referencesToObject(
  session: ActiveSession,
  objectName: string,
  environmentId: number = 0,
) {
  return sharedReferencesToObject(defaultQueryExecutorUsing(session), objectName, environmentId);
}

// ── Write-path queries (mutations) ─────────────────────────────────────────
// All of these delegate to the shared layer. None auto-commit.

export function compileClassDefinition(session: ActiveSession, source: string): string {
  return sharedCompileClassDefinition(defaultQueryExecutorUsing(session), source);
}

export function compileMethod(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  category: string,
  source: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedCompileMethod(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    category,
    source,
    environmentId,
    dict,
  );
}

export function setClassComment(
  session: ActiveSession,
  className: string,
  comment: string,
  dict?: number | string,
): string {
  return sharedSetClassComment(defaultQueryExecutorUsing(session), className, comment, dict);
}

export function recategorizeClass(
  session: ActiveSession,
  className: string,
  newCategory: string,
  dict?: number | string,
): string {
  return sharedRecategorizeClass(defaultQueryExecutorUsing(session), className, newCategory, dict);
}

export function copyMethodToClass(
  session: ActiveSession,
  sourceClass: string,
  targetClass: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedCopyMethodToClass(
    defaultQueryExecutorUsing(session),
    sourceClass,
    targetClass,
    isMeta,
    selector,
    environmentId,
    dict,
  );
}

export function deleteMethod(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  dict?: number | string,
): string {
  return sharedDeleteMethod(defaultQueryExecutorUsing(session), className, isMeta, selector, dict);
}

export function recategorizeMethod(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  newCategory: string,
  dict?: number | string,
): string {
  return sharedRecategorizeMethod(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    newCategory,
    dict,
  );
}

export function renameCategory(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  oldCategory: string,
  newCategory: string,
  dict?: number | string,
): string {
  return sharedRenameCategory(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    oldCategory,
    newCategory,
    dict,
  );
}

export function deleteClass(
  session: ActiveSession,
  dict: number | string,
  className: string,
): string {
  return sharedDeleteClass(defaultQueryExecutorUsing(session), dict, className);
}

export function moveClass(
  session: ActiveSession,
  srcDictIndex: number,
  destDictIndex: number,
  className: string,
): string {
  return sharedMoveClass(
    defaultQueryExecutorUsing(session),
    srcDictIndex,
    destDictIndex,
    className,
  );
}

export function addDictionary(session: ActiveSession, dictName: string): string {
  return sharedAddDictionary(defaultQueryExecutorUsing(session), dictName);
}

export function removeDictionary(session: ActiveSession, dict: number | string): string {
  return sharedRemoveDictionary(defaultQueryExecutorUsing(session), dict);
}

export function moveDictionaryUp(session: ActiveSession, dictIndex: number): string {
  return sharedMoveDictionaryUp(defaultQueryExecutorUsing(session), dictIndex);
}

export function moveDictionaryDown(session: ActiveSession, dictIndex: number): string {
  return sharedMoveDictionaryDown(defaultQueryExecutorUsing(session), dictIndex);
}

export function setBreakAtStepPoint(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  stepPoint: number,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedSetBreakAtStepPoint(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    stepPoint,
    environmentId,
    dict,
  );
}

export function clearBreakAtStepPoint(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  stepPoint: number,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedClearBreakAtStepPoint(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    stepPoint,
    environmentId,
    dict,
  );
}

export function clearAllBreaks(
  session: ActiveSession,
  className: string,
  isMeta: boolean,
  selector: string,
  environmentId: number = 0,
  dict?: number | string,
): string {
  return sharedClearAllBreaks(
    defaultQueryExecutorUsing(session),
    className,
    isMeta,
    selector,
    environmentId,
    dict,
  );
}
