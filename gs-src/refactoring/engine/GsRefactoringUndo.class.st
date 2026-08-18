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

Scope (Tier 1 of #434)
----------------------
METHOD changes only -- #methodAdd, #methodRemove, #methodRecompile, #methodRename.
If the change set holds anything that reshapes a CLASS (#classAdd, #classRename,
#classReparent, #classDefinitionEdit) NO undo entry is recorded at all, and the
apply's own result is returned unchanged: half an undo is worse than none, and
class shape wants the classHistory revert path instead (see
GsClassHistory>>revertClassNamed:toIndex:). The apply result's undoRecorded field
reports which it was, so the client can say so rather than silently offering nothing.

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
		'changeSet'
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
	undo refreshWarnings.
	SessionTemps current at: token asSymbol put: undo.
	^'{"token":', (GsRefactoringJson jsonQuote: token asString),
	  ',"label":', (GsRefactoringJson jsonQuote: undo label),
	  ',"engine":', (GsRefactoringJson jsonQuote: undo engineName),
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
	^changeSet size
]

{ #category : 'accessing' }
GsRefactoringUndo >> statusJson [
	^'{"available":true,"label":', (GsRefactoringJson jsonQuote: self label),
	  ',"engine":', (GsRefactoringJson jsonQuote: self engineName),
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
	^(changeSet changes select: [:c | c warning notNil]) size
]

{ #category : 'paginated preview' }
GsRefactoringUndo >> pageJsonFrom: startIndex maxBytes: maxBytes [
	"One page of inverse changes, byte-bounded exactly as the forward previews are, so a
	 large undo still fits the non-blocking GCI fetch cap."
	| all ws i |
	all := changeSet changes.
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
GsRefactoringUndo >> setLabel: aLabel engine: anEngineName sequence: aSequence changeSet: aChangeSet [
	label := aLabel isNil ifTrue: [nil] ifFalse: [aLabel asString].
	engineName := anEngineName isNil ifTrue: [nil] ifFalse: [anEngineName asString].
	sequence := aSequence.
	changeSet := aChangeSet
]
