"
Correctness of the inline-temporary refactoring (M4), the mirror image of M3. Inline
Temporary takes a temporary assigned EXACTLY ONCE, replaces every read of it with the
assigned expression, and deletes the declaration + assignment. It is method-local:
one method changes, staged as a single #methodRecompile, no class-definition edit and
no cross-method scan.

This suite pins down:

  - a single-read temporary inlines into a return position with no parentheses;
  - inlining into a binary operand parenthesises a non-atomic value; an atomic value
    (a variable) never gets parentheses, even at a sub-expression position;
  - an atomic value read TWICE inlines safely; a non-atomic value read twice is
    DECLINED;
  - an argument, an instance variable, a temp assigned twice, a temp assigned inside a
    nested block, a temp read before it is assigned, a never-read temp, and a caret
    not on a variable are all DECLINED (empty change set + a reason);
  - the declaration is rewritten cleanly: a temp dropped from a multi-temp '| .. |'
    clause, and the whole clause removed when it was the only temporary, with no
    dangling '.' left behind;
  - a temporary declared inside a BLOCK inlines within the block;
  - building compiles nothing and commits nothing; apply recompiles the one method and
    never commits; preview / token round-trip work.

setUp builds a throwaway two-class hierarchy in UserGlobals; tearDown removes it.
"
Class {
	#name : 'GsInlineTemporaryRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsInlineTemporaryRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'asserting' }
GsInlineTemporaryRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsInlineTemporaryRefactoringTest >> baseFixture [
	^UserGlobals at: #GsITBase
]

{ #category : 'fixture' }
GsInlineTemporaryRefactoringTest >> compile: aSource in: aClass [
	[aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture']
		on: CompileWarning
		do: [:ex | ex resume: nil]
]

{ #category : 'fixture' }
GsInlineTemporaryRefactoringTest >> inlineIn: aClass selector: aSel caretOn: aSubstring [
	"A refactoring inlining the temporary whose occurrence text begins at aSubstring in
	 aClass>>aSel (1-based source offset). Pass a unique context so the offset lands on
	 the variable (e.g. its assignment 'tName :=')."
	| src start |
	src := (aClass compiledMethodAt: aSel) sourceString.
	start := src indexOfSubCollection: aSubstring.
	^GsInlineTemporaryRefactoring
		class: aClass
		selector: aSel
		meta: false
		atOffset: start
]

{ #category : 'fixture' }
GsInlineTemporaryRefactoringTest >> recompileIn: aChangeSet [
	^aChangeSet changes detect: [:c | c kind = #methodRecompile] ifNone: [nil]
]

{ #category : 'running' }
GsInlineTemporaryRefactoringTest >> setUp [
	| base |
	super setUp.
	base := Object
		subclass: 'GsITBase'
		instVarNames: #('count' 'factor')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	"--- inlinable temporaries (unique temp names so caretOn: is unambiguous) ---"
	self compile: 'oneRead | tRet | tRet := count * 2. ^ tRet' in: base.
	self compile: 'binOperand | tBin | tBin := count * 2. ^ tBin + 1' in: base.
	self compile: 'atomicVal | tAt | tAt := count. ^ tAt + 1' in: base.
	self compile: 'readTwiceAtomic | tTw | tTw := count. ^ tTw + tTw' in: base.
	self compile: 'readTwiceExpr | tExpr | tExpr := count * 2. ^ tExpr + tExpr' in: base.
	self compile: 'multiTemp | ma tRm mb | ma := 1. tRm := count * 2. mb := 3. ^ ma + tRm + mb' in: base.
	self compile: 'blockTemp ^ #(1 2 3) collect: [:e | | tb2 | tb2 := e * count. tb2 + 1]' in: base.
	"keyword-argument position: the value must be parenthesised (M3)."
	self compile: 'kwArg | tk | tk := count * factor. ^ Array with: tk' in: base.
	"two statements on ONE source line: removing the assignment must stop at its '.' and
	 not swallow the following statement (M4 removalIntervalFor branch)."
	self compile: 'twoPerLine | tp | tp := count. factor := tp + 1. ^ factor' in: base.
	"--- declined shapes ---"
	self compile: 'inlineArg: anArg ^ anArg + count' in: base.
	self compile: 'inlineIvar ^ count + 1' in: base.
	self compile: 'twiceAssigned | tw | tw := count. tw := tw + 1. ^ tw' in: base.
	self compile: 'nestedAssign | tn | (count > 0) ifTrue: [tn := count]. ^ tn' in: base.
	self compile: 'readBeforeAssign | tb | (count > tb) ifTrue: [^ 1]. tb := count. ^ tb' in: base.
	self compile: 'neverRead | tnr | tnr := count. ^ count' in: base
]

{ #category : 'running' }
GsInlineTemporaryRefactoringTest >> tearDown [
	UserGlobals removeKey: #GsITBase ifAbsent: []
]

{ #category : 'tests - inline' }
GsInlineTemporaryRefactoringTest >> testInlinesSingleReadIntoReturnNoParens [
	| ref recompile src |
	ref := self inlineIn: self baseFixture selector: #oneRead caretOn: 'tRet :='.
	recompile := self recompileIn: ref changeSet.
	src := recompile newSource.

	self assert: ref changeSet size equals: 1.
	self assert: src includesSubstring: '^ count * 2'.
	self deny: src includesSubstring: 'tRet'.
	"the sole temporary's clause is gone entirely (assert the specific clause is absent,
	 not that the char '|' appears nowhere -- that would false-fail on a block or a binary
	 selector)."
	self deny: src includesSubstring: '| tRet |'
]

{ #category : 'tests - inline' }
GsInlineTemporaryRefactoringTest >> testInlinesIntoBinaryOperandParenthesisesNonAtomic [
	| src |
	src := (self recompileIn:
		(self inlineIn: self baseFixture selector: #binOperand caretOn: 'tBin :=') changeSet) newSource.

	self assert: src includesSubstring: '(count * 2) + 1'
]

{ #category : 'tests - inline' }
GsInlineTemporaryRefactoringTest >> testInlinesAtomicValueWithoutParens [
	| src |
	src := (self recompileIn:
		(self inlineIn: self baseFixture selector: #atomicVal caretOn: 'tAt :=') changeSet) newSource.

	self assert: src includesSubstring: '^ count + 1'.
	self deny: src includesSubstring: '(count'
]

{ #category : 'tests - inline' }
GsInlineTemporaryRefactoringTest >> testInlinesAtomicValueReadTwice [
	| ref src |
	ref := self inlineIn: self baseFixture selector: #readTwiceAtomic caretOn: 'tTw :='.
	src := (self recompileIn: ref changeSet) newSource.

	self assert: ref declineReason isNil.
	self assert: src includesSubstring: '^ count + count'
]

{ #category : 'tests - inline' }
GsInlineTemporaryRefactoringTest >> testInlinesTemporaryDeclaredInABlock [
	| src |
	src := (self recompileIn:
		(self inlineIn: self baseFixture selector: #blockTemp caretOn: 'tb2 :=') changeSet) newSource.

	self assert: src includesSubstring: '(e * count) + 1'.
	self deny: src includesSubstring: 'tb2'
]

{ #category : 'tests - inline' }
GsInlineTemporaryRefactoringTest >> testInlinesIntoKeywordArgumentParenthesises [
	"A non-atomic value inlined into a keyword-argument position needs parentheses (M3)."
	| src |
	src := (self recompileIn:
		(self inlineIn: self baseFixture selector: #kwArg caretOn: 'tk :=') changeSet) newSource.

	self assert: src includesSubstring: 'with: (count * factor)'
]

{ #category : 'tests - declaration' }
GsInlineTemporaryRefactoringTest >> testRemovesAssignmentSharingALineWithAnotherStatement [
	"Two statements on one source line: removing 'tp := count.' must stop at its own '.'
	 and leave the following statement intact (M4 removalIntervalFor branch)."
	| src |
	src := (self recompileIn:
		(self inlineIn: self baseFixture selector: #twoPerLine caretOn: 'tp :=') changeSet) newSource.

	self assert: src includesSubstring: 'factor := count + 1'.
	self deny: src includesSubstring: 'tp'
]

{ #category : 'tests - declaration' }
GsInlineTemporaryRefactoringTest >> testDropsTempFromMultiTempClause [
	| src |
	src := (self recompileIn:
		(self inlineIn: self baseFixture selector: #multiTemp caretOn: 'tRm :=') changeSet) newSource.

	self assert: src includesSubstring: '| ma mb |'.
	self assert: src includesSubstring: '(count * 2)'.
	self deny: src includesSubstring: 'tRm'
]

{ #category : 'tests - decline' }
GsInlineTemporaryRefactoringTest >> testNonAtomicValueReadTwiceIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #readTwiceExpr caretOn: 'tExpr :='.

	self assert: ref declineReason includesSubstring: 'not a simple expression'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineTemporaryRefactoringTest >> testArgumentIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #inlineArg: caretOn: 'anArg +'.

	self assert: ref declineReason includesSubstring: 'argument'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineTemporaryRefactoringTest >> testInstanceVariableIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #inlineIvar caretOn: 'count +'.

	self assert: ref declineReason includesSubstring: 'instance variable'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineTemporaryRefactoringTest >> testTempAssignedTwiceIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #twiceAssigned caretOn: 'tw :='.

	self assert: ref declineReason includesSubstring: 'more than once'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineTemporaryRefactoringTest >> testTempAssignedInNestedBlockIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #nestedAssign caretOn: 'tn :='.

	self assert: ref declineReason includesSubstring: 'nested block'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineTemporaryRefactoringTest >> testTempReadBeforeAssignmentIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #readBeforeAssign caretOn: 'tb :='.

	self assert: ref declineReason includesSubstring: 'before it is assigned'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineTemporaryRefactoringTest >> testNeverReadTempIsDeclined [
	| ref |
	ref := self inlineIn: self baseFixture selector: #neverRead caretOn: 'tnr :='.

	self assert: ref declineReason includesSubstring: 'never read'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsInlineTemporaryRefactoringTest >> testCaretNotOnAVariableIsDeclined [
	| ref |
	ref := GsInlineTemporaryRefactoring
		class: self baseFixture selector: #oneRead meta: false atOffset: 1.

	self assert: ref declineReason includesSubstring: 'cursor on the temporary'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - preflight' }
GsInlineTemporaryRefactoringTest >> testAnalysisReportsInlinableTemp [
	| src off json |
	src := (self baseFixture compiledMethodAt: #oneRead) sourceString.
	off := src indexOfSubCollection: 'tRet :='.
	json := GsInlineTemporaryRefactoring
		analyzeTempForClass: self baseFixture selector: #oneRead meta: false atOffset: off.

	self assert: json includesSubstring: '"name":"tRet"'.
	self assert: json includesSubstring: '"decline":null'
]

{ #category : 'tests - preflight' }
GsInlineTemporaryRefactoringTest >> testAnalysisReportsDeclineForArgument [
	| src off json |
	src := (self baseFixture compiledMethodAt: #inlineArg:) sourceString.
	off := src indexOfSubCollection: 'anArg +'.
	json := GsInlineTemporaryRefactoring
		analyzeTempForClass: self baseFixture selector: #inlineArg: meta: false atOffset: off.

	self deny: json includesSubstring: '"decline":null'
]

{ #category : 'tests - staging' }
GsInlineTemporaryRefactoringTest >> testBuildingTheChangeSetChangesNoSourceAndDoesNotCommit [
	| before |
	before := System needsCommit.
	(self inlineIn: self baseFixture selector: #oneRead caretOn: 'tRet :=') changeSet.

	self assert: (self baseFixture compiledMethodAt: #oneRead) sourceString
		includesSubstring: 'tRet'.
	self assert: System needsCommit equals: before
]

{ #category : 'tests - preview' }
GsInlineTemporaryRefactoringTest >> testPreviewJsonSerializesRecompile [
	| json |
	json := (self inlineIn: self baseFixture selector: #oneRead caretOn: 'tRet :=')
		previewJsonString.

	self assert: json includesSubstring: 'methodRecompile'
]

{ #category : 'tests - preview' }
GsInlineTemporaryRefactoringTest >> testStartPreviewCarriesTotalsAndPage [
	| json |
	json := (self inlineIn: self baseFixture selector: #oneRead caretOn: 'tRet :=')
		startPreviewToken: 'm4Tok' maxBytes: 100000.
	[self assert: json includesSubstring: '"total":1'.
	 self assert: json includesSubstring: '"name":"tRet"'.
	 self assert: json includesSubstring: '"changes":']
		ensure: [GsInlineTemporaryRefactoring clearToken: 'm4Tok']
]

{ #category : 'tests - apply' }
GsInlineTemporaryRefactoringTest >> testApplyRecompilesAndDoesNotCommit [
	| before json |
	before := System needsCommit.
	json := (self inlineIn: self baseFixture selector: #oneRead caretOn: 'tRet :=')
		applyDeselected: #().

	self assert: json includesSubstring: '"applied":1'.
	self assert: json includesSubstring: '"failed":[]'.
	self assert: (self baseFixture compiledMethodAt: #oneRead) sourceString
		includesSubstring: '^ count * 2'.
	self deny: (self baseFixture compiledMethodAt: #oneRead) sourceString
		includesSubstring: 'tRet'.
	self assert: System needsCommit equals: before
]

{ #category : 'tests - apply' }
GsInlineTemporaryRefactoringTest >> testTokenRoundTripStartThenApply [
	| ref json before |
	before := System needsCommit.
	ref := self inlineIn: self baseFixture selector: #oneRead caretOn: 'tRet :='.
	ref startPreviewToken: 'm4rt' maxBytes: 100000.
	[json := GsInlineTemporaryRefactoring applyForToken: 'm4rt' deselected: #().
	 self assert: json includesSubstring: '"applied":1'.
	 self assert: (self baseFixture compiledMethodAt: #oneRead) sourceString
		includesSubstring: '^ count * 2'.
	 self assert: System needsCommit equals: before]
		ensure: [GsInlineTemporaryRefactoring clearToken: 'm4rt']
]

{ #category : 'tests - apply' }
GsInlineTemporaryRefactoringTest >> testApplyForTokenOnAnExpiredSessionAnswersAnError [
	self assert: (GsInlineTemporaryRefactoring applyForToken: 'nope' deselected: #())
		includesSubstring: 'expired'
]
