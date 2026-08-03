"
Rename a method / selector -- unary, binary, or keyword -- across its
implementors and senders, within a chosen scope, without committing. This is the
second refactoring the engine ships (after rename-instance-variable).

It is arity-preserving: the new selector must take the same number of arguments
as the old one. Within that, it covers the three keyword operations the UX cares
about -- renaming the whole selector, renaming part of a keyword, and reordering
arguments -- all expressed as (newParts, permutation):

  - newParts is the new keyword parts, in new order, e.g. #('copyTo:' 'from:')
    for a two-keyword selector, #('after') for a unary, #('+') for a binary.
  - permutation maps a NEW argument position to the OLD argument index it draws
    from: permutation at: newIndex = oldArgIndex (the same convention Pharo's
    RBChangeMethodNameRefactoring uses). Identity #(1 2 ...) means no reorder;
    #() for a zero-argument selector.

The rewrite preserves comments, string literals, and surrounding formatting: it
mutates the AST and registers RBStringReplacements so RBMethodNode>>newSource
splices the change into the original source. A
selector spelling inside a comment or string literal is never a message-send
node, so it is left untouched; symbol literals (#sel) and perform: sends are NOT
rewritten (they carry the selector as data, not as a send).

Scope governs which implementors and senders are affected -- #class, #hierarchy,
#dictionary (a named SymbolDictionary), or #wholeSystem. Whatever the scope,
implementors/senders that fall OUTSIDE it are counted (outOfScope*Count) so a
client can warn that they will not be changed.

Everything is staged into a GsRefactoringChangeSet: nothing here compiles a
method or commits the transaction. Implementors are staged as #methodRename
(compile under the new selector, then remove the old); senders are staged as
#methodRecompile (their own selector is unchanged -- only a send expression in
the body changes).
"
Class {
	#name : 'GsRenameMethodRefactoring',
	#superclass : 'Object',
	#instVars : [
		'environment',
		'definingClass',
		'oldSelector',
		'newSelector',
		'newParts',
		'permutation',
		'scopeKind',
		'scopeDictName',
		'changeSet',
		'outOfScopeImplementorCount',
		'outOfScopeSenderCount',
		'skippedCount',
		'skippedMethods',
		'scopeClasses'
	],
	#category : 'Refactoring-Core'
}

