"
Rename a method TEMPORARY or ARGUMENT (R5) -- the lightest refactoring the engine
ships. A temporary or argument is method-local: every reference lives in one
method's source, so this refactoring touches exactly ONE method, stages a single
#methodRecompile, and needs no class-definition edit and no cross-method scan.

The refactoring is addressed by class + selector + isMeta + old name + new name +
a 1-based source OFFSET into the method identifying the occurrence the user
clicked. The offset disambiguates a name declared in more than one scope of the
same method (e.g. two blocks each with a :each). Binding resolution is by AST
scope, symbol-identity throughout (never a raw String compare, so a Unicode
string on a 3.6.x stone never trips error 2718):

  - RBParser parses the method source; `tree bestNodeFor: (offset to: offset)`
    finds the variable node under the cursor;
  - walking that node's `parent` chain to the nearest enclosing scope (method /
    block arguments, or a sequence's temporaries) that DECLARES the name yields
    the target binding's declaring scope -- or nil, meaning the name is not a
    local at that position (an instance variable, a global, self, a message
    selector), and the rename is DECLINED (that is R1/R4's job, not R5's);
  - every RBVariableNode of the same name whose own declaring scope is that same
    node is renamed; an inner block that redeclares the name shadows it, so its
    occurrences resolve to the inner scope and are left alone (both directions:
    renaming the outer binding never touches the inner, and vice versa).

The new name is refused (previewed, never applied) when it would COLLIDE: with
any other argument or temporary anywhere in the method (an argument must not
collide with a temporary or vice versa), with an own or INHERITED instance
variable, with an own or inherited class variable, or with a pseudo-variable.

