"
Add or remove an INSTANCE VARIABLE on a class (catalog item V1), without committing -- except for
the two explicitly opt-in, explicitly committing steps below.

GemStone has no addInstVarName:/removeInstVarName:, so changing a class's own instance-variable
list means creating a NEW class VERSION (exactly as a class rename, R3, does): a new version
starts with an empty method dictionary and does NOT re-parent existing subclasses. So the apply
must, for every affected class top-down, create a new version in the same class history with the
edited own-instVar list and its preserved class options, COPY its methods forward,
and re-parent it under the freshly created parent version. This reuses R3's newVersionOf: machinery.

Two operations (instVar `operation`):

  - #add    -- append varName to definingClass's own instance-variable list.
  - #remove -- drop varName from definingClass's own instance-variable list.

Affected set = definingClass's subtree (the class + all descendants), toposorted so a superclass is
always versioned before its subclasses. Each affected class becomes a new version: an edited class
(#classDefinitionEdit, shown as a definition diff) when its own-ivar list changes, else a
re-parented class (#classReparent, recompiled only to re-point at the new parent chain).

Two things the family did not surface before, both required here:

  - CLASS OPTIONS. Every new version preserves its own class's options (`_optionsArray`); the
    earlier engines passed options: #() and silently dropped them. optionsForApply: answers the
    option list a given class's new version is built with. (The panel does not surface options
    for editing; editedOptions is plumbing for a future options editor and is left nil.)

  - METHODS THAT WILL NOT RECOMPILE. A method that references a removed instance variable no
    longer resolves the name; GemStone will not compile a reference to an undeclared lowercase
    identifier, so such a method fails to compile and is silently DROPPED from the new version. The
    set is predicted (without compiling) from bytecode-level instance-variable access, surfaced in
    the preview as willNotRecompile, and reported (dropped) after apply.

IMPORTANT commit semantics (surfaced in the preview):
  - The structural change (new versions + method copy-forward + reparents) NEVER commits on its own.
  - MIGRATE INSTANCES and DELETE HISTORY are opt-in and DO commit: migrateInstancesTo: requires a
    clean transaction, so the apply commits the structural change first, then migrates and commits,
    then (if asked) deletes prior versions and commits. Nothing else in the family commits.

The refactoring is all-or-nothing (like rename-class-variable): the class-shape edits and the
descendant reparents must all apply together, so the client offers no per-change deselection and
applyDeselected: ignores any deselection.
"
Class {
	#name : 'GsInstVarRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'operation',
		'definingClass',
		'varName',
		'newIvarLists',
		'affected',
		'willNotRecompile',
		'editedOptions',
		'changeSet',
		'analysisDone',
		'decline',
		'oldToNew',
		'dropped',
		'committed',
		'rolledBack'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsInstVarRefactoring class >> class: aClass addInstVar: aName [
	"V1 add: append the instance variable aName to aClass's own definition."
	^self new
		setEnvironment: GsRefactoringEnvironment new
		operation: #add
		class: aClass
		varName: aName
]

{ #category : 'instance creation' }
GsInstVarRefactoring class >> class: aClass removeInstVar: aName [
	"V1 remove: drop the instance variable aName from aClass's own definition."
	^self new
		setEnvironment: GsRefactoringEnvironment new
		operation: #remove
		class: aClass
		varName: aName
]

{ #category : 'preconditions' }
GsInstVarRefactoring class >> analyzeClass: aClass addInstVar: aName [
	^(self class: aClass addInstVar: aName) analysisJsonString
]

{ #category : 'preconditions' }
GsInstVarRefactoring class >> analyzeClass: aClass removeInstVar: aName [
	^(self class: aClass removeInstVar: aName) analysisJsonString
]

{ #category : 'paginated preview' }
GsInstVarRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'paginated preview' }
GsInstVarRefactoring class >> applyForToken: token deselected: deselectedIds options: optsArray migrate: aBool deleteHistory: dBool [
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"dropped":[],"committed":false,"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds options: optsArray migrate: aBool deleteHistory: dBool]
]

{ #category : 'paginated preview' }
GsInstVarRefactoring class >> clearToken: token [
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'private' }
GsInstVarRefactoring >> setEnvironment: anEnvironment operation: anOp class: aClass varName: aName [
	environment := anEnvironment.
	operation := anOp.
	definingClass := aClass.
	varName := aName asString.
	analysisDone := false
]

{ #category : 'accessing' }
GsInstVarRefactoring >> environment [
	^environment
]

{ #category : 'accessing' }
GsInstVarRefactoring >> operation [
	^operation
]

{ #category : 'accessing' }
GsInstVarRefactoring >> varName [
	^varName
]

{ #category : 'private' }
GsInstVarRefactoring >> ownInstVarsOf: aClass [
	"aClass's OWN instance-variable names (not inherited), as an Array of Strings."
	^aClass instVarNames collect: [:e | e asString]
]

{ #category : 'private' }
GsInstVarRefactoring >> allInstVarsOf: aClass [
	^aClass allInstVarNames collect: [:e | e asString]
]

{ #category : 'private' }
GsInstVarRefactoring >> optionsOf: aClass [
	"aClass's own class-creation options, as an Array of Strings (e.g. #('selfCanBeSpecial'))."
	^(aClass _optionsArray ifNil: [#()]) collect: [:e | e asString]
]

{ #category : 'private' }
GsInstVarRefactoring >> allClassVarsOf: aClass [
	"aClass's own and inherited class-variable names, as a Set of Strings. Used to decline an
	 #add whose name would shadow a class variable inside method bodies."
	| result cls |
	result := Set new.
	cls := aClass.
	[cls isNil] whileFalse: [
		(cls classVarNames ifNil: [#()]) do: [:n | result add: n asString].
		cls := cls superclass].
	^result
]

{ #category : 'private' }
GsInstVarRefactoring >> isValidIvarName: aString [
	"A syntactically valid Smalltalk instance-variable name: a LOWERCASE letter or an underscore,
	 followed by letters, digits, or underscores.

	 The first character must not be uppercase. A capitalised identifier in a method body reads as a
	 global (or a class/class-variable name), so an uppercase instance variable is confusing and
	 shadow-prone -- `Tally` used to pass. The client's fast-fail regex in instVarRefactorCommand.ts
	 enforces the same rule; this predicate is the authority."
	| first |
	aString isEmpty ifTrue: [^false].
	first := aString at: 1.
	((first isLetter and: [first isLowercase]) or: [first == $_]) ifFalse: [^false].
	^aString allSatisfy: [:ch | ch isLetter or: [ch isDigit or: [ch == $_]]]
]

{ #category : 'private - analysis' }
GsInstVarRefactoring >> ensureAnalysis [
	analysisDone ifFalse: [
		analysisDone := true.
		[self computeAnalysis] on: Error do: [:e |
			decline := 'The change could not be analysed: ', e messageText]]
]

{ #category : 'private - analysis' }
GsInstVarRefactoring >> computeAnalysis [
	"Set decline (nil when viable), newIvarLists (className -> new own-ivar Array for each edited
	 class), affected (classes to version, top-down), and willNotRecompile (className -> selectors
	 of methods that will lose the variable). Dispatches on the operation."
	decline := nil.
	newIvarLists := Dictionary new.
	willNotRecompile := OrderedCollection new.
	operation == #add ifTrue: [^self analyzeAdd].
	operation == #remove ifTrue: [^self analyzeRemove].
	decline := 'Unknown operation: ', operation printString
]

{ #category : 'private - analysis' }
GsInstVarRefactoring >> analyzeAdd [
	"V1 add: varName must be a valid identifier not already visible as an instance variable of
	 definingClass, and not shadowing a class variable in the hierarchy."
	(self isValidIvarName: varName) ifFalse: [
		^decline := 'Cannot add ', varName printString, ': an instance-variable name must start with a lowercase letter or an underscore, followed by letters, digits, or underscores.'].
	((self allInstVarsOf: definingClass) includes: varName) ifTrue: [
		^decline := 'Cannot add ', varName, ': ', definingClass name asString, ' already has an instance variable of that name.'].
	((self allClassVarsOf: definingClass) includes: varName) ifTrue: [
		^decline := 'Cannot add ', varName, ': a class variable of that name is visible to ', definingClass name asString, ', which it would shadow.'].
	newIvarLists at: definingClass name asString put: ((self ownInstVarsOf: definingClass) copyWith: varName).
	self computeAffectedFrom: (Array with: definingClass).
	self recordWillNotRecompileShadowedBy: definingClass
]

{ #category : 'private - analysis' }
GsInstVarRefactoring >> analyzeRemove [
	"V1 remove: varName must be an OWN instance variable of definingClass. Every method (defining
	 class and descendants) that accesses it will lose it -- those are the willNotRecompile set."
	((self ownInstVarsOf: definingClass) includes: varName) ifFalse: [
		^decline := 'Cannot remove ', varName, ': it is not an instance variable declared in ', definingClass name asString, '.'].
	newIvarLists at: definingClass name asString put: ((self ownInstVarsOf: definingClass) reject: [:n | n = varName]).
	self computeAffectedFrom: (Array with: definingClass).
	self recordWillNotRecompileLosing: definingClass
]

{ #category : 'private - analysis' }
GsInstVarRefactoring >> computeAffectedFrom: rootClasses [
	"affected = the union of each root's subtree (root + all descendants), toposorted so a
	 superclass is always ordered before any of its subclasses (the apply versions parents first
	 so each child re-points at the freshly created parent version)."
	| set |
	set := IdentitySet new.
	rootClasses do: [:root |
		set add: root.
		(environment descendantsOf: root) do: [:d | set add: d]].
	affected := self orderTopDown: set
]

{ #category : 'private - analysis' }
GsInstVarRefactoring >> orderTopDown: anIdentitySet [
	"anIdentitySet ordered so every class follows its superclass (when that superclass is in the
	 set). A simple stable topological sort by the superclass relation."
	| remaining ordered |
	remaining := IdentitySet withAll: anIdentitySet.
	ordered := OrderedCollection new.
	[remaining isEmpty] whileFalse: [
		| ready |
		ready := (remaining reject: [:cls | remaining includes: cls superclass]) asArray
			asSortedCollection: [:a :b | a name asString <= b name asString].
		ready isEmpty ifTrue: [
			"defensive: a cycle cannot occur in a class hierarchy; take the rest as-is."
			ordered addAll: remaining. ^ordered].
		ready do: [:cls | ordered add: cls. remaining remove: cls]].
	^ordered
]

{ #category : 'private - analysis' }
GsInstVarRefactoring >> recordWillNotRecompileLosing: aScopeClass [
	"Record class -> sorted selectors of the instance methods that access varName in aScopeClass's
	 hierarchy; after the remove none of them will still see the variable."
	| accessors |
	accessors := environment classesAndSelectorsAccessing: varName inHierarchyOf: aScopeClass.
	accessors do: [:assoc | willNotRecompile add: assoc]
]

{ #category : 'private - analysis' }
GsInstVarRefactoring >> recordWillNotRecompileShadowedBy: aScopeClass [
	"Record class -> sorted selectors of the instance methods in aScopeClass's hierarchy that already
	 declare a method-level TEMPORARY or an ARGUMENT named varName. Once the new instance variable
	 becomes visible to the subtree, GemStone refuses that shadowing declaration, so those methods do
	 not recompile onto the new class version and are dropped -- exactly like the methods that lose a
	 removed variable. Predicting them here is what stops the preview claiming '0 will not recompile'
	 and then silently dropping them."
	| shadowers |
	shadowers := environment classesAndSelectorsShadowing: varName inHierarchyOf: aScopeClass.
	shadowers do: [:assoc | willNotRecompile add: assoc]
]

{ #category : 'private' }
GsInstVarRefactoring >> actedOnClassName [
	"The class the user acted on (identifies the acted-on class to the panel)."
	^definingClass name asString
]

{ #category : 'private' }
GsInstVarRefactoring >> isEditedClassNamed: aName [
	^newIvarLists includesKey: aName
]

{ #category : 'private' }
GsInstVarRefactoring >> dictNameForClass: aClass [
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
]

{ #category : 'preconditions' }
GsInstVarRefactoring >> decline [
	self ensureAnalysis.
	^decline
]

{ #category : 'building' }
GsInstVarRefactoring >> changeSet [
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'building' }
GsInstVarRefactoring >> buildChangeSet [
	"Stage, top-down, a #classDefinitionEdit for each edited class and a #classReparent for every
	 other affected class. Compiles nothing, commits nothing."
	| cs |
	cs := GsRefactoringChangeSet new.
	self ensureAnalysis.
	decline notNil ifTrue: [^cs].
	affected do: [:cls | self stageClassChange: cls into: cs].
	^cs
]

{ #category : 'building' }
GsInstVarRefactoring >> stageClassChange: aClass into: cs [
	| dn oldDef |
	dn := self dictNameForClass: aClass.
	oldDef := aClass definition.
	(self isEditedClassNamed: aClass name asString)
		ifTrue: [cs
			addClassDefinitionEditInDictionary: dn
			className: aClass name asString
			oldSource: oldDef
			newSource: (self previewDefinitionFor: aClass oldDef: oldDef)]
		ifFalse: [cs
			addClassReparentInDictionary: dn
			className: aClass name asString
			oldSource: oldDef
			newSource: oldDef]
]

{ #category : 'building' }
GsInstVarRefactoring >> previewDefinitionFor: aClass oldDef: defString [
	"The before/after 'after' text for an edited class: its definition with the instVarNames: list
	 replaced by the class's new own-ivar list. Class options are preserved onto the new version but
	 are not surfaced for editing in the panel."
	^self replaceListClause: 'instVarNames:'
		in: defString
		with: (newIvarLists at: aClass name asString ifAbsent: [self ownInstVarsOf: aClass])
]

{ #category : 'building' }
GsInstVarRefactoring >> replaceListClause: marker in: defString with: aList [
	"defString with the parenthesised list after marker replaced by aList (each element quoted).
	 Used for the preview definition diff only."
	| start openParen closeParen ws |
	start := defString indexOfSubCollection: marker.
	start = 0 ifTrue: [^defString].
	openParen := defString indexOf: $( startingAt: start.
	openParen = 0 ifTrue: [^defString].
	closeParen := defString indexOf: $) startingAt: openParen.
	closeParen = 0 ifTrue: [^defString].
	ws := WriteStream on: String new.
	ws nextPutAll: (defString copyFrom: 1 to: openParen).
	aList keysAndValuesDo: [:i :n |
		i = 1 ifFalse: [ws nextPut: $ ].
		ws nextPutAll: ''''; nextPutAll: n asString; nextPutAll: ''''].
	ws nextPutAll: (defString copyFrom: closeParen to: defString size).
	^ws contents
]

{ #category : 'serializing' }
GsInstVarRefactoring >> analysisJsonString [
	"The pre-flight payload: the decline reason (nil when viable), the source class, the number of
	 classes that will be recompiled, and how many methods will not recompile."
	self ensureAnalysis.
	^'{"decline":', (decline ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  ',"operation":', (self jsonQuote: operation asString),
	  ',"sourceClass":', (self jsonQuote: definingClass name asString),
	  ',"affectedCount":', (decline notNil ifTrue: ['0'] ifFalse: [affected size printString]),
	  ',"willNotRecompileCount":', (decline notNil ifTrue: ['0'] ifFalse: [(self willNotRecompileSelectorCount) printString]),
	  '}'
]

{ #category : 'serializing' }
GsInstVarRefactoring >> willNotRecompileSelectorCount [
	self ensureAnalysis.
	^willNotRecompile inject: 0 into: [:acc :assoc | acc + assoc value size]
]

{ #category : 'serializing' }
GsInstVarRefactoring >> previewJsonString [
	^self changeSet jsonString
]

{ #category : 'serializing' }
GsInstVarRefactoring >> willNotRecompileJsonString [
	"[{class,selector}] for every method that will not recompile after the change."
	| ws first |
	self ensureAnalysis.
	ws := WriteStream on: String new.
	ws nextPut: $[.
	first := true.
	willNotRecompile do: [:assoc |
		assoc value do: [:sel |
			first ifFalse: [ws nextPut: $,].
			first := false.
			ws nextPutAll: '{"class":'; nextPutAll: (self jsonQuote: assoc key name asString);
			   nextPutAll: ',"selector":'; nextPutAll: (self jsonQuote: sel asString);
			   nextPut: $}]].
	ws nextPut: $].
	^ws contents
]

{ #category : 'serializing' }
GsInstVarRefactoring >> outOfScopeJsonString [
	"The precondition / warning payload for the preview panel, in the family's shape. A hard
	 decline (which blocks Apply) rides in `decline`; willNotRecompile lists the methods that will
	 be dropped; note warns about the commit semantics of migrate/delete-history.

	 sessionHasUncommittedChanges reports `System needsCommit` as the preview is built. The
	 committing options (migrate instances / delete history) call `System commitTransaction`, which
	 commits the WHOLE session transaction -- not just the change we staged -- so when this is true
	 the client warns that the user's other uncommitted work will be committed along with it."
	self ensureAnalysis.
	^'{"references":0,"skipped":0,"scope":"hierarchy","collision":null,"decline":',
	  (decline ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  ',"willNotRecompile":', self willNotRecompileJsonString,
	  ',"actedOnClass":', (self jsonQuote: self actedOnClassName),
	  ',"sessionHasUncommittedChanges":', (System needsCommit ifTrue: ['true'] ifFalse: ['false']),
	  ',"note":', (self jsonQuote: 'The structural change does not commit. Migrating instances and deleting history DO commit the transaction; nothing else does.'),
	  '}'
]

{ #category : 'serializing' }
GsInstVarRefactoring >> startPreviewToken: token maxBytes: maxBytes [
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"sourceClass":', (self jsonQuote: definingClass name asString),
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'paginated preview' }
GsInstVarRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
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
GsInstVarRefactoring >> applyDeselected: deselectedIds options: optsArray migrate: aBool deleteHistory: dBool [
	"Apply EVERY staged change in the stone. An instance-variable add/remove is ALL-OR-NOTHING
	 (the class-shape edits and the descendant reparents must move together), so a deselection is
	 ignored. optsArray (nil or an Array of Strings) replaces the acted-on class's options; nil
	 keeps them. If migrate or deleteHistory is true the structural change is COMMITTED first (the
	 substrate requires a clean transaction to migrate), then the committing step(s) run and commit.
	 Answers {applied, failed:[..], dropped:[..], committed:bool}."
	| applied failures changes index hadPriorWork |
	self ensureAnalysis.
	"nil optsArray keeps the acted-on class's current options; an Array (even empty) sets them."
	editedOptions := optsArray isNil ifTrue: [nil] ifFalse: [optsArray collect: [:e | e asString]].
	oldToNew := IdentityDictionary new.
	dropped := OrderedCollection new.
	committed := false.
	rolledBack := false.
	failures := OrderedCollection new.
	applied := 0.
	"Whether the SESSION already had uncommitted work before we staged anything -- decides whether a
	 rollback may abort (see #rollbackPartialApply)."
	hadPriorWork := System needsCommit.
	"STOP at the first failure. The change set is all-or-nothing and each class is re-parented onto
	 the new version of its parent, so carrying on past a failure would version later classes onto a
	 stale oldToNew entry and leave a half-reshaped subtree behind."
	changes := self changeSet changes.
	index := 1.
	[failures isEmpty and: [index <= changes size]] whileTrue: [
		| change |
		change := changes at: index.
		[self applyChange: change. applied := applied + 1]
			on: Error do: [:e |
				failures add: (Array with: change id with: change className with: e messageText)].
		index := index + 1].
	failures isEmpty
		ifTrue: [
			(aBool or: [dBool]) ifTrue: [
				self commitStructuralThenMigrate: aBool deleteHistory: dBool on: failures]]
		ifFalse: [
			"Nothing has been committed at this point, so the partial work can be discarded whole."
			(self rollbackPartialApplyHadPriorWork: hadPriorWork) ifTrue: [applied := 0]].
	^'{"applied":', applied printString,
	  ',"failed":[',
	  ((failures collect: [:f |
		'{"id":', (self jsonQuote: (f at: 1) asString),
		',"label":', (self jsonQuote: (f at: 2) asString),
		',"error":', (self jsonQuote: (f at: 3) asString), '}'])
			inject: '' into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ',', s]]),
	  '],"dropped":[',
	  ((dropped collect: [:d |
		'{"class":', (self jsonQuote: (d at: 1) asString),
		',"selector":', (self jsonQuote: (d at: 2) asString), '}'])
			inject: '' into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ',', s]]),
	  '],"committed":', (committed ifTrue: ['true'] ifFalse: ['false']),
	  ',"rolledBack":', (rolledBack ifTrue: ['true'] ifFalse: ['false']), '}'
]

{ #category : 'applying' }
GsInstVarRefactoring >> rollbackPartialApplyHadPriorWork: hadPriorWork [
	"A change failed part-way through an ALL-OR-NOTHING apply. The versions created before the
	 failure are staged in the transaction and uncommitted, so aborting discards them and leaves the
	 hierarchy exactly as it was -- which is what the user is promised.

	 The one case where we must NOT abort: the session already had uncommitted work of its own when
	 the apply started. `System abortTransaction` rolls back the WHOLE session transaction, so
	 aborting would throw that work away too. There we leave the transaction alone and report
	 rolledBack:false, so the client can tell the user their transaction now holds a partial change
	 and they must abort it themselves.

	 Answers whether the abort happened."
	hadPriorWork ifTrue: [^rolledBack := false].
	System abortTransaction.
	^rolledBack := true
]

{ #category : 'applying' }
GsInstVarRefactoring >> commitStructuralThenMigrate: aBool deleteHistory: dBool on: failures [
	"With the structural change applied in the transaction, commit it (migrateInstancesTo: needs a
	 clean transaction), then -- if asked -- migrate instances of each old version to its new one
	 and commit, and delete every prior version from each versioned class's history and commit."
	[System commitTransaction.
	 committed := true.
	 aBool ifTrue: [
		oldToNew keysAndValuesDo: [:old :new | old migrateInstancesTo: new].
		System commitTransaction].
	 dBool ifTrue: [
		oldToNew valuesDo: [:new | self deletePriorVersionsOf: new].
		System commitTransaction]]
	on: Error do: [:e |
		failures add: (Array with: 'commit' with: 'commit' with: e messageText)]
]

{ #category : 'applying' }
GsInstVarRefactoring >> deletePriorVersionsOf: aNewClass [
	"Remove every version other than aNewClass (the current one) from its class history."
	| history victims |
	history := aNewClass classHistory.
	victims := (1 to: history size) inject: OrderedCollection new into: [:acc :i |
		| v | v := history at: i.
		v == aNewClass ifFalse: [acc add: v]. acc].
	victims do: [:v | history removeVersion: v]
]

{ #category : 'applying' }
GsInstVarRefactoring >> applyChange: aChange [
	(aChange kind == #classDefinitionEdit or: [aChange kind == #classReparent])
		ifTrue: [^self applyClassChange: aChange].
	^self error: 'Unexpected change kind for instVar refactoring: ', aChange kind printString
]

{ #category : 'applying' }
GsInstVarRefactoring >> applyClassChange: aChange [
	"Create a new version of the named class -- under the freshly created parent version, with its
	 computed own-instVar list and its preserved-or-edited options -- copy its methods forward, and
	 record the old->new mapping so its own descendants re-parent onto it. No commit here."
	| old parentNew list new |
	old := environment classNamed: aChange className.
	old isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	parentNew := oldToNew at: old superclass ifAbsent: [old superclass].
	list := newIvarLists at: aChange className ifAbsent: [self ownInstVarsOf: old].
	new := self makeNewVersionOf: old superclass: parentNew instVarNames: list options: (self optionsForApply: old).
	self copyMethodsFrom: old to: new.
	oldToNew at: old put: new
]

{ #category : 'applying' }
GsInstVarRefactoring >> optionsForApply: aClass [
	"The class-creation option list aClass's new version is built with: the user-edited set for the
	 acted-on class (when they changed it), otherwise the class's own preserved options."
	(editedOptions notNil and: [aClass name asString = self actedOnClassName])
		ifTrue: [^editedOptions].
	^self optionsOf: aClass
]

{ #category : 'applying' }
GsInstVarRefactoring >> makeNewVersionOf: old superclass: sup instVarNames: ivars options: opts [
	"Create a new version in old's class history, under sup, with own-instVar list ivars, the given
	 options, and all of old's other shape (format, class vars, class-instance vars, pools, comment).
	 Same primitive R3 uses for a rename/reparent -- but options are preserved/edited (not dropped)."
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
		options: (opts collect: [:e | e asSymbol])
]

{ #category : 'applying' }
GsInstVarRefactoring >> copyMethodsFrom: old to: new [
	"Copy every method of old (both sides) verbatim onto new -- a new class version starts with an
	 empty method dictionary. A method that references a removed instance variable will not
	 compile; it is recorded as dropped (its class and selector) rather than silently vanishing."
	old selectors do: [:sel | self copyMethod: sel from: old to: new meta: false].
	old class selectors do: [:sel | self copyMethod: sel from: old class to: new class meta: true]
]

{ #category : 'applying' }
GsInstVarRefactoring >> copyMethod: sel from: srcCls to: dstCls meta: isMeta [
	| m cat result |
	m := srcCls compiledMethodAt: sel environmentId: 0 otherwise: nil.
	m isNil ifTrue: [^self].
	cat := (srcCls categoryOfSelector: sel environmentId: 0) ifNil: ['as yet unclassified'].
	result := dstCls
		compileMethod: m sourceString
		dictionaries: System myUserProfile symbolList
		category: cat asString.
	"compileMethod: answers nil on success and a non-empty Array of error tuples on a compile
	 failure (e.g. a reference to the just-removed instance variable). A failed method is not
	 installed, so record it as dropped rather than let it vanish silently."
	(result isNil or: [(result isKindOf: Array) and: [result isEmpty]])
		ifFalse: [dropped add: (Array
			with: (isMeta ifTrue: [dstCls thisClass name asString, ' class'] ifFalse: [dstCls name asString])
			with: sel asString)]
]

{ #category : 'applying' }
GsInstVarRefactoring >> dictObjectFor: aClass [
	"The actual SymbolDictionary object that defines aClass's name, for inDictionary:."
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty
		ifTrue: [environment symbolList objectNamed: #UserGlobals]
		ifFalse: [dicts first]
]

{ #category : 'serializing' }
GsInstVarRefactoring >> jsonQuote: aString [
	^'"', (self jsonEscape: aString), '"'
]

{ #category : 'serializing' }
GsInstVarRefactoring >> jsonEscape: aString [
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
GsInstVarRefactoring >> hex2: anInteger [
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
]
