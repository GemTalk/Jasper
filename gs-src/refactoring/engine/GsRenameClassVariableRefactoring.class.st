"
Rename a class variable across its defining class and all subclasses -- both the
instance side and the class side -- without committing. This is the fourth
refactoring the engine ships (after rename-instance-variable, rename-method, and
rename-class).

A class variable differs from an instance variable in three ways that shape this
refactoring:

  - It is referenced from BOTH instance-side and class-side methods, in the
    defining class AND every subclass (both sides), because a class variable is
    shared across the whole hierarchy. So the affected-method scan walks the
    defining class + allSubclasses, each on both sides.

  - Reference detection is bytecode-precise via the variable's ASSOCIATION: a
    method references the class variable iff its literal frame holds the exact
    SymbolAssociation that `definingClass _classVars associationAt: name` answers
    (GsRefactoringEnvironment>>methodsAccessingClassVar:inHierarchyOf:). This is
    the class-variable analog of rename-instVar's instVarsAccessed reflection --
    it distinguishes the class variable from a same-named GLOBAL (a different
    association) and from a shadowing temporary/argument (no association literal),
    so neither is renamed.

  - A class variable is a single shared BINDING with a VALUE. Renaming it by a
    naive class-definition recompile would DROP that value (the old name's
    association is discarded and the new name starts nil). So the apply renames it
    reflectively -- addClassVarName: the new name, carry the old association's
    VALUE across, recompile the referencing methods, then removeClassVarName: the
    old name -- which preserves the value AND, because a class-variable change does
    not alter instance format, creates NO new class version (the Explorer's Foo[n]
    tag is unchanged).

Scope is the whole hierarchy (defining class + subclasses, both sides) and only
that: a same-named name anywhere else is a different binding, so there is nothing
outside the hierarchy to rename -- hence no #class/#dictionary/#wholeSystem scope
model. The rename is all-or-nothing: the #classDefinitionEdit is always applied and
the reference recompiles are not deselectable in the client, because a method left
naming the removed variable would silently read a disconnected value.

