"
Push one OR MORE methods UP (M7) from a source class to its immediate SUPERCLASS,
keeping the selector and the method source verbatim and the same side (instance stays
instance, class stays class -- no side flip). The refactoring is addressed by the source
class + a COLLECTION of selectors + the source side (isMeta); the target (the superclass)
is resolved server-side, so the engine -- not the client -- owns the ''which class'' logic
and can be tested in isolation. Single-method push-up is just a one-element collection, so
single- and multi-method share one path.

Push-up is the special case of move-method (M6) whose target is the source''s superclass;
it reuses M6''s change kinds and preview/apply/token machinery verbatim. Per selector it
stages a #methodAdd on the superclass (compile the same source there, under its original
category) and a #methodRemove on the source. Both change kinds already exist; no new kind
is introduced. Each selector is analysed independently; a declined selector is dropped from
the change set and reported, so a multi-push relocates the movable methods and explains the
rest.

When the superclass ALREADY implements the selector, the push is NOT declined: it becomes an
opt-in OVERWRITE change -- the #methodAdd carries the superclass's existing body (for a
before/after diff) plus a data-loss warning, and the client leaves it un-ticked by default so
the user consciously chooses to replace the inherited definition (consolidating an inherited
method by pushing up is a common intent). The paired source #methodRemove is guarded on the
add having actually been applied THIS run (an applied-add set), NOT on a bare
includesSelector: -- otherwise a deselected overwrite, whose selector the superclass already
carries, would wrongly strip the source and lose the subclass version.

A GLOBAL decline (the source has no superclass) empties the whole change set. A per-selector
decline (a HARD skip, not an overwrite) is recorded when: the source method is missing; the
method sends super (its meaning depends on the source class''s superclass, which changes when
the home moves up); the method accesses an instance variable the superclass does not define
(bytecode-precise via instVarsAccessed -- the ivar lives only on the subclass); or the method
references a CLASS variable or POOL variable declared only below the superclass (matched by
identifier name against the shared-var delta). All three variable cases mean the pushed method
would not even compile on the superclass. Class-INSTANCE variables are covered by the
instVarsAccessed check on the metaclass side.

