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

A GLOBAL decline (the source has no superclass) empties the whole change set. A per-selector
decline is recorded when: the source method is missing; the superclass already implements the
selector (collision -- pushing up would overwrite it); the method sends super (its meaning
depends on the source class''s superclass, which changes when the home moves up); or the
method accesses an instance variable the superclass does not define (bytecode-precise via
instVarsAccessed -- the ivar lives only on the subclass).

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
		'declines'
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
	"nil if aSelector can be pushed up, otherwise a reason. Checks, in order: method
	 exists on the source, no collision on the superclass, no super send, and every
	 accessed instance variable exists on the superclass."
	| method src tree accessed targetVars missing |
	method := self sourceBehavior compiledMethodAt: aSelector environmentId: 0 otherwise: nil.
	method isNil ifTrue: [
		^'Cannot push up #', aSelector asString, ': it is not defined in ', sourceClass name asString, '.'].
	(self targetBehavior includesSelector: aSelector) ifTrue: [
		^'Cannot push up #', aSelector asString, ': ', superClass name asString, ' already defines it.'].
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
	^nil
]

{ #category : 'private - analysis' }
GsPushUpMethodRefactoring >> tree: aTree referencesName: aName [
	"True if aTree or any descendant is a variable node named aName."
	aTree nodesDo: [:n | (n isVariable and: [n name = aName]) ifTrue: [^true]].
	^false
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
	"Stage the add-on-superclass then the remove-from-source for one movable selector."
	| method src cat |
	method := self sourceBehavior compiledMethodAt: aSelector environmentId: 0 otherwise: nil.
	src := method sourceString.
	cat := self categoryOfSelector: aSelector.
	cs
		addMethodAddInDictionary: (self dictNameForClass: superClass)
		className: superClass name asString
		isMeta: isMeta
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
GsPushUpMethodRefactoring >> applyChange: aChange [
	"Answer true when the change was applied, false when it was safely skipped."
	aChange kind == #methodAdd ifTrue: [^self applyMethodAdd: aChange].
	aChange kind == #methodRemove ifTrue: [^self applyMethodRemove: aChange].
	^self error: 'Unexpected change kind for push-up-method: ', aChange kind printString
]

{ #category : 'applying' }
GsPushUpMethodRefactoring >> applyMethodAdd: aChange [
	"Compile the pushed-up method onto the superclass/side. No commit."
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
GsPushUpMethodRefactoring >> applyMethodRemove: aChange [
	"Remove the method from the source -- but ONLY once the superclass actually holds it,
	 so a deselected or failed add never leaves the method in neither class. No commit."
	| cls target |
	(self targetBehavior includesSelector: aChange selector asSymbol) ifFalse: [^false].
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	target removeSelector: aChange selector asSymbol.
	^true
]

{ #category : 'serializing' }
GsPushUpMethodRefactoring >> jsonQuote: aString [
	^'"', (self jsonEscape: aString), '"'
]

{ #category : 'serializing' }
GsPushUpMethodRefactoring >> jsonEscape: aString [
	"JSON string escaping emitting PURE ASCII (control chars and code points above 126
	 become \\uXXXX), so the client's non-blocking GCI fetch is never handed a Unicode
	 result."
	| ws |
	ws := WriteStream on: String new.
	aString do: [:ch | | code |
		code := ch asInteger.
		ch == $" ifTrue: [ws nextPutAll: '\"']
		ifFalse: [ch == $\ ifTrue: [ws nextPutAll: '\\']
		ifFalse: [code = 10 ifTrue: [ws nextPutAll: '\n']
		ifFalse: [code = 13 ifTrue: [ws nextPutAll: '\r']
		ifFalse: [code = 9 ifTrue: [ws nextPutAll: '\t']
		ifFalse: [code < 32
			ifTrue: [ws nextPutAll: '\u00'; nextPutAll: (self hex2: code)]
		ifFalse: [code > 126
			ifTrue: [code > 65535
				ifTrue: [ws nextPut: $?]
				ifFalse: [ws nextPutAll: '\u';
					nextPutAll: (self hex2: code // 256);
					nextPutAll: (self hex2: code \\ 256)]]
			ifFalse: [ws nextPut: ch]]]]]]]].
	^ws contents
]

{ #category : 'serializing' }
GsPushUpMethodRefactoring >> hex2: anInteger [
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
]
