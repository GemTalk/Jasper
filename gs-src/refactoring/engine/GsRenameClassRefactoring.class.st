"
Rename a class across the whole image, within a chosen scope, without committing.
This is the third refactoring the engine ships (after rename-instance-variable and
rename-method).

Renaming a class is more than a global rebind, because GemStone models a class
definition change as a NEW class VERSION:

  - The rename creates a new version of the class under the new name, in the SAME
    class history (Class>>_subclass:...newVersionOf:...). Old versions keep their
    old names, so the class history records the rename (see GsClassHistory), and
    the Explorer's Foo[n] version tag bumps. The current primitive returns the old
    class unchanged when the new class would be equivalent, so a real name change
    always makes a new version.

  - A new version starts with an EMPTY method dictionary, so the apply copies the
    old version's methods (both sides) forward, rewriting any reference to the old
    name to the new name as it copies.

  - The new name is bound by the primitive; the OLD name is removed explicitly.

  - Subclasses are NOT re-parented by newVersionOf: -- a subclass keeps pointing at
    the old parent version. So the rename re-parents the whole descendant subtree,
    top-down: each descendant is recompiled newVersionOf: its current version under
    the freshly created parent chain, and its methods are copied forward. A direct
    child's definition also has its superclass NAME rewritten.

  - References to the old name in OTHER classes' method bodies are rewritten
    minimal-diff (mutate the RBVariableNode AND register an RBStringReplacement,
    then newSource -- the R2 recipe) and staged as #methodRecompile. A name inside
    a comment, a string literal, or a #Symbol literal is never an RBVariableNode, so
    it is left untouched. The renamed class's and the descendants' OWN methods are
    rewritten during their copy-forward, not as separate #methodRecompile changes.

