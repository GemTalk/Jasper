"
Extract a selected run of statements -- or a single expression -- from a method
into a NEW method, replacing the selection with a send to it (M1). This is the
first non-rename refactoring and the first that CREATES a method: it stages
exactly two core changes -- a #methodAdd for the extracted method and a
#methodRecompile for the rewritten original -- plus, when the caller opts in
(replaceSimilar), one deselectable #methodRecompile per structurally-equivalent
run found elsewhere in the class + hierarchy (see stageSimilarSitesInto:).

The refactoring is addressed by class + selector + isMeta + a source INTERVAL
(selStart..selStop, 1-based character offsets into the method source, from the
editor selection) + the new selector the user typed. The variables the extracted
code reads from OUTSIDE the selection become the new method's arguments, in source
order, keeping their original names (RBReadBeforeWrittenTester decides read-vs-write
flow). A single variable assigned inside the selection and used afterward becomes
the new method's return value (more than one is declined). A method temporary used
only inside the selection is moved into the new method.

The selection is DECLINED (an empty change set + a declineReason, surfaced in the
preview, Apply blocked) when it does not resolve to whole statements / a single
expression, assigns more than one variable used later, contains a ^ return, sends
to super, uses thisContext, or the new selector's arity does not match the argument
count. A new selector already implemented in the hierarchy is a SOFT collision
WARNING (surfaced, Apply still allowed).

