"
Insert a new common superclass (V6) and, optionally, hoist shared members up into it (V7),
without committing.

V6 Insert Superclass slides a NEW, empty class in between one class and its current superclass:
`Object -> Dog` becomes `Object -> New -> Dog`. V7 Extract Superclass does the same above a chosen
set of SIBLING classes and pulls their common instance variables and methods up into the new
parent, removing the duplication. V6 is the degenerate case of V7 -- extract above ONE class,
hoisting ZERO members -- so ONE engine serves both, driven from two thin client commands.

The apply core is a direct generalisation of GsInstVarStructureRefactoring (the same
reversion-by-newVersionOf: machinery, because GemStone has no reparent/addInstVarName: primitive)
plus ONE new change kind, #classAdd, for the brand-new superclass (which has no prior class
history). For every extracted class and its descendant subtree, top-down, apply creates a new
class version, copies its methods forward, and re-parents it -- the extracted classes onto the NEW
superclass, their descendants onto their own freshly-versioned ancestor. Hoisted instance
variables move onto the new superclass (and off each extracted class); hoisted methods are added to
the new superclass and skipped when copying each extracted class forward.

Shared parent (S) = the anchor class's immediate superclass. The extracted set = the anchor plus
the chosen siblings, which MUST all be immediate subclasses of S (extract only inserts above
same-parent siblings, keeping the new class's own superclass unambiguous). Sibling names resolve
within S's own subclasses first, so a same-named class in another dictionary is never grabbed.

Member CLASSIFICATION (candidateMethods / candidateInstVars) drives the client's checklist but not
the apply: a method common+identical across the extracted set is 'identical' (pre-checked); common
but differing is 'divergent'; present in only some is 'partial'; one that sends super, or touches
an instance variable not being hoisted (and not on S), or a class/pool variable below S, is
'unhoistable'. Only identical members are pre-checked, and only when there is a sibling to
deduplicate against -- so V6 (no siblings) defaults to hoisting nothing (a pure insert). A member
the client nonetheless asks to hoist which the engine finds unhoistable is a global decline (it
would not compile on the new superclass).

Preconditions (global declines that empty the change set, surfaced in the preview banner): the
anchor has no superclass (nothing to slot the new class under); a class named newName already
exists; a chosen sibling does not resolve or is not an immediate subclass of S; a hoisted ivar is
not the anchor's own ivar, or already collides on S; a hoisted method is missing on the anchor or
is unhoistable.

Apply is ALL-OR-NOTHING (the class creation, the reparents and the hoists must move together), so
the client offers no per-change deselection and applyDeselected: ignores any deselection. Existing
INSTANCES are not migrated (they keep their prior version, standard GemStone class evolution).
Building compiles nothing and commits nothing; the apply compiles in the stone but NEVER commits.
"
Class {
	#name : 'GsExtractSuperclassRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'anchorClass',
		'newName',
		'dictNameOrNil',
		'siblingNames',
		'hoistMethods',
		'hoistInstVars',
		'sharedParent',
		'extractedClasses',
		'newClass',
		'changeSet',
		'analysisDone',
		'decline',
		'oldToNew'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsExtractSuperclassRefactoring class >> class: anAnchor extractSuperclassNamed: aName inDictionary: aDictOrNil siblings: sibs hoistMethods: methods hoistInstVars: ivars [
	"V7 (and V6 as the no-sibling/no-member case): extract a new superclass aName above anAnchor
	 and the chosen sibling classes (sibs, names NOT including the anchor), hoisting the given
	 instance-side selectors (methods) and own instance variables (ivars) up into it."
	^self new
		setEnvironment: GsRefactoringEnvironment new
		class: anAnchor
		name: aName
		dict: aDictOrNil
		siblings: sibs
		methods: methods
		instVars: ivars
]

{ #category : 'instance creation' }
GsExtractSuperclassRefactoring class >> class: anAnchor insertSuperclassNamed: aName inDictionary: aDictOrNil [
	"V6: insert a new EMPTY superclass aName above anAnchor only (no siblings, no members)."
	^self
		class: anAnchor
		extractSuperclassNamed: aName
		inDictionary: aDictOrNil
		siblings: #()
		hoistMethods: #()
		hoistInstVars: #()
]

{ #category : 'preconditions' }
GsExtractSuperclassRefactoring class >> analyzeClass: anAnchor extractSuperclassNamed: aName siblings: sibs hoistMethods: methods hoistInstVars: ivars [
	^(self class: anAnchor extractSuperclassNamed: aName inDictionary: nil siblings: sibs hoistMethods: methods hoistInstVars: ivars) analysisJsonString
]

{ #category : 'preconditions' }
GsExtractSuperclassRefactoring class >> candidatesForClass: anAnchor siblings: sibs [
	"The classified hoist candidates (methods + instance variables) the preview checklist
	 renders, computed BEFORE any hoist set is chosen. Answers the candidates JSON."
	^(self class: anAnchor extractSuperclassNamed: 'GsExtractSuperclassProbe' inDictionary: nil siblings: sibs hoistMethods: #() hoistInstVars: #()) candidatesJsonString
]

{ #category : 'paginated preview' }
GsExtractSuperclassRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'paginated preview' }
GsExtractSuperclassRefactoring class >> applyForToken: token deselected: deselectedIds [
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"committed":false,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'paginated preview' }
GsExtractSuperclassRefactoring class >> clearToken: token [
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'private' }
GsExtractSuperclassRefactoring >> setEnvironment: anEnvironment class: anAnchor name: aName dict: aDictOrNil siblings: sibs methods: methods instVars: ivars [
	environment := anEnvironment.
	anchorClass := anAnchor.
	newName := aName asString.
	dictNameOrNil := aDictOrNil isNil ifTrue: [nil] ifFalse: [aDictOrNil asString].
	siblingNames := (sibs ifNil: [#()]) collect: [:e | e asString].
	hoistMethods := (methods ifNil: [#()]) collect: [:e | e asSymbol].
	hoistInstVars := (ivars ifNil: [#()]) collect: [:e | e asString].
	analysisDone := false
]

{ #category : 'accessing' }
GsExtractSuperclassRefactoring >> environment [
	^environment
]

{ #category : 'accessing' }
GsExtractSuperclassRefactoring >> extractedClasses [
	self ensureAnalysis.
	^extractedClasses
]

{ #category : 'accessing' }
GsExtractSuperclassRefactoring >> sharedParent [
	self ensureAnalysis.
	^sharedParent
]

{ #category : 'private' }
GsExtractSuperclassRefactoring >> sourceOf: aSelector in: aClass [
	| m |
	m := aClass compiledMethodAt: aSelector environmentId: 0 otherwise: nil.
	^m isNil ifTrue: [nil] ifFalse: [m sourceString]
]

{ #category : 'private' }
GsExtractSuperclassRefactoring >> categoryOf: aSelector in: aClass [
	^((aClass categoryOfSelector: aSelector environmentId: 0) ifNil: ['as yet unclassified']) asString
]

{ #category : 'private - analysis' }
GsExtractSuperclassRefactoring >> ensureAnalysis [
	analysisDone ifFalse: [
		analysisDone := true.
		[self computeAnalysis] on: Error do: [:e |
			decline := 'The extract-superclass could not be analysed: ', e messageText]]
]

{ #category : 'private - analysis' }
GsExtractSuperclassRefactoring >> computeAnalysis [
	"Resolve the shared parent S and the extracted set, reject the global preconditions, then
	 validate the requested hoist sets. Sets decline (nil when viable), sharedParent and
	 extractedClasses."
	decline := nil.
	extractedClasses := OrderedCollection new.
	sharedParent := anchorClass superclass.
	sharedParent isNil ifTrue: [
		^decline := 'Cannot extract a superclass above ', anchorClass name asString, ': it has no superclass.'].
	(environment classNamed: newName) notNil ifTrue: [
		^decline := 'Cannot extract superclass ', newName, ': a class of that name already exists.'].
	"classNamed: only matches a Class binding; a name bound to a NON-class global
	 would otherwise slip past and be silently clobbered by applyClassAdd:'s
	 subclass:...inDictionary:. Decline any existing binding for the name (#379
	 review: the client already guards this, but a non-UI caller -- MCP, SUnit,
	 direct engine use -- must be protected here too).
	 The question is asked SYSTEM-WIDE, deliberately: applyClassAdd: creates into one
	 dictionary, so a binding in a lower-priority dictionary would only be shadowed
	 rather than clobbered, but shadowing an existing global with a new class is its own
	 trap and GsRenameClassRefactoring>>newNameCollision already declines symbol-list-wide.
	 (resolveSibling: scopes its lookup instead -- that one is about FINDING an existing
	 class, where grabbing a same-named class from another dictionary would be wrong.)
	 The decline names the symbol list so it cannot be read as a collision in the
	 anchor's own dictionary."
	(environment symbolList objectNamed: newName asSymbol) notNil ifTrue: [
		^decline := 'Cannot extract superclass ', newName, ': the name ', newName, ' is already in use as a global on the symbol list.'].
	extractedClasses add: anchorClass.
	siblingNames do: [:nm | | sib |
		sib := self resolveSibling: nm.
		sib isNil ifTrue: [
			^decline := 'Cannot extract superclass: ', nm, ' is not a subclass of ', sharedParent name asString, '.'].
		sib == anchorClass ifFalse: [
			(extractedClasses includes: sib) ifFalse: [extractedClasses add: sib]]].
	self validateHoistInstVars.
	decline notNil ifTrue: [^decline].
	self validateHoistMethods
]

{ #category : 'private - analysis' }
GsExtractSuperclassRefactoring >> resolveSibling: aName [
	"The immediate subclass of the shared parent named aName -- resolved within S's OWN
	 subclasses first (lineage-safe), so a same-named class in another dictionary is never
	 grabbed. nil if no immediate subclass of S has that name."
	^(sharedParent subclasses ifNil: [#()])
		detect: [:c | c name asString = aName]
		ifNone: [nil]
]

{ #category : 'private - analysis' }
GsExtractSuperclassRefactoring >> validateHoistInstVars [
	"Every hoisted ivar must be the anchor's OWN ivar, must not already be defined on S (a
	 double declaration once the new class -- a child of S -- declares it), and must not be OWNED
	 BY A DESCENDANT of any extracted class.

	 That last one is why this walks downwards. Hoisting puts the name on the new superclass, so
	 every descendant inherits it; a descendant that also declares the name itself would be
	 re-versioned with a duplicate declaration and GemStone rejects it. Without this check the
	 rejection surfaced from applyClassChange: PART-WAY THROUGH the apply, leaving the new class
	 created and some reparents done -- the half-applied state the user then has to abort. The
	 class comment sells these as global declines that empty the change set, so it belongs here."
	| own supAll |
	own := environment ownInstVarNamesOf: anchorClass.
	supAll := environment allInstVarNamesOf: sharedParent.
	hoistInstVars do: [:v |
		(own includes: v) ifFalse: [
			^decline := 'Cannot hoist instance variable ', v, ': it is not declared in ', anchorClass name asString, '.'].
		(supAll includes: v) ifTrue: [
			^decline := 'Cannot hoist instance variable ', v, ': ', sharedParent name asString, ' already defines it.'].
		(self descendantDeclaring: v) ifNotNil: [:owner |
			^decline := 'Cannot hoist instance variable ', v, ': ', owner name asString, ' already declares it.']]
]

{ #category : 'private - analysis' }
GsExtractSuperclassRefactoring >> descendantDeclaring: anIvarName [
	"The first descendant of an extracted class that declares anIvarName as its OWN instance
	 variable, or nil. The extracted classes themselves are skipped -- the anchor is supposed to
	 own the name (it is what gets hoisted), and a sibling losing its own copy is the point."
	extractedClasses do: [:cls |
		(environment descendantsOf: cls) do: [:d |
			((extractedClasses includes: d) not
				and: [(environment ownInstVarNamesOf: d) includes: anIvarName])
					ifTrue: [^d]]].
	^nil
]

{ #category : 'private - analysis' }
GsExtractSuperclassRefactoring >> validateHoistMethods [
	"Every hoisted method must be implemented by the anchor and be hoistable onto the new
	 superclass given the instance variables ACTUALLY being hoisted (plus whatever S provides)."
	| visible |
	visible := self visibleIvarSymbolsWith: hoistInstVars.
	hoistMethods do: [:sel |
		(anchorClass includesSelector: sel) ifFalse: [
			^decline := 'Cannot hoist #', sel asString, ': it is not defined in ', anchorClass name asString, '.'].
		(self hoistabilityReasonFor: sel visibleIvars: visible) ifNotNil: [:reason |
			^decline := reason]]
]

{ #category : 'private - analysis' }
GsExtractSuperclassRefactoring >> visibleIvarSymbolsWith: anIvarList [
	"The instance variables an ivar-list would make VISIBLE on the new superclass: that list
	 plus everything S already provides, as a Set of Symbols."
	| visible |
	visible := Set new.
	anIvarList do: [:v | visible add: v asSymbol].
	(environment allInstVarNamesOf: sharedParent) do: [:v | visible add: v asSymbol].
	^visible
]

{ #category : 'private - analysis' }
GsExtractSuperclassRefactoring >> hoistabilityReasonFor: aSelector visibleIvars: visibleSet [
	"nil if the anchor's #aSelector can be hoisted onto the new superclass given visibleSet (the
	 instance variables that will be reachable there); otherwise a reason. A method is
	 unhoistable when it sends super (its meaning depends on the class's superclass, which changes
	 when the home moves up), accesses an instance variable not in visibleSet, or references a
	 class/pool variable declared only below S -- in each case it would not compile on the new
	 superclass. Mirrors push-up's checks."
	| src tree accessed missing sharedBelow refNames badShared |
	src := self sourceOf: aSelector in: anchorClass.
	src isNil ifTrue: [^'Cannot hoist #', aSelector asString, ': it is not defined in ', anchorClass name asString, '.'].
	tree := [RBParser parseMethod: src] on: Error do: [:e | nil].
	(tree notNil and: [self tree: tree referencesName: 'super']) ifTrue: [
		^'Cannot hoist #', aSelector asString, ': it sends super, whose meaning depends on the class''s superclass.'].
	accessed := [(anchorClass compiledMethodAt: aSelector environmentId: 0 otherwise: nil) instVarsAccessed] on: Error do: [:e | #()].
	missing := accessed reject: [:v | visibleSet includes: v asSymbol].
	missing isEmpty ifFalse: [
		^'Cannot hoist #', aSelector asString, ': it uses instance variable(s) not available on the new superclass (',
			(self commaList: (missing collect: [:v | v asString])), ').'].
	sharedBelow := self sharedVarsBelowParent.
	sharedBelow isEmpty ifFalse: [
		refNames := Set new.
		tree ifNotNil: [tree nodesDo: [:n | n isVariable ifTrue: [refNames add: n name asSymbol]]].
		badShared := sharedBelow select: [:v | refNames includes: v].
		badShared isEmpty ifFalse: [
			^'Cannot hoist #', aSelector asString, ': it uses class/pool variable(s) not defined on the new superclass (',
				(self commaList: ((badShared asSortedCollection: [:a :b | a <= b]) asArray collect: [:v | v asString])), ').']].
	^nil
]

{ #category : 'private - analysis' }
GsExtractSuperclassRefactoring >> sharedVarsBelowParent [
	"Class-variable + pool-variable names visible to the anchor but NOT to S -- a hoisted method
	 referencing any of these would not compile on the new class (a child of S)."
	| below |
	below := self sharedVarNamesOf: anchorClass.
	(self sharedVarNamesOf: sharedParent) do: [:v | below remove: v ifAbsent: []].
	^below
]

{ #category : 'private - analysis' }
GsExtractSuperclassRefactoring >> sharedVarNamesOf: aClass [
	| names |
	names := Set new.
	([aClass allClassVarNames] on: Error do: [:e | #()]) do: [:n | names add: n asSymbol].
	([aClass sharedPools] on: Error do: [:e | #()]) do: [:pool | pool keysDo: [:k | names add: k asSymbol]].
	^names
]

{ #category : 'private - analysis' }
GsExtractSuperclassRefactoring >> tree: aTree referencesName: aName [
	aTree nodesDo: [:n | (n isVariable and: [n name = aName]) ifTrue: [^true]].
	^false
]

{ #category : 'private' }
GsExtractSuperclassRefactoring >> commaList: aCollection [
	^aCollection inject: '' into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ', ', s]]
]

{ #category : 'private' }
GsExtractSuperclassRefactoring >> spaceList: aCollection [
	^aCollection inject: '' into: [:acc :s | acc isEmpty ifTrue: [s asString] ifFalse: [acc, ' ', s asString]]
]

{ #category : 'preconditions' }
GsExtractSuperclassRefactoring >> decline [
	self ensureAnalysis.
	^decline
]

{ #category : 'classification' }
GsExtractSuperclassRefactoring >> candidateMethods [
	"Classified method hoist candidates across the extracted set E = anchor + siblings. A
	 candidate is a selector the ANCHOR implements (instance side). Answers an OrderedCollection
	 of Arrays {selector, kindSymbol, reasonStringOrNil}: #unhoistable (super/foreign var),
	 #identical (every class in E implements it byte-identically), #divergent (every class in E
	 implements it but a source differs), or #partial (only some of E implement it)."
	| result visible |
	self ensureAnalysis.
	result := OrderedCollection new.
	decline notNil ifTrue: [^result].
	"Classify methods OPTIMISTICALLY: assume the identical instance variables (the ones checked
	 by default) will be hoisted too, so a shared accessor reads as hoistable rather than being
	 flagged for an ivar that will in fact travel up with it. Apply-time validation uses the
	 ACTUAL chosen ivar set, so an inconsistent selection (hoist the accessor, not the ivar) still
	 declines."
	visible := self visibleIvarSymbolsWith: self identicalCandidateIvarNames.
	(anchorClass selectors asSortedCollection: [:a :b | a asString <= b asString]) do: [:sel | | reason anchorSrc all differs |
		reason := self hoistabilityReasonFor: sel visibleIvars: visible.
		reason notNil
			ifTrue: [result add: (Array with: sel with: #unhoistable with: reason)]
			ifFalse: [
				anchorSrc := self sourceOf: sel in: anchorClass.
				all := extractedClasses allSatisfy: [:c | c includesSelector: sel].
				all
					ifFalse: [result add: (Array with: sel with: #partial with: nil)]
					ifTrue: [
						differs := extractedClasses anySatisfy: [:c | (self sourceOf: sel in: c) ~= anchorSrc].
						result add: (Array with: sel with: (differs ifTrue: [#divergent] ifFalse: [#identical]) with: nil)]]].
	^result
]

{ #category : 'classification' }
GsExtractSuperclassRefactoring >> candidateInstVars [
	"Classified instance-variable hoist candidates: each OWN ivar of the anchor, as Arrays
	 {name, kindSymbol}: #unhoistable (S already defines it), #identical (owned by every class in
	 E), or #partial (owned by only some of E)."
	| result |
	self ensureAnalysis.
	result := OrderedCollection new.
	decline notNil ifTrue: [^result].
	(environment ownInstVarNamesOf: anchorClass) do: [:v | | all |
		((environment allInstVarNamesOf: sharedParent) includes: v)
			ifTrue: [result add: (Array with: v with: #unhoistable)]
			ifFalse: [
				all := extractedClasses allSatisfy: [:c | (environment ownInstVarNamesOf: c) includes: v].
				result add: (Array with: v with: (all ifTrue: [#identical] ifFalse: [#partial]))]].
	^result
]

{ #category : 'classification' }
GsExtractSuperclassRefactoring >> identicalCandidateIvarNames [
	"The own ivars of the anchor that every extracted class also owns -- the ones hoisted by
	 default -- as an Array of Strings. Used to classify method hoistability optimistically."
	^(environment ownInstVarNamesOf: anchorClass) select: [:v |
		((environment allInstVarNamesOf: sharedParent) includes: v) not
			and: [extractedClasses allSatisfy: [:c | (environment ownInstVarNamesOf: c) includes: v]]]
]

{ #category : 'classification' }
GsExtractSuperclassRefactoring >> defaultChecksMember: aKind [
	"Only 'identical' members are pre-checked, and only when there is a sibling to deduplicate
	 against (so a single-anchor V6 defaults to hoisting nothing -- a pure insert)."
	^aKind == #identical and: [siblingNames notEmpty]
]

{ #category : 'building' }
GsExtractSuperclassRefactoring >> changeSet [
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'building' }
GsExtractSuperclassRefactoring >> buildChangeSet [
	"Stage: the #classAdd for the new superclass; then, per extracted class top-down, a
	 #classDefinitionEdit re-parenting it under the new class (with the hoisted ivars removed)
	 followed by a #classReparent for every descendant; then the hoisted methods as #methodAdd
	 on the new class + #methodRemove on each extracted class that implements them. Compiles
	 nothing, commits nothing."
	| cs dn |
	cs := GsRefactoringChangeSet new.
	self ensureAnalysis.
	decline notNil ifTrue: [^cs].
	dn := self newClassDictName.
	cs
		addClassAddInDictionary: dn
		className: newName
		superclassName: sharedParent name asString
		newSource: self newClassDefinition.
	extractedClasses do: [:e |
		self stageExtractedEdit: e into: cs.
		(environment descendantsOf: e) do: [:d | self stageReparent: d into: cs]].
	hoistMethods do: [:sel | self stageHoistOf: sel into: cs].
	^cs
]

{ #category : 'building' }
GsExtractSuperclassRefactoring >> stageExtractedEdit: aClass into: cs [
	"A #classDefinitionEdit re-parenting aClass under the new superclass, with the hoisted ivars
	 dropped from its own list."
	| oldDef newList |
	oldDef := aClass definition.
	newList := (environment ownInstVarNamesOf: aClass) reject: [:n | hoistInstVars includes: n].
	cs
		addClassDefinitionEditInDictionary: (self dictNameForClass: aClass)
		className: aClass name asString
		oldSource: oldDef
		newSource: (self definitionText: oldDef superclass: newName ivars: newList)
]

{ #category : 'building' }
GsExtractSuperclassRefactoring >> stageReparent: aClass into: cs [
	"A #classReparent for a descendant of an extracted class: recompiled only to re-point at its
	 freshly-versioned ancestor. Its own definition text is unchanged."
	| oldDef |
	oldDef := aClass definition.
	cs
		addClassReparentInDictionary: (self dictNameForClass: aClass)
		className: aClass name asString
		oldSource: oldDef
		newSource: oldDef
]

{ #category : 'building' }
GsExtractSuperclassRefactoring >> stageHoistOf: aSelector into: cs [
	"Add the hoisted method (from the anchor's source) onto the new superclass, and stage a
	 #methodRemove from every extracted class that implements it (for the preview; apply skips
	 it on copy-forward, so the remove is a guarded no-op)."
	| src cat |
	src := self sourceOf: aSelector in: anchorClass.
	cat := self categoryOf: aSelector in: anchorClass.
	cs
		addMethodAddInDictionary: (self newClassDictName)
		className: newName
		isMeta: false
		selector: aSelector
		category: cat
		newSource: src.
	extractedClasses do: [:e |
		(e includesSelector: aSelector) ifTrue: [
			cs
				addMethodRemoveInDictionary: (self dictNameForClass: e)
				className: e name asString
				isMeta: false
				selector: aSelector
				category: (self categoryOf: aSelector in: e)
				oldSource: (self sourceOf: aSelector in: e)]]
]

{ #category : 'building' }
GsExtractSuperclassRefactoring >> definitionText: oldDef superclass: supName ivars: ivarList [
	"oldDef rewritten to name supName as the superclass and ivarList as the own-instVar list.
	 Display-only (the apply computes both directly); replaces the leading superclass token and
	 the instVarNames: list."
	| idx s |
	s := oldDef.
	idx := s indexOfSubCollection: 'subclass:'.
	idx > 0 ifTrue: [s := supName, ' ', (s copyFrom: idx to: s size)].
	^self definitionWithIvars: ivarList in: s
]

{ #category : 'building' }
GsExtractSuperclassRefactoring >> definitionWithIvars: anIvarList in: defString [
	"defString with the instVarNames: clause's parenthesised list replaced by anIvarList
	 (quoted). Mirrors GsInstVarStructureRefactoring; display-only."
	| marker start openParen closeParen ws |
	marker := 'instVarNames:'.
	start := defString indexOfSubCollection: marker.
	start = 0 ifTrue: [^defString].
	openParen := defString indexOf: $( startingAt: start.
	openParen = 0 ifTrue: [^defString].
	closeParen := defString indexOf: $) startingAt: openParen.
	closeParen = 0 ifTrue: [^defString].
	ws := WriteStream on: String new.
	ws nextPutAll: (defString copyFrom: 1 to: openParen).
	anIvarList keysAndValuesDo: [:i :n |
		i = 1 ifFalse: [ws nextPut: $ ].
		ws nextPutAll: ''''; nextPutAll: n asString; nextPutAll: ''''].
	ws nextPutAll: (defString copyFrom: closeParen to: defString size).
	^ws contents
]

{ #category : 'building' }
GsExtractSuperclassRefactoring >> newClassDefinition [
	"A generated class definition for the new superclass (display-only)."
	^sharedParent name asString, ' subclass: ''', newName, '''
	instVarNames: #(', (self quotedList: hoistInstVars), ')
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: ', self newClassDictName
]

{ #category : 'building' }
GsExtractSuperclassRefactoring >> quotedList: aCollection [
	"aCollection as a space-separated list of single-quoted names, e.g. 'name' 'age'."
	| ws q |
	q := String with: $'.
	ws := WriteStream on: String new.
	aCollection keysAndValuesDo: [:i :n |
		i = 1 ifFalse: [ws nextPut: $ ].
		ws nextPutAll: q; nextPutAll: n asString; nextPutAll: q].
	^ws contents
]

{ #category : 'private' }
GsExtractSuperclassRefactoring >> newClassDictName [
	"The dictionary the new class is filed in: the caller's choice, else the anchor's own
	 dictionary."
	dictNameOrNil ifNotNil: [:dn | ^dn].
	^self dictNameForClass: anchorClass
]

{ #category : 'private' }
GsExtractSuperclassRefactoring >> dictNameForClass: aClass [
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: ['UserGlobals'] ifFalse: [dicts first name asString]
]

{ #category : 'serializing' }
GsExtractSuperclassRefactoring >> analysisJsonString [
	"The pre-flight payload: the decline reason (nil when viable), the new class name, the
	 shared parent, and the number of staged changes."
	self ensureAnalysis.
	^'{"decline":', (decline ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  ',"newClass":', (self jsonQuote: newName),
	  ',"sharedParent":', (decline notNil ifTrue: ['null'] ifFalse: [self jsonQuote: sharedParent name asString]),
	  ',"affectedCount":', (decline notNil ifTrue: ['0'] ifFalse: [self changeSet size printString]),
	  '}'
]

{ #category : 'serializing' }
GsExtractSuperclassRefactoring >> candidatesJsonString [
	"The classified member candidates for the preview checklist: methods and instance variables,
	 each with its classification kind, a defaultChecked flag, and (methods) an unhoistable
	 reason. Plus the resolved sibling set and any global decline."
	| ws first |
	self ensureAnalysis.
	ws := WriteStream on: String new.
	ws nextPutAll: '{"decline":'; nextPutAll: (decline ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]).
	ws nextPutAll: ',"sharedParent":';
		nextPutAll: (decline notNil ifTrue: ['null'] ifFalse: [self jsonQuote: sharedParent name asString]).
	ws nextPutAll: ',"methods":['.
	first := true.
	self candidateMethods do: [:m |
		first ifFalse: [ws nextPut: $,]. first := false.
		ws nextPutAll: '{"selector":'; nextPutAll: (self jsonQuote: (m at: 1) asString).
		ws nextPutAll: ',"kind":'; nextPutAll: (self jsonQuote: (m at: 2) asString).
		ws nextPutAll: ',"defaultChecked":'; nextPutAll: (self defaultChecksMember: (m at: 2)) printString.
		ws nextPutAll: ',"reason":'; nextPutAll: ((m at: 3) ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]).
		ws nextPut: $}].
	ws nextPutAll: '],"instVars":['.
	first := true.
	self candidateInstVars do: [:v |
		first ifFalse: [ws nextPut: $,]. first := false.
		ws nextPutAll: '{"name":'; nextPutAll: (self jsonQuote: (v at: 1) asString).
		ws nextPutAll: ',"kind":'; nextPutAll: (self jsonQuote: (v at: 2) asString).
		ws nextPutAll: ',"defaultChecked":'; nextPutAll: (self defaultChecksMember: (v at: 2)) printString.
		ws nextPut: $}].
	ws nextPutAll: ']}'.
	^ws contents
]

{ #category : 'serializing' }
GsExtractSuperclassRefactoring >> previewJsonString [
	^self changeSet jsonString
]

{ #category : 'serializing' }
GsExtractSuperclassRefactoring >> outOfScopeJsonString [
	"The precondition / warning payload for the preview panel, in the family's shape."
	^'{"references":0,"skipped":0,"scope":"hierarchy","collision":null,"decline":',
	  (decline ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  ',"note":', (self jsonQuote: 'Existing instances keep their prior class version and are not migrated.'), '}'
]

{ #category : 'paginated preview' }
GsExtractSuperclassRefactoring >> startPreviewToken: token maxBytes: maxBytes [
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"newClass":', (self jsonQuote: newName),
	  ',"sharedParent":', (decline notNil ifTrue: ['null'] ifFalse: [self jsonQuote: sharedParent name asString]),
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'paginated preview' }
GsExtractSuperclassRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
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
GsExtractSuperclassRefactoring >> applyDeselected: deselectedIds [
	"Apply EVERY staged change in the stone. Extract-superclass is ALL-OR-NOTHING (the class
	 creation, the reparents and the hoists must move together), so a deselection is ignored.
	 NOTHING is committed. If the loop passes a failed change, the changes that DID apply remain
	 in the uncommitted transaction; the caller must ABORT to discard them. Answers
	 {applied, failed:[..], committed}."
	| applied failures |
	self ensureAnalysis.
	"Defence in depth: the client gates on the analysis before ever applying, but a declined ref
	 must not answer a success-shaped envelope. Surface the reason via error (nothing applied)."
	decline notNil ifTrue: [
		^'{"applied":0,"committed":false,"failed":[],"error":', (self jsonQuote: decline), '}'].
	oldToNew := IdentityDictionary new.
	newClass := nil.
	failures := OrderedCollection new.
	applied := 0.
	self changeSet changes do: [:change |
		[self applyChange: change. applied := applied + 1]
		on: Error do: [:e |
			failures add: (Array with: change id with: change className with: e messageText)]].
	^'{"applied":', applied printString,
	  ',"committed":false',
	  ',"failed":[',
	  ((failures collect: [:f |
		'{"id":', (self jsonQuote: (f at: 1)),
		',"label":', (self jsonQuote: (f at: 2)),
		',"error":', (self jsonQuote: (f at: 3)), '}'])
			inject: '' into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ',', s]]),
	  ']}'
]

{ #category : 'applying' }
GsExtractSuperclassRefactoring >> applyChange: aChange [
	aChange kind == #classAdd ifTrue: [^self applyClassAdd: aChange].
	(aChange kind == #classDefinitionEdit or: [aChange kind == #classReparent])
		ifTrue: [^self applyClassChange: aChange].
	aChange kind == #methodAdd ifTrue: [^self applyMethodAdd: aChange].
	aChange kind == #methodRemove ifTrue: [^self applyMethodRemove: aChange].
	^self error: 'Unexpected change kind for extract-superclass: ', aChange kind printString
]

{ #category : 'applying' }
GsExtractSuperclassRefactoring >> applyClassAdd: aChange [
	"Create the new superclass fresh under the shared parent, with the hoisted ivars as its own
	 list. A brand-new class (no inClassHistory:), so a plain subclass: creation."
	newClass := sharedParent
		subclass: newName
		instVarNames: (hoistInstVars collect: [:e | e asString])
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: (self dictObjectForNewClass).
	oldToNew at: newClass put: newClass
]

{ #category : 'applying' }
GsExtractSuperclassRefactoring >> applyClassChange: aChange [
	"Create a new version of the named class under its new parent -- the new superclass for an
	 extracted class, its own freshly-versioned ancestor for a descendant -- with the computed
	 own-instVar list, copy its methods forward (skipping the hoisted selectors for an extracted
	 class), and record the old->new mapping."
	| old isExtracted parentNew list new skip |
	old := environment classNamed: aChange className.
	old isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	isExtracted := aChange kind == #classDefinitionEdit.
	parentNew := isExtracted
		ifTrue: [newClass]
		ifFalse: [oldToNew at: old superclass ifAbsent: [old superclass]].
	list := isExtracted
		ifTrue: [(environment ownInstVarNamesOf: old) reject: [:n | hoistInstVars includes: n]]
		ifFalse: [environment ownInstVarNamesOf: old].
	skip := isExtracted ifTrue: [hoistMethods] ifFalse: [#()].
	new := self makeNewVersionOf: old superclass: parentNew instVarNames: list.
	self copyMethodsFrom: old to: new skipping: skip.
	oldToNew at: old put: new
]

{ #category : 'applying' }
GsExtractSuperclassRefactoring >> makeNewVersionOf: old superclass: sup instVarNames: ivars [
	"A new version in old's class history, under sup, with own-instVar list ivars and all of
	 old's other shape. Same format-preserving primitive GsInstVarStructureRefactoring uses."
	^sup
		_subclass: old name asString
		instVarNames: (ivars collect: [:e | e asString])
		format: old format
		classVars: (old classVarNames collect: [:e | e asString])
		classInstVars: (old class instVarNames collect: [:e | e asString])
		poolDictionaries: old sharedPools
		inDictionary: (self dictObjectFor: old)
		inClassHistory: old classHistory
		description: ([old commentForFileout] on: Error do: [:e | ''])
		options: #()
]

{ #category : 'applying' }
GsExtractSuperclassRefactoring >> copyMethodsFrom: old to: new skipping: skipSelectors [
	"Copy every method of old (both sides) onto new, EXCEPT the skipSelectors (instance-side
	 hoisted methods that move to the new superclass instead)."
	old selectors do: [:sel |
		(skipSelectors includes: sel) ifFalse: [self copyMethod: sel from: old to: new]].
	old class selectors do: [:sel | self copyMethod: sel from: old class to: new class]
]

{ #category : 'applying' }
GsExtractSuperclassRefactoring >> copyMethod: sel from: srcCls to: dstCls [
	| m cat |
	m := srcCls compiledMethodAt: sel environmentId: 0 otherwise: nil.
	m isNil ifTrue: [^self].
	cat := (srcCls categoryOfSelector: sel environmentId: 0) ifNil: ['as yet unclassified'].
	dstCls
		compileMethod: m sourceString
		dictionaries: System myUserProfile symbolList
		category: cat asString
]

{ #category : 'applying' }
GsExtractSuperclassRefactoring >> applyMethodAdd: aChange [
	"Compile a hoisted method onto the new superclass."
	| target |
	target := aChange className = newName
		ifTrue: [newClass]
		ifFalse: [environment classNamed: aChange className].
	target isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target
		compileMethod: aChange newSource
		dictionaries: System myUserProfile symbolList
		category: (aChange category ifNil: ['as yet unclassified'])
]

{ #category : 'applying' }
GsExtractSuperclassRefactoring >> applyMethodRemove: aChange [
	"A hoisted method's removal from an extracted class. copyMethodsFrom:to:skipping: already
	 left it off the new version, so this is a guarded no-op that keeps re-application idempotent."
	| cls sel |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self].
	sel := aChange selector asSymbol.
	(cls includesSelector: sel) ifTrue: [cls removeSelector: sel]
]

{ #category : 'applying' }
GsExtractSuperclassRefactoring >> dictObjectFor: aClass [
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty
		ifTrue: [environment symbolList objectNamed: #UserGlobals]
		ifFalse: [dicts first]
]

{ #category : 'applying' }
GsExtractSuperclassRefactoring >> dictObjectForNewClass [
	"The SymbolDictionary the new class is filed in: the caller's choice by name, else the
	 anchor's own dictionary."
	dictNameOrNil ifNotNil: [:dn |
		^(environment symbolList objectNamed: dn asSymbol)
			ifNil: [self dictObjectFor: anchorClass]].
	^self dictObjectFor: anchorClass
]

{ #category : 'serializing' }
GsExtractSuperclassRefactoring >> jsonQuote: aString [
	^GsRefactoringJson jsonQuote: aString
]

{ #category : 'serializing' }
GsExtractSuperclassRefactoring >> jsonEscape: aString [
	^GsRefactoringJson jsonEscape: aString
]

{ #category : 'serializing' }
GsExtractSuperclassRefactoring >> hex2: anInteger [
	^GsRefactoringJson hex2: anInteger
]
