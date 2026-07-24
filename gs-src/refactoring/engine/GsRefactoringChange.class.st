"
One individually-addressable change in a GsRefactoringChangeSet: a method to
recompile, a method to rename (compile under a new selector, then remove the
old), or a class definition to edit. A change carries the old and new source so
a client can render a before/after diff, and an id so a client can select which
changes to apply. Building a change compiles and commits nothing.

A #methodRename change carries both the old selector (in `selector`) and the new
selector (in `newSelector`); every other kind leaves `newSelector` nil.
"
Class {
	#name : 'GsRefactoringChange',
	#superclass : 'Object',
	#instVars : [
		'id',
		'kind',
		'dictName',
		'className',
		'isMeta',
		'selector',
		'newSelector',
		'newName',
		'category',
		'oldSource',
		'newSource'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsRefactoringChange class >> classDefinitionEditId: anId dictName: dn className: cn oldSource: os newSource: ns [
	^self new
		setId: anId kind: #classDefinitionEdit dictName: dn className: cn
		isMeta: false selector: nil category: nil oldSource: os newSource: ns
]

{ #category : 'instance creation' }
GsRefactoringChange class >> methodRecompileId: anId dictName: dn className: cn isMeta: aBool selector: sel category: cat oldSource: os newSource: ns [
	^self new
		setId: anId kind: #methodRecompile dictName: dn className: cn
		isMeta: aBool selector: sel category: cat oldSource: os newSource: ns
]

{ #category : 'instance creation' }
GsRefactoringChange class >> methodAddId: anId dictName: dn className: cn isMeta: aBool selector: sel category: cat newSource: ns [
	"A brand-new method to compile (it does not yet exist in the class): apply =
	 compile newSource, exactly like a recompile. oldSource is nil so the before/after
	 diff renders as an all-added method. Used by extract-method for the extracted
	 method."
	^self new
		setId: anId kind: #methodAdd dictName: dn className: cn
		isMeta: aBool selector: sel category: cat oldSource: nil newSource: ns
]

{ #category : 'instance creation' }
GsRefactoringChange class >> methodRemoveId: anId dictName: dn className: cn isMeta: aBool selector: sel category: cat oldSource: os [
	"A method to REMOVE (inline-method deletes a now-unused target after inlining its
	 last sender): apply = removeSelector:. newSource is nil so the before/after diff
	 renders as an all-removed method."
	^self new
		setId: anId kind: #methodRemove dictName: dn className: cn
		isMeta: aBool selector: sel category: cat oldSource: os newSource: nil
]

{ #category : 'instance creation' }
GsRefactoringChange class >> methodRenameId: anId dictName: dn className: cn isMeta: aBool oldSelector: oldSel newSelector: newSel category: cat oldSource: os newSource: ns [
	"A method whose selector changes: apply = compile newSource (under newSel),
	 then remove the old-selector method. `selector` holds the old selector."
	^(self new
		setId: anId kind: #methodRename dictName: dn className: cn
		isMeta: aBool selector: oldSel category: cat oldSource: os newSource: ns)
		setNewSelector: newSel
]

{ #category : 'instance creation' }
GsRefactoringChange class >> classRenameId: anId dictName: dn className: cn newName: nn oldSource: os newSource: ns [
	"The target class of a rename: `className` holds the OLD name, `newName` the new.
	 Apply (server-side) creates a new version under the new name, copies the old
	 version's methods forward, then rebinds the dictionary key (add new, remove old).
	 oldSource/newSource are the old/new class definitions, for the before/after diff."
	^(self new
		setId: anId kind: #classRename dictName: dn className: cn
		isMeta: false selector: nil category: nil oldSource: os newSource: ns)
		setNewName: nn
]

{ #category : 'instance creation' }
GsRefactoringChange class >> classReparentId: anId dictName: dn className: cn oldSource: os newSource: ns [
	"A descendant of a renamed class: it must be recompiled newVersionOf: its current
	 version so it re-points at the freshly created parent chain (and, for a direct
	 child, so its definition names the new superclass). `className` is the descendant's
	 own (unchanged) name. oldSource/newSource are its old/new definition."
	^self new
		setId: anId kind: #classReparent dictName: dn className: cn
		isMeta: false selector: nil category: nil oldSource: os newSource: ns
]

{ #category : 'accessing' }
GsRefactoringChange >> className [
	^className
]

{ #category : 'accessing' }
GsRefactoringChange >> dictName [
	^dictName
]

{ #category : 'serializing' }
GsRefactoringChange >> hex2: anInteger [
	"Two lowercase hex digits for a 0..255 code point."
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
]

{ #category : 'accessing' }
GsRefactoringChange >> id [
	^id
]

{ #category : 'accessing' }
GsRefactoringChange >> category [
	^category
]

{ #category : 'accessing' }
GsRefactoringChange >> isMeta [
	^isMeta
]

{ #category : 'serializing' }
GsRefactoringChange >> jsonEscape: aString on: aStream [
	"Escape aString per JSON string rules, emitting PURE ASCII: control characters
	 and any code point above 126 become \uXXXX escapes. This keeps the whole
	 payload a byte String, so the client's non-blocking GCI fetch (which reads
	 characters, not raw bytes) never trips over a Unicode-promoted result. A code
	 point above the BMP (rare in source) is emitted as '?' -- the JSON is
	 preview-only (apply uses the server-side source), so this is display-safe."
	aString do: [:ch | | code |
		code := ch asInteger.
		ch == $" ifTrue: [aStream nextPutAll: '\"']
		ifFalse: [ch == $\ ifTrue: [aStream nextPutAll: '\\']
		ifFalse: [code = 10 ifTrue: [aStream nextPutAll: '\n']
		ifFalse: [code = 13 ifTrue: [aStream nextPutAll: '\r']
		ifFalse: [code = 9 ifTrue: [aStream nextPutAll: '\t']
		ifFalse: [code < 32
			ifTrue: [aStream nextPutAll: '\u00'; nextPutAll: (self hex2: code)]
		ifFalse: [code > 126
			ifTrue: [code > 65535
				ifTrue: [aStream nextPut: $?]
				ifFalse: [aStream nextPutAll: '\u';
					nextPutAll: (self hex2: code // 256);
					nextPutAll: (self hex2: code \\ 256)]]
			ifFalse: [aStream nextPut: ch]]]]]]]]
]

{ #category : 'serializing' }
GsRefactoringChange >> jsonOn: aStream [
	aStream nextPutAll: '{"id":'.
	self jsonValue: id on: aStream.
	aStream nextPutAll: ',"kind":'.
	self jsonValue: kind on: aStream.
	aStream nextPutAll: ',"dictName":'.
	self jsonValue: dictName on: aStream.
	aStream nextPutAll: ',"className":'.
	self jsonValue: className on: aStream.
	aStream nextPutAll: ',"isMeta":'.
	aStream nextPutAll: (isMeta == true ifTrue: ['true'] ifFalse: ['false']).
	aStream nextPutAll: ',"selector":'.
	self jsonValue: selector on: aStream.
	aStream nextPutAll: ',"newSelector":'.
	self jsonValue: newSelector on: aStream.
	aStream nextPutAll: ',"newName":'.
	self jsonValue: newName on: aStream.
	aStream nextPutAll: ',"category":'.
	self jsonValue: category on: aStream.
	aStream nextPutAll: ',"oldSource":'.
	self jsonValue: oldSource on: aStream.
	aStream nextPutAll: ',"newSource":'.
	self jsonValue: newSource on: aStream.
	aStream nextPut: $}
]

{ #category : 'serializing' }
GsRefactoringChange >> jsonValue: aValue on: aStream [
	"Emit aValue as a JSON string (or null). Symbols/Strings both render as
	 their characters; nil renders as the JSON null literal."
	aValue isNil ifTrue: [^aStream nextPutAll: 'null'].
	aStream nextPut: $".
	self jsonEscape: aValue asString on: aStream.
	aStream nextPut: $"
]

{ #category : 'accessing' }
GsRefactoringChange >> kind [
	^kind
]

{ #category : 'accessing' }
GsRefactoringChange >> newSource [
	^newSource
]

{ #category : 'accessing' }
GsRefactoringChange >> oldSource [
	^oldSource
]

{ #category : 'accessing' }
GsRefactoringChange >> newSelector [
	"The new selector for a #methodRename change; nil for every other kind."
	^newSelector
]

{ #category : 'accessing' }
GsRefactoringChange >> newName [
	"The new class name for a #classRename change; nil for every other kind."
	^newName
]

{ #category : 'private' }
GsRefactoringChange >> setNewName: aString [
	newName := aString
]

{ #category : 'accessing' }
GsRefactoringChange >> selector [
	^selector
]

{ #category : 'private' }
GsRefactoringChange >> setNewSelector: aSelector [
	newSelector := aSelector
]

{ #category : 'private' }
GsRefactoringChange >> setId: anId kind: aKind dictName: dn className: cn isMeta: aBool selector: sel category: cat oldSource: os newSource: ns [
	id := anId.
	kind := aKind.
	dictName := dn.
	className := cn.
	isMeta := aBool.
	selector := sel.
	category := cat.
	oldSource := os.
	newSource := ns
]
