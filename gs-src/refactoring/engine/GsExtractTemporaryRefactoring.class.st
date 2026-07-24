"
Extract a selected EXPRESSION from a method into a new temporary variable (M3),
replacing the occurrence(s) with the temporary. This is method-local: exactly one
method changes, staged as a single #methodRecompile, with no class-definition edit
and no cross-method scan.

The refactoring is addressed by class + selector + isMeta + a source INTERVAL
(selStart..selStop, 1-based character offsets from the editor selection) + the new
temporary name. Resolution uses the vendored RB AST:

  - RBParser parses the method; `tree bestNodeFor: (selStart to: selStop)` finds the
    node under the selection. It is accepted only when it is a value expression that
    is NOT a whole return, NOT an assignment, and NOT a bare variable / pseudo-
    variable (a literal IS allowed -- naming a magic number). Otherwise the extraction
    is DECLINED (empty change set + a reason);
  - the tightest enclosing SEQUENCE (the method body or a block body) that contains
    the expression's statement becomes the declaring scope: the new temporary is
    declared there and 'name := <expr>.' is inserted immediately before that
    statement, so evaluation order is preserved;
  - by default only the selected occurrence is replaced; with replaceAll on, every
    occurrence in the declaring sequence whose source equals the selected expression's
    is replaced and a single assignment is inserted before the earliest.

The new name is refused (surfaced in the preview, Apply blocked) when it would COLLIDE
with an argument/temporary anywhere in the method, an own or INHERITED instance
variable, a class variable visible to the class, or a pseudo-variable.