{ #category : 'instance creation' }
GsRenameMethodRefactoring class >> class: aClass renameSelector: oldSel toParts: partsArray permutation: permArray dictionaryScope: dictName [
	"Rename scoped to a single named SymbolDictionary."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		oldSelector: oldSel
		newParts: partsArray
		permutation: permArray
		scopeKind: #dictionary
		scopeDictName: dictName
]

{ #category : 'instance creation' }
GsRenameMethodRefactoring class >> class: aClass renameSelector: oldSel toParts: partsArray permutation: permArray scope: scopeSymbol [
	"scopeSymbol is #class, #hierarchy, or #wholeSystem. For #dictionary use
	 class:renameSelector:toParts:permutation:dictionaryScope:."
	^self
		environment: GsRefactoringEnvironment new
		class: aClass
		oldSelector: oldSel
		newParts: partsArray
		permutation: permArray
		scopeKind: scopeSymbol
		scopeDictName: nil
]

{ #category : 'instance creation' }
GsRenameMethodRefactoring class >> environment: anEnvironment class: aClass oldSelector: oldSel newParts: partsArray permutation: permArray scopeKind: sk scopeDictName: dn [
	^self new
		setEnvironment: anEnvironment
		class: aClass
		oldSelector: oldSel
		newParts: partsArray
		permutation: permArray
		scopeKind: sk
		scopeDictName: dn
]

{ #category : 'building' }
GsRenameMethodRefactoring >> buildChangeSet [
	"Stage a #methodRename for every in-scope implementor and a #methodRecompile
	 for every in-scope sender, counting the out-of-scope remainder. Compiles
	 nothing and commits nothing."
	| cs implementorKeys |
	cs := GsRefactoringChangeSet new.
	outOfScopeImplementorCount := 0.
	outOfScopeSenderCount := 0.
	skippedCount := 0.
	skippedMethods := OrderedCollection new.
	implementorKeys := IdentitySet new.
	(environment implementorsOf: oldSelector) do: [:m |
		"Isolate each method: one that cannot be parsed/rewritten (a source the
		 vendored AST does not accept, a primitive edge case) is skipped and
		 counted, never aborting the whole preview."
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
		 "skip a method that IS one of the implementors we already renamed -- its
		  own internal sends of oldSelector are rewritten by the implementor pass."
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
GsRenameMethodRefactoring >> baseClassOf: aMethod [
	"The non-meta class of aMethod's defining class (a class-side method's inClass
	 is a metaclass). GemStone's Metaclass answers its instance class via
	 #thisClass (NOT #instanceClass, which is a Pharo-ism it does not understand)."
	| cls |
	cls := aMethod inClass.
	^cls isMeta ifTrue: [cls thisClass] ifFalse: [cls]
]

{ #category : 'private' }
GsRenameMethodRefactoring >> buildNewSelector [
	| ws |
	ws := WriteStream on: String new.
	newParts do: [:p | ws nextPutAll: p].
	^ws contents asSymbol
]

{ #category : 'accessing' }
GsRenameMethodRefactoring >> changeSet [
	"The staged, non-committing change set, computed once and cached."
	changeSet isNil ifTrue: [changeSet := self buildChangeSet].
	^changeSet
]

{ #category : 'accessing' }
GsRenameMethodRefactoring >> definingClass [
	^definingClass
]

{ #category : 'private' }
GsRenameMethodRefactoring >> dictNameForClass: aClass [
	"The name of the first dictionary that defines aClass, as a String, or nil."
	| dicts |
	dicts := environment dictionariesDefiningClassNamed: aClass name.
	^dicts isEmpty ifTrue: [nil] ifFalse: [dicts first name asString]
]

{ #category : 'accessing' }
GsRenameMethodRefactoring >> environment [
	^environment
]

{ #category : 'testing' }
GsRenameMethodRefactoring >> isClassInScope: aClass [
	scopeKind == #wholeSystem ifTrue: [^true].
	scopeKind == #class ifTrue: [^aClass == definingClass].
	scopeKind == #hierarchy ifTrue: [^self hierarchyScopeClasses includes: aClass].
	scopeKind == #dictionary ifTrue: [
		"Compare as Symbols -- scopeDictName is a client-supplied literal (Unicode
		 on 3.6.x); asSymbol canonicalises both sides and avoids the comparison trap."
		| wanted |
		wanted := scopeDictName asSymbol.
		^(environment dictionariesDefiningClassNamed: aClass name)
			anySatisfy: [:d | d name asSymbol == wanted]].
	^false
]

{ #category : 'private' }
GsRenameMethodRefactoring >> hierarchyScopeClasses [
	"The set of classes in definingClass's hierarchy (itself, its subclasses, and
	 its superclasses), computed ONCE and cached. Computing allSubclasses /
	 allSuperclasses per candidate made #hierarchy scope O(hierarchy x candidates)
	 -- slower than #wholeSystem, which skips the check entirely. An IdentitySet
	 membership test is O(1)."
	scopeClasses isNil ifTrue: [
		scopeClasses := IdentitySet new.
		scopeClasses add: definingClass.
		scopeClasses addAll: definingClass allSubclasses.
		scopeClasses addAll: definingClass allSuperclasses].
	^scopeClasses
]

{ #category : 'private' }
GsRenameMethodRefactoring >> keyForClass: aClass isMeta: aBool [
	"A stable identity key for a (class, side) pair, used to dedup a method that is
	 both an implementor and a sender of oldSelector."
	^Array with: aClass name asString with: aBool
]

{ #category : 'accessing' }
GsRenameMethodRefactoring >> newSelector [
	^newSelector
]

{ #category : 'accessing' }
GsRenameMethodRefactoring >> oldSelector [
	^oldSelector
]

{ #category : 'accessing' }
GsRenameMethodRefactoring >> outOfScopeImplementorCount [
	"How many implementors of oldSelector fall outside the chosen scope and will
	 NOT be renamed. Building the change set computes this."
	self changeSet.
	^outOfScopeImplementorCount
]

{ #category : 'accessing' }
GsRenameMethodRefactoring >> outOfScopeJsonString [
	"The out-of-scope / skipped warning payload for the client preview: implementors
	 and senders outside the chosen scope, plus methods that could not be rewritten
	 (and were skipped)."
	self changeSet.
	^'{"implementors":', outOfScopeImplementorCount printString,
	  ',"senders":', outOfScopeSenderCount printString,
	  ',"skipped":', skippedCount printString, '}'
]

{ #category : 'private' }
GsRenameMethodRefactoring >> hex2: anInteger [
	^GsRefactoringJson hex2: anInteger
]

{ #category : 'private' }
GsRenameMethodRefactoring >> jsonEscape: aString [
	^GsRefactoringJson jsonEscape: aString
]

{ #category : 'private' }
GsRenameMethodRefactoring >> jsonQuote: aString [
	^GsRefactoringJson jsonQuote: aString
]

{ #category : 'accessing' }
GsRenameMethodRefactoring >> outOfScopeSenderCount [
	"How many senders of oldSelector fall outside the chosen scope and will NOT be
	 rewritten. Building the change set computes this."
	self changeSet.
	^outOfScopeSenderCount
]

{ #category : 'accessing' }
GsRenameMethodRefactoring >> skippedMethodsJsonString [
	"A JSON array of the methods that could not be rewritten (and were skipped) --
	 one object per method carrying its class and selector -- so the client can
	 list them."
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

{ #category : 'accessing' }
GsRenameMethodRefactoring >> previewJsonString [
	"The change-set preview the client fetches over GCI: a JSON array of staged
	 changes with per-change before/after source."
	^self changeSet jsonString
]

{ #category : 'paginated preview' }
GsRenameMethodRefactoring >> pageJsonFrom: startIndex maxBytes: maxBytes [
	"A page of staged changes (with source) starting at startIndex (1-based),
	 accumulating until roughly maxBytes -- so a page always fits the client's GCI
	 fetch buffer no matter how large the change set is. At least one change is
	 always emitted (progress guarantee, even if a single change exceeds maxBytes).
	 Answers an object with the changes array, the next offset, and a done flag."
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
GsRenameMethodRefactoring >> startPreviewToken: token maxBytes: maxBytes [
	"Build the change set, stash this refactoring in SessionTemps under token (so
	 later pages and the apply reuse it without rebuilding), and answer the first
	 page plus the totals. Nothing is committed."
	self changeSet.
	SessionTemps current at: token asSymbol put: self.
	^'{"token":', (self jsonQuote: token),
	  ',"total":', self changeSet size printString,
	  ',"outOfScope":', self outOfScopeJsonString,
	  ',"skippedMethods":', self skippedMethodsJsonString,
	  ',"page":', (self pageJsonFrom: 1 maxBytes: maxBytes), '}'
]

{ #category : 'applying' }
GsRenameMethodRefactoring >> applyChange: aChange [
	"Apply one staged change in the stone WITHOUT committing: compile the new
	 source, and for a genuine rename (selector actually changed) remove the old
	 method. The class is resolved across all dictionaries."
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
GsRenameMethodRefactoring >> applyDeselected: deselectedIds [
	"Apply every staged change EXCEPT those whose id is in deselectedIds, in the
	 stone, WITHOUT committing (the user commits explicitly). Answers an object
	 with the applied count and a list of failures (id, label, error)."
	| ids applied failures |
	"Compare ids as Symbols: a deselected id arrives as a string literal, which on
	 3.6.x is a Unicode string, and comparing it to the byte-string change id would
	 raise (the 3.6.2 Unicode-comparison trap). asSymbol canonicalises both."
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

{ #category : 'paginated preview' }
GsRenameMethodRefactoring class >> pageForToken: token from: startIndex maxBytes: maxBytes [
	"A page from a previously-started preview (see startPreviewToken:maxBytes:),
	 by token. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"error":"preview session expired","changes":[],"nextOffset":0,"done":true}']
		ifNotNil: [:ref | ref pageJsonFrom: startIndex maxBytes: maxBytes]
]

{ #category : 'applying' }
GsRenameMethodRefactoring class >> applyForToken: token deselected: deselectedIds [
	"Apply a previously-started preview (by token), skipping deselectedIds. No
	 commit. Answers an error envelope if the preview session has expired."
	^(SessionTemps current at: token asSymbol ifAbsent: [nil])
		ifNil: ['{"applied":0,"failed":[],"error":"preview session expired"}']
		ifNotNil: [:ref | ref applyDeselected: deselectedIds]
]

{ #category : 'paginated preview' }
GsRenameMethodRefactoring class >> clearToken: token [
	"Drop a finished preview from SessionTemps."
	SessionTemps current removeKey: token asSymbol ifAbsent: [].
	^'ok'
]

{ #category : 'private' }
GsRenameMethodRefactoring >> recordSkipped: aMethod [
	"Record the identity of a method that could not be rewritten, so the client can
	 list which ones were skipped. inClass name carries the side ('Foo class')."
	skippedMethods add: (Array
		with: aMethod inClass name asString
		with: aMethod selector asString)
]

{ #category : 'private' }
GsRenameMethodRefactoring >> rewriteSend: aMessageNode source: src [
	"Rename one send of oldSelector in place, minimal-diff: mutate the node (so the
	 reparsed source matches the AST) AND register RBStringReplacements for the
	 keyword-part token spans and the (possibly reordered) argument spans."
	| parts args kwSpans argSpans argTexts newArgs |
	parts := aMessageNode selectorParts.
	args := aMessageNode arguments.
	kwSpans := parts collect: [:t | Array with: t start with: t stop].
	argSpans := args collect: [:a | Array with: a start with: a stop].
	argTexts := args collect: [:a | src copyFrom: a start to: a stop].
	newArgs := permutation collect: [:oldIdx | args at: oldIdx].
	aMessageNode renameSelector: newSelector andArguments: newArgs.
	1 to: parts size do: [:i |
		aMessageNode addReplacement: (RBStringReplacement
			replaceFrom: (kwSpans at: i) first
			to: (kwSpans at: i) last
			with: (newParts at: i))].
	1 to: args size do: [:i |
		aMessageNode addReplacement: (RBStringReplacement
			replaceFrom: (argSpans at: i) first
			to: (argSpans at: i) last
			with: (argTexts at: (permutation at: i)))]
]

{ #category : 'private' }
GsRenameMethodRefactoring >> rewriteSendsOf: aSelector in: aTree source: src [
	"Rewrite every send of aSelector at and under aTree, returning how many sends
	 were rewritten. Zero means the reference was not a real send (e.g. a symbol
	 literal), so the caller stages nothing for it."
	| count |
	count := 0.
	aTree nodesDo: [:node |
		(node isMessage and: [node selector == aSelector])
			ifTrue: [self rewriteSend: node source: src. count := count + 1]].
	^count
]

{ #category : 'private' }
GsRenameMethodRefactoring >> setEnvironment: anEnvironment class: aClass oldSelector: oldSel newParts: partsArray permutation: permArray scopeKind: sk scopeDictName: dn [
	environment := anEnvironment.
	definingClass := aClass.
	oldSelector := oldSel asSymbol.
	newParts := partsArray.
	permutation := permArray.
	scopeKind := sk.
	scopeDictName := dn.
	newSelector := self buildNewSelector
]

{ #category : 'private' }
GsRenameMethodRefactoring >> stageImplementorRename: aMethod base: base isMeta: isMeta into: aChangeSet [
	"Stage the rename of one implementor: rewrite its signature (rename keyword
	 parts + reorder argument declarations per permutation) AND any internal sends
	 of oldSelector, then stage a #methodRename. No compile, no commit."
	| oldSrc tree oldArgs newArgNodes newSrc cat |
	oldSrc := aMethod sourceString.
	tree := RBParser parseMethod: oldSrc.
	oldArgs := tree arguments.
	newArgNodes := permutation collect: [:oldIdx | oldArgs at: oldIdx].
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
GsRenameMethodRefactoring >> stageSenderRewrite: aMethod base: base isMeta: isMeta into: aChangeSet [
	"Stage a recompile of one sender: rewrite its send(s) of oldSelector. The
	 sender keeps its own selector, so this is a #methodRecompile. Stages nothing
	 if no real send was rewritten (e.g. a symbol-literal-only reference)."
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
