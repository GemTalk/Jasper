"
Correctness of the rename-method refactoring:

  - a keyword rename with an argument reorder rewrites the implementor signature
    AND every call site, moving each argument with its keyword;
  - unary and binary selectors rename too;
  - the selector spelling inside a comment or string literal is NEVER rewritten
    (an AST message-node rewrite, not text substitution);
  - super-sends and cascades are rewritten;
  - scope (#class / #hierarchy / #wholeSystem) selects which implementors and
    senders are affected, and the out-of-scope remainder is counted;
  - implementors are staged as #methodRename (compile-new + remove-old), senders
    as #methodRecompile;
  - building the change set compiles nothing and commits nothing;
  - the paginated preview returns byte-bounded pages with a next offset / done
    flag, and the server-side apply compiles new / removes old for all changes
    except the deselected ones, without committing.

setUp builds a throwaway hierarchy plus an unrelated sender class in UserGlobals
and tearDown removes them. The rename target (#movePointX:y:) is a spelling
unique to the fixture, so image-wide implementor/sender search finds only it.
"
Class {
	#name : 'GsRenameMethodRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsRenameMethodRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'fixture' }
GsRenameMethodRefactoringTest >> baseFixture [
	^UserGlobals at: #GsRMBase
]

{ #category : 'fixture' }
GsRenameMethodRefactoringTest >> compile: aSource in: aClass [
	aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture'
]

{ #category : 'asserting' }
GsRenameMethodRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsRenameMethodRefactoringTest >> implementorChangeFor: aClassName in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodRename and: [c className asString = aClassName asString]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsRenameMethodRefactoringTest >> renamePartsTo: partsArray permutation: permArray scope: scopeSymbol [
	"A rename of the fixture's #movePointX:y: to the given parts/permutation."
	^GsRenameMethodRefactoring
		class: self baseFixture
		renameSelector: #'movePointX:y:'
		toParts: partsArray
		permutation: permArray
		scope: scopeSymbol
]

{ #category : 'fixture' }
GsRenameMethodRefactoringTest >> senderChangeFor: aSelector in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodRecompile and: [c selector asString = aSelector asString]]
		ifNone: [nil]
]

{ #category : 'running' }
GsRenameMethodRefactoringTest >> setUp [
	| base sub other |
	super setUp.
	base := Object
		subclass: 'GsRMBase'
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := base
		subclass: 'GsRMSub'
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	other := Object
		subclass: 'GsRMOther'
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'movePointX: x y: y
	"moves the point -- mentions movePointX:y: in this comment"
	^Array with: x with: y' in: base.
	self compile: 'ping
	^1' in: base.
	self compile: '+ aThing
	^aThing' in: base.
	self compile: 'caller
	"a caller of movePointX:y: and ping"
	self ping.
	^self movePointX: 1 y: 2' in: base.
	self compile: 'cascadeCaller
	^self movePointX: 1 y: 2; ping; yourself' in: base.
	self compile: 'movePointX: x y: y
	^super movePointX: x y: y' in: sub.
	self compile: 'usePoint
	^GsRMBase new movePointX: 3 y: 4' in: other
]

{ #category : 'fixture' }
GsRenameMethodRefactoringTest >> subFixture [
	^UserGlobals at: #GsRMSub
]

{ #category : 'running' }
GsRenameMethodRefactoringTest >> tearDown [
	#('GsRMSub' 'GsRMOther' 'GsRMBase' 'GsRMGone')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []].
	super tearDown
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testBinarySelectorRenames [
	| cs change |
	cs := (GsRenameMethodRefactoring
		class: self baseFixture renameSelector: #'+'
		toParts: #('%') permutation: #(1) scope: #class) changeSet.
	change := self implementorChangeFor: 'GsRMBase' in: cs.

	self assert: change notNil.
	self assert: change newSource includesSubstring: '% aThing'.
	self assert: change newSelector asString equals: '%'
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testBuildingChangeSetDoesNotCommit [
	| before |
	before := System needsCommit.
	(self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #wholeSystem) changeSet.

	self assert: (self baseFixture compiledMethodAt: #'movePointX:y:' environmentId: 0 otherwise: nil) notNil.
	self assert: System needsCommit equals: before
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testCascadeSendIsRewritten [
	| change |
	change := self senderChangeFor: #cascadeCaller
		in: (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #wholeSystem) changeSet.

	self assert: change notNil.
	self assert: change newSource includesSubstring: 'moveY: 2 x: 1'.
	self deny: change newSource includesSubstring: 'movePointX:'
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testClassScopeExcludesSubclassAndUnrelatedSenders [
	| ref cs |
	ref := self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #class.
	cs := ref changeSet.

	"Only GsRMBase's implementor is in scope; GsRMSub's override is not."
	self assert: (self implementorChangeFor: 'GsRMBase' in: cs) notNil.
	self assert: (self implementorChangeFor: 'GsRMSub' in: cs) isNil.
	self assert: ref outOfScopeImplementorCount equals: 1.
	"GsRMOther>>usePoint is an out-of-scope sender."
	self assert: ((cs changes anySatisfy: [:c | c className asString = 'GsRMOther']) not).
	self assert: ref outOfScopeSenderCount >= 1
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testCommentSpellingIsNotRewritten [
	| impl sender |
	impl := self implementorChangeFor: 'GsRMBase'
		in: (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #class) changeSet.

	"The implementor's comment names movePointX:y: and must keep it verbatim."
	self assert: impl newSource includesSubstring: 'mentions movePointX:y: in this comment'.
	sender := self senderChangeFor: #caller
		in: (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #class) changeSet.
	self assert: sender newSource includesSubstring: 'a caller of movePointX:y: and ping'
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testHierarchyScopeIncludesSubclassExcludesUnrelated [
	| ref cs |
	ref := self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #hierarchy.
	cs := ref changeSet.

	self assert: (self implementorChangeFor: 'GsRMBase' in: cs) notNil.
	self assert: (self implementorChangeFor: 'GsRMSub' in: cs) notNil.
	self assert: ((cs changes anySatisfy: [:c | c className asString = 'GsRMOther']) not)
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testImplementorStagedAsRenameSenderAsRecompile [
	| cs impl sender |
	cs := (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #wholeSystem) changeSet.
	impl := self implementorChangeFor: 'GsRMBase' in: cs.
	sender := self senderChangeFor: #caller in: cs.

	self assert: impl kind equals: #methodRename.
	self assert: impl selector asString equals: 'movePointX:y:'.
	self assert: impl newSelector asString equals: 'moveY:x:'.
	self assert: sender kind equals: #methodRecompile.
	self assert: sender newSelector isNil
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testKeywordRenameReordersImplementorSignature [
	| change |
	change := self implementorChangeFor: 'GsRMBase'
		in: (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #class) changeSet.

	"Signature reordered: keyword parts + their arguments move together."
	self assert: change newSource includesSubstring: 'moveY: y x: x'.
	"The body still binds x and y by name, unchanged."
	self assert: change newSource includesSubstring: '^Array with: x with: y'
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testKeywordRenameReordersSenderArguments [
	| change |
	change := self senderChangeFor: #caller
		in: (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #class) changeSet.

	self assert: change newSource includesSubstring: 'self moveY: 2 x: 1'.
	"Only the send changes; the comment naming movePointX:y: is preserved, so we
	 check the SEND spelling is gone, not the substring generally."
	self deny: change newSource includesSubstring: 'self movePointX:'
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testPaginationReturnsBoundedPagesWithOffsets [
	| ref total firstPage lastPage |
	ref := self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #wholeSystem.
	total := ref changeSet size.
	self assert: total > 1.

	"maxBytes of 1 forces one change per page (at least one is always emitted)."
	firstPage := ref pageJsonFrom: 1 maxBytes: 1.
	self assert: firstPage includesSubstring: '"nextOffset":2'.
	self assert: firstPage includesSubstring: '"done":false'.

	lastPage := ref pageJsonFrom: total maxBytes: 1000000.
	self assert: lastPage includesSubstring: '"done":true'
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testPreviewJsonStringSerializesBothKinds [
	| json |
	json := (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #wholeSystem) previewJsonString.

	self assert: (json isKindOf: String).
	self assert: json includesSubstring: 'methodRename'.
	self assert: json includesSubstring: 'methodRecompile'
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testServerSideApplyCompilesNewAndRemovesOld [
	| ref base |
	ref := self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #class.
	ref applyDeselected: #().
	base := self baseFixture.

	self assert: (base compiledMethodAt: #'moveY:x:' environmentId: 0 otherwise: nil) notNil.
	self assert: (base compiledMethodAt: #'movePointX:y:' environmentId: 0 otherwise: nil) isNil.
	"The sender was recompiled in place to call the new selector."
	self assert: (base compiledMethodAt: #caller environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'moveY: 2 x: 1'
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testServerSideApplyKeepsTheOldMethodWhenTheNewOneWillNotCompile [
	"The apply compiles the new source and THEN removes the old selector. compileMethod:
	 answers its errors rather than raising, so an unchecked apply deleted the old method
	 without installing its replacement -- outright method loss, reported as success. The
	 sender is made un-compilable by removing a global it was compiled against; the failure
	 must be reported and `caller` must still exist."
	| ref base json |
	UserGlobals at: #GsRMGone put: 7.
	self compile: 'caller
	"a caller of movePointX:y: and ping"
	self ping.
	^(self movePointX: 1 y: 2) , GsRMGone' in: self baseFixture.
	UserGlobals removeKey: #GsRMGone.
	ref := self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #class.

	json := ref applyDeselected: #().
	base := self baseFixture.

	self deny: json includesSubstring: '"failed":[]'.
	self assert: json includesSubstring: 'did not recompile'.
	"Nothing was destroyed on the way: the un-recompilable sender is still installed."
	self assert: (base compiledMethodAt: #caller environmentId: 0 otherwise: nil) notNil.
	"And the rename itself still went through for the implementor."
	self assert: (base compiledMethodAt: #'moveY:x:' environmentId: 0 otherwise: nil) notNil
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testServerSideApplyHonoursDeselection [
	| ref base senderId |
	ref := self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #class.
	senderId := (self senderChangeFor: #caller in: ref changeSet) id.
	ref applyDeselected: (Array with: senderId).
	base := self baseFixture.

	"The implementor was renamed, but the deselected sender was left untouched."
	self assert: (base compiledMethodAt: #'moveY:x:' environmentId: 0 otherwise: nil) notNil.
	self assert: (base compiledMethodAt: #caller environmentId: 0 otherwise: nil) sourceString
		includesSubstring: 'movePointX: 1 y: 2'
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testSuperSendIsRewritten [
	| change |
	change := self implementorChangeFor: 'GsRMSub'
		in: (self renamePartsTo: #('moveY:' 'x:') permutation: #(2 1) scope: #hierarchy) changeSet.

	self assert: change notNil.
	self assert: change newSource includesSubstring: 'super moveY: y x: x'
]

{ #category : 'tests' }
GsRenameMethodRefactoringTest >> testUnarySelectorRenames [
	| cs change |
	cs := (GsRenameMethodRefactoring
		class: self baseFixture renameSelector: #ping
		toParts: #('pong') permutation: #() scope: #class) changeSet.
	change := self implementorChangeFor: 'GsRMBase' in: cs.

	self assert: change notNil.
	self assert: change newSelector asString equals: 'pong'.
	"The sender's #ping send is rewritten to #pong."
	self assert: (self senderChangeFor: #caller in: cs) newSource includesSubstring: 'self pong'
]
