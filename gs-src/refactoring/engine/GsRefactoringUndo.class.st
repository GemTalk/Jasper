"
The undo record for the MOST RECENT applied refactoring, and the executor that
puts it back (issue #434).

How the record is built -- STATE-BASED, not kind-based
------------------------------------------------------
A refactoring stages a GsRefactoringChangeSet and applies it through its own
`applyDeselected:`. This class wraps that apply:

  1. work out the set of (class, side, selector) METHOD SLOTS the about-to-be-applied
     changes touch -- for each change its `selector`, plus its `newSelector` when it
     has one (a #methodRename touches two slots on the same class);
  2. snapshot each slot's LIVE state (does the method exist, its source, its category)
     BEFORE the apply;
  3. run the refactoring's own apply, untouched;
  4. snapshot the same slots again AFTER;
  5. diff the two snapshots into an INVERSE GsRefactoringChangeSet that puts every
     slot back the way it was.

Diffing live state rather than inverting each change kind is what makes this
faithful: a change that FAILED, or that was a no-op, simply shows no difference
between the two snapshots and contributes nothing to the inverse -- so the undo
never tries to reverse something that did not happen, and no per-kind inverse
table has to be kept in step with the engines.

The inverse is an ordinary GsRefactoringChangeSet of ordinary GsRefactoringChanges,
so the client previews and applies an undo through the very same paginated
preview + per-change deselection path every forward refactoring already uses.

Ordering inside the inverse: restore-what-was-deleted first, then recompile-what-
changed, then delete-what-was-created. Undoing a rename therefore brings the
original selector back BEFORE the new one is removed.

TWO mechanisms, one entry
-------------------------
A second kind of entry exists for the operations whose exact opposite the same engine already
performs -- rename class, rename instance variable, rename class variable, and add/remove
instance variable. Those cannot be reversed by the change-set diff above:
the diff is keyed by class NAME (and by (class, side, selector) slots), and a rename is
precisely the thing that moves the key. A rename also re-versions the class, so there is
no method-slot difference to invert.

Instead such an entry records the OPERATION -- kind, class, from-name, to-name, scope --
and reversing it REBUILDS the same rename engine in the opposite direction and previews
and applies THAT. So `mechanism` answers either:

  #changeSet -- apply the recorded inverse change set (method refactorings)
  #mirror    -- rebuild the SAME engine performing the opposite operation, and apply that

Both are previewed and applied through the same client path, because both end up
answering an ordinary change set to page over.

A #mirror is deliberately NOT a rollback and the UI says so: GemStone has no transaction
savepoints, so the reversal is a fresh forward operation. Class history GROWS; it never
shrinks. For a rename the compensation is real -- it carries methods forward, so anything
written AFTER the original rename survives, which a classHistory revert would have discarded.
For add/remove it is weaker and the UI must say which: reversing an ADD removes the variable
and DROPS any method written since that uses it (`mirrorDropCount` counts them), and reversing
a REMOVE brings the name back but not the values it held nor the methods the removal dropped.

Un-ticking a row means three different things across these kinds -- see
`deselectionFor:` -- so the mechanism alone is not enough for a client to render honestly.

Still out of scope
------------------
Everything else that reshapes a class -- instance-variable structure, extract superclass,
split class -- records NO entry: half an undo is worse than
none. Those need machinery that does not exist yet (a class-removal primitive, an inverse
ordering that stays top-down, classHistory reverts), or they lose data a by-name reversal
cannot restore. The apply result's undoRecorded field reports which it was, so the client
can say so rather than silently offering nothing.

Nothing here commits. An undo of an uncommitted refactoring stays uncommitted; an
undo of a committed one needs the user's own commit, exactly like every apply.

The entry lives in SessionTemps for the session's lifetime, alongside the preview
tokens -- one entry, the last one (a buffer of recent refactorings is deliberately
left for later). A reconnect starts a fresh SessionTemps and so a fresh, empty undo.
"
Class {
	#name : 'GsRefactoringUndo',
	#superclass : 'Object',
	#instVars : [
		'label',
		'engineName',
		'sequence',
		'changeSet',
		'reverseOp',
		'reverseRef'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'constants' }
GsRefactoringUndo class >> entryKey [
	"The SessionTemps key the single undo entry lives under."
	^#GsRefactoringLastUndo
]

{ #category : 'constants' }
GsRefactoringUndo class >> sequenceKey [
	"The SessionTemps key holding the monotonic per-session entry counter. It keeps
	 counting up across a cleared entry, so a stale client label can never look current."
	^#GsRefactoringUndoSequence
]

{ #category : 'constants' }
GsRefactoringUndo class >> methodKinds [
	"The change kinds this Tier-1 undo can reverse. Anything else means the refactoring
	 reshaped a class, and no entry is recorded -- see the class comment."
	^#(#methodAdd #methodRemove #methodRecompile #methodRename)
]

{ #category : 'accessing' }
GsRefactoringUndo class >> currentEntry [
	"The most recent undo entry, or nil when there is nothing to undo."
	^SessionTemps current at: self entryKey ifAbsent: [nil]
]

{ #category : 'accessing' }
GsRefactoringUndo class >> clear [
	"Forget the recorded undo (there is nothing to undo any more)."
	SessionTemps current removeKey: self entryKey ifAbsent: [].
	^'ok'
]

{ #category : 'accessing' }
GsRefactoringUndo class >> nextSequence [
	| n |
	n := (SessionTemps current at: self sequenceKey ifAbsent: [0]) + 1.
	SessionTemps current at: self sequenceKey put: n.
	^n
]

{ #category : 'accessing' }
GsRefactoringUndo class >> statusJson [
	"What the client polls to decide whether to offer Undo (and what to call it):

	   { available: true, label: .., engine: .., sequence: N, total: N }
	   { available: false }"
	| undo |
	undo := self currentEntry.
	undo isNil ifTrue: [^'{"available":false}'].
	^undo statusJson
]

{ #category : 'recording' }
GsRefactoringUndo class >> recordAndApplyForToken: token engine: engineName deselected: deselectedIds label: aLabel [
	"Apply a previously-started preview (by token, exactly as the engine's own
	 applyForToken:deselected: does) and RECORD how to put it back. Answers the
	 refactoring's own apply-result envelope, with one extra field appended:
	 an undoRecorded boolean, so the client knows whether to offer Undo without a
	 second round trip.

	 Recording is strictly best-effort and never allowed to break an apply: if the
	 snapshot or the diff raises, the previous entry is cleared (never left stale) and
	 the apply's own result is returned unchanged."
	| ref slots before result after undo recorded |
	ref := SessionTemps current at: token asSymbol ifAbsent: [nil].
	ref isNil ifTrue: [^'{"applied":0,"failed":[],"error":"preview session expired","undoRecorded":false}'].
	slots := [self slotsTouchedIn: ref changeSet deselected: deselectedIds] on: Error do: [:ex | nil].
	before := slots isNil ifTrue: [nil] ifFalse: [[self snapshot: slots] on: Error do: [:ex | nil]].
	"The apply itself is NEVER wrapped: it must behave exactly as it does without undo."
	result := ref applyDeselected: deselectedIds.
	recorded := false.
	before isNil
		ifTrue: [self clear]
		ifFalse: [
			[after := self snapshot: slots.
			 undo := self entryFrom: before to: after label: aLabel engine: engineName.
			 undo isNil
				ifTrue: [self clear]
				ifFalse: [
					SessionTemps current at: self entryKey put: undo.
					recorded := true]]
				on: Error do: [:ex | self clear]].
	^self result: result withUndoRecorded: recorded
]

{ #category : 'recording' }
GsRefactoringUndo class >> reversibleKinds [
	"The operation kinds a #mirror entry can reverse. Each names an engine whose forward
	 operation has an exact opposite the same engine already performs -- a rename with the two
	 names swapped, or an add/remove flipped."
	^#(#classRename #instVarRename #classVarRename #instVarAdd #instVarRemove)
]

{ #category : 'recording' }
GsRefactoringUndo class >> deselectionFor: aKind [
	"What un-ticking a row in the preview MEANS for this kind. The three answers are genuinely
	 different and a client that treats them alike will mislead:

	   #perChange   -- the change is simply not applied (rename class)
	   #dropsMethod -- the method is NOT carried onto the new class version, i.e. it is DELETED
	                   (rename instance variable: that is the only way a method disappears there)
	   #ignored     -- the engine applies its whole change set regardless; un-ticking does
	                   nothing at all (rename class variable, add/remove instance variable --
	                   the shape edits and descendant re-parents must move together)

	 So `#ignored` rows must render disabled rather than invite a click that silently does
	 nothing, and `#dropsMethod` must not be described as 'un-tick what you want to keep' --
	 there, un-ticking is what throws it away."
	| kind |
	kind := aKind asSymbol.
	kind == #classRename ifTrue: [^#perChange].
	kind == #instVarRename ifTrue: [^#dropsMethod].
	^#ignored
]

{ #category : 'recording' }
GsRefactoringUndo class >> recordReverseRename: aKind className: cn from: fromName to: toName scopeKind: sk scopeDictName: sdn label: aLabel engine: engineName [
	"Record that a reversible operation was applied, so it can be reversed by re-applying the
	 opposite one. Named for its first use (renames); it now also records instance-variable
	 add/remove, whose opposite is the other operation of the same engine.

	 `cn` is the class to look the operation up on AFTERWARDS. For a rename, `fromName` is the
	 name in force now and `toName` the name to go back to. For an add/remove, `fromName` is the
	 instance-variable name and `toName` is unused. Answers 'ok', or 'unsupported' for a kind
	 this cannot reverse (recording nothing rather than recording something wrong).

	 The caller records this only once the forward apply has actually landed -- see the
	 client's rename flows, which check the apply result first."
	| kind op |
	kind := aKind asSymbol.
	(self reversibleKinds asIdentitySet includes: kind) ifFalse: [^'unsupported'].
	"Filled slot by slot rather than with a six-argument `Array with:...`: 3.6.2's Array class
	 does not implement past four (MessageNotUnderstood 2010), so the longer forms are a 3.7-only
	 convenience the matrix cannot use."
	op := Array new: 6.
	op at: 1 put: kind.
	op at: 2 put: cn asString.
	op at: 3 put: fromName asString.
	op at: 4 put: toName asString.
	op at: 5 put: (sk isNil ifTrue: [nil] ifFalse: [sk asSymbol]).
	op at: 6 put: (sdn isNil ifTrue: [nil] ifFalse: [sdn asString]).
	SessionTemps current
		at: self entryKey
		put: (self new
			setLabel: aLabel
			engine: engineName
			sequence: self nextSequence
			reverseOp: op).
	^'ok'
]

{ #category : 'recording' }
GsRefactoringUndo class >> result: aJsonString withUndoRecorded: aBoolean [
	"Append an undoRecorded:<bool> field to an apply-result envelope. The engines build that
	 envelope as a string, so this splices the field in before the closing brace rather
	 than re-parsing it. A payload that is not shaped like an object is passed through
	 untouched -- the apply's own answer always matters more than this annotation."
	| s i |
	s := aJsonString.
	(s isNil or: [s isEmpty]) ifTrue: [^s].
	i := s size.
	[i > 0 and: [(s at: i) isSeparator]] whileTrue: [i := i - 1].
	(i > 0 and: [(s at: i) == $}]) ifFalse: [^s].
	^(s copyFrom: 1 to: i - 1), ',"undoRecorded":',
		(aBoolean ifTrue: ['true'] ifFalse: ['false']), '}'
]

{ #category : 'recording' }
GsRefactoringUndo class >> slotsTouchedIn: aChangeSet deselected: deselectedIds [
	"Every METHOD SLOT the about-to-be-applied changes touch, de-duplicated: an Array of
	 (dictName, className, isMeta, selector). Answers nil -- meaning 'do not record an
	 undo' -- when any applying change is not a method change (see the class comment).

	 A #methodRename touches TWO slots on the same class: the old selector (removed) and
	 the new one (compiled), so both are snapshotted.

	 Ids are compared as Symbols: a deselected id arrives as a string literal, which on
	 3.6.x is a Unicode string, and comparing it to the byte-string change id would raise
	 (the 3.6.2 Unicode-comparison trap). asSymbol canonicalises both."
	| ids kinds slots seen |
	ids := (deselectedIds collect: [:e | e asSymbol]) asIdentitySet.
	kinds := self methodKinds asIdentitySet.
	slots := OrderedCollection new.
	seen := Set new.
	aChangeSet changes do: [:change |
		(ids includes: change id asSymbol) ifFalse: [
			(kinds includes: change kind asSymbol) ifFalse: [^nil].
			self add: change selector forChange: change to: slots seen: seen.
			change newSelector isNil ifFalse: [
				self add: change newSelector forChange: change to: slots seen: seen]]].
	^slots asArray
]

{ #category : 'recording' }
GsRefactoringUndo class >> add: aSelector forChange: aChange to: slots seen: seen [
	"Add the (class, side, selector) slot aChange addresses under aSelector, unless an
	 identical slot is already in the list."
	| meta key |
	aSelector isNil ifTrue: [^self].
	meta := aChange isMeta == true.
	key := aChange className asString, (meta ifTrue: [' class>>'] ifFalse: ['>>']), aSelector asString.
	(seen includes: key) ifTrue: [^self].
	seen add: key.
	slots add: (Array
		with: aChange dictName
		with: aChange className asString
		with: meta
		with: aSelector asString)
]

{ #category : 'recording' }
GsRefactoringUndo class >> snapshot: slots [
	"The LIVE state of each slot right now: an Array, parallel to slots, of
	 (slot, exists, source, category). A class that cannot be resolved -- or a selector
	 the class does not implement -- reads as 'does not exist', which is exactly what the
	 diff needs."
	| env |
	env := GsRefactoringEnvironment new.
	^slots collect: [:slot | | cls target m |
		cls := env classNamed: (slot at: 2).
		target := cls isNil
			ifTrue: [nil]
			ifFalse: [(slot at: 3) ifTrue: [cls class] ifFalse: [cls]].
		m := target isNil
			ifTrue: [nil]
			ifFalse: [target compiledMethodAt: (slot at: 4) asSymbol environmentId: 0 otherwise: nil].
		Array
			with: slot
			with: m notNil
			with: (m isNil ifTrue: [nil] ifFalse: [m sourceString])
			with: (m isNil
				ifTrue: [nil]
				ifFalse: [(target categoryOfSelector: (slot at: 4) asSymbol environmentId: 0)
					ifNotNil: [:c | c asString]])]
]

{ #category : 'recording' }
GsRefactoringUndo class >> entryFrom: beforeStates to: afterStates label: aLabel engine: engineName [
	"The inverse change set for what actually changed between the two snapshots, wrapped
	 in an entry -- or nil when nothing changed (every staged change failed, or the apply
	 was a no-op), in which case there is nothing to offer an undo for.

	 Three ordered passes, so an undo restores before it deletes:
	   1. methods that EXISTED and are now GONE       -> #methodAdd  (put them back)
	   2. methods that exist BOTH sides but differ    -> #methodRecompile (old source)
	   3. methods that did NOT exist and now DO       -> #methodRemove (take them away)"
	| cs |
	cs := GsRefactoringChangeSet new.
	1 to: beforeStates size do: [:i | | b a |
		b := beforeStates at: i.
		a := afterStates at: i.
		((b at: 2) and: [(a at: 2) not])
			ifTrue: [self stageRestore: b in: cs]].
	1 to: beforeStates size do: [:i | | b a |
		b := beforeStates at: i.
		a := afterStates at: i.
		((b at: 2) and: [a at: 2])
			ifTrue: [(self source: (b at: 3) matches: (a at: 3))
				ifFalse: [self stageRecompile: b over: a in: cs]]].
	1 to: beforeStates size do: [:i | | b a |
		b := beforeStates at: i.
		a := afterStates at: i.
		((b at: 2) not and: [a at: 2])
			ifTrue: [self stageRemove: a in: cs]].
	cs isEmpty ifTrue: [^nil].
	^self new setLabel: aLabel engine: engineName sequence: self nextSequence changeSet: cs
]

{ #category : 'recording' }
GsRefactoringUndo class >> stageRestore: aState in: aChangeSet [
	"Put back a method the refactoring removed. oldSource is nil (it is not there now), so
	 the client's diff renders it as an all-added method -- which is what undoing it does."
	| slot |
	slot := aState at: 1.
	aChangeSet
		addMethodAddInDictionary: (slot at: 1)
		className: (slot at: 2)
		isMeta: (slot at: 3)
		selector: (slot at: 4)
		category: (aState at: 4)
		newSource: (aState at: 3)
]

{ #category : 'recording' }
GsRefactoringUndo class >> stageRecompile: beforeState over: afterState in: aChangeSet [
	"Recompile a method the refactoring rewrote, back to its earlier source and category.
	 oldSource is what the refactoring LEFT (so the diff reads forward: what is there now
	 -> what undoing restores)."
	| slot |
	slot := beforeState at: 1.
	aChangeSet
		addMethodRecompileInDictionary: (slot at: 1)
		className: (slot at: 2)
		isMeta: (slot at: 3)
		selector: (slot at: 4)
		category: (beforeState at: 4)
		oldSource: (afterState at: 3)
		newSource: (beforeState at: 3)
]

{ #category : 'recording' }
GsRefactoringUndo class >> stageRemove: afterState in: aChangeSet [
	"Remove a method the refactoring created. oldSource is what it created, so the diff
	 renders it as an all-removed method."
	| slot |
	slot := afterState at: 1.
	aChangeSet
		addMethodRemoveInDictionary: (slot at: 1)
		className: (slot at: 2)
		isMeta: (slot at: 3)
		selector: (slot at: 4)
		category: (afterState at: 4)
		oldSource: (afterState at: 3)
]

{ #category : 'comparing' }
GsRefactoringUndo class >> source: a matches: b [
	"Whether two method sources are the same text, comparing CHARACTER BY CHARACTER
	 (a GemStone Character is unique per code point, so == is exact). Written this way
	 rather than as `a = b` deliberately: on 3.6.x comparing a byte String against a
	 Unicode-promoted one raises (error 2718) instead of answering false, and a source
	 read back from a recompiled method is not guaranteed to be the same String class as
	 the one read before it."
	(a isNil or: [b isNil]) ifTrue: [^a isNil and: [b isNil]].
	a size = b size ifFalse: [^false].
	1 to: a size do: [:i | ((a at: i) == (b at: i)) ifFalse: [^false]].
	^true
]

{ #category : 'paginated preview' }
GsRefactoringUndo class >> startPreviewToken: token maxBytes: maxBytes [
	"Start a preview of the recorded undo, in exactly the envelope shape every forward
	 refactoring's preview uses (so the client parses and renders it the same way), plus
	 `label` / `engine` naming what is being undone. Re-checks each change against the
	 stone first, so drift is visible before anything is undone. Nothing is compiled."
	| undo |
	undo := self currentEntry.
	undo isNil ifTrue: [
		^'{"error":"There is no refactoring to undo in this session.",' ,
		  '"token":"","label":"","engine":"","total":0,' ,
		  '"page":{"changes":[],"nextOffset":0,"done":true}}'].
	"A recorded reversal that can no longer run refuses HERE, with the reason, rather than
	 opening a panel over an empty change set."
	undo reverseUnavailableReason ifNotNil: [:why |
		^'{"error":', (GsRefactoringJson jsonQuote: why),
		  ',"token":"","label":', (GsRefactoringJson jsonQuote: undo label),
		  ',"engine":"","mechanism":', (GsRefactoringJson jsonQuote: undo mechanism asString),
		  ',"deselection":', (GsRefactoringJson jsonQuote: undo deselection asString),
		  ',"dropCount":0',
		  ',"total":0,"page":{"changes":[],"nextOffset":0,"done":true}}'].
	undo refreshWarnings.
	SessionTemps current at: token asSymbol put: undo.
	^'{"token":', (GsRefactoringJson jsonQuote: token asString),
	  ',"label":', (GsRefactoringJson jsonQuote: undo label),
	  ',"engine":', (GsRefactoringJson jsonQuote: undo engineName),
	  ',"mechanism":', (GsRefactoringJson jsonQuote: undo mechanism asString),
	  ',"reverseKind":', (undo reverseKind
		ifNil: ['null']
		ifNotNil: [:k | GsRefactoringJson jsonQuote: k asString]),
	  ',"deselection":', (GsRefactoringJson jsonQuote: undo deselection asString),
	  ',"dropCount":', undo mirrorDropCount printString,
	  ',"sequence":', undo sequence printString,
	  ',"drifted":', undo driftedCount printString,
	  ',"total":', undo size printString,
	  ',"page":', (undo pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'paginated preview' }
GsRefactoringUndo class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	"A page from a started undo preview, by token."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:undo | undo pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'applying' }
GsRefactoringUndo class >> applyForToken: token deselected: deselectedIds [
	"Apply a started undo preview (by token), skipping deselectedIds. No commit."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:undo | undo applyDeselected: deselectedIds]
]

{ #category : 'paginated preview' }
GsRefactoringUndo class >> clearToken: token [
	"Drop a finished undo preview from SessionTemps. The recorded ENTRY is untouched --
	 closing the preview must not throw the undo away."
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'accessing' }
GsRefactoringUndo >> changeSet [
	"The INVERSE change set: applying it puts the refactoring back."
	^changeSet
]

{ #category : 'accessing' }
GsRefactoringUndo >> engineName [
	^engineName ifNil: ['']
]

{ #category : 'accessing' }
GsRefactoringUndo >> label [
	"What the refactoring that is being undone called itself, supplied by the client at
	 apply time (it is the side that knows -- e.g. 'Rename #total to #sum')."
	^label ifNil: ['the last refactoring']
]

{ #category : 'accessing' }
GsRefactoringUndo >> sequence [
	^sequence ifNil: [0]
]

{ #category : 'accessing' }
GsRefactoringUndo >> size [
	"How many changes the reversal would apply. For a #mirror that means building the
	 reverse rename, which is why callers that only want a cheap yes/no ask `mechanism`."
	^reverseOp isNil ifTrue: [changeSet size] ifFalse: [self reverseChangeSet size]
]

{ #category : 'accessing' }
GsRefactoringUndo >> mechanism [
	"#changeSet -- apply the recorded inverse change set; #mirror -- rebuild the SAME engine
	 performing the opposite operation and apply that. See the class comment."
	^reverseOp isNil ifTrue: [#changeSet] ifFalse: [#mirror]
]

{ #category : 'accessing' }
GsRefactoringUndo >> reverseKind [
	"Which operation is being mirrored, or nil for a change-set entry. The client picks its
	 caveat wording from this -- the honest caveat differs per kind."
	^reverseOp isNil ifTrue: [nil] ifFalse: [reverseOp at: 1]
]

{ #category : 'accessing' }
GsRefactoringUndo >> deselection [
	"See GsRefactoringUndo class>>deselectionFor:. A change-set entry is always #perChange."
	^reverseOp isNil
		ifTrue: [#perChange]
		ifFalse: [GsRefactoringUndo deselectionFor: (reverseOp at: 1)]
]

{ #category : 'reverse rename' }
GsRefactoringUndo >> mirrorDropCount [
	"How many methods the reversal is predicted to DELETE, for the one kind that can: reversing
	 an instance-variable ADD means REMOVING that variable, and any method written since that
	 uses it cannot be recompiled and is dropped. Answers 0 for every other kind. Surfaced so
	 the client can say the number before the user commits to it."
	| ref |
	self reverseKind == #instVarAdd ifFalse: [^0].
	ref := self reverseRefactoring.
	^(ref notNil and: [ref respondsTo: #willNotRecompileSelectorCount])
		ifTrue: [ref willNotRecompileSelectorCount]
		ifFalse: [0]
]

{ #category : 'accessing' }
GsRefactoringUndo >> reverseOp [
	"(kind, className, fromName, toName, scopeKind, scopeDictName), or nil for a change-set
	 entry."
	^reverseOp
]

{ #category : 'reverse rename' }
GsRefactoringUndo >> reverseRefactoring [
	"The rename refactoring that undoes the recorded one, built ONCE and cached: the preview
	 and the apply must run against the SAME object, or the apply would re-derive a change set
	 from a stone the preview has already described (and the change ids the client deselected
	 would not match). Answers nil when the class can no longer be resolved."
	| env cls kind |
	reverseRef isNil ifFalse: [^reverseRef].
	reverseOp isNil ifTrue: [^nil].
	env := GsRefactoringEnvironment new.
	cls := env classNamed: (reverseOp at: 2).
	cls isNil ifTrue: [^nil].
	kind := reverseOp at: 1.
	kind == #classRename ifTrue: [
		reverseRef := (reverseOp at: 5) == #dictionary
			ifTrue: [GsRenameClassRefactoring
				class: cls renameTo: (reverseOp at: 4) dictionaryScope: (reverseOp at: 6)]
			ifFalse: [GsRenameClassRefactoring
				class: cls renameTo: (reverseOp at: 4)
				scope: ((reverseOp at: 5) ifNil: [#wholeSystem])]].
	kind == #instVarRename ifTrue: [
		reverseRef := GsRenameInstanceVariableRefactoring
			class: cls renameInstVar: (reverseOp at: 3) to: (reverseOp at: 4)].
	kind == #classVarRename ifTrue: [
		reverseRef := GsRenameClassVariableRefactoring
			class: cls renameClassVar: (reverseOp at: 3) to: (reverseOp at: 4)].
	"An add and a remove are each other's opposite, performed by the same engine."
	kind == #instVarAdd ifTrue: [
		reverseRef := GsInstVarRefactoring class: cls removeInstVar: (reverseOp at: 3)].
	kind == #instVarRemove ifTrue: [
		reverseRef := GsInstVarRefactoring class: cls addInstVar: (reverseOp at: 3)].
	^reverseRef
]

{ #category : 'reverse rename' }
GsRefactoringUndo >> reverseChangeSet [
	"The change set the reversal would apply -- the reverse rename's own -- or an empty one
	 when the reversal cannot be built (the class is gone)."
	^self reverseRefactoring
		ifNil: [GsRefactoringChangeSet new]
		ifNotNil: [:ref | ref changeSet]
]

{ #category : 'reverse rename' }
GsRefactoringUndo >> reverseUnavailableReason [
	"Why the recorded reversal cannot run, or nil when it can. Answered BEFORE a preview so the
	 client refuses with a reason instead of opening a panel over a reversal that would fail.

	 The COLLISION check here is load-bearing, not belt-and-braces. The rename engines
	 deliberately do NOT enforce `newNameCollision` while building a change set -- the forward
	 flow's preview panel surfaces it and the CLIENT refuses (see
	 GsRenameClassRefactoring>>newNameCollision: 'the apply would fail'). A reversal is driven
	 from here, not from that panel, so without this check the guard would simply be absent and
	 the reversal would fail partway through instead of declining. Reachable in practice: rename
	 A to B, then create something new called A, then try to reverse."
	| env cls ref |
	reverseOp isNil ifTrue: [^nil].
	env := GsRefactoringEnvironment new.
	cls := env classNamed: (reverseOp at: 2).
	cls isNil ifTrue: [
		^'Class ', (reverseOp at: 2), ' no longer exists, so the rename cannot be reversed.'].
	"An instance-variable rename has no collision check of its own, so make the one that matters
	 here explicitly: the name we would rename back TO must not already be declared."
	(reverseOp at: 1) == #instVarRename ifTrue: [
		((env ownInstVarNamesOf: cls) includes: (reverseOp at: 4)) ifTrue: [
			^'Cannot rename back: ', (reverseOp at: 2), ' already declares an instance variable named ',
			  (reverseOp at: 4), '.']].
	"Reversing an ADD means removing the variable -- pointless, and misleading to offer, if it is
	 no longer there. Reversing a REMOVE means adding it back, which duplicates it if something
	 has re-declared the name (the class-creation primitive rejects that mid-apply, error 2271)."
	(reverseOp at: 1) == #instVarAdd ifTrue: [
		((env ownInstVarNamesOf: cls) includes: (reverseOp at: 3)) ifFalse: [
			^(reverseOp at: 2), ' no longer declares an instance variable named ', (reverseOp at: 3),
			  ', so there is nothing to take back out.']].
	(reverseOp at: 1) == #instVarRemove ifTrue: [
		((env ownInstVarNamesOf: cls) includes: (reverseOp at: 3)) ifTrue: [
			^(reverseOp at: 2), ' already declares an instance variable named ', (reverseOp at: 3),
			  ' again, so it cannot be added back.']].
	ref := self reverseRefactoring.
	ref isNil ifTrue: [
		^'The reversal of this rename can no longer be built.'].
	((ref respondsTo: #newNameCollision) and: [ref newNameCollision notNil]) ifTrue: [
		^'Cannot rename back: ', ref newNameCollision, '.'].
	self reverseChangeSet isEmpty ifTrue: [
		^'Nothing to reverse: ', (reverseOp at: 3), ' is no longer named that.'].
	^nil
]

{ #category : 'accessing' }
GsRefactoringUndo >> statusJson [
	"`mechanism` lets the client word the offer honestly without a second round trip: a
	 #mirror is a reversal, not a rollback."
	^'{"available":true,"label":', (GsRefactoringJson jsonQuote: self label),
	  ',"engine":', (GsRefactoringJson jsonQuote: self engineName),
	  ',"mechanism":', (GsRefactoringJson jsonQuote: self mechanism asString),
	  ',"reverseKind":', (self reverseKind
		ifNil: ['null']
		ifNotNil: [:k | GsRefactoringJson jsonQuote: k asString]),
	  ',"sequence":', self sequence printString,
	  ',"total":', self size printString, '}'
]

{ #category : 'drift' }
GsRefactoringUndo >> refreshWarnings [
	"Re-read the stone and warn, per change, where undoing is not a clean reversal:
	 the method was edited after the refactoring (undoing discards those edits), or it is
	 already in the state the undo would put it in (undoing it changes nothing). Warnings
	 render on the existing per-change preview rows, so the user deselects what to keep."
	| env |
	"A #mirror has no per-change drift to report: its change set is derived from the stone
	 as it is RIGHT NOW, by the same engine that would apply it, so every row is current by
	 construction. Its one caveat is not per-change (it is 'this renames again rather than
	 rolling back') and the client states it once, above the list."
	reverseOp isNil ifFalse: [^self].
	env := GsRefactoringEnvironment new.
	changeSet changes do: [:change |
		change setWarning: (self warningFor: change in: env)]
]

{ #category : 'drift' }
GsRefactoringUndo >> warningFor: aChange in: env [
	"The drift warning for one inverse change, or nil when undoing it is clean."
	| cls target live |
	cls := env classNamed: aChange className.
	cls isNil ifTrue: [^'Class ', aChange className asString, ' no longer exists; this cannot be undone.'].
	target := aChange isMeta == true ifTrue: [cls class] ifFalse: [cls].
	live := target compiledMethodAt: aChange selector asSymbol environmentId: 0 otherwise: nil.
	aChange kind == #methodAdd ifTrue: [
		live isNil ifTrue: [^nil].
		^(GsRefactoringUndo source: live sourceString matches: aChange newSource)
			ifTrue: ['Already back to its pre-refactoring source; undoing it changes nothing.']
			ifFalse: ['A method of this name exists again; undoing REPLACES it with the pre-refactoring source.']].
	aChange kind == #methodRemove ifTrue: [
		live isNil ifTrue: [^'Already gone; undoing it changes nothing.'].
		^(GsRefactoringUndo source: live sourceString matches: aChange oldSource)
			ifTrue: [nil]
			ifFalse: ['Edited since the refactoring; undoing DELETES the method, edits and all.']].
	"#methodRecompile"
	live isNil ifTrue: [^'Removed since the refactoring; undoing it compiles the method back.'].
	(GsRefactoringUndo source: live sourceString matches: aChange oldSource) ifTrue: [^nil].
	^(GsRefactoringUndo source: live sourceString matches: aChange newSource)
		ifTrue: ['Already back to its pre-refactoring source; undoing it changes nothing.']
		ifFalse: ['Edited since the refactoring; undoing DISCARDS those edits.']
]

{ #category : 'drift' }
GsRefactoringUndo >> driftedCount [
	"How many changes currently carry a warning. Summarised at the top of the preview so
	 the user is told BEFORE scrolling that the undo is not a clean reversal."
	reverseOp isNil ifFalse: [^0].
	^(changeSet changes select: [:c | c warning notNil]) size
]

{ #category : 'paginated preview' }
GsRefactoringUndo >> pageJsonFrom: startIndex maxBytes: maxBytes [
	"One page of the changes the reversal would apply, byte-bounded exactly as the forward
	 previews are, so a large undo still fits the non-blocking GCI fetch cap. For a
	 #mirror those are the mirrored operation's OWN changes, which is why the client's
	 preview has to accept class-shape kinds as well as method ones."
	| all ws i |
	all := (reverseOp isNil ifTrue: [changeSet] ifFalse: [self reverseChangeSet]) changes.
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
GsRefactoringUndo >> applyChange: aChange [
	"Reverse one slot in the stone WITHOUT committing: compile the restored source, or
	 remove a method the refactoring created. Compiling goes through the environment,
	 which RAISES on a compile failure -- so a failure is recorded in `failed` rather
	 than counted as a successful undo."
	| env cls target |
	env := GsRefactoringEnvironment new.
	cls := env classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className asString].
	target := aChange isMeta == true ifTrue: [cls class] ifFalse: [cls].
	aChange kind == #methodRemove ifTrue: [
		"Idempotent: a method already gone (undone twice, or removed by hand) is not an
		 error -- the slot is in the state the undo wants it in."
		(target compiledMethodAt: aChange selector asSymbol environmentId: 0 otherwise: nil)
			ifNotNil: [:m | target removeSelector: aChange selector asSymbol].
		^self].
	env
		compile: aChange newSource
		into: target
		category: (aChange category ifNil: ['as yet unclassified'])
]

{ #category : 'applying' }
GsRefactoringUndo >> applyDeselected: deselectedIds [
	"Apply every inverse change EXCEPT those whose id is in deselectedIds, in the stone,
	 WITHOUT committing (the user commits explicitly -- undoing a committed refactoring
	 needs its own commit, exactly like the refactoring did). Answers the same
	 {applied, failed} envelope every forward apply answers.

	 A CLEAN undo (nothing deselected, nothing failed) drops the entry: it has been used
	 up. A partial or failed one keeps it, so the user can look at what went wrong and
	 try again -- re-applying the same inverse set is idempotent."
	| ids applied failures |
	"A #mirror is applied by the mirrored engine itself -- the same code path the forward operation
	 uses, so the reversal cannot drift from the operation it reverses. A clean one is used up,
	 exactly as below."
	reverseOp isNil ifFalse: [
		| ref result kind |
		ref := self reverseRefactoring.
		ref isNil ifTrue: [
			^'{"applied":0,"failed":[],"error":"the class this operation applied to no longer exists"}'].
		kind := reverseOp at: 1.
		"The instance-variable engine takes a wider apply signature and has no plain
		 applyDeselected:. migrate and deleteHistory are hardcoded FALSE and must stay that way:
		 both COMMIT, and both are the two genuinely irreversible options in the whole family --
		 a migration moves user data and deleting history destroys what any later reversal would
		 need. A reversal must never be the thing that makes the stone unrecoverable. nil options
		 keeps the class's current compile options."
		result := (kind == #instVarAdd or: [kind == #instVarRemove])
			ifTrue: [ref applyDeselected: #() options: nil migrate: false deleteHistory: false]
			ifFalse: [ref applyDeselected: deselectedIds].
		(deselectedIds isEmpty and: [(result indexOfSubCollection: '"failed":[]') > 0])
			ifTrue: [GsRefactoringUndo clear].
		^result].
	ids := (deselectedIds collect: [:e | e asSymbol]) asIdentitySet.
	applied := 0.
	failures := OrderedCollection new.
	changeSet changes do: [:change |
		(ids includes: change id asSymbol) ifFalse: [
			[self applyChange: change. applied := applied + 1]
			on: Error do: [:e |
				failures add: (Array with: change id with: change failureLabel with: e messageText)]]].
	(failures isEmpty and: [ids isEmpty])
		ifTrue: [GsRefactoringUndo clear].
	^'{"applied":', applied printString, ',"failed":[',
	  ((failures collect: [:f |
		'{"id":', (GsRefactoringJson jsonQuote: (f at: 1) asString),
		',"label":', (GsRefactoringJson jsonQuote: (f at: 2) asString),
		',"error":', (GsRefactoringJson jsonQuote: ((f at: 3) ifNil: ['unknown error']) asString), '}'])
			inject: '' into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ',', s]]),
	  ']}'
]

{ #category : 'private' }
GsRefactoringUndo >> setLabel: aLabel engine: anEngineName sequence: aSequence reverseOp: anArray [
	label := aLabel isNil ifTrue: [nil] ifFalse: [aLabel asString].
	engineName := anEngineName isNil ifTrue: [nil] ifFalse: [anEngineName asString].
	sequence := aSequence.
	reverseOp := anArray
]

{ #category : 'private' }
GsRefactoringUndo >> setLabel: aLabel engine: anEngineName sequence: aSequence changeSet: aChangeSet [
	label := aLabel isNil ifTrue: [nil] ifFalse: [aLabel asString].
	engineName := anEngineName isNil ifTrue: [nil] ifFalse: [anEngineName asString].
	sequence := aSequence.
	changeSet := aChangeSet
]
