import type { ActiveSession } from '../sessionManager';
import { logError, logInfo } from '../gciLog';

/**
 * Server-side per-method history helper, installed the way the Jade-style
 * Transcript sink is (see transcriptSink.ts): at login a small class
 * (`JasperMethodHistory`) is compiled into the session and stashed in
 * `SessionTemps`, so it needs NO plugin and NO SystemUser, and works on a bare
 * stone. Method history stands entirely on its own, storing versions in a plain
 * Dictionary in the user's UserGlobals (the way Jadeite for Pharo keeps
 * `RowanMethodHistory`).
 *
 * The class itself is transient (defined in a throwaway SymbolDictionary, held
 * only via SessionTemps — recreated each login, never committed). Its STORE is
 * persistent: `UserGlobals at: #JasperMethodHistoryStore`, a Dictionary keyed by
 * dictionary+class+selector+side (the defining SymbolDictionary is part of the key,
 * so two classes named Foo in different dictionaries keep separate histories rather
 * than interleaving into one entry), valued by an ordered list of version records
 * {timeStamp. userId. category. source}. Store writes ride the user's compile
 * transaction and are committed when the user commits — the helper never commits.
 *
 * Capture rides the compile path (see queries/compileMethod.ts): around each
 * (re)compile, `beforeCompileIn:…` seeds the about-to-be-replaced source the first
 * time a method is edited (so the original survives), and `afterCompileIn:…`
 * records the newly-compiled source, stamped with the time and userId. The
 * selector is parsed with the BASE-kernel compiler (compile into throwaway
 * dictionaries), so it needs no parser add-on and depends on nothing but the
 * base image.
 */

