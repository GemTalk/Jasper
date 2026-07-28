"
Instance-variable STRUCTURE changes across a class hierarchy (V2 / V3 / V5), without
committing. One engine parametrized by an operation, because all three share the same hard
part: changing a class's instance-variable list means creating a NEW class VERSION (GemStone
has no addInstVarName:/removeInstVarName:), which -- like a class rename (R3) -- starts with an
empty method dictionary and does NOT re-parent existing subclasses. So the apply must, for
every affected class top-down, create a new version in the same class history with the edited
own-instVar list, COPY its methods forward, and re-parent it under the freshly created parent
version. This reuses R3's newVersionOf: machinery verbatim, generalised from ''rename the name''
to ''edit the own-instVar list''.

Three operations:

  - V5 convertTemporary -- promote a method TEMPORARY to an instance variable: add the ivar
    to the class and drop the temporary's declaration from the method (its references then
    resolve to the new ivar). One edited class + one method recompile.

  - V2 pushUp -- move an instance-variable DECLARATION from a subclass up to its immediate
    superclass. The superclass gains the ivar (edited); the subclass loses it (edited).

  - V3 pushDown -- move an instance variable from a class down into EVERY immediate subclass.
    The class loses it (edited); each immediate subclass gains it (edited).

Affected set = the highest edited class + all its descendants, top-down. Each affected class
gets a new version: an edited class with its computed own-instVar list (a #classDefinitionEdit,
shown as a definition diff), an unedited descendant with its unchanged list (a #classReparent,
recompiled only to re-point at the new parent chain). V5 also stages one #methodRecompile.

IMPORTANT semantics (documented, surfaced in the preview):
  - Existing INSTANCES are NOT migrated: they remain on the prior class version with their data
    intact (standard GemStone class evolution). Migrating them is a separate, committing step
    the family does not perform. So the moved ivar's value is not carried onto live instances.
  - V2/V3 do not preserve the moved ivar's per-instance value (the remove+add resets the slot);
    this is a structural refactoring, matching the classic Refactoring Browser.

