"
A non-committing set of individually-addressable changes that a refactoring
computes and a client previews before applying. Staging a change records it
only: the change set NEVER compiles a method or commits the transaction. The
client fetches jsonString for a per-change before/after preview, lets the user
select which changes to keep, and the client recompiles only the selected
ones (still without committing -- the user commits explicitly).
"
Class {
	#name : 'GsRefactoringChangeSet',
	#superclass : 'Object',
	#instVars : [
		'changes',
		'nextId'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsRefactoringChangeSet class >> new [
	^self basicNew initialize
]

{ #category : 'building' }
GsRefactoringChangeSet >> addClassDefinitionEditInDictionary: dn className: cn oldSource: os newSource: ns [
	"Stage a class-definition edit. Records the change only; NEVER compiles or
	 commits. Returns the new GsRefactoringChange."
	| change |
	change := GsRefactoringChange
		classDefinitionEditId: self nextIdString dictName: dn className: cn
		oldSource: os newSource: ns.
	changes add: change.
	^change
]

{ #category : 'building' }
GsRefactoringChangeSet >> addMethodRecompileInDictionary: dn className: cn isMeta: aBool selector: sel category: cat oldSource: os newSource: ns [
	"Stage a method recompile. Records the change only; NEVER compiles or
	 commits. The category travels with the change so a client can address the
	 method (e.g. build its editor URI) and recompile it under its own category.
	 Returns the new GsRefactoringChange."
	| change |
	change := GsRefactoringChange
		methodRecompileId: self nextIdString dictName: dn className: cn
		isMeta: aBool selector: sel category: cat oldSource: os newSource: ns.
	changes add: change.
	^change
]

{ #category : 'building' }
GsRefactoringChangeSet >> addMethodAddInDictionary: dn className: cn isMeta: aBool selector: sel category: cat newSource: ns [
	"Stage a brand-new method (it does not yet exist in the class). Records the change
	 only; NEVER compiles or commits. Apply compiles newSource just like a recompile;
	 the nil oldSource makes the diff render as an all-added method. Returns the new
	 GsRefactoringChange."
	| change |
	change := GsRefactoringChange
		methodAddId: self nextIdString dictName: dn className: cn
		isMeta: aBool selector: sel category: cat newSource: ns.
	changes add: change.
	^change
]

{ #category : 'building' }
GsRefactoringChangeSet >> addMethodRemoveInDictionary: dn className: cn isMeta: aBool selector: sel category: cat oldSource: os [
	"Stage the removal of a method (inline-method deletes a now-unused target).
	 Records the change only; NEVER compiles or commits. Apply calls removeSelector:.
	 Returns the new GsRefactoringChange."
	| change |
	change := GsRefactoringChange
		methodRemoveId: self nextIdString dictName: dn className: cn
		isMeta: aBool selector: sel category: cat oldSource: os.
	changes add: change.
	^change
]

{ #category : 'building' }
GsRefactoringChangeSet >> addMethodRenameInDictionary: dn className: cn isMeta: aBool oldSelector: oldSel newSelector: newSel category: cat oldSource: os newSource: ns [
	"Stage a method rename (selector changes). Records the change only; NEVER
	 compiles or commits. The client applies it as compile-new-then-remove-old.
	 Returns the new GsRefactoringChange."
	| change |
	change := GsRefactoringChange
		methodRenameId: self nextIdString dictName: dn className: cn
		isMeta: aBool oldSelector: oldSel newSelector: newSel category: cat
		oldSource: os newSource: ns.
	changes add: change.
	^change
]

{ #category : 'building' }
GsRefactoringChangeSet >> addClassRenameInDictionary: dn className: cn newName: nn oldSource: os newSource: ns [
	"Stage the rename of the target class. Records the change only; NEVER compiles or
	 commits. Apply creates a new class version under the new name (newVersionOf: the
	 current version), copies methods forward, and rebinds the dictionary key.
	 Returns the new GsRefactoringChange."
	| change |
	change := GsRefactoringChange
		classRenameId: self nextIdString dictName: dn className: cn
		newName: nn oldSource: os newSource: ns.
	changes add: change.
	^change
]

{ #category : 'building' }
GsRefactoringChangeSet >> addClassReparentInDictionary: dn className: cn oldSource: os newSource: ns [
	"Stage the re-parenting of one descendant of a renamed class. Records the change
	 only; NEVER compiles or commits. Apply recompiles the descendant's definition
	 newVersionOf: its current version and copies its methods forward.
	 Returns the new GsRefactoringChange."
	| change |
	change := GsRefactoringChange
		classReparentId: self nextIdString dictName: dn className: cn
		oldSource: os newSource: ns.
	changes add: change.
	^change
]

{ #category : 'accessing' }
GsRefactoringChangeSet >> changeWithId: anId [
	^changes detect: [:c | c id = anId] ifNone: [nil]
]

{ #category : 'accessing' }
GsRefactoringChangeSet >> changes [
	^changes
]

{ #category : 'initialization' }
GsRefactoringChangeSet >> initialize [
	changes := OrderedCollection new.
	nextId := 1
]

{ #category : 'testing' }
GsRefactoringChangeSet >> isEmpty [
	^changes isEmpty
]

{ #category : 'serializing' }
GsRefactoringChangeSet >> jsonOn: aStream [
	aStream nextPut: $[.
	changes keysAndValuesDo: [:i :change |
		i = 1 ifFalse: [aStream nextPut: $,].
		change jsonOn: aStream].
	aStream nextPut: $]
]

{ #category : 'serializing' }
GsRefactoringChangeSet >> jsonString [
	| ws |
	ws := WriteStream on: String new.
	self jsonOn: ws.
	^ws contents
]

{ #category : 'private' }
GsRefactoringChangeSet >> nextIdString [
	| s |
	s := nextId printString.
	nextId := nextId + 1.
	^s
]

{ #category : 'accessing' }
GsRefactoringChangeSet >> selectedChanges: aCollectionOfIds [
	"The subset of changes whose ids are in aCollectionOfIds, preserving order.
	 Backs the client's per-change selective apply."
	| ids |
	ids := aCollectionOfIds asArray.
	^changes select: [:c | ids includes: c id]
]

{ #category : 'accessing' }
GsRefactoringChangeSet >> size [
	^changes size
]
