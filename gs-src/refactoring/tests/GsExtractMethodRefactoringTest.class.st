"
Correctness of the extract-method refactoring (M1). Extract turns a selected run
of statements (or a single expression) into a NEW method and replaces the
selection with a send to it, staging exactly two core changes -- a #methodAdd for
the extracted method and a #methodRecompile for the rewritten original -- plus,
when replaceSimilar is on and the extraction is a safe void shape, one deselectable
#methodRecompile per structurally-equivalent run found in the class + hierarchy.

This suite pins down:

  - a void statement run with no external reads extracts to a unary method + a
    'self <sel>' call;
  - statements that read outer locals extract to a keyword method taking those as
    arguments (source order), and a single variable assigned inside and used after
    becomes the return value (call site: 'var := self <sel> ...');
  - a single expression extracts to a '^expression' method, the call substituted
    for the expression in place;
  - a temporary used only inside the selection is declared in the new method and
    dropped from the original;
  - the selection is DECLINED (empty change set + a reason) when it contains a ^
    return, sends to super, uses thisContext, assigns more than one variable used
    later, is not a whole-statement / single-expression selection, or the selector
    arity does not match the argument count;
  - a new selector already in the hierarchy is a SOFT collision warning that does
    not block (the change set is still built);
  - the replace-similar pass finds equivalent runs in the class + hierarchy (arg
    positions mapped consistently), skips near-misses, is off by default, and is
    skipped for value-returning extractions;
  - building the change set compiles nothing and commits nothing; apply creates the
    new method and rewrites the original (honouring duplicate deselection but never
    the two core changes) without committing.

