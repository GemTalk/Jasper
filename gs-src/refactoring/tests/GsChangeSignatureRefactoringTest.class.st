"
Correctness of the change-signature refactoring (M5 -- add / remove / reorder
parameters):

  - REORDER: keyword parts and their arguments move together, in the implementor
    signature and at every call site; the body binds arguments by name, unchanged;
  - ADD: a new keyword part + argument is inserted in the signature (the new
    argument is unused in the body) and every send supplies the caller default;
    a unary or binary selector can gain a keyword and become keyword;
  - REMOVE: an UNUSED parameter is dropped from the signature and its argument is
    dropped at every send; removing a USED parameter DECLINES (naming the class);
    a one-argument keyword selector can lose its argument and become unary;
  - a collision (the new selector already names a different method on the class)
    is surfaced (blocks Apply);
  - scope (#class / #hierarchy / #wholeSystem) selects the affected implementors
    and senders, and the out-of-scope remainder is counted;
  - the selector spelling inside a comment or string literal is NEVER rewritten;
  - super-sends and cascades are rewritten;
  - implementors are staged as #methodRename, senders as #methodRecompile;
  - building the change set compiles nothing and commits nothing;
  - the paginated preview is byte-bounded, and the server-side apply compiles new
    / removes old for every change except the deselected ones, without committing;
  - the pre-flight analyze answers the current selector kind, arity, and argument
    names so the client can pre-populate the signature editor.

setUp builds a throwaway hierarchy plus an unrelated sender class in UserGlobals
and tearDown removes them. Fixture selectors are spellings unique to the fixture
(movePointX:y:, csPing, ~>, csComputeWith:unused:, ...), so an image-wide
implementor/sender search finds only the fixture.
"
Class {
	#name : 'GsChangeSignatureRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsChangeSignatureRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'asserting' }
GsChangeSignatureRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsChangeSignatureRefactoringTest >> baseFixture [
	^UserGlobals at: #GsCSBase
]

{ #category : 'fixture' }
GsChangeSignatureRefactoringTest >> subFixture [
	^UserGlobals at: #GsCSSub
]

{ #category : 'fixture' }
GsChangeSignatureRefactoringTest >> compile: aSource in: aClass [
	aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture'
]

{ #category : 'fixture' }
GsChangeSignatureRefactoringTest >> implementorChangeFor: aClassName in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodRename and: [c className asString = aClassName asString]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsChangeSignatureRefactoringTest >> senderChangeFor: aSelector in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodRecompile and: [c selector asString = aSelector asString]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsChangeSignatureRefactoringTest >> changePartsTo: partsArray permutation: permArray argNames: namesArray defaults: defArray scope: scopeSymbol [
	"A change to the fixture's #movePointX:y: with the given signature spec."
	^GsChangeSignatureRefactoring
		class: self baseFixture
		meta: false
		changeSelector: #'movePointX:y:'
		toParts: partsArray
		permutation: permArray
		argNames: namesArray
		defaults: defArray
		scope: scopeSymbol
]

{ #category : 'running' }
GsChangeSignatureRefactoringTest >> setUp [
	| base sub other |
	super setUp.
	base := Object
		subclass: 'GsCSBase'
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := base
		subclass: 'GsCSSub'
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	other := Object
		subclass: 'GsCSOther'
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'movePointX: x y: y
	"moves the point -- mentions movePointX:y: in this comment"
	^Array with: x with: y' in: base.
	self compile: 'csPing
	^1' in: base.
	self compile: '~> aThing
	^aThing' in: base.
	self compile: 'caller
	"a caller of movePointX:y: and csPing"
	self csPing.
	^self movePointX: 1 y: 2' in: base.
	self compile: 'cascadeCaller
	^self movePointX: 1 y: 2; csPing; yourself' in: base.
	self compile: 'useBinary
	^self ~> 5' in: base.
	self compile: 'csComputeWith: a unused: b
	^a * 2' in: base.
	self compile: 'useCompute
	^self csComputeWith: 5 unused: 9' in: base.
	self compile: 'csSumA: a b: b
	^a + b' in: base.
	self compile: 'csDescribe: aThing
	^42' in: base.
	self compile: 'useDescribe
	^self csDescribe: 7' in: base.
	self compile: 'existing: p two: q
	^p' in: base.
	self compile: 'movePointX: x y: y
	^super movePointX: x y: y' in: sub.
	self compile: 'usePoint
	^GsCSBase new movePointX: 3 y: 4' in: other
]

{ #category : 'running' }
GsChangeSignatureRefactoringTest >> tearDown [
	#('GsCSSub' 'GsCSOther' 'GsCSBase')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []].
	super tearDown
]

{ #category : 'tests - reorder' }
GsChangeSignatureRefactoringTest >> testReorderKeywordImplementorSignature [
	| change |
	change := self implementorChangeFor: 'GsCSBase'
		in: (self changePartsTo: #('moveY:' 'x:') permutation: #(2 1)
			argNames: #('' '') defaults: #('' '') scope: #class) changeSet.

	self assert: change newSource includesSubstring: 'moveY: y x: x'.
	"The body still binds x and y by name, unchanged."
	self assert: change newSource includesSubstring: '^Array with: x with: y'
]

{ #category : 'tests - reorder' }
GsChangeSignatureRefactoringTest >> testReorderKeywordSenderArguments [
	| change |
	change := self senderChangeFor: #caller
		in: (self changePartsTo: #('moveY:' 'x:') permutation: #(2 1)
			argNames: #('' '') defaults: #('' '') scope: #class) changeSet.

	self assert: change newSource includesSubstring: 'self moveY: 2 x: 1'.
	self deny: change newSource includesSubstring: 'self movePointX:'
]

{ #category : 'tests - reorder' }
GsChangeSignatureRefactoringTest >> testCommentSpellingIsNotRewritten [
	| impl |
	impl := self implementorChangeFor: 'GsCSBase'
		in: (self changePartsTo: #('moveY:' 'x:') permutation: #(2 1)
			argNames: #('' '') defaults: #('' '') scope: #class) changeSet.

	self assert: impl newSource includesSubstring: 'mentions movePointX:y: in this comment'
]

{ #category : 'tests - reorder' }
GsChangeSignatureRefactoringTest >> testSuperSendIsRewritten [
	| change |
	change := self implementorChangeFor: 'GsCSSub'
		in: (self changePartsTo: #('moveY:' 'x:') permutation: #(2 1)
			argNames: #('' '') defaults: #('' '') scope: #hierarchy) changeSet.

	self assert: change notNil.
	self assert: change newSource includesSubstring: 'super moveY: y x: x'
]

{ #category : 'tests - reorder' }
GsChangeSignatureRefactoringTest >> testCascadeSendIsRewritten [
	| change |
	change := self senderChangeFor: #cascadeCaller
		in: (self changePartsTo: #('moveY:' 'x:') permutation: #(2 1)
			argNames: #('' '') defaults: #('' '') scope: #wholeSystem) changeSet.

	self assert: change notNil.
	self assert: change newSource includesSubstring: 'moveY: 2 x: 1'.
	self deny: change newSource includesSubstring: 'movePointX:'
]

{ #category : 'tests - add' }
GsChangeSignatureRefactoringTest >> testAddParameterToKeywordImplementor [
	| change |
	change := self implementorChangeFor: 'GsCSBase'
		in: (self changePartsTo: #('movePointX:' 'y:' 'z:') permutation: #(1 2 0)
			argNames: #('x' 'y' 'z') defaults: #('' '' 'nil') scope: #class) changeSet.

	self assert: change newSelector asString equals: 'movePointX:y:z:'.
	self assert: change newSource includesSubstring: 'z: z'.
	"The new parameter is unused in the body, which is otherwise unchanged."
	self assert: change newSource includesSubstring: '^Array with: x with: y'
]

{ #category : 'tests - add' }
GsChangeSignatureRefactoringTest >> testAddParameterToKeywordSenderSuppliesDefault [
	| change |
	change := self senderChangeFor: #caller
		in: (self changePartsTo: #('movePointX:' 'y:' 'z:') permutation: #(1 2 0)
			argNames: #('x' 'y' 'z') defaults: #('' '' 'nil') scope: #class) changeSet.

	self assert: change newSource includesSubstring: 'movePointX: 1 y: 2 z: nil'
]

{ #category : 'tests - add' }
GsChangeSignatureRefactoringTest >> testAddParameterToUnaryBecomesKeyword [
	| cs impl sender |
	cs := (GsChangeSignatureRefactoring
		class: self baseFixture meta: false changeSelector: #csPing
		toParts: #('csPingWith:') permutation: #(0)
		argNames: #('n') defaults: #('42') scope: #wholeSystem) changeSet.
	impl := self implementorChangeFor: 'GsCSBase' in: cs.
	sender := self senderChangeFor: #caller in: cs.

	self assert: impl newSelector asString equals: 'csPingWith:'.
	self assert: impl newSource includesSubstring: 'csPingWith: n'.
	self assert: sender newSource includesSubstring: 'self csPingWith: 42'
]

{ #category : 'tests - add' }
GsChangeSignatureRefactoringTest >> testAddParameterToBinaryBecomesKeyword [
	| cs impl sender |
	cs := (GsChangeSignatureRefactoring
		class: self baseFixture meta: false changeSelector: #'~>'
		toParts: #('combineWith:' 'and:') permutation: #(1 0)
		argNames: #('aThing' 'other') defaults: #('' '0') scope: #wholeSystem) changeSet.
	impl := self implementorChangeFor: 'GsCSBase' in: cs.
	sender := self senderChangeFor: #useBinary in: cs.

	self assert: impl newSelector asString equals: 'combineWith:and:'.
	self assert: impl newSource includesSubstring: 'combineWith: aThing and: other'.
	self assert: sender newSource includesSubstring: 'self combineWith: 5 and: 0'
]

{ #category : 'tests - remove' }
GsChangeSignatureRefactoringTest >> testRemoveUnusedParameterFromImplementor [
	| impl |
	impl := self implementorChangeFor: 'GsCSBase'
		in: (GsChangeSignatureRefactoring
			class: self baseFixture meta: false changeSelector: #'csComputeWith:unused:'
			toParts: #('csComputeWith:') permutation: #(1)
			argNames: #('a') defaults: #('') scope: #wholeSystem) changeSet.

	self assert: impl newSelector asString equals: 'csComputeWith:'.
	self assert: impl newSource includesSubstring: 'csComputeWith: a'.
	self deny: impl newSource includesSubstring: 'unused:'.
	self assert: impl newSource includesSubstring: '^a * 2'
]

{ #category : 'tests - remove' }
GsChangeSignatureRefactoringTest >> testRemoveUnusedParameterDropsSenderArgument [
	| sender |
	sender := self senderChangeFor: #useCompute
		in: (GsChangeSignatureRefactoring
			class: self baseFixture meta: false changeSelector: #'csComputeWith:unused:'
			toParts: #('csComputeWith:') permutation: #(1)
			argNames: #('a') defaults: #('') scope: #wholeSystem) changeSet.

	self assert: sender newSource includesSubstring: 'self csComputeWith: 5'.
	self deny: sender newSource includesSubstring: 'unused:'.
	self deny: sender newSource includesSubstring: '9'
]

{ #category : 'tests - remove' }
GsChangeSignatureRefactoringTest >> testRemoveUsedParameterIsDeclined [
	| ref |
	ref := GsChangeSignatureRefactoring
		class: self baseFixture meta: false changeSelector: #'csSumA:b:'
		toParts: #('csSumA:') permutation: #(1)
		argNames: #('a') defaults: #('') scope: #wholeSystem.

	self assert: ref declineReason notNil.
	self assert: ref declineReason includesSubstring: 'used'.
	self assert: ref changeSet changes isEmpty
]

{ #category : 'tests - remove' }
GsChangeSignatureRefactoringTest >> testRemoveOnlyParameterBecomesUnary [
	| cs impl sender |
	cs := (GsChangeSignatureRefactoring
		class: self baseFixture meta: false changeSelector: #'csDescribe:'
		toParts: #('csDescribe') permutation: #()
		argNames: #() defaults: #() scope: #wholeSystem) changeSet.
	impl := self implementorChangeFor: 'GsCSBase' in: cs.
	sender := self senderChangeFor: #useDescribe in: cs.

	self assert: impl newSelector asString equals: 'csDescribe'.
	self assert: sender newSource includesSubstring: 'self csDescribe'.
	self deny: sender newSource includesSubstring: 'csDescribe: 7'
]

{ #category : 'tests - preconditions' }
GsChangeSignatureRefactoringTest >> testCollisionWhenNewSelectorAlreadyExists [
	| ref |
	ref := self changePartsTo: #('existing:' 'two:') permutation: #(1 2)
		argNames: #('' '') defaults: #('' '') scope: #class.

	self assert: ref newSelectorCollision notNil.
	self assert: ref newSelectorCollision includesSubstring: 'existing:two:'
]

{ #category : 'tests - preconditions' }
GsChangeSignatureRefactoringTest >> testDuplicateArgumentNameIsDeclined [
	"Adding a new parameter named the same as a kept argument is declined."
	| ref |
	ref := self changePartsTo: #('movePointX:' 'y:' 'z:') permutation: #(1 2 0)
		argNames: #('x' 'y' 'x') defaults: #('' '' 'nil') scope: #class.

	self assert: ref declineReason notNil.
	self assert: ref declineReason includesSubstring: 'same name'
]

{ #category : 'tests - scope' }
GsChangeSignatureRefactoringTest >> testClassScopeExcludesSubclassAndUnrelatedSenders [
	| ref cs |
	ref := self changePartsTo: #('moveY:' 'x:') permutation: #(2 1)
		argNames: #('' '') defaults: #('' '') scope: #class.
	cs := ref changeSet.

	self assert: (self implementorChangeFor: 'GsCSBase' in: cs) notNil.
	self assert: (self implementorChangeFor: 'GsCSSub' in: cs) isNil.
	self assert: ref outOfScopeImplementorCount equals: 1.
	self assert: ((cs changes anySatisfy: [:c | c className asString = 'GsCSOther']) not).
	self assert: ref outOfScopeSenderCount >= 1
]

{ #category : 'tests - scope' }
GsChangeSignatureRefactoringTest >> testHierarchyScopeIncludesSubclassExcludesUnrelated [
	| cs |
	cs := (self changePartsTo: #('moveY:' 'x:') permutation: #(2 1)
		argNames: #('' '') defaults: #('' '') scope: #hierarchy) changeSet.

	self assert: (self implementorChangeFor: 'GsCSBase' in: cs) notNil.
	self assert: (self implementorChangeFor: 'GsCSSub' in: cs) notNil.
	self assert: ((cs changes anySatisfy: [:c | c className asString = 'GsCSOther']) not)
]

{ #category : 'tests - staging' }
GsChangeSignatureRefactoringTest >> testImplementorStagedAsRenameSenderAsRecompile [
	| cs impl sender |
	cs := (self changePartsTo: #('moveY:' 'x:') permutation: #(2 1)
		argNames: #('' '') defaults: #('' '') scope: #wholeSystem) changeSet.
	impl := self implementorChangeFor: 'GsCSBase' in: cs.
	sender := self senderChangeFor: #caller in: cs.

	self assert: impl kind equals: #methodRename.
	self assert: impl selector asString equals: 'movePointX:y:'.
	self assert: impl newSelector asString equals: 'moveY:x:'.
	self assert: sender kind equals: #methodRecompile.
	self assert: sender newSelector isNil
]

{ #category : 'tests - staging' }
GsChangeSignatureRefactoringTest >> testBuildingChangeSetDoesNotCommit [
	| before |
	before := System needsCommit.
	(self changePartsTo: #('moveY:' 'x:') permutation: #(2 1)
		argNames: #('' '') defaults: #('' '') scope: #wholeSystem) changeSet.

	self assert: (self baseFixture compiledMethodAt: #'movePointX:y:' environmentId: 0 otherwise: nil) notNil.
	self assert: System needsCommit equals: before
]

{ #category : 'tests - apply' }
GsChangeSignatureRefactoringTest >> testServerSideApplyReorderCompilesNewAndRemovesOld [
	| ref base |
	ref := self changePartsTo: #('moveY:' 'x:') permutation: #(2 1)
		argNames: #('' '') defaults: #('' '') scope: #class.
	ref applyDeselected: #().
	base := self baseFixture.

	self assert: (base compiledMethodAt: #'moveY:x:' environmentId: 0 otherwise: nil) notNil.
	self assert: (base compiledMethodAt: #'movePointX:y:' environmentId: 0 otherwise: nil) isNil.
	self assert: (base compiledMethodAt: #caller environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'moveY: 2 x: 1'
]

{ #category : 'tests - apply' }
GsChangeSignatureRefactoringTest >> testServerSideApplyAddParameter [
	| ref base |
	ref := self changePartsTo: #('movePointX:' 'y:' 'z:') permutation: #(1 2 0)
		argNames: #('x' 'y' 'z') defaults: #('' '' 'nil') scope: #class.
	ref applyDeselected: #().
	base := self baseFixture.

	self assert: (base compiledMethodAt: #'movePointX:y:z:' environmentId: 0 otherwise: nil) notNil.
	self assert: (base compiledMethodAt: #'movePointX:y:' environmentId: 0 otherwise: nil) isNil.
	self assert: (base compiledMethodAt: #caller environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'movePointX: 1 y: 2 z: nil'
]

{ #category : 'tests - apply' }
GsChangeSignatureRefactoringTest >> testServerSideApplyRemoveUnusedParameter [
	| ref base |
	ref := GsChangeSignatureRefactoring
		class: self baseFixture meta: false changeSelector: #'csComputeWith:unused:'
		toParts: #('csComputeWith:') permutation: #(1)
		argNames: #('a') defaults: #('') scope: #wholeSystem.
	ref applyDeselected: #().
	base := self baseFixture.

	self assert: (base compiledMethodAt: #'csComputeWith:' environmentId: 0 otherwise: nil) notNil.
	self assert: (base compiledMethodAt: #'csComputeWith:unused:' environmentId: 0 otherwise: nil) isNil.
	self assert: (base compiledMethodAt: #useCompute environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'csComputeWith: 5'
]

{ #category : 'tests - apply' }
GsChangeSignatureRefactoringTest >> testServerSideApplyHonoursDeselection [
	| ref base senderId |
	ref := self changePartsTo: #('moveY:' 'x:') permutation: #(2 1)
		argNames: #('' '') defaults: #('' '') scope: #class.
	senderId := (self senderChangeFor: #caller in: ref changeSet) id.
	ref applyDeselected: (Array with: senderId).
	base := self baseFixture.

	self assert: (base compiledMethodAt: #'moveY:x:' environmentId: 0 otherwise: nil) notNil.
	self assert: (base compiledMethodAt: #caller environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'movePointX: 1 y: 2'
]

{ #category : 'tests - preview' }
GsChangeSignatureRefactoringTest >> testPaginationReturnsBoundedPagesWithOffsets [
	| ref total firstPage lastPage |
	ref := self changePartsTo: #('moveY:' 'x:') permutation: #(2 1)
		argNames: #('' '') defaults: #('' '') scope: #wholeSystem.
	total := ref changeSet size.
	self assert: total > 1.

	firstPage := ref pageJsonFrom: 1 maxBytes: 1.
	self assert: firstPage includesSubstring: '"nextOffset":2'.
	self assert: firstPage includesSubstring: '"done":false'.

	lastPage := ref pageJsonFrom: total maxBytes: 1000000.
	self assert: lastPage includesSubstring: '"done":true'
]

{ #category : 'tests - preview' }
GsChangeSignatureRefactoringTest >> testPreviewJsonStringSerializesBothKinds [
	| json |
	json := (self changePartsTo: #('moveY:' 'x:') permutation: #(2 1)
		argNames: #('' '') defaults: #('' '') scope: #wholeSystem) previewJsonString.

	self assert: (json isKindOf: String).
	self assert: json includesSubstring: 'methodRename'.
	self assert: json includesSubstring: 'methodRecompile'
]

{ #category : 'tests - preview' }
GsChangeSignatureRefactoringTest >> testStartPreviewTokenSurfacesDecline [
	| json |
	json := (GsChangeSignatureRefactoring
		class: self baseFixture meta: false changeSelector: #'csSumA:b:'
		toParts: #('csSumA:') permutation: #(1)
		argNames: #('a') defaults: #('') scope: #wholeSystem)
			startPreviewToken: 'csTokDecline' maxBytes: 100000.
	GsChangeSignatureRefactoring clearToken: 'csTokDecline'.

	self assert: json includesSubstring: '"decline":"parameter b is used'
]

{ #category : 'tests - analyze' }
GsChangeSignatureRefactoringTest >> testAnalyzeForClassReturnsCurrentSignature [
	| json |
	json := GsChangeSignatureRefactoring
		analyzeForClass: self baseFixture selector: #'movePointX:y:' meta: false.

	self assert: json includesSubstring: '"selectorKind":"keyword"'.
	self assert: json includesSubstring: '"arity":2'.
	self assert: json includesSubstring: '"x"'.
	self assert: json includesSubstring: '"y"'.
	self assert: json includesSubstring: '"decline":null'
]

{ #category : 'tests - analyze' }
GsChangeSignatureRefactoringTest >> testAnalyzeDeclinesMissingMethod [
	| json |
	json := GsChangeSignatureRefactoring
		analyzeForClass: self baseFixture selector: #'noSuchSelector:' meta: false.

	self assert: json includesSubstring: 'no longer exists'
]

{ #category : 'tests - analyze' }
GsChangeSignatureRefactoringTest >> testAnalyzeReportsUnarySelector [
	| json |
	json := GsChangeSignatureRefactoring
		analyzeForClass: self baseFixture selector: #csPing meta: false.

	self assert: json includesSubstring: '"selectorKind":"unary"'.
	self assert: json includesSubstring: '"arity":0'.
	self assert: json includesSubstring: '"argNames":[]'
]
{ #category : 'tests - preconditions' }
GsChangeSignatureRefactoringTest >> testCollisionDetectedAcrossHierarchyImplementors [
	"#1: in #hierarchy/#wholeSystem scope EVERY in-scope implementor is renamed, so a subclass
	 that ALREADY implements the new selector must be flagged -- not only the defining class.
	 GsCSSub implements movePointX:y: (override) AND moveY:x:; renaming movePointX:y: -> moveY:x:
	 in hierarchy scope would overwrite GsCSSub's moveY:x:."
	| ref |
	self compile: 'moveY: yy x: xx
	^Array with: yy with: xx' in: self subFixture.
	ref := self changePartsTo: #('moveY:' 'x:') permutation: #(2 1)
		argNames: #('' '') defaults: #('' '') scope: #hierarchy.

	self assert: ref newSelectorCollision notNil.
	self assert: ref newSelectorCollision includesSubstring: 'GsCSSub'
]

{ #category : 'tests - preconditions' }
GsChangeSignatureRefactoringTest >> testEmptyDefaultForNewParameterIsDeclined [
	"#2: a new parameter with no default would make the sender rewrite throw (and the sender be
	 skipped) while the implementor rename still applies -- a half-apply. Blocked up front."
	| ref |
	ref := GsChangeSignatureRefactoring
		class: self baseFixture meta: false changeSelector: #csPing
		toParts: #('csPingWith:') permutation: #(0)
		argNames: #('n') defaults: #('') scope: #wholeSystem.

	self assert: ref declineReason notNil.
	self assert: ref declineReason includesSubstring: 'default'.
	self assert: ref changeSet changes isEmpty
]

{ #category : 'tests - preconditions' }
GsChangeSignatureRefactoringTest >> testUnparseableDefaultForNewParameterIsDeclined [
	"#2: a new parameter whose default does not parse is declined for the same reason."
	| ref |
	ref := GsChangeSignatureRefactoring
		class: self baseFixture meta: false changeSelector: #csPing
		toParts: #('csPingWith:') permutation: #(0)
		argNames: #('n') defaults: #('1 +') scope: #wholeSystem.

	self assert: ref declineReason notNil.
	self assert: ref declineReason includesSubstring: 'does not parse'
]

{ #category : 'tests - reorder' }
GsChangeSignatureRefactoringTest >> testMultiLineSenderRegionIsRebuiltOnOneLine [
	"#3: a send written across multiple lines has its selector+args region rebuilt on a single
	 line (an accepted trade-off of the whole-region rewrite); the reorder is still correct."
	| change |
	self compile: 'csMultiCaller
	^self
		movePointX: 111
		y: 222' in: self baseFixture.
	change := self senderChangeFor: #csMultiCaller
		in: (self changePartsTo: #('moveY:' 'x:') permutation: #(2 1)
			argNames: #('' '') defaults: #('' '') scope: #class) changeSet.

	self assert: change notNil.
	self assert: change newSource includesSubstring: 'moveY: 222 x: 111'
]

{ #category : 'tests' }
GsChangeSignatureRefactoringTest >> testDictionaryScopeExcludesSameNamedImplementorInAnotherDictionary [
	"Regression for issue #328 item 9, the change-signature call site. A class name
	 bound in two dictionaries (a shadow) must not restage the sibling's same-named
	 implementor: changing the signature in dictionary A's scope stages ONLY A's
	 implementor, and B's same-named class is counted out of scope. This pins the
	 #dictionary branch of isClassInScope: (delegating to the identity helper
	 GsRefactoringEnvironment>>class:isDefinedInDictionaryNamed:) at THIS call site,
	 not only transitively. Self-contained: the shadow dictionaries are removed in an
	 ensure: so a failure leaks nothing."
	| sl dictA dictB fooA renames ref cs |
	sl := System myUserProfile symbolList.
	dictA := SymbolDictionary new name: #GsCSScopeDictA; yourself.
	dictB := SymbolDictionary new name: #GsCSScopeDictB; yourself.
	[sl add: dictA. sl add: dictB.
	 fooA := Object subclass: 'GsCSShadow'
		instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: dictA.
	 Object subclass: 'GsCSShadow'
		instVarNames: #() classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: dictB.
	 self compile: 'shadowA: a b: b ^1' in: fooA.
	 self compile: 'shadowA: a b: b ^2' in: (dictB at: #GsCSShadow).
	 ref := GsChangeSignatureRefactoring
		class: fooA meta: false changeSelector: #shadowA:b:
		toParts: #('shadowB:' 'a:') permutation: #(2 1)
		argNames: #('' '') defaults: #('' '') dictionaryScope: 'GsCSScopeDictA'.
	 cs := ref changeSet.
	 renames := cs changes select: [:c | c kind == #methodRename].

	 "exactly ONE implementor restaged -- not the shadow sibling too"
	 self assert: renames size equals: 1.
	 "and it is dictionary A's class (body returns 1), never B's (returns 2)"
	 self assert: renames first oldSource includesSubstring: '^1'.
	 self deny: renames first oldSource includesSubstring: '^2'.
	 "B's same-named implementor is counted out of scope, not silently dropped"
	 self assert: ref outOfScopeImplementorCount equals: 1]
		ensure: [
			dictA removeKey: #GsCSShadow ifAbsent: [].
			dictB removeKey: #GsCSShadow ifAbsent: [].
			sl remove: dictA ifAbsent: [].
			sl remove: dictB ifAbsent: []]
]
