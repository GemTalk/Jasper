"
Push one OR MORE methods DOWN (M8) from a source class into its immediate SUBCLASSES,
keeping the selector and the method source verbatim and the same side (instance stays
instance, class stays class -- no side flip). The refactoring is addressed by the source
class + a COLLECTION of selectors + the source side (isMeta); the targets (the immediate
subclasses) are resolved server-side, so the engine -- not the client -- owns the ''which
classes'' logic and can be tested in isolation. Single-method push-down is just a
one-element collection, so single- and multi-method share one path.

Push-down is the inverse of push-up (M7) and a many-target relative of move-method (M6);
it reuses the same change kinds and preview/apply/token machinery. Per movable selector it
stages a #methodAdd on EVERY immediate subclass plus a SINGLE #methodRemove on the source. A
subclass that does NOT yet understand the selector gets a plain add; a subclass that already
OVERRIDES it gets an opt-in OVERWRITE add (staged with the existing override's body + a
data-loss warning), which the client leaves un-ticked by default so the user consciously
chooses to replace that override. So one pushed-down selector produces N adds + 1 remove
(N = the immediate subclass count). Both change kinds already exist; no new kind is
introduced. Each selector is analysed independently; a declined selector is dropped from the
change set and reported, so a multi-push relocates the movable methods and explains the rest.

A GLOBAL decline (the source has no subclasses) empties the whole change set. A per-selector
decline (a HARD skip) is recorded when: the source method is missing; or the method sends
super (its meaning depends on the source class''s superclass, which changes once the home
moves down). A class where EVERY immediate subclass already overrides the selector is NOT a
decline any more -- it is simply an all-overwrite push the user opts into (or leaves entirely
un-ticked). Instance-variable access needs no check: the method already lives on the source,
so every accessed ivar is defined on (or inherited by) the source, and every subclass inherits
those same ivars.

