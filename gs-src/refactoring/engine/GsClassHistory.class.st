"
Read-only view of a class's DEFINITION HISTORY in this stone -- built directly on
GemStone's native classHistory, so it needs no home-grown store and records nothing
of its own. Every time a class definition changes (a shape edit, or a rename via
GsRenameClassRefactoring), GemStone appends a new Class VERSION to the class
history; each version is an independent Class object that remembers the name it had
then, when it was defined (timeStamp), who defined it (userId), its object id (oop),
its definition source, and its own methods.

  GsClassHistory forClassNamed: 'Foo'

answers a JSON array, newest version first, one object per version:

  { index, name, oop, timeStamp, userId, isCurrent, definition, changedMethods }

where changedMethods lists, per side, the selectors added / removed / modified
relative to the PREVIOUS version -- so the client can show, unobtrusively, exactly
what each definition change did without any recorded log.

  GsClassHistory revertClassNamed: 'Foo' toIndex: 2

recompiles the chosen historical version's shape + methods under the class's CURRENT
name, as a NEW version (a 'redo'). classHistory is append-only, so a revert is never
destructive and can itself be reverted. Nothing here commits -- forClassNamed: is
read-only, and revert compiles in the stone but leaves the commit to the user.
"
Class {
	#name : 'GsClassHistory',
	#superclass : 'Object',
	#category : 'Refactoring-Core'
}