Building the change set compiles nothing and commits nothing. The server-side
apply recompiles the one method in the stone but never commits (the user commits
explicitly). The rename is all-or-nothing: there is a single change, so a passed
deselection is inert (accepted only for signature parity with the other
refactorings' applyForToken:deselected: entry point).
"
Class {
	#name : 'GsRenameTemporaryRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'definingClass',
		'selector',
		'isMeta',
		'oldName',
		'newName',
		'oldNameSym',
		'newNameSym',
		'offset',
		'changeSet',
		'resolved',
		'resolvedScope'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsRenameTemporaryRefactoring class >> class: aClass selector: aSelector meta: aBool renameTemp: oldNameString to: newNameString atOffset: anOffset [
	"Rename the temporary/argument named oldNameString -- the occurrence at anOffset
	 (a 1-based character index into aClass>>aSelector's source) -- to newNameString."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		selector: aSelector
		meta: aBool
		oldName: oldNameString
		newName: newNameString
		offset: anOffset
]

{ #category : 'instance creation' }
GsRenameTemporaryRefactoring class >> environment: anEnvironment class: aClass selector: aSelector meta: aBool oldName: oldNameString newName: newNameString offset: anOffset [
	^self new
		setEnvironment: anEnvironment
		class: aClass
		selector: aSelector
		meta: aBool
		oldName: oldNameString
		newName: newNameString
		offset: anOffset
]

{ #category : 'paginated preview' }
GsRenameTemporaryRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	"A page from a previously-started preview (see startPreviewToken:maxBytes:), by
	 token. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'paginated preview' }
GsRenameTemporaryRefactoring class >> applyForToken: token deselected: deselectedIds [
	"Apply a previously-started preview (by token). No commit. Answers an error
	 envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'preconditions' }
GsRenameTemporaryRefactoring class >> declineReasonForClass: aClass selector: aSelector meta: aBool name: oldNameString atOffset: anOffset [
	"The reason a rename of the name at anOffset would be DECLINED -- classifying
	 what the name actually is (an instance variable, an inherited instance
	 variable, a class variable, a global, a pseudo-variable, or not a variable at
	 that position) -- or an empty String if it IS a renamable temporary/argument.
	 Lets the client refuse up front, with a specific reason, before prompting for a
	 new name. The new name is irrelevant here, so it is passed as the old name."
	^(self
		class: aClass
		selector: aSelector
		meta: aBool
		renameTemp: oldNameString
		to: oldNameString
		atOffset: anOffset) declineReason ifNil: ['']
]

{ #category : 'paginated preview' }
GsRenameTemporaryRefactoring class >> clearToken: token [
	"Drop a finished preview from SessionTemps."
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'private' }
GsRenameTemporaryRefactoring >> setEnvironment: anEnvironment class: aClass selector: aSelector meta: aBool oldName: oldNameString newName: newNameString offset: anOffset [
	environment := anEnvironment.
	definingClass := aClass.
	selector := aSelector asSymbol.
	isMeta := aBool.
	oldName := oldNameString asString.
	newName := newNameString asString.
	oldNameSym := oldName asSymbol.
	newNameSym := newName asSymbol.
	offset := anOffset.
	resolved := false
]

{ #category : 'accessing' }
GsRenameTemporaryRefactoring >> environment [
	^environment
]

{ #category : 'accessing' }
GsRenameTemporaryRefactoring >> definingClass [
	^definingClass
]

{ #category : 'accessing' }
GsRenameTemporaryRefactoring >> selector [
	^selector
]

{ #category : 'accessing' }
GsRenameTemporaryRefactoring >> isMeta [
	^isMeta
]

{ #category : 'accessing' }
GsRenameTemporaryRefactoring >> oldName [
	^oldName
]

{ #category : 'accessing' }
GsRenameTemporaryRefactoring >> newName [
	^newName
]

{ #category : 'accessing' }
GsRenameTemporaryRefactoring >> changeSet [
	"The staged, non-committing change set, computed once and cached. Empty when the
	 rename is declined (the offset does not resolve to a local) or nothing changed."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'private' }
GsRenameTemporaryRefactoring >> targetClass [
	"The behaviour that holds the method: the metaclass for a class-side method."
	^isMeta ifTrue: [definingClass class] ifFalse: [definingClass]
]

{ #category : 'private' }
GsRenameTemporaryRefactoring >> sourceString [
	"The stored source of the method being refactored, or nil if it does not exist."
	| m |
	m := self targetClass compiledMethodAt: selector environmentId: 0 otherwise: nil.
	^m isNil ifTrue: [nil] ifFalse: [m sourceString]
]

{ #category : 'private' }
GsRenameTemporaryRefactoring >> parseTree [
	"A fresh parse of the method source, or nil if it is missing or unparseable."
	| src |
	src := self sourceString.
	src isNil ifTrue: [^nil].
	^[RBParser parseMethod: src] on: Error do: [:e | nil]
]

{ #category : 'private' }
GsRenameTemporaryRefactoring >> scopeNode: aNode declaresSym: aSymbol [
	"Does aNode introduce a scope binding (argument or temporary) for aSymbol? A
	 method or block declares its arguments; a sequence declares its temporaries."
	(aNode isMethod or: [aNode isBlock])
		ifTrue: [^aNode arguments anySatisfy: [:a | a name asSymbol == aSymbol]].
	aNode isSequence
		ifTrue: [^aNode temporaries anySatisfy: [:t | t name asSymbol == aSymbol]].
	^false
]

{ #category : 'private' }
GsRenameTemporaryRefactoring >> declaringScopeFor: aNode [
	"The nearest enclosing scope node (method / block / sequence) that declares the
	 old name as an argument or temporary, walking aNode's parent chain from the
	 inside out -- or nil if the name is not a local as seen from aNode. This is the
	 binding aNode resolves to; two occurrences with the same declaring scope are the
	 same variable."
	| n |
	n := aNode.
	[n notNil] whileTrue: [
		(self scopeNode: n declaresSym: oldNameSym) ifTrue: [^n].
		n := n parent].
	^nil
]

{ #category : 'private' }
GsRenameTemporaryRefactoring >> occurrenceNode [
	"The RBVariableNode at offset whose name is the old name, or nil if the offset is
	 NOT on an occurrence of that variable -- a comment, a message selector, an
	 operator, whitespace, or any other token. Requiring an actual variable node (not
	 merely a position whose enclosing scope happens to declare the name) is what
	 keeps a click in a COMMENT that mentions a real argument from being treated as a
	 rename of that argument, and lets a click on a message like #do: decline cleanly."
	| tree occ |
	tree := self parseTree.
	tree isNil ifTrue: [^nil].
	occ := [tree bestNodeFor: (offset to: offset)] on: Error do: [:e | nil].
	^(occ notNil and: [occ isVariable and: [occ name asSymbol == oldNameSym]])
		ifTrue: [occ]
		ifFalse: [nil]
]

{ #category : 'private' }
GsRenameTemporaryRefactoring >> resolvedScope [
	"The declaring scope of the variable occurrence at offset, or nil when the offset
	 is not on a renamable local -- either it is not on a variable occurrence of the
	 name at all (occurrenceNode nil) or the name is not a temporary/argument there
	 (an instance variable, a global, self). Computed once; used by renamable and
	 declineReason."
	resolved ifFalse: [
		resolved := true.
		resolvedScope := [self occurrenceNode
			ifNil: [nil]
			ifNotNil: [:occ | self declaringScopeFor: occ]]
			on: Error do: [:e | nil]].
	^resolvedScope
]

{ #category : 'testing' }
GsRenameTemporaryRefactoring >> renamable [
	"True if the occurrence at offset is a temporary or argument this refactoring can
	 rename."
	^self resolvedScope notNil
]

{ #category : 'preconditions' }
GsRenameTemporaryRefactoring >> declineReason [
	"nil if the occurrence is a renamable local, otherwise a reason string that
	 CLASSIFIES what the name actually is, so the client can tell the user why the
	 rename was declined and point them at the right refactoring."
	| sym |
	self renamable ifTrue: [^nil].
	"Not on a variable occurrence at all (a comment, a message selector, an operator,
	 whitespace) -- guide the user to click the actual variable name."
	self occurrenceNode isNil ifTrue: [
		^'Place the cursor on the temporary or argument you want to rename -- that position is not a variable (it may be a comment, a message selector, or punctuation).'].
	sym := oldNameSym.
	(self isPseudoVariable: sym)
		ifTrue: [^'''', oldName, ''' is a reserved variable and cannot be renamed.'].
	((definingClass instVarNames collect: [:e | e asSymbol]) includes: sym)
		ifTrue: [^'''', oldName, ''' is an instance variable of ', definingClass name,
			', not a temporary or argument. Use Rename Instance Variable to rename it everywhere it is used.'].
	((definingClass allInstVarNames collect: [:e | e asSymbol]) includes: sym)
		ifTrue: [^'''', oldName, ''' is an instance variable inherited by ', definingClass name,
			'. Use Rename Instance Variable on the class that defines it.'].
	((definingClass class instVarNames collect: [:e | e asSymbol]) includes: sym)
		ifTrue: [^'''', oldName, ''' is a class-instance variable of ', definingClass name, ', not a temporary or argument.'].
	(self visibleClassVarNames includes: sym)
		ifTrue: [^'''', oldName, ''' is a class variable visible in ', definingClass name,
			'. Use Rename Class Variable to rename it.'].
	(environment symbolList objectNamed: sym) notNil
		ifTrue: [^'''', oldName, ''' is a global, not a temporary or argument.'].
	^'''', oldName, ''' is not a temporary or argument at that position (it may be a message selector or an undeclared name).'
]

{ #category : 'building' }
GsRenameTemporaryRefactoring >> buildChangeSet [
	"Parse the method, resolve the target binding at offset, rename every occurrence
	 bound to it (leaving inner-shadowed occurrences alone), and stage a SINGLE
	 #methodRecompile with the rewritten source. Stages nothing (an empty change set)
	 when the rename is declined or no occurrence actually changed. Compiles nothing,
	 commits nothing."
	| cs tree occ scope targets |
	cs := GsRefactoringChangeSet new.
	tree := self parseTree.
	tree isNil ifTrue: [^cs].
	"The offset must land on an actual variable occurrence of the name -- not merely a
	 position whose scope declares it (e.g. inside a comment that mentions it). Resolve
	 it in THIS tree (not via occurrenceNode, whose separate parse would make the
	 identity compare below never match)."
	occ := tree bestNodeFor: (offset to: offset).
	(occ notNil and: [occ isVariable and: [occ name asSymbol == oldNameSym]]) ifFalse: [^cs].
	scope := self declaringScopeFor: occ.
	scope isNil ifTrue: [^cs].
	targets := OrderedCollection new.
	tree nodesDo: [:node |
		(node isVariable
			and: [node name asSymbol == oldNameSym
			and: [(self declaringScopeFor: node) == scope]])
			ifTrue: [targets add: node]].
	targets isEmpty ifTrue: [^cs].
	targets do: [:node |
		node addReplacement: (RBStringReplacement
			replaceFrom: node start to: node stop with: newName).
		node token value: newName].
	cs
		addMethodRecompileInDictionary: (self dictNameForClass: definingClass)
		className: definingClass name
		isMeta: isMeta
		selector: selector
		category: self methodCategory
		oldSource: self sourceString
		newSource: tree newSource.
	^cs
]

{ #category : 'private' }
GsRenameTemporaryRefactoring >> methodCategory [
	^((self targetClass categoryOfSelector: selector environmentId: 0)
		ifNil: ['as yet unclassified']) asString
]

{ #category : 'private' }
GsRenameTemporaryRefactoring >> dictNameForClass: aClass [
	"The name of the first dictionary that defines aClass, as a String, or nil."
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
]

{ #category : 'preconditions' }
GsRenameTemporaryRefactoring >> newNameCollision [
	"nil if the new name is free, otherwise a short reason string. The new name
	 collides when it already names another argument or temporary anywhere in the
	 method (an argument must not collide with a temporary, or vice versa), an own or
	 inherited instance variable, an own or inherited class variable, or a
	 pseudo-variable. Comparisons are by symbol identity."
	newNameSym == oldNameSym ifTrue: [^nil].
	(self isPseudoVariable: newNameSym)
		ifTrue: [^'the name ', newName, ' is a reserved pseudo-variable'].
	(self localNames includes: newNameSym)
		ifTrue: [^'the name ', newName, ' is already an argument or temporary in this method'].
	((definingClass allInstVarNames collect: [:e | e asSymbol]) includes: newNameSym)
		ifTrue: [^'the name ', newName, ' is already an instance variable'].
	(self visibleClassVarNames includes: newNameSym)
		ifTrue: [^'the name ', newName, ' is already a class variable'].
	^nil
]

{ #category : 'preconditions' }
GsRenameTemporaryRefactoring >> isPseudoVariable: aSymbol [
	^#(#self #super #thisContext #nil #true #false) includes: aSymbol
]

{ #category : 'preconditions' }
GsRenameTemporaryRefactoring >> localNames [
	"Every argument and temporary name declared anywhere in the method (all scopes),
	 as a Set of Symbols. Read from a FRESH parse so it is never affected by the
	 change-set build's tree mutation."
	| names tree |
	names := IdentitySet new.
	tree := self parseTree.
	tree ifNil: [^names].
	tree nodesDo: [:node |
		(node isMethod or: [node isBlock])
			ifTrue: [node arguments do: [:a | names add: a name asSymbol]].
		node isSequence
			ifTrue: [node temporaries do: [:t | names add: t name asSymbol]]].
	^names
]

{ #category : 'preconditions' }
GsRenameTemporaryRefactoring >> visibleClassVarNames [
	"Every class-variable name visible in a method of the defining class: the class's
	 own class variables plus every superclass's, as a Set of Symbols."
	| names classes |
	names := IdentitySet new.
	classes := OrderedCollection new.
	classes add: definingClass.
	classes addAll: definingClass allSuperclasses.
	classes do: [:cls | cls classVarNames do: [:n | names add: n asSymbol]].
	^names
]

{ #category : 'serializing' }
GsRenameTemporaryRefactoring >> previewJsonString [
	^self changeSet jsonString
]

{ #category : 'serializing' }
GsRenameTemporaryRefactoring >> outOfScopeJsonString [
	"The scope / precondition payload for the preview, in the same shape the client's
	 paginated panel reads. A temporary/argument rename is confined to one method, so
	 there are never out-of-scope references or skipped methods; the collision and
	 decline reasons (if any) are surfaced here so the panel can refuse and explain."
	^'{"references":0,"skipped":0,"scope":"method"',
	  ',"collision":', (self newNameCollision
		ifNil: ['null'] ifNotNil: [:reason | self jsonQuote: reason]),
	  ',"decline":', (self declineReason
		ifNil: ['null'] ifNotNil: [:reason | self jsonQuote: reason]),
	  '}'
]

{ #category : 'paginated preview' }
GsRenameTemporaryRefactoring >> startPreviewToken: token maxBytes: maxBytes [
	"Build the change set, stash this refactoring in SessionTemps under token, and
	 answer the first page plus the totals and precondition warnings. Nothing is
	 committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"oldName":', (self jsonQuote: oldName),
	  ',"newName":', (self jsonQuote: newName),
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"skippedMethods":[]',
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'paginated preview' }
GsRenameTemporaryRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
	"A byte-bounded page of staged changes (with source) from startIndex (1-based).
	 At least one change is always emitted when any remain."
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
GsRenameTemporaryRefactoring >> applyDeselected: deselectedIds [
	"Apply the staged change in the stone WITHOUT committing (the user commits
	 explicitly). A temporary/argument rename is a SINGLE change, so deselectedIds is
	 inert -- accepted only for signature parity with the other refactorings' apply
	 entry point. Answers {applied, failed:[..]}."
	| applied failures |
	failures := OrderedCollection new.
	applied := 0.
	self changeSet changes do: [:change |
		[self applyChange: change. applied := applied + 1]
		on: Error do: [:e |
			failures add: (Array with: change id with: change failureLabel with: e messageText)]].
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
GsRenameTemporaryRefactoring >> applyChange: aChange [
	aChange kind == #methodRecompile ifTrue: [^self applyMethodRecompile: aChange].
	^self error: 'Unexpected change kind for rename-temporary: ', aChange kind printString
]

{ #category : 'applying' }
GsRenameTemporaryRefactoring >> applyMethodRecompile: aChange [
	"Recompile the one method with its rewritten (new-name) source."
	| cls target |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	environment
		compile: aChange newSource
		into: target
		category: (aChange category ifNil: ['as yet unclassified'])
]

{ #category : 'serializing' }
GsRenameTemporaryRefactoring >> jsonQuote: aString [
	^GsRefactoringJson jsonQuote: aString
]

{ #category : 'serializing' }
GsRenameTemporaryRefactoring >> jsonEscape: aString [
	^GsRefactoringJson jsonEscape: aString
]

{ #category : 'serializing' }
GsRenameTemporaryRefactoring >> hex2: anInteger [
	^GsRefactoringJson hex2: anInteger
]
</content>
