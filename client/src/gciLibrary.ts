import koffi from 'koffi';
import * as path from 'path';
import { GCI_LOGIN_QUIET, OOP_FALSE, OOP_ILLEGAL, OOP_NIL, OOP_TRUE } from './gciConstants';
import { GciLibraryError } from './gciLibraryError';
import { escapeString } from './queries/util';
import type { NotPromise } from './syncTypes';

// OopType is uint64_t in C; koffi maps this to BigInt in JS
const OopType = 'uint64';

// GciErrSType struct (from gci.ht / gcicmn.ht)
const GCI_ERR_STR_SIZE = 1024;
const GCI_MAX_ERR_ARGS = 10;

koffi.struct('GciErrSType', {
  category: OopType,
  context: OopType,
  exceptionObj: OopType,
  args: koffi.array(OopType, GCI_MAX_ERR_ARGS),
  number: 'int',
  argCount: 'int',
  fatal: 'uchar',
  message: koffi.array('char', GCI_ERR_STR_SIZE + 1),
  reason: koffi.array('char', GCI_ERR_STR_SIZE + 1),
});

// GciSession is typedef void* in gcits.hf
const GciSessionOpaque = koffi.opaque('GciSession');
koffi.pointer('GciSessionPtr', GciSessionOpaque);

// GciTsObjInfo struct (from gcits.ht)
koffi.struct('GciTsObjInfo', {
  objId: OopType,
  objClass: OopType,
  objSize: 'int64',
  namedSize: 'int',
  access: 'uint',
  objectSecurityPolicyId: 'ushort',
  _bits: 'ushort',
});

// GciTsGbjInfo struct — extends GciTsObjInfo with extraBits and bytesReturned
koffi.struct('GciTsGbjInfo', {
  objId: OopType,
  objClass: OopType,
  objSize: 'int64',
  namedSize: 'int',
  access: 'uint',
  objectSecurityPolicyId: 'ushort',
  _bits: 'ushort',
  extraBits: 'uint64',
  bytesReturned: 'int64',
});

export interface GciObjInfo {
  objId: bigint;
  objClass: bigint;
  objSize: bigint;
  namedSize: number;
  access: number;
  objectSecurityPolicyId: number;
  _bits: number;
}

export interface GciGbjInfo extends GciObjInfo {
  extraBits: bigint;
  bytesReturned: bigint;
}

// GciClampedTravArgsSType — travBuff is an opaque pointer to a raw Buffer
koffi.struct('GciClampedTravArgsSType', {
  clampSpec: OopType,
  resultOop: OopType,
  travBuff: 'void *',
  level: 'int',
  retrievalFlags: 'int',
  isRpc: 'int',
});

// StoreTrav union variants for GciTsStoreTravDoTravRefs
const StoreTravPerformArgs = koffi.struct('StoreTravPerformArgs', {
  receiver: OopType,
  _pad: koffi.array('char', 24),
  selector: 'const char *',
  args: 'void *',
  numArgs: 'int',
  environmentId: 'ushort',
});

const StoreTravExecStrArgs = koffi.struct('StoreTravExecStrArgs', {
  contextObject: OopType,
  sourceClass: OopType,
  symbolList: OopType,
  sourceSize: 'int64',
  source: 'const char *',
  args: 'void *',
  numArgs: 'int',
  environmentId: 'ushort',
});

const StoreTravContinueArgs = koffi.struct('StoreTravContinueArgs', {
  process: OopType,
  replaceTopOfStack: OopType,
});

const StoreTravDoUnion = koffi.union('StoreTravDoUnion', {
  perform: StoreTravPerformArgs,
  executestr: StoreTravExecStrArgs,
  continueArgs: StoreTravContinueArgs,
});

koffi.struct('GciStoreTravDoArgsSType', {
  doPerform: 'int',
  doFlags: 'int',
  alteredNumOops: 'int',
  alteredCompleted: 'int',
  u: StoreTravDoUnion,
  storeTravBuff: 'void *',
  alteredTheOops: 'void *',
  storeTravFlags: 'int',
});

// Object report header size (GciObjRepHdrSType): 40 bytes
const OBJ_REP_HDR_SIZE = 40;

export interface GciObjReport {
  objId: bigint;
  oclass: bigint;
  firstOffset: bigint;
  namedSize: number;
  objectSecurityPolicyId: number;
  valueBuffSize: number;
  idxSizeBits: bigint;
  body: Buffer;
}

export interface GciError {
  category: bigint;
  context: bigint;
  exceptionObj: bigint;
  args: bigint[];
  number: number;
  argCount: number;
  fatal: number;
  message: string;
  reason: string;
}