Scope governs which referencing methods are rewritten (#class, #hierarchy,
#dictionary, #wholeSystem -- default #wholeSystem for a class rename); references
outside the scope are counted (outOfScopeReferenceCount) so a client can warn.
Re-parenting the descendant subtree and rebinding the name are NOT scoped -- an
orphaned subclass or a dangling name would be a correctness bug -- so they always
happen. Accordingly the apply always applies the #classRename and every
#classReparent, honouring a deselection only for the optional #methodRecompile
reference rewrites.

Everything is staged into a GsRefactoringChangeSet: building it compiles nothing
and commits nothing. By default the apply compiles in the stone but does not
commit (the user commits explicitly). Four options (JadeiteForPharo issue #142)
tune it: copyMethods (copy each superseded version's methods forward),
recompileSubclasses (re-parent the descendant subtree), migrateInstances (migrate
every old-version instance to its new version), and removeOldFromHistory (prune the
superseded versions from the class history). Because instance migration must be
durable, the apply COMMITS when migrateInstances or removeOldFromHistory is on --
that is the one path that commits, and it is opt-in.
"
Class {
	#name : 'GsRenameClassRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'definingClass',
		'oldName',
		'newName',
		'oldNameSym',
		'scopeKind',
		'scopeDictName',
		'changeSet',
		'outOfScopeReferenceCount',
		'skippedCount',
		'skippedMethods',
		'scopeClasses',
		'subtreeClasses',
		'oldToNew',
		'shapeSource',
		'copyMethods',
		'recompileSubclasses',
		'migrateInstances',
		'removeOldFromHistory',
		'copyFailures'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsRenameClassRefactoring class >> restoreClass: aClass toVersion: aVersion [
	"Restore aClass to a historical class-history version aVersion: the same
	 operation as a rename to aVersion's name, but the target class is rebuilt from
	 aVersion's shape AND methods (not the current class's). When aVersion's name
	 differs from the current name this reparents subclasses and rewrites references
	 exactly as a rename does; when the name is unchanged it is a shape/method redo
	 that still creates a new version and re-parents subclasses onto it. Whole-system
	 scope, since a restore that changes the name must fix every reference."
	^(self
		environment: GsRefactoringEnvironment new
		class: aClass
		oldName: aClass name
		newName: aVersion name asString
		scopeKind: #wholeSystem
		scopeDictName: nil)
		setShapeSource: aVersion
]

{ #category : 'private' }
GsRenameClassRefactoring >> setShapeSource: aClass [
	"The class VERSION to take the renamed class's shape + methods from. Nil (the
	 default) means use the current class -- i.e. an ordinary rename."
	shapeSource := aClass
]

{ #category : 'private' }
GsRenameClassRefactoring >> superclassForShapeSource: src of: old [
	"The superclass the new version belongs under.

	 For an ordinary RENAME src is the current class, so this is just its current superclass and
	 nothing changes. For a RESTORE src is a historical version, and its PARENTAGE is part of the
	 definition being restored -- so a restore must go back under the parent that version had, not
	 stay under whatever parent the class has now. Passing `old superclass` here meant a restore
	 silently kept the current parent, so restoring across a re-parenting (an inserted superclass,
	 an extracted one) claimed to restore a definition it did not restore. Undoing such a
	 refactoring then left the class under a parent that was about to be unbound (#434).

	 The historical version's superclass may itself be a superseded version of that parent, so it
	 is resolved BY NAME to whatever version is current -- re-parenting onto a stale version would
	 strand the class off the live hierarchy. If the name no longer resolves (the parent class is
	 gone), the current superclass is kept: better a class in the wrong place than one that cannot
	 be created at all."
	| histSuper |
	src == old ifTrue: [^old superclass].
	histSuper := src superclass.
	histSuper isNil ifTrue: [^old superclass].
	^(environment classNamed: histSuper name asString) ifNil: [old superclass]
]

{ #category : 'private' }
GsRenameClassRefactoring >> shapeSourceOr: aClass [
	"The shape/method source for the target class: the explicit shapeSource (a
	 restore) or the current class (an ordinary rename)."
	^shapeSource ifNil: [aClass]
]

{ #category : 'instance creation' }
GsRenameClassRefactoring class >> class: aClass renameTo: newNameString dictionaryScope: dictName [
	"Rename scoped to a single named SymbolDictionary (for the reference rewrite)."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		oldName: aClass name
		newName: newNameString
		scopeKind: #dictionary
		scopeDictName: dictName
]

{ #category : 'instance creation' }
GsRenameClassRefactoring class >> class: aClass renameTo: newNameString scope: scopeSymbol [
	"scopeSymbol is #class, #hierarchy, or #wholeSystem. For #dictionary use
	 class:renameTo:dictionaryScope:."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		oldName: aClass name
		newName: newNameString
		scopeKind: scopeSymbol
		scopeDictName: nil
]

{ #category : 'instance creation' }
GsRenameClassRefactoring class >> environment: anEnvironment class: aClass oldName: on newName: nn scopeKind: sk scopeDictName: dn [
	^self new
		setEnvironment: anEnvironment
		class: aClass
		oldName: on
		newName: nn
		scopeKind: sk
		scopeDictName: dn
]

{ #category : 'private' }
GsRenameClassRefactoring >> setEnvironment: anEnvironment class: aClass oldName: on newName: nn scopeKind: sk scopeDictName: dn [
	environment := anEnvironment.
	definingClass := aClass.
	oldName := on asString.
	newName := nn asString.
	oldNameSym := oldName asSymbol.
	scopeKind := sk.
	scopeDictName := dn.
	"Engine-safe option defaults; the client passes explicit values. Migrate and
	 remove-from-history default OFF here because they mutate persistent state and
	 commit -- so a caller (e.g. an SUnit test) that does not opt in never commits."
	copyMethods := true.
	recompileSubclasses := true.
	migrateInstances := false.
	removeOldFromHistory := false
]

{ #category : 'accessing' }
GsRenameClassRefactoring >> copyMethods: cm recompileSubclasses: rs migrateInstances: mi removeOldFromHistory: rh [
	"The four rename options (JadeiteForPharo issue #142):
	  - copyMethods: copy each superseded version's methods onto its new version
	    (off = the new versions start with an empty method dictionary);
	  - recompileSubclasses: re-parent the descendant subtree onto the new version
	    (off = subclasses keep pointing at the old version and are NOT touched);
	  - migrateInstances: migrate every instance of each superseded version to its
	    new version -- this REQUIRES a commit, so the apply commits when it is on;
	  - removeOldFromHistory: prune the superseded versions from the class history
	    after applying (off = history keeps every version)."
	copyMethods := cm.
	recompileSubclasses := rs.
	migrateInstances := mi.
	removeOldFromHistory := rh
]

{ #category : 'accessing' }
GsRenameClassRefactoring >> definingClass [
	^definingClass
]

{ #category : 'accessing' }
GsRenameClassRefactoring >> environment [
	^environment
]

{ #category : 'accessing' }
GsRenameClassRefactoring >> oldName [
	^oldName
]

{ #category : 'accessing' }
GsRenameClassRefactoring >> newName [
	^newName
]

{ #category : 'accessing' }
GsRenameClassRefactoring >> changeSet [
	"The staged, non-committing change set, computed once and cached."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'building' }
GsRenameClassRefactoring >> buildChangeSet [
	"Stage the #classRename for the target, a #classReparent for every descendant
	 (top-down), and a #methodRecompile for every in-scope method OUTSIDE the renamed
	 subtree that references the old name. Counts the out-of-scope references and any
	 method that could not be rewritten (skipped). Compiles nothing, commits nothing."
	| cs |
	cs := GsRefactoringChangeSet new.
	outOfScopeReferenceCount := 0.
	skippedCount := 0.
	skippedMethods := OrderedCollection new.
	self stageClassRenameInto: cs.
	self stageReparentsInto: cs.
	self stageReferenceRecompilesInto: cs.
	^cs
]

{ #category : 'building' }
GsRenameClassRefactoring >> stageClassRenameInto: aChangeSet [
	"Stage the rename of the target class: old vs new class definition (the name
	 changed) for the diff. The apply does the structural work (new version, method
	 copy-forward, rebind)."
	| oldDef newDef |
	oldDef := definingClass definition.
	newDef := self renameClassNameIn: oldDef from: oldName to: newName.
	aChangeSet
		addClassRenameInDictionary: (self dictNameForClass: definingClass)
		className: oldName
		newName: newName
		oldSource: oldDef
		newSource: newDef
]

{ #category : 'building' }
GsRenameClassRefactoring >> stageReparentsInto: aChangeSet [
	"Stage a #classReparent for every descendant of the target, top-down. A direct
	 child's definition has its superclass name rewritten old -> new; a deeper
	 descendant's definition is textually unchanged but is still staged, because its
	 version must be recompiled to re-point at the new parent-chain version.
	 Skipped entirely when the recompileSubclasses option is off -- the subclasses
	 then keep pointing at the old version and are not touched."
	recompileSubclasses ifFalse: [^self].
	(environment descendantsOf: definingClass) do: [:sub |
		| oldDef newDef |
		oldDef := sub definition.
		newDef := (sub superclass == definingClass)
			ifTrue: [self renameSuperclassNameIn: oldDef from: oldName to: newName]
			ifFalse: [oldDef].
		aChangeSet
			addClassReparentInDictionary: (self dictNameForClass: sub)
			className: sub name asString
			oldSource: oldDef
			newSource: newDef]
]

{ #category : 'building' }
GsRenameClassRefactoring >> stageReferenceRecompilesInto: aChangeSet [
	"Stage a #methodRecompile for every in-scope method that references the old class
	 name and lives OUTSIDE the renamed subtree (the target + its descendants). The
	 subtree's own methods are rewritten during their copy-forward, so recompiling them
	 here would be redundant (and would target a soon-to-be-removed name)."
	| subtree |
	"A same-name restore changes no name, so no external reference needs rewriting."
	oldNameSym == newName asSymbol ifTrue: [^self].
	subtree := self subtreeClassSet.
	(environment referencesToClassNamed: oldName) do: [:m |
		[| base |
		 base := self baseClassOf: m.
		 (subtree includes: base)
			ifFalse: [
				(self isClassInScope: base)
					ifTrue: [self stageReferenceRewrite: m base: base into: aChangeSet]
					ifFalse: [outOfScopeReferenceCount := outOfScopeReferenceCount + 1]]]
		on: Error do: [:e | skippedCount := skippedCount + 1. self recordSkipped: m]]
]

{ #category : 'building' }
GsRenameClassRefactoring >> stageReferenceRewrite: aMethod base: base into: aChangeSet [
	"Stage a recompile of one external referencing method with its old-name references
	 rewritten to the new name (minimal diff). Stages nothing if no real reference was
	 rewritten (e.g. the name only appeared in a comment or a symbol literal)."
	| isMeta sel oldSrc newSrc cat |
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
GsRenameClassRefactoring >> subtreeClassSet [
	"The target class + all its descendants, as an IdentitySet (used to exclude the
	 renamed subtree's own methods from the external reference scan). Cached."
	subtreeClasses isNil ifTrue: [
		subtreeClasses := IdentitySet new.
		subtreeClasses add: definingClass.
		subtreeClasses addAll: (environment descendantsOf: definingClass)].
	^subtreeClasses
]

{ #category : 'private' }
GsRenameClassRefactoring >> baseClassOf: aMethod [
	"The non-meta class of aMethod's defining class. GemStone's Metaclass answers its
	 instance class via #thisClass (NOT the Pharo-ism #instanceClass)."
	| cls |
	cls := aMethod inClass.
	^cls isMeta ifTrue: [cls thisClass] ifFalse: [cls]
]

{ #category : 'testing' }
GsRenameClassRefactoring >> isClassInScope: aClass [
	scopeKind == #wholeSystem ifTrue: [^true].
	scopeKind == #class ifTrue: [^aClass == definingClass].
	scopeKind == #hierarchy ifTrue: [^self hierarchyScopeClasses includes: aClass].
	scopeKind == #dictionary ifTrue: [
		"Identity, not name: a same-named class shadowed in ANOTHER dictionary is
		 out of scope (matching by name alone duplicated it -- see
		 GsRefactoringEnvironment>>class:isDefinedInDictionaryNamed:)."
		^environment class: aClass isDefinedInDictionaryNamed: scopeDictName].
	^false
]

{ #category : 'private' }
GsRenameClassRefactoring >> hierarchyScopeClasses [
	"definingClass's hierarchy (itself, subclasses, superclasses), computed once."
	scopeClasses isNil ifTrue: [
		scopeClasses := IdentitySet new.
		scopeClasses add: definingClass.
		scopeClasses addAll: definingClass allSubclasses.
		scopeClasses addAll: definingClass allSuperclasses].
	^scopeClasses
]

{ #category : 'private' }
GsRenameClassRefactoring >> dictNameForClass: aClass [
	"The name of the first dictionary that defines aClass, as a String, or nil."
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
]

{ #category : 'source rewriting' }
GsRenameClassRefactoring >> renameClassNameIn: defString from: oldStr to: newStr [
	"Return defString with the class-name literal renamed. A class definition names
	 the new class as the FIRST string literal after the `subclass:`-family keyword,
	 e.g. `Object subclass: 'Old' instVarNames: ...`. Rewrites only that quoted name,
	 so an instVar/classVar or a pool sharing the spelling is untouched."
	| marker mstart qStart qEnd |
	marker := 'subclass: '''.
	mstart := defString indexOfSubCollection: marker.
	mstart = 0 ifTrue: [^defString].
	qStart := mstart + marker size.        "first char of the quoted name"
	qEnd := defString indexOf: $' startingAt: qStart.
	qEnd = 0 ifTrue: [^defString].
	((defString copyFrom: qStart to: qEnd - 1) = oldStr)
		ifFalse: [^defString].
	^(defString copyFrom: 1 to: qStart - 1), newStr, (defString copyFrom: qEnd to: defString size)
]

{ #category : 'source rewriting' }
GsRenameClassRefactoring >> renameSuperclassNameIn: defString from: oldStr to: newStr [
	"Return a direct child's definition with its SUPERCLASS name rewritten. The
	 superclass is the receiver at the very start of the definition, e.g.
	 `Old subclass: 'Child' ...`. Rewrites only that leading identifier token."
	| start tokenEnd |
	start := 1.
	[start <= defString size and: [(defString at: start) isSeparator]] whileTrue: [start := start + 1].
	tokenEnd := start + oldStr size - 1.
	tokenEnd >= defString size ifTrue: [^defString].
	((defString copyFrom: start to: tokenEnd) = oldStr) ifFalse: [^defString].
	(defString at: tokenEnd + 1) isSeparator ifFalse: [^defString].
	^(defString copyFrom: 1 to: start - 1), newStr, (defString copyFrom: tokenEnd + 1 to: defString size)
]

{ #category : 'source rewriting' }
GsRenameClassRefactoring >> rewriteReferencesInSource: aString [
	"Parse aString, rewrite the non-shadowed references to the old class name to the
	 new name (minimal diff), and return the regenerated source -- or nil if nothing
	 was rewritten (so the caller stages/compiles nothing spurious)."
	| tree count |
	tree := RBParser parseMethod: aString.
	count := self rewriteRefsIn: tree shadowed: false.
	count = 0 ifTrue: [^nil].
	^tree newSource
]

{ #category : 'source rewriting' }
GsRenameClassRefactoring >> rewriteRefsIn: aNode shadowed: shadowed [
	"Recursively rewrite references to the old class name at and under aNode, returning
	 how many were rewritten. A reference is renamed minimal-diff: register an
	 RBStringReplacement for its source span AND mutate its token (so the reparsed
	 source matches the mutated AST and newSource takes the splice path). shadowed is
	 true when a same-named argument or temporary captured the name in an enclosing
	 scope -- extremely rare for a capitalised class name, but handled for safety, the
	 same way rename-instVar does."
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
GsRenameClassRefactoring >> node: aNode declaresName: aSymbol [
	"Does aNode introduce a scope binding (argument or temporary) for aSymbol?"
	(aNode isMethod or: [aNode isBlock])
		ifTrue: [^(aNode arguments
			detect: [:a | a name asSymbol == aSymbol] ifNone: [nil]) notNil].
	aNode isSequence
		ifTrue: [^(aNode temporaries
			detect: [:t | t name asSymbol == aSymbol] ifNone: [nil]) notNil].
	^false
]

{ #category : 'preconditions' }
GsRenameClassRefactoring >> newNameCollision [
	"nil if the new name is free to use, otherwise a short reason string: the new name
	 is already bound to some OTHER global anywhere on the symbol list. Building the
	 change set does not enforce this (the preview surfaces it); the apply would fail."
	| existing |
	existing := environment symbolList objectNamed: newName asSymbol.
	existing isNil ifTrue: [^nil].
	existing == definingClass ifTrue: [^nil].
	^'the name ', newName, ' is already in use'
]

{ #category : 'accessing' }
GsRenameClassRefactoring >> outOfScopeReferenceCount [
	self changeSet.
	^outOfScopeReferenceCount
]

{ #category : 'serializing' }
GsRenameClassRefactoring >> outOfScopeJsonString [
	"The out-of-scope / precondition / skipped warning payload for the preview."
	self changeSet.
	^'{"references":', outOfScopeReferenceCount printString,
	  ',"skipped":', skippedCount printString,
	  ',"descendants":', (environment descendantsOf: definingClass) size printString,
	  ',"collision":', (self newNameCollision
		ifNil: ['null']
		ifNotNil: [:reason | self jsonQuote: reason]), '}'
]

{ #category : 'private' }
GsRenameClassRefactoring >> recordSkipped: aMethod [
	skippedMethods add: (Array
		with: aMethod inClass name asString
		with: aMethod selector asString)
]

{ #category : 'serializing' }
GsRenameClassRefactoring >> skippedMethodsJsonString [
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
GsRenameClassRefactoring >> previewJsonString [
	^self changeSet jsonString
]

{ #category : 'paginated preview' }
GsRenameClassRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
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
GsRenameClassRefactoring >> startPreviewToken: token maxBytes: maxBytes [
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
GsRenameClassRefactoring >> applyDeselected: deselectedIds [
	"Apply the staged changes in the stone. The #classRename and every #classReparent
	 are ALWAYS applied (structural -- skipping one would orphan a subclass or dangle
	 the name); a deselection is honoured only for the optional #methodRecompile
	 reference rewrites. Then, per the options: migrate every instance of each
	 superseded version to its new version, prune the superseded versions from the
	 class history, and -- because migration must be durable -- COMMIT if either of
	 those persistent options was requested -- but ONLY if every staged change applied
	 cleanly, so a partly-failed rename is left uncommitted for the user to inspect and
	 abort rather than persisted half-done. With neither option (the safe path) nothing
	 is committed, matching the other refactorings. Answers
	 {applied, failed:[..], committed, migratedFailures}."
	| ids applied failures migrated committed |
	ids := (deselectedIds collect: [:e | e asSymbol]) asIdentitySet.
	oldToNew := IdentityDictionary new.
	applied := 0.
	failures := OrderedCollection new.
	"The copy-forward loop runs deep inside a per-class change and must not raise (one
	 method that will not recompile would abort the whole change), so it reports through
	 this alias instead -- entries land in the same `failed` list as everything else."
	copyFailures := failures.
	self changeSet changes do: [:change |
		(change kind == #methodRecompile and: [ids includes: change id asSymbol])
			ifFalse: [
				[self applyChange: change. applied := applied + 1]
				on: Error do: [:e |
					failures add: (Array with: change id with: change failureLabel with: e messageText)]]].
	migrated := 0.
	committed := false.
	((migrateInstances or: [removeOldFromHistory]) and: [failures isEmpty]) ifTrue: [
		"Commit the structural rename FIRST so the new class versions are persistent:
		 migrating already-committed instances to a version created in this same
		 uncommitted transaction is a no-op. Then migrate/prune and commit again. Only
		 reached when the structural apply had zero failures, so we never commit a
		 half-applied rename."
		[System commitTransaction. committed := true] on: Error do: [:e |
			failures add: (Array with: 'commit' with: newName with: e messageText)].
		committed ifTrue: [
			migrateInstances ifTrue: [migrated := self migrateAllInstances].
			removeOldFromHistory ifTrue: [self pruneSupersededVersions].
			[System commitTransaction] on: Error do: [:e |
				failures add: (Array with: 'commit' with: newName with: e messageText)]]].
	^'{"applied":', applied printString,
	  ',"committed":', committed printString,
	  ',"migratedFailures":', migrated printString,
	  ',"failed":[',
	  ((failures collect: [:f |
		'{"id":', (self jsonQuote: (f at: 1)),
		',"label":', (self jsonQuote: (f at: 2)),
		',"error":', (self jsonQuote: (f at: 3)), '}'])
			inject: '' into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ',', s]]),
	  ']}'
]

{ #category : 'applying' }
GsRenameClassRefactoring >> migrateAllInstances [
	"Migrate every instance of each superseded version (the keys of oldToNew: the
	 target and each re-parented descendant) to its new version. Answers the total
	 number of instances that FAILED to migrate (no read/write permission, index
	 incompatibility, etc. -- migrateInstancesTo: answers five sets; set 1 is empty,
	 sets 2..5 are failures). A migrateInstancesTo: that RAISES (rather than reporting
	 failure sets) is counted as at least one failure so an errored migration is never
	 reported as a clean success. Does not commit -- the caller commits."
	| failed |
	failed := 0.
	oldToNew keysAndValuesDo: [:old :new |
		[| report |
		 report := old migrateInstancesTo: new.
		 2 to: report size do: [:i | failed := failed + (report at: i) size]]
		on: Error do: [:e | failed := failed + 1]].
	^failed
]

{ #category : 'applying' }
GsRenameClassRefactoring >> pruneSupersededVersions [
	"Remove the superseded versions from each reversioned class's history, leaving
	 only the current (new) version. Guards on identity so the new version is never
	 removed. Does not commit -- the caller commits."
	oldToNew valuesDo: [:new | | hist |
		hist := new classHistory.
		hist asArray do: [:v | v == new ifFalse: [hist removeVersion: v]]]
]

{ #category : 'applying' }
GsRenameClassRefactoring >> applyChange: aChange [
	aChange kind == #classRename ifTrue: [^self applyClassRename: aChange].
	aChange kind == #classReparent ifTrue: [^self applyClassReparent: aChange].
	aChange kind == #methodRecompile ifTrue: [^self applyMethodRecompile: aChange].
	^self error: 'Unexpected change kind for rename-class: ', aChange kind printString
]

{ #category : 'applying' }
GsRenameClassRefactoring >> applyClassRename: aChange [
	"Create the new version under the new name (newVersionOf: the current class),
	 shaped like the shape source (the current class for a rename, a historical
	 version for a restore) and carrying that source's methods (rewriting old-name
	 references). Record the old->new mapping for the descendant reparents, then, if
	 the name actually changed, remove the old name binding."
	| old src new |
	old := environment classNamed: aChange className.
	old isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	src := self shapeSourceOr: old.
	new := self
		makeNewVersionOf: old
		shapedLike: src
		named: aChange newName
		superclass: (self superclassForShapeSource: src of: old).
	copyMethods ifTrue: [self copyMethodsFrom: src to: new].
	oldToNew at: old put: new.
	aChange className asString = aChange newName asString
		ifFalse: [self removeBinding: aChange className ifValueIs: old]
]

{ #category : 'applying' }
GsRenameClassRefactoring >> applyClassReparent: aChange [
	"Recompile one descendant newVersionOf: its current version, re-parented under the
	 freshly created parent-chain version, and copy its methods forward (rewriting any
	 old-name reference). Its name is unchanged, so the primitive rebinds it in place."
	| old parentNew new |
	old := environment classNamed: aChange className.
	old isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	parentNew := oldToNew at: old superclass ifAbsent: [old superclass].
	new := self makeNewVersionOf: old shapedLike: old named: old name asString superclass: parentNew.
	copyMethods ifTrue: [self copyMethodsFrom: old to: new].
	oldToNew at: old put: new
]

{ #category : 'applying' }
GsRenameClassRefactoring >> applyMethodRecompile: aChange [
	"Recompile one external referencing method with its rewritten (new-name) source."
	| cls target |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	"Through the environment, which RAISES on a compile failure -- an unchecked send would
	 leave this referencing method naming the OLD class while reporting clean success."
	environment
		compile: aChange newSource
		into: target
		category: (aChange category ifNil: ['as yet unclassified'])
]

{ #category : 'applying' }
GsRenameClassRefactoring >> makeNewVersionOf: old shapedLike: shape named: aName superclass: sup [
	"Create a new version in `old`'s class history, named aName, under superclass sup,
	 with the shape (own instVars, classVars, class-instVars, pools, comment) of
	 `shape`. `shape` is `old` itself for an ordinary rename or reparent, and a
	 historical version for a restore.

	 Uses the FORMAT-taking creation primitive and passes `shape format` explicitly,
	 rather than the plain newVersionOf: form which takes format from the superclass.
	 That is what preserves the class's OWN format bits -- byte vs pointer vs NSC vs
	 indexable AND options encoded in the format such as instancesInvariant -- which the
	 superclass-derived form silently drops (e.g. an invariant class would become
	 mutable). Threading `inClassHistory: old classHistory` keeps it a version of the
	 same class, so class-variable and class-instance-variable VALUES (shared across a
	 class history) and the class category carry forward automatically."
	^sup
		_subclass: aName
		instVarNames: (shape instVarNames collect: [:e | e asString])
		format: shape format
		classVars: (shape classVarNames collect: [:e | e asString])
		classInstVars: (shape class instVarNames collect: [:e | e asString])
		poolDictionaries: shape sharedPools
		inDictionary: (self dictObjectFor: old)
		inClassHistory: old classHistory
		description: ([shape commentForFileout] on: Error do: [:e | ''])
		options: #()
]

{ #category : 'applying' }
GsRenameClassRefactoring >> copyMethodsFrom: old to: new [
	"Copy every method of `old` (both sides) onto `new`, rewriting old-name references
	 to the new name. A new class version starts with an empty method dictionary, so
	 this is what carries the behaviour forward."
	old selectors do: [:sel | self copyMethod: sel from: old to: new meta: false].
	old class selectors do: [:sel | self copyMethod: sel from: old class to: new class meta: true]
]

{ #category : 'applying' }
GsRenameClassRefactoring >> copyMethod: sel from: srcCls to: dstCls meta: isMeta [
	"Carry one method onto the new class version, rewriting old-name references. A method
	 that will not recompile is recorded in copyFailures rather than dropped in silence --
	 the new version starts with an empty method dictionary, so a dropped method is simply
	 gone from it. Answers whether it compiled."
	| m src newSrc |
	m := srcCls compiledMethodAt: sel environmentId: 0 otherwise: nil.
	m isNil ifTrue: [^true].
	src := m sourceString.
	newSrc := self rewriteReferencesInSource: src.
	^environment
		copyMethod: sel
		from: srcCls
		to: dstCls
		source: (newSrc ifNil: [src])
		meta: isMeta
		into: copyFailures
]

{ #category : 'applying' }
GsRenameClassRefactoring >> dictObjectFor: aClass [
	"The actual SymbolDictionary object that defines aClass's name, for inDictionary:.
	 Falls back to the user's default (UserGlobals) if none is found (should not happen
	 for a bound class)."
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty
		ifTrue: [environment symbolList objectNamed: #UserGlobals]
		ifFalse: [dicts first]
]

{ #category : 'applying' }
GsRenameClassRefactoring >> removeBinding: aName ifValueIs: aClass [
	"Remove aName from every dictionary that currently binds it to aClass. Guards on
	 identity so an unrelated global that happens to share the spelling is left alone."
	| sym |
	sym := aName asSymbol.
	environment dictionariesDo: [:dict |
		((dict at: sym ifAbsent: [nil]) == aClass)
			ifTrue: [dict removeKey: sym ifAbsent: []]]
]

{ #category : 'paginated preview' }
GsRenameClassRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'applying' }
GsRenameClassRefactoring class >> applyForToken: token deselected: deselectedIds [
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'paginated preview' }
GsRenameClassRefactoring class >> clearToken: token [
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'serializing' }
GsRenameClassRefactoring >> hex2: anInteger [
	^GsRefactoringJson hex2: anInteger
]

{ #category : 'serializing' }
GsRenameClassRefactoring >> jsonEscape: aString [
	^GsRefactoringJson jsonEscape: aString
]

{ #category : 'serializing' }
GsRenameClassRefactoring >> jsonQuote: aString [
	^GsRefactoringJson jsonQuote: aString
]