{ #category : 'accessing' }
GsClassHistory class >> forClassNamed: aName [
	"A JSON array of the class's definition versions, newest first, or an error
	 envelope if the name is unbound. Read-only."
	| cls hist ws n |
	cls := System myUserProfile symbolList objectNamed: aName asSymbol.
	(cls isNil or: [(cls isKindOf: Behavior) not])
		ifTrue: [^'{"error":"not a class: ', (self jsonEscape: aName), '"}'].
	hist := cls classHistory.
	n := hist size.
	ws := WriteStream on: String new.
	ws nextPut: $[.
	n to: 1 by: -1 do: [:i |
		i < n ifTrue: [ws nextPut: $,].
		self version: (hist at: i) index: i of: cls previous: (i > 1 ifTrue: [hist at: i - 1] ifFalse: [nil]) on: ws].
	ws nextPut: $].
	^ws contents
]

{ #category : 'serializing' }
GsClassHistory class >> version: aVersion index: i of: currentClass previous: prevVersion on: ws [
	ws nextPutAll: '{"index":'; nextPutAll: i printString.
	ws nextPutAll: ',"name":'; nextPutAll: (self jsonQuote: aVersion name asString).
	ws nextPutAll: ',"oop":'; nextPutAll: ([aVersion asOop] on: Error do: [:e | 0]) printString.
	ws nextPutAll: ',"timeStamp":'; nextPutAll: (self jsonQuote:
		(self formatTimeStamp: ([aVersion timeStamp] on: Error do: [:e | nil]))).
	ws nextPutAll: ',"userId":'; nextPutAll: (self jsonQuote:
		([aVersion userId asString] on: Error do: [:e | ''])).
	ws nextPutAll: ',"isCurrent":'; nextPutAll: (aVersion == currentClass ifTrue: ['true'] ifFalse: ['false']).
	ws nextPutAll: ',"definition":'; nextPutAll: (self jsonQuote:
		([aVersion definition] on: Error do: [:e | ''])).
	ws nextPutAll: ',"changedMethods":'.
	self changedMethodsBetween: prevVersion and: aVersion on: ws.
	ws nextPut: $}
]

{ #category : 'serializing' }
GsClassHistory class >> changedMethodsBetween: prevVersion and: aVersion on: ws [
	"Emit the JSON array of {side,selector,change} describing what changed between the
	 previous version and aVersion, per side. If prevVersion is nil (the baseline), all
	 of aVersion's selectors are 'added'. change is 'added' | 'removed' | 'modified'."
	| first |
	ws nextPut: $[.
	first := true.
	#(#(false 'instance') #(true 'class')) do: [:pair | | isMeta side prevCls curCls |
		isMeta := pair at: 1.
		side := pair at: 2.
		curCls := isMeta ifTrue: [aVersion class] ifFalse: [aVersion].
		prevCls := prevVersion isNil ifTrue: [nil] ifFalse: [isMeta ifTrue: [prevVersion class] ifFalse: [prevVersion]].
		(self diffSide: side prev: prevCls cur: curCls) do: [:entry |
			first ifFalse: [ws nextPut: $,].
			first := false.
			ws nextPutAll: '{"side":"'; nextPutAll: side.
			ws nextPutAll: '","selector":'; nextPutAll: (self jsonQuote: (entry at: 1) asString).
			ws nextPutAll: ',"change":"'; nextPutAll: (entry at: 2); nextPutAll: '"}']].
	ws nextPut: $]
]

{ #category : 'serializing' }
GsClassHistory class >> diffSide: side prev: prevCls cur: curCls [
	"An OrderedCollection of Array(selector, changeString) for one side, comparing the
	 method dictionaries of prevCls and curCls (either may be nil)."
	| result |
	result := OrderedCollection new.
	(curCls isNil ifTrue: [#()] ifFalse: [curCls selectors asSortedCollection]) do: [:sel |
		(prevCls isNil or: [(prevCls includesSelector: sel) not])
			ifTrue: [result add: (Array with: sel with: 'added')]
			ifFalse: [
				(self source: sel in: prevCls) = (self source: sel in: curCls)
					ifFalse: [result add: (Array with: sel with: 'modified')]]].
	prevCls isNil ifFalse: [
		prevCls selectors asSortedCollection do: [:sel |
			(curCls isNil or: [(curCls includesSelector: sel) not])
				ifTrue: [result add: (Array with: sel with: 'removed')]]].
	^result
]

{ #category : 'serializing' }
GsClassHistory class >> source: sel in: aClass [
	| m |
	aClass isNil ifTrue: [^''].
	m := aClass compiledMethodAt: sel environmentId: 0 otherwise: nil.
	^m isNil ifTrue: [''] ifFalse: [m sourceString]
]

{ #category : 'redo' }
GsClassHistory class >> revertClassNamed: aName toIndex: anInt [
	"Restore a class to the definition (name, shape, AND methods) of the version at
	 index anInt, as a NEW version -- a redo. This is the same operation as a rename to
	 that version's name: it re-parents every subclass onto the restored version and,
	 when the historical name differs from the current one, rewrites references back to
	 it across the image. Nothing is committed (the user commits). Answers a JSON result
	 {reverted, index, newIndex, name, failed} or an error envelope. `name` is the
	 restored class's (possibly changed) name so the client can re-key its view."
	| cls hist target ref restored applied |
	cls := System myUserProfile symbolList objectNamed: aName asSymbol.
	(cls isNil or: [(cls isKindOf: Behavior) not])
		ifTrue: [^'{"reverted":false,"error":"not a class: ', (self jsonEscape: aName), '"}'].
	hist := cls classHistory.
	(anInt < 1 or: [anInt > hist size])
		ifTrue: [^'{"reverted":false,"error":"index out of range"}'].
	target := hist at: anInt.
	target == cls
		ifTrue: [^'{"reverted":false,"error":"that version is already current"}'].
	ref := (self resolve: #GsRenameClassRefactoring) restoreClass: cls toVersion: target.
	applied := ref applyDeselected: #().
	restored := System myUserProfile symbolList objectNamed: target name asSymbol.
	^'{"reverted":true,"index":', anInt printString,
	  ',"name":', (self jsonQuote: target name asString),
	  ',"newIndex":', (restored isNil ifTrue: ['0'] ifFalse: [(restored classHistory indexOf: restored) printString]),
	  ',"apply":', applied, '}'
]

{ #category : 'redo' }
GsClassHistory class >> removeVersionOf: aName index: anInt [
	"Remove the version at index anInt from the named class's class history
	 (ClassHistory>>removeVersion:), so it no longer appears in the history. The
	 currently-bound version cannot be removed. Does NOT commit -- the user commits.
	 Answers {removed, index, remaining} or an error envelope. Note: removing a version
	 that still has (un-migrated) instances leaves those instances referring to a
	 version no longer in the history; the client warns before calling."
	| cls hist target |
	cls := System myUserProfile symbolList objectNamed: aName asSymbol.
	(cls isNil or: [(cls isKindOf: Behavior) not])
		ifTrue: [^'{"removed":false,"error":"not a class: ', (self jsonEscape: aName), '"}'].
	hist := cls classHistory.
	(anInt < 1 or: [anInt > hist size])
		ifTrue: [^'{"removed":false,"error":"index out of range"}'].
	target := hist at: anInt.
	target == cls
		ifTrue: [^'{"removed":false,"error":"cannot remove the current version"}'].
	hist removeVersion: target.
	^'{"removed":true,"index":', anInt printString, ',"remaining":', hist size printString, '}'
]

{ #category : 'private' }
GsClassHistory class >> resolve: aSymbol [
	"Resolve an engine class by name through the symbol list (it is loaded alongside
	 this class in the GsRefactoring dictionary)."
	^System myUserProfile symbolList objectNamed: aSymbol
]

{ #category : 'serializing' }
GsClassHistory class >> formatTimeStamp: aDateTime [
	"Emit the class-version DateTime as a locale-NEUTRAL ISO-8601 string
	 (yyyy-mm-ddTHH:MM:SS), so the client can render it in the user's own locale
	 (a US user sees mm/dd/yyyy, etc.). Falls back to printString (then '') on any
	 error, so a format surprise never breaks the read-only history view."
	aDateTime isNil ifTrue: [^''].
	^[ aDateTime year printString, '-', (self pad2: aDateTime month), '-',
	   (self pad2: aDateTime dayOfMonth), 'T',
	   (self pad2: aDateTime hour), ':', (self pad2: aDateTime minute), ':',
	   (self pad2: aDateTime second truncated) ]
		on: Error
		do: [:e | [aDateTime printString] on: Error do: [:e2 | '']]
]

{ #category : 'serializing' }
GsClassHistory class >> pad2: anInteger [
	"anInteger as a two-digit, zero-padded decimal string (e.g. 7 -> '07')."
	^(anInteger < 10 ifTrue: ['0'] ifFalse: ['']), anInteger printString
]

{ #category : 'serializing' }
GsClassHistory class >> hex2: anInteger [
	^GsRefactoringJson hex2: anInteger
]

{ #category : 'serializing' }
GsClassHistory class >> jsonEscape: aString [
	^GsRefactoringJson jsonEscape: aString
]

{ #category : 'serializing' }
GsClassHistory class >> jsonQuote: aString [
	^GsRefactoringJson jsonQuote: aString
]