Building the change set compiles nothing and commits nothing. The server-side apply
compiles the new method and recompiles the rewritten original (add-first) plus any
selected duplicate sites -- but NEVER commits (the user commits explicitly).
"
Class {
	#name : 'GsExtractMethodRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'definingClass',
		'selector',
		'isMeta',
		'selStart',
		'selStop',
		'newSelector',
		'replaceSimilar',
		'changeSet',
		'analysisDone',
		'selectedNodes',
		'isExpression',
		'firstStart',
		'lastStop',
		'argNames',
		'returnVar',
		'internalTempNames',
		'structuralDecline'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsExtractMethodRefactoring class >> class: aClass selector: aSelector meta: aBool selStart: startOffset selStop: stopOffset newSelector: newSelectorString [
	"Extract the source between startOffset and stopOffset (1-based, inclusive) of
	 aClass>>aSelector into a new method named newSelectorString."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		selector: aSelector
		meta: aBool
		selStart: startOffset
		selStop: stopOffset
		newSelector: newSelectorString
]

{ #category : 'instance creation' }
GsExtractMethodRefactoring class >> environment: anEnvironment class: aClass selector: aSelector meta: aBool selStart: startOffset selStop: stopOffset newSelector: newSelectorString [
	^self new
		setEnvironment: anEnvironment
		class: aClass
		selector: aSelector
		meta: aBool
		selStart: startOffset
		selStop: stopOffset
		newSelector: newSelectorString
]

{ #category : 'preconditions' }
GsExtractMethodRefactoring class >> analyzeSelectionForClass: aClass selector: aSelector meta: aBool selStart: startOffset selStop: stopOffset [
	"A pre-flight the client runs before prompting for the new selector: how many
	 arguments the selection needs, their names, whether it returns a value, whether
	 it is a safe void shape (eligible for the replace-similar pass), and a decline
	 reason if the selection itself cannot be extracted. The new selector is not known
	 yet, so arity/collision are not checked here."
	^(self
		class: aClass
		selector: aSelector
		meta: aBool
		selStart: startOffset
		selStop: stopOffset
		newSelector: '') analysisJsonString
]

{ #category : 'paginated preview' }
GsExtractMethodRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	"A page from a previously-started preview (see startPreviewToken:maxBytes:), by
	 token. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'paginated preview' }
GsExtractMethodRefactoring class >> applyForToken: token deselected: deselectedIds [
	"Apply a previously-started preview (by token). No commit. Answers an error
	 envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'paginated preview' }
GsExtractMethodRefactoring class >> clearToken: token [
	"Drop a finished preview from SessionTemps."
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'private' }
GsExtractMethodRefactoring >> setEnvironment: anEnvironment class: aClass selector: aSelector meta: aBool selStart: startOffset selStop: stopOffset newSelector: newSelectorString [
	environment := anEnvironment.
	definingClass := aClass.
	selector := aSelector asSymbol.
	isMeta := aBool.
	selStart := startOffset.
	selStop := stopOffset.
	newSelector := newSelectorString asString.
	replaceSimilar := false.
	analysisDone := false
]

{ #category : 'accessing' }
GsExtractMethodRefactoring >> replaceSimilar: aBool [
	"Turn on the optional pass that also replaces structurally-equivalent runs in the
	 class + hierarchy. Off by default."
	replaceSimilar := aBool
]

{ #category : 'accessing' }
GsExtractMethodRefactoring >> environment [
	^environment
]

{ #category : 'accessing' }
GsExtractMethodRefactoring >> definingClass [
	^definingClass
]

{ #category : 'accessing' }
GsExtractMethodRefactoring >> selector [
	^selector
]

{ #category : 'accessing' }
GsExtractMethodRefactoring >> isMeta [
	^isMeta
]

{ #category : 'accessing' }
GsExtractMethodRefactoring >> newSelector [
	^newSelector
]

{ #category : 'accessing' }
GsExtractMethodRefactoring >> argNames [
	self ensureAnalysis.
	^argNames
]

{ #category : 'accessing' }
GsExtractMethodRefactoring >> returnVar [
	self ensureAnalysis.
	^returnVar
]

{ #category : 'accessing' }
GsExtractMethodRefactoring >> changeSet [
	"The staged, non-committing change set, computed once and cached. Empty when the
	 extraction is declined."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'private' }
GsExtractMethodRefactoring >> targetClass [
	"The behaviour that holds (and will hold the new) method: the metaclass for a
	 class-side method."
	^isMeta ifTrue: [definingClass class] ifFalse: [definingClass]
]

{ #category : 'private' }
GsExtractMethodRefactoring >> sourceString [
	"The stored source of the method being refactored, or nil if it does not exist."
	| m |
	m := self targetClass compiledMethodAt: selector environmentId: 0 otherwise: nil.
	^m isNil ifTrue: [nil] ifFalse: [m sourceString]
]

{ #category : 'private' }
GsExtractMethodRefactoring >> parseTree [
	"A fresh parse of the method source, or nil if it is missing or unparseable."
	| src |
	src := self sourceString.
	src isNil ifTrue: [^nil].
	^[RBParser parseMethod: src] on: Error do: [:e | nil]
]

{ #category : 'private' }
GsExtractMethodRefactoring >> isPseudoVariable: aName [
	^#('self' 'super' 'thisContext' 'nil' 'true' 'false') includes: aName asString
]

{ #category : 'private - scope' }
GsExtractMethodRefactoring >> scopeNode: aNode declaresName: aName [
	"Does aNode introduce a scope binding (argument or temporary) for aName?"
	(aNode isMethod or: [aNode isBlock])
		ifTrue: [^aNode arguments anySatisfy: [:a | a name = aName]].
	aNode isSequence
		ifTrue: [^aNode temporaries anySatisfy: [:t | t name = aName]].
	^false
]

{ #category : 'private - scope' }
GsExtractMethodRefactoring >> declaringScopeForName: aName from: aNode [
	"The nearest enclosing scope node that declares aName as an argument or temporary,
	 walking aNode's parent chain outward -- or nil if aName is not a local there."
	| n |
	n := aNode.
	[n notNil] whileTrue: [
		(self scopeNode: n declaresName: aName) ifTrue: [^n].
		n := n parent].
	^nil
]

{ #category : 'private - scope' }
GsExtractMethodRefactoring >> scopeOutsideSelection: aScope [
	"True when aScope (a declaring scope) is NOT fully contained in the selection --
	 i.e. the binding is declared outside the extracted code (a method/enclosing-block
	 argument or an outer temporary), the case that turns into an argument or return."
	^(aScope start >= firstStart and: [aScope stop <= lastStop]) not
]

{ #category : 'private - analysis' }
GsExtractMethodRefactoring >> ensureAnalysis [
	analysisDone ifFalse: [
		analysisDone := true.
		[self computeAnalysis] on: Error do: [:e |
			structuralDecline := 'The selection could not be analysed: ', e messageText]]
]

{ #category : 'private - analysis' }
GsExtractMethodRefactoring >> declineWith: aReason [
	"Record a hard-decline reason and answer nil, so a caller can bail with
	 ^self declineWith: '...' from inside computeAnalysis."
	structuralDecline := aReason.
	^nil
]

{ #category : 'private - analysis' }
GsExtractMethodRefactoring >> computeAnalysis [
	"Resolve the selection to whole statements or a single expression, then classify
	 the variables it references into arguments (read from outside), a single return
	 value (assigned inside and used after), and internal temporaries (declared
	 outside but used only inside). Sets structuralDecline on any hard precondition."
	| tree stmts node |
	argNames := OrderedCollection new.
	internalTempNames := OrderedCollection new.
	returnVar := nil.
	isExpression := false.
	selectedNodes := #().
	structuralDecline := nil.
	tree := self parseTree.
	tree isNil ifTrue: [^self declineWith: 'The method source does not parse.'].
	stmts := self selectedStatementsIn: tree.
	stmts notEmpty
		ifTrue: [
			selectedNodes := stmts.
			firstStart := stmts first start.
			lastStop := stmts last stop]
		ifFalse: [
			node := [tree bestNodeFor: (selStart to: selStop)] on: Error do: [:e | nil].
			(node notNil and: [node isValue and: [node isReturn not
				and: [node start >= (selStart - 1) and: [node stop <= (selStop + 1)]]]])
				ifTrue: [
					isExpression := true.
					selectedNodes := Array with: node.
					firstStart := node start.
					lastStop := node stop]
				ifFalse: [^self declineWith: 'Select one or more whole statements, or a single expression, to extract.']].
	self selectionContainsReturn
		ifTrue: [^self declineWith: 'The selection contains a method return (^); extracting it would change control flow.'].
	(self selectionReferences: 'super')
		ifTrue: [^self declineWith: 'The selection sends to super and cannot be moved into a new method.'].
	(self selectionReferences: 'thisContext')
		ifTrue: [^self declineWith: 'The selection uses thisContext and cannot be extracted.'].
	self classifyVariablesIn: tree
]

{ #category : 'private - analysis' }
GsExtractMethodRefactoring >> selectedStatementsIn: tree [
	"The statements of the deepest sequence covering the selection that OVERLAP the
	 selection interval, in source order. Empty when the selection is not a statement
	 run (it may be a single expression, resolved separately)."
	"The statements FULLY inside the selection, taken from the OUTERMOST sequence that
	 has any. Only whole-statement containment matters -- NOT where the sequence itself
	 begins -- so selecting the leading indentation of the first line (or a trailing
	 newline) still resolves. A selection lying strictly within a single statement
	 (e.g. the inner expression of a ^-return) covers no whole statement here and is
	 handled as a single-expression extract instead. Picking the outermost qualifying
	 sequence means selecting a whole control-flow statement extracts that statement,
	 not the contents of the block nested inside it."
	| best bestStmts |
	best := nil.
	bestStmts := nil.
	tree nodesDo: [:n |
		n isSequence ifTrue: [
			| covered |
			covered := n statements select: [:s | s start >= selStart and: [s stop <= selStop]].
			covered notEmpty ifTrue: [
				(best isNil or: [n start < best start]) ifTrue: [best := n. bestStmts := covered]]]].
	^bestStmts ifNil: [OrderedCollection new]
]

{ #category : 'private - analysis' }
GsExtractMethodRefactoring >> selectionContainsReturn [
	selectedNodes do: [:top | top nodesDo: [:n | n isReturn ifTrue: [^true]]].
	^false
]

{ #category : 'private - analysis' }
GsExtractMethodRefactoring >> selectionReferences: aName [
	selectedNodes do: [:top | top nodesDo: [:n |
		(n isVariable and: [n name = aName]) ifTrue: [^true]]].
	^false
]

{ #category : 'private - analysis' }
GsExtractMethodRefactoring >> classifyVariablesIn: tree [
	"Fill argNames, returnVar and internalTempNames. external = locals referenced in
	 the selection whose declaring scope is outside it; a body temporary used only
	 inside becomes internal; arguments are the read-before-written externals (source
	 order); the single assigned-and-used-after external is the return value."
	| external assignedExternal bodyTemps probe rbw returnVars |
	external := OrderedCollection new.
	assignedExternal := Set new.
	selectedNodes do: [:top | top nodesDo: [:n |
		(n isVariable and: [(self isPseudoVariable: n name) not]) ifTrue: [
			| scope |
			scope := self declaringScopeForName: n name from: n.
			(scope notNil and: [self scopeOutsideSelection: scope])
				ifTrue: [(external includes: n name) ifFalse: [external add: n name]]].
		n isAssignment ifTrue: [
			| scope |
			scope := self declaringScopeForName: n variable name from: n variable.
			(scope notNil and: [self scopeOutsideSelection: scope])
				ifTrue: [assignedExternal add: n variable name]]]].
	"A method-body temporary used ONLY inside the selection is moved into the new
	 method rather than passed as an argument."
	bodyTemps := tree body temporaries collect: [:t | t name].
	external copy do: [:nm |
		((bodyTemps includes: nm)
			and: [(self referencesOf: nm outsideSelectionIn: tree) isEmpty])
			ifTrue: [internalTempNames add: nm. external remove: nm]].
	"return value: an external assigned inside and referenced after the selection."
	returnVars := external select: [:nm |
		(assignedExternal includes: nm) and: [(self referencesOf: nm afterSelectionIn: tree) notEmpty]].
	returnVars size > 1 ifTrue: [
		^self declineWith: 'The selection assigns ', returnVars size printString,
			' variables used later; a method can return only one.'].
	returnVar := returnVars isEmpty ifTrue: [nil] ifFalse: [returnVars first].
	"arguments: the read-before-written externals, in source order."
	probe := [RBParser parseMethod: 'gsExtractMethodProbe ', self extractedSource]
		on: Error do: [:e | nil].
	rbw := probe isNil
		ifTrue: [external asArray]
		ifFalse: [RBReadBeforeWrittenTester readBeforeWritten: external asArray in: probe].
	argNames := external select: [:nm | rbw includes: nm]
]

{ #category : 'private - analysis' }
GsExtractMethodRefactoring >> referencesOf: aName inTree: tree [
	"Every variable-node USE (not a declaration) of aName in tree, as an Array with
	 source positions, so read/write timing can be judged by position."
	| decls refs |
	decls := IdentitySet new.
	tree nodesDo: [:n |
		(n isMethod or: [n isBlock]) ifTrue: [n arguments do: [:a | decls add: a]].
		n isSequence ifTrue: [n temporaries do: [:t | decls add: t]]].
	refs := OrderedCollection new.
	tree nodesDo: [:n |
		(n isVariable and: [n name = aName and: [(decls includes: n) not]])
			ifTrue: [refs add: n]].
	^refs
]

{ #category : 'private - analysis' }
GsExtractMethodRefactoring >> referencesOf: aName outsideSelectionIn: tree [
	^(self referencesOf: aName inTree: tree)
		select: [:r | r start < firstStart or: [r start > lastStop]]
]

{ #category : 'private - analysis' }
GsExtractMethodRefactoring >> referencesOf: aName afterSelectionIn: tree [
	^(self referencesOf: aName inTree: tree) select: [:r | r start > lastStop]
]

{ #category : 'private - analysis' }
GsExtractMethodRefactoring >> extractedSource [
	"The verbatim source of the selected statements / expression."
	^self sourceString copyFrom: firstStart to: lastStop
]

{ #category : 'private - selector' }
GsExtractMethodRefactoring >> isKeywordSelector [
	^newSelector includes: $:
]

{ #category : 'private - selector' }
GsExtractMethodRefactoring >> isBinarySelector [
	^newSelector notEmpty
		and: [(newSelector first isLetter or: [newSelector first == $_]) not]
]

{ #category : 'private - selector' }
GsExtractMethodRefactoring >> keywordParts [
	"The keyword parts of a keyword selector, each ending in a colon (e.g. #('at:'
	 'put:'))."
	| parts seg |
	parts := OrderedCollection new.
	seg := WriteStream on: String new.
	newSelector do: [:ch |
		seg nextPut: ch.
		ch == $: ifTrue: [parts add: seg contents. seg := WriteStream on: String new]].
	^parts
]

{ #category : 'private - selector' }
GsExtractMethodRefactoring >> expectedArgCount [
	self isKeywordSelector ifTrue: [^self keywordParts size].
	self isBinarySelector ifTrue: [^1].
	^0
]

{ #category : 'private - selector' }
GsExtractMethodRefactoring >> newSelectorSymbol [
	^newSelector asSymbol
]

{ #category : 'private - source' }
GsExtractMethodRefactoring >> headerSource [
	"The pattern line of the new method: the selector interleaved with the argument
	 names (which keep the extracted variables' own names)."
	| ws parts |
	self isKeywordSelector ifTrue: [
		ws := WriteStream on: String new.
		parts := self keywordParts.
		1 to: parts size do: [:i |
			i > 1 ifTrue: [ws nextPut: $ ].
			ws nextPutAll: (parts at: i); nextPut: $ ; nextPutAll: (argNames at: i)].
		^ws contents].
	self isBinarySelector ifTrue: [^newSelector, ' ', (argNames at: 1)].
	^newSelector
]

{ #category : 'private - source' }
GsExtractMethodRefactoring >> sendSourceWithArgs: argValues [
	"A 'self <selector> ...' send whose arguments are argValues (source strings)."
	| ws parts |
	self isKeywordSelector ifTrue: [
		ws := WriteStream on: String new.
		ws nextPutAll: 'self'.
		parts := self keywordParts.
		1 to: parts size do: [:i |
			ws nextPut: $ ; nextPutAll: (parts at: i); nextPut: $ ; nextPutAll: (argValues at: i)].
		^ws contents].
	self isBinarySelector ifTrue: [^'self ', newSelector, ' ', (argValues at: 1)].
	^'self ', newSelector
]

{ #category : 'private - source' }
GsExtractMethodRefactoring >> callSendSource [
	^self sendSourceWithArgs: argNames
]

{ #category : 'private - source' }
GsExtractMethodRefactoring >> callText [
	"The text that replaces the selection in the original method: a bare send, an
	 assignment of the send to the return variable, or (for an expression extract) the
	 send, parenthesised ONLY when precedence requires it."
	isExpression ifTrue: [
		^self expressionNeedsParens
			ifTrue: ['(', self callSendSource, ')']
			ifFalse: [self callSendSource]].
	returnVar notNil ifTrue: [^returnVar, ' := ', self callSendSource].
	^self callSendSource
]

{ #category : 'private - source' }
GsExtractMethodRefactoring >> expressionNeedsParens [
	"Whether the send replacing an extracted expression must be parenthesised to
	 preserve meaning. A unary send never needs them; a keyword or binary send does
	 only when it replaces a SUB-expression (an argument, a receiver, a binary
	 operand). Replacing a whole return value, assignment value, or statement does
	 not, so ^total * factor becomes ^self factor: factor -- not ^(self factor: factor)."
	| node parent |
	argNames isEmpty ifTrue: [^false].
	node := selectedNodes first.
	parent := node parent.
	parent isNil ifTrue: [^false].
	parent isReturn ifTrue: [^false].
	parent isSequence ifTrue: [^false].
	(parent isAssignment and: [parent value == node]) ifTrue: [^false].
	^true
]

{ #category : 'private - source' }
GsExtractMethodRefactoring >> newMethodTemps [
	"The temporaries the extracted method must declare: those moved in because they
	 were used only inside the selection, plus the return variable when it is assigned
	 (not passed in as an argument) -- otherwise the new method would use an undeclared
	 variable."
	| temps |
	temps := OrderedCollection new.
	temps addAll: internalTempNames.
	(returnVar notNil and: [(argNames includes: returnVar) not
		and: [(temps includes: returnVar) not]])
		ifTrue: [temps add: returnVar].
	^temps
]

{ #category : 'private - source' }
GsExtractMethodRefactoring >> newMethodSource [
	"The source of the extracted method: the pattern line, any declared temporaries,
	 the selected statements verbatim, and a trailing ^returnVar (or ^expression)."
	| ws lf temps |
	lf := Character lf.
	temps := self newMethodTemps.
	ws := WriteStream on: String new.
	ws nextPutAll: self headerSource.
	temps isEmpty ifFalse: [
		ws nextPut: lf; tab; nextPutAll: '| '.
		temps do: [:nm | ws nextPutAll: nm; nextPut: $ ].
		ws nextPut: $|].
	ws nextPut: lf; tab.
	isExpression
		ifTrue: [ws nextPut: $^; nextPutAll: self extractedSource]
		ifFalse: [
			ws nextPutAll: self extractedSource.
			returnVar notNil ifTrue: [ws nextPut: $.; nextPut: lf; tab; nextPut: $^; nextPutAll: returnVar]].
	^self formatMethod: ws contents
]

{ #category : 'private - source' }
GsExtractMethodRefactoring >> formatMethod: aSource [
	"Reformat a generated method to the canonical RB layout (consistent indentation,
	 one statement per line) so the extracted method is presented tidily in the
	 preview and stored tidily on apply. The verbatim source we splice together keeps
	 each statement's ORIGINAL indentation, which reads raggedly under the new pattern
	 line; reparsing and reformatting fixes that. Falls back to the raw source if it
	 does not parse."
	^[(RBParser parseMethod: aSource) formattedCode] on: Error do: [:e | aSource]
]

{ #category : 'private - source' }
GsExtractMethodRefactoring >> rewrittenOriginalSource [
	"The original method with the selected range replaced by the call, and any moved
	 temporaries dropped from its temporary declaration. Pure source splicing keyed on
	 node intervals -- minimal diff, no reformatting."
	| src spliced |
	src := self sourceString.
	spliced := (src copyFrom: 1 to: firstStart - 1), self callText,
		(src copyFrom: lastStop + 1 to: src size).
	internalTempNames isEmpty ifTrue: [^spliced].
	^self removeInternalTempsFromSource: spliced
]

{ #category : 'private - source' }
GsExtractMethodRefactoring >> removeInternalTempsFromSource: aSource [
	"Rebuild the method body's | temps | clause of aSource without the moved
	 temporaries. Reparses aSource (already valid) to find the temp-bar positions."
	| tree seq keep clause lb rb |
	tree := [RBParser parseMethod: aSource] on: Error do: [:e | nil].
	tree isNil ifTrue: [^aSource].
	seq := tree body.
	seq temporaries isEmpty ifTrue: [^aSource].
	lb := seq leftBar.
	rb := seq rightBar.
	(lb isNil or: [rb isNil]) ifTrue: [^aSource].
	keep := seq temporaries reject: [:t | internalTempNames includes: t name].
	clause := keep isEmpty
		ifTrue: ['']
		ifFalse: ['| ', (keep
			inject: ''
			into: [:acc :t | acc isEmpty ifTrue: [t name] ifFalse: [acc, ' ', t name]]), ' |'].
	^(aSource copyFrom: 1 to: lb - 1), clause, (aSource copyFrom: rb + 1 to: aSource size)
]

{ #category : 'private' }
GsExtractMethodRefactoring >> methodCategory [
	^((self targetClass categoryOfSelector: selector environmentId: 0)
		ifNil: ['as yet unclassified']) asString
]

{ #category : 'private' }
GsExtractMethodRefactoring >> dictNameForClass: aClass [
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
]

{ #category : 'preconditions' }
GsExtractMethodRefactoring >> declineReason [
	"nil if the extraction can proceed, otherwise a reason (structural precondition or
	 selector-arity mismatch) that blocks Apply."
	self ensureAnalysis.
	structuralDecline notNil ifTrue: [^structuralDecline].
	(newSelector isNil or: [newSelector isEmpty]) ifTrue: [^nil].
	"Naming the extracted method after the method being extracted FROM is broken: the
	 new method and the rewritten original would be the same method, so the rewrite
	 would just call itself. Refuse it outright (not merely the soft collision warning)."
	self newSelectorSymbol == selector ifTrue: [
		^'The new method cannot use the same selector as ', selector,
			' -- that is the method you are extracting from. Choose a different name.'].
	self expectedArgCount = argNames size ifFalse: [
		^'The selector ', newSelector, ' expects ', self expectedArgCount printString,
			' argument(s) but the selection needs ', argNames size printString, '.'].
	^nil
]

{ #category : 'preconditions' }
GsExtractMethodRefactoring >> collisionWarning [
	"nil, or a SOFT warning (surfaced, not blocking) that the new selector is already
	 implemented somewhere in the target class + hierarchy -- extracting would override
	 or shadow it."
	| sym hierarchy hits |
	self ensureAnalysis.
	(newSelector isNil or: [newSelector isEmpty]) ifTrue: [^nil].
	structuralDecline notNil ifTrue: [^nil].
	sym := self newSelectorSymbol.
	hierarchy := IdentitySet new.
	hierarchy add: self targetClass.
	hierarchy addAll: self targetClass allSuperclasses.
	hierarchy addAll: (environment descendantsOf: self targetClass).
	hits := (environment implementorsOf: sym) select: [:m |
		hierarchy includes: m inClass].
	hits isEmpty ifTrue: [^nil].
	^'The selector ', newSelector, ' is already implemented in the hierarchy (',
		hits first inClass name asString,
		(hits size > 1 ifTrue: [' and ', (hits size - 1) printString, ' other(s)'] ifFalse: ['']),
		'); extracting will override or shadow it.'
]

{ #category : 'testing' }
GsExtractMethodRefactoring >> isSafeVoidShape [
	"The replace-similar pass runs only for a pure void extraction: no return value, no
	 moved temporaries, and a statement run (not a single expression). Anything else
	 would need to reproduce assign/return wiring at each duplicate site."
	self ensureAnalysis.
	^returnVar isNil and: [internalTempNames isEmpty and: [isExpression not]]
]

{ #category : 'building' }
GsExtractMethodRefactoring >> buildChangeSet [
	"Stage the two core changes (the new method, then the rewritten original) and,
	 when replaceSimilar is on and the extraction is a safe void shape, one
	 deselectable recompile per structurally-equivalent run in the hierarchy. Empty
	 when the extraction is declined. Compiles nothing, commits nothing."
	| cs dict |
	cs := GsRefactoringChangeSet new.
	self ensureAnalysis.
	self declineReason notNil ifTrue: [^cs].
	dict := self dictNameForClass: definingClass.
	cs
		addMethodAddInDictionary: dict
		className: definingClass name
		isMeta: isMeta
		selector: self newSelectorSymbol
		category: self methodCategory
		newSource: self newMethodSource.
	cs
		addMethodRecompileInDictionary: dict
		className: definingClass name
		isMeta: isMeta
		selector: selector
		category: self methodCategory
		oldSource: self sourceString
		newSource: self rewrittenOriginalSource.
	(replaceSimilar and: [self isSafeVoidShape])
		ifTrue: [self stageSimilarSitesInto: cs].
	^cs
]

{ #category : 'building - similar' }
GsExtractMethodRefactoring >> stageSimilarSitesInto: cs [
	"Find statement runs elsewhere in the target class + hierarchy that are
	 structurally equivalent to the extracted selection (ignoring the argument
	 positions) and stage a deselectable recompile replacing each with a send to the
	 new method. Best-effort: any method that will not parse or match is skipped."
	| classes |
	classes := OrderedCollection new.
	classes add: self targetClass.
	classes addAll: self targetClass allSuperclasses.
	classes addAll: (environment descendantsOf: self targetClass).
	classes do: [:cls |
		[(cls selectors ifNil: [#()]) do: [:sel |
			(cls == self targetClass and: [sel == selector])
				ifFalse: [self stageSimilarInClass: cls selector: sel into: cs]]]
			on: Error do: [:e | nil]]
]

{ #category : 'building - similar' }
GsExtractMethodRefactoring >> stageSimilarInClass: cls selector: sel into: cs [
	"Stage at most one duplicate replacement in cls>>sel (the first matching window)."
	| m src tree stmts n |
	m := cls compiledMethodAt: sel environmentId: 0 otherwise: nil.
	m isNil ifTrue: [^self].
	src := m sourceString.
	tree := [RBParser parseMethod: src] on: Error do: [:e | nil].
	tree isNil ifTrue: [^self].
	stmts := tree body statements.
	n := selectedNodes size.
	n = 0 ifTrue: [^self].
	1 to: stmts size - n + 1 do: [:i |
		| window binding |
		window := (i to: i + n - 1) collect: [:j | stmts at: j].
		binding := Dictionary new.
		(self matchTemplate: selectedNodes against: window binding: binding) ifTrue: [
			| fStart lStop call |
			fStart := window first start.
			lStop := window last stop.
			call := self sendSourceWithArgs: (argNames collect: [:nm | binding at: nm ifAbsent: [nm]]).
			cs
				addMethodRecompileInDictionary: (self dictNameForClass: cls)
				className: cls thisClass name
				isMeta: cls isMeta
				selector: sel
				category: ((cls categoryOfSelector: sel environmentId: 0) ifNil: ['as yet unclassified']) asString
				oldSource: src
				newSource: ((src copyFrom: 1 to: fStart - 1), call, (src copyFrom: lStop + 1 to: src size)).
			^self]]
]

{ #category : 'building - similar' }
GsExtractMethodRefactoring >> matchTemplate: templateNodes against: candidateNodes binding: aDict [
	templateNodes size = candidateNodes size ifFalse: [^false].
	1 to: templateNodes size do: [:i |
		(self matchNode: (templateNodes at: i) with: (candidateNodes at: i) binding: aDict)
			ifFalse: [^false]].
	^true
]

{ #category : 'building - similar' }
GsExtractMethodRefactoring >> matchNode: t with: c binding: aDict [
	"Structural equality of template node t and candidate node c, treating an argument
	 variable in t as a wildcard bound consistently to a candidate variable/literal."
	(t isVariable and: [argNames includes: t name]) ifTrue: [
		| prev csrc |
		(c isVariable or: [c isLiteralNode]) ifFalse: [^false].
		csrc := c formattedCode.
		prev := aDict at: t name ifAbsent: [nil].
		prev isNil ifTrue: [aDict at: t name put: csrc. ^true].
		^prev = csrc].
	t class == c class ifFalse: [^false].
	t isVariable ifTrue: [^t name = c name].
	t isLiteralNode ifTrue: [^t formattedCode = c formattedCode].
	t isMessage ifTrue: [^t selector = c selector and: [self matchChildren: t with: c binding: aDict]].
	^self matchChildren: t with: c binding: aDict
]

{ #category : 'building - similar' }
GsExtractMethodRefactoring >> matchChildren: t with: c binding: aDict [
	| tc cc |
	tc := t children.
	cc := c children.
	tc size = cc size ifFalse: [^false].
	1 to: tc size do: [:i |
		(self matchNode: (tc at: i) with: (cc at: i) binding: aDict) ifFalse: [^false]].
	^true
]

{ #category : 'serializing' }
GsExtractMethodRefactoring >> analysisJsonString [
	"The pre-flight payload: argument count/names, the return variable, the decline
	 reason (if any) and whether this is a replace-similar-eligible void shape."
	self ensureAnalysis.
	^'{"argCount":', argNames size printString,
	  ',"argNames":[', (argNames
		inject: ''
		into: [:acc :n | acc isEmpty ifTrue: [self jsonQuote: n] ifFalse: [acc, ',', (self jsonQuote: n)]]), ']',
	  ',"returnVar":', (returnVar ifNil: ['null'] ifNotNil: [:v | self jsonQuote: v]),
	  ',"safeVoidShape":', self isSafeVoidShape printString,
	  ',"decline":', (structuralDecline ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  '}'
]

{ #category : 'serializing' }
GsExtractMethodRefactoring >> previewJsonString [
	^self changeSet jsonString
]

{ #category : 'serializing' }
GsExtractMethodRefactoring >> outOfScopeJsonString [
	"The scope / precondition payload for the preview panel, in the family's shape. The
	 collision (soft, non-blocking) and decline (hard, blocking) reasons ride here."
	^'{"references":0,"skipped":0,"scope":"hierarchy"',
	  ',"collision":', (self collisionWarning
		ifNil: ['null'] ifNotNil: [:reason | self jsonQuote: reason]),
	  ',"decline":', (self declineReason
		ifNil: ['null'] ifNotNil: [:reason | self jsonQuote: reason]),
	  '}'
]

{ #category : 'paginated preview' }
GsExtractMethodRefactoring >> startPreviewToken: token maxBytes: maxBytes [
	"Build the change set, stash this refactoring in SessionTemps under token, and
	 answer the first page plus totals and precondition warnings. Nothing is committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"newSelector":', (self jsonQuote: newSelector),
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"skippedMethods":[]',
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'paginated preview' }
GsExtractMethodRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
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
GsExtractMethodRefactoring >> applyDeselected: deselectedIds [
	"Apply the staged changes in the stone WITHOUT committing. The two CORE changes
	 (the new method and the rewritten original) are always applied; a deselected id is
	 honoured only for the optional duplicate-replacement changes. Answers
	 {applied, failed:[..]}."
	| applied failures ids |
	ids := (deselectedIds ifNil: [#()]) asArray.
	failures := OrderedCollection new.
	applied := 0.
	self changeSet changes doWithIndex: [:change :idx |
		((idx <= 2) or: [(ids includes: change id) not])
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
GsExtractMethodRefactoring >> applyChange: aChange [
	(aChange kind == #methodAdd or: [aChange kind == #methodRecompile])
		ifTrue: [^self applyMethodCompile: aChange].
	^self error: 'Unexpected change kind for extract-method: ', aChange kind printString
]

{ #category : 'applying' }
GsExtractMethodRefactoring >> applyMethodCompile: aChange [
	"Compile the change's new source (a new method for #methodAdd, the rewritten
	 method for #methodRecompile) in the stone. No commit."
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
GsExtractMethodRefactoring >> jsonQuote: aString [
	^'"', (self jsonEscape: aString), '"'
]

{ #category : 'serializing' }
GsExtractMethodRefactoring >> jsonEscape: aString [
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
GsExtractMethodRefactoring >> hex2: anInteger [
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
]