Everything is staged into a GsRefactoringChangeSet: building it compiles nothing
and commits nothing. The apply compiles in the stone but never commits (the user
commits explicitly).
"
Class {
	#name : 'GsRenameClassVariableRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'definingClass',
		'oldName',
		'newName',
		'oldNameSym',
		'newNameSym',
		'changeSet',
		'skippedCount',
		'skippedMethods'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsRenameClassVariableRefactoring class >> class: aClass renameClassVar: oldNameString to: newNameString [
	"Rename the class variable named oldNameString (declared on aClass) to
	 newNameString, across aClass and all its subclasses (both sides)."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		oldName: oldNameString
		newName: newNameString
]

{ #category : 'instance creation' }
GsRenameClassVariableRefactoring class >> environment: anEnvironment class: aClass oldName: oldNameString newName: newNameString [
	^self new
		setEnvironment: anEnvironment
		class: aClass
		oldName: oldNameString
		newName: newNameString
]

{ #category : 'paginated preview' }
GsRenameClassVariableRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	"A page from a previously-started preview (see startPreviewToken:maxBytes:),
	 by token. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'paginated preview' }
GsRenameClassVariableRefactoring class >> applyForToken: token deselected: deselectedIds [
	"Apply a previously-started preview (by token), skipping deselectedIds. No
	 commit. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'paginated preview' }
GsRenameClassVariableRefactoring class >> clearToken: token [
	"Drop a finished preview from SessionTemps."
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'private' }
GsRenameClassVariableRefactoring >> setEnvironment: anEnvironment class: aClass oldName: oldNameString newName: newNameString [
	environment := anEnvironment.
	definingClass := aClass.
	oldName := oldNameString asString.
	newName := newNameString asString.
	oldNameSym := oldName asSymbol.
	newNameSym := newName asSymbol
]

{ #category : 'accessing' }
GsRenameClassVariableRefactoring >> environment [
	^environment
]

{ #category : 'accessing' }
GsRenameClassVariableRefactoring >> definingClass [
	^definingClass
]

{ #category : 'accessing' }
GsRenameClassVariableRefactoring >> oldName [
	^oldName
]

{ #category : 'accessing' }
GsRenameClassVariableRefactoring >> newName [
	^newName
]

{ #category : 'accessing' }
GsRenameClassVariableRefactoring >> changeSet [
	"The staged, non-committing change set, computed once and cached."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'private' }
GsRenameClassVariableRefactoring >> classVarAssociation [
	"The SymbolAssociation the old class-variable name is bound to on the defining
	 class, or nil if the class does not declare it. This is the exact object a
	 referencing method holds in its literal frame, so it is what the affected-method
	 scan looks for."
	^definingClass _classVars associationAt: oldNameSym ifAbsent: [nil]
]

{ #category : 'building' }
GsRenameClassVariableRefactoring >> buildChangeSet [
	"Stage the #classDefinitionEdit (the classVars: clause with the variable renamed)
	 FIRST so the apply adds the new variable before recompiling the methods that
	 reference it, then a #methodRecompile for every method (both sides, whole subtree)
	 that references the class variable. Compiles nothing, commits nothing."
	| cs |
	cs := GsRefactoringChangeSet new.
	skippedCount := 0.
	skippedMethods := OrderedCollection new.
	self stageClassDefinitionEditInto: cs.
	self stageMethodRecompilesInto: cs.
	^cs
]

{ #category : 'building' }
GsRenameClassVariableRefactoring >> stageClassDefinitionEditInto: aChangeSet [
	"Stage the edit to the defining class's own definition: the classVars: list with
	 the variable renamed. No compile, no commit."
	| oldDef newDef |
	oldDef := definingClass definition.
	newDef := self renameClassVarInDefinition: oldDef.
	newDef = oldDef ifTrue: [^self].
	aChangeSet
		addClassDefinitionEditInDictionary: (self dictNameForClass: definingClass)
		className: definingClass name
		oldSource: oldDef
		newSource: newDef
]

{ #category : 'building' }
GsRenameClassVariableRefactoring >> stageMethodRecompilesInto: aChangeSet [
	"Stage a #methodRecompile for every method (instance and class side, defining
	 class and subclasses) that references the class variable and whose non-shadowed
	 references change. Each method is isolated so one that cannot be rewritten is
	 recorded as skipped rather than aborting the whole preview."
	| assoc |
	assoc := self classVarAssociation.
	assoc isNil ifTrue: [^self].
	(environment methodsAccessingClassVar: assoc inHierarchyOf: definingClass) do: [:m |
		[self stageMethodRewrite: m into: aChangeSet]
			on: Error do: [:e | skippedCount := skippedCount + 1. self recordSkipped: m]]
]

{ #category : 'building' }
GsRenameClassVariableRefactoring >> stageMethodRewrite: aMethod into: aChangeSet [
	"Stage a recompile of one referencing method with its class-variable references
	 renamed minimal-diff. Stages nothing if no real reference was rewritten (e.g. the
	 name only appeared in a comment or a symbol literal)."
	| base isMeta sel oldSrc newSrc cat |
	base := self baseClassOf: aMethod.
	isMeta := aMethod inClass isMeta.
	sel := aMethod selector.
	oldSrc := aMethod sourceString.
	newSrc := self rewriteReferencesInSource: oldSrc.
	newSrc isNil ifTrue: [^self].
	cat := (aMethod inClass categoryOfSelector: sel environmentId: 0)
		ifNil: ['as yet unclassified'].
	aChangeSet
		addMethodRecompileInDictionary: (self dictNameForClass: base)
		className: base name
		isMeta: isMeta
		selector: sel
		category: cat asString
		oldSource: oldSrc
		newSource: newSrc
]

{ #category : 'private' }
GsRenameClassVariableRefactoring >> baseClassOf: aMethod [
	"The non-meta class of aMethod's defining class. GemStone's Metaclass answers its
	 instance class via #thisClass (NOT the Pharo-ism #instanceClass)."
	| cls |
	cls := aMethod inClass.
	^cls isMeta ifTrue: [cls thisClass] ifFalse: [cls]
]

{ #category : 'private' }
GsRenameClassVariableRefactoring >> dictNameForClass: aClass [
	"The name of the first dictionary that defines aClass, as a String, or nil."
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
]

{ #category : 'private' }
GsRenameClassVariableRefactoring >> recordSkipped: aMethod [
	skippedMethods add: (Array
		with: aMethod inClass name asString
		with: aMethod selector asString)
]

{ #category : 'source rewriting' }
GsRenameClassVariableRefactoring >> renameClassVarInDefinition: defString [
	"Return defString with the old class-variable name replaced by the new one inside
	 the classVars: #( ... ) clause only. Tokenises the clause on whitespace and
	 rebuilds it, so an instance variable, the class name, or classInstVars sharing the
	 old spelling is untouched. Returns defString unchanged if no clause is found.

	 Assumes the clause renders BARE symbols (`classVars: #( Counter Other)`, design
	 fact #5): each token is matched via `asSymbol == oldNameSym`, so a quoted rendering
	 (`#('Counter')`) would not match and the rename would silently no-op here. If a
	 stone/version ever renders quoted names, testStagesClassDefinitionEditWithRenamedClassVar
	 fails -- that test is the guard on this assumption."
	| start openParen closeParen listStr names separators ws |
	start := defString indexOfSubCollection: 'classVars:'.
	start = 0 ifTrue: [^defString].
	openParen := defString indexOf: $( startingAt: start.
	openParen = 0 ifTrue: [^defString].
	closeParen := defString indexOf: $) startingAt: openParen.
	closeParen = 0 ifTrue: [^defString].
	listStr := defString copyFrom: openParen + 1 to: closeParen - 1.
	separators := String with: $  with: Character tab with: Character lf with: Character cr.
	names := (listStr subStrings: separators) reject: [:n | n isEmpty].
	ws := WriteStream on: String new.
	ws nextPutAll: (defString copyFrom: 1 to: openParen).
	names do: [:n |
		ws nextPut: $ ;
		   nextPutAll: (n asSymbol == oldNameSym ifTrue: [newName] ifFalse: [n])].
	ws nextPutAll: (defString copyFrom: closeParen to: defString size).
	^ws contents
]

{ #category : 'source rewriting' }
GsRenameClassVariableRefactoring >> rewriteReferencesInSource: aString [
	"Parse aString, rewrite the non-shadowed references to the old class-variable name
	 to the new name (minimal diff), and return the regenerated source -- or nil if
	 nothing was rewritten (so the caller stages/compiles nothing spurious)."
	| tree count |
	tree := RBParser parseMethod: aString.
	count := self rewriteRefsIn: tree shadowed: false.
	count = 0 ifTrue: [^nil].
	^tree newSource
]

{ #category : 'source rewriting' }
GsRenameClassVariableRefactoring >> rewriteRefsIn: aNode shadowed: shadowed [
	"Recursively rewrite references to the old class-variable name at and under aNode,
	 returning how many were rewritten. A reference is renamed minimal-diff: register
	 an RBStringReplacement for its source span AND mutate its token (so the reparsed
	 source matches the mutated AST and newSource takes the splice path). shadowed is
	 true when a same-named argument or temporary captured the name in an enclosing
	 scope, in which case no node here refers to the class variable -- the same
	 scope-aware guard rename-instVar uses."
	| count childShadowed |
	aNode isVariable ifTrue: [
		(shadowed not and: [aNode name asSymbol == oldNameSym]) ifTrue: [
			aNode addReplacement: (RBStringReplacement
				replaceFrom: aNode start to: aNode stop with: newName).
			aNode token value: newName.
			^1].
		^0].
	count := 0.
	childShadowed := shadowed or: [self node: aNode declaresName: oldNameSym].
	aNode children do: [:child |
		count := count + (self rewriteRefsIn: child shadowed: childShadowed)].
	^count
]

{ #category : 'source rewriting' }
GsRenameClassVariableRefactoring >> node: aNode declaresName: aSymbol [
	"Does aNode introduce a scope binding (argument or temporary) for aSymbol? Such a
	 binding shadows the class variable for that scope."
	(aNode isMethod or: [aNode isBlock])
		ifTrue: [^(aNode arguments
			detect: [:a | a name asSymbol == aSymbol] ifNone: [nil]) notNil].
	aNode isSequence
		ifTrue: [^(aNode temporaries
			detect: [:t | t name asSymbol == aSymbol] ifNone: [nil]) notNil].
	^false
]

{ #category : 'preconditions' }
GsRenameClassVariableRefactoring >> newNameCollision [
	"nil if the new name is free to use, otherwise a short reason string: the new name
	 already names a class variable visible in the hierarchy, an instance variable of
	 the defining class, or a global anywhere on the symbol list. Building the change
	 set does not enforce this (the preview surfaces it); the apply would fail."
	newNameSym == oldNameSym ifTrue: [^nil].
	(self hierarchyClassVarNames includes: newNameSym)
		ifTrue: [^'the name ', newName, ' is already a class variable in the hierarchy'].
	((definingClass allInstVarNames collect: [:e | e asSymbol]) includes: newNameSym)
		ifTrue: [^'the name ', newName, ' is already an instance variable'].
	(environment symbolList objectNamed: newNameSym) notNil
		ifTrue: [^'the name ', newName, ' is already in use as a global'].
	^nil
]

{ #category : 'private' }
GsRenameClassVariableRefactoring >> hierarchyClassVarNames [
	"Every class-variable name declared anywhere in the defining class's hierarchy
	 (itself, its superclasses, its subclasses), as a Set of Symbols. A class variable
	 must be unique across the classes that can see it."
	| names classes |
	names := IdentitySet new.
	classes := OrderedCollection new.
	classes add: definingClass.
	classes addAll: definingClass allSuperclasses.
	classes addAll: definingClass allSubclasses.
	classes do: [:cls |
		cls classVarNames do: [:n | names add: n asSymbol]].
	^names
]

{ #category : 'serializing' }
GsRenameClassVariableRefactoring >> previewJsonString [
	^self changeSet jsonString
]

{ #category : 'serializing' }
GsRenameClassVariableRefactoring >> outOfScopeJsonString [
	"The scope / precondition / skipped warning payload for the preview. A class-variable
	 rename is confined to the hierarchy, so there are never any out-of-scope references;
	 the payload keeps the same shape the client's paginated panel reads (references,
	 skipped, collision) and adds a scope note."
	self changeSet.
	^'{"references":0,"skipped":', skippedCount printString,
	  ',"scope":"hierarchy"',
	  ',"collision":', (self newNameCollision
		ifNil: ['null']
		ifNotNil: [:reason | self jsonQuote: reason]), '}'
]

{ #category : 'serializing' }
GsRenameClassVariableRefactoring >> skippedMethodsJsonString [
	| ws |
	self changeSet.
	ws := WriteStream on: String new.
	ws nextPut: $[.
	skippedMethods keysAndValuesDo: [:i :entry |
		i = 1 ifFalse: [ws nextPut: $,].
		ws nextPutAll: '{"class":"'; nextPutAll: (self jsonEscape: (entry at: 1)).
		ws nextPutAll: '","selector":"'; nextPutAll: (self jsonEscape: (entry at: 2)).
		ws nextPutAll: '"}'].
	ws nextPut: $].
	^ws contents
]

{ #category : 'serializing' }
GsRenameClassVariableRefactoring >> jsonEscape: aString [
	^GsRefactoringJson jsonEscape: aString
]

{ #category : 'serializing' }
GsRenameClassVariableRefactoring >> jsonQuote: aString [
	^GsRefactoringJson jsonQuote: aString
]

{ #category : 'serializing' }
GsRenameClassVariableRefactoring >> hex2: anInteger [
	^GsRefactoringJson hex2: anInteger
]

{ #category : 'paginated preview' }
GsRenameClassVariableRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
	"A byte-bounded page of staged changes (with source) from startIndex (1-based).
	 At least one change is always emitted."
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

{ #category : 'paginated preview' }
GsRenameClassVariableRefactoring >> startPreviewToken: token maxBytes: maxBytes [
	"Build the change set, stash this refactoring in SessionTemps under token, and
	 answer the first page plus the totals + warnings. Nothing is committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"oldName":', (self jsonQuote: oldName),
	  ',"newName":', (self jsonQuote: newName),
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"skippedMethods":', self skippedMethodsJsonString,
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'applying' }
GsRenameClassVariableRefactoring >> applyDeselected: deselectedIds [
	"Apply EVERY staged change in the stone WITHOUT committing (the user commits
	 explicitly). A class-variable rename is ALL-OR-NOTHING: the value-preserving
	 reflective rename removes the old binding, so a reference method left un-rewritten
	 would silently read a disconnected value (a dangling reference). The client
	 therefore does not offer to deselect the reference recompiles, and this method does
	 NOT honour a deselection even if one is passed -- applying every change is the only
	 coherent, non-dangling behaviour. deselectedIds is accepted solely for signature
	 compatibility with the other refactorings' applyForToken:deselected: entry point;
	 it is intentionally ignored. Answers {applied, failed:[..]}."
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
GsRenameClassVariableRefactoring >> applyChange: aChange [
	aChange kind == #classDefinitionEdit ifTrue: [^self applyClassDefinitionEdit: aChange].
	aChange kind == #methodRecompile ifTrue: [^self applyMethodRecompile: aChange].
	^self error: 'Unexpected change kind for rename-class-variable: ', aChange kind printString
]

{ #category : 'applying' }
GsRenameClassVariableRefactoring >> applyClassDefinitionEdit: aChange [
	"Rename the class variable reflectively, preserving its shared VALUE: add the new
	 name, carry the old association's value onto it, then remove the old name. A naive
	 recompile of the new class definition would drop the value; addClassVarName: /
	 removeClassVarName: preserve it and -- because a class-variable change does not
	 alter instance format -- create no new class version. The old name is removed
	 first-change here (before the method recompiles run) safely: a not-yet-recompiled
	 method keeps a working, detached copy of the old association until it is recompiled
	 to the new name."
	| cls oldAssoc oldValue |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	oldAssoc := cls _classVars associationAt: oldNameSym ifAbsent: [nil].
	oldValue := oldAssoc isNil ifTrue: [nil] ifFalse: [oldAssoc value].
	cls addClassVarName: newName.
	(cls _classVars associationAt: newNameSym) value: oldValue.
	cls removeClassVarName: oldName
]

{ #category : 'applying' }
GsRenameClassVariableRefactoring >> applyMethodRecompile: aChange [
	"Recompile one referencing method with its rewritten (new-name) source."
	| cls target |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	"Through the environment, which RAISES on a compile failure -- compileMethod: only
	 answers its errors, so an unchecked send would leave this method un-recompiled and
	 still bound to the OLD class-variable association while reporting clean success."
	environment
		compile: aChange newSource
		into: target
		category: (aChange category ifNil: ['as yet unclassified'])
]
