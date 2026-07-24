"
Correctness of the inline-method refactoring (M2). Inline replaces ONE self/super
message send at the cursor with the called method's body (arguments substituted),
staging a single #methodRecompile for the rewritten caller. The called method is
KEPT -- EXCEPT when the inlined call was its last remaining sender, in which case a
second, deselectable #methodRemove is staged to delete the now-unused method.

This suite pins down:

  - a self send of a void one-liner used as a statement inlines the body at the
    site; the target is kept (it has other senders); one #methodRecompile;
  - a self send whose value is used (target is ^expr) is replaced by the expression,
    parenthesised only where precedence requires it;
  - a send with arguments substitutes each argument's source for the parameter, a
    non-atomic argument parenthesised, an atomic one bare (even used twice);
  - a super send resolves the target from the superclass and inlines its body;
  - the inline is DECLINED (empty change set + a reason) for a non-self/super
    receiver, no implementor in the hierarchy, a multi-statement / temp-declaring /
    inner-return target, a target sending super, a side-effecting argument used more
    than once, a value used where the target returns self, a cascaded send, and a
    caret that is not on a send;
  - inlining the LAST sender stages a second #methodRemove for the target, and it is
    SUPPRESSED when another method (or a second send in the same method) still sends
    it;
  - building compiles nothing and commits nothing; apply recompiles the caller
    (always) and removes the target (only when kept), never committing.

