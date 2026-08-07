"
Split Class (V8): extract a cohesive subset of a class's own instance variables -- and every
method that uses them -- out into a brand-new collaborator class, leaving the source class holding
a reference to an instance of it (a has-a relationship). Classic Fowler Extract Class, without
committing.

Given a source class S and a chosen extract set E of its OWN instance variables, the MOVABLE
methods are S's instance methods that reference an E ivar. Apply creates a new class N (an Object
subclass) carrying E and the movable methods; reversions S to drop E, add an ivar `n` (the
decapitalised new class name) and a lazy accessor `n ^n ifNil: [n := N new]`, and -- keeping S's
external API unchanged -- a delegating stub `foo ^self n foo` for every moved method; and re-parents
S's descendant subtree onto the freshly-versioned S (the same reversion-by-newVersionOf: machinery
GsExtractSuperclassRefactoring / GsInstVarStructureRefactoring use, plus the #classAdd change kind
for the new class). No NEW change kind is invented.

CLEAN-CUT preconditions (global declines that empty the change set, surfaced in the preview banner),
so the MVP only splits a self-contained subset -- the delegation then makes it behavior-preserving:
a movable method also touches a retained ivar, or sends super, or self-sends a method that stays
behind; a descendant references an extracted ivar; the derived component ivar name already exists on
S; newName is not a valid class name or already exists; the extract set is empty or names a
non-own ivar. (A retained method can never touch E -- touching E makes it movable by definition --
and a retained method that CALLS a moved one is fine, because every moved method is delegated.)