This is the SIMPLEST SOUND variant: the definition is relocated to the superclass and the
selector kept; siblings that inherited nothing now inherit the pushed-up method, senders are
NOT rewritten and no forwarding method is left behind. Building the change set compiles nothing
and commits nothing; the server-side apply compiles the superclass and removes the source,
guarding each removal so a deselected/failed add never strands a method in neither class, and
NEVER commits (the user commits explicitly).
"
Class {
	#name : 'GsPushUpMethodRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'sourceClass',
		'selectors',
		'isMeta',
		'superClass',
		'changeSet',
		'analysisDone',
		'globalDecline',
		'declines',
		'appliedAddSelectors'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsPushUpMethodRefactoring class >> sourceClass: aClass selectors: aCollection meta: aBool [
	"Push aCollection of selectors from the aBool side of aClass up to the same side of
	 aClass's immediate superclass."
	^self
		environment: GsRefactoringEnvironment new
		sourceClass: aClass
		selectors: aCollection
		meta: aBool
]

{ #category : 'instance creation' }
GsPushUpMethodRefactoring class >> environment: anEnvironment sourceClass: aClass selectors: aCollection meta: aBool [
	^self new
		setEnvironment: anEnvironment
		sourceClass: aClass
		selectors: aCollection
		meta: aBool
]

{ #category : 'preconditions' }
GsPushUpMethodRefactoring class >> analyzeForClass: aClass selectors: aCollection meta: aBool [
	"A pre-flight the client runs before opening the preview: the target superclass, a
	 per-selector decline reason (nil when movable), and the count that will move."
	^(self
		sourceClass: aClass
		selectors: aCollection
		meta: aBool) analysisJsonString
]

{ #category : 'paginated preview' }
GsPushUpMethodRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	"A page from a previously-started preview (see startPreviewToken:maxBytes:), by
	 token. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'paginated preview' }
GsPushUpMethodRefactoring class >> applyForToken: token deselected: deselectedIds [
	"Apply a previously-started preview (by token). No commit. Answers an error
	 envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'paginated preview' }
GsPushUpMethodRefactoring class >> clearToken: token [
	"Drop a finished preview from SessionTemps."
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'private' }
GsPushUpMethodRefactoring >> setEnvironment: anEnvironment sourceClass: aClass selectors: aCollection meta: aBool [
	environment := anEnvironment.
	sourceClass := aClass.
	selectors := aCollection collect: [:s | s asSymbol].
	isMeta := aBool.
	analysisDone := false
]

{ #category : 'accessing' }
GsPushUpMethodRefactoring >> environment [
	^environment
]

{ #category : 'accessing' }
GsPushUpMethodRefactoring >> selectors [
	^selectors
]

{ #category : 'private' }
GsPushUpMethodRefactoring >> sourceBehavior [
	"The behaviour that holds the methods being pushed: the metaclass for a class-side
	 source."
	^isMeta ifTrue: [sourceClass class] ifFalse: [sourceClass]
]

{ #category : 'private' }
GsPushUpMethodRefactoring >> targetBehavior [
	"The behaviour the methods move to (the superclass, same side). Only valid once
	 analysis has resolved superClass."
	^isMeta ifTrue: [superClass class] ifFalse: [superClass]
]

{ #category : 'private - analysis' }
GsPushUpMethodRefactoring >> ensureAnalysis [
	analysisDone ifFalse: [
		analysisDone := true.
		[self computeAnalysis] on: Error do: [:e |
			globalDecline := 'The push-up could not be analysed: ', e messageText]]
]

{ #category : 'private - analysis' }
GsPushUpMethodRefactoring >> computeAnalysis [
	"Resolve the target superclass, reject a class with no superclass, then record a
	 per-selector decline (nil when movable)."
	globalDecline := nil.
	declines := Dictionary new.
	superClass := sourceClass superclass.
	superClass isNil ifTrue: [
		^globalDecline := 'Cannot push up: ', sourceClass name asString, ' has no superclass.'].
	selectors do: [:sel | declines at: sel put: (self computeDeclineFor: sel)]
]

{ #category : 'private - analysis' }
GsPushUpMethodRefactoring >> computeDeclineFor: aSelector [
	"nil if aSelector can be pushed up, otherwise a HARD reason. Checks, in order: the
	 method exists on the source, it does not send super, every accessed instance variable
	 exists on the superclass, and no referenced class/pool variable is declared only below
	 the superclass. A collision (the superclass already implements the selector) is NOT a
	 hard decline: it becomes an opt-in, data-losing OVERWRITE change (see
	 overwriteWarningFor:), because consolidating an inherited method by pushing up is often
	 the intent."
	| method src tree accessed targetVars missing sharedBelow refNames badShared |
	method := self sourceBehavior compiledMethodAt: aSelector environmentId: 0 otherwise: nil.
	method isNil ifTrue: [
		^'Cannot push up #', aSelector asString, ': it is not defined in ', sourceClass name asString, '.'].
	src := method sourceString.
	tree := [RBParser parseMethod: src] on: Error do: [:e | nil].
	(tree notNil and: [self tree: tree referencesName: 'super']) ifTrue: [
		^'Cannot push up #', aSelector asString, ': it sends super, whose meaning depends on the class''s superclass.'].
	accessed := [method instVarsAccessed] on: Error do: [:e | #()].
	targetVars := self targetBehavior allInstVarNames collect: [:n | n asSymbol].
	missing := accessed reject: [:v | targetVars includes: v asSymbol].
	missing isEmpty ifFalse: [
		^'Cannot push up #', aSelector asString, ': it uses instance variable(s) not defined in the superclass (',
			(self commaList: (missing collect: [:v | v asString])), ').'].
	"Class variables and pool variables declared only below the superclass (the source's
	 own, or a pool it alone imports) would be undeclared once the method compiles onto the
	 superclass. instVarsAccessed does not cover these, so match referenced identifier names
	 (from the parse tree) against the shared-var delta."
	sharedBelow := self sharedVarsBelowTarget.
	sharedBelow isEmpty ifFalse: [
		refNames := Set new.
		tree ifNotNil: [tree nodesDo: [:n | n isVariable ifTrue: [refNames add: n name asSymbol]]].
		badShared := sharedBelow select: [:v | refNames includes: v].
		badShared isEmpty ifFalse: [
			^'Cannot push up #', aSelector asString, ': it uses class/pool variable(s) not defined in the superclass (',
				(self commaList: ((badShared asSortedCollection: [:a :b | a <= b]) asArray collect: [:v | v asString])), ').']].
	^nil
]

{ #category : 'private - analysis' }
GsPushUpMethodRefactoring >> tree: aTree referencesName: aName [
	"True if aTree or any descendant is a variable node named aName."
	aTree nodesDo: [:n | (n isVariable and: [n name = aName]) ifTrue: [^true]].
	^false
]

{ #category : 'private - analysis' }
GsPushUpMethodRefactoring >> sharedVarsBelowTarget [
	"Class-variable + pool-variable names visible to the SOURCE but NOT to the superclass --
	 i.e. declared on the source (or between it and the superclass) -- as a Set of Symbols. A
	 pushed-up method referencing any of these would fail to compile on the superclass. Class
	 variables and pool imports are shared across both sides, so this is independent of isMeta."
	| below |
	below := self sharedVarNamesOf: sourceClass.
	(self sharedVarNamesOf: superClass) do: [:v | below remove: v ifAbsent: []].
	^below
]

{ #category : 'private - analysis' }
GsPushUpMethodRefactoring >> sharedVarNamesOf: aClass [
	"All class-variable + pool-variable names visible to aClass (own + inherited class vars,
	 plus every imported pool's keys), as a Set of Symbols. Defensive against a release that
	 lacks either reflection selector."
	| names |
	names := Set new.
	([aClass allClassVarNames] on: Error do: [:e | #()])
		do: [:n | names add: n asSymbol].
	([aClass sharedPools] on: Error do: [:e | #()])
		do: [:pool | pool keysDo: [:k | names add: k asSymbol]].
	^names
]

{ #category : 'private - analysis' }
GsPushUpMethodRefactoring >> targetExistingSourceFor: aSelector [
	"If the superclass ALREADY implements aSelector, its current source (which pushing up
	 will OVERWRITE); nil otherwise. Only meaningful for a movable selector."
	(self targetBehavior includesSelector: aSelector) ifFalse: [^nil].
	^(self targetBehavior compiledMethodAt: aSelector environmentId: 0 otherwise: nil)
		ifNil: [nil] ifNotNil: [:m | m sourceString]
]

{ #category : 'preconditions' }
GsPushUpMethodRefactoring >> overwriteWarningFor: aSelector [
	"A data-loss warning if pushing aSelector up would OVERWRITE a method the superclass
	 itself defines (its definition is replaced by the pushed-up one); nil otherwise.
	 nil for a declined selector or a global decline."
	self ensureAnalysis.
	globalDecline notNil ifTrue: [^nil].
	(self declineFor: aSelector) notNil ifTrue: [^nil].
	(self targetExistingSourceFor: aSelector) isNil ifTrue: [^nil].
	^'Pushing up overwrites ', superClass name asString, '>>', aSelector asString,
	  ' -- its current definition is lost.'
]

{ #category : 'private' }
GsPushUpMethodRefactoring >> commaList: aCollection [
	^aCollection
		inject: ''
		into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ', ', s]]
]

{ #category : 'private' }
GsPushUpMethodRefactoring >> dictNameForClass: aClass [
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
]

{ #category : 'private' }
GsPushUpMethodRefactoring >> categoryOfSelector: aSelector [
	^((self sourceBehavior categoryOfSelector: aSelector environmentId: 0)
		ifNil: ['as yet unclassified']) asString
]

{ #category : 'preconditions' }
GsPushUpMethodRefactoring >> globalDecline [
	"nil if the push-up as a whole is viable, otherwise a reason that empties the change
	 set (the source has no superclass)."
	self ensureAnalysis.
	^globalDecline
]

{ #category : 'preconditions' }
GsPushUpMethodRefactoring >> declineFor: aSelector [
	"nil if aSelector will move, otherwise the per-selector (or inherited global)
	 reason it will not."
	self ensureAnalysis.
	globalDecline notNil ifTrue: [^globalDecline].
	^declines at: aSelector asSymbol ifAbsent: [nil]
]

{ #category : 'accessing' }
GsPushUpMethodRefactoring >> superClass [
	self ensureAnalysis.
	^superClass
]

{ #category : 'accessing' }
GsPushUpMethodRefactoring >> movableSelectors [
	"The selectors that will actually move, preserving request order."
	self ensureAnalysis.
	globalDecline notNil ifTrue: [^#()].
	^selectors select: [:sel | (declines at: sel ifAbsent: [nil]) isNil]
]

{ #category : 'accessing' }
GsPushUpMethodRefactoring >> movableCount [
	^self movableSelectors size
]

{ #category : 'building' }
GsPushUpMethodRefactoring >> changeSet [
	"The staged, non-committing change set, computed once and cached. Empty on a global
	 decline; otherwise two changes (add + remove) per movable selector."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'building' }
GsPushUpMethodRefactoring >> buildChangeSet [
	| cs |
	cs := GsRefactoringChangeSet new.
	self ensureAnalysis.
	globalDecline notNil ifTrue: [^cs].
	self movableSelectors do: [:sel | self stagePushOf: sel into: cs].
	^cs
]

{ #category : 'building' }
GsPushUpMethodRefactoring >> stagePushOf: aSelector into: cs [
	"Stage the add-on-superclass then the remove-from-source for one movable selector. If
	 the superclass already implements the selector, the add is an OVERWRITE (carries the
	 existing body + a data-loss warning) rather than a plain add."
	| method src cat existing |
	method := self sourceBehavior compiledMethodAt: aSelector environmentId: 0 otherwise: nil.
	src := method sourceString.
	cat := self categoryOfSelector: aSelector.
	existing := self targetExistingSourceFor: aSelector.
	existing isNil
		ifTrue: [cs
			addMethodAddInDictionary: (self dictNameForClass: superClass)
			className: superClass name asString
			isMeta: isMeta
			selector: aSelector
			category: cat
			newSource: src]
		ifFalse: [cs
			addMethodOverwriteInDictionary: (self dictNameForClass: superClass)
			className: superClass name asString
			isMeta: isMeta
			selector: aSelector
			category: cat
			oldSource: existing
			newSource: src
			warning: (self overwriteWarningFor: aSelector)].
	cs
		addMethodRemoveInDictionary: (self dictNameForClass: sourceClass)
		className: sourceClass name asString
		isMeta: isMeta
		selector: aSelector
		category: cat
		oldSource: src
]

{ #category : 'serializing' }
GsPushUpMethodRefactoring >> analysisJsonString [
	"The pre-flight payload: the target superclass, the movable count, a global decline
	 (if any), and a per-selector {selector, decline} array."
	| ws |
	self ensureAnalysis.
	ws := WriteStream on: String new.
	ws nextPutAll: '{"targetClass":';
		nextPutAll: (superClass isNil ifTrue: ['null'] ifFalse: [self jsonQuote: superClass name asString]).
	ws nextPutAll: ',"globalDecline":';
		nextPutAll: (globalDecline ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]).
	ws nextPutAll: ',"movableCount":'; nextPutAll: self movableCount printString.
	ws nextPutAll: ',"selectors":['.
	selectors keysAndValuesDo: [:i :sel |
		i = 1 ifFalse: [ws nextPut: $,].
		ws nextPutAll: '{"selector":'; nextPutAll: (self jsonQuote: sel asString).
		ws nextPutAll: ',"decline":';
			nextPutAll: ((self declineFor: sel) ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]).
		ws nextPutAll: ',"warning":';
			nextPutAll: ((self overwriteWarningFor: sel) ifNil: ['null'] ifNotNil: [:w | self jsonQuote: w]).
		ws nextPut: $}].
	ws nextPutAll: ']}'.
	^ws contents
]

{ #category : 'serializing' }
GsPushUpMethodRefactoring >> previewJsonString [
	^self changeSet jsonString
]

{ #category : 'serializing' }
GsPushUpMethodRefactoring >> outOfScopeJsonString [
	"The scope / precondition payload for the preview panel, in the family's shape. A
	 hard global decline (which blocks Apply) rides here; per-selector skips ride in
	 skippedMethods."
	^'{"references":0,"skipped":', (selectors size - self movableCount) printString,
	  ',"scope":"class","collision":null,"decline":',
	  (globalDecline ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  '}'
]

{ #category : 'serializing' }
GsPushUpMethodRefactoring >> skippedMethodsJsonString [
	"The declined selectors + reasons, for the preview panel to explain what will NOT
	 move."
	| ws first |
	self ensureAnalysis.
	ws := WriteStream on: String new.
	ws nextPut: $[.
	first := true.
	selectors do: [:sel | | reason |
		reason := self declineFor: sel.
		(reason notNil and: [globalDecline isNil]) ifTrue: [
			first ifFalse: [ws nextPut: $,].
			first := false.
			ws nextPutAll: '{"selector":'; nextPutAll: (self jsonQuote: sel asString).
			ws nextPutAll: ',"reason":'; nextPutAll: (self jsonQuote: reason); nextPut: $}]].
	ws nextPut: $].
	^ws contents
]

{ #category : 'paginated preview' }
GsPushUpMethodRefactoring >> startPreviewToken: token maxBytes: maxBytes [
	"Build the change set, stash this refactoring in SessionTemps under token, and
	 answer the first page plus totals and precondition warnings. Nothing is committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"targetClass":', (superClass isNil ifTrue: ['null'] ifFalse: [self jsonQuote: superClass name asString]),
	  ',"movableCount":', self movableCount printString,
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"skippedMethods":', self skippedMethodsJsonString,
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'paginated preview' }
GsPushUpMethodRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
	"A byte-bounded page of staged changes (with source) from startIndex (1-based). At
	 least one change is always emitted when any remain."
	| all ws i |
	all := self changeSet changes.
	ws := WriteStream on: String new.
	ws nextPut: $[.
	i := startIndex.
	[i <= all size and: [i = startIndex or: [ws position < maxBytes]]] whileTrue: [
		i > startIndex ifTrue: [ws nextPut: $,].
		(all at: i) jsonOn: ws.
		i := i + 1].
	ws nextPut: $].
	^'{"changes":', ws contents,
	  ',"nextOffset":', i printString,
	  ',"done":', (i > all size) printString, '}'
]

{ #category : 'applying' }
GsPushUpMethodRefactoring >> applyDeselected: deselectedIds [
	"Apply the staged changes in the stone WITHOUT committing. A deselected id is
	 skipped. Removals are additionally guarded (see applyMethodRemove:) so a skipped or
	 failed add never strands a method in neither class. Answers {applied, failed:[..]}."
	| applied failures ids |
	"Compare ids as Symbols: a deselected id arrives from the client as a String literal,
	 which on 3.6.x is a Unicode string, and comparing it to the byte-string change id can
	 raise (the 3.6.2 Unicode-comparison trap). asSymbol canonicalises both sides."
	ids := ((deselectedIds ifNil: [#()]) collect: [:e | e asSymbol]) asIdentitySet.
	failures := OrderedCollection new.
	applied := 0.
	appliedAddSelectors := Set new.
	self changeSet changes do: [:change |
		(ids includes: change id asSymbol)
			ifFalse: [
				[(self applyChange: change) ifTrue: [applied := applied + 1]]
				on: Error do: [:e |
					failures add: (Array with: change id with: change failureLabel with: e messageText)]]].
	^'{"applied":', applied printString,
	  ',"failed":[',
	  ((failures collect: [:f |
		'{"id":', (self jsonQuote: (f at: 1)),
		',"label":', (self jsonQuote: (f at: 2)),
		',"error":', (self jsonQuote: (f at: 3)), '}'])
			inject: '' into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ',', s]]),
	  ']}'
]

{ #category : 'applying' }
GsPushUpMethodRefactoring >> applyChange: aChange [
	"Answer true when the change was applied, false when it was safely skipped."
	aChange kind == #methodAdd ifTrue: [^self applyMethodAdd: aChange].
	aChange kind == #methodRemove ifTrue: [^self applyMethodRemove: aChange].
	^self error: 'Unexpected change kind for push-up-method: ', aChange kind printString
]

{ #category : 'applying' }
GsPushUpMethodRefactoring >> applyMethodAdd: aChange [
	"Compile the pushed-up method onto the superclass/side. No commit. Records the
	 selector as applied so the paired remove knows the add actually happened (a plain
	 includesSelector: check cannot tell an applied push from a pre-existing collision
	 method, so a deselected OVERWRITE must not trigger the remove). The compile RAISES when it
	 fails, so the record -- and with it the paired remove's authority to strip the source -- is
	 only reached once the method is actually installed on the superclass."
	| cls target |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	environment
		compile: aChange newSource
		into: target
		category: (aChange category ifNil: ['as yet unclassified']).
	appliedAddSelectors add: aChange selector asSymbol.
	^true
]

{ #category : 'applying' }
GsPushUpMethodRefactoring >> applyMethodRemove: aChange [
	"Remove the method from the source -- but ONLY once this run actually compiled the
	 method onto the superclass, so a deselected or failed add never leaves the method in
	 neither class. Guarding on the applied-add set (not a bare includesSelector: on the
	 superclass) is what makes a deselected OVERWRITE safe: the superclass already has a
	 same-selector method, so includesSelector: would wrongly report the push succeeded
	 and strip the source. No commit."
	| cls target |
	(appliedAddSelectors includes: aChange selector asSymbol) ifFalse: [^false].
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	target removeSelector: aChange selector asSymbol.
	^true
]

{ #category : 'serializing' }
GsPushUpMethodRefactoring >> jsonQuote: aString [
	^GsRefactoringJson jsonQuote: aString
]

{ #category : 'serializing' }
GsPushUpMethodRefactoring >> jsonEscape: aString [
	^GsRefactoringJson jsonEscape: aString
]

{ #category : 'serializing' }
GsPushUpMethodRefactoring >> hex2: anInteger [
	^GsRefactoringJson hex2: anInteger
]
