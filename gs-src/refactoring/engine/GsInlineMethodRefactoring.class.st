"
Inline a single self/super message send at the cursor (M2): replace that one send
with the called method's body, substituting the send's argument expressions for the
called method's parameters. The called method is left in place -- EXCEPT when the
inlined call was its LAST remaining sender, in which case a second, DESELECTABLE
#methodRemove is staged to delete the now-unused method.

The refactoring is addressed by class + selector + isMeta + a 1-based source OFFSET
(the editor caret) that lands on a message send. Resolution, all symbol-identity:

  - RBParser parses the editing method; `tree bestNodeFor: (offset to: offset)` then
    the nearest enclosing RBMessageNode is the send to inline;
  - the receiver must be self or super, so the target resolves unambiguously by a
    hierarchy walk (self: from the editing class; super: from its superclass) to the
    first implementor -- anything else is DECLINED;
  - the target must reduce to a SINGLE expression (an accessor / computed one-liner):
    one statement that is ^expr or a bare expr, no temporaries, no early return, no
    super/thisContext in the body, no pragma. Anything richer is DECLINED (deferred).

The inline is also DECLINED when a target parameter used more than once would be
handed a side-effecting (non-atomic) argument, or when the send's value is used but
the target returns self. Building the change set compiles nothing and commits
nothing; the server-side apply recompiles the caller (always) and removes the target
(only when the removal is kept), but NEVER commits (the user commits explicitly).
"
Class {
	#name : 'GsInlineMethodRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'definingClass',
		'selector',
		'isMeta',
		'offset',
		'changeSet',
		'analysisDone',
		'sendNode',
		'targetClass',
		'targetSelector',
		'targetSource',
		'targetReturnsValue',
		'inlinedExpr',
		'lastSender',
		'declineString'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsInlineMethodRefactoring class >> class: aClass selector: aSelector meta: aBool atOffset: anOffset [
	"Inline the self/super send at anOffset (a 1-based character index into
	 aClass>>aSelector's source)."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		selector: aSelector
		meta: aBool
		atOffset: anOffset
]

{ #category : 'instance creation' }
GsInlineMethodRefactoring class >> environment: anEnvironment class: aClass selector: aSelector meta: aBool atOffset: anOffset [
	^self new
		setEnvironment: anEnvironment
		class: aClass
		selector: aSelector
		meta: aBool
		atOffset: anOffset
]

{ #category : 'preconditions' }
GsInlineMethodRefactoring class >> analyzeSendForClass: aClass selector: aSelector meta: aBool atOffset: anOffset [
	"A pre-flight the client runs before opening the preview: the target class and
	 selector the send resolves to, whether the inlined call is the target's last
	 sender (so a delete will be offered), and a decline reason if the send cannot be
	 inlined."
	^(self
		class: aClass
		selector: aSelector
		meta: aBool
		atOffset: anOffset) analysisJsonString
]

{ #category : 'paginated preview' }
GsInlineMethodRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	"A page from a previously-started preview (see startPreviewToken:maxBytes:), by
	 token. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'paginated preview' }
GsInlineMethodRefactoring class >> applyForToken: token deselected: deselectedIds [
	"Apply a previously-started preview (by token). No commit. Answers an error
	 envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'paginated preview' }
GsInlineMethodRefactoring class >> clearToken: token [
	"Drop a finished preview from SessionTemps."
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'private' }
GsInlineMethodRefactoring >> setEnvironment: anEnvironment class: aClass selector: aSelector meta: aBool atOffset: anOffset [
	environment := anEnvironment.
	definingClass := aClass.
	selector := aSelector asSymbol.
	isMeta := aBool.
	offset := anOffset.
	analysisDone := false
]

{ #category : 'accessing' }
GsInlineMethodRefactoring >> environment [
	^environment
]

{ #category : 'accessing' }
GsInlineMethodRefactoring >> definingClass [
	^definingClass
]

{ #category : 'accessing' }
GsInlineMethodRefactoring >> selector [
	^selector
]

{ #category : 'accessing' }
GsInlineMethodRefactoring >> isMeta [
	^isMeta
]

{ #category : 'accessing' }
GsInlineMethodRefactoring >> targetSelector [
	self ensureAnalysis.
	^targetSelector
]

{ #category : 'accessing' }
GsInlineMethodRefactoring >> changeSet [
	"The staged, non-committing change set, computed once and cached. Empty when the
	 inline is declined."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'private' }
GsInlineMethodRefactoring >> sourceBehavior [
	"The behaviour that holds the method being edited: the metaclass for a class-side
	 method."
	^isMeta ifTrue: [definingClass class] ifFalse: [definingClass]
]

{ #category : 'private' }
GsInlineMethodRefactoring >> editingMethod [
	^self sourceBehavior compiledMethodAt: selector environmentId: 0 otherwise: nil
]

{ #category : 'private' }
GsInlineMethodRefactoring >> sourceString [
	"The stored source of the method being edited, or nil if it does not exist."
	| m |
	m := self editingMethod.
	^m isNil ifTrue: [nil] ifFalse: [m sourceString]
]

{ #category : 'private' }
GsInlineMethodRefactoring >> parseTree [
	"A fresh parse of the editing method source, or nil if it is missing or unparseable."
	| src |
	src := self sourceString.
	src isNil ifTrue: [^nil].
	^[RBParser parseMethod: src] on: Error do: [:e | nil]
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> ensureAnalysis [
	analysisDone ifFalse: [
		analysisDone := true.
		[self computeAnalysis] on: Error do: [:e |
			declineString := 'The inline could not be analysed: ', e messageText]]
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> declineWith: aReason [
	"Record a hard-decline reason and answer nil, so a caller can bail with
	 ^self declineWith: '...' from inside computeAnalysis."
	declineString := aReason.
	^nil
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> computeAnalysis [
	"Resolve the send at offset, require a self/super receiver and a single-expression
	 target, build the inlined expression (arguments substituted), then decide whether
	 this was the target's last sender. Sets declineString on any hard precondition."
	| tree msg recv |
	declineString := nil.
	lastSender := false.
	inlinedExpr := nil.
	tree := self parseTree.
	tree isNil ifTrue: [^self declineWith: 'The method source does not parse.'].
	msg := self messageSendAtOffsetIn: tree.
	msg isNil ifTrue: [^self declineWith: 'Place the cursor on a message send to inline it.'].
	sendNode := msg.
	(self isCascadeNode: msg parent)
		ifTrue: [^self declineWith: 'Inlining a cascaded send is not supported.'].
	recv := msg receiver.
	(self isSelfOrSuper: recv)
		ifFalse: [^self declineWith: 'Inline Method works only on a self or super send; the class of an arbitrary receiver is not known, so the method being called cannot be determined.'].
	self resolveTargetForReceiver: recv.
	declineString notNil ifTrue: [^nil].
	self computeInline.
	declineString notNil ifTrue: [^nil].
	self computeLastSender
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> messageSendAtOffsetIn: tree [
	"The message-send node under the caret. Tolerant of a caret that sits just past
	 the selector -- e.g. at the END of a double-clicked word, where the offset lands
	 on the following '.' or space rather than inside the send -- by also probing one
	 character to the left, then one to the right. Answers nil when no probe lands on
	 a send."
	| positions |
	positions := OrderedCollection new.
	positions add: offset.
	offset > 1 ifTrue: [positions add: offset - 1].
	positions add: offset + 1.
	positions do: [:pos | | node msg |
		node := [tree bestNodeFor: (pos to: pos)] on: Error do: [:e | nil].
		node notNil ifTrue: [
			msg := self enclosingMessageOf: node.
			msg notNil ifTrue: [^msg]]].
	^nil
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> enclosingMessageOf: aNode [
	"The nearest enclosing message-send node of aNode (aNode itself if it is one),
	 walking the parent chain -- or nil if there is no enclosing send."
	| n |
	n := aNode.
	[n notNil] whileTrue: [
		n isMessage ifTrue: [^n].
		n := n parent].
	^nil
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> isCascadeNode: aNode [
	"True if aNode is a cascade node. Guarded so it works whether or not the vendored
	 AST defines #isCascade."
	^aNode notNil and: [
		[aNode isCascade] on: Error do: [:e | aNode class name asString = 'RBCascadeNode']]
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> isSelfOrSuper: aNode [
	| s |
	(aNode notNil and: [aNode isVariable]) ifFalse: [^false].
	s := aNode name asSymbol.
	^s == #self or: [s == #super]
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> receiverIsSuper [
	^sendNode receiver name asSymbol == #super
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> resolveTargetForReceiver: recv [
	"Resolve the send's selector to its implementor: for a self send, from the editing
	 class up; for a super send, from the editing class's superclass up. Sets
	 targetClass / targetSelector / targetSource, or declines when no implementor is
	 found or its source is unavailable."
	| startClass impl |
	targetSelector := sendNode selector.
	startClass := self receiverIsSuper
		ifTrue: [self sourceBehavior superclass]
		ifFalse: [self sourceBehavior].
	impl := self implementorFrom: startClass.
	impl isNil ifTrue: [^self declineWith: 'No implementor of #', targetSelector asString, ' was found in the hierarchy.'].
	targetClass := impl.
	targetSource := (targetClass compiledMethodAt: targetSelector environmentId: 0 otherwise: nil)
		ifNil: [nil] ifNotNil: [:m | m sourceString].
	targetSource isNil ifTrue: [^self declineWith: 'The target method source is unavailable.']
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> implementorFrom: aClass [
	"The first class at or above aClass that implements targetSelector, or nil."
	| c |
	c := aClass.
	[c notNil] whileTrue: [
		(c includesSelector: targetSelector) ifTrue: [^c].
		c := c superclass].
	^nil
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> computeInline [
	"Parse the target, require the single-expression shape, and build inlinedExpr with
	 the send's arguments substituted for the target's parameters. Declines on any
	 unsupported shape or unsafe substitution."
	| ttree stmts stmt exprNode params |
	ttree := [RBParser parseMethod: targetSource] on: Error do: [:e | nil].
	ttree isNil ifTrue: [^self declineWith: 'The target method source does not parse.'].
	(self treeHasPragma: ttree)
		ifTrue: [^self declineWith: 'The target method is a primitive or has a pragma and cannot be inlined.'].
	stmts := ttree body statements.
	stmts size = 1
		ifFalse: [^self declineWith: 'Inline Method supports a single-expression method; ', targetSelector asString, ' has ', stmts size printString, ' statements.'].
	ttree body temporaries isEmpty
		ifFalse: [^self declineWith: 'The target method declares temporaries; multi-statement inlining is not supported yet.'].
	stmt := stmts first.
	stmt isReturn
		ifTrue: [targetReturnsValue := true. exprNode := stmt value]
		ifFalse: [targetReturnsValue := false. exprNode := stmt].
	(self node: exprNode containsReturn: true)
		ifTrue: [^self declineWith: 'The target method has an early return and cannot be inlined.'].
	(self node: exprNode referencesName: 'super')
		ifTrue: [^self declineWith: 'The target method sends to super and cannot be inlined here.'].
	(self node: exprNode referencesName: 'thisContext')
		ifTrue: [^self declineWith: 'The target method uses thisContext and cannot be inlined.'].
	(self sendValueIsUsed and: [targetReturnsValue not])
		ifTrue: [^self declineWith: 'The method ', targetSelector asString, ' does not return a value, but its result is used here.'].
	params := ttree arguments collect: [:a | a name].
	self buildInlinedExprFrom: exprNode params: params
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> node: aNode containsReturn: aBool [
	"True if aNode or any descendant is a return node (a ^ inside the extracted
	 expression, e.g. within a block)."
	aNode nodesDo: [:n | n isReturn ifTrue: [^true]].
	^false
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> node: aNode referencesName: aName [
	"True if aNode or any descendant is a variable node named aName."
	aNode nodesDo: [:n | (n isVariable and: [n name = aName]) ifTrue: [^true]].
	^false
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> treeHasPragma: aTree [
	| p |
	p := [aTree pragmas] on: Error do: [:e | nil].
	^p notNil and: [p notEmpty]
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> sendValueIsUsed [
	"True when the value produced by the send is consumed -- it is a return value, an
	 assignment value, or a message receiver/argument -- rather than a bare statement
	 whose value is discarded."
	| p |
	p := sendNode parent.
	p isNil ifTrue: [^false].
	p isSequence ifTrue: [^false].
	^true
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> buildInlinedExprFrom: exprNode params: params [
	"Build inlinedExpr from the target's body expression, splicing each parameter's
	 occurrence with the send's corresponding argument source (a non-atomic argument
	 parenthesised). Declines when a parameter used more than once would duplicate a
	 side-effecting argument."
	| exprSrc base occs |
	exprSrc := targetSource copyFrom: exprNode start to: exprNode stop.
	base := exprNode start.
	occs := OrderedCollection new.
	exprNode nodesDo: [:n |
		(n isVariable and: [params includes: n name]) ifTrue: [occs add: n]].
	"a parameter used more than once must be given a side-effect-free (atomic) argument"
	1 to: params size do: [:i | | pname count |
		pname := params at: i.
		count := (occs select: [:o | o name = pname]) size.
		(count > 1 and: [(self isAtomicArg: (sendNode arguments at: i)) not])
			ifTrue: [^self declineWith: 'The argument for ', pname, ' would be evaluated ', count printString,
				' times but is not a simple value; inlining it could change behaviour.']].
	"splice the occurrences, highest offset first so earlier offsets stay valid"
	(occs asSortedCollection: [:a :b | a start > b start]) do: [:n | | idx argSrc localStart localStop |
		idx := params indexOf: n name.
		argSrc := self argumentSourceFor: (sendNode arguments at: idx).
		localStart := n start - base + 1.
		localStop := n stop - base + 1.
		exprSrc := (exprSrc copyFrom: 1 to: localStart - 1), argSrc, (exprSrc copyFrom: localStop + 1 to: exprSrc size)].
	inlinedExpr := exprSrc
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> argumentSourceFor: argNode [
	"The verbatim source of a send argument, parenthesised unless it is an atom."
	| src |
	src := self sourceString copyFrom: argNode start to: argNode stop.
	^(self isAtomicArg: argNode) ifTrue: [src] ifFalse: ['(', src, ')']
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> isAtomicArg: argNode [
	"An argument safe to substitute even at more than one position: a variable
	 (incl. self/super/instVar), or a literal. Anything else may have side effects."
	argNode isLiteralNode ifTrue: [^true].
	^argNode isVariable
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> computeLastSender [
	"The inline removes the target's last live send when the ONLY method sending the
	 target selector is the one being edited AND it sends it exactly once (the
	 occurrence at the caret). sendersOf: is whole-system and selector-based, so this
	 is conservative: it never proposes a delete while any other sender remains."
	| senders editing count |
	editing := self editingMethod.
	senders := [environment sendersOf: targetSelector] on: Error do: [:e | #()].
	count := 0.
	self parseTree ifNotNil: [:tree |
		tree nodesDo: [:n | (n isMessage and: [n selector == targetSelector]) ifTrue: [count := count + 1]]].
	lastSender := (senders allSatisfy: [:m | self sender: m isEditingMethod: editing])
		and: [count = 1]
]

{ #category : 'private - analysis' }
GsInlineMethodRefactoring >> sender: aMethod isEditingMethod: editing [
	"True if aMethod (a sender of the target selector) IS the method being edited,
	 identified by selector + defining class rather than object identity."
	^[aMethod selector == selector and: [aMethod inClass == self sourceBehavior]]
		on: Error do: [:e | aMethod == editing]
]

{ #category : 'private - source' }
GsInlineMethodRefactoring >> rewrittenSource [
	"The editing method with the send's source interval replaced by the inlined
	 expression (parenthesised only where precedence requires it). Minimal-diff source
	 splicing keyed on the node interval -- no reformatting."
	| src |
	src := self sourceString.
	^(src copyFrom: 1 to: sendNode start - 1), self callText, (src copyFrom: sendNode stop + 1 to: src size)
]

{ #category : 'private - source' }
GsInlineMethodRefactoring >> callText [
	^self sendNeedsParens
		ifTrue: ['(', inlinedExpr, ')']
		ifFalse: [inlinedExpr]
]

{ #category : 'private - source' }
GsInlineMethodRefactoring >> sendNeedsParens [
	"Whether the inlined expression must be parenthesised to preserve meaning where the
	 send sat. An atomic result never needs them; otherwise a send replacing a whole
	 return value, assignment value, or statement does not, but one replacing a
	 sub-expression (an argument, a receiver, a binary operand) does."
	| parent |
	self inlinedExprIsAtomic ifTrue: [^false].
	parent := sendNode parent.
	parent isNil ifTrue: [^false].
	parent isReturn ifTrue: [^false].
	parent isSequence ifTrue: [^false].
	(parent isAssignment and: [parent value == sendNode]) ifTrue: [^false].
	^true
]

{ #category : 'private - source' }
GsInlineMethodRefactoring >> inlinedExprIsAtomic [
	"True when the inlined expression is a single variable or literal, so it never
	 needs parentheses in a sub-expression position."
	| node |
	node := [RBParser parseExpression: inlinedExpr] on: Error do: [:e | nil].
	node isNil ifTrue: [^false].
	^node isVariable or: [node isLiteralNode]
]

{ #category : 'private' }
GsInlineMethodRefactoring >> methodCategory [
	^((self sourceBehavior categoryOfSelector: selector environmentId: 0)
		ifNil: ['as yet unclassified']) asString
]

{ #category : 'private' }
GsInlineMethodRefactoring >> categoryOfClass: aBehavior selector: aSelector [
	^((aBehavior categoryOfSelector: aSelector environmentId: 0)
		ifNil: ['as yet unclassified']) asString
]

{ #category : 'private' }
GsInlineMethodRefactoring >> dictNameForClass: aClass [
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
]

{ #category : 'preconditions' }
GsInlineMethodRefactoring >> declineReason [
	"nil if the send can be inlined, otherwise a reason that blocks Apply."
	self ensureAnalysis.
	^declineString
]

{ #category : 'testing' }
GsInlineMethodRefactoring >> isLastSender [
	"True when the inlined call was the target method's last live sender, so a delete
	 of the now-unused target is offered."
	self ensureAnalysis.
	^lastSender == true
]

{ #category : 'building' }
GsInlineMethodRefactoring >> buildChangeSet [
	"Stage the caller recompile and, when the inline removed the target's last sender,
	 a deselectable removal of the target. Empty when the inline is declined. Compiles
	 nothing, commits nothing."
	| cs |
	cs := GsRefactoringChangeSet new.
	self ensureAnalysis.
	declineString notNil ifTrue: [^cs].
	cs
		addMethodRecompileInDictionary: (self dictNameForClass: definingClass)
		className: definingClass name
		isMeta: isMeta
		selector: selector
		category: self methodCategory
		oldSource: self sourceString
		newSource: self rewrittenSource.
	lastSender ifTrue: [
		cs
			addMethodRemoveInDictionary: (self dictNameForClass: targetClass thisClass)
			className: targetClass thisClass name
			isMeta: targetClass isMeta
			selector: targetSelector
			category: (self categoryOfClass: targetClass selector: targetSelector)
			oldSource: targetSource].
	^cs
]

{ #category : 'serializing' }
GsInlineMethodRefactoring >> analysisJsonString [
	"The pre-flight payload: the target class + selector, whether a delete will be
	 offered, and the decline reason (if any)."
	self ensureAnalysis.
	^'{"targetClass":', ((declineString notNil or: [targetClass isNil])
			ifTrue: ['null'] ifFalse: [self jsonQuote: targetClass thisClass name asString]),
	  ',"targetSelector":', ((declineString notNil or: [targetSelector isNil])
			ifTrue: ['null'] ifFalse: [self jsonQuote: targetSelector asString]),
	  ',"lastSender":', (lastSender == true) printString,
	  ',"decline":', (declineString ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  '}'
]

{ #category : 'serializing' }
GsInlineMethodRefactoring >> previewJsonString [
	^self changeSet jsonString
]

{ #category : 'serializing' }
GsInlineMethodRefactoring >> outOfScopeJsonString [
	"The scope / precondition payload for the preview panel, in the family's shape.
	 Inlining introduces no shadowing, so collision is always null; a hard decline
	 (which blocks Apply) rides here."
	^'{"references":0,"skipped":0,"scope":"method","collision":null,"decline":',
	  (self declineReason ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  '}'
]

{ #category : 'paginated preview' }
GsInlineMethodRefactoring >> startPreviewToken: token maxBytes: maxBytes [
	"Build the change set, stash this refactoring in SessionTemps under token, and
	 answer the first page plus totals and precondition warnings. Nothing is committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"targetSelector":', (targetSelector isNil ifTrue: ['null'] ifFalse: [self jsonQuote: targetSelector asString]),
	  ',"lastSender":', self isLastSender printString,
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"skippedMethods":[]',
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'paginated preview' }
GsInlineMethodRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
	"A byte-bounded page of staged changes (with source) from startIndex (1-based). At
	 least one change is always emitted when any remain."
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
GsInlineMethodRefactoring >> applyDeselected: deselectedIds [
	"Apply the staged changes in the stone WITHOUT committing. The caller recompile
	 (change 1) is ALWAYS applied; a deselected id is honoured only for the optional
	 target removal (change 2), so unticking it leaves the target in place. Answers
	 {applied, failed:[..]}."
	| applied failures ids |
	ids := (deselectedIds ifNil: [#()]) asArray.
	failures := OrderedCollection new.
	applied := 0.
	self changeSet changes doWithIndex: [:change :idx |
		((idx = 1) or: [(ids includes: change id) not])
			ifTrue: [
				[self applyChange: change. applied := applied + 1]
				on: Error do: [:e |
					failures add: (Array with: change id with: change className with: e messageText)]]].
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
GsInlineMethodRefactoring >> applyChange: aChange [
	aChange kind == #methodRecompile ifTrue: [^self applyMethodRecompile: aChange].
	aChange kind == #methodRemove ifTrue: [^self applyMethodRemove: aChange].
	^self error: 'Unexpected change kind for inline-method: ', aChange kind printString
]

{ #category : 'applying' }
GsInlineMethodRefactoring >> applyMethodRecompile: aChange [
	"Recompile the caller with its rewritten (inlined) source. No commit."
	| cls target |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	target
		compileMethod: aChange newSource
		dictionaries: System myUserProfile symbolList
		category: (aChange category ifNil: ['as yet unclassified'])
]

{ #category : 'applying' }
GsInlineMethodRefactoring >> applyMethodRemove: aChange [
	"Remove the now-unused target method. No commit."
	| cls target |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	target removeSelector: aChange selector asSymbol
]

{ #category : 'serializing' }
GsInlineMethodRefactoring >> jsonQuote: aString [
	^'"', (self jsonEscape: aString), '"'
]

{ #category : 'serializing' }
GsInlineMethodRefactoring >> jsonEscape: aString [
	"JSON string escaping emitting PURE ASCII (control chars and code points above 126
	 become \\uXXXX), so the client's non-blocking GCI fetch is never handed a Unicode
	 result."
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
GsInlineMethodRefactoring >> hex2: anInteger [
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
]
