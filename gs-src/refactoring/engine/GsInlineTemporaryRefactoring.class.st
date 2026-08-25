"
Inline a method TEMPORARY that is assigned exactly once (M4), the mirror image of
extract-temporary: replace every read of the temporary with the assigned expression,
then delete the declaration and the assignment. This is method-local: exactly one
method changes, staged as a single #methodRecompile, with no class-definition edit and
no cross-method scan.

The refactoring is addressed by class + selector + isMeta + a 1-based source OFFSET
(the editor caret) that lands on the temporary. Resolution uses the vendored RB AST,
all symbol-identity:

  - RBParser parses the method; the variable node under the caret (probing offset,
    offset-1, offset+1, M2's tolerance) names the target;
  - walking its parent chain to the nearest enclosing scope that declares the name
    must reach a SEQUENCE (a method/block temporaries list). An argument (declared by
    a method/block) is DECLINED -- its value comes from the sender; a name that is not
    a local (an instance/class variable, a global, a pseudo-variable) is DECLINED with
    a classifying reason.

The temporary must be assigned EXACTLY ONCE, read AT LEAST ONCE, with the assignment a
direct statement of its declaring sequence and no read before it; a non-atomic value
read more than once is DECLINED (inlining would evaluate it repeatedly). The assigned
expression is spliced at each read, parenthesised only where precedence requires it
(an atomic value never is). The assignment statement is removed (no dangling '.') and
the temporary dropped from its '| .. |' clause.

Building the change set compiles nothing and commits nothing. The server-side apply
recompiles the one method but never commits. There is a single change, so a passed
deselection is inert (accepted for signature parity with the family's apply entry).
"
Class {
	#name : 'GsInlineTemporaryRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'definingClass',
		'selector',
		'isMeta',
		'offset',
		'changeSet',
		'analysisDone',
		'tree',
		'varName',
		'declScope',
		'assignmentNode',
		'reads',
		'valueSrc',
		'valueIsAtomic',
		'declineString'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsInlineTemporaryRefactoring class >> class: aClass selector: aSelector meta: aBool atOffset: anOffset [
	"Inline the temporary at anOffset (a 1-based character index into aClass>>aSelector's
	 source)."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		selector: aSelector
		meta: aBool
		atOffset: anOffset
]

{ #category : 'instance creation' }
GsInlineTemporaryRefactoring class >> environment: anEnvironment class: aClass selector: aSelector meta: aBool atOffset: anOffset [
	^self new
		setEnvironment: anEnvironment
		class: aClass
		selector: aSelector
		meta: aBool
		atOffset: anOffset
]

{ #category : 'preconditions' }
GsInlineTemporaryRefactoring class >> analyzeTempForClass: aClass selector: aSelector meta: aBool atOffset: anOffset [
	"A pre-flight the client runs before opening the preview: the temporary's name and a
	 decline reason if it cannot be inlined."
	^(self
		class: aClass
		selector: aSelector
		meta: aBool
		atOffset: anOffset) analysisJsonString
]

{ #category : 'paginated preview' }
GsInlineTemporaryRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	"A page from a previously-started preview (see startPreviewToken:maxBytes:), by
	 token. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'paginated preview' }
GsInlineTemporaryRefactoring class >> applyForToken: token deselected: deselectedIds [
	"Apply a previously-started preview (by token). No commit. Answers an error
	 envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'paginated preview' }
GsInlineTemporaryRefactoring class >> clearToken: token [
	"Drop a finished preview from SessionTemps."
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'private' }
GsInlineTemporaryRefactoring >> setEnvironment: anEnvironment class: aClass selector: aSelector meta: aBool atOffset: anOffset [
	environment := anEnvironment.
	definingClass := aClass.
	selector := aSelector asSymbol.
	isMeta := aBool.
	offset := anOffset.
	analysisDone := false
]

{ #category : 'accessing' }
GsInlineTemporaryRefactoring >> environment [
	^environment
]

{ #category : 'accessing' }
GsInlineTemporaryRefactoring >> definingClass [
	^definingClass
]

{ #category : 'accessing' }
GsInlineTemporaryRefactoring >> selector [
	^selector
]

{ #category : 'accessing' }
GsInlineTemporaryRefactoring >> isMeta [
	^isMeta
]

{ #category : 'accessing' }
GsInlineTemporaryRefactoring >> changeSet [
	"The staged, non-committing change set, computed once and cached. Empty when the
	 inline is declined."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'private' }
GsInlineTemporaryRefactoring >> targetClass [
	"The behaviour that holds the method: the metaclass for a class-side method."
	^isMeta ifTrue: [definingClass class] ifFalse: [definingClass]
]

{ #category : 'private' }
GsInlineTemporaryRefactoring >> sourceString [
	"The stored source of the method being refactored, or nil if it does not exist."
	| m |
	m := self targetClass compiledMethodAt: selector environmentId: 0 otherwise: nil.
	^m isNil ifTrue: [nil] ifFalse: [m sourceString]
]

{ #category : 'private' }
GsInlineTemporaryRefactoring >> parseTree [
	"A fresh parse of the method source, or nil if it is missing or unparseable."
	| src |
	src := self sourceString.
	src isNil ifTrue: [^nil].
	^[RBParser parseMethod: src] on: Error do: [:e | nil]
]

{ #category : 'private - scope' }
GsInlineTemporaryRefactoring >> scopeNode: aNode declaresName: aName [
	"Does aNode introduce a scope binding for aName? A method/block declares arguments;
	 a sequence declares temporaries."
	"Compare by symbol identity (never a raw String =), so a Unicode variable name on a
	 3.6.x stone never trips error 2718 -- matching the sibling GsRenameTemporaryRefactoring."
	| sym |
	sym := aName asSymbol.
	(aNode isMethod or: [aNode isBlock])
		ifTrue: [^aNode arguments anySatisfy: [:a | a name asSymbol == sym]].
	aNode isSequence
		ifTrue: [^aNode temporaries anySatisfy: [:t | t name asSymbol == sym]].
	^false
]

{ #category : 'private - scope' }
GsInlineTemporaryRefactoring >> declaringScopeForName: aName from: aNode [
	"The nearest enclosing scope node that declares aName, walking aNode's parent chain
	 outward -- or nil if aName is not a local there."
	| n |
	n := aNode.
	[n notNil] whileTrue: [
		(self scopeNode: n declaresName: aName) ifTrue: [^n].
		n := n parent].
	^nil
]

{ #category : 'private - analysis' }
GsInlineTemporaryRefactoring >> variableNodeAtOffsetIn: aTree [
	"The variable node under the caret, tolerant of a caret just past the name (M2's
	 offset / offset-1 / offset+1 probe). Answers nil when no probe lands on a variable."
	| positions |
	positions := OrderedCollection new.
	positions add: offset.
	offset > 1 ifTrue: [positions add: offset - 1].
	positions add: offset + 1.
	positions do: [:pos | | node |
		node := [aTree bestNodeFor: (pos to: pos)] on: Error do: [:e | nil].
		(node notNil and: [node isVariable]) ifTrue: [^node]].
	^nil
]

{ #category : 'private - analysis' }
GsInlineTemporaryRefactoring >> ensureAnalysis [
	analysisDone ifFalse: [
		analysisDone := true.
		[self computeAnalysis] on: Error do: [:e |
			declineString := 'The inline could not be analysed: ', e messageText]]
]

{ #category : 'private - analysis' }
GsInlineTemporaryRefactoring >> declineWith: aReason [
	declineString := aReason.
	^nil
]

{ #category : 'private - analysis' }
GsInlineTemporaryRefactoring >> computeAnalysis [
	"Resolve the temporary at offset, require the single-assignment / at-least-one-read
	 shape, and record the assignment's value and the read occurrences. Sets
	 declineString on any hard precondition."
	| occ scope declNodes assigns varSym |
	declineString := nil.
	varName := nil.
	declScope := nil.
	assignmentNode := nil.
	reads := OrderedCollection new.
	tree := self parseTree.
	tree isNil ifTrue: [^self declineWith: 'The method source does not parse.'].
	occ := self variableNodeAtOffsetIn: tree.
	occ isNil ifTrue: [^self declineWith: 'Place the cursor on the temporary variable you want to inline.'].
	varName := occ name.
	(self isPseudoVariable: varName asSymbol)
		ifTrue: [^self declineWith: '''', varName, ''' is a reserved variable and cannot be inlined.'].
	scope := self declaringScopeForName: varName from: occ.
	scope isNil ifTrue: [^self declineNonLocal].
	scope isSequence
		ifFalse: [^self declineWith: '''', varName, ''' is an argument; its value is supplied by the sender and cannot be inlined.'].
	declScope := scope.
	"declaration nodes (args + temps) are not reads"
	declNodes := IdentitySet new.
	tree nodesDo: [:n |
		(n isMethod or: [n isBlock]) ifTrue: [n arguments do: [:a | declNodes add: a]].
		n isSequence ifTrue: [n temporaries do: [:t | declNodes add: t]]].
	"assignments to the temp bound to this scope, and reads (non-declaration variable
	 uses of the name bound to this scope that are not an assignment's LHS)."
	"Symbol identity throughout (never String =) -- see scopeNode:declaresName:."
	varSym := varName asSymbol.
	assigns := OrderedCollection new.
	tree nodesDo: [:n |
		(n isAssignment
			and: [n variable name asSymbol == varSym
			and: [(self declaringScopeForName: varName from: n variable) == declScope]])
			ifTrue: [assigns add: n]].
	tree nodesDo: [:n |
		(n isVariable
			and: [n name asSymbol == varSym
			and: [(declNodes includes: n) not
			and: [(self declaringScopeForName: varName from: n) == declScope]]])
			ifTrue: [(assigns anySatisfy: [:a | a variable == n]) ifFalse: [reads add: n]]].
	assigns isEmpty ifTrue: [^self declineWith: '''', varName, ''' is never assigned a value, so there is nothing to inline.'].
	assigns size > 1 ifTrue: [^self declineWith: '''', varName, ''' is assigned more than once; Inline Temporary supports a temporary assigned exactly once.'].
	reads isEmpty ifTrue: [^self declineWith: '''', varName, ''' is never read; there is nothing to inline.'].
	assignmentNode := assigns first.
	(declScope statements anySatisfy: [:s | s == assignmentNode])
		ifFalse: [^self declineWith: '''', varName, ''' is assigned inside a nested block or conditional; its value may not always be set, so it cannot be inlined.'].
	(reads anySatisfy: [:r | r start < assignmentNode stop])
		ifTrue: [^self declineWith: '''', varName, ''' is used before it is assigned; inlining could change its value.'].
	valueSrc := self sourceString copyFrom: assignmentNode value start to: assignmentNode value stop.
	valueIsAtomic := self isAtomicSource: valueSrc.
	(valueIsAtomic not and: [reads size > 1])
		ifTrue: [^self declineWith: '''', varName, ''' is used ', reads size printString,
			' times and its value is not a simple expression; inlining it could evaluate it repeatedly and change behaviour.']
]

{ #category : 'private - analysis' }
GsInlineTemporaryRefactoring >> declineNonLocal [
	"The name at the caret is not a method-local. Classify it (instance variable, class
	 variable, global) so the decline reason points the user elsewhere."
	| sym |
	sym := varName asSymbol.
	((definingClass allInstVarNames collect: [:e | e asSymbol]) includes: sym)
		ifTrue: [^self declineWith: '''', varName, ''' is an instance variable; only a method or block temporary can be inlined.'].
	(self visibleClassVarNames includes: sym)
		ifTrue: [^self declineWith: '''', varName, ''' is a class variable; only a method or block temporary can be inlined.'].
	((environment symbolList objectNamed: sym) notNil)
		ifTrue: [^self declineWith: '''', varName, ''' is a global; only a method or block temporary can be inlined.'].
	^self declineWith: '''', varName, ''' is not a temporary at that position (it may be a message selector or an undeclared name).'
]

{ #category : 'private - analysis' }
GsInlineTemporaryRefactoring >> visibleClassVarNames [
	| names classes |
	names := IdentitySet new.
	classes := OrderedCollection new.
	classes add: definingClass.
	classes addAll: definingClass allSuperclasses.
	classes do: [:cls | cls classVarNames do: [:n | names add: n asSymbol]].
	^names
]

{ #category : 'private - analysis' }
GsInlineTemporaryRefactoring >> isPseudoVariable: aSymbol [
	^#(#self #super #thisContext #nil #true #false) includes: aSymbol
]

{ #category : 'private - analysis' }
GsInlineTemporaryRefactoring >> isAtomicSource: aString [
	"True when the value expression is a lone variable or literal, so it never needs
	 parentheses at a sub-expression position and may be substituted more than once."
	| node |
	node := [RBParser parseExpression: aString] on: Error do: [:e | nil].
	node isNil ifTrue: [^false].
	^node isVariable or: [node isLiteralNode]
]

{ #category : 'preconditions' }
GsInlineTemporaryRefactoring >> declineReason [
	"nil if the temporary can be inlined, otherwise a reason that blocks Apply."
	self ensureAnalysis.
	^declineString
]

{ #category : 'building' }
GsInlineTemporaryRefactoring >> buildChangeSet [
	"Rewrite the source (reads replaced by the value, assignment removed, temporary
	 dropped from its declaration) and stage a SINGLE #methodRecompile. Empty when the
	 inline is declined. Compiles nothing, commits nothing."
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
GsInlineTemporaryRefactoring >> rewrittenSource [
	"The method source with each read replaced by the (parenthesised-as-needed) value,
	 the assignment statement removed, and the temporary dropped from its declaration.
	 Minimal-diff string splicing over disjoint intervals."
	| src edits rem |
	src := self sourceString.
	edits := OrderedCollection new.
	reads do: [:r |
		edits add: (Array with: r start with: r stop with: (self valueTextFor: r))].
	rem := self removalIntervalFor: assignmentNode in: src.
	edits add: (Array with: (rem at: 1) with: (rem at: 2) with: '').
	edits add: self declarationEdit.
	^self applyEdits: edits to: src
]

{ #category : 'building - source' }
GsInlineTemporaryRefactoring >> valueTextFor: aReadNode [
	"The value source spliced at aReadNode, parenthesised only where precedence
	 requires: an atomic value never needs parens; otherwise parens unless the read is a
	 whole return value, assignment value, or bare statement."
	^(self readNeedsParens: aReadNode)
		ifTrue: ['(', valueSrc, ')']
		ifFalse: [valueSrc]
]

{ #category : 'building - source' }
GsInlineTemporaryRefactoring >> readNeedsParens: aReadNode [
	| parent |
	valueIsAtomic ifTrue: [^false].
	parent := aReadNode parent.
	parent isNil ifTrue: [^false].
	parent isReturn ifTrue: [^false].
	parent isSequence ifTrue: [^false].
	(parent isAssignment and: [parent value == aReadNode]) ifTrue: [^false].
	^true
]

{ #category : 'building - source' }
GsInlineTemporaryRefactoring >> removalIntervalFor: aStatement in: src [
	"The source interval to delete for aStatement: the statement, its trailing '.'
	 separator, and -- only when the rest of the line is whitespace -- the line's
	 leading indentation and newline, so no dangling '.' or blank line is left. Never
	 crosses into another statement sharing the line."
	| start stop p q r leadingWs |
	start := aStatement start.
	p := aStatement start.
	[p > 1 and: [((src at: p - 1) ~= Character lf) and: [(src at: p - 1) ~= Character cr]]]
		whileTrue: [p := p - 1].
	leadingWs := (p to: aStatement start - 1) allSatisfy: [:i |
		((src at: i) = Character space) or: [(src at: i) = Character tab]].
	leadingWs ifTrue: [start := p].
	stop := aStatement stop.
	q := stop.
	[q < src size and: [((src at: q + 1) = Character space) or: [(src at: q + 1) = Character tab]]]
		whileTrue: [q := q + 1].
	(q < src size and: [(src at: q + 1) = $.])
		ifTrue: [
			q := q + 1.
			r := q.
			[r < src size and: [((src at: r + 1) = Character space) or: [(src at: r + 1) = Character tab]]]
				whileTrue: [r := r + 1].
			(r < src size and: [((src at: r + 1) = Character lf) or: [(src at: r + 1) = Character cr]])
				ifTrue: [
					r := r + 1.
					(r < src size and: [(src at: r) = Character cr and: [(src at: r + 1) = Character lf]])
						ifTrue: [r := r + 1].
					stop := r]
				ifFalse: [stop := q]].
	^Array with: start with: stop
]

{ #category : 'building - source' }
GsInlineTemporaryRefactoring >> declarationEdit [
	"The {start, stop, text} triple that removes the temporary from its declaring
	 sequence's '| .. |' clause -- dropping the whole clause when it was the only
	 temporary."
	| lb rb keep |
	lb := declScope leftBar.
	rb := declScope rightBar.
	(lb isNil or: [rb isNil]) ifTrue: [^Array with: 1 with: 0 with: ''].
	keep := declScope temporaries reject: [:t | t name asSymbol == varName asSymbol].
	keep isEmpty ifTrue: [^Array with: lb with: rb with: ''].
	^Array with: lb with: rb with:
		('| ', (keep inject: '' into: [:acc :t | acc isEmpty ifTrue: [t name] ifFalse: [acc, ' ', t name]]), ' |')
]

{ #category : 'building - source' }
GsInlineTemporaryRefactoring >> applyEdits: editTriples to: aString [
	"Apply {start, stop, text} triples by pure splicing, in descending start order (ties
	 by descending stop), so each edit's original coordinates stay valid. A pure removal
	 has an empty text; a no-op has stop = start - 1 and empty text."
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

{ #category : 'private' }
GsInlineTemporaryRefactoring >> methodCategory [
	^((self targetClass categoryOfSelector: selector environmentId: 0)
		ifNil: ['as yet unclassified']) asString
]

{ #category : 'private' }
GsInlineTemporaryRefactoring >> dictNameForClass: aClass [
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
]

{ #category : 'serializing' }
GsInlineTemporaryRefactoring >> analysisJsonString [
	"The pre-flight payload: the temporary's name and any decline reason."
	self ensureAnalysis.
	^'{"name":', ((declineString notNil or: [varName isNil])
			ifTrue: ['null'] ifFalse: [self jsonQuote: varName]),
	  ',"decline":', (declineString ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  '}'
]

{ #category : 'serializing' }
GsInlineTemporaryRefactoring >> previewJsonString [
	^self changeSet jsonString
]

{ #category : 'serializing' }
GsInlineTemporaryRefactoring >> outOfScopeJsonString [
	"The scope / precondition payload for the preview panel, in the family's shape.
	 Inlining introduces no shadowing, so collision is always null; a hard decline rides
	 here."
	^'{"references":0,"skipped":0,"scope":"method","collision":null,"decline":',
	  (self declineReason ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  '}'
]

{ #category : 'paginated preview' }
GsInlineTemporaryRefactoring >> startPreviewToken: token maxBytes: maxBytes [
	"Build the change set, stash this refactoring in SessionTemps under token, and
	 answer the first page plus totals and precondition warnings. Nothing is committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"name":', (varName isNil ifTrue: ['null'] ifFalse: [self jsonQuote: varName]),
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"skippedMethods":[]',
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'paginated preview' }
GsInlineTemporaryRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
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
GsInlineTemporaryRefactoring >> applyDeselected: deselectedIds [
	"Apply the staged change in the stone WITHOUT committing. A single #methodRecompile,
	 so deselectedIds is inert. Answers {applied, failed:[..]}."
	| applied failures |
	failures := OrderedCollection new.
	applied := 0.
	self changeSet changes do: [:change |
		[self applyChange: change. applied := applied + 1]
		on: Error do: [:e |
			failures add: (Array with: change id with: change failureLabel with: e messageText)]].
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
GsInlineTemporaryRefactoring >> applyChange: aChange [
	aChange kind == #methodRecompile ifTrue: [^self applyMethodRecompile: aChange].
	^self error: 'Unexpected change kind for inline-temporary: ', aChange kind printString
]

{ #category : 'applying' }
GsInlineTemporaryRefactoring >> applyMethodRecompile: aChange [
	"Recompile the one method with its rewritten source. No commit."
	| cls target |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	environment
		compile: aChange newSource
		into: target
		category: (aChange category ifNil: ['as yet unclassified'])
]

{ #category : 'serializing' }
GsInlineTemporaryRefactoring >> jsonQuote: aString [
	^GsRefactoringJson jsonQuote: aString
]

{ #category : 'serializing' }
GsInlineTemporaryRefactoring >> jsonEscape: aString [
	^GsRefactoringJson jsonEscape: aString
]

{ #category : 'serializing' }
GsInlineTemporaryRefactoring >> hex2: anInteger [
	^GsRefactoringJson hex2: anInteger
]