setUp builds a throwaway two-class hierarchy in UserGlobals; tearDown removes it.
Target selectors that must be the LAST sender in a test use image-unique names
(gsim...) so no unrelated sender in the image perturbs the count.
"
Class {
	#name : 'GsInlineMethodRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsInlineMethodRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'asserting' }
GsInlineMethodRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsInlineMethodRefactoringTest >> baseFixture [
	^UserGlobals at: #GsIMBase
]

{ #category : 'fixture' }
GsInlineMethodRefactoringTest >> subFixture [
	^UserGlobals at: #GsIMSub
]

{ #category : 'fixture' }
GsInlineMethodRefactoringTest >> compile: aSource in: aClass [
	[aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture']
		on: CompileWarning
		do: [:ex | ex resume: nil]
]

{ #category : 'fixture' }
GsInlineMethodRefactoringTest >> inlineIn: aClass selector: aSelector atSendOf: aSubstring [
	"A refactoring inlining the send whose text begins at aSubstring in
	 aClass>>aSelector (1-based source offset)."
	| start |
	start := (aClass compiledMethodAt: aSelector) sourceString indexOfSubCollection: aSubstring.
	^GsInlineMethodRefactoring
		class: aClass
		selector: aSelector
		meta: false
		atOffset: start
]

{ #category : 'fixture' }
GsInlineMethodRefactoringTest >> recompileFor: aSelector in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #methodRecompile and: [c selector = aSelector]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsInlineMethodRefactoringTest >> removeChangeIn: aChangeSet [
	^aChangeSet changes detect: [:c | c kind = #methodRemove] ifNone: [nil]
]

{ #category : 'running' }
GsInlineMethodRefactoringTest >> setUp [
	| base sub |
	super setUp.
	base := Object
		subclass: 'GsIMBase'
		instVarNames: #('count')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := base
		subclass: 'GsIMSub'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	"--- target methods (the ones inlined) ---"
	self compile: 'bump count := count + 1' in: base.
	self compile: 'doubled ^ count * 2' in: base.
	self compile: 'scaled: f ^ count * f' in: base.
	self compile: 'addTwice: x ^ x + x' in: base.
	self compile: 'gsimSolo ^ count' in: base.
	self compile: 'gsimPair ^ count' in: base.
	self compile: 'gsimTwice ^ count' in: base.
	self compile: 'callsSuper ^ super hash' in: base.
	self compile: 'multiStmt count := 1. ^ count' in: base.
	self compile: 'withTemp | t | t := count. ^ t' in: base.
	self compile: 'guarded (count > 0) ifTrue: [^count]' in: base.
	self compile: 'greet ^ ''hi''' in: base.
	"--- caller methods (hold the send being inlined) ---"
	self compile: 'runBump self bump. ^ count' in: base.
	self compile: 'bumpAgain self bump. ^ 1' in: base.
	self compile: 'useDoubledSub ^ 1 + self doubled' in: base.
	self compile: 'justDoubled ^ self doubled' in: base.
	self compile: 'useScaled ^ self scaled: 3' in: base.
	self compile: 'useScaledExpr ^ self scaled: 1 + 1' in: base.
	self compile: 'useSolo ^ self gsimSolo' in: base.
	self compile: 'callA ^ self gsimPair' in: base.
	self compile: 'callB ^ self gsimPair' in: base.
	self compile: 'callsTwice ^ self gsimTwice + self gsimTwice' in: base.
	self compile: 'useTwiceAtom ^ self addTwice: count' in: base.
	self compile: 'useTwiceExpr ^ self addTwice: self hash' in: base.
	self compile: 'useReturnsSelf ^ 1 + self bump' in: base.
	self compile: 'callOnArg: x ^ x doubled' in: base.
	self compile: 'doCascade self doubled; yourself' in: base.
	self compile: 'useMulti ^ self multiStmt' in: base.
	self compile: 'useTemp ^ self withTemp' in: base.
	self compile: 'useGuarded self guarded. ^ count' in: base.
	self compile: 'useSuper self callsSuper. ^ count' in: base.
	self compile: 'useNoImpl self gsimNoSuchThing. ^ count' in: base.
	"atomic-bodied target + a send DEEP inside nested blocks + a same-named selector
	 overridden in the subclass (two implementors in the hierarchy)."
	self compile: 'val ^ count' in: base.
	self compile: 'keepVal ^ self val' in: base.
	self compile: 'receiverUse ^ self val printString' in: base.
	self compile: 'nestedDeep #(1) do: [:x | x > 0 ifTrue: [ #(2) do: [:y | y + self doubled ] ] ]' in: base.
	self compile: 'label ^ ''base''' in: base.
	"--- subclass ---"
	self compile: 'greetLoud ^ super greet' in: sub.
	self compile: 'plainGreet ^ self greet' in: sub.
	self compile: 'label ^ ''sub''' in: sub.
	self compile: 'announceSelf ^ self label' in: sub.
	self compile: 'announceSuper2 ^ super label' in: sub.
	self compile: 'useInherited ^ self val' in: sub
]

{ #category : 'running' }
GsInlineMethodRefactoringTest >> tearDown [
	#('GsIMSub' 'GsIMBase')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
]

{ #category : 'tests - inline' }
GsInlineMethodRefactoringTest >> testInlinesVoidOneLinerAsStatement [
	| cs recompile |
	cs := (self inlineIn: self baseFixture selector: #runBump atSendOf: 'bump') changeSet.
	recompile := self recompileFor: #runBump in: cs.

	self assert: cs size equals: 1.
	self assert: recompile notNil.
	self assert: recompile newSource includesSubstring: 'count := count + 1'.
	self deny: recompile newSource includesSubstring: 'self bump'.
	"the target method is left in place (it has other senders)"
	self assert: (self removeChangeIn: cs) isNil
]

{ #category : 'tests - inline' }
GsInlineMethodRefactoringTest >> testInlinesValueReturningSendInBinaryOperandKeepsParens [
	"1 + self doubled -> 1 + (count * 2): the send is a sub-expression, so parens."
	| recompile |
	recompile := self recompileFor: #useDoubledSub
		in: (self inlineIn: self baseFixture selector: #useDoubledSub atSendOf: 'doubled') changeSet.

	self assert: recompile newSource includesSubstring: '1 + (count * 2)'
]

{ #category : 'tests - inline' }
GsInlineMethodRefactoringTest >> testInlinesValueReturningSendInReturnPositionNoParens [
	"^ self doubled -> ^ count * 2: replacing a whole return value needs no parens."
	| recompile |
	recompile := self recompileFor: #justDoubled
		in: (self inlineIn: self baseFixture selector: #justDoubled atSendOf: 'doubled') changeSet.

	self assert: recompile newSource includesSubstring: 'count * 2'.
	self deny: recompile newSource includesSubstring: '(count * 2)'
]

{ #category : 'tests - inline' }
GsInlineMethodRefactoringTest >> testInlinesSendWithLiteralArgument [
	| recompile |
	recompile := self recompileFor: #useScaled
		in: (self inlineIn: self baseFixture selector: #useScaled atSendOf: 'scaled:') changeSet.

	self assert: recompile newSource includesSubstring: 'count * 3'
]

{ #category : 'tests - inline' }
GsInlineMethodRefactoringTest >> testInlinesSendWithNonAtomicArgumentParenthesised [
	"self scaled: 1 + 1 -> count * (1 + 1): a compound argument is parenthesised."
	| recompile |
	recompile := self recompileFor: #useScaledExpr
		in: (self inlineIn: self baseFixture selector: #useScaledExpr atSendOf: 'scaled:') changeSet.

	self assert: recompile newSource includesSubstring: 'count * (1 + 1)'
]

{ #category : 'tests - inline' }
GsInlineMethodRefactoringTest >> testInlinesAtomicArgumentUsedTwiceWithoutDecline [
	"addTwice: uses x twice; an atomic argument (count) may be duplicated safely."
	| ref recompile |
	ref := self inlineIn: self baseFixture selector: #useTwiceAtom atSendOf: 'addTwice:'.
	recompile := self recompileFor: #useTwiceAtom in: ref changeSet.

	self assert: ref declineReason isNil.
	self assert: recompile newSource includesSubstring: 'count + count'
]

{ #category : 'tests - inline' }
GsInlineMethodRefactoringTest >> testInlinesSuperSendResolvingTargetFromSuperclass [
	| recompile |
	recompile := self recompileFor: #greetLoud
		in: (self inlineIn: self subFixture selector: #greetLoud atSendOf: 'super greet') changeSet.

	self assert: recompile notNil.
	self assert: recompile newSource includesSubstring: '''hi'''.
	self deny: recompile newSource includesSubstring: 'super greet'
]

{ #category : 'tests - inline' }
GsInlineMethodRefactoringTest >> testInlinesSendDeepInsideNestedBlocks [
	"A send buried inside do:/ifTrue:/do: blocks inlines in place regardless of nesting."
	| recompile |
	recompile := self recompileFor: #nestedDeep
		in: (self inlineIn: self baseFixture selector: #nestedDeep atSendOf: 'doubled') changeSet.

	self assert: recompile notNil.
	self assert: recompile newSource includesSubstring: '(count * 2)'.
	self deny: recompile newSource includesSubstring: 'self doubled'
]

{ #category : 'tests - inline' }
GsInlineMethodRefactoringTest >> testAtomicResultAsSubExpressionReceiverNeedsNoParens [
	"self val printString -> count printString: an atomic inlined result needs no
	 parentheses even as a message receiver."
	| recompile |
	recompile := self recompileFor: #receiverUse
		in: (self inlineIn: self baseFixture selector: #receiverUse atSendOf: 'val') changeSet.

	self assert: recompile newSource includesSubstring: 'count printString'.
	self deny: recompile newSource includesSubstring: '(count'
]

{ #category : 'tests - hierarchy' }
GsInlineMethodRefactoringTest >> testSelfSendResolvesToNearestOverridingImplementor [
	"#label is implemented by BOTH classes; a self send in the subclass resolves to the
	 subclass's override, not the superclass's."
	| recompile |
	recompile := self recompileFor: #announceSelf
		in: (self inlineIn: self subFixture selector: #announceSelf atSendOf: 'label') changeSet.

	self assert: recompile newSource includesSubstring: '''sub'''.
	self deny: recompile newSource includesSubstring: '''base'''
]

{ #category : 'tests - hierarchy' }
GsInlineMethodRefactoringTest >> testSuperSendResolvesPastAnOverrideToTheSuperclass [
	"A super send resolves past the subclass's override to the superclass implementor."
	| recompile |
	recompile := self recompileFor: #announceSuper2
		in: (self inlineIn: self subFixture selector: #announceSuper2 atSendOf: 'super label') changeSet.

	self assert: recompile newSource includesSubstring: '''base'''.
	self deny: recompile newSource includesSubstring: '''sub'''
]

{ #category : 'tests - hierarchy' }
GsInlineMethodRefactoringTest >> testInlinesInheritedMethodViaSelfSend [
	"A self send in the subclass resolves UP to an inherited implementor in the
	 superclass and inlines its body."
	| recompile |
	recompile := self recompileFor: #useInherited
		in: (self inlineIn: self subFixture selector: #useInherited atSendOf: 'val') changeSet.

	self assert: recompile notNil.
	self assert: recompile newSource includesSubstring: 'count'.
	self deny: recompile newSource includesSubstring: 'self val'
]

{ #category : 'tests - decline' }
GsInlineMethodRefactoringTest >> testNonSelfSuperReceiverIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #callOnArg: atSendOf: 'doubled'.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineMethodRefactoringTest >> testNoImplementorInHierarchyIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #useNoImpl atSendOf: 'gsimNoSuchThing'.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineMethodRefactoringTest >> testMultiStatementTargetIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #useMulti atSendOf: 'multiStmt'.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineMethodRefactoringTest >> testTempDeclaringTargetIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #useTemp atSendOf: 'withTemp'.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineMethodRefactoringTest >> testInnerReturnTargetIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #useGuarded atSendOf: 'guarded'.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineMethodRefactoringTest >> testTargetSendingSuperIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #useSuper atSendOf: 'callsSuper'.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineMethodRefactoringTest >> testSideEffectingArgumentUsedTwiceIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #useTwiceExpr atSendOf: 'addTwice:'.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineMethodRefactoringTest >> testValueUsedButTargetReturnsSelfIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #useReturnsSelf atSendOf: 'bump'.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineMethodRefactoringTest >> testCascadedSendIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #doCascade atSendOf: 'doubled'.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineMethodRefactoringTest >> testCaretNotOnASendIsDeclined [
	| ref |
	ref := GsInlineMethodRefactoring
		class: self baseFixture selector: #runBump meta: false atOffset: 1.

	self assert: ref declineReason notNil.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - last sender' }
GsInlineMethodRefactoringTest >> testLastSenderOffersRemoval [
	| ref cs remove |
	ref := self inlineIn: self baseFixture selector: #useSolo atSendOf: 'gsimSolo'.
	cs := ref changeSet.
	remove := self removeChangeIn: cs.

	self assert: ref isLastSender.
	self assert: cs size equals: 2.
	self assert: (self recompileFor: #useSolo in: cs) notNil.
	self assert: remove notNil.
	self assert: remove selector equals: #gsimSolo
]

{ #category : 'tests - last sender' }
GsInlineMethodRefactoringTest >> testRemovalSuppressedWhenAnotherMethodSends [
	| ref cs |
	ref := self inlineIn: self baseFixture selector: #callA atSendOf: 'gsimPair'.
	cs := ref changeSet.

	self deny: ref isLastSender.
	self assert: cs size equals: 1.
	self assert: (self removeChangeIn: cs) isNil
]

{ #category : 'tests - last sender' }
GsInlineMethodRefactoringTest >> testRemovalSuppressedWhenSameMethodSendsTwice [
	| ref cs |
	ref := self inlineIn: self baseFixture selector: #callsTwice atSendOf: 'gsimTwice'.
	cs := ref changeSet.

	self deny: ref isLastSender.
	self assert: cs size equals: 1.
	self assert: (self removeChangeIn: cs) isNil
]

{ #category : 'tests - staging' }
GsInlineMethodRefactoringTest >> testBuildingTheChangeSetChangesNoSourceAndDoesNotCommit [
	| before |
	before := System needsCommit.
	(self inlineIn: self baseFixture selector: #runBump atSendOf: 'bump') changeSet.

	"the stored source is untouched: building the preview compiles nothing"
	self assert: (self baseFixture compiledMethodAt: #runBump) sourceString
		includesSubstring: 'self bump'.
	self assert: System needsCommit equals: before
]

{ #category : 'tests - preview' }
GsInlineMethodRefactoringTest >> testPreviewJsonSerializesRecompileAndRemoveWhenLastSender [
	| json |
	json := (self inlineIn: self baseFixture selector: #useSolo atSendOf: 'gsimSolo')
		previewJsonString.

	self assert: json includesSubstring: 'methodRecompile'.
	self assert: json includesSubstring: 'methodRemove'
]

{ #category : 'tests - preview' }
GsInlineMethodRefactoringTest >> testPreviewJsonHasNoRemoveWhenNotLastSender [
	| json |
	json := (self inlineIn: self baseFixture selector: #callA atSendOf: 'gsimPair')
		previewJsonString.

	self assert: json includesSubstring: 'methodRecompile'.
	self deny: json includesSubstring: 'methodRemove'
]

{ #category : 'tests - preview' }
GsInlineMethodRefactoringTest >> testStartPreviewCarriesTotalsSelectorLastSenderAndPage [
	| json |
	json := (self inlineIn: self baseFixture selector: #useSolo atSendOf: 'gsimSolo')
		startPreviewToken: 'm2Tok' maxBytes: 100000.
	[self assert: json includesSubstring: '"targetSelector":"gsimSolo"'.
	 self assert: json includesSubstring: '"total":2'.
	 self assert: json includesSubstring: '"lastSender":true'.
	 self assert: json includesSubstring: '"changes":']
		ensure: [GsInlineMethodRefactoring clearToken: 'm2Tok']
]

{ #category : 'tests - preview' }
GsInlineMethodRefactoringTest >> testAnalysisPreflightReportsTargetAndLastSender [
	| src off json |
	src := (self baseFixture compiledMethodAt: #useSolo) sourceString.
	off := src indexOfSubCollection: 'gsimSolo'.
	json := GsInlineMethodRefactoring
		analyzeSendForClass: self baseFixture selector: #useSolo meta: false atOffset: off.

	self assert: json includesSubstring: '"targetSelector":"gsimSolo"'.
	self assert: json includesSubstring: '"lastSender":true'.
	self assert: json includesSubstring: '"decline":null'
]

{ #category : 'tests - preview' }
GsInlineMethodRefactoringTest >> testAnalysisPreflightReportsDeclineForBadSend [
	| src off json |
	src := (self baseFixture compiledMethodAt: #callOnArg:) sourceString.
	off := src indexOfSubCollection: 'doubled'.
	json := GsInlineMethodRefactoring
		analyzeSendForClass: self baseFixture selector: #callOnArg: meta: false atOffset: off.

	self deny: json includesSubstring: '"decline":null'
]

{ #category : 'tests - apply' }
GsInlineMethodRefactoringTest >> testApplyInlinesAndKeepsTargetWhenNotLastSender [
	| json |
	json := (self inlineIn: self baseFixture selector: #runBump atSendOf: 'bump')
		applyDeselected: #().

	self assert: json includesSubstring: '"applied":1'.
	self assert: json includesSubstring: '"failed":[]'.
	self assert: (self baseFixture compiledMethodAt: #runBump) sourceString
		includesSubstring: 'count := count + 1'.
	"target kept"
	self assert: (self baseFixture includesSelector: #bump)
]

{ #category : 'tests - apply' }
GsInlineMethodRefactoringTest >> testApplyRemovesTargetWhenLastSenderAndRemovalKept [
	| json |
	json := (self inlineIn: self baseFixture selector: #useSolo atSendOf: 'gsimSolo')
		applyDeselected: #().

	self assert: json includesSubstring: '"applied":2'.
	self assert: (self baseFixture compiledMethodAt: #useSolo) sourceString
		includesSubstring: 'count'.
	"the now-unused target is gone"
	self deny: (self baseFixture includesSelector: #gsimSolo)
]

{ #category : 'tests - apply' }
GsInlineMethodRefactoringTest >> testApplyKeepsTargetWhenRemovalDeselected [
	| ref cs removeId json |
	ref := self inlineIn: self baseFixture selector: #useSolo atSendOf: 'gsimSolo'.
	cs := ref changeSet.
	removeId := (self removeChangeIn: cs) id.
	json := ref applyDeselected: (Array with: removeId).

	self assert: json includesSubstring: '"applied":1'.
	"the caller is still inlined, but the target is left in place"
	self assert: (self baseFixture compiledMethodAt: #useSolo) sourceString
		includesSubstring: 'count'.
	self assert: (self baseFixture includesSelector: #gsimSolo)
]

{ #category : 'tests - apply' }
GsInlineMethodRefactoringTest >> testApplyDoesNotCommit [
	| before |
	before := System needsCommit.
	(self inlineIn: self baseFixture selector: #runBump atSendOf: 'bump') applyDeselected: #().

	self assert: System needsCommit equals: before
]

{ #category : 'tests - apply' }
GsInlineMethodRefactoringTest >> testTokenRoundTripStartThenApplyRecompilesCaller [
	| ref json before |
	before := System needsCommit.
	ref := self inlineIn: self baseFixture selector: #runBump atSendOf: 'bump'.
	ref startPreviewToken: 'm2rt' maxBytes: 100000.
	[json := GsInlineMethodRefactoring applyForToken: 'm2rt' deselected: #().
	 self assert: json includesSubstring: '"applied":1'.
	 self assert: (self baseFixture compiledMethodAt: #runBump) sourceString
		includesSubstring: 'count := count + 1'.
	 self assert: System needsCommit equals: before]
		ensure: [GsInlineMethodRefactoring clearToken: 'm2rt']
]

{ #category : 'tests - apply' }
GsInlineMethodRefactoringTest >> testPageForTokenReturnsAPageForALiveSession [
	| ref json |
	ref := self inlineIn: self baseFixture selector: #runBump atSendOf: 'bump'.
	ref startPreviewToken: 'm2pg' maxBytes: 100000.
	[json := GsInlineMethodRefactoring pageForToken: 'm2pg' from: 1 maxBytes: 100000.
	 self assert: json includesSubstring: '"changes":']
		ensure: [GsInlineMethodRefactoring clearToken: 'm2pg']
]

{ #category : 'tests - apply' }
GsInlineMethodRefactoringTest >> testPageForTokenOnAnExpiredSessionAnswersAnError [
	self assert: (GsInlineMethodRefactoring pageForToken: 'nope' from: 1 maxBytes: 100)
		includesSubstring: 'expired'
]

{ #category : 'tests - apply' }
GsInlineMethodRefactoringTest >> testApplyForTokenOnAnExpiredSessionAnswersAnError [
	self assert: (GsInlineMethodRefactoring applyForToken: 'nope' deselected: #())
		includesSubstring: 'expired'
]
