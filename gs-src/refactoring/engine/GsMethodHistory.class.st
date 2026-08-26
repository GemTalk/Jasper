"
Per-METHOD source history in this stone -- the method-level companion to
GsClassHistory. GemStone keeps no native history for a method (recompiling a
method just replaces the CompiledMethod in place), so unlike GsClassHistory this
class keeps its OWN store: a Dictionary in the user's UserGlobals, so history is
persistent (it survives across logins once the session commits) and per-user, and
lives only in THIS stone. It is never exported.

Capture rides the compile path. The client's compile query calls, around each
(re)compile of a method:

  GsMethodHistory beforeCompileIn: aBehavior source: src environmentId: envId
  ...the actual compileMethod:...
  GsMethodHistory afterCompileIn: aBehavior method: result source: src category: cat

beforeCompileIn: seeds the history the first time a method is edited with the
currently-installed (about-to-be-replaced) source, so the ORIGINAL survives the
first edit (learned from Jadeite for Pharo, whose early version discarded it).
afterCompileIn: appends the newly-compiled source as a new version, stamped with
DateTime now and the current userId -- the timestamp/author Jadeite for Pharo
never stored. Both are best-effort: any error is swallowed so history capture can
never block or break a compile. Identical-to-latest source is not re-recorded, so
merely re-accepting unchanged text does not inflate the history.

  GsMethodHistory forClassNamed: 'Foo' selector: 'bar' meta: false

answers a JSON array, NEWEST version first, one object per version:

  { index, timeStamp, userId, category, isCurrent, source }

index is the version's 1-based position oldest-first (stable to reference).
isCurrent marks the version whose source matches the method installed right now.
If the installed method is not represented in the history (e.g. it was last edited
outside Jasper), a synthetic current version is emitted on top with
notInHistory:true; if the method has been removed, no version is current.

There is no server-side 'restore': restoring a version is just recompiling its
source through the ordinary compile path, which records it as a new version -- so a
restore is never destructive and can itself be undone by restoring the version
that was current before. Nothing here commits; the user commits (which is also
when the recorded history becomes durable).
"
Class {
	#name : 'GsMethodHistory',
	#superclass : 'Object',
	#category : 'Refactoring-Core'
}