Building the change set compiles nothing and commits nothing. The server-side apply
recompiles the one method in the stone but never commits (the user commits
explicitly). There is a single change, so a passed deselection is inert (accepted for
signature parity with the other refactorings' applyForToken:deselected: entry point).
"
Class {
	#name : 'GsExtractTemporaryRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'definingClass',
		'selector',
		'isMeta',
		'selStart',
		'selStop',
		'newName',
		'replaceAll',
		'changeSet',
		'analysisDone',
		'targetNode',
		'declSeq',
		'declineString'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsExtractTemporaryRefactoring class >> class: aClass selector: aSelector meta: aBool selStart: startOffset selStop: stopOffset newName: newNameString [
	"Extract the expression between startOffset and stopOffset (1-based, inclusive) of
	 aClass>>aSelector into a new temporary named newNameString."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		selector: aSelector
		meta: aBool
		selStart: startOffset
		selStop: stopOffset
		newName: newNameString
]

{ #category : 'instance creation' }
GsExtractTemporaryRefactoring class >> environment: anEnvironment class: aClass selector: aSelector meta: aBool selStart: startOffset selStop: stopOffset newName: newNameString [
	^self new
		setEnvironment: anEnvironment
		class: aClass
		selector: aSelector
		meta: aBool
		selStart: startOffset
		selStop: stopOffset
		newName: newNameString
]

{ #category : 'preconditions' }
GsExtractTemporaryRefactoring class >> analyzeSelectionForClass: aClass selector: aSelector meta: aBool selStart: startOffset selStop: stopOffset [
	"A pre-flight the client runs before prompting for the new name: how many identical
	 occurrences of the selected expression exist in the declaring scope (so a
	 'replace all N' option can be offered) and a decline reason if the selection cannot
	 be extracted. The new name is not known yet, so no collision is checked here."
	^(self
		class: aClass
		selector: aSelector
		meta: aBool
		selStart: startOffset
		selStop: stopOffset
		newName: '') analysisJsonString
]

{ #category : 'paginated preview' }
GsExtractTemporaryRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	"A page from a previously-started preview (see startPreviewToken:maxBytes:), by
	 token. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'paginated preview' }
GsExtractTemporaryRefactoring class >> applyForToken: token deselected: deselectedIds [
	"Apply a previously-started preview (by token). No commit. Answers an error
	 envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'paginated preview' }
GsExtractTemporaryRefactoring class >> clearToken: token [
	"Drop a finished preview from SessionTemps."
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'private' }
GsExtractTemporaryRefactoring >> setEnvironment: anEnvironment class: aClass selector: aSelector meta: aBool selStart: startOffset selStop: stopOffset newName: newNameString [
	environment := anEnvironment.
	definingClass := aClass.
	selector := aSelector asSymbol.
	isMeta := aBool.
	selStart := startOffset.
	selStop := stopOffset.
	newName := newNameString asString.
	replaceAll := false.
	analysisDone := false
]

{ #category : 'accessing' }
GsExtractTemporaryRefactoring >> replaceAll: aBool [
	"Replace every identical occurrence of the selected expression in the declaring
	 sequence, not just the selected one. Off by default."
	replaceAll := aBool.
	changeSet := nil
]

{ #category : 'accessing' }
GsExtractTemporaryRefactoring >> environment [
	^environment
]

{ #category : 'accessing' }
GsExtractTemporaryRefactoring >> definingClass [
	^definingClass
]

{ #category : 'accessing' }
GsExtractTemporaryRefactoring >> selector [
	^selector
]

{ #category : 'accessing' }
GsExtractTemporaryRefactoring >> isMeta [
	^isMeta
]

{ #category : 'accessing' }
GsExtractTemporaryRefactoring >> newName [
	^newName
]

{ #category : 'accessing' }
GsExtractTemporaryRefactoring >> changeSet [
	"The staged, non-committing change set, computed once and cached. Empty when the
	 extraction is declined."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'private' }
GsExtractTemporaryRefactoring >> targetClass [
	"The behaviour that holds the method: the metaclass for a class-side method."
	^isMeta ifTrue: [definingClass class] ifFalse: [definingClass]
]

{ #category : 'private' }
GsExtractTemporaryRefactoring >> sourceString [
	"The stored source of the method being refactored, or nil if it does not exist."
	| m |
	m := self targetClass compiledMethodAt: selector environmentId: 0 otherwise: nil.
	^m isNil ifTrue: [nil] ifFalse: [m sourceString]
]

{ #category : 'private' }
GsExtractTemporaryRefactoring >> parseTree [
	"A fresh parse of the method source, or nil if it is missing or unparseable."
	| src |
	src := self sourceString.
	src isNil ifTrue: [^nil].
	^[RBParser parseMethod: src] on: Error do: [:e | nil]
]

{ #category : 'private - analysis' }
GsExtractTemporaryRefactoring >> ensureAnalysis [
	analysisDone ifFalse: [
		analysisDone := true.
		[self computeAnalysis] on: Error do: [:e |
			declineString := 'The selection could not be analysed: ', e messageText]]
]

{ #category : 'private - analysis' }
GsExtractTemporaryRefactoring >> declineWith: aReason [
	declineString := aReason.
	^nil
]

{ #category : 'private - analysis' }
GsExtractTemporaryRefactoring >> computeAnalysis [
	"Resolve the selection to a value expression, classify what would block the
	 extraction, and record the target node and its declaring sequence."
	| tree node stmt |
	declineString := nil.
	targetNode := nil.
	declSeq := nil.
	tree := self parseTree.
	tree isNil ifTrue: [^self declineWith: 'The method source does not parse.'].
	node := [tree bestNodeFor: (selStart to: selStop)] on: Error do: [:e | nil].
	node isNil ifTrue: [^self declineWith: 'Select an expression to extract into a temporary variable.'].
	node isReturn ifTrue: [^self declineWith: 'Select the expression to extract, not the whole return statement.'].
	node isValue ifFalse: [^self declineWith: 'Select a single expression to extract into a temporary variable.'].
	"A bare variable read and an assignment expression ARE extractable (aliasing a
	 value, or naming an assignment) -- only reject the cases that would not compile or
	 would change meaning: super/thisContext used alone, the write target of an
	 assignment, or a variable DECLARATION."
	node isVariable ifTrue: [
		(self declineReasonForVariable: node) ifNotNil: [:r | ^self declineWith: r]].
	(node start >= (selStart - 1) and: [node stop <= (selStop + 1)])
		ifFalse: [^self declineWith: 'Select a single, whole expression to extract into a temporary variable.'].
	stmt := self statementNodeFor: node.
	stmt isNil ifTrue: [^self declineWith: 'The selection is not inside a statement that can be extracted.'].
	targetNode := node.
	declSeq := stmt parent
]

{ #category : 'private - analysis' }
GsExtractTemporaryRefactoring >> nodeSource: aNode [
	^self sourceString copyFrom: aNode start to: aNode stop
]

{ #category : 'private - analysis' }
GsExtractTemporaryRefactoring >> declineReasonForVariable: aVariableNode [
	"A bare variable node is a legitimate thing to extract (create a temporary now,
	 wire it up later) EXCEPT when it would not compile or would silently change
	 meaning: 'super'/'thisContext' are only valid as a message receiver; the write
	 target of an assignment is not a value to alias (extracting it would redirect the
	 assignment); and a declaration in a '| .. |' clause or an argument list is not an
	 expression. Answers a reason String for those, else nil (extractable)."
	| p name |
	name := aVariableNode name.
	(#('super' 'thisContext') includes: name)
		ifTrue: [^'''', name, ''' is only valid as a message receiver and cannot be extracted into a temporary.'].
	p := aVariableNode parent.
	p isNil ifTrue: [^nil].
	(p isAssignment and: [p variable == aVariableNode])
		ifTrue: [^'That is the assignment target; select the value being assigned, or the whole assignment.'].
	(p isSequence or: [p isMethod or: [p isBlock]])
		ifTrue: [^'That is a variable declaration, not an expression you can extract.'].
	^nil
]

{ #category : 'private - analysis' }
GsExtractTemporaryRefactoring >> statementNodeFor: aNode [
	"The node that is a direct child of a sequence and is aNode-or-an-ancestor of it --
	 i.e. the statement whose evaluation the extraction hoists. Walks aNode's parent
	 chain until the parent is a sequence."
	| n |
	n := aNode.
	[n notNil] whileTrue: [
		(n parent notNil and: [n parent isSequence]) ifTrue: [^n].
		n := n parent].
	^nil
]

{ #category : 'private - analysis' }
GsExtractTemporaryRefactoring >> topStatementIn: aSequence containing: aNode [
	"The statement that is a DIRECT child of aSequence and is aNode-or-an-ancestor of it
	 -- walk aNode's parent chain until the parent IS aSequence. nil if aNode is not in
	 aSequence's subtree. Used to hoist the assignment into the DECLARING sequence even
	 when the occurrence sits inside a nested block under it."
	| n |
	n := aNode.
	[n notNil] whileTrue: [
		n parent == aSequence ifTrue: [^n].
		n := n parent].
	^nil
]

{ #category : 'private - analysis' }
GsExtractTemporaryRefactoring >> matchingOccurrences [
	"The occurrence nodes to replace: the selected node alone (default), or every node
	 in the declaring sequence whose verbatim source equals the selected expression's
	 (replaceAll). The declaring sequence's subtree bounds the scope, so a nested block
	 under it is included and a sibling block is not."
	| src exprSrc occs |
	replaceAll ifFalse: [^OrderedCollection with: targetNode].
	src := self sourceString.
	exprSrc := src copyFrom: targetNode start to: targetNode stop.
	occs := OrderedCollection new.
	declSeq nodesDo: [:node |
		(node isValue and: [(src copyFrom: node start to: node stop) = exprSrc])
			ifTrue: [occs add: node]].
	^occs
]

{ #category : 'private - analysis' }
GsExtractTemporaryRefactoring >> occurrenceCount [
	"How many identical occurrences of the selected expression are in scope (the count
	 offered to the user as 'replace all N')."
	| src exprSrc n |
	self ensureAnalysis.
	(declineString notNil or: [targetNode isNil]) ifTrue: [^0].
	src := self sourceString.
	exprSrc := src copyFrom: targetNode start to: targetNode stop.
	n := 0.
	declSeq nodesDo: [:node |
		(node isValue and: [(src copyFrom: node start to: node stop) = exprSrc])
			ifTrue: [n := n + 1]].
	^n
]

{ #category : 'preconditions' }
GsExtractTemporaryRefactoring >> declineReason [
	"nil if the extraction can proceed, otherwise a reason (a structural precondition)
	 that blocks Apply."
	self ensureAnalysis.
	^declineString
]

{ #category : 'preconditions' }
GsExtractTemporaryRefactoring >> newNameCollision [
	"nil if the new name is free, otherwise a short reason. The name collides when it
	 already names an argument or temporary anywhere in the method, an own or inherited
	 instance variable, a class variable visible to the class, or a pseudo-variable.
	 Identifier-shape validation is the client input box's job."
	| sym |
	self ensureAnalysis.
	(newName isNil or: [newName isEmpty]) ifTrue: [^nil].
	sym := newName asSymbol.
	(self isPseudoVariable: sym)
		ifTrue: [^'the name ', newName, ' is a reserved pseudo-variable'].
	(self localNames includes: sym)
		ifTrue: [^'the name ', newName, ' is already an argument or temporary in this method'].
	((definingClass allInstVarNames collect: [:e | e asSymbol]) includes: sym)
		ifTrue: [^'the name ', newName, ' is already an instance variable'].
	(self visibleClassVarNames includes: sym)
		ifTrue: [^'the name ', newName, ' is already a class variable'].
	^nil
]

{ #category : 'preconditions' }
GsExtractTemporaryRefactoring >> isPseudoVariable: aSymbol [
	^#(#self #super #thisContext #nil #true #false) includes: aSymbol
]

{ #category : 'preconditions' }
GsExtractTemporaryRefactoring >> localNames [
	"Every argument and temporary name declared anywhere in the method, as a Set of
	 Symbols. From a fresh parse, so it is never affected by change-set tree mutation."
	| names tree |
	names := IdentitySet new.
	tree := self parseTree.
	tree ifNil: [^names].
	tree nodesDo: [:node |
		(node isMethod or: [node isBlock])
			ifTrue: [node arguments do: [:a | names add: a name asSymbol]].
		node isSequence
			ifTrue: [node temporaries do: [:t | names add: t name asSymbol]]].
	^names
]

{ #category : 'preconditions' }
GsExtractTemporaryRefactoring >> visibleClassVarNames [
	"Every class-variable name visible in a method of the defining class: the class's
	 own class variables plus every superclass's, as a Set of Symbols."
	| names classes |
	names := IdentitySet new.
	classes := OrderedCollection new.
	classes add: definingClass.
	classes addAll: definingClass allSuperclasses.
	classes do: [:cls | cls classVarNames do: [:n | names add: n asSymbol]].
	^names
]

{ #category : 'building' }
GsExtractTemporaryRefactoring >> buildChangeSet [
	"Parse the method, rewrite the source (occurrence(s) replaced by the temporary, a
	 leading assignment inserted, the temporary declared) and stage a SINGLE
	 #methodRecompile. Empty when the extraction is declined. Compiles nothing, commits
	 nothing. A collision is surfaced (not applied) -- the client blocks Apply."
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
	^cs
]

{ #category : 'building - source' }
GsExtractTemporaryRefactoring >> rewrittenSource [
	"The method source with the occurrence(s) replaced by the temporary, a leading
	 'name := expr.' inserted before the earliest occurrence's statement, and the
	 temporary declared in the enclosing sequence. Minimal-diff string splicing."
	| src occs earliest insertStmt exprSrc indent assignText edits pass1 |
	src := self sourceString.
	"When the SELECTED expression IS an entire statement (a bare expression-statement --
	 e.g. an assignment or a void send whose value is discarded), hoisting a separate
	 'name := expr.' and replacing the occurrence would leave a degenerate 'name.'
	 statement. Instead just turn the statement itself into 'name := expr'. This applies
	 regardless of replaceAll: replacing several whole-statement occurrences with bare
	 'name.' statements would be degenerate AND would change how often a side-effecting
	 statement runs, so a whole-statement selection is always single (M2)."
	(targetNode parent notNil and: [targetNode parent isSequence])
		ifTrue: [^self rewrittenSourcePrefixingStatement: targetNode].
	occs := self matchingOccurrences.
	earliest := occs inject: occs first into: [:a :b | b start < a start ifTrue: [b] ifFalse: [a]].
	"The hoisted assignment + temp declaration MUST land in the SELECTED occurrence's
	 declaring sequence (declSeq), so every replaced occurrence -- including ones in a
	 nested block under declSeq -- can see the temporary. Resolve the insertion point to
	 the statement that is a DIRECT child of declSeq; using the nearest enclosing sequence
	 would, for a nested-block occurrence, wrongly declare the temp inside the inner block
	 and leave the outer occurrences undeclared (H1)."
	insertStmt := (self topStatementIn: declSeq containing: earliest)
		ifNil: [self statementNodeFor: earliest].
	exprSrc := src copyFrom: targetNode start to: targetNode stop.
	indent := self indentBefore: insertStmt start in: src.
	assignText := newName, ' := ', exprSrc, '.', (String with: Character lf), indent.
	edits := OrderedCollection new.
	occs do: [:n | edits add: (Array with: n start with: n stop with: newName)].
	edits add: (Array with: insertStmt start with: insertStmt start - 1 with: assignText).
	pass1 := self applyEdits: edits to: src.
	^self addTemporaryToDeclaringSequenceIn: pass1
]

{ #category : 'building - source' }
GsExtractTemporaryRefactoring >> rewrittenSourcePrefixingStatement: aNode [
	"The whole-statement case: prefix 'name := ' onto the statement (so 'price := 5'
	 becomes 'temp := price := 5') and declare the temporary. No hoisted assignment, no
	 degenerate bare read."
	| src pass1 |
	src := self sourceString.
	pass1 := self applyEdits: (OrderedCollection with:
		(Array with: aNode start with: aNode start - 1 with: newName, ' := ')) to: src.
	^self addTemporaryToDeclaringSequenceIn: pass1
]

{ #category : 'building - source' }
GsExtractTemporaryRefactoring >> applyEdits: editTriples to: aString [
	"Apply {start, stop, replacementText} triples to aString by pure splicing, in
	 descending start order (ties by descending stop), so each edit's coordinates stay
	 valid against the original string. A pure insertion has stop = start - 1."
	| sorted s |
	sorted := editTriples asSortedCollection: [:a :b |
		(a at: 1) = (b at: 1)
			ifTrue: [(a at: 2) >= (b at: 2)]
			ifFalse: [(a at: 1) > (b at: 1)]].
	s := aString.
	sorted do: [:e |
		s := (s copyFrom: 1 to: (e at: 1) - 1), (e at: 3), (s copyFrom: (e at: 2) + 1 to: s size)].
	^s
]

{ #category : 'building - source' }
GsExtractTemporaryRefactoring >> indentBefore: aPos in: aString [
	"The run of spaces/tabs at the start of the line containing aPos (its indentation)."
	| i lineStart ws j |
	i := aPos - 1.
	[i >= 1 and: [((aString at: i) ~= Character lf) and: [(aString at: i) ~= Character cr]]]
		whileTrue: [i := i - 1].
	lineStart := i + 1.
	ws := WriteStream on: String new.
	j := lineStart.
	[j < aPos and: [((aString at: j) = Character space) or: [(aString at: j) = Character tab]]]
		whileTrue: [ws nextPut: (aString at: j). j := j + 1].
	^ws contents
]

{ #category : 'building - source' }
GsExtractTemporaryRefactoring >> addTemporaryToDeclaringSequenceIn: aSource [
	"Declare the new temporary in the sequence that now holds the 'name := ...'
	 assignment: reparse the (valid) source, find the unique assignment to the fresh
	 name, and splice its sequence's '| .. |' clause -- extending an existing clause or
	 creating one when the sequence had no temporaries."
	| tree assign seq lb rb clause firstStmt pos indent |
	tree := [RBParser parseMethod: aSource] on: Error do: [:e | nil].
	tree isNil ifTrue: [^aSource].
	assign := nil.
	tree nodesDo: [:n | (n isAssignment and: [n variable name = newName]) ifTrue: [assign := n]].
	assign isNil ifTrue: [^aSource].
	seq := assign parent.
	[seq notNil and: [seq isSequence not]] whileTrue: [seq := seq parent].
	seq isNil ifTrue: [^aSource].
	seq temporaries isEmpty ifFalse: [
		lb := seq leftBar.
		rb := seq rightBar.
		(lb isNil or: [rb isNil]) ifTrue: [^aSource].
		clause := '| ', ((seq temporaries collect: [:t | t name])
			inject: '' into: [:acc :nm | acc isEmpty ifTrue: [nm] ifFalse: [acc, ' ', nm]]),
			' ', newName, ' |'.
		^(aSource copyFrom: 1 to: lb - 1), clause, (aSource copyFrom: rb + 1 to: aSource size)].
	seq statements isEmpty ifTrue: [^aSource].
	firstStmt := seq statements first.
	pos := firstStmt start.
	indent := self indentBefore: pos in: aSource.
	^(aSource copyFrom: 1 to: pos - 1),
	  '| ', newName, ' |', (String with: Character lf), indent,
	  (aSource copyFrom: pos to: aSource size)
]

{ #category : 'private' }
GsExtractTemporaryRefactoring >> methodCategory [
	^((self targetClass categoryOfSelector: selector environmentId: 0)
		ifNil: ['as yet unclassified']) asString
]

{ #category : 'private' }
GsExtractTemporaryRefactoring >> dictNameForClass: aClass [
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
]

{ #category : 'serializing' }
GsExtractTemporaryRefactoring >> analysisJsonString [
	"The pre-flight payload: how many occurrences are in scope and any decline reason."
	self ensureAnalysis.
	^'{"occurrenceCount":', self occurrenceCount printString,
	  ',"decline":', (declineString ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  '}'
]

{ #category : 'serializing' }
GsExtractTemporaryRefactoring >> previewJsonString [
	^self changeSet jsonString
]

{ #category : 'serializing' }
GsExtractTemporaryRefactoring >> outOfScopeJsonString [
	"The scope / precondition payload for the preview panel, in the family's shape. The
	 collision (surfaced, blocks Apply) and decline reasons ride here."
	^'{"references":0,"skipped":0,"scope":"method"',
	  ',"collision":', (self newNameCollision
		ifNil: ['null'] ifNotNil: [:reason | self jsonQuote: reason]),
	  ',"decline":', (self declineReason
		ifNil: ['null'] ifNotNil: [:reason | self jsonQuote: reason]),
	  '}'
]

{ #category : 'paginated preview' }
GsExtractTemporaryRefactoring >> startPreviewToken: token maxBytes: maxBytes [
	"Build the change set, stash this refactoring in SessionTemps under token, and
	 answer the first page plus totals and precondition warnings. Nothing is committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"newName":', (self jsonQuote: newName),
	  ',"occurrenceCount":', self occurrenceCount printString,
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"skippedMethods":[]',
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'paginated preview' }
GsExtractTemporaryRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
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
GsExtractTemporaryRefactoring >> applyDeselected: deselectedIds [
	"Apply the staged change in the stone WITHOUT committing. A single #methodRecompile,
	 so deselectedIds is inert -- accepted only for signature parity with the other
	 refactorings' apply entry point. Answers {applied, failed:[..]}."
	| applied failures |
	failures := OrderedCollection new.
	applied := 0.
	self changeSet changes do: [:change |
		[self applyChange: change. applied := applied + 1]
		on: Error do: [:e |
			failures add: (Array with: change id with: change className with: e messageText)]].
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
GsExtractTemporaryRefactoring >> applyChange: aChange [
	aChange kind == #methodRecompile ifTrue: [^self applyMethodRecompile: aChange].
	^self error: 'Unexpected change kind for extract-temporary: ', aChange kind printString
]

{ #category : 'applying' }
GsExtractTemporaryRefactoring >> applyMethodRecompile: aChange [
	"Recompile the one method with its rewritten source. No commit."
	| cls target |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	target
		compileMethod: aChange newSource
		dictionaries: System myUserProfile symbolList
		category: (aChange category ifNil: ['as yet unclassified'])
]

{ #category : 'serializing' }
GsExtractTemporaryRefactoring >> jsonQuote: aString [
	^'"', (self jsonEscape: aString), '"'
]

{ #category : 'serializing' }
GsExtractTemporaryRefactoring >> jsonEscape: aString [
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
GsExtractTemporaryRefactoring >> hex2: anInteger [
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
]
