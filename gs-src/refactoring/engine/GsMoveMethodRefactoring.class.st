"
Move one OR MORE methods (M6) from a source class/side to a DIFFERENT class -- and/or
flip instance<->class side -- keeping the selector and the method source verbatim. The
refactoring is addressed by source class + a COLLECTION of selectors + the source side
(isMeta), plus a target class name + the target side (toMeta). Single-method move is
just a one-element collection, so single- and multi-method share one path.

Per selector, moving stages two changes: a #methodAdd on the target (compile the same
source there, under its original category) and a #methodRemove on the source. Both
change kinds already exist; no new kind is introduced. Each selector is analysed
independently; a declined selector is dropped from the change set and reported, so a
multi-move relocates the movable methods and explains the rest.

A GLOBAL decline (target class not found, or target == source AND same side) empties
the whole change set. A per-selector decline is recorded when: the source method is
missing; the target already implements the selector (collision); the method sends super
(its meaning depends on the source superclass); or the method accesses an instance
variable the target class does not define (bytecode-precise via instVarsAccessed).

This is the SIMPLEST SOUND variant: the definition is relocated and the selector kept;
senders are NOT rewritten and no forwarding method is pushed (parked to Later). Building
the change set compiles nothing and commits nothing; the server-side apply compiles the
target and removes the source, guarding each removal so a deselected/failed add never
strands a method in neither class, and NEVER commits (the user commits explicitly).
"
Class {
	#name : 'GsMoveMethodRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'sourceClass',
		'selectors',
		'isMeta',
		'targetName',
		'toMeta',
		'targetClass',
		'changeSet',
		'analysisDone',
		'globalDecline',
		'declines'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsMoveMethodRefactoring class >> sourceClass: aClass selectors: aCollection meta: aBool toClassNamed: aName toMeta: metaBool [
	"Move aCollection of selectors from aClass (the aBool side) to the metaBool side of
	 the class named aName."
	^self
		environment: GsRefactoringEnvironment new
		sourceClass: aClass
		selectors: aCollection
		meta: aBool
		toClassNamed: aName
		toMeta: metaBool
]

{ #category : 'instance creation' }
GsMoveMethodRefactoring class >> environment: anEnvironment sourceClass: aClass selectors: aCollection meta: aBool toClassNamed: aName toMeta: metaBool [
	^self new
		setEnvironment: anEnvironment
		sourceClass: aClass
		selectors: aCollection
		meta: aBool
		toClassNamed: aName
		toMeta: metaBool
]

{ #category : 'preconditions' }
GsMoveMethodRefactoring class >> analyzeForClass: aClass selectors: aCollection meta: aBool toClassNamed: aName toMeta: metaBool [
	"A pre-flight the client runs before opening the preview: the target class, a
	 per-selector decline reason (nil when movable), and the count that will move."
	^(self
		sourceClass: aClass
		selectors: aCollection
		meta: aBool
		toClassNamed: aName
		toMeta: metaBool) analysisJsonString
]

{ #category : 'paginated preview' }
GsMoveMethodRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	"A page from a previously-started preview (see startPreviewToken:maxBytes:), by
	 token. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'paginated preview' }
GsMoveMethodRefactoring class >> applyForToken: token deselected: deselectedIds [
	"Apply a previously-started preview (by token). No commit. Answers an error
	 envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'paginated preview' }
GsMoveMethodRefactoring class >> clearToken: token [
	"Drop a finished preview from SessionTemps."
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'private' }
GsMoveMethodRefactoring >> setEnvironment: anEnvironment sourceClass: aClass selectors: aCollection meta: aBool toClassNamed: aName toMeta: metaBool [
	environment := anEnvironment.
	sourceClass := aClass.
	selectors := aCollection collect: [:s | s asSymbol].
	isMeta := aBool.
	targetName := aName asString.
	toMeta := metaBool.
	analysisDone := false
]

{ #category : 'accessing' }
GsMoveMethodRefactoring >> environment [
	^environment
]

{ #category : 'accessing' }
GsMoveMethodRefactoring >> selectors [
	^selectors
]

{ #category : 'private' }
GsMoveMethodRefactoring >> sourceBehavior [
	"The behaviour that holds the methods being moved: the metaclass for a class-side
	 source."
	^isMeta ifTrue: [sourceClass class] ifFalse: [sourceClass]
]

{ #category : 'private' }
GsMoveMethodRefactoring >> targetBehavior [
	"The behaviour the methods move to. Only valid once analysis has resolved
	 targetClass."
	^toMeta ifTrue: [targetClass class] ifFalse: [targetClass]
]

{ #category : 'private - analysis' }
GsMoveMethodRefactoring >> ensureAnalysis [
	analysisDone ifFalse: [
		analysisDone := true.
		[self computeAnalysis] on: Error do: [:e |
			globalDecline := 'The move could not be analysed: ', e messageText]]
]

{ #category : 'private - analysis' }
GsMoveMethodRefactoring >> computeAnalysis [
	"Resolve the target class, reject a global no-op, then record a per-selector decline
	 (nil when movable)."
	globalDecline := nil.
	declines := Dictionary new.
	targetClass := environment classNamed: targetName.
	targetClass isNil ifTrue: [
		^globalDecline := 'Target class ', targetName, ' was not found.'].
	(targetClass == sourceClass and: [toMeta == isMeta]) ifTrue: [
		^globalDecline := 'The source and target are the same class and side; nothing to move.'].
	selectors do: [:sel | declines at: sel put: (self computeDeclineFor: sel)]
]

{ #category : 'private - analysis' }
GsMoveMethodRefactoring >> computeDeclineFor: aSelector [
	"nil if aSelector can move to the target, otherwise a reason. Checks, in order:
	 method exists on the source, no collision on the target, no super send, and every
	 accessed instance variable exists on the target."
	| method src tree accessed targetVars missing |
	method := self sourceBehavior compiledMethodAt: aSelector environmentId: 0 otherwise: nil.
	method isNil ifTrue: [
		^'Cannot move #', aSelector asString, ': it is not defined in ', sourceClass name asString, '.'].
	(self targetBehavior includesSelector: aSelector) ifTrue: [
		^'Cannot move #', aSelector asString, ': ', targetClass name asString, ' already defines it.'].
	src := method sourceString.
	tree := [RBParser parseMethod: src] on: Error do: [:e | nil].
	(tree notNil and: [self tree: tree referencesName: 'super']) ifTrue: [
		^'Cannot move #', aSelector asString, ': it sends super, whose meaning depends on the source class''s superclass.'].
	accessed := [method instVarsAccessed] on: Error do: [:e | #()].
	targetVars := self targetBehavior allInstVarNames collect: [:n | n asSymbol].
	missing := accessed reject: [:v | targetVars includes: v asSymbol].
	missing isEmpty ifFalse: [
		^'Cannot move #', aSelector asString, ': it uses instance variable(s) not defined in the target (',
			(self commaList: (missing collect: [:v | v asString])), ').'].
	^nil
]

{ #category : 'private - analysis' }
GsMoveMethodRefactoring >> tree: aTree referencesName: aName [
	"True if aTree or any descendant is a variable node named aName."
	aTree nodesDo: [:n | (n isVariable and: [n name = aName]) ifTrue: [^true]].
	^false
]

{ #category : 'private' }
GsMoveMethodRefactoring >> commaList: aCollection [
	^aCollection
		inject: ''
		into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ', ', s]]
]

{ #category : 'private' }
GsMoveMethodRefactoring >> dictNameForClass: aClass [
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
]

{ #category : 'private' }
GsMoveMethodRefactoring >> categoryOfSelector: aSelector [
	^((self sourceBehavior categoryOfSelector: aSelector environmentId: 0)
		ifNil: ['as yet unclassified']) asString
]

{ #category : 'preconditions' }
GsMoveMethodRefactoring >> globalDecline [
	"nil if the move as a whole is viable, otherwise a reason that empties the change
	 set (target missing, or a same-class same-side no-op)."
	self ensureAnalysis.
	^globalDecline
]

{ #category : 'preconditions' }
GsMoveMethodRefactoring >> declineFor: aSelector [
	"nil if aSelector will move, otherwise the per-selector (or inherited global)
	 reason it will not."
	self ensureAnalysis.
	globalDecline notNil ifTrue: [^globalDecline].
	^declines at: aSelector asSymbol ifAbsent: [nil]
]

{ #category : 'accessing' }
GsMoveMethodRefactoring >> movableSelectors [
	"The selectors that will actually move, preserving request order."
	self ensureAnalysis.
	globalDecline notNil ifTrue: [^#()].
	^selectors select: [:sel | (declines at: sel ifAbsent: [nil]) isNil]
]

{ #category : 'accessing' }
GsMoveMethodRefactoring >> movableCount [
	^self movableSelectors size
]

{ #category : 'building' }
GsMoveMethodRefactoring >> changeSet [
	"The staged, non-committing change set, computed once and cached. Empty on a global
	 decline; otherwise two changes (add + remove) per movable selector."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'building' }
GsMoveMethodRefactoring >> buildChangeSet [
	| cs |
	cs := GsRefactoringChangeSet new.
	self ensureAnalysis.
	globalDecline notNil ifTrue: [^cs].
	self movableSelectors do: [:sel | self stageMoveOf: sel into: cs].
	^cs
]

{ #category : 'building' }
GsMoveMethodRefactoring >> stageMoveOf: aSelector into: cs [
	"Stage the add-on-target then the remove-from-source for one movable selector."
	| method src cat |
	method := self sourceBehavior compiledMethodAt: aSelector environmentId: 0 otherwise: nil.
	src := method sourceString.
	cat := self categoryOfSelector: aSelector.
	cs
		addMethodAddInDictionary: (self dictNameForClass: targetClass)
		className: targetClass name asString
		isMeta: toMeta
		selector: aSelector
		category: cat
		newSource: src.
	cs
		addMethodRemoveInDictionary: (self dictNameForClass: sourceClass)
		className: sourceClass name asString
		isMeta: isMeta
		selector: aSelector
		category: cat
		oldSource: src
]

{ #category : 'serializing' }
GsMoveMethodRefactoring >> analysisJsonString [
	"The pre-flight payload: the target class, the movable count, a global decline (if
	 any), and a per-selector {selector, decline} array."
	| ws |
	self ensureAnalysis.
	ws := WriteStream on: String new.
	ws nextPutAll: '{"targetClass":';
		nextPutAll: (targetClass isNil ifTrue: ['null'] ifFalse: [self jsonQuote: targetClass name asString]).
	ws nextPutAll: ',"globalDecline":';
		nextPutAll: (globalDecline ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]).
	ws nextPutAll: ',"movableCount":'; nextPutAll: self movableCount printString.
	ws nextPutAll: ',"selectors":['.
	selectors keysAndValuesDo: [:i :sel |
		i = 1 ifFalse: [ws nextPut: $,].
		ws nextPutAll: '{"selector":'; nextPutAll: (self jsonQuote: sel asString).
		ws nextPutAll: ',"decline":';
			nextPutAll: ((self declineFor: sel) ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]).
		ws nextPut: $}].
	ws nextPutAll: ']}'.
	^ws contents
]

{ #category : 'serializing' }
GsMoveMethodRefactoring >> previewJsonString [
	^self changeSet jsonString
]

{ #category : 'serializing' }
GsMoveMethodRefactoring >> outOfScopeJsonString [
	"The scope / precondition payload for the preview panel, in the family's shape. A
	 hard global decline (which blocks Apply) rides here; per-selector skips ride in
	 skippedMethods."
	^'{"references":0,"skipped":', (selectors size - self movableCount) printString,
	  ',"scope":"class","collision":null,"decline":',
	  (globalDecline ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  '}'
]

{ #category : 'serializing' }
GsMoveMethodRefactoring >> skippedMethodsJsonString [
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
GsMoveMethodRefactoring >> startPreviewToken: token maxBytes: maxBytes [
	"Build the change set, stash this refactoring in SessionTemps under token, and
	 answer the first page plus totals and precondition warnings. Nothing is committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"targetClass":', (targetClass isNil ifTrue: ['null'] ifFalse: [self jsonQuote: targetClass name asString]),
	  ',"movableCount":', self movableCount printString,
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"skippedMethods":', self skippedMethodsJsonString,
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'paginated preview' }
GsMoveMethodRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
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
GsMoveMethodRefactoring >> applyDeselected: deselectedIds [
	"Apply the staged changes in the stone WITHOUT committing. A deselected id is
	 skipped. Removals are additionally guarded (see applyMethodRemove:) so a skipped or
	 failed add never strands a method in neither class. Answers {applied, failed:[..]}."
	| applied failures ids |
	ids := (deselectedIds ifNil: [#()]) asArray.
	failures := OrderedCollection new.
	applied := 0.
	self changeSet changes do: [:change |
		(ids includes: change id)
			ifFalse: [
				[(self applyChange: change) ifTrue: [applied := applied + 1]]
				on: Error do: [:e |
					failures add: (Array with: change id with: change className with: e messageText)]]].
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
GsMoveMethodRefactoring >> applyChange: aChange [
	"Answer true when the change was applied, false when it was safely skipped."
	aChange kind == #methodAdd ifTrue: [^self applyMethodAdd: aChange].
	aChange kind == #methodRemove ifTrue: [^self applyMethodRemove: aChange].
	^self error: 'Unexpected change kind for move-method: ', aChange kind printString
]

{ #category : 'applying' }
GsMoveMethodRefactoring >> applyMethodAdd: aChange [
	"Compile the moved method onto the target class/side. No commit."
	| cls target |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	target
		compileMethod: aChange newSource
		dictionaries: System myUserProfile symbolList
		category: (aChange category ifNil: ['as yet unclassified']).
	^true
]

{ #category : 'applying' }
GsMoveMethodRefactoring >> applyMethodRemove: aChange [
	"Remove the method from the source -- but ONLY once the target actually holds it, so
	 a deselected or failed add never leaves the method in neither class. No commit."
	| cls target |
	(self targetBehavior includesSelector: aChange selector asSymbol) ifFalse: [^false].
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	target removeSelector: aChange selector asSymbol.
	^true
]

{ #category : 'serializing' }
GsMoveMethodRefactoring >> jsonQuote: aString [
	^GsRefactoringJson jsonQuote: aString
]

{ #category : 'serializing' }
GsMoveMethodRefactoring >> jsonEscape: aString [
	^GsRefactoringJson jsonEscape: aString
]

{ #category : 'serializing' }
GsMoveMethodRefactoring >> hex2: anInteger [
	^GsRefactoringJson hex2: anInteger
]