{ #category : 'capture' }
GsMethodHistory class >> beforeCompileIn: aBehavior source: source environmentId: envId [
	"About to (re)compile `source` into aBehavior. If this method has no history yet
	 and it is already installed, seed the history with the currently-installed
	 source so the original survives the first edit. Best-effort: never blocks a
	 compile, so all of it is guarded and a new method (nothing installed) simply
	 gets no seed -- its first version is recorded post-compile."
	[ | selector store key old |
	  selector := self selectorFrom: source.
	  selector isNil ifTrue: [^self].
	  store := self store.
	  key := self keyFor: aBehavior selector: selector.
	  (store includesKey: key) ifTrue: [^self].
	  old := aBehavior compiledMethodAt: selector environmentId: envId otherwise: nil.
	  old isNil ifTrue: [^self].
	  store at: key put: (OrderedCollection with:
	    (self version: old sourceString category: (self categoryOf: selector in: aBehavior)))
	] on: Error do: [:e | ^self]
]

{ #category : 'capture' }
GsMethodHistory class >> afterCompileIn: aBehavior method: aMethod source: source category: category [
	"Just compiled aMethod successfully into aBehavior. Append `source` as a new
	 version, stamped with the time and userId, unless it is identical to the most
	 recent recorded source (so re-accepting unchanged text does not inflate the
	 history). Best-effort -- guarded so it never turns a good compile into an error."
	[ | selector store key list |
	  aMethod isNil ifTrue: [^self].
	  selector := aMethod selector.
	  store := self store.
	  key := self keyFor: aBehavior selector: selector.
	  list := store at: key ifAbsentPut: [OrderedCollection new].
	  (list notEmpty and: [(list last at: 4) = source]) ifTrue: [^self].
	  list add: (self version: source category: category)
	] on: Error do: [:e | ^self]
]

{ #category : 'accessing' }
GsMethodHistory class >> forClassNamed: aName selector: aSelector meta: isMeta [
	"A JSON array of the recorded versions of aName>>aSelector (or its class-side
	 method when isMeta), newest first, or an error envelope if the name is unbound.
	 Read-only. The version whose source matches the currently-installed method is
	 flagged isCurrent; if the installed method is not in the history a synthetic
	 current version is emitted on top (notInHistory:true)."
	| cls behavior store key list curSrc curIdx ws first |
	cls := System myUserProfile symbolList objectNamed: aName asSymbol.
	(cls isNil or: [(cls isKindOf: Behavior) not])
		ifTrue: [^'{"error":"not a class: ', (self jsonEscape: aName), '"}'].
	behavior := isMeta ifTrue: [cls class] ifFalse: [cls].
	store := self store.
	key := self keyFor: behavior selector: aSelector asSymbol.
	list := store at: key ifAbsent: [OrderedCollection new].
	curSrc := (behavior compiledMethodAt: aSelector asSymbol environmentId: 0 otherwise: nil)
		ifNil: [nil] ifNotNil: [:m | m sourceString].
	"1-based index (oldest-first) of the newest recorded version that matches the
	 installed source, or 0 if none / the method is gone."
	curIdx := 0.
	curSrc isNil ifFalse: [1 to: list size do: [:i | ((list at: i) at: 4) = curSrc ifTrue: [curIdx := i]]].
	ws := WriteStream on: String new.
	ws nextPut: $[.
	first := true.
	(curSrc notNil and: [curIdx = 0]) ifTrue: [
		first := false.
		self currentVersionSource: curSrc category: (self categoryOf: aSelector asSymbol in: behavior) on: ws].
	list size to: 1 by: -1 do: [:i |
		first ifFalse: [ws nextPut: $,].
		first := false.
		self versionJson: (list at: i) index: i isCurrent: (i = curIdx) on: ws].
	ws nextPut: $].
	^ws contents
]

{ #category : 'removing' }
GsMethodHistory class >> removeHistoryForClassNamed: aName selector: aSelector meta: isMeta [
	"Forget all recorded versions of aName>>aSelector (or the class-side method when
	 isMeta). Does NOT commit. Answers {removed, remaining} or an error envelope."
	| cls behavior store key existed |
	cls := System myUserProfile symbolList objectNamed: aName asSymbol.
	(cls isNil or: [(cls isKindOf: Behavior) not])
		ifTrue: [^'{"removed":false,"error":"not a class: ', (self jsonEscape: aName), '"}'].
	behavior := isMeta ifTrue: [cls class] ifFalse: [cls].
	store := self store.
	key := self keyFor: behavior selector: aSelector asSymbol.
	existed := store includesKey: key.
	existed ifTrue: [store removeKey: key ifAbsent: []].
	^'{"removed":', (existed ifTrue: ['true'] ifFalse: ['false']), ',"remaining":0}'
]

{ #category : 'private' }
GsMethodHistory class >> store [
	"The per-user history Dictionary, kept in UserGlobals so it is persistent and
	 owned by this user. Created on first use. Keyed by keyFor:selector:, valued by
	 an OrderedCollection of version arrays, oldest first."
	| ug |
	ug := System myUserProfile symbolList objectNamed: #UserGlobals.
	^ug at: #GsMethodHistoryStore ifAbsentPut: [Dictionary new]
]

{ #category : 'private' }
GsMethodHistory class >> keyFor: aBehavior selector: aSelector [
	"A stable String key for one method. aBehavior name is 'Foo' for the instance
	 side and 'Foo class' for the class side, so the key encodes the side too."
	^aBehavior name asString, '>>', aSelector asString
]

{ #category : 'private' }
GsMethodHistory class >> selectorFrom: source [
	"The selector RBParser reads from method source, or nil if the source will not
	 parse (the real compile then fails with the proper error)."
	^[(RBParser parseMethod: source) selector] on: Error do: [:e | nil]
]

{ #category : 'private' }
GsMethodHistory class >> categoryOf: aSelector in: aBehavior [
	"aBehavior's category for aSelector, or '' when unknown."
	^[(aBehavior categoryOfSelector: aSelector environmentId: 0) ifNil: ['']] on: Error do: [:e | '']
]

{ #category : 'private' }
GsMethodHistory class >> version: source category: category [
	"A recorded version: an Array {timeStamp. userId. category. source}. Positions
	 are fixed (see the at: sends elsewhere) so the record stays compact and cheap to
	 persist."
	^Array
		with: DateTime now
		with: ([System myUserProfile userId asString] on: Error do: [:e | ''])
		with: (category ifNil: [''])
		with: source
]

{ #category : 'serializing' }
GsMethodHistory class >> versionJson: aVersion index: i isCurrent: isCur on: ws [
	ws nextPutAll: '{"index":'; nextPutAll: i printString.
	ws nextPutAll: ',"timeStamp":'; nextPutAll: (self jsonQuote: (self formatTimeStamp: (aVersion at: 1))).
	ws nextPutAll: ',"userId":'; nextPutAll: (self jsonQuote: (aVersion at: 2) asString).
	ws nextPutAll: ',"category":'; nextPutAll: (self jsonQuote: (aVersion at: 3) asString).
	ws nextPutAll: ',"isCurrent":'; nextPutAll: (isCur ifTrue: ['true'] ifFalse: ['false']).
	ws nextPutAll: ',"source":'; nextPutAll: (self jsonQuote: (aVersion at: 4) asString).
	ws nextPut: $}
]

{ #category : 'serializing' }
GsMethodHistory class >> currentVersionSource: source category: category on: ws [
	"The synthetic 'current' version for a method whose installed source is not
	 represented in the recorded history (e.g. last edited outside Jasper). It has no
	 recorded index/timeStamp/userId and is flagged notInHistory so the client can
	 show it plainly and never offer to 'restore' it."
	ws nextPutAll: '{"index":0,"timeStamp":"","userId":"","category":'.
	ws nextPutAll: (self jsonQuote: category asString).
	ws nextPutAll: ',"isCurrent":true,"notInHistory":true,"source":'.
	ws nextPutAll: (self jsonQuote: source asString).
	ws nextPut: $}
]

{ #category : 'serializing' }
GsMethodHistory class >> formatTimeStamp: aDateTime [
	"aDateTime as a locale-NEUTRAL ISO-8601 string (yyyy-mm-ddTHH:MM:SS), so the
	 client renders it in the user's own locale. '' on nil or any format surprise, so
	 a stamp oddity never breaks the read-only view."
	aDateTime isNil ifTrue: [^''].
	^[ aDateTime year printString, '-', (self pad2: aDateTime month), '-',
	   (self pad2: aDateTime dayOfMonth), 'T',
	   (self pad2: aDateTime hour), ':', (self pad2: aDateTime minute), ':',
	   (self pad2: aDateTime second truncated) ]
		on: Error
		do: [:e | [aDateTime printString] on: Error do: [:e2 | '']]
]

{ #category : 'serializing' }
GsMethodHistory class >> pad2: anInteger [
	"anInteger as a two-digit, zero-padded decimal string (e.g. 7 -> '07')."
	^(anInteger < 10 ifTrue: ['0'] ifFalse: ['']), anInteger printString
]

{ #category : 'serializing' }
GsMethodHistory class >> jsonEscape: aString [
	^GsRefactoringJson jsonEscape: aString
]

{ #category : 'serializing' }
GsMethodHistory class >> jsonQuote: aString [
	^GsRefactoringJson jsonQuote: aString
]