// Each entry is one class-side method's full Smalltalk source (pattern + body).
// They are written here as plain strings so the Smalltalk stays readable; the
// install doit doubles the single quotes when embedding each in a compileMethod:
// string literal. Methods self-send (never reference the class by name), so the
// class can live in a throwaway dictionary that `objectNamed:` cannot resolve.
const CLASS_METHODS: string[] = [
  // --- capture ----------------------------------------------------------------
  `beforeCompileIn: aBehavior source: source environmentId: envId
  "About to (re)compile source into aBehavior. If this method has no history yet
   and it is already installed, seed the history with the currently-installed
   source so the original survives the first edit. Best-effort and guarded: a new
   method (nothing installed) simply gets no seed -- its first version is recorded
   post-compile."
  [ | selector store key old |
    selector := self selectorFrom: source in: aBehavior environmentId: envId.
    selector isNil ifTrue: [^self].
    store := self store.
    key := self keyFor: aBehavior selector: selector.
    (store includesKey: key) ifTrue: [^self].
    old := aBehavior compiledMethodAt: selector environmentId: envId otherwise: nil.
    old isNil ifTrue: [^self].
    store at: key put: (OrderedCollection with:
      (self version: old sourceString category: (self categoryOf: selector in: aBehavior)))
  ] on: Error do: [:e | ^self]`,

  `afterCompileIn: aBehavior method: aMethod source: source category: category
  "Just compiled aMethod successfully into aBehavior. Append source as a new
   version, stamped with the time and userId, unless it is identical to the most
   recent recorded source. Best-effort -- never turns a good compile into an error."
  [ | selector store key list |
    aMethod isNil ifTrue: [^self].
    selector := aMethod selector.
    store := self store.
    key := self keyFor: aBehavior selector: selector.
    list := store at: key ifAbsentPut: [OrderedCollection new].
    (list notEmpty and: [(list last at: 4) = source]) ifTrue: [^self].
    list add: (self version: source category: category)
  ] on: Error do: [:e | ^self]`,

  // --- reading ----------------------------------------------------------------
  `forClass: cls named: aName selector: aSelector meta: isMeta
  "A JSON array of the recorded versions of aName>>aSelector (class side when
   isMeta), newest first, or an error envelope if cls is not a class. Read-only.
   The version whose source matches the installed method is flagged isCurrent; if
   the installed method is not in the history a synthetic current version is
   emitted on top (notInHistory:true).
   cls is resolved BY THE CLIENT (queries/util.ts classLookupExpr), dictionary-scoped
   when the caller knows which dictionary it means, so that a class name shadowed
   across SymbolDictionaries reads the history of the class the user is looking at.
   Resolution is deliberately not repeated here: the client owns the one dict-aware
   lookup idiom. aName is carried only to name the class in the error envelope."
  | behavior store key list curSrc curIdx ws first |
  (cls isNil or: [(cls isKindOf: Behavior) not])
    ifTrue: [^'{"error":"not a class: ', (self jsonEscape: aName), '"}'].
  behavior := isMeta ifTrue: [cls class] ifFalse: [cls].
  store := self store.
  key := self keyFor: behavior selector: aSelector asSymbol.
  list := store at: key ifAbsent: [OrderedCollection new].
  curSrc := (behavior compiledMethodAt: aSelector asSymbol environmentId: 0 otherwise: nil)
    ifNil: [nil] ifNotNil: [:m | m sourceString].
  curIdx := 0.
  curSrc isNil ifFalse: [1 to: list size do: [:i | ((list at: i) at: 4) = curSrc ifTrue: [curIdx := i]]].
  ws := WriteStream on: String new.
  ws nextPut: $[.
  first := true.
  (curSrc notNil and: [curIdx = 0]) ifTrue: [
    first := false.
    self currentVersionSource: curSrc category: (self categoryOf: aSelector asSymbol in: behavior) on: ws].
  list size to: 1 by: -1 do: [:i |
    first ifFalse: [ws nextPut: $,].
    first := false.
    self versionJson: (list at: i) index: i isCurrent: (i = curIdx) on: ws].
  ws nextPut: $].
  ^ws contents`,

  `removeHistoryForClass: cls named: aName selector: aSelector meta: isMeta
  "Forget all recorded versions of aName>>aSelector (class side when isMeta). Does
   NOT commit. Answers {removed, remaining} or an error envelope.
   cls is client-resolved and dictionary-scoped exactly as forClass:named:... is, so
   forgetting history targets the same class the viewer is showing."
  | behavior store key existed |
  (cls isNil or: [(cls isKindOf: Behavior) not])
    ifTrue: [^'{"removed":false,"error":"not a class: ', (self jsonEscape: aName), '"}'].
  behavior := isMeta ifTrue: [cls class] ifFalse: [cls].
  store := self store.
  key := self keyFor: behavior selector: aSelector asSymbol.
  existed := store includesKey: key.
  existed ifTrue: [store removeKey: key ifAbsent: []].
  ^'{"removed":', (existed ifTrue: ['true'] ifFalse: ['false']), ',"remaining":0}'`,

  // --- store & keys -----------------------------------------------------------
  `store
  "The per-user history Dictionary, kept in UserGlobals so it is persistent and
   owned by this user. Created on first use. Keyed by keyFor:selector:, valued by
   an OrderedCollection of version arrays, oldest first."
  | ug |
  ug := System myUserProfile symbolList objectNamed: #UserGlobals.
  ^ug at: #JasperMethodHistoryStore ifAbsentPut: [Dictionary new]`,

  `keyFor: aBehavior selector: aSelector
  "A stable String key for one method. aBehavior name is 'Foo' for the instance
   side and 'Foo class' for the class side, so the key encodes the side too, and
   the defining dictionary's name is prefixed so that two classes named Foo in
   different SymbolDictionaries do not interleave their versions into one entry.
   '::' cannot occur in a dictionary or class name, so the parts stay separable."
  ^(self dictionaryNameOf: aBehavior), '::', aBehavior name asString, '>>', aSelector asString`,

  `dictionaryNameOf: aBehavior
  "The name of the SymbolDictionary binding aBehavior's class BY IDENTITY, or ''
   when nothing in the symbol list binds it (a transient or unbound class -- those
   share the '' scope, which is the pre-existing name-only behaviour).
   A metaclass is not itself bound -- 'Foo class' is reached through Foo -- so the
   ' class' suffix is trimmed and the metaclass is recognised as the bound class's
   own class. Identity, not name, so a name shadowed across dictionaries resolves to
   the slot holding THIS class; this mirrors the client's symbolListIndexOfClassExpr
   idiom (queries/util.ts). An unnamed SymbolDictionary has a nil name, hence the
   ifNil: guard before asString.
   NB references NO global but System: these methods are compiled into a THROWAWAY
   SymbolDictionary, so a bare global like Metaclass is an undefined symbol at compile
   time (error 1001) and takes the whole install doit down with it -- which presents as
   'Method history support is not available in this session', not as a compile error.
   Message sends are resolved at runtime and are therefore safe; bare globals are not.
   The ' class' test goes through asSymbol because a plain String = 'literal' compare
   raises ArgumentError 2718 on 3.6.x (see queries/util.ts)."
  | nm sl d bound |
  nm := aBehavior name asString.
  (nm size > 6 and: [(nm copyFrom: nm size - 5 to: nm size) asSymbol == #' class'])
    ifTrue: [nm := nm copyFrom: 1 to: nm size - 6].
  sl := System myUserProfile symbolList.
  1 to: sl size do: [:i |
    d := sl at: i.
    bound := d at: nm asSymbol ifAbsent: [nil].
    (bound notNil and: [bound == aBehavior or: [bound class == aBehavior]])
      ifTrue: [^(d name ifNil: ['']) asString]].
  ^''`,

  // --- selector parsing (base-kernel compiler; no parser add-on) --------------
  `selectorFrom: source in: aBehavior environmentId: envId
  "The selector of the method source, parsed by compiling it into THROWAWAY
   dictionaries with the base-kernel compiler (so it needs no parser add-on). The
   compile is done IN aBehavior's context, not UndefinedObject's, so a method that
   references instance variables (or class vars) parses -- compiling it against
   UndefinedObject would raise on those and drop the seed of the original. nil if
   the source will not parse (undefined globals); the real compile then fails with
   the proper error, or the original is seeded on the next clean edit."
  ^[ | meth |
     meth := aBehavior
       compileMethod: source
       dictionaries: System myUserProfile symbolList
       category: #'__jasperMethodHistory__'
       intoMethodDict: GsMethodDictionary new
       intoCategories: GsMethodDictionary new
       environmentId: envId.
     (meth isKindOf: GsNMethod) ifTrue: [meth selector] ifFalse: [nil]
   ] on: CompileError, CompileWarning do: [:ex | ex return: nil]`,

  `categoryOf: aSelector in: aBehavior
  "aBehavior's category for aSelector, or '' when unknown."
  ^[(aBehavior categoryOfSelector: aSelector environmentId: 0) ifNil: ['']] on: Error do: [:e | '']`,

  `version: source category: category
  "A recorded version: an Array {timeStamp. userId. category. source}. Positions
   are fixed (see the at: sends elsewhere)."
  ^Array
    with: DateTime now
    with: ([System myUserProfile userId asString] on: Error do: [:e | ''])
    with: (category ifNil: [''])
    with: source`,

  // --- serializing ------------------------------------------------------------
  `versionJson: aVersion index: i isCurrent: isCur on: ws
  ws nextPutAll: '{"index":'; nextPutAll: i printString.
  ws nextPutAll: ',"timeStamp":'; nextPutAll: (self jsonQuote: (self formatTimeStamp: (aVersion at: 1))).
  ws nextPutAll: ',"userId":'; nextPutAll: (self jsonQuote: (aVersion at: 2) asString).
  ws nextPutAll: ',"category":'; nextPutAll: (self jsonQuote: (aVersion at: 3) asString).
  ws nextPutAll: ',"isCurrent":'; nextPutAll: (isCur ifTrue: ['true'] ifFalse: ['false']).
  ws nextPutAll: ',"source":'; nextPutAll: (self jsonQuote: (aVersion at: 4) asString).
  ws nextPut: $}`,

  `currentVersionSource: source category: category on: ws
  "The synthetic current version for a method whose installed source is not in the
   recorded history (e.g. last edited outside Jasper). No recorded index/stamp, and
   flagged notInHistory so the client shows it plainly and never offers to restore it."
  ws nextPutAll: '{"index":0,"timeStamp":"","userId":"","category":'.
  ws nextPutAll: (self jsonQuote: category asString).
  ws nextPutAll: ',"isCurrent":true,"notInHistory":true,"source":'.
  ws nextPutAll: (self jsonQuote: source asString).
  ws nextPut: $}`,

  `formatTimeStamp: aDateTime
  "aDateTime as ISO-8601 CARRYING THE STONE'S UTC OFFSET (yyyy-mm-ddTHH:MM:SS-HHMM),
   so the client can convert it into the reader's own timezone. A zone-less stamp is
   not merely imprecise: the client reads those digits as its OWN local time, so every
   reader outside the stone's timezone silently misreads every version's stamp.
   asStringISO8601 is present on 3.6.2 and 3.7.5. The fallback keeps the older
   zone-less shape, which the client still renders -- as stone wall-clock, labelled as
   such, rather than pretending to have converted it. '' on nil or any format surprise."
  aDateTime isNil ifTrue: [^''].
  ^[ aDateTime asStringISO8601 ]
    on: Error
    do: [:e |
      [ aDateTime year printString, '-', (self pad2: aDateTime month), '-',
        (self pad2: aDateTime dayOfMonth), 'T',
        (self pad2: aDateTime hour), ':', (self pad2: aDateTime minute), ':',
        (self pad2: aDateTime second truncated) ]
        on: Error
        do: [:e2 | [aDateTime printString] on: Error do: [:e3 | '']]]`,

  `pad2: anInteger
  "anInteger as a two-digit, zero-padded decimal string (e.g. 7 -> '07')."
  ^(anInteger < 10 ifTrue: ['0'] ifFalse: ['']), anInteger printString`,

  // --- JSON string escaping (inlined; base kernel only) --------------------
  //
  // These duplicate GsRefactoringJson's escaping helpers, and that is deliberate, not an
  // oversight: method history must work on a BARE stone with no server plugin, and
  // GsRefactoringJson ships with the plugin. Verified on a bare 3.7.5 stone —
  // `symbolList objectNamed: #GsRefactoringJson` answers **nil**, so referencing it here
  // would not merely be slower, it would fail to resolve. These methods are also compiled
  // into a throwaway SymbolDictionary, where a bare global is a compile-time error that
  // takes the whole install down (see dictionaryNameOf:).
  //
  // The repo's structural dedup guard cannot see this copy (it scans .class.st files, and
  // this is Smalltalk built from a TS string), so it is called out here instead.
  `hex2: anInteger
  | digits |
  digits := '0123456789abcdef'.
  ^(String with: (digits at: (anInteger // 16) + 1)), (String with: (digits at: (anInteger \\\\ 16) + 1))`,

  `jsonEscape: aString
  "JSON string escaping emitting PURE ASCII (control chars and code points above
   126 become \\\\uXXXX), so the client's non-blocking GCI fetch is never handed a
   Unicode-promoted result."
  | ws |
  ws := WriteStream on: String new.
  aString do: [:ch | | code |
    code := ch asInteger.
    ch == $" ifTrue: [ws nextPutAll: '\\"']
    ifFalse: [ch == $\\ ifTrue: [ws nextPutAll: '\\\\']
    ifFalse: [code = 10 ifTrue: [ws nextPutAll: '\\n']
    ifFalse: [code = 13 ifTrue: [ws nextPutAll: '\\r']
    ifFalse: [code = 9 ifTrue: [ws nextPutAll: '\\t']
    ifFalse: [code < 32 ifTrue: [ws nextPutAll: '\\u00'; nextPutAll: (self hex2: code)]
    ifFalse: [code > 126
      ifTrue: [code > 65535
        ifTrue: [ws nextPut: $?]
        ifFalse: [ws nextPutAll: '\\u'; nextPutAll: (self hex2: code // 256); nextPutAll: (self hex2: code \\\\ 256)]]
      ifFalse: [ws nextPut: ch]]]]]]]].
  ^ws contents`,

  `jsonQuote: aString
  ^'"', (self jsonEscape: aString), '"'`,
];

