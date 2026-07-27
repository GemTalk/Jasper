"
Change a method's signature -- ADD, REMOVE, or REORDER parameters -- across its
implementors and senders, within a chosen scope, without committing. This is the
M5 catalog refactoring; it generalizes GsRenameMethodRefactoring (R2), which is
arity-preserving, to the case where the argument count changes.

The change is expressed as (newParts, permutation, newArgNames, defaults):

  - newParts   the new keyword parts, in new order (each keyword part ends with
               ':', a unary selector is one colon-free string, a binary is the
               operator string). newSelector is their concatenation.
  - permutation  one entry per NEW argument position: the 1-based OLD argument
               index it draws from, or 0 for a brand-new parameter (add). An old
               index absent from permutation is REMOVED. Identity #(1 2 ...) is a
               pure reorder/rename (permutation at: newIndex = oldArgIndex, the
               same convention R2 and Pharo use).
  - newArgNames  one entry per new position: the implementor argument NAME. Only
               the new-parameter (0) positions are honoured; a reused position
               keeps each implementor's own existing argument name (renaming a
               reused argument is R5's job, not M5's).
  - defaults   one entry per new position: the source string spliced at every
               send site for a new parameter (0 position); ignored for a reused
               position (which reuses the old argument expression).

Behaviour-preservation: ADD is safe because the new parameter is unused in the
body (you wire it in later) and every send supplies a caller default; REORDER is
always safe (a permutation of existing arguments); REMOVE is safe ONLY when the
removed parameter is unused in EVERY in-scope implementor body -- if it is used
the refactoring DECLINES (naming the class). Send-site argument expressions for a
removed slot are dropped (standard RB semantics).

Like R2, the rewrite preserves comments, string literals, and formatting by
mutating the AST and registering RBStringReplacements so RBMethodNode>>newSource
splices minimally (falling back to a reflow only if the splice would be unsafe --
the result is still correct because the AST was mutated). The implementor header
is rewritten with RBMethodNode>>renameSelector:andArguments:, whose
changeSourceSelectors:arguments: already rebuilds the whole signature region when
the arity changes; a send is rewritten with a hand-rolled whole-region
replacement (the message-node rename does not register one).

