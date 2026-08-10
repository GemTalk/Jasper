"
Tests for GsSplitClassRefactoring (V8 split class / extract class).

Fixture (built in setUp, torn down after): GsSCSource with own ivars keepA keepB extractC extractD
and a subclass GsSCSub. Methods that touch only the extract set are MOVABLE (sumExtract,
readExtractC, writeExtractC:); methods touching the retained set are not (doubleKeep, readKeepB).
Extracting #(extractC extractD) into GsSCComponent is the clean-cut case. Decline tests add a
straddling / super-sending / retained-calling method, or a subclass use, or a bad name.

Fixture names are substring-safe against the decline keywords, and all emitted Smalltalk is ASCII.
"
Class {
	#name : 'GsSplitClassRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'running' }
GsSplitClassRefactoringTest >> setUp [
	| sl src sub |
	sl := System myUserProfile symbolList.
	src := Object
		subclass: 'GsSCSource'
		instVarNames: #('keepA' 'keepB' 'extractC' 'extractD')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	src compileMethod: 'sumExtract ^extractC + extractD' dictionaries: sl category: 'tests'.
	src compileMethod: 'readExtractC ^extractC' dictionaries: sl category: 'tests'.
	src compileMethod: 'writeExtractC: v extractC := v' dictionaries: sl category: 'tests'.
	src compileMethod: 'doubleKeep ^keepA * 2' dictionaries: sl category: 'tests'.
	src compileMethod: 'readKeepB ^keepB' dictionaries: sl category: 'tests'.
	src class compileMethod: 'sourceTag ^42' dictionaries: sl category: 'tests'.
	sub := src
		subclass: 'GsSCSub'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	sub compileMethod: 'subKeep ^keepA' dictionaries: sl category: 'tests'
]

{ #category : 'running' }
GsSplitClassRefactoringTest >> tearDown [
	#(#GsSCSub2 #GsSCSub #GsSCSource #GsSCComponent #GsSplitClassProbe) do: [:nm |
		UserGlobals removeKey: nm ifAbsent: []]
]

{ #category : 'private' }
GsSplitClassRefactoringTest >> source [
	^UserGlobals at: #GsSCSource
]

{ #category : 'private' }
GsSplitClassRefactoringTest >> component [
	^UserGlobals at: #GsSCComponent ifAbsent: [nil]
]

{ #category : 'private' }
GsSplitClassRefactoringTest >> ref [
	"A clean-cut split: extract #(extractC extractD) into GsSCComponent."
	^GsSplitClassRefactoring
		class: self source
		splitIntoClassNamed: 'GsSCComponent'
		extractingInstVars: #('extractC' 'extractD')
		inDictionary: nil
]

{ #category : 'private' }
GsSplitClassRefactoringTest >> compileOnSource: aSource [
	(self source) compileMethod: aSource dictionaries: System myUserProfile symbolList category: 'tests'
]

{ #category : 'private' }
GsSplitClassRefactoringTest >> changeOfKind: aKind for: aClassName in: cs [
	^cs changes detect: [:c | c kind = aKind and: [c className = aClassName]] ifNone: [nil]
]

{ #category : 'private' }
GsSplitClassRefactoringTest >> changeOfKind: aKind for: aClassName in: cs matchingSelector: aSelector [
	^cs changes detect: [:c |
		c kind = aKind and: [c className = aClassName and: [c selector = aSelector]]] ifNone: [nil]
]

{ #category : 'tests - analysis' }
GsSplitClassRefactoringTest >> testAnalyzeComputesMovableMethods [
	| r |
	r := self ref.
	self assert: r decline isNil.
	self assert: r movableSelectors size = 3.
	self assert: (r movableSelectors includes: #readExtractC).
	self assert: (r movableSelectors includes: #sumExtract).
	self deny: (r movableSelectors includes: #doubleKeep)
]

{ #category : 'tests - analysis' }
GsSplitClassRefactoringTest >> testAnalysisJsonReportsMovableCountAndNoDecline [
	| json |
	json := self ref analysisJsonString.
	self assert: (json includesString: '"decline":null').
	self assert: (json includesString: '"movableCount":3')
]

{ #category : 'tests - analysis' }
GsSplitClassRefactoringTest >> testCandidatesListSourceOwnIvars [
	| json |
	json := GsSplitClassRefactoring candidatesForClass: self source.
	self assert: (json includesString: 'extractC').
	self assert: (json includesString: 'keepA')
]

{ #category : 'tests - preview' }
GsSplitClassRefactoringTest >> testPreviewStagesClassAddForComponent [
	| add |
	add := self changeOfKind: #classAdd for: 'GsSCComponent' in: self ref changeSet.
	self deny: add isNil.
	self assert: (add newSource includesString: 'extractC')
]

{ #category : 'tests - preview' }
GsSplitClassRefactoringTest >> testPreviewStagesSourceReversionAddingComponentIvar [
	| edit |
	edit := self changeOfKind: #classDefinitionEdit for: 'GsSCSource' in: self ref changeSet.
	self deny: edit isNil.
	self assert: (edit newSource includesString: 'gsSCComponent').
	self deny: (edit newSource includesString: 'extractC')
]

{ #category : 'tests - preview' }
GsSplitClassRefactoringTest >> testPreviewStagesMovedMethodOntoComponent [
	self assert: (self ref changeSet changes anySatisfy: [:c |
		c kind = #methodAdd and: [c className = 'GsSCComponent' and: [c selector = #readExtractC]]])
]

{ #category : 'tests - preview' }
GsSplitClassRefactoringTest >> testPreviewStagesAccessorAndDelegatorsOnSource [
	| cs |
	cs := self ref changeSet.
	self assert: (cs changes anySatisfy: [:c |
		c kind = #methodAdd and: [c className = 'GsSCSource' and: [c selector = #gsSCComponent]]]).
	self assert: (cs changes anySatisfy: [:c |
		c kind = #methodAdd and: [c className = 'GsSCSource' and: [c selector = #readExtractC
			and: [c newSource includesString: 'self gsSCComponent']]]])
]

{ #category : 'tests - preview' }
GsSplitClassRefactoringTest >> testBuildingCreatesNothingInTheStone [
	self ref changeSet.
	self assert: self component isNil
]

{ #category : 'tests - declines' }
GsSplitClassRefactoringTest >> testDeclinesStraddlingMethod [
	self compileOnSource: 'usesBoth ^extractC + keepA'.
	self assert: (self ref decline includesString: 'stay behind').
	self assert: (self ref decline includesString: 'usesBoth')
]

{ #category : 'tests - declines' }
GsSplitClassRefactoringTest >> testDeclinesSuperSendingMovableMethod [
	self compileOnSource: 'superMovable ^extractC + super hash'.
	self assert: (self ref decline includesString: 'sends super').
	self assert: (self ref decline includesString: 'superMovable')
]

{ #category : 'tests - declines' }
GsSplitClassRefactoringTest >> testDeclinesMovableCallingRetainedMethod [
	self compileOnSource: 'movableCallsKeep ^extractC + self doubleKeep'.
	self assert: (self ref decline includesString: 'doubleKeep').
	self assert: (self ref decline includesString: 'stays behind')
]

{ #category : 'tests - declines' }
GsSplitClassRefactoringTest >> testDeclinesMovableSelfSendingSourceOverriddenObjectMethod [
	"A movable method self-sends #printString, which the SOURCE overrides. Moving the method would
	 resolve #printString to the component's inherited Object impl, silently losing the override, so
	 the split must decline -- even though Object understands #printString."
	self compileOnSource: 'printString ^''src'''.
	self compileOnSource: 'describeExtract ^extractC printString, '' '', self printString'.
	self assert: (self ref decline includesString: 'printString').
	self assert: (self ref decline includesString: 'stays behind')
]

{ #category : 'tests - declines' }
GsSplitClassRefactoringTest >> testAllowsMovableSelfSendingNonOverriddenObjectMethod [
	"Control for the override guard: a movable method may self-send an Object selector the source
	 does NOT override (#hash) -- it safely resolves to Object on the component, so no decline."
	self compileOnSource: 'hashExtract ^extractC hash + self hash'.
	self assert: self ref decline isNil
]

{ #category : 'tests - declines' }
GsSplitClassRefactoringTest >> testDeclinesWhenSubclassUsesExtractedIvar [
	(UserGlobals at: #GsSCSub)
		compileMethod: 'subUsesExtract ^extractC'
		dictionaries: System myUserProfile symbolList
		category: 'tests'.
	self assert: (self ref decline includesString: 'subclass GsSCSub').
	self assert: (self ref decline includesString: 'extracted instance variable')
]

{ #category : 'tests - declines' }
GsSplitClassRefactoringTest >> testDeclinesExistingClassName [
	| r |
	r := GsSplitClassRefactoring class: self source splitIntoClassNamed: 'GsSCSource' extractingInstVars: #('extractC') inDictionary: nil.
	self assert: (r decline includesString: 'already exists')
]

{ #category : 'tests - declines' }
GsSplitClassRefactoringTest >> testDeclinesInvalidClassName [
	| r |
	r := GsSplitClassRefactoring class: self source splitIntoClassNamed: 'lowercase' extractingInstVars: #('extractC') inDictionary: nil.
	self assert: (r decline includesString: 'not a valid class name')
]

{ #category : 'tests - declines' }
GsSplitClassRefactoringTest >> testDeclinesEmptyExtractSet [
	| r |
	r := GsSplitClassRefactoring class: self source splitIntoClassNamed: 'GsSCComponent' extractingInstVars: #() inDictionary: nil.
	self assert: (r decline includesString: 'no instance variables were chosen')
]

{ #category : 'tests - declines' }
GsSplitClassRefactoringTest >> testDeclinesNonOwnIvar [
	| r |
	r := GsSplitClassRefactoring class: self source splitIntoClassNamed: 'GsSCComponent' extractingInstVars: #('notAnIvar') inDictionary: nil.
	self assert: (r decline includesString: 'not an instance variable')
]

{ #category : 'tests - declines' }
GsSplitClassRefactoringTest >> testDeclinesComponentIvarNameCollision [
	| r |
	"Decapitalising 'KeepA' yields 'keepA', which already exists on the source."
	r := GsSplitClassRefactoring class: self source splitIntoClassNamed: 'KeepA' extractingInstVars: #('extractC') inDictionary: nil.
	self assert: (r decline includesString: 'already has an instance variable')
]

{ #category : 'tests - declines' }
GsSplitClassRefactoringTest >> testDeclinesSubclassDeclaringComponentIvar [
	"A subclass that already declares the component ivar would carry two of that name once it is
	 inherited from the reversioned source -- which the class-creation primitive rejects (error
	 2271) MID-apply, after the component class and every moved method already exist. Decline up
	 front and NAME the offender, mirroring V1 add. Note the subclass is named GsSCSub2, not
	 GsSCSub: the assertion below checks for the offender's name, and GsSCSub is a substring of
	 every other name here."
	| r |
	self source
		subclass: 'GsSCSub2'
		instVarNames: #('gsSCComponent')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	r := self ref.
	self assert: (r decline includesString: 'GsSCSub2').
	self assert: (r decline includesString: 'already declares').
	self assert: (r decline includesString: 'gsSCComponent')
]

{ #category : 'tests - declines' }
GsSplitClassRefactoringTest >> testDeclinesClassVariableShadowedByComponentIvar [
	"The component ivar is a NEW instance variable on the source, so a class variable of the same
	 name visible to the source would be shadowed inside every method body. Same precondition V1
	 add applies, asked through the same shared environment query."
	| r |
	self source addClassVarName: #gsSCComponent.
	r := self ref.
	self assert: (r decline includesString: 'class variable').
	self assert: (r decline includesString: 'shadow')
]

{ #category : 'tests - analysis guards' }
GsSplitClassRefactoringTest >> testIvarsAccessedAnswersNilWhenTheMethodCannotBeRead [
	"NIL, not #(). 'We could not read this method' is a different claim from 'it touches no
	 instance variable', and computeAnalysis declines on the first while happily leaving a method
	 behind on the second -- so the two must never collapse together."
	self assert: (self ref ivarsAccessedBy: #noSuchSelectorHere in: self source) isNil.
	self deny: (self ref ivarsAccessedBy: #readExtractC in: self source) isNil
]

{ #category : 'tests - analysis guards' }
GsSplitClassRefactoringTest >> testParsesRejectsSourceRbParserCannotRead [
	"The super / retained-self-send guards both answer permissively on a parse failure, so
	 computeAnalysis gates them on #parses: and declines instead. RBParser is a re-implementation,
	 so a method carrying a construct it does not handle is the realistic trigger."
	self deny: (self ref parses: nil).
	self deny: (self ref parses: 'readExtractC ^ ^ ^').
	self assert: (self ref parses: 'readExtractC ^extractC')
]

{ #category : 'tests - analysis guards' }
GsSplitClassRefactoringTest >> testArgNamesRaisesRatherThanBuildingAnEmptyPattern [
	"Answering #() here made selectorText:args: emit an empty keyword pattern, so the delegator
	 source came out as `^self comp ` and only failed at compile time DURING apply, stranding a
	 half-applied split. Raise instead, so the apply reports it."
	| names |
	self should: [self ref argNamesFor: #noSuchSelectorHere in: self source] raise: Error.

	"Compare as Symbols: the parser answers argument names as Unicode-capable strings, and a raw
	 String = against them raises error 2718 on 3.6.x."
	names := (self ref argNamesFor: #'writeExtractC:' in: self source) collect: [:e | e asSymbol].
	self assert: names size = 1.
	self assert: (names at: 1) == #v
]

{ #category : 'tests - apply' }
GsSplitClassRefactoringTest >> testApplyCreatesComponentWithExtractedIvars [
	self ref applyDeselected: #().
	self deny: self component isNil.
	self assert: ((self component instVarNames collect: [:e | e asString]) includes: 'extractC').
	self assert: ((self component instVarNames collect: [:e | e asString]) includes: 'extractD')
]

{ #category : 'tests - apply' }
GsSplitClassRefactoringTest >> testApplyMovesMethodsAndDelegatesFromSource [
	| src |
	self ref applyDeselected: #().
	self assert: (self component includesSelector: #readExtractC).
	self assert: (self source includesSelector: #readExtractC).
	src := (self source compiledMethodAt: #readExtractC environmentId: 0 otherwise: nil) sourceString.
	self assert: (src includesString: 'self gsSCComponent')
]

{ #category : 'tests - apply' }
GsSplitClassRefactoringTest >> testApplyReshapesSourceIvars [
	self ref applyDeselected: #().
	self deny: ((self source instVarNames collect: [:e | e asString]) includes: 'extractC').
	self assert: ((self source instVarNames collect: [:e | e asString]) includes: 'gsSCComponent').
	self assert: ((self source instVarNames collect: [:e | e asString]) includes: 'keepA')
]

{ #category : 'tests - apply' }
GsSplitClassRefactoringTest >> testApplyAddsLazyAccessor [
	| src |
	self ref applyDeselected: #().
	self assert: (self source includesSelector: #gsSCComponent).
	src := (self source compiledMethodAt: #gsSCComponent environmentId: 0 otherwise: nil) sourceString.
	self assert: (src includesString: 'ifNil:')
]

{ #category : 'tests - apply' }
GsSplitClassRefactoringTest >> testApplyPreservesBehaviorThroughDelegator [
	| s |
	self ref applyDeselected: #().
	s := self source new.
	s writeExtractC: 7.
	self assert: (s readExtractC) = 7
]

{ #category : 'tests - apply' }
GsSplitClassRefactoringTest >> testDelegatorForAMethodWithNoReturnStillAnswersTheSource [
	"#writeExtractC: has no return, so before the split it answered the SOURCE. A delegator that
	 forwards with `^` would answer whatever the moved method answers -- which is now the COMPONENT,
	 because a method falling off its end answers its receiver. That silently changes S's external
	 API for every caller that chains on the result, and hands the caller the component object the
	 has-a encapsulation is meant to hide."
	| s |
	self ref applyDeselected: #().

	s := self source new.

	self assert: (s writeExtractC: 7) == s.
	self deny: (s writeExtractC: 7) == (s gsSCComponent)
]

{ #category : 'tests - apply' }
GsSplitClassRefactoringTest >> testDelegatorForAMethodWithAReturnStillForwardsTheValue [
	"The mirror of the test above: dropping the `^` unconditionally would break every method whose
	 answer is the point, so #readExtractC must still forward its value."
	| s |
	self ref applyDeselected: #().

	s := self source new.
	s writeExtractC: 7.

	self assert: s readExtractC = 7
]

{ #category : 'tests - building' }
GsSplitClassRefactoringTest >> testDelegatorOmitsTheCaretOnlyForMethodsThatAnswerSelf [
	"Pins the discriminator directly, so a regression shows up as this test rather than as a
	 puzzling identity failure in the apply tests above."
	| r |
	r := self ref.
	self assert: (r answersSelf: #'writeExtractC:' in: self source).
	self deny: (r answersSelf: #readExtractC in: self source).

	"An explicit `^self` answers the receiver just as falling off the end does."
	self compileOnSource: 'explicitSelfReturn extractC := 1. ^self'.
	self assert: (r answersSelf: #explicitSelfReturn in: self source).

	"A return of anything else is the method's real answer and must be forwarded."
	self compileOnSource: 'mixedReturn extractC isNil ifTrue: [^0]. ^extractC'.
	self deny: (r answersSelf: #mixedReturn in: self source)
]

{ #category : 'tests - apply' }
GsSplitClassRefactoringTest >> testApplyLeavesRetainedMethodOnSource [
	self ref applyDeselected: #().
	self assert: (self source includesSelector: #doubleKeep).
	self assert: (self source includesSelector: #readKeepB)
]

{ #category : 'tests - apply' }
GsSplitClassRefactoringTest >> testApplyPreservesClassSideMethods [
	"The reversion re-versions the source, whose metaclass method dictionary starts empty; the
	 class-side method survives only because copyMethodsFrom:to:skipping: copies the metaclass
	 forward -- and a reparented subclass still inherits it."
	self ref applyDeselected: #().
	self assert: (self source class includesSelector: #sourceTag).
	self assert: ((UserGlobals at: #GsSCSub) class canUnderstand: #sourceTag)
]

{ #category : 'tests - apply' }
GsSplitClassRefactoringTest >> testApplyReparentsSubclass [
	self ref applyDeselected: #().
	self assert: ((UserGlobals at: #GsSCSub) superclass == self source).
	self assert: ((UserGlobals at: #GsSCSub) includesSelector: #subKeep)
]

{ #category : 'tests - apply' }
GsSplitClassRefactoringTest >> testApplyDoesNotCommit [
	| result |
	result := self ref applyDeselected: #().
	self assert: (result includesString: '"committed":false').
	self deny: (result includesString: '"error"')
]

{ #category : 'tests - preview' }
GsSplitClassRefactoringTest >> testDelegatorForBinarySelectorWeavesTheArgument [
	"A movable binary method gets a delegator on the source that forwards the operand."
	| add |
	self compileOnSource: '* aNumber ^extractC * aNumber'.
	add := self changeOfKind: #methodAdd for: 'GsSCSource' in: self ref changeSet
		matchingSelector: #'*'.
	self deny: add isNil.
	self assert: (add newSource includesString: '^self gsSCComponent * aNumber')
]

{ #category : 'tests - preview' }
GsSplitClassRefactoringTest >> testDelegatorForKeywordSelectorWeavesEveryArgument [
	"A movable multi-keyword method gets a delegator that re-weaves each keyword and argument."
	| add |
	self compileOnSource: 'scaleBy: a and: b ^extractC'.
	add := self changeOfKind: #methodAdd for: 'GsSCSource' in: self ref changeSet
		matchingSelector: #'scaleBy:and:'.
	self deny: add isNil.
	self assert: (add newSource includesString: 'scaleBy: a and: b').
	self assert: (add newSource includesString: '^self gsSCComponent scaleBy: a and: b')
]

{ #category : 'tests - apply' }
GsSplitClassRefactoringTest >> testApplyPreservesBehaviorThroughKeywordDelegator [
	"Set an extracted ivar and read it back through a moved keyword method: behavior survives the
	 delegation even for a method that takes arguments."
	| s |
	self compileOnSource: 'sumWith: n ^extractC + n'.
	self ref applyDeselected: #().
	s := self source new.
	s writeExtractC: 10.
	self assert: (s sumWith: 5) = 15
]

{ #category : 'tests - preview' }
GsSplitClassRefactoringTest >> testPreviewJsonStringSerializesTheChangeSet [
	| json |
	json := self ref previewJsonString.
	self assert: (json includesString: 'GsSCComponent').
	self assert: (json includesString: '"kind"')
]

{ #category : 'tests - analysis' }
GsSplitClassRefactoringTest >> testAnalyzeClassConvenienceReportsMovableCount [
	"The class-side analyzeClass:... convenience answers the same envelope as the instance path."
	| json |
	json := GsSplitClassRefactoring
		analyzeClass: self source
		splitIntoClassNamed: 'GsSCComponent'
		extractingInstVars: #('extractC' 'extractD').
	self assert: (json includesString: '"decline":null').
	self assert: (json includesString: '"movableCount":3')
]

{ #category : 'tests - paginated preview' }
GsSplitClassRefactoringTest >> testPageForTokenContinuesAndReportsExpiredSession [
	| r firstPage expired |
	r := self ref.
	r startPreviewToken: 'v8pagetok' maxBytes: 120.
	firstPage := GsSplitClassRefactoring pageForToken: 'v8pagetok' from: 1 maxBytes: 120.
	self assert: (firstPage includesString: '"changes"').
	expired := GsSplitClassRefactoring pageForToken: 'no-such-token' from: 1 maxBytes: 120.
	self assert: (expired includesString: 'expired').
	GsSplitClassRefactoring clearToken: 'v8pagetok'
]

{ #category : 'tests - paginated preview' }
GsSplitClassRefactoringTest >> testApplyForExpiredTokenReportsExpired [
	| result |
	result := GsSplitClassRefactoring applyForToken: 'no-such-token' deselected: #().
	self assert: (result includesString: 'expired')
]

{ #category : 'tests - paginated preview' }
GsSplitClassRefactoringTest >> testClearTokenRemovesThePreviewSession [
	| r |
	r := self ref.
	r startPreviewToken: 'v8cleartok' maxBytes: 500.
	self assert: (SessionTemps current at: #v8cleartok ifAbsent: [nil]) notNil.
	GsSplitClassRefactoring clearToken: 'v8cleartok'.
	self assert: (SessionTemps current at: #v8cleartok ifAbsent: [nil]) isNil
]