This is the SIMPLEST SOUND variant: the definition is copied into each immediate subclass
(overwriting an override only when the user opts in) and removed from the source; senders are
NOT rewritten and no forwarding method is left behind. NOTE the intended semantics: after
push-down the source class no longer understands the selector, so this is meant for an
abstract superclass (or one whose
direct instances do not use the method). Building the change set compiles nothing and commits
nothing; the server-side apply compiles each subclass and removes the source, guarding the
removal so it fires only once EVERY immediate subclass understands the selector (a
deselected/failed add leaves the source method in place rather than stranding a subclass),
and NEVER commits (the user commits explicitly).
"
Class {
	#name : 'GsPushDownMethodRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'sourceClass',
		'selectors',
		'isMeta',
		'subClasses',
		'recipients',
		'changeSet',
		'analysisDone',
		'globalDecline',
		'declines',
		'appliedAddSelectors'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsPushDownMethodRefactoring class >> sourceClass: aClass selectors: aCollection meta: aBool [
	"Push aCollection of selectors from the aBool side of aClass down into the same side
	 of aClass's immediate subclasses."
	^self
		environment: GsRefactoringEnvironment new
		sourceClass: aClass
		selectors: aCollection
		meta: aBool
]

{ #category : 'instance creation' }
GsPushDownMethodRefactoring class >> environment: anEnvironment sourceClass: aClass selectors: aCollection meta: aBool [
	^self new
		setEnvironment: anEnvironment
		sourceClass: aClass
		selectors: aCollection
		meta: aBool
]

{ #category : 'preconditions' }
GsPushDownMethodRefactoring class >> analyzeForClass: aClass selectors: aCollection meta: aBool [
	"A pre-flight the client runs before opening the preview: a per-selector decline
	 reason (nil when movable) and the count that will move. targetClass is null because
	 the method lands in many subclasses."
	^(self
		sourceClass: aClass
		selectors: aCollection
		meta: aBool) analysisJsonString
]

{ #category : 'paginated preview' }
GsPushDownMethodRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	"A page from a previously-started preview (see startPreviewToken:maxBytes:), by
	 token. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'paginated preview' }
GsPushDownMethodRefactoring class >> applyForToken: token deselected: deselectedIds [
	"Apply a previously-started preview (by token). No commit. Answers an error
	 envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'paginated preview' }
GsPushDownMethodRefactoring class >> clearToken: token [
	"Drop a finished preview from SessionTemps."
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'private' }
GsPushDownMethodRefactoring >> setEnvironment: anEnvironment sourceClass: aClass selectors: aCollection meta: aBool [
	environment := anEnvironment.
	sourceClass := aClass.
	selectors := aCollection collect: [:s | s asSymbol].
	isMeta := aBool.
	analysisDone := false
]

{ #category : 'accessing' }
GsPushDownMethodRefactoring >> environment [
	^environment
]

{ #category : 'accessing' }
GsPushDownMethodRefactoring >> selectors [
	^selectors
]

{ #category : 'private' }
GsPushDownMethodRefactoring >> sourceBehavior [
	"The behaviour that holds the methods being pushed: the metaclass for a class-side
	 source."
	^isMeta ifTrue: [sourceClass class] ifFalse: [sourceClass]
]

{ #category : 'private' }
GsPushDownMethodRefactoring >> behaviorFor: aClass [
	"The relevant side of a subclass (its metaclass for a class-side push)."
	^isMeta ifTrue: [aClass class] ifFalse: [aClass]
]

{ #category : 'private - analysis' }
GsPushDownMethodRefactoring >> ensureAnalysis [
	analysisDone ifFalse: [
		analysisDone := true.
		[self computeAnalysis] on: Error do: [:e |
			globalDecline := 'The push-down could not be analysed: ', e messageText]]
]

{ #category : 'private - analysis' }
GsPushDownMethodRefactoring >> computeAnalysis [
	"Resolve the immediate subclasses, reject a class with none, then record a
	 per-selector decline (nil when movable) and, for movable selectors, the subclasses
	 that will receive a copy (those not already overriding it)."
	globalDecline := nil.
	declines := Dictionary new.
	recipients := Dictionary new.
	subClasses := (sourceClass subclasses ifNil: [#()]) asArray.
	subClasses isEmpty ifTrue: [
		^globalDecline := 'Cannot push down: ', sourceClass name asString, ' has no subclasses.'].
	selectors do: [:sel | self analyzeSelector: sel]
]

{ #category : 'private - analysis' }
GsPushDownMethodRefactoring >> analyzeSelector: aSelector [
	"Record the decline reason (nil when movable) and the receiving subclasses for one
	 selector. EVERY immediate subclass is a recipient: those that do not yet understand
	 the selector get a fresh copy; those that already override it get an opt-in OVERWRITE
	 (staged with the existing body + a data-loss warning), so a class where every subclass
	 overrides is no longer a hard decline -- it is just an all-overwrite push the user
	 opts into. Only a missing source method or a super-send is a hard decline."
	| method src tree |
	method := self sourceBehavior compiledMethodAt: aSelector environmentId: 0 otherwise: nil.
	method isNil ifTrue: [
		^declines at: aSelector put:
			'Cannot push down #', aSelector asString, ': it is not defined in ', sourceClass name asString, '.'].
	src := method sourceString.
	tree := [RBParser parseMethod: src] on: Error do: [:e | nil].
	(tree notNil and: [self tree: tree referencesName: 'super']) ifTrue: [
		^declines at: aSelector put:
			'Cannot push down #', aSelector asString, ': it sends super, whose meaning depends on the class''s superclass.'].
	recipients at: aSelector put: subClasses.
	declines at: aSelector put: nil
]

{ #category : 'private - analysis' }
GsPushDownMethodRefactoring >> tree: aTree referencesName: aName [
	"True if aTree or any descendant is a variable node named aName."
	aTree nodesDo: [:n | (n isVariable and: [n name = aName]) ifTrue: [^true]].
	^false
]

{ #category : 'private' }
GsPushDownMethodRefactoring >> dictNameForClass: aClass [
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
]

{ #category : 'private' }
GsPushDownMethodRefactoring >> categoryOfSelector: aSelector [
	^((self sourceBehavior categoryOfSelector: aSelector environmentId: 0)
		ifNil: ['as yet unclassified']) asString
]

{ #category : 'preconditions' }
GsPushDownMethodRefactoring >> globalDecline [
	"nil if the push-down as a whole is viable, otherwise a reason that empties the
	 change set (the source has no subclasses)."
	self ensureAnalysis.
	^globalDecline
]

{ #category : 'preconditions' }
GsPushDownMethodRefactoring >> declineFor: aSelector [
	"nil if aSelector will move, otherwise the per-selector (or inherited global)
	 reason it will not."
	self ensureAnalysis.
	globalDecline notNil ifTrue: [^globalDecline].
	^declines at: aSelector asSymbol ifAbsent: [nil]
]

{ #category : 'accessing' }
GsPushDownMethodRefactoring >> recipientsFor: aSelector [
	"The immediate subclasses that will receive aSelector (empty for a declined or unknown
	 selector). Includes subclasses that already override it -- those receive an opt-in
	 OVERWRITE rather than a fresh add."
	self ensureAnalysis.
	^recipients at: aSelector asSymbol ifAbsent: [#()]
]

{ #category : 'private - analysis' }
GsPushDownMethodRefactoring >> existingSourceIn: aSubclass for: aSelector [
	"If aSubclass ALREADY overrides aSelector on this side, its current source (which
	 pushing down will OVERWRITE); nil otherwise."
	| beh |
	beh := self behaviorFor: aSubclass.
	(beh includesSelector: aSelector) ifFalse: [^nil].
	^(beh compiledMethodAt: aSelector environmentId: 0 otherwise: nil)
		ifNil: [nil] ifNotNil: [:m | m sourceString]
]

{ #category : 'preconditions' }
GsPushDownMethodRefactoring >> overwriteWarningFor: aSelector [
	"A data-loss summary if pushing aSelector down would OVERWRITE an existing override in
	 one or more subclasses; nil otherwise. nil for a declined selector or global decline."
	| overs |
	self ensureAnalysis.
	globalDecline notNil ifTrue: [^nil].
	(self declineFor: aSelector) notNil ifTrue: [^nil].
	overs := (self recipientsFor: aSelector) select: [:s | (self behaviorFor: s) includesSelector: aSelector].
	overs isEmpty ifTrue: [^nil].
	^'Pushing down overwrites the existing override in ', overs size printString,
	  ' subclass', (overs size = 1 ifTrue: [''] ifFalse: ['es']), ' -- lost unless left un-ticked.'
]

{ #category : 'accessing' }
GsPushDownMethodRefactoring >> movableSelectors [
	"The selectors that will actually move, preserving request order."
	self ensureAnalysis.
	globalDecline notNil ifTrue: [^#()].
	^selectors select: [:sel | (declines at: sel ifAbsent: [nil]) isNil]
]

{ #category : 'accessing' }
GsPushDownMethodRefactoring >> movableCount [
	^self movableSelectors size
]

{ #category : 'building' }
GsPushDownMethodRefactoring >> changeSet [
	"The staged, non-committing change set, computed once and cached. Empty on a global
	 decline; otherwise, per movable selector, one add per receiving subclass plus one
	 remove from the source."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'building' }
GsPushDownMethodRefactoring >> buildChangeSet [
	| cs |
	cs := GsRefactoringChangeSet new.
	self ensureAnalysis.
	globalDecline notNil ifTrue: [^cs].
	self movableSelectors do: [:sel | self stagePushOf: sel into: cs].
	^cs
]

{ #category : 'building' }
GsPushDownMethodRefactoring >> stagePushOf: aSelector into: cs [
	"Stage an add on every receiving subclass -- an OVERWRITE (carrying the existing body +
	 a data-loss warning) for a subclass that already overrides the selector, a plain add
	 otherwise -- then a single remove from the source."
	| method src cat |
	method := self sourceBehavior compiledMethodAt: aSelector environmentId: 0 otherwise: nil.
	src := method sourceString.
	cat := self categoryOfSelector: aSelector.
	(self recipientsFor: aSelector) do: [:sub | | existing |
		existing := self existingSourceIn: sub for: aSelector.
		existing isNil
			ifTrue: [cs
				addMethodAddInDictionary: (self dictNameForClass: sub)
				className: sub name asString
				isMeta: isMeta
				selector: aSelector
				category: cat
				newSource: src]
			ifFalse: [cs
				addMethodOverwriteInDictionary: (self dictNameForClass: sub)
				className: sub name asString
				isMeta: isMeta
				selector: aSelector
				category: cat
				oldSource: existing
				newSource: src
				warning: 'Pushing down overwrites ', sub name asString, '>>', aSelector asString, ' -- its current override is lost.']].
	cs
		addMethodRemoveInDictionary: (self dictNameForClass: sourceClass)
		className: sourceClass name asString
		isMeta: isMeta
		selector: aSelector
		category: cat
		oldSource: src
]

{ #category : 'serializing' }
GsPushDownMethodRefactoring >> analysisJsonString [
	"The pre-flight payload: a null targetClass (many subclasses), the movable count, a
	 global decline (if any), and a per-selector {selector, decline} array."
	| ws |
	self ensureAnalysis.
	ws := WriteStream on: String new.
	ws nextPutAll: '{"targetClass":null'.
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
GsPushDownMethodRefactoring >> previewJsonString [
	^self changeSet jsonString
]

{ #category : 'serializing' }
GsPushDownMethodRefactoring >> outOfScopeJsonString [
	"The scope / precondition payload for the preview panel, in the family's shape. A
	 hard global decline (which blocks Apply) rides here; per-selector skips ride in
	 skippedMethods."
	^'{"references":0,"skipped":', (selectors size - self movableCount) printString,
	  ',"scope":"class","collision":null,"decline":',
	  (globalDecline ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  '}'
]

{ #category : 'serializing' }
GsPushDownMethodRefactoring >> skippedMethodsJsonString [
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
GsPushDownMethodRefactoring >> startPreviewToken: token maxBytes: maxBytes [
	"Build the change set, stash this refactoring in SessionTemps under token, and
	 answer the first page plus totals and precondition warnings. Nothing is committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"targetClass":null',
	  ',"movableCount":', self movableCount printString,
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"skippedMethods":', self skippedMethodsJsonString,
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'paginated preview' }
GsPushDownMethodRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
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
GsPushDownMethodRefactoring >> applyDeselected: deselectedIds [
	"Apply the staged changes in the stone WITHOUT committing. A deselected id is
	 skipped. The source removal is guarded (see applyMethodRemove:) so a skipped or
	 failed subclass add never strands that subclass. Answers {applied, failed:[..]}."
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
GsPushDownMethodRefactoring >> applyChange: aChange [
	"Answer true when the change was applied, false when it was safely skipped."
	aChange kind == #methodAdd ifTrue: [^self applyMethodAdd: aChange].
	aChange kind == #methodRemove ifTrue: [^self applyMethodRemove: aChange].
	^self error: 'Unexpected change kind for push-down-method: ', aChange kind printString
]

{ #category : 'applying' }
GsPushDownMethodRefactoring >> applyMethodAdd: aChange [
	"Compile the pushed-down method onto a subclass/side. No commit. Records the selector
	 as applied so the paired remove fires only when at least one add actually happened
	 this run (so un-ticking every target is a genuine no-op, even when every subclass
	 already understood the selector via its own override). The compile RAISES when it fails, so
	 the record is only reached once the method is actually installed on the subclass."
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
GsPushDownMethodRefactoring >> applyMethodRemove: aChange [
	"Remove the method from the source -- but ONLY once at least one add for this selector
	 was applied this run AND EVERY immediate subclass understands the selector on its own
	 (it received a copy or already overrode it). The applied-add clause makes un-ticking
	 every target a no-op; the all-subclasses clause makes a partial push a copy-down that
	 leaves the source in place rather than stranding a subclass. No commit."
	| cls sel |
	sel := aChange selector asSymbol.
	(appliedAddSelectors includes: sel) ifFalse: [^false].
	(subClasses allSatisfy: [:s | (self behaviorFor: s) includesSelector: sel])
		ifFalse: [^false].
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	(aChange isMeta ifTrue: [cls class] ifFalse: [cls]) removeSelector: sel.
	^true
]

{ #category : 'serializing' }
GsPushDownMethodRefactoring >> jsonQuote: aString [
	^GsRefactoringJson jsonQuote: aString
]

{ #category : 'serializing' }
GsPushDownMethodRefactoring >> jsonEscape: aString [
	^GsRefactoringJson jsonEscape: aString
]

{ #category : 'serializing' }
GsPushDownMethodRefactoring >> hex2: anInteger [
	^GsRefactoringJson hex2: anInteger
]