// koffi returns uint64 as Number when the value fits in Number.MAX_SAFE_INTEGER,
// and BigInt otherwise. This helper normalizes to always return BigInt.
function toBigInt(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

// Forces GCI_LOGIN_QUIET on top of a caller's loginFlags. Jasper never wants
// libgcits' ` gcits login:` / ` gcits logout:` banner on stdout, so every login
// wrapper ORs the bit in rather than making all ~6 call sites remember it. This
// is the one deliberate deviation from the raw wrappers' 1:1 contract; all
// other caller-supplied bits pass through untouched.
function quietedLoginFlags(loginFlags: number): number {
  return loginFlags | GCI_LOGIN_QUIET;
}

/**
 * FFI bindings to GemStone's native `libgcits` shared library, loaded via koffi.
 * All GemStone VM calls go through this class.
 *
 * Two tiers of methods:
 * - Raw `GciTsXxx` methods (e.g. `GciTsExecute`, `GciTsLogin`) are thin 1:1
 *   wrappers around the C functions of the same name — one per exported
 *   symbol, following the struct/pointer patterns already established below.
 *   The one deliberate exception: the login wrappers force `GCI_LOGIN_QUIET`
 *   into `loginFlags` — see the `quietedLoginFlags` helper above for why.
 * - The remaining methods (grouped into labeled sections further down: Session
 *   lifecycle, Code execution, Symbol resolution & Utf8 caching, Object
 *   lifecycle & PureExportSet, UserGlobals management, SessionTemps
 *   management, OOP predicates, Value decoding, Error handling helpers,
 *   Session reset, Paged string fetching) are an ergonomic layer on top:
 *   they call one or more
 *   `GciTsXxx` methods, throw {@link GciLibraryError} on failure instead of
 *   returning a `{success, err}`/`{result, err}` pair, and give the raw calls
 *   memorable names and typed parameters.
 *
 * Recurring GemStone vocabulary used throughout this file's JSDoc:
 * - **OOP** — the 64-bit handle GemStone uses to reference an object across
 *   the GCI boundary.
 * - **PureExportSet** — a session-level set of OOPs the GCI layer pins so
 *   they aren't garbage-collected before the client is done with them. Most
 *   calls that hand back a new OOP add it here; callers release entries via
 *   {@link releaseObject} / {@link releaseAllObjects} once done.
 * - **SessionTemps** / **UserGlobals** — two session-level dictionaries for
 *   stashing values between GCI calls. SessionTemps is GemStone's own
 *   built-in temp store; UserGlobals is this codebase's convention for
 *   values that need to survive a commit/abort (SessionTemps does not).
 * - **symbol list** — the ordered set of dictionaries (UserGlobals, Globals,
 *   Published) GemStone searches to resolve a name, e.g. via
 *   {@link resolveSymbol} or `Smalltalk at: #someSymbol`.
 */
export class GciLibrary {
  private lib: koffi.IKoffiLib;
  private _netldiLib: koffi.IKoffiLib | undefined;
  private _GciTsVersion: koffi.KoffiFunction;
  private _GciTsOopIsSpecial: koffi.KoffiFunction;
  private _GciTsFetchSpecialClass: koffi.KoffiFunction;
  private _GciTsOopToChar: koffi.KoffiFunction;
  private _GciTsCharToOop: koffi.KoffiFunction;
  private _GciTsDoubleToSmallDouble: koffi.KoffiFunction;
  private _GciI32ToOop: koffi.KoffiFunction;
  private _GciTsI32ToOop: koffi.KoffiFunction;
  private _GciUtf8To8bit: koffi.KoffiFunction;
  private _GciNextUtf8Character: koffi.KoffiFunction;
  private _GciTsLogin: koffi.KoffiFunction;
  private _GciTsLogout: koffi.KoffiFunction;
  // GciTsLogin_ (login with explicit netldiName) was added after 3.6.2. The
  // login path uses GciTsLogin and folds the netldi into the NRS string, so
  // this is bound optionally and only throws if it is ever actually called.
  private _GciTsLogin_: koffi.KoffiFunction;
  private _GciTsNbLogin: koffi.KoffiFunction | null = null;
  private _GciTsNbLogin_: koffi.KoffiFunction;
  private _GciTsNbLoginFinished: koffi.KoffiFunction | null = null;
  private _GciTsNbLogout: koffi.KoffiFunction;
  private _GciTsSessionIsRemote: koffi.KoffiFunction;
  private _GciTsEncrypt: koffi.KoffiFunction;
  private _GciTsAbort: koffi.KoffiFunction;
  private _GciTsBegin: koffi.KoffiFunction;
  private _GciTsCommit: koffi.KoffiFunction;
  private _GciTsContinueWith: koffi.KoffiFunction;
  private _GciTsDoubleToOop: koffi.KoffiFunction;
  private _GciTsOopToDouble: koffi.KoffiFunction;
  private _GciTsI64ToOop: koffi.KoffiFunction;
  private _GciTsOopToI64: koffi.KoffiFunction;
  private _GciTsNewObj: koffi.KoffiFunction;
  private _GciTsNewByteArray: koffi.KoffiFunction;
  private _GciTsNewString_: koffi.KoffiFunction;
  private _GciTsNewString: koffi.KoffiFunction;
  private _GciTsNewSymbol: koffi.KoffiFunction;
  private _GciTsNewUnicodeString_: koffi.KoffiFunction;
  private _GciTsNewUnicodeString: koffi.KoffiFunction;
  private _GciTsNewUtf8String: koffi.KoffiFunction;
  private _GciTsNewUtf8String_: koffi.KoffiFunction;
  private _GciTsFetchUnicode: koffi.KoffiFunction;
  private _GciTsFetchUtf8: koffi.KoffiFunction;
  private _GciTsFetchObjInfo: koffi.KoffiFunction;
  private _GciTsFetchSize: koffi.KoffiFunction;
  private _GciTsFetchVaryingSize: koffi.KoffiFunction;
  private _GciTsFetchClass: koffi.KoffiFunction;
  private _GciTsIsKindOf: koffi.KoffiFunction;
  private _GciTsIsSubclassOf: koffi.KoffiFunction;
  private _GciTsIsKindOfClass: koffi.KoffiFunction;
  private _GciTsIsSubclassOfClass: koffi.KoffiFunction;
  private _GciTsObjExists: koffi.KoffiFunction;
  private _GciTsResolveSymbolObj: koffi.KoffiFunction;
  private _GciTsExecute: koffi.KoffiFunction;
  private _GciTsExecute_: koffi.KoffiFunction;
  private _GciTsExecuteFetchBytes: koffi.KoffiFunction;
  private _GciTsPerform: koffi.KoffiFunction;
  private _GciTsPerformFetchBytes: koffi.KoffiFunction;
  private _GciTsFetchBytes: koffi.KoffiFunction;
  private _GciTsFetchChars: koffi.KoffiFunction;
  private _GciTsFetchUtf8Bytes: koffi.KoffiFunction;
  private _GciTsStoreBytes: koffi.KoffiFunction;
  private _GciTsFetchOops: koffi.KoffiFunction;
  private _GciTsFetchNamedOops: koffi.KoffiFunction;
  private _GciTsFetchVaryingOops: koffi.KoffiFunction;
  private _GciTsStoreOops: koffi.KoffiFunction;
  private _GciTsStoreNamedOops: koffi.KoffiFunction;
  private _GciTsStoreIdxOops: koffi.KoffiFunction;
  private _GciTsCompileMethod: koffi.KoffiFunction;
  private _GciTsClassRemoveAllMethods: koffi.KoffiFunction;
  private _GciTsProtectMethods: koffi.KoffiFunction;
  private _GciTsBreak: koffi.KoffiFunction;
  private _GciTsCallInProgress: koffi.KoffiFunction;
  private _GciTsClearStack: koffi.KoffiFunction;
  private _GciTsGemTrace: koffi.KoffiFunction;
  private _GciTsNbExecute: koffi.KoffiFunction;
  private _GciTsNbPerform: koffi.KoffiFunction;
  private _GciTsNbResult: koffi.KoffiFunction;
  private _GciTsNbPoll: koffi.KoffiFunction;
  private _GciTsSocket: koffi.KoffiFunction;
  private _GciTsGetFreeOops: koffi.KoffiFunction;
  private _GciTsSaveObjs: koffi.KoffiFunction;
  private _GciTsReleaseObjs: koffi.KoffiFunction;
  private _GciTsReleaseAllObjs: koffi.KoffiFunction;
  private _GciTsAddOopsToNsc: koffi.KoffiFunction;
  private _GciTsRemoveOopsFromNsc: koffi.KoffiFunction;
  private _GciTsPerformFetchOops: koffi.KoffiFunction;
  private _GciTsFetchGbjInfo: koffi.KoffiFunction;
  private _GciTsNewStringFromUtf16: koffi.KoffiFunction;
  private _GciTsDirtyObjsInit: koffi.KoffiFunction;
  private _GciTsFetchTraversal: koffi.KoffiFunction;
  private _GciTsStoreTrav: koffi.KoffiFunction;
  private _GciTsMoreTraversal: koffi.KoffiFunction;
  private _GciTsStoreTravDoTravRefs: koffi.KoffiFunction;
  private _GciTsWaitForEvent: koffi.KoffiFunction;
  private _GciTsCancelWaitForEvent: koffi.KoffiFunction;
  private _GciTsDirtyExportedObjs: koffi.KoffiFunction;
  private _GciTsKeepAliveCount: koffi.KoffiFunction;
  private _GciTsKeyfilePermissions: koffi.KoffiFunction;
  private _GciTsDebugConnectToGem: koffi.KoffiFunction;
  private _GciTsDebugStartDebugService: koffi.KoffiFunction;
  private _GciShutdown: koffi.KoffiFunction;
  private _GciMalloc: koffi.KoffiFunction;
  private _GciFree: koffi.KoffiFunction;
  private _GciHostCallDebuggerMsg: koffi.KoffiFunction;
  private _GciHostFtime: koffi.KoffiFunction;
  private _GciHostMilliSleep: koffi.KoffiFunction;
  private _GciTimeStampMsStr: koffi.KoffiFunction;

  /**
   * Bind a GCI function that may be absent in older libraries (e.g. functions
   * added after 3.6.2). If the symbol is missing, returns a stub that throws a
   * descriptive error only if it is actually called — so loading an older
   * library never fails at construction over a function we may never use.
   */
  /** Names of optional functions not exported by the loaded library. */
  private _missing = new Set<string>();

  private optionalFunc(name: string, signature: string): koffi.KoffiFunction {
    try {
      return this.lib.func(signature);
    } catch {
      this._missing.add(name);
      return (() => {
        throw new Error(`${name} is not available in this GCI library`);
      }) as unknown as koffi.KoffiFunction;
    }
  }

  /**
   * Whether a (possibly version-gated) GCI function is exported by the loaded
   * library. Use this to choose a fallback path instead of calling a function
   * that would throw "not available" — e.g. GciTsNbPoll is absent in 3.6.2.
   */
  isAvailable(name: string): boolean {
    return !this._missing.has(name);
  }

  /**
   * Whether this library supports the non-blocking login path
   * (GciTsNbLogin + GciTsNbLoginFinished). False on Windows client
   * distributions (the symbols are not exported there) and on libraries that
   * predate them, so callers can fall back to the blocking GciTsLogin.
   */
  supportsNonBlockingLogin(): boolean {
    return this._GciTsNbLogin !== null && this._GciTsNbLoginFinished !== null;
  }

  constructor(libraryPath: string) {
    if (process.platform === 'linux') {
      // libgcits has an undefined reference to HostCreateThread, which is
      // defined in libnetldi. On Linux, dlopen uses RTLD_LOCAL by default,
      // so libnetldi must be loaded with RTLD_GLOBAL first to make
      // HostCreateThread visible when libgcits is resolved.
      const netldiPath = path.join(
        path.dirname(libraryPath),
        path.basename(libraryPath).replace(/^libgcits-/, 'libnetldi-'),
      );
      this._netldiLib = koffi.load(netldiPath, { global: true });
    }
    this.lib = koffi.load(libraryPath);
    this._GciTsVersion = this.lib.func(
      `unsigned int GciTsVersion(_Out_ char *buf, size_t bufSize)`,
    );
    this._GciTsOopIsSpecial = this.lib.func(`int GciTsOopIsSpecial(${OopType} oop)`);
    this._GciTsFetchSpecialClass = this.lib.func(
      `${OopType} GciTsFetchSpecialClass(${OopType} oop)`,
    );
    this._GciTsOopToChar = this.lib.func(`int GciTsOopToChar(${OopType} oop)`);
    this._GciTsCharToOop = this.lib.func(`${OopType} GciTsCharToOop(unsigned int ch)`);
    this._GciTsDoubleToSmallDouble = this.lib.func(
      `${OopType} GciTsDoubleToSmallDouble(double aFloat)`,
    );
    // Optional: not exported by older libraries (e.g. 3.4.5). No production
    // code path calls these; they are bound optionally so loading an older
    // library never fails at construction over a function we never use.
    this._GciI32ToOop = this.optionalFunc('GciI32ToOop', `${OopType} GciI32ToOop(int arg)`);
    this._GciTsI32ToOop = this.optionalFunc('GciTsI32ToOop', `${OopType} GciTsI32ToOop(int arg)`);
    this._GciUtf8To8bit = this.lib.func(
      `int GciUtf8To8bit(const char *src, _Out_ char *dest, intptr destSize)`,
    );
    this._GciNextUtf8Character = this.lib.func(
      `intptr GciNextUtf8Character(const char *src, size_t len, _Out_ unsigned int *chOut)`,
    );
    this._GciShutdown = this.lib.func(`void GciShutdown()`);
    this._GciMalloc = this.lib.func(`void* GciMalloc(size_t length, int lineNum)`);
    this._GciFree = this.lib.func(`void GciFree(void* ptr)`);
    this._GciHostCallDebuggerMsg = this.lib.func(`int GciHostCallDebuggerMsg(const char* msg)`);
    this._GciHostFtime = this.lib.func(`void GciHostFtime(_Out_ long *sec, _Out_ ushort *millitm)`);
    this._GciHostMilliSleep = this.lib.func(`void GciHostMilliSleep(unsigned int milliSeconds)`);
    this._GciTimeStampMsStr = this.lib.func(
      `void GciTimeStampMsStr(long seconds, ushort milliSeconds, _Out_ char *result, size_t resultSize)`,
    );
    this._GciTsLogin = this.lib.func(
      `GciSessionPtr GciTsLogin(const char *, const char *, const char *, int, const char *, const char *, const char *, unsigned int, int, _Out_ int *, _Out_ GciErrSType *)`,
    );
    this._GciTsLogout = this.lib.func(`int GciTsLogout(GciSessionPtr, _Out_ GciErrSType *)`);
    // Optional: not exported by 3.6.2 and earlier. The login path uses GciTsLogin.
    this._GciTsLogin_ = this.optionalFunc(
      'GciTsLogin_',
      `GciSessionPtr GciTsLogin_(const char *, const char *, const char *, int, const char *, const char *, const char *, const char *, unsigned int, int, _Out_ int *, _Out_ GciErrSType *)`,
    );
    // Non-blocking login functions are not available in the Windows client DLL.
    // (These two DO exist in 3.6.2 — only GciTsNbLogin_ below is post-3.6.2.)
    try {
      this._GciTsNbLogin = this.lib.func(
        `GciSessionPtr GciTsNbLogin(const char *, const char *, const char *, int, const char *, const char *, const char *, unsigned int, int, _Out_ int *)`,
      );
      this._GciTsNbLoginFinished = this.lib.func(
        `int GciTsNbLoginFinished(GciSessionPtr, _Out_ int *, _Out_ GciErrSType *)`,
      );
    } catch {
      /* optional: not present in Windows client distributions */
    }
    this._GciTsNbLogin_ = this.optionalFunc(
      'GciTsNbLogin_',
      `GciSessionPtr GciTsNbLogin_(const char *, const char *, const char *, int, const char *, const char *, const char *, const char *, unsigned int, int, _Out_ int *)`,
    );
    this._GciTsNbLogout = this.lib.func(`int GciTsNbLogout(GciSessionPtr, _Out_ GciErrSType *)`);
    this._GciTsSessionIsRemote = this.lib.func(`int GciTsSessionIsRemote(GciSessionPtr)`);
    // Optional: not exported by some libraries (e.g. GemStone 4.0). Jasper's
    // login path passes the password in the clear (GciTsLogin without
    // GCI_LOGIN_PW_ENCRYPTED), so GciTsEncrypt is never called during connect —
    // binding it eagerly would abort library load for a library that lacks it.
    // Only the ergonomic GciTsEncrypt() wrapper (used by tests) would throw if
    // it were absent.
    this._GciTsEncrypt = this.optionalFunc(
      'GciTsEncrypt',
      `char* GciTsEncrypt(const char *, _Out_ char *, size_t)`,
    );
    this._GciTsAbort = this.lib.func(`int GciTsAbort(GciSessionPtr, _Out_ GciErrSType *)`);
    this._GciTsBegin = this.lib.func(`int GciTsBegin(GciSessionPtr, _Out_ GciErrSType *)`);
    this._GciTsCommit = this.lib.func(`int GciTsCommit(GciSessionPtr, _Out_ GciErrSType *)`);
    this._GciTsContinueWith = this.lib.func(
      `${OopType} GciTsContinueWith(GciSessionPtr, ${OopType}, ${OopType}, const GciErrSType *, int, _Out_ GciErrSType *)`,
    );
    this._GciTsDoubleToOop = this.lib.func(
      `${OopType} GciTsDoubleToOop(GciSessionPtr, double, _Out_ GciErrSType *)`,
    );
    this._GciTsOopToDouble = this.lib.func(
      `int GciTsOopToDouble(GciSessionPtr, ${OopType}, _Out_ double *, _Out_ GciErrSType *)`,
    );
    this._GciTsI64ToOop = this.lib.func(
      `${OopType} GciTsI64ToOop(GciSessionPtr, int64, _Out_ GciErrSType *)`,
    );
    this._GciTsOopToI64 = this.lib.func(
      `int GciTsOopToI64(GciSessionPtr, ${OopType}, _Out_ int64 *, _Out_ GciErrSType *)`,
    );
    this._GciTsNewObj = this.lib.func(
      `${OopType} GciTsNewObj(GciSessionPtr, ${OopType}, _Out_ GciErrSType *)`,
    );
    this._GciTsNewByteArray = this.lib.func(
      `${OopType} GciTsNewByteArray(GciSessionPtr, const uchar *, size_t, _Out_ GciErrSType *)`,
    );
    this._GciTsNewString_ = this.lib.func(
      `${OopType} GciTsNewString_(GciSessionPtr, const char *, size_t, _Out_ GciErrSType *)`,
    );
    this._GciTsNewString = this.lib.func(
      `${OopType} GciTsNewString(GciSessionPtr, const char *, _Out_ GciErrSType *)`,
    );
    this._GciTsNewSymbol = this.lib.func(
      `${OopType} GciTsNewSymbol(GciSessionPtr, const char *, _Out_ GciErrSType *)`,
    );
    this._GciTsNewUnicodeString_ = this.lib.func(
      `${OopType} GciTsNewUnicodeString_(GciSessionPtr, const ushort *, size_t, _Out_ GciErrSType *)`,
    );
    this._GciTsNewUnicodeString = this.lib.func(
      `${OopType} GciTsNewUnicodeString(GciSessionPtr, const ushort *, _Out_ GciErrSType *)`,
    );
    this._GciTsNewUtf8String = this.lib.func(
      `${OopType} GciTsNewUtf8String(GciSessionPtr, const char *, int, _Out_ GciErrSType *)`,
    );
    this._GciTsNewUtf8String_ = this.lib.func(
      `${OopType} GciTsNewUtf8String_(GciSessionPtr, const char *, size_t, int, _Out_ GciErrSType *)`,
    );
    this._GciTsFetchUnicode = this.lib.func(
      `int64 GciTsFetchUnicode(GciSessionPtr, ${OopType}, _Out_ ushort *, int64, _Out_ int64 *, _Out_ GciErrSType *)`,
    );
    this._GciTsFetchUtf8 = this.lib.func(
      `int64 GciTsFetchUtf8(GciSessionPtr, ${OopType}, _Out_ uchar *, int64, _Out_ int64 *, _Out_ GciErrSType *)`,
    );
    this._GciTsFetchObjInfo = this.lib.func(
      `int64 GciTsFetchObjInfo(GciSessionPtr, ${OopType}, int, _Out_ GciTsObjInfo *, _Out_ uchar *, size_t, _Out_ GciErrSType *)`,
    );
    this._GciTsFetchSize = this.lib.func(
      `int64 GciTsFetchSize(GciSessionPtr, ${OopType}, _Out_ GciErrSType *)`,
    );
    this._GciTsFetchVaryingSize = this.lib.func(
      `int64 GciTsFetchVaryingSize(GciSessionPtr, ${OopType}, _Out_ GciErrSType *)`,
    );
    this._GciTsFetchClass = this.lib.func(
      `${OopType} GciTsFetchClass(GciSessionPtr, ${OopType}, _Out_ GciErrSType *)`,
    );
    this._GciTsIsKindOf = this.lib.func(
      `int GciTsIsKindOf(GciSessionPtr, ${OopType}, ${OopType}, _Out_ GciErrSType *)`,
    );
    this._GciTsIsSubclassOf = this.lib.func(
      `int GciTsIsSubclassOf(GciSessionPtr, ${OopType}, ${OopType}, _Out_ GciErrSType *)`,
    );
    this._GciTsIsKindOfClass = this.lib.func(
      `int GciTsIsKindOfClass(GciSessionPtr, ${OopType}, ${OopType}, _Out_ GciErrSType *)`,
    );
    this._GciTsIsSubclassOfClass = this.lib.func(
      `int GciTsIsSubclassOfClass(GciSessionPtr, ${OopType}, ${OopType}, _Out_ GciErrSType *)`,
    );
    this._GciTsObjExists = this.lib.func(`int GciTsObjExists(GciSessionPtr, ${OopType})`);
    this._GciTsResolveSymbolObj = this.lib.func(
      `${OopType} GciTsResolveSymbolObj(GciSessionPtr, ${OopType}, ${OopType}, _Out_ GciErrSType *)`,
    );
    this._GciTsExecute = this.lib.func(
      `${OopType} GciTsExecute(GciSessionPtr, const char *, ${OopType}, ${OopType}, ${OopType}, int, ushort, _Out_ GciErrSType *)`,
    );
    this._GciTsExecute_ = this.lib.func(
      `${OopType} GciTsExecute_(GciSessionPtr, const char *, intptr, ${OopType}, ${OopType}, ${OopType}, int, ushort, _Out_ GciErrSType *)`,
    );
    this._GciTsExecuteFetchBytes = this.lib.func(
      `intptr GciTsExecuteFetchBytes(GciSessionPtr, const char *, intptr, ${OopType}, ${OopType}, ${OopType}, _Out_ uchar *, intptr, _Out_ GciErrSType *)`,
    );
    this._GciTsPerform = this.lib.func(
      `${OopType} GciTsPerform(GciSessionPtr, ${OopType}, ${OopType}, const char *, const ${OopType} *, int, int, ushort, _Out_ GciErrSType *)`,
    );
    this._GciTsPerformFetchBytes = this.lib.func(
      `intptr GciTsPerformFetchBytes(GciSessionPtr, ${OopType}, const char *, const ${OopType} *, int, _Out_ uchar *, intptr, _Out_ GciErrSType *)`,
    );
    this._GciTsFetchBytes = this.lib.func(
      `int64 GciTsFetchBytes(GciSessionPtr, ${OopType}, int64, _Out_ uchar *, int64, _Out_ GciErrSType *)`,
    );
    this._GciTsFetchChars = this.lib.func(
      `int64 GciTsFetchChars(GciSessionPtr, ${OopType}, int64, _Out_ char *, int64, _Out_ GciErrSType *)`,
    );
    this._GciTsFetchUtf8Bytes = this.lib.func(
      `int64 GciTsFetchUtf8Bytes(GciSessionPtr, ${OopType}, int64, _Out_ uchar *, int64, _Inout_ ${OopType} *, _Out_ GciErrSType *, int)`,
    );
    this._GciTsStoreBytes = this.lib.func(
      `int GciTsStoreBytes(GciSessionPtr, ${OopType}, int64, const uchar *, int64, ${OopType}, _Out_ GciErrSType *)`,
    );
    this._GciTsFetchOops = this.lib.func(
      `int GciTsFetchOops(GciSessionPtr, ${OopType}, int64, _Out_ ${OopType} *, int, _Out_ GciErrSType *)`,
    );
    this._GciTsFetchNamedOops = this.optionalFunc(
      'GciTsFetchNamedOops',
      `int GciTsFetchNamedOops(GciSessionPtr, ${OopType}, int64, _Out_ ${OopType} *, int, _Out_ GciErrSType *)`,
    );
    this._GciTsFetchVaryingOops = this.optionalFunc(
      'GciTsFetchVaryingOops',
      `int GciTsFetchVaryingOops(GciSessionPtr, ${OopType}, int64, _Out_ ${OopType} *, int, _Out_ GciErrSType *)`,
    );
    this._GciTsStoreOops = this.lib.func(
      `int GciTsStoreOops(GciSessionPtr, ${OopType}, int64, const ${OopType} *, int, _Out_ GciErrSType *, int)`,
    );
    this._GciTsStoreNamedOops = this.optionalFunc(
      'GciTsStoreNamedOops',
      `int GciTsStoreNamedOops(GciSessionPtr, ${OopType}, int64, const ${OopType} *, int, _Out_ GciErrSType *, int)`,
    );
    this._GciTsStoreIdxOops = this.optionalFunc(
      'GciTsStoreIdxOops',
      `int GciTsStoreIdxOops(GciSessionPtr, ${OopType}, int64, const ${OopType} *, int, _Out_ GciErrSType *)`,
    );
    this._GciTsCompileMethod = this.lib.func(
      `${OopType} GciTsCompileMethod(GciSessionPtr, ${OopType}, ${OopType}, ${OopType}, ${OopType}, ${OopType}, int, ushort, _Out_ GciErrSType *)`,
    );
    this._GciTsClassRemoveAllMethods = this.lib.func(
      `int GciTsClassRemoveAllMethods(GciSessionPtr, ${OopType}, ushort, _Out_ GciErrSType *)`,
    );
    this._GciTsProtectMethods = this.lib.func(
      `int GciTsProtectMethods(GciSessionPtr, int, _Out_ GciErrSType *)`,
    );
    this._GciTsBreak = this.lib.func(`int GciTsBreak(GciSessionPtr, int, _Out_ GciErrSType *)`);
    this._GciTsCallInProgress = this.lib.func(
      `int GciTsCallInProgress(GciSessionPtr, _Out_ GciErrSType *)`,
    );
    this._GciTsClearStack = this.lib.func(
      `int GciTsClearStack(GciSessionPtr, ${OopType}, _Out_ GciErrSType *)`,
    );
    this._GciTsGemTrace = this.lib.func(
      `int GciTsGemTrace(GciSessionPtr, int, _Out_ GciErrSType *)`,
    );
    this._GciTsNbExecute = this.lib.func(
      `int GciTsNbExecute(GciSessionPtr, const char *, ${OopType}, ${OopType}, ${OopType}, int, ushort, _Out_ GciErrSType *)`,
    );
    this._GciTsNbPerform = this.lib.func(
      `int GciTsNbPerform(GciSessionPtr, ${OopType}, ${OopType}, const char *, const ${OopType} *, int, int, ushort, _Out_ GciErrSType *)`,
    );
    this._GciTsNbResult = this.lib.func(
      `${OopType} GciTsNbResult(GciSessionPtr, _Out_ GciErrSType *)`,
    );
    this._GciTsNbPoll = this.optionalFunc(
      'GciTsNbPoll',
      `int GciTsNbPoll(GciSessionPtr, int, _Out_ GciErrSType *)`,
    );
    this._GciTsSocket = this.lib.func(`int GciTsSocket(GciSessionPtr, _Out_ GciErrSType *)`);
    this._GciTsGetFreeOops = this.lib.func(
      `int GciTsGetFreeOops(GciSessionPtr, _Out_ ${OopType} *, int, _Out_ GciErrSType *)`,
    );
    this._GciTsSaveObjs = this.lib.func(
      `int GciTsSaveObjs(GciSessionPtr, const ${OopType} *, int, _Out_ GciErrSType *)`,
    );
    this._GciTsReleaseObjs = this.lib.func(
      `int GciTsReleaseObjs(GciSessionPtr, const ${OopType} *, int, _Out_ GciErrSType *)`,
    );
    this._GciTsReleaseAllObjs = this.lib.func(
      `int GciTsReleaseAllObjs(GciSessionPtr, _Out_ GciErrSType *)`,
    );
    this._GciTsAddOopsToNsc = this.optionalFunc(
      'GciTsAddOopsToNsc',
      `int GciTsAddOopsToNsc(GciSessionPtr, ${OopType}, const ${OopType} *, int, _Out_ GciErrSType *)`,
    );
    this._GciTsRemoveOopsFromNsc = this.lib.func(
      `int GciTsRemoveOopsFromNsc(GciSessionPtr, ${OopType}, const ${OopType} *, int, _Out_ GciErrSType *)`,
    );
    this._GciTsPerformFetchOops = this.optionalFunc(
      'GciTsPerformFetchOops',
      `int GciTsPerformFetchOops(GciSessionPtr, ${OopType}, const char *, const ${OopType} *, int, _Out_ ${OopType} *, int, _Out_ GciErrSType *)`,
    );
    this._GciTsFetchGbjInfo = this.optionalFunc(
      'GciTsFetchGbjInfo',
      `int64 GciTsFetchGbjInfo(GciSessionPtr, ${OopType}, int, _Out_ GciTsGbjInfo *, _Out_ uchar *, size_t, _Out_ GciErrSType *)`,
    );
    this._GciTsNewStringFromUtf16 = this.optionalFunc(
      'GciTsNewStringFromUtf16',
      `${OopType} GciTsNewStringFromUtf16(GciSessionPtr, const ushort *, int64, int, _Out_ GciErrSType *)`,
    );
    this._GciTsDirtyObjsInit = this.lib.func(
      `int GciTsDirtyObjsInit(GciSessionPtr, _Out_ GciErrSType *)`,
    );
    this._GciTsWaitForEvent = this.lib.func(
      `int GciTsWaitForEvent(GciSessionPtr, int, _Out_ int *, _Out_ GciErrSType *)`,
    );
    this._GciTsCancelWaitForEvent = this.lib.func(
      `int GciTsCancelWaitForEvent(GciSessionPtr, _Out_ GciErrSType *)`,
    );
    this._GciTsDirtyExportedObjs = this.optionalFunc(
      'GciTsDirtyExportedObjs',
      `int GciTsDirtyExportedObjs(GciSessionPtr, _Out_ ${OopType} *, _Inout_ int *, _Out_ GciErrSType *)`,
    );
    this._GciTsKeepAliveCount = this.optionalFunc(
      'GciTsKeepAliveCount',
      `int64 GciTsKeepAliveCount(GciSessionPtr, _Out_ GciErrSType *)`,
    );
    this._GciTsKeyfilePermissions = this.optionalFunc(
      'GciTsKeyfilePermissions',
      `int64 GciTsKeyfilePermissions(GciSessionPtr, _Out_ GciErrSType *)`,
    );
    // Debug functions are post-3.6.2 and also absent from the Windows client DLL.
    this._GciTsDebugConnectToGem = this.optionalFunc(
      'GciTsDebugConnectToGem',
      `GciSessionPtr GciTsDebugConnectToGem(int, _Out_ GciErrSType *)`,
    );
    this._GciTsDebugStartDebugService = this.optionalFunc(
      'GciTsDebugStartDebugService',
      `int GciTsDebugStartDebugService(GciSessionPtr, uint64, _Out_ GciErrSType *)`,
    );
    this._GciTsFetchTraversal = this.lib.func(
      `int GciTsFetchTraversal(GciSessionPtr, const ${OopType} *, int, _Inout_ GciClampedTravArgsSType *, _Out_ GciErrSType *)`,
    );
    this._GciTsStoreTrav = this.lib.func(
      `int GciTsStoreTrav(GciSessionPtr, void *, int, _Out_ GciErrSType *)`,
    );
    this._GciTsMoreTraversal = this.lib.func(
      `int GciTsMoreTraversal(GciSessionPtr, void *, _Out_ GciErrSType *)`,
    );
    this._GciTsStoreTravDoTravRefs = this.lib.func(
      `int GciTsStoreTravDoTravRefs(GciSessionPtr, const ${OopType} *, int, const ${OopType} *, int, _Inout_ GciStoreTravDoArgsSType *, _Inout_ GciClampedTravArgsSType *, _Out_ GciErrSType *)`,
    );
  }

  GciTsVersion(): { product: number; version: string } {
    const buf = Buffer.alloc(128);
    const product = this._GciTsVersion(buf, buf.length);
    const version = buf.toString('utf8', 0, buf.indexOf(0));
    return { product, version };
  }

  GciTsOopIsSpecial(oop: bigint): boolean {
    return this._GciTsOopIsSpecial(oop) !== 0;
  }

  GciTsFetchSpecialClass(oop: bigint): bigint {
    return toBigInt(this._GciTsFetchSpecialClass(oop));
  }

  GciTsOopToChar(oop: bigint): number {
    return this._GciTsOopToChar(oop);
  }

  GciTsCharToOop(ch: number): bigint {
    return toBigInt(this._GciTsCharToOop(ch));
  }

  GciTsDoubleToSmallDouble(value: number): bigint {
    return toBigInt(this._GciTsDoubleToSmallDouble(value));
  }

  /**
   * Encode a 32-bit integer as a SmallInteger OOP. Optional: absent in older
   * libraries (e.g. 3.4.5); guard with `isAvailable('GciI32ToOop')`.
   * @throws {Error} if the loaded library does not export GciI32ToOop.
   */
  GciI32ToOop(arg: number): bigint {
    return toBigInt(this._GciI32ToOop(arg));
  }

  /**
   * Encode a 32-bit integer as a SmallInteger OOP. Optional: absent in older
   * libraries (e.g. 3.4.5); guard with `isAvailable('GciTsI32ToOop')`.
   * @throws {Error} if the loaded library does not export GciTsI32ToOop.
   */
  GciTsI32ToOop(arg: number): bigint {
    return toBigInt(this._GciTsI32ToOop(arg));
  }

  GciUtf8To8bit(src: string): { success: boolean; result: string } {
    const srcBytes = Buffer.byteLength(src, 'utf8');
    const dest = Buffer.alloc(srcBytes + 1);
    const success = this._GciUtf8To8bit(src, dest, dest.length) !== 0;
    const nullPos = dest.indexOf(0);
    const result = dest.toString('latin1', 0, nullPos >= 0 ? nullPos : dest.length);
    return { success, result };
  }

  GciNextUtf8Character(src: string): { bytes: number; codePoint: number } {
    const srcBuf = Buffer.from(src, 'utf8');
    const chOut = Buffer.alloc(4);
    const bytes = this._GciNextUtf8Character(srcBuf, srcBuf.length, chOut);
    return { bytes, codePoint: chOut.readUInt32LE(0) };
  }

  GciShutdown(): void {
    this._GciShutdown();
  }

  GciMalloc(length: number, lineNum: number = 0): unknown {
    return this._GciMalloc(length, lineNum);
  }

  GciFree(ptr: unknown): void {
    this._GciFree(ptr);
  }

  GciHostCallDebuggerMsg(msg: string): number {
    return this._GciHostCallDebuggerMsg(msg);
  }

  GciHostFtime(): { seconds: number; milliSeconds: number } {
    const sec = [0];
    const ms = [0];
    this._GciHostFtime(sec, ms);
    return { seconds: sec[0], milliSeconds: ms[0] };
  }

  GciHostMilliSleep(milliSeconds: number): void {
    this._GciHostMilliSleep(milliSeconds);
  }

  GciTimeStampMsStr(seconds: number, milliSeconds: number): string {
    const buf = Buffer.alloc(64);
    this._GciTimeStampMsStr(seconds, milliSeconds, buf, buf.length);
    const nullPos = buf.indexOf(0);
    return buf.toString('utf8', 0, nullPos >= 0 ? nullPos : buf.length);
  }

  GciTsLogin(
    stoneNrs: string | null,
    hostUserId: string | null,
    hostPassword: string | null,
    hostPwIsEncrypted: boolean,
    gemServiceNrs: string | null,
    gemstoneUsername: string,
    gemstonePassword: string,
    loginFlags: number,
    haltOnErrNum: number,
  ): { session: unknown; executedSessionInit: boolean; err: GciError } {
    const executedSessionInit = [0];
    const err: Record<string, unknown> = {};
    const session = this._GciTsLogin(
      stoneNrs,
      hostUserId,
      hostPassword,
      hostPwIsEncrypted ? 1 : 0,
      gemServiceNrs,
      gemstoneUsername,
      gemstonePassword,
      quietedLoginFlags(loginFlags),
      haltOnErrNum,
      executedSessionInit,
      err,
    );
    return {
      session,
      executedSessionInit: executedSessionInit[0] !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsLogin_(
    stoneNrs: string | null,
    hostUserId: string | null,
    hostPassword: string | null,
    hostPwIsEncrypted: boolean,
    gemServiceNrs: string | null,
    gemstoneUsername: string,
    gemstonePassword: string,
    netldiName: string | null,
    loginFlags: number,
    haltOnErrNum: number,
  ): { session: unknown; executedSessionInit: boolean; err: GciError } {
    const executedSessionInit = [0];
    const err: Record<string, unknown> = {};
    const session = this._GciTsLogin_(
      stoneNrs,
      hostUserId,
      hostPassword,
      hostPwIsEncrypted ? 1 : 0,
      gemServiceNrs,
      gemstoneUsername,
      gemstonePassword,
      netldiName,
      quietedLoginFlags(loginFlags),
      haltOnErrNum,
      executedSessionInit,
      err,
    );
    return {
      session,
      executedSessionInit: executedSessionInit[0] !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsNbLogin(
    stoneNrs: string | null,
    hostUserId: string | null,
    hostPassword: string | null,
    hostPwIsEncrypted: boolean,
    gemServiceNrs: string | null,
    gemstoneUsername: string,
    gemstonePassword: string,
    loginFlags: number,
    haltOnErrNum: number,
  ): { session: unknown; loginPollSocket: number } {
    if (!this._GciTsNbLogin) throw new Error('GciTsNbLogin is not available in this GCI library');
    const loginPollSocket = [0];
    const session = this._GciTsNbLogin(
      stoneNrs,
      hostUserId,
      hostPassword,
      hostPwIsEncrypted ? 1 : 0,
      gemServiceNrs,
      gemstoneUsername,
      gemstonePassword,
      quietedLoginFlags(loginFlags),
      haltOnErrNum,
      loginPollSocket,
    );
    return { session, loginPollSocket: loginPollSocket[0] };
  }

  GciTsNbLogin_(
    stoneNrs: string | null,
    hostUserId: string | null,
    hostPassword: string | null,
    hostPwIsEncrypted: boolean,
    gemServiceNrs: string | null,
    gemstoneUsername: string,
    gemstonePassword: string,
    netldiName: string | null,
    loginFlags: number,
    haltOnErrNum: number,
  ): { session: unknown; loginPollSocket: number } {
    const loginPollSocket = [0];
    const session = this._GciTsNbLogin_(
      stoneNrs,
      hostUserId,
      hostPassword,
      hostPwIsEncrypted ? 1 : 0,
      gemServiceNrs,
      gemstoneUsername,
      gemstonePassword,
      netldiName,
      quietedLoginFlags(loginFlags),
      haltOnErrNum,
      loginPollSocket,
    );
    return { session, loginPollSocket: loginPollSocket[0] };
  }

  GciTsNbLoginFinished(session: unknown): {
    result: number;
    executedSessionInit: boolean;
    err: GciError;
  } {
    if (!this._GciTsNbLoginFinished)
      throw new Error('GciTsNbLoginFinished is not available in this GCI library');
    const executedSessionInit = [0];
    const err: Record<string, unknown> = {};
    const result = this._GciTsNbLoginFinished(session, executedSessionInit, err);
    return {
      result,
      executedSessionInit: executedSessionInit[0] !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsLogout(session: unknown): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsLogout(session, err);
    // TODO: cache cleanup lives here temporarily; move into a `logout()`
    // ergonomic method once call sites are migrated off GciTsLogout directly.
    this.deleteCachedUtf8OopFor(session);
    return {
      success: result !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsEncrypt(password: string): string | null {
    const outBuf = Buffer.alloc(1024);
    const result = this._GciTsEncrypt(password, outBuf, outBuf.length);
    if (result === null) {
      return null;
    }
    const nullPos = outBuf.indexOf(0);
    return outBuf.toString('utf8', 0, nullPos >= 0 ? nullPos : outBuf.length);
  }

  GciTsSessionIsRemote(session: unknown): number {
    return this._GciTsSessionIsRemote(session);
  }

  GciTsNbLogout(session: unknown): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsNbLogout(session, err);
    return {
      success: result !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsAbort(session: unknown): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsAbort(session, err);
    return {
      success: result !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsBegin(session: unknown): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsBegin(session, err);
    return {
      success: result !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsCommit(session: unknown): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsCommit(session, err);
    return {
      success: result !== 0,
      err: err as unknown as GciError,
    };
  }

  GciTsContinueWith(
    session: unknown,
    gsProcess: bigint,
    replaceTopOfStack: bigint,
    continueWithError: GciError | null,
    flags: number,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsContinueWith(
      session,
      gsProcess,
      replaceTopOfStack,
      continueWithError,
      flags,
      err,
    );
    return {
      result: toBigInt(raw),
      err: err as unknown as GciError,
    };
  }

  /**
   * GciTsContinueWith on a koffi worker thread. GciTsContinueWith blocks until
   * the resumed execution's NEXT event (another forwarder send, an error, or
   * completion) — on the main thread that would freeze the extension host for
   * the whole remaining run (there is no GciTsNbContinue in 3.7.x). The GciTs
   * API is thread-safe (one call in progress per session, from any thread), so
   * a pool thread may own the call while the event loop stays free — and a
   * GciTsBreak from the main thread still interrupts it.
   */
  GciTsContinueWithAsync(
    session: unknown,
    gsProcess: bigint,
    replaceTopOfStack: bigint,
    continueWithError: GciError | null,
    flags: number,
  ): Promise<{ result: bigint; err: GciError }> {
    const err: Record<string, unknown> = {};
    return new Promise((resolve, reject) => {
      this._GciTsContinueWith.async(
        session,
        gsProcess,
        replaceTopOfStack,
        continueWithError,
        flags,
        err,
        (asyncErr: unknown, raw: number | bigint) => {
          if (asyncErr) {
            reject(asyncErr instanceof Error ? asyncErr : new Error(String(asyncErr)));
            return;
          }
          resolve({ result: toBigInt(raw), err: err as unknown as GciError });
        },
      );
    });
  }

  GciTsDoubleToOop(session: unknown, aDouble: number): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsDoubleToOop(session, aDouble, err);
    return {
      result: toBigInt(raw),
      err: err as unknown as GciError,
    };
  }

  GciTsOopToDouble(
    session: unknown,
    oop: bigint,
  ): { success: boolean; value: number; err: GciError } {
    const result = [0.0];
    const err: Record<string, unknown> = {};
    const success = this._GciTsOopToDouble(session, oop, result, err);
    return {
      success: success !== 0,
      value: result[0],
      err: err as unknown as GciError,
    };
  }

  GciTsI64ToOop(session: unknown, arg: bigint): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsI64ToOop(session, arg, err);
    return {
      result: toBigInt(raw),
      err: err as unknown as GciError,
    };
  }

  GciTsOopToI64(session: unknown, oop: bigint): { success: boolean; value: bigint; err: GciError } {
    const result = [0n];
    const err: Record<string, unknown> = {};
    const success = this._GciTsOopToI64(session, oop, result, err);
    return {
      success: success !== 0,
      value: toBigInt(result[0]),
      err: err as unknown as GciError,
    };
  }

  GciTsNewObj(session: unknown, aClass: bigint): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewObj(session, aClass, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewByteArray(session: unknown, body: Buffer): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewByteArray(session, body, body.length, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewString_(
    session: unknown,
    cString: string,
    nBytes: number,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewString_(session, cString, nBytes, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewString(session: unknown, cString: string): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewString(session, cString, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewSymbol(session: unknown, cString: string): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewSymbol(session, cString, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewUnicodeString_(
    session: unknown,
    str: Buffer,
    numShorts: number,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewUnicodeString_(session, str, numShorts, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewUnicodeString(session: unknown, str: Buffer): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewUnicodeString(session, str, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewUtf8String(
    session: unknown,
    utf8data: string,
    convertToUnicode: boolean,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewUtf8String(session, utf8data, convertToUnicode ? 1 : 0, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNewUtf8String_(
    session: unknown,
    utf8data: string,
    nBytes: number,
    convertToUnicode: boolean,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewUtf8String_(session, utf8data, nBytes, convertToUnicode ? 1 : 0, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsFetchUnicode(
    session: unknown,
    obj: bigint,
    destShorts: number,
  ): { bytesReturned: bigint; requiredSize: bigint; data: Buffer; err: GciError } {
    const dest = Buffer.alloc(destShorts * 2);
    const requiredSize = [0n];
    const err: Record<string, unknown> = {};
    const bytesReturned = this._GciTsFetchUnicode(
      session,
      obj,
      dest,
      destShorts,
      requiredSize,
      err,
    );
    return {
      bytesReturned: toBigInt(bytesReturned),
      requiredSize: toBigInt(requiredSize[0]),
      data: dest,
      err: err as unknown as GciError,
    };
  }

  GciTsFetchUtf8(
    session: unknown,
    obj: bigint,
    destSize: number,
  ): { bytesReturned: bigint; requiredSize: bigint; data: string; err: GciError } {
    const dest = Buffer.alloc(destSize);
    const requiredSize = [0n];
    const err: Record<string, unknown> = {};
    const bytesReturned = this._GciTsFetchUtf8(session, obj, dest, destSize, requiredSize, err);
    const br = toBigInt(bytesReturned);
    const str = br >= 0n ? dest.toString('utf8', 0, Number(br)) : '';
    return {
      bytesReturned: br,
      requiredSize: toBigInt(requiredSize[0]),
      data: str,
      err: err as unknown as GciError,
    };
  }

  GciTsFetchObjInfo(
    session: unknown,
    objId: bigint,
    addToExportSet: boolean,
    bufSize: number,
  ): { result: bigint; info: GciObjInfo; buffer: Buffer; err: GciError } {
    const info: Record<string, unknown> = {};
    const buffer = Buffer.alloc(bufSize);
    const err: Record<string, unknown> = {};
    const result = this._GciTsFetchObjInfo(
      session,
      objId,
      addToExportSet ? 1 : 0,
      info,
      buffer,
      bufSize,
      err,
    );
    // Normalize OopType fields from Number to BigInt
    if (info.objId !== undefined) info.objId = toBigInt(info.objId as number | bigint);
    if (info.objClass !== undefined) info.objClass = toBigInt(info.objClass as number | bigint);
    if (info.objSize !== undefined) info.objSize = toBigInt(info.objSize as number | bigint);
    return {
      result: toBigInt(result),
      info: info as unknown as GciObjInfo,
      buffer,
      err: err as unknown as GciError,
    };
  }

  GciTsFetchSize(session: unknown, obj: bigint): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsFetchSize(session, obj, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsFetchVaryingSize(session: unknown, obj: bigint): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsFetchVaryingSize(session, obj, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsFetchClass(session: unknown, obj: bigint): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsFetchClass(session, obj, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsIsKindOf(session: unknown, obj: bigint, aClass: bigint): { result: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsIsKindOf(session, obj, aClass, err);
    return { result, err: err as unknown as GciError };
  }

  GciTsIsSubclassOf(
    session: unknown,
    cls: bigint,
    aClass: bigint,
  ): { result: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsIsSubclassOf(session, cls, aClass, err);
    return { result, err: err as unknown as GciError };
  }

  GciTsIsKindOfClass(
    session: unknown,
    obj: bigint,
    aClass: bigint,
  ): { result: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsIsKindOfClass(session, obj, aClass, err);
    return { result, err: err as unknown as GciError };
  }

  GciTsIsSubclassOfClass(
    session: unknown,
    cls: bigint,
    aClass: bigint,
  ): { result: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsIsSubclassOfClass(session, cls, aClass, err);
    return { result, err: err as unknown as GciError };
  }

  GciTsObjExists(session: unknown, obj: bigint): boolean {
    return this._GciTsObjExists(session, obj) !== 0;
  }

  GciTsResolveSymbolObj(
    session: unknown,
    str: bigint,
    symbolList: bigint,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsResolveSymbolObj(session, str, symbolList, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsExecute(
    session: unknown,
    sourceStr: string | null,
    sourceOop: bigint,
    contextObject: bigint,
    symbolList: bigint,
    flags: number,
    environmentId: number,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsExecute(
      session,
      sourceStr,
      sourceOop,
      contextObject,
      symbolList,
      flags,
      environmentId,
      err,
    );
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsExecute_(
    session: unknown,
    sourceStr: string | null,
    sourceSize: number,
    sourceOop: bigint,
    contextObject: bigint,
    symbolList: bigint,
    flags: number,
    environmentId: number,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    // The -1 sentinel (use strlen) doesn't work over RPC; compute actual byte length
    const actualSize =
      sourceSize === -1 && sourceStr !== null ? Buffer.byteLength(sourceStr, 'utf8') : sourceSize;
    const raw = this._GciTsExecute_(
      session,
      sourceStr,
      actualSize,
      sourceOop,
      contextObject,
      symbolList,
      flags,
      environmentId,
      err,
    );
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsExecuteFetchBytes(
    session: unknown,
    sourceStr: string | null,
    sourceSize: number,
    sourceOop: bigint,
    contextObject: bigint,
    symbolList: bigint,
    maxResultSize: number,
  ): { bytesReturned: number; data: string; err: GciError } {
    const result = Buffer.alloc(maxResultSize);
    const err: Record<string, unknown> = {};
    // The -1 sentinel (use strlen) doesn't work over RPC; compute actual byte length
    const actualSize =
      sourceSize === -1 && sourceStr !== null ? Buffer.byteLength(sourceStr, 'utf8') : sourceSize;
    const bytesReturned = this._GciTsExecuteFetchBytes(
      session,
      sourceStr,
      actualSize,
      sourceOop,
      contextObject,
      symbolList,
      result,
      maxResultSize,
      err,
    );
    const str = bytesReturned >= 0 ? result.toString('utf8', 0, bytesReturned) : '';
    return { bytesReturned, data: str, err: err as unknown as GciError };
  }

  GciTsPerform(
    session: unknown,
    receiver: bigint,
    selector: bigint,
    selectorStr: string | null,
    args: bigint[],
    flags: number,
    environmentId: number,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsPerform(
      session,
      receiver,
      selector,
      selectorStr,
      args.length > 0 ? args : null,
      args.length,
      flags,
      environmentId,
      err,
    );
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsPerformFetchBytes(
    session: unknown,
    receiver: bigint,
    selectorStr: string,
    args: bigint[],
    maxResultSize: number,
  ): { bytesReturned: number; data: string; err: GciError } {
    const result = Buffer.alloc(maxResultSize);
    const err: Record<string, unknown> = {};
    const bytesReturned = this._GciTsPerformFetchBytes(
      session,
      receiver,
      selectorStr,
      args.length > 0 ? args : null,
      args.length,
      result,
      maxResultSize,
      err,
    );
    const str = bytesReturned >= 0 ? result.toString('utf8', 0, bytesReturned) : '';
    return { bytesReturned, data: str, err: err as unknown as GciError };
  }

  GciTsFetchBytes(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    numBytes: number,
  ): { bytesReturned: bigint; data: Buffer; err: GciError } {
    const dest = Buffer.alloc(numBytes);
    const err: Record<string, unknown> = {};
    const raw = this._GciTsFetchBytes(session, theObject, startIndex, dest, numBytes, err);
    const bytesReturned = toBigInt(raw);
    return { bytesReturned, data: dest, err: err as unknown as GciError };
  }

  GciTsFetchChars(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    maxSize: number,
  ): { bytesReturned: bigint; data: string; err: GciError } {
    const buf = Buffer.alloc(maxSize);
    const err: Record<string, unknown> = {};
    const raw = this._GciTsFetchChars(session, theObject, startIndex, buf, maxSize, err);
    const bytesReturned = toBigInt(raw);
    const str = bytesReturned >= 0n ? buf.toString('utf8', 0, Number(bytesReturned)) : '';
    return { bytesReturned, data: str, err: err as unknown as GciError };
  }

  GciTsFetchUtf8Bytes(
    session: unknown,
    aString: bigint,
    startIndex: bigint,
    bufSize: number,
    flags: number = 0,
  ): { bytesReturned: bigint; utf8String: bigint; data: Buffer; err: GciError } {
    const dest = Buffer.alloc(bufSize);
    const utf8StringArr = [aString];
    const err: Record<string, unknown> = {};
    const raw = this._GciTsFetchUtf8Bytes(
      session,
      aString,
      startIndex,
      dest,
      bufSize,
      utf8StringArr,
      err,
      flags,
    );
    const bytesReturned = toBigInt(raw);
    return {
      bytesReturned,
      utf8String: toBigInt(utf8StringArr[0]),
      data: dest,
      err: err as unknown as GciError,
    };
  }

  GciTsStoreBytes(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    theBytes: Buffer,
    ofClass: bigint,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsStoreBytes(
      session,
      theObject,
      startIndex,
      theBytes,
      theBytes.length,
      ofClass,
      err,
    );
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsFetchOops(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    numOops: number,
  ): { result: number; oops: bigint[]; err: GciError } {
    const oopsBuf = new Array<bigint>(numOops).fill(0n);
    const err: Record<string, unknown> = {};
    const result = this._GciTsFetchOops(session, theObject, startIndex, oopsBuf, numOops, err);
    const oops = result >= 0 ? oopsBuf.slice(0, result).map((v) => toBigInt(v)) : [];
    return { result, oops, err: err as unknown as GciError };
  }

  GciTsFetchNamedOops(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    numOops: number,
  ): { result: number; oops: bigint[]; err: GciError } {
    const oopsBuf = new Array<bigint>(numOops).fill(0n);
    const err: Record<string, unknown> = {};
    const result = this._GciTsFetchNamedOops(session, theObject, startIndex, oopsBuf, numOops, err);
    const oops = result >= 0 ? oopsBuf.slice(0, result).map((v) => toBigInt(v)) : [];
    return { result, oops, err: err as unknown as GciError };
  }

  GciTsFetchVaryingOops(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    numOops: number,
  ): { result: number; oops: bigint[]; err: GciError } {
    const oopsBuf = new Array<bigint>(numOops).fill(0n);
    const err: Record<string, unknown> = {};
    const result = this._GciTsFetchVaryingOops(
      session,
      theObject,
      startIndex,
      oopsBuf,
      numOops,
      err,
    );
    const oops = result >= 0 ? oopsBuf.slice(0, result).map((v) => toBigInt(v)) : [];
    return { result, oops, err: err as unknown as GciError };
  }

  GciTsStoreOops(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    theOops: bigint[],
    overlay: boolean = false,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsStoreOops(
      session,
      theObject,
      startIndex,
      theOops,
      theOops.length,
      err,
      overlay ? 1 : 0,
    );
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsStoreNamedOops(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    theOops: bigint[],
    overlay: boolean = false,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsStoreNamedOops(
      session,
      theObject,
      startIndex,
      theOops,
      theOops.length,
      err,
      overlay ? 1 : 0,
    );
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsStoreIdxOops(
    session: unknown,
    theObject: bigint,
    startIndex: bigint,
    theOops: bigint[],
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsStoreIdxOops(
      session,
      theObject,
      startIndex,
      theOops,
      theOops.length,
      err,
    );
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsCompileMethod(
    session: unknown,
    source: bigint,
    aClass: bigint,
    category: bigint,
    symbolList: bigint,
    overrideSelector: bigint,
    compileFlags: number,
    environmentId: number,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsCompileMethod(
      session,
      source,
      aClass,
      category,
      symbolList,
      overrideSelector,
      compileFlags,
      environmentId,
      err,
    );
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsClassRemoveAllMethods(
    session: unknown,
    aClass: bigint,
    environmentId: number,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsClassRemoveAllMethods(session, aClass, environmentId, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsProtectMethods(session: unknown, mode: boolean): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsProtectMethods(session, mode ? 1 : 0, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsBreak(session: unknown, hard: boolean): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsBreak(session, hard ? 1 : 0, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsCallInProgress(session: unknown): { result: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsCallInProgress(session, err);
    return { result, err: err as unknown as GciError };
  }

  GciTsClearStack(session: unknown, gsProcess: bigint): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsClearStack(session, gsProcess, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsGemTrace(session: unknown, enable: number): { previousLevel: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const previousLevel = this._GciTsGemTrace(session, enable, err);
    return { previousLevel, err: err as unknown as GciError };
  }

  GciTsNbExecute(
    session: unknown,
    sourceStr: string | null,
    sourceOop: bigint,
    contextObject: bigint,
    symbolList: bigint,
    flags: number,
    environmentId: number,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsNbExecute(
      session,
      sourceStr,
      sourceOop,
      contextObject,
      symbolList,
      flags,
      environmentId,
      err,
    );
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsNbPerform(
    session: unknown,
    receiver: bigint,
    selector: bigint,
    selectorStr: string | null,
    args: bigint[],
    flags: number,
    environmentId: number,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsNbPerform(
      session,
      receiver,
      selector,
      selectorStr,
      args.length > 0 ? args : null,
      args.length,
      flags,
      environmentId,
      err,
    );
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsNbResult(session: unknown): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNbResult(session, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsNbPoll(session: unknown, timeoutMs: number): { result: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsNbPoll(session, timeoutMs, err);
    return { result, err: err as unknown as GciError };
  }

  GciTsSocket(session: unknown): { fd: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const fd = this._GciTsSocket(session, err);
    return { fd, err: err as unknown as GciError };
  }

  GciTsGetFreeOops(
    session: unknown,
    numOopsRequested: number,
  ): { result: number; oops: bigint[]; err: GciError } {
    const buf = new Array<bigint>(numOopsRequested).fill(0n);
    const err: Record<string, unknown> = {};
    const result = this._GciTsGetFreeOops(session, buf, numOopsRequested, err);
    const oops = result > 0 ? buf.slice(0, result).map((v) => toBigInt(v)) : [];
    return { result, oops, err: err as unknown as GciError };
  }

  GciTsSaveObjs(session: unknown, oops: bigint[]): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsSaveObjs(session, oops, oops.length, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsReleaseObjs(session: unknown, oops: bigint[]): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsReleaseObjs(session, oops, oops.length, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsReleaseAllObjs(session: unknown): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsReleaseAllObjs(session, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsAddOopsToNsc(
    session: unknown,
    theObject: bigint,
    theOops: bigint[],
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsAddOopsToNsc(session, theObject, theOops, theOops.length, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsRemoveOopsFromNsc(
    session: unknown,
    theNsc: bigint,
    theOops: bigint[],
  ): { result: number; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsRemoveOopsFromNsc(session, theNsc, theOops, theOops.length, err);
    return { result, err: err as unknown as GciError };
  }

  GciTsPerformFetchOops(
    session: unknown,
    receiver: bigint,
    selectorStr: string,
    args: bigint[],
    maxResultSize: number,
  ): { result: number; oops: bigint[]; err: GciError } {
    const buf = new Array<bigint>(maxResultSize).fill(0n);
    const err: Record<string, unknown> = {};
    const result = this._GciTsPerformFetchOops(
      session,
      receiver,
      selectorStr,
      args.length > 0 ? args : null,
      args.length,
      buf,
      maxResultSize,
      err,
    );
    const oops = result > 0 ? buf.slice(0, result).map((v) => toBigInt(v)) : [];
    return { result, oops, err: err as unknown as GciError };
  }

  GciTsFetchGbjInfo(
    session: unknown,
    objId: bigint,
    addToExportSet: boolean,
    bufSize: number,
  ): { result: bigint; info: GciGbjInfo; data: Buffer; err: GciError } {
    const info: Record<string, unknown> = {};
    const buffer = Buffer.alloc(bufSize);
    const err: Record<string, unknown> = {};
    const raw = this._GciTsFetchGbjInfo(
      session,
      objId,
      addToExportSet ? 1 : 0,
      info,
      buffer,
      bufSize,
      err,
    );
    // Normalize OopType and int64 fields from Number to BigInt
    if (info.objId !== undefined) info.objId = toBigInt(info.objId as number | bigint);
    if (info.objClass !== undefined) info.objClass = toBigInt(info.objClass as number | bigint);
    if (info.objSize !== undefined) info.objSize = toBigInt(info.objSize as number | bigint);
    if (info.extraBits !== undefined) info.extraBits = toBigInt(info.extraBits as number | bigint);
    if (info.bytesReturned !== undefined)
      info.bytesReturned = toBigInt(info.bytesReturned as number | bigint);
    return {
      result: toBigInt(raw),
      info: info as unknown as GciGbjInfo,
      data: buffer,
      err: err as unknown as GciError,
    };
  }

  GciTsNewStringFromUtf16(
    session: unknown,
    words: number[],
    unicodeKind: number,
  ): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsNewStringFromUtf16(
      session,
      words,
      BigInt(words.length),
      unicodeKind,
      err,
    );
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsDirtyObjsInit(session: unknown): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsDirtyObjsInit(session, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  static createTravBuf(bodySize: number = 65536): Buffer {
    const buf = Buffer.alloc(8 + bodySize);
    buf.writeUInt32LE(bodySize, 0); // allocatedBytes
    buf.writeUInt32LE(0, 4); // usedBytes
    return buf;
  }

  static parseTravBuffer(travBuf: Buffer): GciObjReport[] {
    const usedBytes = travBuf.readUInt32LE(4);
    const reports: GciObjReport[] = [];
    let offset = 8; // skip allocatedBytes + usedBytes header
    const limit = 8 + usedBytes;
    while (offset + OBJ_REP_HDR_SIZE <= limit) {
      const valueBuffSize = travBuf.readInt32LE(offset);
      const namedSize = travBuf.readInt16LE(offset + 4);
      const objectSecurityPolicyId = travBuf.readUInt16LE(offset + 6);
      const objId = travBuf.readBigUInt64LE(offset + 8);
      const oclass = travBuf.readBigUInt64LE(offset + 16);
      const firstOffset = travBuf.readBigInt64LE(offset + 24);
      const idxSizeBits = travBuf.readBigUInt64LE(offset + 32);
      const bodyStart = offset + OBJ_REP_HDR_SIZE;
      const bodyEnd = Math.min(bodyStart + valueBuffSize, limit);
      const body = Buffer.from(travBuf.subarray(bodyStart, bodyEnd));

      reports.push({
        objId,
        oclass,
        firstOffset,
        namedSize,
        objectSecurityPolicyId,
        valueBuffSize,
        idxSizeBits,
        body,
      });

      // Next report: header + pad8(valueBuffSize)
      offset += OBJ_REP_HDR_SIZE + ((valueBuffSize + 7) & ~7);
    }
    return reports;
  }

  static buildTravBuffer(
    reports: {
      objId: bigint;
      oclass: bigint;
      firstOffset: bigint;
      body: Buffer | Uint8Array;
      namedSize?: number;
      objectSecurityPolicyId?: number;
      idxSizeBits?: bigint;
    }[],
  ): Buffer {
    let totalBodySize = 0;
    for (const r of reports) {
      totalBodySize += OBJ_REP_HDR_SIZE + ((r.body.length + 7) & ~7);
    }
    const buf = Buffer.alloc(8 + totalBodySize);
    buf.writeUInt32LE(totalBodySize, 0); // allocatedBytes
    buf.writeUInt32LE(totalBodySize, 4); // usedBytes

    let offset = 8;
    for (const r of reports) {
      buf.writeInt32LE(r.body.length, offset); // valueBuffSize
      buf.writeInt16LE(r.namedSize ?? 0, offset + 4); // namedSize
      buf.writeUInt16LE(r.objectSecurityPolicyId ?? 0, offset + 6); // objectSecurityPolicyId
      buf.writeBigUInt64LE(r.objId, offset + 8); // objId
      buf.writeBigUInt64LE(r.oclass, offset + 16); // oclass
      buf.writeBigInt64LE(r.firstOffset, offset + 24); // firstOffset
      buf.writeBigUInt64LE(r.idxSizeBits ?? 0n, offset + 32); // _idxSizeBits
      Buffer.from(r.body).copy(buf, offset + OBJ_REP_HDR_SIZE);
      offset += OBJ_REP_HDR_SIZE + ((r.body.length + 7) & ~7);
    }
    return buf;
  }

  GciTsFetchTraversal(
    session: unknown,
    oops: bigint[],
    level: number = 1,
    retrievalFlags: number = 0,
    clampSpec: bigint = 0x14n,
    bufSize: number = 65536,
  ): { status: number; resultOop: bigint; travBuf: Buffer; err: GciError } {
    const travBuf = GciLibrary.createTravBuf(bufSize);
    const ctArgs: Record<string, unknown> = {
      clampSpec,
      resultOop: 0x14n,
      travBuff: travBuf,
      level,
      retrievalFlags,
      isRpc: 1,
    };
    const err: Record<string, unknown> = {};
    const status = this._GciTsFetchTraversal(
      session,
      oops.length > 0 ? oops : null,
      oops.length,
      ctArgs,
      err,
    );
    return {
      status,
      resultOop: toBigInt(ctArgs.resultOop as number | bigint),
      travBuf,
      err: err as unknown as GciError,
    };
  }

  GciTsMoreTraversal(
    session: unknown,
    bufSize: number = 65536,
  ): { status: number; travBuf: Buffer; err: GciError } {
    const travBuf = GciLibrary.createTravBuf(bufSize);
    const err: Record<string, unknown> = {};
    const status = this._GciTsMoreTraversal(session, travBuf, err);
    return { status, travBuf, err: err as unknown as GciError };
  }

  GciTsStoreTrav(
    session: unknown,
    travBuf: Buffer,
    flag: number = 0,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsStoreTrav(session, travBuf, flag, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsStoreTravDoTravRefs(
    session: unknown,
    oopsNoLongerReplicated: bigint[] | null,
    oopsGcedOnClient: bigint[] | null,
    stdArgs: Record<string, unknown>,
    level: number = 1,
    retrievalFlags: number = 0,
    clampSpec: bigint = 0x14n,
    bufSize: number = 65536,
  ): {
    status: number;
    resultOop: bigint;
    travBuf: Buffer;
    stdArgs: Record<string, unknown>;
    err: GciError;
  } {
    const travBuf = GciLibrary.createTravBuf(bufSize);
    const ctArgs: Record<string, unknown> = {
      clampSpec,
      resultOop: 0x14n,
      travBuff: travBuf,
      level,
      retrievalFlags,
      isRpc: 1,
    };
    const err: Record<string, unknown> = {};
    const status = this._GciTsStoreTravDoTravRefs(
      session,
      oopsNoLongerReplicated,
      oopsNoLongerReplicated?.length ?? 0,
      oopsGcedOnClient,
      oopsGcedOnClient?.length ?? 0,
      stdArgs,
      ctArgs,
      err,
    );
    return {
      status,
      resultOop: toBigInt(ctArgs.resultOop as number | bigint),
      travBuf,
      stdArgs,
      err: err as unknown as GciError,
    };
  }

  GciTsWaitForEvent(
    session: unknown,
    latencyMs: number,
  ): { result: number; event: number; err: GciError } {
    const evOut = [0];
    const err: Record<string, unknown> = {};
    const result = this._GciTsWaitForEvent(session, latencyMs, evOut, err);
    return { result, event: evOut[0], err: err as unknown as GciError };
  }

  GciTsCancelWaitForEvent(session: unknown): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsCancelWaitForEvent(session, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  GciTsDirtyExportedObjs(
    session: unknown,
    maxOops: number,
  ): { success: boolean; oops: bigint[]; err: GciError } {
    const buf = new Array<bigint>(maxOops).fill(0n);
    const numOops = [maxOops];
    const err: Record<string, unknown> = {};
    const result = this._GciTsDirtyExportedObjs(session, buf, numOops, err);
    const oops = numOops[0] > 0 ? buf.slice(0, numOops[0]).map((v) => toBigInt(v)) : [];
    return { success: result !== 0, oops, err: err as unknown as GciError };
  }

  GciTsKeepAliveCount(session: unknown): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsKeepAliveCount(session, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsKeyfilePermissions(session: unknown): { result: bigint; err: GciError } {
    const err: Record<string, unknown> = {};
    const raw = this._GciTsKeyfilePermissions(session, err);
    return { result: toBigInt(raw), err: err as unknown as GciError };
  }

  GciTsDebugConnectToGem(gemPid: number): { session: unknown; err: GciError } {
    const err: Record<string, unknown> = {};
    const session = this._GciTsDebugConnectToGem(gemPid, err);
    return { session, err: err as unknown as GciError };
  }

  GciTsDebugStartDebugService(
    session: unknown,
    token: bigint,
  ): { success: boolean; err: GciError } {
    const err: Record<string, unknown> = {};
    const result = this._GciTsDebugStartDebugService(session, token, err);
    return { success: result !== 0, err: err as unknown as GciError };
  }

  close(): void {
    this.lib.unload();
  }

  // ---------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------

  /**
   * Logs into a GemStone stone and returns the resulting session.
   *
   * `HostUserId`/`HostPassword` are not exposed by this overload — the gem
   * process runs as the netldi process's user. Login flags are
   * `GCI_LOGIN_QUIET` (forced by the `GciTsLogin` wrapper) and `haltOnErrNum`
   * is left at its default (see `GciTsLogin` in `gcits.hf` for what they
   * control).
   *
   * @param stoneNrs - The NRS of the stone to log into.
   * @param gemServiceNrs - The NRS of the gem service to use.
   * @param gemstoneUsername - The GemStone user to log in as.
   * @param gemstonePassword - The GemStone user's password, in plaintext.
   * @returns The new session.
   * @throws {GciLibraryError} If login fails (no session was created). A
   *   successful login that still carries a non-fatal warning is logged via
   *   `console.warn` rather than thrown.
   */
  public login(
    stoneNrs: string,
    gemServiceNrs: string,
    gemstoneUsername: string,
    gemstonePassword: string,
  ) {
    const { session, err } = this.GciTsLogin(
      stoneNrs,
      null,
      null,
      false,
      gemServiceNrs,
      gemstoneUsername,
      gemstonePassword,
      0,
      0,
    );

    this.throwUnless(session !== null, err);

    // A non-NULL session means login succeeded, but *err may still carry a
    // non-fatal warning (per GciTsLogin in gcits.hf) — log it, don't fail.
    if (err.number !== 0) {
      console.warn(`GciTsLogin warning [${err.number}]: ${err.message}`);
    }

    return session;
  }

  /**
   * Logs out `session`. Failures are logged via `console.warn` rather than
   * thrown — the session is gone regardless, and a teardown error would
   * obscure real test failures above it.
   *
   * @param session - The GemStone session to log out.
   */
  public logout(session: unknown) {
    const { success, err } = this.GciTsLogout(session);
    // Warn rather than throw — the session is gone regardless, and a
    // teardown error would obscure real test failures above it.
    if (!success) console.warn(`GciTsLogout failed [${err.number}]: ${err.message}`);
  }

  /**
   * Begins a new transaction on `session`.
   *
   * @param session - The GemStone session to operate in.
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  public beginTransaction(session: unknown) {
    const { success, err } = this.GciTsBegin(session);

    this.throwUnless(success, err);
  }

  /**
   * Aborts the current transaction on `session`.
   *
   * @param session - The GemStone session to operate in.
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  public abortTransaction(session: unknown) {
    const { success, err } = this.GciTsAbort(session);

    this.throwUnless(success, err);
  }

  /**
   * Disables commits on `session` for the remainder of its lifetime, recording
   * `reason` as the explanation GemStone reports when it refuses a commit
   * (`TransactionError 2249`). Session-scoped and irreversible: there is no
   * counterpart that re-enables commits, and the only exit is logout.
   *
   * @param session - The GemStone session to operate in.
   * @param reason - Why commits are being disabled; surfaced in the refusal message.
   * @returns Whether this call is the one that disabled commits — `false` means
   *   they were already disabled.
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  public disableCommitsUntilLogout(session: unknown, reason: string) {
    return this.executeAndRelease(
      session,
      `System disableCommitsWithReason: '${escapeString(reason)}'`,
      (oop) => this.isTrueOop(oop),
    );
  }

  /**
   * Returns whether commits have been disabled on `session` for the remainder
   * of its lifetime (see `System class >> disableCommitsWithReason:`). The flag
   * is session-scoped and irreversible: the only exit is logout.
   *
   * @param session - The GemStone session to operate in.
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  public areCommitsDisabledUntilLogout(session: unknown) {
    return this.executeAndRelease(session, 'System commitsDisabledUntilLogout', (oop) =>
      this.isTrueOop(oop),
    );
  }

  // ---------------------------------------------------------------------
  // Code execution
  // ---------------------------------------------------------------------

  /**
   * Evaluates Smalltalk code in the current session and returns the OOP of the
   * result.
   *
   * The code is compiled as an anonymous method: `self` is `nil` and there is
   * no receiver object. Names are resolved against the user's symbol list
   * (UserGlobals, Globals, and Published). Code runs in environment 0 (the
   * default GemStone environment). If the code contains multiple statements
   * separated by `.`, the value of the last statement is returned.
   *
   * The result OOP is retained in the session's PureExportSet — the caller is
   * responsible for releasing it when no longer needed.
   *
   * @param session - The GemStone session to operate in.
   * @param code - Smalltalk source to evaluate.
   * @returns The OOP of the result object.
   * @throws {GciLibraryError} If the evaluated code signals an error, or if
   *   the underlying GCI call fails.
   */
  public execute(session: unknown, code: string) {
    const { result, err } = this.GciTsExecute(
      session,
      code,
      this.utf8ClassOop(session),
      OOP_ILLEGAL,
      this.nilOop(),
      0,
      0,
    );

    this.throwOnIllegalOop(result, err);

    return result;
  }

  /**
   * Evaluates `code` for effect, discarding its result.
   *
   * Wraps `code` in `[ code ] ensure: [ ^ nil ]` rather than simply
   * appending `nil` as a final statement (e.g. `[ code ] value. nil`).
   * Appending is unsafe: a non-local return (`^`) inside `code` exits the
   * whole doit immediately, skipping that trailing `nil` statement, so
   * `execute`'s result oop would be `code`'s own result instead of nil --
   * silently retaining it in the PureExportSet forever, since callers of
   * this method assume there is nothing to release. `ensure:`'s block runs
   * regardless of how the protected block exits -- normally, via an
   * exception, or via a non-local return -- so its own `^ nil` forces the
   * doit's final result to be nil in every case.
   *
   * @param session - The GemStone session to operate in.
   * @param code - Smalltalk source to evaluate.
   * @throws {GciLibraryError} If the evaluated code signals an error, or if
   *   the underlying GCI call fails.
   */
  public executeDiscardingResult(session: unknown, code: string) {
    this.execute(session, `[ ${code} ] ensure: [ ^ nil ]`);
  }

  /**
   * Evaluates `code`, passes the resulting oop to `callback`, and releases
   * that oop afterwards regardless of whether `callback` returns or throws.
   *
   * `callback` must consume `oop` synchronously and must not let it escape
   * past its own return (e.g. by returning it, or by capturing it in
   * something that outlives the call) -- the oop is released the instant
   * `callback` returns, so any use of it afterwards operates on an already-
   * released oop. Async callbacks are rejected at the type level for this
   * reason; there is no equivalent check for an oop returned directly.
   *
   * @param session - The GemStone session to operate in.
   * @param code - Smalltalk source to evaluate.
   * @param callback - Receives the oop `code` evaluated to. Must be
   *   synchronous and must not let the oop escape its own return.
   * @returns Whatever `callback` returns.
   * @throws {GciLibraryError} If the evaluated code signals an error, or if
   *   the underlying GCI call fails.
   * @throws Whatever `callback` itself throws, unchanged -- not necessarily
   *   a {@link GciLibraryError}.
   */
  public executeAndRelease<T>(
    session: unknown,
    code: string,
    callback: (oop: bigint) => NotPromise<T>,
  ): T {
    return this.releaseAfterUse(session, this.execute(session, code), callback);
  }

  /**
   * Evaluates `code` and decodes its result as a signed 64-bit integer, via
   * {@link oopToInteger}.
   *
   * @param session - The GemStone session to operate in.
   * @param code - Smalltalk source to evaluate.
   * @returns The evaluated result, decoded as a signed 64-bit integer.
   * @throws {GciLibraryError} If the evaluated code signals an error, if the
   *   result is not a SmallInteger or a LargeInteger within the range of a
   *   signed 64-bit integer -- including the result being `nil`, a
   *   non-integer object, or a LargeInteger beyond that range -- or if the
   *   underlying GCI calls fail.
   */
  public executeAndFetchInteger(session: unknown, code: string): bigint {
    return this.executeAndRelease(session, code, (resultOop) =>
      this.oopToInteger(session, resultOop),
    );
  }

  /**
   * Evaluates `code` via the non-blocking GCI entry point and fetches its
   * result oop.
   *
   * `code` runs as an anonymous method: `self` is `nil`, names resolve
   * against the user's symbol list (UserGlobals, Globals, and Published),
   * and it runs in environment 0, GemStone's default environment. The
   * result OOP is retained in the session's PureExportSet; the caller is
   * responsible for releasing it when no longer needed.
   *
   * Stub: does not yet poll for readiness, so it still blocks the event
   * loop while GemStone runs.
   *
   * @param session - The GemStone session to operate in.
   * @param code - Smalltalk source to evaluate.
   * @returns The OOP of the result object.
   * @throws {GciLibraryError} If execution fails to start, the evaluated
   *   code signals an error, or the underlying GCI call fails.
   */
  public async executeAndFetchOop(session: unknown, code: string): Promise<bigint> {
    this.executeNb(session, code);

    return this.fetchNbResult(session);
  }

  /**
   * Starts `code` running on `session` via the non-blocking GCI entry
   * point, without waiting for it to finish.
   *
   * @param session - The GemStone session to operate in.
   * @param code - Smalltalk source to evaluate.
   * @throws {GciLibraryError} If the underlying GCI call fails to start.
   */
  private executeNb(session: unknown, code: string) {
    const { success, err } = this.GciTsNbExecute(
      session,
      code,
      this.utf8ClassOop(session),
      OOP_ILLEGAL,
      this.nilOop(),
      0,
      0,
    );

    this.throwUnless(success, err);
  }

  /**
   * Blocks until `session`'s in-flight non-blocking GCI call finishes,
   * and returns its result oop.
   *
   * @param session - The GemStone session to operate in.
   * @returns The OOP of the result object.
   * @throws {GciLibraryError} If the evaluated code signals an error, or
   *   if the underlying GCI call fails.
   */
  private fetchNbResult(session: unknown) {
    const { result, err } = this.GciTsNbResult(session);

    this.throwOnIllegalOop(result, err);

    return result;
  }

  // ---------------------------------------------------------------------
  // Message sending
  // ---------------------------------------------------------------------

  /**
   * Sends the unary message `selector` to `receiverOop` and returns the OOP
   * of the result.
   *
   * The result OOP is retained in the session's PureExportSet, so the caller
   * is responsible for releasing it when no longer needed.
   *
   * @param session - The GemStone session to operate in.
   * @param receiverOop - The oop of the message's receiver.
   * @param selector - The unary selector to send.
   * @returns The OOP of the result object.
   * @throws {GciLibraryError} If `selector` cannot be resolved, the sent
   *   method signals an error, or the underlying GCI call fails.
   */
  public perform(session: unknown, receiverOop: bigint, selector: string) {
    const { result, err } = this.GciTsPerform(
      session,
      receiverOop,
      OOP_ILLEGAL,
      selector,
      [],
      0,
      0,
    );

    this.throwOnIllegalOop(result, err);

    return result;
  }

  /**
   * Sends the unary message `selector` to `receiverOop`, passes the
   * resulting oop to `callback`, and releases that oop afterwards regardless
   * of whether `callback` returns or throws.
   *
   * `callback` must consume `oop` synchronously and must not let it escape
   * past its own return (e.g. by returning it, or by capturing it in
   * something that outlives the call): the oop is released the instant
   * `callback` returns, so any use of it afterwards operates on an already
   * released oop. Async callbacks are rejected at the type level for this
   * reason; there is no equivalent check for an oop returned directly.
   *
   * @param session - The GemStone session to operate in.
   * @param receiverOop - The oop of the message's receiver.
   * @param selector - The unary selector to send.
   * @param callback - Receives the oop `selector` resolved to on
   *   `receiverOop`. Must be synchronous and must not let the oop escape its
   *   own return.
   * @returns Whatever `callback` returns.
   * @throws {GciLibraryError} If `selector` cannot be resolved, the sent
   *   method signals an error, or the underlying GCI call fails.
   * @throws Whatever `callback` itself throws, unchanged, not necessarily a
   *   {@link GciLibraryError}.
   */
  public performAndRelease<T>(
    session: unknown,
    receiverOop: bigint,
    selector: string,
    callback: (oop: bigint) => NotPromise<T>,
  ): T {
    return this.releaseAfterUse(session, this.perform(session, receiverOop, selector), callback);
  }

  // ---------------------------------------------------------------------
  // Symbol resolution & Utf8 caching
  // ---------------------------------------------------------------------

  private _utfCache: Map<unknown, bigint> = new Map<unknown, bigint>();

  /**
   * Returns the OOP of the `Utf8` class — see {@link resolveSymbol} for
   * error behavior. Cached per session: only resolves via a GCI round-trip
   * the first time it's called for a given session. Call
   * {@link releaseCachedUtf8Oop} to release the cached oop and clear the
   * cache for a session.
   *
   * `Utf8` is used as the source class when compiling code via {@link execute}:
   * it causes the compiler to treat string literals as UTF-8 strings rather
   * than single-byte strings.
   */
  public utf8ClassOop(session: unknown) {
    const cachedOop = this.cachedUtf8OopFor(session);
    if (cachedOop) return cachedOop;

    const resolvedOop = this.resolveSymbol(session, 'Utf8');
    this._utfCache.set(session, resolvedOop);

    return resolvedOop;
  }

  /**
   * Resolves a symbol name to its OOP using the user's symbol list
   * (UserGlobals, Globals, and Published). This is the only supported way to
   * resolve a symbol by name. Always go through this method (or
   * {@link utf8ClassOop} for the `Utf8` class specifically) rather than
   * binding the GCI call directly.
   *
   * Equivalent to evaluating `Smalltalk at: #symbol` in GemStone. This method
   * does not cache (`Utf8` is the one exception: it's cached separately by
   * {@link utf8ClassOop}).
   *
   * Goes through `createString` + `GciTsResolveSymbolObj` + `releaseObject`
   * (three GCI round-trips) rather than the single-call `GciTsResolveSymbol`,
   * which takes the name as a raw C string and is NOT bound here on purpose:
   * it has a known memory leak that the GemStone team is currently
   * investigating. Use this slower-but-safe path until that's fixed. See
   * TODO.md.
   *
   * @param session - The GemStone session to operate in.
   * @param symbolName - The name to resolve (e.g. `'Object'`, `'Utf8'`).
   * @returns The OOP of the object the symbol resolves to.
   * @throws {GciLibraryError} If the symbol is not found in the user's symbol
   *   list, or if the underlying GCI call fails.
   */
  public resolveSymbol(session: unknown, symbolName: string) {
    const symbolNameOop = this.createString(session, symbolName);

    return this.releaseAfterUse(session, symbolNameOop, (oop) => {
      const { result, err } = this.GciTsResolveSymbolObj(session, oop, this.nilOop());

      this.throwOnIllegalOop(result, err);

      return result;
    });
  }

  /**
   * Creates a GemStone String object from `contents`.
   *
   * @param session - The GemStone session to operate in.
   * @param contents - The string contents to create.
   * @returns The OOP of the newly created String object.
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  public createString(session: unknown, contents: string) {
    const { result, err } = this.GciTsNewString(session, contents);

    this.throwOnIllegalOop(result, err);

    return result;
  }

  /** Returns the cached `Utf8` class oop for `session`, or `undefined` if none is cached. */
  private cachedUtf8OopFor(session: unknown) {
    return this._utfCache.get(session);
  }

  /** Removes the cached `Utf8` class oop for `session`, without releasing it. */
  private deleteCachedUtf8OopFor(session: unknown) {
    this._utfCache.delete(session);
  }

  /**
   * Releases the session's cached `Utf8` class oop (see {@link utf8ClassOop})
   * from the PureExportSet and clears it from the cache. A no-op if nothing
   * is cached for `session`.
   *
   * @param session - The GemStone session to operate in.
   * @throws {GciLibraryError} If releasing the cached oop fails.
   */
  public releaseCachedUtf8Oop(session: unknown) {
    const cachedOop = this.cachedUtf8OopFor(session);
    if (!cachedOop) return;

    this.releaseObject(session, cachedOop);
    this.deleteCachedUtf8OopFor(session);
  }

  // ---------------------------------------------------------------------
  // Object lifecycle & PureExportSet
  // ---------------------------------------------------------------------

  /**
   * Releases a single oop from the session's PureExportSet.
   *
   * @param session - The GemStone session to operate in.
   * @param oop - The oop to release.
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  public releaseObject(session: unknown, oop: bigint) {
    const { success, err } = this.GciTsReleaseObjs(session, [oop]);

    this.throwUnless(success, err);
  }

  /**
   * Releases `oop`, swallowing (and logging via `console.warn`) any failure
   * instead of throwing it -- letting a release failure replace an in-flight
   * error (or mask a successful result) would hide the result that actually
   * matters to the caller.
   *
   * @param session - The GemStone session to operate in.
   * @param oop - The oop to release.
   */
  private safelyReleaseObject(session: unknown, oop: bigint) {
    try {
      this.releaseObject(session, oop);
    } catch (releaseError) {
      console.warn(`Failed to release oop ${oop}:`, releaseError);
    }
  }

  /**
   * Passes `oopToUse` to `consumer` and releases it afterwards, regardless of
   * whether `consumer` returns or throws. See {@link executeAndRelease} for
   * the same contract from a public caller's perspective.
   *
   * @param session - The GemStone session to operate in.
   * @param oopToUse - The oopToUse to pass to `consumer` and release afterwards.
   * @param consumer - Receives `oopToUse`. Must not let it escape past its own return.
   * @returns Whatever `consumer` returns.
   * @throws Whatever `consumer` itself throws, unchanged.
   */
  private releaseAfterUse<T>(
    session: unknown,
    oopToUse: bigint,
    consumer: (oopToUse: bigint) => NotPromise<T>,
  ): T {
    try {
      return consumer(oopToUse);
    } finally {
      this.safelyReleaseObject(session, oopToUse);
    }
  }

  /**
   * Releases every oop in the session's PureExportSet.
   *
   * @param session - The GemStone session to operate in.
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  public releaseAllObjects(session: unknown) {
    const { success, err } = this.GciTsReleaseAllObjs(session);

    this.throwUnless(success, err);
  }

  /**
   * Returns whether the session's PureExportSet ended up containing exactly
   * its prior contents plus the oops `expectedOopsProvider` declares --
   * nothing removed, replaced, or added beyond that. Order does not matter:
   * PureExportSet is a set, and newly added oops are not guaranteed to sort
   * after existing members (oop values are not allocated in increasing
   * order).
   *
   * `expectedOopsProvider` returns the oops it expects to have added; this
   * returns `true` only if the "after" snapshot, compared as a bag (so a
   * duplicate can't mask a missing or extra oop), is exactly the "before"
   * snapshot plus precisely those oops. Anything else -- oops removed or
   * replaced, or actual additions that don't match what `expectedOopsProvider`
   * declared (including declaring additions that never happened) -- returns
   * `false`.
   *
   * @param session - The GemStone session to operate in.
   * @param expectedOopsProvider - The operation to observe. Returns the oops
   *   it expects to have added to the PureExportSet (an empty array if it
   *   expects none).
   * @returns `true` if the PureExportSet gained only the oops
   *   `expectedOopsProvider` declared, `false` otherwise.
   * @throws {GciLibraryError} If the underlying GCI calls fail.
   */
  public didPureExportSetGainOnlyOopsProvidedBy(
    session: unknown,
    expectedOopsProvider: (snapshotName: string) => bigint[],
  ) {
    return this.checkAgainstPureExportSetSnapshot(
      session,
      (previousSnapshotName, currentSnapshotName, expectedAddedOops) => {
        const expectedAddedObjectsExpression = `{ ${expectedAddedOops.map((oop) => `Object objectForOop: ${oop}`).join('. ')} }`;
        return `(${previousSnapshotName}, ${expectedAddedObjectsExpression}) asIdentityBag = ${currentSnapshotName} asIdentityBag`;
      },
      expectedOopsProvider,
    );
  }

  /**
   * Returns whether the session's PureExportSet gained any oop it didn't
   * already contain while running `callback`. Unlike
   * {@link didPureExportSetGainOnlyOopsProvidedBy}, this doesn't care which
   * oops were added, or whether any were also removed -- it only asks
   * whether the "after" snapshot contains something the "before" snapshot
   * didn't.
   *
   * @param session - The GemStone session to operate in.
   * @param callback - The operation to observe.
   * @returns `true` if the PureExportSet gained at least one new oop,
   *   `false` otherwise.
   * @throws {GciLibraryError} If the underlying GCI calls fail.
   */
  public didPureExportSetGrow(session: unknown, callback: (snapshotName: string) => unknown) {
    return this.checkAgainstPureExportSetSnapshot(
      session,
      (previousSnapshotName, currentSnapshotName) => `
          (${currentSnapshotName} asIdentitySet - ${previousSnapshotName} asIdentitySet) isEmpty not
        `,
      callback,
    );
  }

  /**
   * Takes a snapshot of the session's PureExportSet, runs `callback`, then
   * evaluates `buildComparisonExpression` against the "before" and "after"
   * snapshots (plus whatever `callback` returned) to decide the result.
   *
   * Shared by {@link didPureExportSetGainOnlyOopsProvidedBy} and
   * {@link didPureExportSetGrow}, which differ only in what comparison they
   * need performed.
   *
   * @param session - The GemStone session to operate in.
   * @param buildComparisonExpression - Builds the Smalltalk boolean
   *   expression to evaluate, given the "before" snapshot's temp name, the
   *   "after" snapshot's temp name, and `callback`'s return value.
   * @param callback - The operation to observe.
   * @throws {GciLibraryError} If either of the snapshot expressions signals a
   *   GCI error.
   */
  private checkAgainstPureExportSetSnapshot<T>(
    session: unknown,
    buildComparisonExpression: (
      previousSnapshotName: string,
      currentSnapshotName: string,
      callbackResult: T,
    ) => string,
    callback: (snapshotName: string) => T,
  ) {
    const takePureExportSetSnapshotExpression =
      '(GsBitmap newForHiddenSet: #PureExportSet) asArray';
    const snapshotName = this.storeInUniqueUserGlobalsKey(
      session,
      takePureExportSetSnapshotExpression,
    );

    let callbackResult: T;
    try {
      callbackResult = callback(snapshotName);
    } catch (error) {
      // The snippet below hasn't run yet, so the 'before' snapshot is still
      // sitting in UserGlobals under snapshotName -- clean it up before
      // re-throwing. If callback already removed it itself, this second
      // removal fails too; that's fine, the original error is what matters
      // here.
      try {
        this.removeKeyFromUserGlobals(session, snapshotName);
      } catch (cleanupError) {
        console.warn(
          `Failed to clean up UserGlobals key '${snapshotName}' after callback error:`,
          cleanupError,
        );
      }
      throw error;
    }

    // No try/catch needed below: removeKey: is the snippet's first
    // statement, so by the time anything here could fail, the snapshot key
    // is already gone -- either removed successfully, or the removeKey:
    // itself is what's failing, meaning there was never anything to clean up.
    const comparisonResult = this.execute(
      session,
      `
        | previousSnapshot currentSnapshot |

        "Grab the 'before' snapshot we stashed in UserGlobals, and remove it
        now that we're done with it -- it was only needed for this check."
        previousSnapshot := UserGlobals removeKey: ${snapshotName}.

        "Take an 'after' snapshot of the PureExportSet, now that callback has run."
        currentSnapshot := ${takePureExportSetSnapshotExpression}.

        ${buildComparisonExpression('previousSnapshot', 'currentSnapshot', callbackResult)}
    `,
    );

    return this.isTrueOop(comparisonResult);
  }

  /**
   * Returns whether `oop` is currently a member of the session's
   * PureExportSet.
   *
   * @param session - The GemStone session to operate in.
   * @param oop - The oop to check for.
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  public isOopIncludedInPureExportSet(session: unknown, oop: bigint) {
    return this.isTrueOop(
      this.execute(
        session,
        `
          (GsBitmap newForHiddenSet: #PureExportSet) asArray
            anySatisfy: [ :referencedObject | referencedObject asOop = ${oop} ]
        `,
      ),
    );
  }

  // ---------------------------------------------------------------------
  // UserGlobals management
  // ---------------------------------------------------------------------

  private keyCounter = 0n;

  /**
   * Returns a Smalltalk symbol literal (e.g. `#Key_12345`), unique among the
   * keys returned by this method for this `GciLibrary` instance. This does
   * *not* guarantee the key is unused in any particular dictionary (e.g.
   * `UserGlobals` or `SessionTemps`) -- callers needing that guarantee must
   * check for themselves (see {@link storeInUniqueUserGlobalsKey}).
   */
  public nextKey(): string {
    return `#Key_${this.keyCounter++}`;
  }

  /**
   * Returns whether `UserGlobals` already has an entry for `keyExpression`.
   *
   * @param session - The GemStone session to operate in.
   * @param keyExpression - A Smalltalk expression evaluating to the key to
   *   look up (e.g. a symbol literal such as `#Key_12345`).
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  public isIncludedInUserGlobals(session: unknown, keyExpression: string) {
    return this.isTrueOop(this.execute(session, `UserGlobals includesKey: ${keyExpression}`));
  }

  /**
   * Evaluates `valueExpression` and stores its result under a fresh key (see
   * {@link nextKey}) in `UserGlobals`.
   *
   * @param session - The GemStone session to operate in.
   * @param valueExpression - A Smalltalk expression evaluating to the value
   *   to store.
   * @returns The Smalltalk symbol literal used as the key.
   * @throws {GciLibraryError} If the generated key is already in use, or if
   *   the underlying GCI call fails.
   */
  public storeInUniqueUserGlobalsKey(session: unknown, valueExpression: string) {
    const keyExpression = this.nextKey();

    this.executeDiscardingResult(
      session,
      `
      (UserGlobals includesKey: ${keyExpression})
        ifTrue: [ self error: 'Key is not unique' ].

      UserGlobals at: ${keyExpression} put: ${valueExpression}
    `,
    );

    return keyExpression;
  }

  /**
   * Returns the value stored under `keyExpression` in `UserGlobals`.
   *
   * @param session - The GemStone session to operate in.
   * @param keyExpression - A Smalltalk expression evaluating to the key to
   *   look up (e.g. a symbol literal such as `#Key_12345`).
   * @returns The oop of the value stored under `keyExpression`.
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  public valueOfUserGlobalsKey(session: unknown, keyExpression: string) {
    return this.execute(session, `UserGlobals at: ${keyExpression}`);
  }

  /**
   * Removes the entry for `keyExpression` from `UserGlobals`.
   *
   * @param session - The GemStone session to operate in.
   * @param keyExpression - A Smalltalk expression evaluating to the key to
   *   remove (e.g. a symbol literal such as `#Key_12345`).
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  public removeKeyFromUserGlobals(session: unknown, keyExpression: string) {
    this.executeDiscardingResult(session, `UserGlobals removeKey: ${keyExpression}`);
  }

  // ---------------------------------------------------------------------
  // SessionTemps management
  // ---------------------------------------------------------------------

  /**
   * Removes every key from the session's SessionTemps dictionary.
   *
   * @param session - The GemStone session to operate in.
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  public resetSessionTemps(session: unknown) {
    this.executeDiscardingResult(session, `SessionTemps current removeAllKeys`);
  }

  /**
   * Evaluates `valueExpression` and stores its result under a fresh key (see
   * {@link nextKey}) in the session's SessionTemps dictionary.
   *
   * @param session - The GemStone session to operate in.
   * @param valueExpression - A Smalltalk expression evaluating to the value
   *   to store.
   * @returns The Smalltalk symbol literal used as the key.
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  public storeInUniqueSessionTempsKey(session: unknown, valueExpression: string) {
    const key = this.nextKey();

    this.executeDiscardingResult(
      session,
      `SessionTemps current at: ${key} put: ${valueExpression}`,
    );

    return key;
  }

  /**
   * Returns whether the session's SessionTemps dictionary is empty.
   *
   * @param session - The GemStone session to operate in.
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  public isSessionTempsEmpty(session: unknown) {
    return this.isTrueOop(this.execute(session, 'SessionTemps current isEmpty'));
  }

  /**
   * Returns the value stored under `keyExpression` in the session's
   * SessionTemps dictionary.
   *
   * @param session - The GemStone session to operate in.
   * @param keyExpression - A Smalltalk expression evaluating to the key to
   *   look up (e.g. a symbol literal such as `#Key_12345`).
   * @returns The oop of the value stored under `keyExpression`.
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  public valueOfSessionTempsKey(session: unknown, keyExpression: string) {
    return this.execute(session, `SessionTemps current at: ${keyExpression}`);
  }

  // ---------------------------------------------------------------------
  // OOP predicates
  // ---------------------------------------------------------------------

  /**
   * Returns whether `oop` is `OOP_ILLEGAL` — the GCI sentinel used to signal
   * that a call produced no valid result (symbol not found, error, etc.).
   */
  private isIllegalOop(oop: bigint) {
    return OOP_ILLEGAL === oop;
  }

  /** Returns the OOP of GemStone's `nil` singleton. */
  public nilOop() {
    return OOP_NIL;
  }

  /** Returns the OOP of GemStone's `false` singleton. */
  public falseOop() {
    return OOP_FALSE;
  }

  /** Returns whether `oop` is the OOP of GemStone's `nil` singleton. */
  public isNilOop(oop: bigint) {
    return this.nilOop() === oop;
  }

  /** Returns whether `oop` is the OOP of GemStone's `true` singleton. */
  public isTrueOop(oop: bigint) {
    return OOP_TRUE === oop;
  }

  // ---------------------------------------------------------------------
  // Value decoding
  // ---------------------------------------------------------------------

  /**
   * Decodes `oop` as a signed 64-bit integer.
   *
   * Reads the value directly off the oop -- a SmallInteger's is encoded in
   * its tag bits, and a LargeInteger's is fetched by the underlying GCI
   * call -- rather than sending `printString` and parsing the result. See
   * {@link executeAndFetchInteger} for the same decoding composed with
   * `execute`.
   *
   * Limited to the signed 64-bit range because it goes through
   * `GciTsOopToI64`, which only decodes that far -- not because `bigint`
   * itself has a ceiling; it doesn't, and could hold a LargeInteger of any
   * size. A LargeInteger beyond int64 could still be decoded exactly, just
   * not through this call: a LargeInteger is a byte-indexable object (its
   * digits), so `GciTsFetchBytes` (the same primitive
   * {@link fetchUtf8String} pages strings with) could fetch and reassemble
   * it -- at the cost of an extra round-trip and no `printString` involved.
   * Nothing does that today; add it if a caller needs LargeIntegers past
   * int64.
   *
   * @param session - The GemStone session to operate in.
   * @param oop - The oop to decode.
   * @returns The decoded value.
   * @throws {GciLibraryError} If `oop` is not a SmallInteger or a
   *   LargeInteger within the range of a signed 64-bit integer -- including
   *   `oop` being `nil`, a non-integer object, or a LargeInteger beyond that
   *   range.
   */
  public oopToInteger(session: unknown, oop: bigint): bigint {
    const { success, value, err } = this.GciTsOopToI64(session, oop);

    this.throwUnless(success, err);

    return value;
  }

  // ---------------------------------------------------------------------
  // Error handling helpers
  // ---------------------------------------------------------------------

  /** Throws a {@link GciLibraryError} built from `error` unless `condition` is true. */
  private throwUnless(condition: boolean, error: GciError) {
    if (!condition) {
      throw GciLibraryError.fromGciError(error);
    }
  }

  /** Throws a {@link GciLibraryError} built from `err` if `result` is `OOP_ILLEGAL`. */
  private throwOnIllegalOop(result: bigint, err: GciError) {
    if (this.isIllegalOop(result)) {
      throw GciLibraryError.fromGciError(err);
    }
  }

  // ---------------------------------------------------------------------
  // Session reset
  // ---------------------------------------------------------------------

  /**
   * Resets `session`'s non-transactional state — empties `SessionTemps`,
   * releases the cached `Utf8` class oop, and releases everything remaining
   * in the PureExportSet. Intended for use between tests (or any other point
   * where a session needs to look freshly logged-in), alongside — but
   * independent of — transaction cleanup: `SessionTemps` and the
   * PureExportSet are session-level GCI structures that survive commit/abort,
   * so this method does not touch the current transaction; callers that also
   * need a clean transaction should abort it themselves, before calling this.
   *
   * @param session - The GemStone session to operate in.
   * @throws {GciLibraryError} If any of the underlying GCI calls fail.
   */
  public resetNonTransactionalSessionState(session: unknown) {
    // Order matters: resetSessionTemps evaluates code, which re-resolves (and
    // re-caches) the Utf8 class oop as a side effect if it isn't already
    // cached, so it must run before releaseCachedUtf8Oop clears that
    // cache. releaseAllObjects must run last so it sweeps up whatever that
    // re-resolution just added to the PureExportSet.
    this.resetSessionTemps(session);
    this.releaseCachedUtf8Oop(session);
    this.releaseAllObjects(session);
  }

  // ---------------------------------------------------------------------
  // Paged string fetching
  // ---------------------------------------------------------------------

  /**
   * Evaluates `code` and returns its result as a JS string, decoded as UTF-8.
   *
   * Explicitly sends `encodeAsUTF8` to the evaluated result here, in
   * Smalltalk, rather than relying on `GciTsFetchUtf8Bytes`'s own built-in
   * encoding step. `code` may evaluate to any string-like object, including
   * a UTF-16-encoded one (e.g. the result of `encodeAsUTF16`) -- but
   * `GciTsFetchUtf8Bytes` requires its argument's class to be identical to
   * or a subclass of String, MultiByteString, or Utf8 (see gcits.hf), which
   * a UTF-16 encoding does not satisfy. Encoding explicitly first normalizes
   * any input representation to a plain Utf8 byte object that
   * {@link fetchUtf8String} can then page through with the simpler, generic
   * `GciTsFetchBytes` -- see that method's comment for why
   * `GciTsFetchUtf8Bytes` itself isn't used for the fetch either.
   *
   * The `encodeAsUTF8` send happens as its own {@link performAndRelease}
   * call on the already-evaluated result oop, rather than being appended to
   * `code`'s source (e.g. `[ ${code} ] value encodeAsUTF8`). Appending it to
   * the source is unsafe: a non-local return (`^`) inside `code` exits the
   * whole doit immediately, so a trailing `encodeAsUTF8` send would never
   * run and the raw, un-encoded result would reach {@link fetchUtf8String}
   * instead. The extra round-trip this costs is a deliberate trade-off for
   * that correctness, not an oversight -- do not collapse the two sends
   * back into one to save a round-trip.
   *
   * @param session - The GemStone session to operate in.
   * @param code - Smalltalk source to evaluate.
   * @returns The evaluated result, decoded as a UTF-8 JS string.
   * @throws {GciLibraryError} If the evaluated code signals an error, if the
   *   result cannot be sent `encodeAsUTF8`, or if the underlying GCI calls
   *   fail.
   */
  public executeAndFetchString(session: unknown, code: string): string {
    return this.executeAndRelease(session, code, (resultOop) =>
      this.performAndRelease(session, resultOop, 'encodeAsUTF8', (utf8StringOop) =>
        this.fetchUtf8String(session, utf8StringOop, GciLibrary.FETCH_STRING_PAGE_SIZE_BYTES),
      ),
    );
  }

  /** The page size, in bytes, used by {@link fetchUtf8String} to page a string's contents out of GemStone. */
  public static readonly FETCH_STRING_PAGE_SIZE_BYTES = 256 * 1024;

  /**
   * Pages `stringOop`'s bytes out via `GciTsFetchBytes` and decodes them as
   * UTF-8.
   *
   * Uses the generic `GciTsFetchBytes` rather than the UTF-8-specific
   * `GciTsFetchUtf8Bytes`, even though the latter exists for exactly this
   * purpose. Callers reach this method (via {@link executeAndFetchString})
   * only after already sending `encodeAsUTF8` to the value server-side, so
   * `stringOop` is always already an instance of `Utf8` by the time it gets
   * here. Per gcits.hf's doc comment on `GciTsFetchUtf8Bytes`: once
   * `aString` is already an instance of `Utf8`, "*utf8String will be
   * unchanged and behavior is the same as GciTsFetchBytes_" -- so calling it
   * here would be functionally identical to `GciTsFetchBytes`, but would
   * additionally hand back a `*utf8String` oop that the caller must track
   * and release, for no benefit.
   *
   * @param session - The GemStone session to operate in.
   * @param stringOop - The oop of a `Utf8` (or byte-object) instance to fetch.
   * @param pageSize - The maximum number of bytes to fetch per GCI round-trip.
   * @returns The fetched bytes, decoded as a UTF-8 JS string.
   * @throws {GciLibraryError} If the underlying GCI call fails.
   */
  private fetchUtf8String(session: unknown, stringOop: bigint, pageSize: number) {
    const chunks: Buffer[] = [];
    let startIndex = 1n;

    for (;;) {
      const { bytesReturned, data, err } = this.GciTsFetchBytes(
        session,
        stringOop,
        startIndex,
        pageSize,
      );

      this.throwUnless(bytesReturned >= 0, err);

      const isLastChunk = bytesReturned < pageSize;
      const chunk = isLastChunk ? data.subarray(0, Number(bytesReturned)) : data;
      chunks.push(chunk);

      if (isLastChunk) break;
      startIndex += BigInt(pageSize);
    }

    return Buffer.concat(chunks).toString('utf8');
  }
}