Apply is ALL-OR-NOTHING; applyDeselected: ignores deselection. Existing INSTANCES are not migrated
(they keep their prior version). Building compiles nothing and commits nothing; apply compiles in
the stone but NEVER commits.
"
Class {
	#name : 'GsSplitClassRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'sourceClass',
		'newName',
		'dictNameOrNil',
		'extractIvars',
		'componentIvarName',
		'movableSelectors',
		'changeSet',
		'analysisDone',
		'decline',
		'newClass',
		'oldToNew'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsSplitClassRefactoring class >> class: aSource splitIntoClassNamed: aName extractingInstVars: ivars inDictionary: aDictOrNil [
	"Split aSource: extract the own instance variables ivars (and the methods that use them) into a
	 new class aName (an Object subclass), filed in aDictOrNil (nil = the source's dictionary)."
	^self new
		setEnvironment: GsRefactoringEnvironment new
		class: aSource
		name: aName
		dict: aDictOrNil
		extractIvars: ivars
]

{ #category : 'preconditions' }
GsSplitClassRefactoring class >> analyzeClass: aSource splitIntoClassNamed: aName extractingInstVars: ivars [
	^(self class: aSource splitIntoClassNamed: aName extractingInstVars: ivars inDictionary: nil) analysisJsonString
]

{ #category : 'preconditions' }
GsSplitClassRefactoring class >> candidatesForClass: aSource [
	"The source's own instance variables the preview checklist renders as extract candidates."
	^(self class: aSource splitIntoClassNamed: 'GsSplitClassProbe' extractingInstVars: #() inDictionary: nil) candidatesJsonString
]

{ #category : 'paginated preview' }
GsSplitClassRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'paginated preview' }
GsSplitClassRefactoring class >> applyForToken: token deselected: deselectedIds [
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"committed":false,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'paginated preview' }
GsSplitClassRefactoring class >> clearToken: token [
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'private' }
GsSplitClassRefactoring >> setEnvironment: anEnvironment class: aSource name: aName dict: aDictOrNil extractIvars: ivars [
	environment := anEnvironment.
	sourceClass := aSource.
	newName := aName asString.
	dictNameOrNil := aDictOrNil isNil ifTrue: [nil] ifFalse: [aDictOrNil asString].
	extractIvars := (ivars ifNil: [#()]) collect: [:e | e asString].
	analysisDone := false
]

{ #category : 'accessing' }
GsSplitClassRefactoring >> environment [
	^environment
]

{ #category : 'accessing' }
GsSplitClassRefactoring >> movableSelectors [
	self ensureAnalysis.
	^movableSelectors
]

{ #category : 'private' }
GsSplitClassRefactoring >> ownInstVarsOf: aClass [
	^aClass instVarNames collect: [:e | e asString]
]

{ #category : 'private' }
GsSplitClassRefactoring >> allInstVarsOf: aClass [
	^aClass allInstVarNames collect: [:e | e asString]
]

{ #category : 'private' }
GsSplitClassRefactoring >> sourceOf: aSelector in: aClass [
	| m |
	m := aClass compiledMethodAt: aSelector environmentId: 0 otherwise: nil.
	^m isNil ifTrue: [nil] ifFalse: [m sourceString]
]

{ #category : 'private' }
GsSplitClassRefactoring >> categoryOf: aSelector in: aClass [
	^((aClass categoryOfSelector: aSelector environmentId: 0) ifNil: ['as yet unclassified']) asString
]

{ #category : 'private' }
GsSplitClassRefactoring >> ivarsAccessedBy: aSelector in: aClass [
	^[(aClass compiledMethodAt: aSelector environmentId: 0 otherwise: nil) instVarsAccessed] on: Error do: [:e | #()]
]

{ #category : 'private' }
GsSplitClassRefactoring >> extractSymbolSet [
	| s |
	s := Set new.
	extractIvars do: [:e | s add: e asSymbol].
	^s
]

{ #category : 'private' }
GsSplitClassRefactoring >> nl [
	^String with: (Character codePoint: 10)
]

{ #category : 'private' }
GsSplitClassRefactoring >> tab [
	^String with: (Character codePoint: 9)
]

{ #category : 'private' }
GsSplitClassRefactoring >> commaList: aCollection [
	^aCollection inject: '' into: [:acc :s | acc isEmpty ifTrue: [s asString] ifFalse: [acc, ', ', s asString]]
]

{ #category : 'private' }
GsSplitClassRefactoring >> decapitalize: aString [
	aString isEmpty ifTrue: [^aString].
	^(aString copyFrom: 1 to: 1) asLowercase, (aString copyFrom: 2 to: aString size)
]

{ #category : 'private' }
GsSplitClassRefactoring >> isValidClassName: aString [
	| c |
	aString isEmpty ifTrue: [^false].
	c := aString at: 1.
	(c isLetter and: [c isUppercase]) ifFalse: [^false].
	2 to: aString size do: [:i | | ch |
		ch := aString at: i.
		(ch isLetter or: [ch isDigit or: [ch == $_]]) ifFalse: [^false]].
	^true
]

{ #category : 'private' }
GsSplitClassRefactoring >> methodSource: src referencesName: aName [
	| tree found |
	src isNil ifTrue: [^false].
	tree := [RBParser parseMethod: src] on: Error do: [:e | nil].
	tree isNil ifTrue: [^false].
	found := false.
	tree nodesDo: [:n | (n isVariable and: [n name = aName]) ifTrue: [found := true]].
	^found
]

{ #category : 'private' }
GsSplitClassRefactoring >> selfSentSelectorsIn: src [
	"The selectors sent to self / super in src, as a Set of Symbols."
	| tree sels |
	sels := Set new.
	src isNil ifTrue: [^sels].
	tree := [RBParser parseMethod: src] on: Error do: [:e | nil].
	tree isNil ifTrue: [^sels].
	tree nodesDo: [:n |
		(n isMessage and: [n receiver isVariable and: [(n receiver name = 'self') or: [n receiver name = 'super']]])
			ifTrue: [sels add: n selector asSymbol]].
	^sels
]

{ #category : 'private' }
GsSplitClassRefactoring >> argNamesFor: aSelector in: aClass [
	| src tree |
	src := self sourceOf: aSelector in: aClass.
	src isNil ifTrue: [^#()].
	tree := [RBParser parseMethod: src] on: Error do: [:e | nil].
	tree isNil ifTrue: [^#()].
	^tree arguments collect: [:a | a name]
]

{ #category : 'private' }
GsSplitClassRefactoring >> selectorText: aSelector args: argNames [
	"The selector + args woven back into source text: a message-pattern that is ALSO the send after
	 `^self <comp> `. Unary `foo`, binary `+ x`, keyword `at: k put: v`."
	| parts ws |
	(aSelector asString includes: $:) ifFalse: [
		^argNames isEmpty
			ifTrue: [aSelector asString]
			ifFalse: [aSelector asString, ' ', (argNames at: 1) asString]].
	parts := aSelector asString subStrings: ':'.
	ws := WriteStream on: String new.
	1 to: argNames size do: [:i |
		i > 1 ifTrue: [ws nextPut: $ ].
		ws nextPutAll: (parts at: i); nextPutAll: ': '; nextPutAll: (argNames at: i) asString].
	^ws contents
]

{ #category : 'private - analysis' }
GsSplitClassRefactoring >> ensureAnalysis [
	analysisDone ifFalse: [
		analysisDone := true.
		movableSelectors := OrderedCollection new.
		[self computeAnalysis] on: Error do: [:e |
			decline := 'The split could not be analysed: ', e messageText]]
]

{ #category : 'private - analysis' }
GsSplitClassRefactoring >> computeAnalysis [
	"Validate the name + extract set, derive the component ivar, compute the movable methods, then
	 run the clean-cut preconditions. Sets decline (nil when viable), componentIvarName and
	 movableSelectors."
	| own extractSyms |
	decline := nil.
	(self isValidClassName: newName) ifFalse: [
		^decline := 'Cannot split: ', newName, ' is not a valid class name.'].
	(environment classNamed: newName) notNil ifTrue: [
		^decline := 'Cannot split: a class named ', newName, ' already exists.'].
	extractIvars isEmpty ifTrue: [
		^decline := 'Cannot split: no instance variables were chosen to extract.'].
	own := self ownInstVarsOf: sourceClass.
	extractIvars do: [:v |
		(own includes: v) ifFalse: [
			^decline := 'Cannot split: ', v, ' is not an instance variable of ', sourceClass name asString, '.']].
	componentIvarName := self decapitalize: newName.
	((self allInstVarsOf: sourceClass) includes: componentIvarName) ifTrue: [
		^decline := 'Cannot split: the source already has an instance variable named ', componentIvarName, '.'].
	extractSyms := self extractSymbolSet.
	movableSelectors := (sourceClass selectors select: [:sel |
		(self ivarsAccessedBy: sel in: sourceClass) anySatisfy: [:v | extractSyms includes: v asSymbol]])
			asSortedCollection: [:a :b | a asString <= b asString].
	movableSelectors do: [:sel | | accessed retained src selfSent |
		accessed := self ivarsAccessedBy: sel in: sourceClass.
		retained := accessed reject: [:v | extractSyms includes: v asSymbol].
		retained notEmpty ifTrue: [
			^decline := 'Cannot split off ', newName, ': #', sel asString, ' also uses instance variable(s) that stay behind (',
				(self commaList: ((retained collect: [:v | v asString]) asSortedCollection: [:a :b | a <= b])), ').'].
		src := self sourceOf: sel in: sourceClass.
		(self methodSource: src referencesName: 'super') ifTrue: [
			^decline := 'Cannot split off ', newName, ': #', sel asString, ' sends super, whose meaning depends on the source class.'].
		selfSent := self selfSentSelectorsIn: src.
		selfSent do: [:s |
			"A self-sent selector is safe to leave behind only if it moves too, OR it is understood
			 by Object AND the source does NOT override it -- else the move would resolve to the
			 component's inherited Object impl and silently lose the source's override."
			((movableSelectors includes: s)
				or: [(sourceClass includesSelector: s) not and: [Object canUnderstand: s]]) ifFalse: [
				^decline := 'Cannot split off ', newName, ': #', sel asString, ' calls #', s asString, ', which stays behind on ', sourceClass name asString, '.']]].
	(environment descendantsOf: sourceClass) do: [:d |
		d selectors do: [:sel |
			((self ivarsAccessedBy: sel in: d) anySatisfy: [:v | extractSyms includes: v asSymbol]) ifTrue: [
				^decline := 'Cannot split off ', newName, ': subclass ', d name asString, ' uses an extracted instance variable in #', sel asString, '.']]]
]

{ #category : 'preconditions' }
GsSplitClassRefactoring >> decline [
	self ensureAnalysis.
	^decline
]

{ #category : 'building' }
GsSplitClassRefactoring >> changeSet [
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'building' }
GsSplitClassRefactoring >> buildChangeSet [
	"Stage: #classAdd N; the movable methods as #methodAdd on N; a #classDefinitionEdit reversioning
	 S (drop E, add the component ivar); a #classReparent per descendant; and the accessor + a
	 delegator per moved method as #methodAdd on S. The reversion's copy-forward already omits the
	 moved methods from the new S version, so no explicit method removal is staged. Compiles nothing,
	 commits nothing."
	| cs dn sn srcDict |
	cs := GsRefactoringChangeSet new.
	self ensureAnalysis.
	decline notNil ifTrue: [^cs].
	dn := self newClassDictName.
	sn := sourceClass name asString.
	srcDict := self dictNameForClass: sourceClass.
	cs
		addClassAddInDictionary: dn
		className: newName
		superclassName: 'Object'
		newSource: self newClassDefinition.
	movableSelectors do: [:sel |
		cs
			addMethodAddInDictionary: dn
			className: newName
			isMeta: false
			selector: sel
			category: (self categoryOf: sel in: sourceClass)
			newSource: (self sourceOf: sel in: sourceClass)].
	cs
		addClassDefinitionEditInDictionary: srcDict
		className: sn
		oldSource: sourceClass definition
		newSource: self sourceDefinitionAfterSplit.
	(environment descendantsOf: sourceClass) do: [:d |
		cs
			addClassReparentInDictionary: (self dictNameForClass: d)
			className: d name asString
			oldSource: d definition
			newSource: d definition].
	cs
		addMethodAddInDictionary: srcDict
		className: sn
		isMeta: false
		selector: componentIvarName asSymbol
		category: 'accessing'
		newSource: self accessorSource.
	movableSelectors do: [:sel |
		cs
			addMethodAddInDictionary: srcDict
			className: sn
			isMeta: false
			selector: sel
			category: 'delegating'
			newSource: (self delegatorSourceFor: sel)].
	^cs
]

{ #category : 'building' }
GsSplitClassRefactoring >> retainedOwnIvars [
	^(self ownInstVarsOf: sourceClass) reject: [:n | extractIvars includes: n]
]

{ #category : 'building' }
GsSplitClassRefactoring >> sourceIvarsAfterSplit [
	"The source's own ivars after the split: the retained ones plus the new component ivar."
	^self retainedOwnIvars, (Array with: componentIvarName)
]

{ #category : 'building' }
GsSplitClassRefactoring >> newClassDefinition [
	^'Object subclass: ''', newName, '''
	instVarNames: #(', (self quotedList: extractIvars), ')
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: ', self newClassDictName
]

{ #category : 'building' }
GsSplitClassRefactoring >> sourceDefinitionAfterSplit [
	"The source's definition with its own-instVar list replaced by the retained ivars + component."
	^self definitionWithIvars: self sourceIvarsAfterSplit in: sourceClass definition
]

{ #category : 'building' }
GsSplitClassRefactoring >> definitionWithIvars: anIvarList in: defString [
	"defString with the instVarNames: clause's parenthesised list replaced by anIvarList (quoted).
	 Display-only (apply computes the list directly). Mirrors GsExtractSuperclassRefactoring."
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
GsSplitClassRefactoring >> quotedList: aCollection [
	| ws q |
	q := String with: $'.
	ws := WriteStream on: String new.
	aCollection keysAndValuesDo: [:i :n |
		i = 1 ifFalse: [ws nextPut: $ ].
		ws nextPutAll: q; nextPutAll: n asString; nextPutAll: q].
	^ws contents
]

{ #category : 'building' }
GsSplitClassRefactoring >> accessorSource [
	"A lazy accessor for the component: `n ^n ifNil: [n := N new]`."
	^componentIvarName, self nl, self tab,
	 '^', componentIvarName, ' ifNil: [', componentIvarName, ' := ', newName, ' new]'
]

{ #category : 'building' }
GsSplitClassRefactoring >> delegatorSourceFor: aSelector [
	"A delegating stub forwarding to the component: `foo: a ^self n foo: a`."
	| text |
	text := self selectorText: aSelector args: (self argNamesFor: aSelector in: sourceClass).
	^text, self nl, self tab, '^self ', componentIvarName, ' ', text
]

{ #category : 'private' }
GsSplitClassRefactoring >> newClassDictName [
	dictNameOrNil ifNotNil: [:dn | ^dn].
	^self dictNameForClass: sourceClass
]

{ #category : 'private' }
GsSplitClassRefactoring >> dictNameForClass: aClass [
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: ['UserGlobals'] ifFalse: [dicts first name asString]
]

{ #category : 'serializing' }
GsSplitClassRefactoring >> analysisJsonString [
	self ensureAnalysis.
	^'{"decline":', (decline ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  ',"newClass":', (self jsonQuote: newName),
	  ',"sourceClass":', (self jsonQuote: sourceClass name asString),
	  ',"movableCount":', (decline notNil ifTrue: ['0'] ifFalse: [movableSelectors size printString]),
	  ',"affectedCount":', (decline notNil ifTrue: ['0'] ifFalse: [self changeSet size printString]),
	  '}'
]

{ #category : 'serializing' }
GsSplitClassRefactoring >> candidatesJsonString [
	"The source's own instance variables, for the extract-set checklist (not gated on a decline --
	 the client picks the set from this list)."
	| ws first |
	ws := WriteStream on: String new.
	ws nextPutAll: '{"sourceClass":'; nextPutAll: (self jsonQuote: sourceClass name asString).
	ws nextPutAll: ',"instVars":['.
	first := true.
	(self ownInstVarsOf: sourceClass) do: [:v |
		first ifFalse: [ws nextPut: $,]. first := false.
		ws nextPutAll: '{"name":'; nextPutAll: (self jsonQuote: v); nextPut: $}].
	ws nextPutAll: ']}'.
	^ws contents
]

{ #category : 'serializing' }
GsSplitClassRefactoring >> previewJsonString [
	^self changeSet jsonString
]

{ #category : 'serializing' }
GsSplitClassRefactoring >> outOfScopeJsonString [
	^'{"references":0,"skipped":0,"scope":"hierarchy","collision":null,"decline":',
	  (decline ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  ',"note":', (self jsonQuote: 'Existing instances keep their prior class version and are not migrated.'), '}'
]

{ #category : 'paginated preview' }
GsSplitClassRefactoring >> startPreviewToken: token maxBytes: maxBytes [
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"newClass":', (self jsonQuote: newName),
	  ',"sourceClass":', (self jsonQuote: sourceClass name asString),
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'paginated preview' }
GsSplitClassRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
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
GsSplitClassRefactoring >> applyDeselected: deselectedIds [
	"Apply EVERY staged change in the stone. Split-class is ALL-OR-NOTHING, so a deselection is
	 ignored. NOTHING is committed; on a failed change the caller must ABORT. Answers
	 {applied, failed:[..], committed:false}."
	| applied failures |
	self ensureAnalysis.
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
GsSplitClassRefactoring >> applyChange: aChange [
	aChange kind == #classAdd ifTrue: [^self applyClassAdd: aChange].
	(aChange kind == #classDefinitionEdit or: [aChange kind == #classReparent])
		ifTrue: [^self applyClassChange: aChange].
	aChange kind == #methodAdd ifTrue: [^self applyMethodAdd: aChange].
	^self error: 'Unexpected change kind for split-class: ', aChange kind printString
]

{ #category : 'applying' }
GsSplitClassRefactoring >> applyClassAdd: aChange [
	"Create the new component class fresh -- an Object subclass carrying the extracted ivars. A
	 brand-new class (no inClassHistory:), so a plain subclass: creation."
	newClass := Object
		subclass: newName
		instVarNames: (extractIvars collect: [:e | e asString])
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: (self dictObjectForNewClass).
	oldToNew at: newClass put: newClass
]

{ #category : 'applying' }
GsSplitClassRefactoring >> applyClassChange: aChange [
	"Reversion the named class: the SOURCE (a #classDefinitionEdit) drops the extracted ivars, adds
	 the component ivar, and drops the moved methods on copy-forward; a DESCENDANT (a #classReparent)
	 just re-points at its freshly-versioned ancestor with its own shape unchanged."
	| old isSource parentNew list skip new |
	old := environment classNamed: aChange className.
	old isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	isSource := aChange kind == #classDefinitionEdit.
	parentNew := isSource
		ifTrue: [old superclass]
		ifFalse: [oldToNew at: old superclass ifAbsent: [old superclass]].
	list := isSource
		ifTrue: [self sourceIvarsAfterSplit]
		ifFalse: [self ownInstVarsOf: old].
	skip := isSource ifTrue: [movableSelectors] ifFalse: [#()].
	new := self makeNewVersionOf: old superclass: parentNew instVarNames: list.
	self copyMethodsFrom: old to: new skipping: skip.
	oldToNew at: old put: new
]

{ #category : 'applying' }
GsSplitClassRefactoring >> makeNewVersionOf: old superclass: sup instVarNames: ivars [
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
GsSplitClassRefactoring >> copyMethodsFrom: old to: new skipping: skipSelectors [
	old selectors do: [:sel |
		(skipSelectors includes: sel) ifFalse: [self copyMethod: sel from: old to: new]].
	old class selectors do: [:sel | self copyMethod: sel from: old class to: new class]
]

{ #category : 'applying' }
GsSplitClassRefactoring >> copyMethod: sel from: srcCls to: dstCls [
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
GsSplitClassRefactoring >> applyMethodAdd: aChange [
	"Compile a method onto the component (movable methods) or the reversioned source (accessor +
	 delegators)."
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
GsSplitClassRefactoring >> dictObjectFor: aClass [
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty
		ifTrue: [environment symbolList objectNamed: #UserGlobals]
		ifFalse: [dicts first]
]

{ #category : 'applying' }
GsSplitClassRefactoring >> dictObjectForNewClass [
	dictNameOrNil ifNotNil: [:dn |
		^(environment symbolList objectNamed: dn asSymbol)
			ifNil: [self dictObjectFor: sourceClass]].
	^self dictObjectFor: sourceClass
]

{ #category : 'serializing' }
GsSplitClassRefactoring >> jsonQuote: aString [
	^GsRefactoringJson jsonQuote: aString
]

{ #category : 'serializing' }
GsSplitClassRefactoring >> jsonEscape: aString [
	^GsRefactoringJson jsonEscape: aString
]

{ #category : 'serializing' }
GsSplitClassRefactoring >> hex2: anInteger [
	^GsRefactoringJson hex2: anInteger
]