The refactoring is all-or-nothing (like rename-class-variable): the class-shape changes and the
descendant reparents must all apply together or the hierarchy is left inconsistent, so the
client does not offer per-change deselection and applyDeselected: ignores any deselection.
Building the change set compiles nothing and commits nothing; the apply compiles in the stone
but NEVER commits (the user commits explicitly).
"
Class {
	#name : 'GsInstVarStructureRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'operation',
		'definingClass',
		'varName',
		'methodSelector',
		'methodMeta',
		'topClass',
		'newIvarLists',
		'methodRewrite',
		'changeSet',
		'analysisDone',
		'decline',
		'oldToNew'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsInstVarStructureRefactoring class >> class: aClass convertTemporary: aName inMethod: aSelector meta: aBool [
	"V5: promote the method temporary aName (in aClass>>aSelector, the aBool side) to an
	 instance variable of aClass."
	^self new
		setEnvironment: GsRefactoringEnvironment new
		operation: #convertTemp
		class: aClass
		varName: aName
		selector: aSelector
		meta: aBool
]

{ #category : 'instance creation' }
GsInstVarStructureRefactoring class >> class: aClass pushUpInstVar: aName [
	"V2: move aClass's own instance variable aName up to its immediate superclass."
	^self new
		setEnvironment: GsRefactoringEnvironment new
		operation: #pushUp
		class: aClass
		varName: aName
		selector: nil
		meta: false
]

{ #category : 'instance creation' }
GsInstVarStructureRefactoring class >> class: aClass pushDownInstVar: aName [
	"V3: move aClass's own instance variable aName down into every immediate subclass."
	^self new
		setEnvironment: GsRefactoringEnvironment new
		operation: #pushDown
		class: aClass
		varName: aName
		selector: nil
		meta: false
]

{ #category : 'instance creation' }
GsInstVarStructureRefactoring class >> environment: anEnvironment operation: anOp class: aClass varName: aName selector: aSelector meta: aBool [
	^self new
		setEnvironment: anEnvironment
		operation: anOp
		class: aClass
		varName: aName
		selector: aSelector
		meta: aBool
]

{ #category : 'preconditions' }
GsInstVarStructureRefactoring class >> analyzeClass: aClass convertTemporary: aName inMethod: aSelector meta: aBool [
	^(self class: aClass convertTemporary: aName inMethod: aSelector meta: aBool) analysisJsonString
]

{ #category : 'preconditions' }
GsInstVarStructureRefactoring class >> analyzeClass: aClass pushUpInstVar: aName [
	^(self class: aClass pushUpInstVar: aName) analysisJsonString
]

{ #category : 'preconditions' }
GsInstVarStructureRefactoring class >> analyzeClass: aClass pushDownInstVar: aName [
	^(self class: aClass pushDownInstVar: aName) analysisJsonString
]

{ #category : 'paginated preview' }
GsInstVarStructureRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'paginated preview' }
GsInstVarStructureRefactoring class >> applyForToken: token deselected: deselectedIds [
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'paginated preview' }
GsInstVarStructureRefactoring class >> clearToken: token [
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'private' }
GsInstVarStructureRefactoring >> setEnvironment: anEnvironment operation: anOp class: aClass varName: aName selector: aSelector meta: aBool [
	environment := anEnvironment.
	operation := anOp.
	definingClass := aClass.
	varName := aName asString.
	methodSelector := aSelector isNil ifTrue: [nil] ifFalse: [aSelector asSymbol].
	methodMeta := aBool.
	analysisDone := false
]

{ #category : 'accessing' }
GsInstVarStructureRefactoring >> environment [
	^environment
]

{ #category : 'accessing' }
GsInstVarStructureRefactoring >> operation [
	^operation
]

{ #category : 'accessing' }
GsInstVarStructureRefactoring >> topClass [
	self ensureAnalysis.
	^topClass
]

{ #category : 'private' }
GsInstVarStructureRefactoring >> ownInstVarsOf: aClass [
	"aClass's OWN instance-variable names (not inherited), as an Array of Strings."
	^aClass instVarNames collect: [:e | e asString]
]

{ #category : 'private' }
GsInstVarStructureRefactoring >> allInstVarsOf: aClass [
	^aClass allInstVarNames collect: [:e | e asString]
]

{ #category : 'private - analysis' }
GsInstVarStructureRefactoring >> ensureAnalysis [
	analysisDone ifFalse: [
		analysisDone := true.
		[self computeAnalysis] on: Error do: [:e |
			decline := 'The change could not be analysed: ', e messageText]]
]

{ #category : 'private - analysis' }
GsInstVarStructureRefactoring >> computeAnalysis [
	"Set decline (nil when viable), topClass, newIvarLists (class name -> new own-ivar
	 Array), and, for V5, methodRewrite. Dispatches on the operation."
	decline := nil.
	newIvarLists := Dictionary new.
	operation == #convertTemp ifTrue: [^self analyzeConvertTemp].
	operation == #pushUp ifTrue: [^self analyzePushUp].
	operation == #pushDown ifTrue: [^self analyzePushDown].
	decline := 'Unknown operation: ', operation printString
]

{ #category : 'private - analysis' }
GsInstVarStructureRefactoring >> analyzeConvertTemp [
	"V5: the method must declare varName as a method-level temporary, and varName must not
	 already be an instance variable of the class."
	| behavior method src tree names remaining newDecl newSrc |
	topClass := definingClass.
	((self allInstVarsOf: definingClass) includes: varName) ifTrue: [
		^decline := 'Cannot convert #', varName, ': it is already an instance variable of ', definingClass name asString, '.'].
	behavior := methodMeta ifTrue: [definingClass class] ifFalse: [definingClass].
	method := behavior compiledMethodAt: methodSelector environmentId: 0 otherwise: nil.
	method isNil ifTrue: [
		^decline := 'Cannot convert #', varName, ': the method #', methodSelector asString, ' was not found.'].
	src := method sourceString.
	tree := [RBParser parseMethod: src] on: Error do: [:e | nil].
	tree isNil ifTrue: [
		^decline := 'Cannot convert #', varName, ': the method source does not parse.'].
	names := tree body temporaries collect: [:t | t name asString].
	(names includes: varName) ifFalse: [
		^decline := 'Cannot convert #', varName, ': it is not a method-level temporary of #', methodSelector asString, '.'].
	remaining := names reject: [:n | n = varName].
	newDecl := remaining isEmpty
		ifTrue: ['']
		ifFalse: ['| ', (self spaceList: remaining), ' |'].
	newSrc := (src copyFrom: 1 to: tree body leftBar - 1),
		newDecl,
		(src copyFrom: tree body rightBar + 1 to: src size).
	methodRewrite := Array with: definingClass name asString with: methodSelector with: methodMeta with: src with: newSrc.
	newIvarLists at: definingClass name asString put: ((self ownInstVarsOf: definingClass) copyWith: varName)
]

{ #category : 'private - analysis' }
GsInstVarStructureRefactoring >> analyzePushUp [
	"V2: varName must be an OWN ivar of definingClass; its immediate superclass (and its
	 ancestors) must not already define it; and no OTHER descendant of that superclass may
	 own a same-named ivar (it would collide with the newly inherited one)."
	| sup |
	((self ownInstVarsOf: definingClass) includes: varName) ifFalse: [
		^decline := 'Cannot push up ', varName, ': it is not an instance variable declared in ', definingClass name asString, '.'].
	sup := definingClass superclass.
	sup isNil ifTrue: [
		^decline := 'Cannot push up ', varName, ': ', definingClass name asString, ' has no superclass.'].
	((self allInstVarsOf: sup) includes: varName) ifTrue: [
		^decline := 'Cannot push up ', varName, ': ', sup name asString, ' already defines an instance variable of that name.'].
	(self otherDescendant: definingClass ofTop: sup ownsIvar: varName) ifNotNil: [:cls |
		^decline := 'Cannot push up ', varName, ': ', cls, ' also declares an instance variable of that name, which would collide once it is inherited.'].
	topClass := sup.
	newIvarLists at: definingClass name asString put: ((self ownInstVarsOf: definingClass) reject: [:n | n = varName]).
	newIvarLists at: sup name asString put: ((self ownInstVarsOf: sup) copyWith: varName)
]

{ #category : 'private - analysis' }
GsInstVarStructureRefactoring >> analyzePushDown [
	"V3: varName must be an OWN ivar of definingClass; the class's own methods must not
	 access it (removing it would leave them undeclared); it must have subclasses; and no
	 proper descendant may already own a same-named ivar (it would collide once inherited)."
	| subs users |
	((self ownInstVarsOf: definingClass) includes: varName) ifFalse: [
		^decline := 'Cannot push down ', varName, ': it is not an instance variable declared in ', definingClass name asString, '.'].
	subs := (definingClass subclasses ifNil: [#()]) asArray.
	subs isEmpty ifTrue: [
		^decline := 'Cannot push down ', varName, ': ', definingClass name asString, ' has no subclasses.'].
	users := environment instanceMethodsAccessing: varName inClass: definingClass.
	users isEmpty ifFalse: [
		^decline := 'Cannot push down ', varName, ': ', definingClass name asString, ' still uses it in ', users size printString, ' of its own method(s).'].
	(self anyDescendantOf: definingClass ownsIvar: varName) ifNotNil: [:cls |
		^decline := 'Cannot push down ', varName, ': ', cls, ' already declares an instance variable of that name.'].
	topClass := definingClass.
	newIvarLists at: definingClass name asString put: ((self ownInstVarsOf: definingClass) reject: [:n | n = varName]).
	subs do: [:sub |
		newIvarLists at: sub name asString put: ((self ownInstVarsOf: sub) copyWith: varName)]
]

{ #category : 'private - analysis' }
GsInstVarStructureRefactoring >> otherDescendant: aSkip ofTop: aTop ownsIvar: aName [
	"The name of a descendant of aTop (other than aSkip) that owns an ivar named aName, or
	 nil."
	(environment descendantsOf: aTop) do: [:cls |
		(cls ~~ aSkip and: [(self ownInstVarsOf: cls) includes: aName])
			ifTrue: [^cls name asString]].
	^nil
]

{ #category : 'private - analysis' }
GsInstVarStructureRefactoring >> anyDescendantOf: aTop ownsIvar: aName [
	"The name of any descendant of aTop that owns an ivar named aName, or nil."
	(environment descendantsOf: aTop) do: [:cls |
		((self ownInstVarsOf: cls) includes: aName) ifTrue: [^cls name asString]].
	^nil
]

{ #category : 'private' }
GsInstVarStructureRefactoring >> spaceList: aCollection [
	^aCollection inject: '' into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ' ', s]]
]

{ #category : 'private' }
GsInstVarStructureRefactoring >> isEditedClassNamed: aName [
	^newIvarLists includesKey: aName
]

{ #category : 'private' }
GsInstVarStructureRefactoring >> dictNameForClass: aClass [
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
]

{ #category : 'preconditions' }
GsInstVarStructureRefactoring >> decline [
	self ensureAnalysis.
	^decline
]

{ #category : 'building' }
GsInstVarStructureRefactoring >> changeSet [
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'building' }
GsInstVarStructureRefactoring >> buildChangeSet [
	"Stage, top-down, a #classDefinitionEdit for each edited class and a #classReparent for
	 every other descendant of the top class (recompiled only to re-point at the new parent
	 chain), then -- for V5 -- one #methodRecompile. Compiles nothing, commits nothing."
	| cs affected |
	cs := GsRefactoringChangeSet new.
	self ensureAnalysis.
	decline notNil ifTrue: [^cs].
	affected := OrderedCollection new.
	affected add: topClass.
	affected addAll: (environment descendantsOf: topClass).
	affected do: [:cls | self stageClassChange: cls into: cs].
	methodRewrite ifNotNil: [self stageMethodRewriteInto: cs].
	^cs
]

{ #category : 'building' }
GsInstVarStructureRefactoring >> stageClassChange: aClass into: cs [
	| dn oldDef |
	dn := self dictNameForClass: aClass.
	oldDef := aClass definition.
	(self isEditedClassNamed: aClass name asString)
		ifTrue: [cs
			addClassDefinitionEditInDictionary: dn
			className: aClass name asString
			oldSource: oldDef
			newSource: (self definitionWithIvars: (newIvarLists at: aClass name asString) in: oldDef)]
		ifFalse: [cs
			addClassReparentInDictionary: dn
			className: aClass name asString
			oldSource: oldDef
			newSource: oldDef]
]

{ #category : 'building' }
GsInstVarStructureRefactoring >> stageMethodRewriteInto: cs [
	"V5: recompile the source method with the converted temporary's declaration removed."
	| cat behavior |
	behavior := methodMeta ifTrue: [definingClass class] ifFalse: [definingClass].
	cat := (behavior categoryOfSelector: methodSelector environmentId: 0) ifNil: ['as yet unclassified'].
	cs
		addMethodRecompileInDictionary: (self dictNameForClass: definingClass)
		className: (methodRewrite at: 1)
		isMeta: (methodRewrite at: 3)
		selector: (methodRewrite at: 2)
		category: cat asString
		oldSource: (methodRewrite at: 4)
		newSource: (methodRewrite at: 5)
]

{ #category : 'source rewriting' }
GsInstVarStructureRefactoring >> definitionWithIvars: anIvarList in: defString [
	"defString with the instVarNames: clause's parenthesised list replaced by anIvarList
	 (quoted). For the before/after diff only -- the apply computes the list directly."
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

{ #category : 'serializing' }
GsInstVarStructureRefactoring >> analysisJsonString [
	"The pre-flight payload: the decline reason (nil when viable), the top edited class, and
	 the number of classes that will be recompiled."
	self ensureAnalysis.
	^'{"decline":', (decline ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  ',"topClass":', (decline notNil ifTrue: ['null'] ifFalse: [self jsonQuote: topClass name asString]),
	  ',"affectedCount":', (decline notNil ifTrue: ['0'] ifFalse: [self changeSet size printString]),
	  '}'
]

{ #category : 'serializing' }
GsInstVarStructureRefactoring >> previewJsonString [
	^self changeSet jsonString
]

{ #category : 'serializing' }
GsInstVarStructureRefactoring >> outOfScopeJsonString [
	"The precondition / warning payload for the preview panel, in the family's shape. A hard
	 decline (which blocks Apply) rides in `decline`; a note explains the reparent + no-migrate
	 semantics."
	^'{"references":0,"skipped":0,"scope":"hierarchy","collision":null,"decline":',
	  (decline ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  ',"note":', (self jsonQuote: 'Existing instances keep their prior version and are not migrated.'), '}'
]

{ #category : 'serializing' }
GsInstVarStructureRefactoring >> startPreviewToken: token maxBytes: maxBytes [
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"topClass":', (decline notNil ifTrue: ['null'] ifFalse: [self jsonQuote: topClass name asString]),
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'paginated preview' }
GsInstVarStructureRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
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
GsInstVarStructureRefactoring >> applyDeselected: deselectedIds [
	"Apply EVERY staged change in the stone WITHOUT committing. An instance-variable
	 structure change is ALL-OR-NOTHING (the class-shape edits and the descendant reparents
	 must move together), so a deselection is ignored. Answers {applied, failed:[..]}."
	| applied failures |
	self ensureAnalysis.
	oldToNew := IdentityDictionary new.
	failures := OrderedCollection new.
	applied := 0.
	self changeSet changes do: [:change |
		[self applyChange: change. applied := applied + 1]
		on: Error do: [:e |
			failures add: (Array with: change id with: change className with: e messageText)]].
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
GsInstVarStructureRefactoring >> applyChange: aChange [
	(aChange kind == #classDefinitionEdit or: [aChange kind == #classReparent])
		ifTrue: [^self applyClassChange: aChange].
	aChange kind == #methodRecompile ifTrue: [^self applyMethodRecompile: aChange].
	^self error: 'Unexpected change kind for instVar-structure: ', aChange kind printString
]

{ #category : 'applying' }
GsInstVarStructureRefactoring >> applyClassChange: aChange [
	"Create a new version of the named class -- under the freshly created parent version,
	 with its computed own-instVar list -- copy its methods forward, and record the
	 old->new mapping so its own descendants re-parent onto it. No commit."
	| old parentNew list new |
	old := environment classNamed: aChange className.
	old isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	parentNew := oldToNew at: old superclass ifAbsent: [old superclass].
	list := newIvarLists at: aChange className ifAbsent: [self ownInstVarsOf: old].
	new := self makeNewVersionOf: old superclass: parentNew instVarNames: list.
	self copyMethodsFrom: old to: new.
	oldToNew at: old put: new
]

{ #category : 'applying' }
GsInstVarStructureRefactoring >> makeNewVersionOf: old superclass: sup instVarNames: ivars [
	"Create a new version in old's class history, under sup, with own-instVar list ivars and
	 all of old's other shape (format, class vars, class-instance vars, pools, comment). Uses
	 the FORMAT-taking primitive so byte/pointer/NSC/invariant bits survive, and threads
	 inClassHistory: so class-var VALUES and the category carry forward. Same primitive R3
	 uses for a rename/reparent."
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
GsInstVarStructureRefactoring >> copyMethodsFrom: old to: new [
	"Copy every method of old (both sides) verbatim onto new -- a new class version starts
	 with an empty method dictionary, so this carries the behaviour forward. The V5 method
	 rewrite is applied afterwards, as its own #methodRecompile, so it overwrites the verbatim
	 copy."
	old selectors do: [:sel | self copyMethod: sel from: old to: new].
	old class selectors do: [:sel | self copyMethod: sel from: old class to: new class]
]

{ #category : 'applying' }
GsInstVarStructureRefactoring >> copyMethod: sel from: srcCls to: dstCls [
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
GsInstVarStructureRefactoring >> applyMethodRecompile: aChange [
	"Recompile the converted method (V5) with the temporary declaration removed, onto the
	 current (freshly versioned) class."
	| cls target |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	target
		compileMethod: aChange newSource
		dictionaries: System myUserProfile symbolList
		category: (aChange category ifNil: ['as yet unclassified'])
]

{ #category : 'applying' }
GsInstVarStructureRefactoring >> dictObjectFor: aClass [
	"The actual SymbolDictionary object that defines aClass's name, for inDictionary:."
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty
		ifTrue: [environment symbolList objectNamed: #UserGlobals]
		ifFalse: [dicts first]
]

{ #category : 'serializing' }
GsInstVarStructureRefactoring >> jsonQuote: aString [
	^'"', (self jsonEscape: aString), '"'
]

{ #category : 'serializing' }
GsInstVarStructureRefactoring >> jsonEscape: aString [
	"JSON string escaping emitting PURE ASCII (control chars and code points above 126 become
	 \\uXXXX), so the client's non-blocking GCI fetch is never handed a Unicode result."
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
GsInstVarStructureRefactoring >> hex2: anInteger [
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
]