setUp builds a throwaway two-class hierarchy in UserGlobals; tearDown removes it.
"
Class {
	#name : 'GsExtractMethodRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsExtractMethodRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'fixture' }
GsExtractMethodRefactoringTest >> baseFixture [
	^UserGlobals at: #GsEMBase
]

{ #category : 'fixture' }
GsExtractMethodRefactoringTest >> compile: aSource in: aClass [
	[aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture']
		on: CompileWarning
		do: [:ex | ex resume: nil]
]

{ #category : 'asserting' }
GsExtractMethodRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsExtractMethodRefactoringTest >> extractFrom: aClass selector: aSelector select: aSubstring newSelector: newSel [
	"A refactoring extracting the occurrence of aSubstring in aClass>>aSelector into a
	 new method named newSel."
	| start |
	start := (aClass compiledMethodAt: aSelector) sourceString indexOfSubCollection: aSubstring.
	^GsExtractMethodRefactoring
		class: aClass
		selector: aSelector
		meta: false
		selStart: start
		selStop: start + aSubstring size - 1
		newSelector: newSel
]

{ #category : 'fixture' }
GsExtractMethodRefactoringTest >> addChangeIn: aChangeSet [
	^aChangeSet changes detect: [:c | c kind = #methodAdd] ifNone: [nil]
]

{ #category : 'fixture' }
GsExtractMethodRefactoringTest >> recompileFor: aSelector in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodRecompile and: [c selector = aSelector]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsExtractMethodRefactoringTest >> recompileSelectorsIn: aChangeSet [
	^(aChangeSet changes select: [:c | c kind = #methodRecompile])
		collect: [:c | c selector]
]

{ #category : 'fixture' }
GsExtractMethodRefactoringTest >> subFixture [
	^UserGlobals at: #GsEMSub
]

{ #category : 'running' }
GsExtractMethodRefactoringTest >> setUp [
	| base sub |
	super setUp.
	base := Object
		subclass: 'GsEMBase'
		instVarNames: #('count')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := base
		subclass: 'GsEMSub'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	"void run, no external reads, no return"
	self compile: 'doStuff self yourself. self hash. ^count' in: base.
	"reads two outer arguments + one return variable"
	self compile: 'combine: a with: b | r | r := a + b. r := r * a. ^r' in: base.
	"single-expression extract (no arg / one arg)"
	self compile: 'computeArea ^count * count' in: base.
	self compile: 'scaleBy: factor ^count * factor' in: base.
	"an expression extract that is a SUB-expression (a binary operand): parens kept"
	self compile: 'subExprArg: n ^1 + (n * n)' in: base.
	"temporary used only inside the selection"
	self compile: 'report | tmp | tmp := self hash. tmp printString. ^count' in: base.
	"hard declines"
	self compile: 'guard self yourself. true ifTrue: [^1]. ^2' in: base.
	self compile: 'callsSuper ^super hash' in: base.
	self compile: 'twoOut | a b | a := 1. b := 2. ^a + b' in: base.
	"replace-similar fixtures (void run 'self yourself. self hash')"
	self compile: 'helperA self yourself. self hash. ^1' in: base.
	self compile: 'helperB self yourself. self hash. ^2' in: base.
	self compile: 'helperX self yourself. self identityHash. ^3' in: base.
	self compile: 'helperC self yourself. self hash. ^9' in: sub.
	"replace-similar with an argument mapped across sites"
	self compile: 'scaleSrc: n self yourself. n printString. ^count' in: base.
	self compile: 'scaleA: n self yourself. n printString. ^1' in: base.
	self compile: 'scaleB: m self yourself. m printString. ^2' in: base
]

{ #category : 'running' }
GsExtractMethodRefactoringTest >> tearDown [
	#('GsEMSub' 'GsEMBase')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
]

{ #category : 'tests - staging' }
GsExtractMethodRefactoringTest >> testExtractsVoidRunToUnaryMethod [
	| cs add recompile |
	cs := (self extractFrom: self baseFixture selector: #doStuff
		select: 'self yourself. self hash' newSelector: 'sideEffects') changeSet.
	add := self addChangeIn: cs.
	recompile := self recompileFor: #doStuff in: cs.

	self assert: add notNil.
	self assert: add selector equals: #sideEffects.
	self assert: add newSource includesSubstring: 'sideEffects'.
	"The extracted method is reformatted (one statement per line), so assert each."
	self assert: add newSource includesSubstring: 'self yourself'.
	self assert: add newSource includesSubstring: 'self hash'.
	self assert: recompile newSource includesSubstring: 'self sideEffects'.
	self assert: recompile newSource includesSubstring: '^count'.
	self deny: recompile newSource includesSubstring: 'self yourself'
]

{ #category : 'tests - staging' }
GsExtractMethodRefactoringTest >> testExtractsArgumentsAndReturnValue [
	| ref cs add recompile |
	ref := self extractFrom: self baseFixture selector: #combine:with:
		select: 'r := a + b. r := r * a' newSelector: 'sumScaledA:b:'.
	cs := ref changeSet.
	add := self addChangeIn: cs.
	recompile := self recompileFor: #combine:with: in: cs.

	self assert: (ref argNames asArray) equals: #('a' 'b').
	self assert: ref returnVar equals: 'r'.
	"new method takes the two read arguments and declares + returns r"
	self assert: add newSource includesSubstring: 'sumScaledA: a b: b'.
	self assert: add newSource includesSubstring: '| r |'.
	self assert: add newSource includesSubstring: 'r := a + b'.
	self assert: add newSource includesSubstring: '^ r'.
	"call site assigns the return to r"
	self assert: recompile newSource includesSubstring: 'r := self sumScaledA: a b: b'.
	self assert: recompile newSource includesSubstring: '^r'
]

{ #category : 'tests - staging' }
GsExtractMethodRefactoringTest >> testExtractsSingleExpressionWithNoArguments [
	| cs add recompile |
	cs := (self extractFrom: self baseFixture selector: #computeArea
		select: 'count * count' newSelector: 'areaValue') changeSet.
	add := self addChangeIn: cs.
	recompile := self recompileFor: #computeArea in: cs.

	self assert: add newSource includesSubstring: '^ count * count'.
	"The send replaces a whole return value, so no parentheses are added."
	self assert: recompile newSource includesSubstring: '^self areaValue'.
	self deny: recompile newSource includesSubstring: '(self areaValue)'
]

{ #category : 'tests - staging' }
GsExtractMethodRefactoringTest >> testExtractsSingleExpressionWithAnArgument [
	| ref cs add |
	ref := self extractFrom: self baseFixture selector: #scaleBy:
		select: 'count * factor' newSelector: 'scaled:'.
	cs := ref changeSet.
	add := self addChangeIn: cs.

	self assert: (ref argNames asArray) equals: #('factor').
	self assert: add newSource includesSubstring: 'scaled: factor'.
	self assert: add newSource includesSubstring: '^ count * factor'.
	"A keyword send replacing a whole return value needs no parentheses."
	self assert: (self recompileFor: #scaleBy: in: cs) newSource includesSubstring: '^self scaled: factor'.
	self deny: (self recompileFor: #scaleBy: in: cs) newSource includesSubstring: '(self scaled: factor)'
]

{ #category : 'tests - staging' }
GsExtractMethodRefactoringTest >> testExpressionThatIsASubExpressionKeepsParentheses [
	"Extracting a sub-expression (a binary operand) into a keyword send DOES need
	 parentheses to preserve precedence: 1 + (n * n) -> 1 + (self squared: n)."
	| cs |
	cs := (self extractFrom: self baseFixture selector: #subExprArg:
		select: 'n * n' newSelector: 'squared:') changeSet.

	self assert: (self recompileFor: #subExprArg: in: cs) newSource includesSubstring: '(self squared: n)'
]

{ #category : 'tests - staging' }
GsExtractMethodRefactoringTest >> testTemporaryUsedOnlyInsideIsMovedIntoNewMethod [
	| cs add recompile |
	cs := (self extractFrom: self baseFixture selector: #report
		select: 'tmp := self hash. tmp printString' newSelector: 'doReport') changeSet.
	add := self addChangeIn: cs.
	recompile := self recompileFor: #report in: cs.

	self assert: add newSource includesSubstring: '| tmp |'.
	self assert: add newSource includesSubstring: 'tmp := self hash'.
	"the temporary is gone from the original method"
	self deny: recompile newSource includesSubstring: 'tmp'.
	self assert: recompile newSource includesSubstring: 'self doReport'
]

{ #category : 'tests - staging' }
GsExtractMethodRefactoringTest >> testSelectionIncludingLeadingWhitespaceStillResolves [
	"A selection that starts in the whitespace before the first statement (e.g. the
	 user dragged from column 0) must still extract -- only whole-statement containment
	 matters, not where the selection begins relative to the sequence."
	| cs |
	cs := (self extractFrom: self baseFixture selector: #doStuff
		select: ' self yourself. self hash' newSelector: 'sideEffects') changeSet.

	self assert: cs size equals: 2.
	self assert: (self addChangeIn: cs) notNil
]

{ #category : 'tests - staging' }
GsExtractMethodRefactoringTest >> testStagesMethodAddThenRecompileForTwoCoreChanges [
	| cs |
	cs := (self extractFrom: self baseFixture selector: #doStuff
		select: 'self yourself. self hash' newSelector: 'sideEffects') changeSet.

	self assert: cs size equals: 2.
	self assert: (cs changes at: 1) kind equals: #methodAdd.
	self assert: (cs changes at: 2) kind equals: #methodRecompile
]

{ #category : 'tests - staging' }
GsExtractMethodRefactoringTest >> testBuildingTheChangeSetChangesNoSourceAndDoesNotCommit [
	| before |
	before := System needsCommit.
	(self extractFrom: self baseFixture selector: #doStuff
		select: 'self yourself. self hash' newSelector: 'sideEffects') changeSet.

	"the stored source is untouched: building the preview compiles nothing"
	self assert: (self baseFixture compiledMethodAt: #doStuff) sourceString
		includesSubstring: 'self yourself. self hash'.
	self assert: System needsCommit equals: before
]

{ #category : 'tests - decline' }
GsExtractMethodRefactoringTest >> testSelectionContainingReturnIsDeclined [
	| ref |
	ref := self extractFrom: self baseFixture selector: #guard
		select: 'self yourself. true ifTrue: [^1]' newSelector: 'checkGuard'.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsExtractMethodRefactoringTest >> testSelectionSendingToSuperIsDeclined [
	| ref |
	ref := self extractFrom: self baseFixture selector: #callsSuper
		select: 'super hash' newSelector: 'superHashValue'.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsExtractMethodRefactoringTest >> testSelectionAssigningTwoVariablesUsedLaterIsDeclined [
	| ref |
	ref := self extractFrom: self baseFixture selector: #twoOut
		select: 'a := 1. b := 2' newSelector: 'initAB'.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsExtractMethodRefactoringTest >> testSelectionNotOnWholeStatementsIsDeclined [
	| ref |
	ref := GsExtractMethodRefactoring
		class: self baseFixture selector: #doStuff meta: false
		selStart: 1 selStop: 1 newSelector: 'nope'.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsExtractMethodRefactoringTest >> testSelectorArityMismatchIsDeclined [
	"combine's selection needs two arguments; a unary selector cannot host it."
	| ref |
	ref := self extractFrom: self baseFixture selector: #combine:with:
		select: 'r := a + b. r := r * a' newSelector: 'oneWord'.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsExtractMethodRefactoringTest >> testNewSelectorSameAsSourceMethodIsDeclined [
	"Naming the extracted method after the method being extracted from would make the
	 rewritten original call itself -- a hard decline, not the soft collision warning."
	| ref |
	ref := self extractFrom: self baseFixture selector: #doStuff
		select: 'self yourself. self hash' newSelector: 'doStuff'.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - collision' }
GsExtractMethodRefactoringTest >> testSelectorAlreadyInHierarchyIsASoftWarningNotADecline [
	"hash is implemented by Object (a superclass); extracting to it warns but is still
	 offered -- the change set is built."
	| ref |
	ref := self extractFrom: self baseFixture selector: #doStuff
		select: 'self yourself. self hash' newSelector: 'hash'.

	self assert: ref collisionWarning notNil.
	self assert: ref declineReason isNil.
	self assert: ref changeSet size equals: 2
]

{ #category : 'tests - similar' }
GsExtractMethodRefactoringTest >> testReplaceSimilarFindsEquivalentRunsInHierarchy [
	| ref cs selectors |
	ref := self extractFrom: self baseFixture selector: #doStuff
		select: 'self yourself. self hash' newSelector: 'sideEffects'.
	ref replaceSimilar: true.
	cs := ref changeSet.
	selectors := self recompileSelectorsIn: cs.

	self assert: (selectors includes: #helperA).
	self assert: (selectors includes: #helperB).
	self assert: (selectors includes: #helperC).
	"a near-miss (self identityHash) is NOT rewritten"
	self deny: (selectors includes: #helperX).
	"...and the new method + the original rewrite are still there"
	self assert: (self addChangeIn: cs) notNil.
	self assert: (selectors includes: #doStuff)
]

{ #category : 'tests - similar' }
GsExtractMethodRefactoringTest >> testReplaceSimilarMapsArgumentsPerSite [
	| ref cs |
	ref := self extractFrom: self baseFixture selector: #scaleSrc:
		select: 'self yourself. n printString' newSelector: 'doScale:'.
	ref replaceSimilar: true.
	cs := ref changeSet.

	self assert: (self recompileFor: #scaleA: in: cs) newSource includesSubstring: 'self doScale: n'.
	self assert: (self recompileFor: #scaleB: in: cs) newSource includesSubstring: 'self doScale: m'
]

{ #category : 'tests - similar' }
GsExtractMethodRefactoringTest >> testReplaceSimilarIsOffByDefault [
	| cs |
	cs := (self extractFrom: self baseFixture selector: #doStuff
		select: 'self yourself. self hash' newSelector: 'sideEffects') changeSet.

	self assert: cs size equals: 2
]

{ #category : 'tests - similar' }
GsExtractMethodRefactoringTest >> testReplaceSimilarSkippedForValueReturningExtraction [
	"combine returns a value, so it is not a safe void shape -- no duplicate pass."
	| ref cs |
	ref := self extractFrom: self baseFixture selector: #combine:with:
		select: 'r := a + b. r := r * a' newSelector: 'sumScaledA:b:'.
	ref replaceSimilar: true.
	cs := ref changeSet.

	self assert: cs size equals: 2
]

{ #category : 'tests - preview' }
GsExtractMethodRefactoringTest >> testPreviewJsonSerializesBothCoreChanges [
	| json |
	json := (self extractFrom: self baseFixture selector: #doStuff
		select: 'self yourself. self hash' newSelector: 'sideEffects') previewJsonString.

	self assert: json includesSubstring: 'methodAdd'.
	self assert: json includesSubstring: 'methodRecompile'
]

{ #category : 'tests - preview' }
GsExtractMethodRefactoringTest >> testStartPreviewCarriesTotalsAndSelectorAndFirstPage [
	| json |
	json := (self extractFrom: self baseFixture selector: #doStuff
		select: 'self yourself. self hash' newSelector: 'sideEffects')
		startPreviewToken: 'm1Tok' maxBytes: 100000.
	[self assert: json includesSubstring: '"newSelector":"sideEffects"'.
	 self assert: json includesSubstring: '"total":2'.
	 self assert: json includesSubstring: '"changes":']
		ensure: [GsExtractMethodRefactoring clearToken: 'm1Tok']
]

{ #category : 'tests - preview' }
GsExtractMethodRefactoringTest >> testAnalysisPreflightReportsArgumentsAndSafeShape [
	| json |
	json := GsExtractMethodRefactoring
		analyzeSelectionForClass: self baseFixture selector: #doStuff meta: false
		selStart: ((self baseFixture compiledMethodAt: #doStuff) sourceString
			indexOfSubCollection: 'self yourself. self hash')
		selStop: ((self baseFixture compiledMethodAt: #doStuff) sourceString
			indexOfSubCollection: 'self yourself. self hash') + 'self yourself. self hash' size - 1.

	self assert: json includesSubstring: '"argCount":0'.
	self assert: json includesSubstring: '"safeVoidShape":true'.
	self assert: json includesSubstring: '"decline":null'
]

{ #category : 'tests - apply' }
GsExtractMethodRefactoringTest >> testApplyCreatesNewMethodAndRewritesOriginal [
	(self extractFrom: self baseFixture selector: #doStuff
		select: 'self yourself. self hash' newSelector: 'sideEffects') applyDeselected: #().

	self assert: (self baseFixture includesSelector: #sideEffects).
	self assert: (self baseFixture compiledMethodAt: #sideEffects) sourceString
		includesSubstring: 'self yourself'.
	self assert: (self baseFixture compiledMethodAt: #sideEffects) sourceString
		includesSubstring: 'self hash'.
	self assert: (self baseFixture compiledMethodAt: #doStuff) sourceString
		includesSubstring: 'self sideEffects'
]

{ #category : 'tests - apply' }
GsExtractMethodRefactoringTest >> testTokenRoundTripStartThenApplyRecompilesBothMethods [
	"The client path: startPreviewToken stashes the refactoring under a token; a later
	 applyForToken:deselected: retrieves and applies it. No commit."
	| ref json before |
	before := System needsCommit.
	ref := self extractFrom: self baseFixture selector: #doStuff
		select: 'self yourself. self hash' newSelector: 'sideEffects'.
	ref startPreviewToken: 'm1rt' maxBytes: 100000.
	[json := GsExtractMethodRefactoring applyForToken: 'm1rt' deselected: #().
	 self assert: json includesSubstring: '"applied":2'.
	 self assert: (self baseFixture includesSelector: #sideEffects).
	 self assert: System needsCommit equals: before]
		ensure: [GsExtractMethodRefactoring clearToken: 'm1rt']
]

{ #category : 'tests - apply' }
GsExtractMethodRefactoringTest >> testPageForTokenReturnsAPageForALiveSession [
	| ref json |
	ref := self extractFrom: self baseFixture selector: #doStuff
		select: 'self yourself. self hash' newSelector: 'sideEffects'.
	ref startPreviewToken: 'm1pg' maxBytes: 100000.
	[json := GsExtractMethodRefactoring pageForToken: 'm1pg' from: 1 maxBytes: 100000.
	 self assert: json includesSubstring: '"changes":']
		ensure: [GsExtractMethodRefactoring clearToken: 'm1pg']
]

{ #category : 'tests - apply' }
GsExtractMethodRefactoringTest >> testPageForTokenOnAnExpiredSessionAnswersAnError [
	self assert: (GsExtractMethodRefactoring pageForToken: 'nope' from: 1 maxBytes: 100)
		includesSubstring: 'expired'
]

{ #category : 'tests - apply' }
GsExtractMethodRefactoringTest >> testApplyForTokenOnAnExpiredSessionAnswersAnError [
	self assert: (GsExtractMethodRefactoring applyForToken: 'nope' deselected: #())
		includesSubstring: 'expired'
]

{ #category : 'tests - apply' }
GsExtractMethodRefactoringTest >> testApplyReturnsAppliedCountAndNoFailures [
	| json |
	json := (self extractFrom: self baseFixture selector: #doStuff
		select: 'self yourself. self hash' newSelector: 'sideEffects') applyDeselected: #().

	self assert: json includesSubstring: '"applied":2'.
	self assert: json includesSubstring: '"failed":[]'
]

{ #category : 'tests - apply' }
GsExtractMethodRefactoringTest >> testApplyDoesNotCommit [
	| before |
	before := System needsCommit.
	(self extractFrom: self baseFixture selector: #doStuff
		select: 'self yourself. self hash' newSelector: 'sideEffects') applyDeselected: #().

	self assert: System needsCommit equals: before
]

{ #category : 'tests - apply' }
GsExtractMethodRefactoringTest >> testApplyHonoursDuplicateDeselectionButNotCoreChanges [
	"Deselecting a duplicate-replacement change skips only that site; the two core
	 changes always apply."
	| ref cs dupId |
	ref := self extractFrom: self baseFixture selector: #doStuff
		select: 'self yourself. self hash' newSelector: 'sideEffects'.
	ref replaceSimilar: true.
	cs := ref changeSet.
	dupId := (cs changes detect: [:c | c kind = #methodRecompile and: [c selector = #helperA]]) id.
	ref applyDeselected: (Array with: dupId).

	"core changes applied"
	self assert: (self baseFixture includesSelector: #sideEffects).
	self assert: (self baseFixture compiledMethodAt: #doStuff) sourceString
		includesSubstring: 'self sideEffects'.
	"the deselected duplicate is untouched"
	self assert: (self baseFixture compiledMethodAt: #helperA) sourceString
		includesSubstring: 'self yourself. self hash'.
	"a non-deselected duplicate WAS rewritten"
	self assert: (self baseFixture compiledMethodAt: #helperB) sourceString
		includesSubstring: 'self sideEffects'
]