Scope (#class / #hierarchy / #dictionary / #wholeSystem) governs which
implementors/senders are affected; the remainder are counted (out-of-scope) so a
client can warn. Everything is staged into a GsRefactoringChangeSet: implementors
as #methodRename (compile under the new selector, then remove the old), senders as
#methodRecompile. Nothing compiles or commits here.
"
Class {
	#name : 'GsChangeSignatureRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'definingClass',
		'meta',
		'oldSelector',
		'newSelector',
		'newParts',
		'permutation',
		'newArgNames',
		'defaults',
		'scopeKind',
		'scopeDictName',
		'changeSet',
		'outOfScopeImplementorCount',
		'outOfScopeSenderCount',
		'skippedCount',
		'skippedMethods',
		'scopeClasses',
		'analyzed',
		'declineString',
		'collisionString'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'preflight' }
GsChangeSignatureRefactoring class >> analyzeForClass: aClass selector: aSelector meta: aBool [
	"A pre-flight the client runs before opening the signature editor: the current
	 selector kind, arity, and argument names of the defining implementor, so the
	 editor rows can be pre-populated. Answers a decline if the method is absent or
	 unparseable. No proposed change is known yet, so no collision/remove check here."
	| target gsMethod tree kind ws |
	target := aBool ifTrue: [aClass class] ifFalse: [aClass].
	gsMethod := target compiledMethodAt: aSelector asSymbol otherwise: nil.
	gsMethod isNil ifTrue: [
		^'{"selectorKind":"unary","arity":0,"argNames":[],"decline":"the method no longer exists"}'].
	tree := RBParser parseMethod: gsMethod sourceString onError: [:m :p | nil].
	tree isNil ifTrue: [
		^'{"selectorKind":"unary","arity":0,"argNames":[],"decline":"the method source does not parse"}'].
	kind := tree arguments isEmpty
		ifTrue: ['unary']
		ifFalse: [(aSelector asString last = $:) ifTrue: ['keyword'] ifFalse: ['binary']].
	ws := WriteStream on: String new.
	ws nextPutAll: '{"selectorKind":"'; nextPutAll: kind.
	ws nextPutAll: '","arity":'; nextPutAll: tree arguments size printString.
	ws nextPutAll: ',"argNames":['.
	tree arguments keysAndValuesDo: [:i :a |
		i = 1 ifFalse: [ws nextPut: $,].
		ws nextPut: $"; nextPutAll: (self jsonEscapeString: a name); nextPut: $"].
	ws nextPutAll: '],"decline":null}'.
	^ws contents
]

{ #category : 'serializing' }
GsChangeSignatureRefactoring class >> jsonEscapeString: aString [
	"Class-side ASCII-only JSON escaping for the analyze payload (no instance yet)."
	| ws |
	ws := WriteStream on: String new.
	aString do: [:ch | | code |
		code := ch asInteger.
		(ch == $" or: [ch == $\]) ifTrue: [ws nextPut: $\; nextPut: ch]
		ifFalse: [(code < 32 or: [code > 126])
			ifTrue: [ws nextPut: $?]
			ifFalse: [ws nextPut: ch]]].
	^ws contents
]

{ #category : 'instance creation' }
GsChangeSignatureRefactoring class >> class: aClass meta: aBool changeSelector: oldSel toParts: partsArray permutation: permArray argNames: namesArray defaults: defaultsArray scope: scopeSymbol [
	"scopeSymbol is #class, #hierarchy, or #wholeSystem. For #dictionary use the
	 dictionaryScope: variant. aBool is whether oldSel is a class-side method."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		meta: aBool
		oldSelector: oldSel
		newParts: partsArray
		permutation: permArray
		newArgNames: namesArray
		defaults: defaultsArray
		scopeKind: scopeSymbol
		scopeDictName: nil
]

{ #category : 'instance creation' }
GsChangeSignatureRefactoring class >> class: aClass meta: aBool changeSelector: oldSel toParts: partsArray permutation: permArray argNames: namesArray defaults: defaultsArray dictionaryScope: dictName [
	"Scope narrowed to a single named SymbolDictionary. aBool is whether oldSel is a
	 class-side method."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		meta: aBool
		oldSelector: oldSel
		newParts: partsArray
		permutation: permArray
		newArgNames: namesArray
		defaults: defaultsArray
		scopeKind: #dictionary
		scopeDictName: dictName
]

{ #category : 'instance creation' }
GsChangeSignatureRefactoring class >> environment: anEnvironment class: aClass meta: aBool oldSelector: oldSel newParts: partsArray permutation: permArray newArgNames: namesArray defaults: defaultsArray scopeKind: sk scopeDictName: dn [
	^self new
		setEnvironment: anEnvironment
		class: aClass
		meta: aBool
		oldSelector: oldSel
		newParts: partsArray
		permutation: permArray
		newArgNames: namesArray
		defaults: defaultsArray
		scopeKind: sk
		scopeDictName: dn
]

{ #category : 'paginated preview' }
GsChangeSignatureRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	"A page from a previously-started preview (see startPreviewToken:maxBytes:), by
	 token. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'paginated preview' }
GsChangeSignatureRefactoring class >> applyForToken: token deselected: deselectedIds [
	"Apply a previously-started preview (by token), skipping deselectedIds. No commit.
	 Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'paginated preview' }
GsChangeSignatureRefactoring class >> clearToken: token [
	"Drop a finished preview from SessionTemps."
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'private' }
GsChangeSignatureRefactoring >> setEnvironment: anEnvironment class: aClass meta: aBool oldSelector: oldSel newParts: partsArray permutation: permArray newArgNames: namesArray defaults: defaultsArray scopeKind: sk scopeDictName: dn [
	environment := anEnvironment.
	definingClass := aClass.
	meta := aBool.
	oldSelector := oldSel asSymbol.
	newParts := partsArray.
	permutation := permArray.
	newArgNames := namesArray.
	defaults := defaultsArray.
	scopeKind := sk.
	scopeDictName := dn.
	newSelector := self buildNewSelector
]

{ #category : 'private' }
GsChangeSignatureRefactoring >> buildNewSelector [
	| ws |
	ws := WriteStream on: String new.
	newParts do: [:p | ws nextPutAll: p].
	^ws contents asSymbol
]

{ #category : 'accessing' }
GsChangeSignatureRefactoring >> environment [
	^environment
]

{ #category : 'accessing' }
GsChangeSignatureRefactoring >> definingClass [
	^definingClass
]

{ #category : 'accessing' }
GsChangeSignatureRefactoring >> oldSelector [
	^oldSelector
]

{ #category : 'accessing' }
GsChangeSignatureRefactoring >> newSelector [
	^newSelector
]

{ #category : 'accessing' }
GsChangeSignatureRefactoring >> newArity [
	^permutation size
]

{ #category : 'accessing' }
GsChangeSignatureRefactoring >> changeSet [
	"The staged, non-committing change set, computed once and cached. A declined
	 change stages nothing (the client refuses to open the panel on a decline)."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'building' }
GsChangeSignatureRefactoring >> buildChangeSet [
	"Stage a #methodRename for every in-scope implementor and a #methodRecompile for
	 every in-scope sender, counting the out-of-scope remainder. Compiles nothing and
	 commits nothing. A hard decline (e.g. removing a used parameter) stages nothing."
	| cs implementorKeys |
	cs := GsRefactoringChangeSet new.
	outOfScopeImplementorCount := 0.
	outOfScopeSenderCount := 0.
	skippedCount := 0.
	skippedMethods := OrderedCollection new.
	self declineReason ifNotNil: [:r | ^cs].
	implementorKeys := IdentitySet new.
	(environment implementorsOf: oldSelector) do: [:m |
		[| base isMeta |
		 base := self baseClassOf: m.
		 isMeta := m inClass isMeta.
		 (self isClassInScope: base)
			ifTrue: [
				implementorKeys add: (self keyForClass: base isMeta: isMeta).
				self stageImplementorRename: m base: base isMeta: isMeta into: cs]
			ifFalse: [outOfScopeImplementorCount := outOfScopeImplementorCount + 1]]
		on: Error do: [:e | skippedCount := skippedCount + 1. self recordSkipped: m]].
	(environment sendersOf: oldSelector) do: [:m |
		[| base isMeta |
		 base := self baseClassOf: m.
		 isMeta := m inClass isMeta.
		 ((m selector == oldSelector)
			and: [implementorKeys includes: (self keyForClass: base isMeta: isMeta)])
			ifFalse: [
				(self isClassInScope: base)
					ifTrue: [self stageSenderRewrite: m base: base isMeta: isMeta into: cs]
					ifFalse: [outOfScopeSenderCount := outOfScopeSenderCount + 1]]]
		on: Error do: [:e | skippedCount := skippedCount + 1. self recordSkipped: m]].
	^cs
]

{ #category : 'private' }
GsChangeSignatureRefactoring >> baseClassOf: aMethod [
	"The non-meta class of aMethod's defining class. GemStone's Metaclass answers its
	 instance class via #thisClass (NOT Pharo's #instanceClass)."
	| cls |
	cls := aMethod inClass.
	^cls isMeta ifTrue: [cls thisClass] ifFalse: [cls]
]

{ #category : 'testing' }
GsChangeSignatureRefactoring >> isClassInScope: aClass [
	scopeKind == #wholeSystem ifTrue: [^true].
	scopeKind == #class ifTrue: [^aClass == definingClass].
	scopeKind == #hierarchy ifTrue: [^self hierarchyScopeClasses includes: aClass].
	scopeKind == #dictionary ifTrue: [
		| wanted |
		wanted := scopeDictName asSymbol.
		^(environment dictionariesDefiningClassNamed: aClass name)
			anySatisfy: [:d | d name asSymbol == wanted]].
	^false
]

{ #category : 'private' }
GsChangeSignatureRefactoring >> hierarchyScopeClasses [
	scopeClasses isNil ifTrue: [
		scopeClasses := IdentitySet new.
		scopeClasses add: definingClass.
		scopeClasses addAll: definingClass allSubclasses.
		scopeClasses addAll: definingClass allSuperclasses].
	^scopeClasses
]

{ #category : 'private' }
GsChangeSignatureRefactoring >> keyForClass: aClass isMeta: aBool [
	^Array with: aClass name asString with: aBool
]

{ #category : 'private' }
GsChangeSignatureRefactoring >> dictNameForClass: aClass [
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
]

{ #category : 'preconditions' }
GsChangeSignatureRefactoring >> ensureAnalysis [
	analyzed == true ifTrue: [^self].
	analyzed := true.
	self computeAnalysis
]

{ #category : 'preconditions' }
GsChangeSignatureRefactoring >> computeAnalysis [
	"Validate the proposed signature and set declineString / collisionString. Declines
	 (block Apply): a shape mismatch, a duplicate/temporary-colliding argument name, or
	 removing a parameter that is used in any in-scope implementor body. Collision
	 (blocks Apply): the new selector already names a DIFFERENT method on the class."
	| defTarget defMethod defTree defArgs removed finalNames localTemps |
	declineString := nil.
	collisionString := nil.
	"1. shape"
	(newParts isNil or: [newParts isEmpty])
		ifTrue: [^declineString := 'the new selector is empty'].
	(permutation size = newArgNames size and: [permutation size = defaults size])
		ifFalse: [^declineString := 'the signature arrays are inconsistent'].
	self newArity = 0
		ifTrue: [newParts size = 1
			ifFalse: [^declineString := 'a zero-argument selector must have one part']]
		ifFalse: [
			((newParts allSatisfy: [:p | p notEmpty and: [p last = $:]]) and: [newParts size = self newArity])
				ifFalse: [
					(self newArity = 1 and: [newParts size = 1 and: [newParts first notEmpty and: [newParts first last ~= $:]]])
						ifFalse: [^declineString := 'the keyword parts do not match the argument count']]].
	"2. defining method"
	defTarget := meta == true ifTrue: [definingClass class] ifFalse: [definingClass].
	defMethod := defTarget compiledMethodAt: oldSelector otherwise: nil.
	defMethod isNil ifTrue: [^declineString := 'the method no longer exists'].
	defTree := RBParser parseMethod: defMethod sourceString onError: [:m :p | nil].
	defTree isNil ifTrue: [^declineString := 'the method source does not parse'].
	defArgs := defTree arguments.
	"3. duplicate / temporary-colliding argument names on the defining implementor"
	finalNames := (1 to: self newArity) collect: [:i |
		(permutation at: i) > 0
			ifTrue: [(defArgs at: (permutation at: i)) name]
			ifFalse: [(newArgNames at: i) asString]].
	(finalNames asSet size = finalNames size)
		ifFalse: [^declineString := 'two parameters would have the same name'].
	localTemps := IdentitySet new.
	defTree nodesDo: [:node |
		node isSequence ifTrue: [node temporaries do: [:t | localTemps add: t name asSymbol]]].
	(1 to: self newArity) do: [:i |
		(permutation at: i) = 0 ifTrue: [
			(localTemps includes: (newArgNames at: i) asSymbol)
				ifTrue: [^declineString := 'the name ', (newArgNames at: i), ' is already a temporary in this method']]].
	"4. remove of a used parameter, across every in-scope implementor"
	removed := (1 to: defArgs size) reject: [:k | permutation includes: k].
	removed notEmpty ifTrue: [
		(environment implementorsOf: oldSelector) do: [:m |
			[| base implTree implArgs |
			 base := self baseClassOf: m.
			 (self isClassInScope: base) ifTrue: [
				implTree := RBParser parseMethod: m sourceString onError: [:msg :p | nil].
				implTree notNil ifTrue: [
					implArgs := implTree arguments.
					removed do: [:k |
						(k <= implArgs size and: [implTree body references: (implArgs at: k) name])
							ifTrue: [^declineString := 'parameter ', (implArgs at: k) name,
								' is used in ', base name asString, ' and cannot be removed']]]]]
			on: Error do: [:e | nil]]].
	"5. collision with a distinct existing method on the defining class"
	(newSelector ~= oldSelector and: [(defTarget compiledMethodAt: newSelector otherwise: nil) notNil])
		ifTrue: [collisionString := definingClass name asString, ' already implements ', newSelector asString]
]

{ #category : 'preconditions' }
GsChangeSignatureRefactoring >> declineReason [
	"nil if the change can proceed, otherwise a structural reason that blocks Apply."
	self ensureAnalysis.
	^declineString
]

{ #category : 'preconditions' }
GsChangeSignatureRefactoring >> newSelectorCollision [
	"nil if the new selector is free, otherwise a reason (it already names a different
	 method on the class)."
	self ensureAnalysis.
	^collisionString
]

{ #category : 'private' }
GsChangeSignatureRefactoring >> stageImplementorRename: aMethod base: base isMeta: isMeta into: aChangeSet [
	"Stage the rename of one implementor: rewrite its signature (reorder/add/remove
	 parameters per permutation) AND any internal sends of oldSelector, then stage a
	 #methodRename. No compile, no commit."
	| oldSrc tree newArgNodes newSrc cat |
	oldSrc := aMethod sourceString.
	tree := RBParser parseMethod: oldSrc.
	newArgNodes := self newArgNodesForImplementorTree: tree.
	tree renameSelector: newSelector andArguments: newArgNodes.
	self rewriteSendsOf: oldSelector in: tree source: oldSrc.
	newSrc := tree newSource.
	cat := (aMethod inClass categoryOfSelector: oldSelector environmentId: 0)
		ifNil: ['as yet unclassified'].
	aChangeSet
		addMethodRenameInDictionary: (self dictNameForClass: base)
		className: base name
		isMeta: isMeta
		oldSelector: oldSelector
		newSelector: newSelector
		category: cat asString
		oldSource: oldSrc
		newSource: newSrc
]

{ #category : 'private' }
GsChangeSignatureRefactoring >> newArgNodesForImplementorTree: aMethodTree [
	"The argument variable nodes for the rewritten signature: a reused position keeps
	 this implementor's own old argument name; a new position (permutation 0) takes the
	 client-supplied new-parameter name."
	| oldArgs |
	oldArgs := aMethodTree arguments.
	^(1 to: self newArity) collect: [:i |
		RBVariableNode named: ((permutation at: i) > 0
			ifTrue: [(oldArgs at: (permutation at: i)) name]
			ifFalse: [(newArgNames at: i) asString])]
]

{ #category : 'private' }
GsChangeSignatureRefactoring >> stageSenderRewrite: aMethod base: base isMeta: isMeta into: aChangeSet [
	"Stage a recompile of one sender: rewrite its send(s) of oldSelector. The sender
	 keeps its own selector (a #methodRecompile). Stages nothing if no real send was
	 rewritten (e.g. a symbol-literal-only reference)."
	| senderSel oldSrc tree renamed newSrc cat |
	senderSel := aMethod selector.
	oldSrc := aMethod sourceString.
	tree := RBParser parseMethod: oldSrc.
	renamed := self rewriteSendsOf: oldSelector in: tree source: oldSrc.
	renamed = 0 ifTrue: [^self].
	newSrc := tree newSource.
	cat := (aMethod inClass categoryOfSelector: senderSel environmentId: 0)
		ifNil: ['as yet unclassified'].
	aChangeSet
		addMethodRecompileInDictionary: (self dictNameForClass: base)
		className: base name
		isMeta: isMeta
		selector: senderSel
		category: cat asString
		oldSource: oldSrc
		newSource: newSrc
]

{ #category : 'private' }
GsChangeSignatureRefactoring >> rewriteSendsOf: aSelector in: aTree source: src [
	"Rewrite every send of aSelector at and under aTree, returning how many sends were
	 rewritten. Zero means the reference was not a real send (e.g. a symbol literal)."
	| count |
	count := 0.
	aTree nodesDo: [:node |
		(node isMessage and: [node selector == aSelector])
			ifTrue: [self rewriteSend: node source: src. count := count + 1]].
	^count
]

{ #category : 'private' }
GsChangeSignatureRefactoring >> rewriteSend: aMessageNode source: src [
	"Rewrite one send of oldSelector in place, minimal-diff: rebuild the whole
	 selector+arguments region as a single RBStringReplacement (each new argument's
	 text is the reused old argument's source, or the default string for a new
	 parameter), AND mutate the node so newSource's reparse-consistency check passes."
	| parts args argTexts regionStart regionStop region newArgNodes |
	parts := aMessageNode selectorParts.
	args := aMessageNode arguments.
	argTexts := (1 to: self newArity) collect: [:i |
		(permutation at: i) > 0
			ifTrue: [src copyFrom: (args at: (permutation at: i)) start to: (args at: (permutation at: i)) stop]
			ifFalse: [(defaults at: i) asString]].
	newArgNodes := (1 to: self newArity) collect: [:i |
		(permutation at: i) > 0
			ifTrue: [args at: (permutation at: i)]
			ifFalse: [RBParser parseExpression: (defaults at: i) asString]].
	regionStart := parts first start.
	regionStop := args isEmpty ifTrue: [parts last stop] ifFalse: [args last stop].
	region := WriteStream on: String new.
	newParts keysAndValuesDo: [:i :p |
		i = 1 ifFalse: [region space].
		region nextPutAll: p.
		i <= self newArity ifTrue: [region space; nextPutAll: (argTexts at: i)]].
	aMessageNode renameSelector: newSelector andArguments: newArgNodes.
	aMessageNode addReplacement: (RBStringReplacement
		replaceFrom: regionStart to: regionStop with: region contents)
]

{ #category : 'serializing' }
GsChangeSignatureRefactoring >> hex2: anInteger [
	| digits |
	digits := '0123456789abcdef'.
	^(String with: (digits at: (anInteger // 16) + 1))
		, (String with: (digits at: (anInteger \\ 16) + 1))
]

{ #category : 'serializing' }
GsChangeSignatureRefactoring >> jsonEscape: aString [
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
GsChangeSignatureRefactoring >> jsonQuote: aString [
	^'"', (self jsonEscape: aString), '"'
]

{ #category : 'private' }
GsChangeSignatureRefactoring >> recordSkipped: aMethod [
	skippedMethods add: (Array
		with: aMethod inClass name asString
		with: aMethod selector asString)
]

{ #category : 'accessing' }
GsChangeSignatureRefactoring >> outOfScopeImplementorCount [
	self changeSet.
	^outOfScopeImplementorCount
]

{ #category : 'accessing' }
GsChangeSignatureRefactoring >> outOfScopeSenderCount [
	self changeSet.
	^outOfScopeSenderCount
]

{ #category : 'serializing' }
GsChangeSignatureRefactoring >> skippedMethodsJsonString [
	| ws |
	self changeSet.
	ws := WriteStream on: String new.
	ws nextPut: $[.
	skippedMethods keysAndValuesDo: [:i :entry |
		i = 1 ifFalse: [ws nextPut: $,].
		ws nextPutAll: '{"class":"'; nextPutAll: (self jsonEscape: (entry at: 1)).
		ws nextPutAll: '","selector":"'; nextPutAll: (self jsonEscape: (entry at: 2)).
		ws nextPutAll: '"}'].
	ws nextPut: $].
	^ws contents
]

{ #category : 'serializing' }
GsChangeSignatureRefactoring >> outOfScopeJsonString [
	"The scope / precondition payload for the preview panel: out-of-scope
	 implementor/sender counts and skipped count (R2 shape), plus collision and decline
	 (M-family shape), both of which block Apply."
	self changeSet.
	^'{"implementors":', outOfScopeImplementorCount printString,
	  ',"senders":', outOfScopeSenderCount printString,
	  ',"skipped":', skippedCount printString,
	  ',"collision":', (self newSelectorCollision
		ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  ',"decline":', (self declineReason
		ifNil: ['null'] ifNotNil: [:r | self jsonQuote: r]),
	  '}'
]

{ #category : 'serializing' }
GsChangeSignatureRefactoring >> previewJsonString [
	^self changeSet jsonString
]

{ #category : 'paginated preview' }
GsChangeSignatureRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
	"A byte-bounded page of staged changes (with source) starting at startIndex
	 (1-based); at least one change is always emitted (progress guarantee)."
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

{ #category : 'paginated preview' }
GsChangeSignatureRefactoring >> startPreviewToken: token maxBytes: maxBytes [
	"Build the change set, stash this refactoring in SessionTemps under token (so later
	 pages and the apply reuse it), and answer the first page plus totals + warnings.
	 Nothing is committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"skippedMethods":', self skippedMethodsJsonString,
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'applying' }
GsChangeSignatureRefactoring >> applyChange: aChange [
	"Apply one staged change in the stone WITHOUT committing: compile the new source,
	 and for a genuine rename (selector actually changed) remove the old method."
	| cls target |
	cls := environment classNamed: aChange className.
	cls isNil ifTrue: [^self error: 'Class not found: ', aChange className].
	target := aChange isMeta ifTrue: [cls class] ifFalse: [cls].
	target
		compileMethod: aChange newSource
		dictionaries: System myUserProfile symbolList
		category: (aChange category ifNil: ['as yet unclassified']).
	(aChange kind == #methodRename and: [aChange newSelector ~= aChange selector])
		ifTrue: [target removeSelector: aChange selector asSymbol]
]

{ #category : 'applying' }
GsChangeSignatureRefactoring >> applyDeselected: deselectedIds [
	"Apply every staged change EXCEPT those whose id is in deselectedIds, in the stone,
	 WITHOUT committing. Answers an object with the applied count and any failures."
	| ids applied failures |
	ids := (deselectedIds collect: [:e | e asSymbol]) asIdentitySet.
	applied := 0.
	failures := OrderedCollection new.
	self changeSet changes do: [:change |
		(ids includes: change id asSymbol) ifFalse: [
			[self applyChange: change. applied := applied + 1]
			on: Error do: [:e |
				failures add: (Array with: change id with: change className with: e messageText)]]].
	^'{"applied":', applied printString, ',"failed":[',
	  ((failures collect: [:f |
		'{"id":', (self jsonQuote: (f at: 1)),
		',"label":', (self jsonQuote: (f at: 2)),
		',"error":', (self jsonQuote: (f at: 3)), '}'])
			inject: '' into: [:acc :s | acc isEmpty ifTrue: [s] ifFalse: [acc, ',', s]]),
	  ']}'
]