/** Double single quotes so a Smalltalk source can be embedded in a '...' literal. */
function stLiteral(source: string): string {
  return source.replace(/'/g, "''");
}

/**
 * The install doit. Defines JasperMethodHistory in a throwaway SymbolDictionary,
 * compiles its class-side methods, and stashes the class in SessionTemps under
 * #JasperMethodHistory. Idempotent per session; never commits (the class is
 * transient — only its UserGlobals store persists, written later on the compile
 * path). Ends in a String for executeAndFetchString.
 */
export const METHOD_HISTORY_INSTALL_CODE = `| tmps dict cls symList |
tmps := SessionTemps current.
(tmps at: #JasperMethodHistory otherwise: nil) ifNotNil: [:c | ^'already installed'].
symList := System myUserProfile symbolList.
dict := SymbolDictionary new.
cls := Object
  subclass: 'JasperMethodHistory'
  instVarNames: #()
  classVars: #()
  classInstVars: #()
  poolDictionaries: #()
  inDictionary: dict
  options: #().
${CLASS_METHODS.map(
  (src) =>
    `cls class compileMethod: '${stLiteral(src)}' dictionaries: symList category: 'jasper' environmentId: 0.`,
).join('\n')}
tmps at: #JasperMethodHistory put: cls.
'installed'`;

/**
 * Compile and install the method-history helper on a freshly logged-in session.
 * Idempotent and non-fatal on failure — a session that cannot compile it simply
 * records no history (capture is soft-guarded), exactly as a bare session behaves.
 */
export function installMethodHistory(session: ActiveSession): boolean {
  try {
    const result = session.gci.executeAndFetchString(session.handle, METHOD_HISTORY_INSTALL_CODE);
    logInfo(`[Session ${session.id}] Method history helper ${result}`);
    return true;
  } catch (e) {
    logError(
      session.id,
      `Method history helper install failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}
