"
Correctness of the extract-temporary refactoring (M3). Extract Temporary takes a
selected EXPRESSION in a method, introduces a new temporary assigned to it, and
replaces the selected occurrence(s) with the temporary. It is method-local: exactly
one method changes, staged as a single #methodRecompile, with no class-definition
edit and no cross-method scan.

This suite pins down:

  - a sub-expression (a binary operand) is extracted: a 'name := expr.' assignment is
    inserted before the containing statement and the occurrence is replaced by name;
  - an expression used as a whole return value extracts with the assignment before the
    return and '^ name' after;
  - a LITERAL can be extracted (naming a magic number);
  - a bare variable, an assignment, a whole ^return, and a multi-statement selection
    are DECLINED (empty change set + a reason);
  - an expression inside a BLOCK declares the temporary in that block, not the method;
  - replaceAll replaces every identical occurrence in the declaring sequence and
    inserts a single assignment before the earliest;
  - the new name COLLIDES (surfaced, not applied) with an existing arg/temp, an own or
    INHERITED instance variable, a class variable, or a pseudo-variable, and is free
    otherwise;
  - a fresh temporary is added to an existing '| .. |' clause and a '| name |' clause
    is created when the method had none;
  - building compiles nothing and commits nothing; apply recompiles the one method and
    never commits; preview / token round-trip work.

setUp builds a throwaway two-class hierarchy in UserGlobals; tearDown removes it.
"
Class {
	#name : 'GsExtractTemporaryRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsExtractTemporaryRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'asserting' }
GsExtractTemporaryRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'fixture' }
GsExtractTemporaryRefactoringTest >> baseFixture [
	^UserGlobals at: #GsETBase
]

{ #category : 'fixture' }
GsExtractTemporaryRefactoringTest >> subFixture [
	^UserGlobals at: #GsETSub
]

{ #category : 'fixture' }
GsExtractTemporaryRefactoringTest >> compile: aSource in: aClass [
	[aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture']
		on: CompileWarning
		do: [:ex | ex resume: nil]
]

{ #category : 'fixture' }
GsExtractTemporaryRefactoringTest >> extractIn: aClass selector: aSel expr: aSubstring to: aName [
	"A refactoring extracting the expression whose text is aSubstring in aClass>>aSel
	 (its exact 1-based source interval) into a new temporary named aName."
	| src start |
	src := (aClass compiledMethodAt: aSel) sourceString.
	start := src indexOfSubCollection: aSubstring.
	^GsExtractTemporaryRefactoring
		class: aClass
		selector: aSel
		meta: false
		selStart: start
		selStop: start + aSubstring size - 1
		newName: aName
]

{ #category : 'fixture' }
GsExtractTemporaryRefactoringTest >> recompileIn: aChangeSet [
	^aChangeSet changes detect: [:c | c kind = #methodRecompile] ifNone: [nil]
]

{ #category : 'running' }
GsExtractTemporaryRefactoringTest >> setUp [
	| base sub |
	super setUp.
	base := Object
		subclass: 'GsETBase'
		instVarNames: #('count')
		classVars: #('Registry')
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := base
		subclass: 'GsETSub'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	"--- expression forms ---"
	self compile: 'sumParts ^ count * 2 + 100' in: base.
	self compile: 'justExpr ^ count * 2' in: base.
	self compile: 'magic ^ 3600 + count' in: base.
	self compile: 'justVar ^ count' in: base.
	self compile: 'doAssign count := 5. ^ count' in: base.
	self compile: 'usesSuper ^ super printString' in: base.
	self compile: 'multiStmt count := 5. ^ count + 1' in: base.
	"--- inside a block ---"
	self compile: 'blockUse ^ #(1 2 3) collect: [:e | e * count + 1]' in: base.
	"--- replace-all ---"
	self compile: 'twice ^ count abs + count abs' in: base.
	"replace-all where an occurrence sits inside a nested block under the method body:
	 the temp must be declared at METHOD scope, not in the block (H1)."
	self compile: 'nestedReplaceAll | blk | blk := [:e | e + (count * 2)]. ^ (blk value: 1) + (count * 2)' in: base.
	"a whole-statement expression that appears more than once: replace-all must NOT leave
	 bare 'name.' statements (M2)."
	self compile: 'assignTwice count := 5. count := 5. ^ count' in: base.
	"the SAME expression in two SIBLING blocks: replace-all is scoped to the selected
	 occurrence's declaring sequence, so the other block is left untouched (L3)."
	self compile: 'siblingBlocks | a b | a := [:x | x + count abs]. b := [:y | y + count abs]. ^ (a value: 1) + (b value: 2)' in: base.
	"--- collisions ---"
	self compile: 'hasTemp | x | x := count * 2. ^ x' in: base.
	self compile: 'withArg: a ^ (count * 2) + a' in: base.
	self compile: 'toIvar ^ 5 * 2' in: base.
	self compile: 'toClassVar ^ 5 * 2' in: base.
	self compile: 'freeName ^ 5 * 2' in: base.
	"--- declaration placement ---"
	self compile: 'hasTemps | a b | a := count. b := a. ^ (b * 2) + count' in: base.
	self compile: 'noTemps ^ count * 2 + 1' in: base.
	"--- subclass (inherited ivar collision) ---"
	self compile: 'subExtract ^ 5 * 2' in: sub
]

{ #category : 'running' }
GsExtractTemporaryRefactoringTest >> tearDown [
	#('GsETSub' 'GsETBase')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
]

{ #category : 'tests - extract' }
GsExtractTemporaryRefactoringTest >> testExtractsSubExpression [
	| cs recompile |
	cs := (self extractIn: self baseFixture selector: #sumParts expr: 'count * 2' to: 'doubled') changeSet.
	recompile := self recompileIn: cs.

	self assert: cs size equals: 1.
	self assert: recompile newSource includesSubstring: 'doubled := count * 2'.
	self assert: recompile newSource includesSubstring: 'doubled + 100'
]

{ #category : 'tests - extract' }
GsExtractTemporaryRefactoringTest >> testExtractsWholeReturnValue [
	| recompile |
	recompile := self recompileIn:
		(self extractIn: self baseFixture selector: #justExpr expr: 'count * 2' to: 'doubled') changeSet.

	self assert: recompile newSource includesSubstring: 'doubled := count * 2'.
	self assert: recompile newSource includesSubstring: '^ doubled'
]

{ #category : 'tests - extract' }
GsExtractTemporaryRefactoringTest >> testExtractsLiteral [
	| recompile |
	recompile := self recompileIn:
		(self extractIn: self baseFixture selector: #magic expr: '3600' to: 'secondsPerHour') changeSet.

	self assert: recompile newSource includesSubstring: 'secondsPerHour := 3600'.
	self assert: recompile newSource includesSubstring: 'secondsPerHour + count'
]

{ #category : 'tests - extract' }
GsExtractTemporaryRefactoringTest >> testExtractsExpressionInsideABlockDeclaresTempInTheBlock [
	"The temporary is declared inside the block body (after '[:e |'), not at method level."
	| recompile src |
	recompile := self recompileIn:
		(self extractIn: self baseFixture selector: #blockUse expr: 'e * count' to: 'prod') changeSet.
	src := recompile newSource.

	self assert: src includesSubstring: 'prod := e * count'.
	self assert: src includesSubstring: 'prod + 1'.
	self assert: (src indexOfSubCollection: '| prod |') > (src indexOfSubCollection: '[:e |')
]

{ #category : 'tests - replace all' }
GsExtractTemporaryRefactoringTest >> testReplaceAllReplacesEveryOccurrence [
	| ref recompile |
	ref := self extractIn: self baseFixture selector: #twice expr: 'count abs' to: 'a'.
	ref replaceAll: true.
	recompile := self recompileIn: ref changeSet.

	self assert: recompile newSource includesSubstring: 'a := count abs'.
	self assert: recompile newSource includesSubstring: '^ a + a'
]

{ #category : 'tests - replace all' }
GsExtractTemporaryRefactoringTest >> testDefaultReplacesOnlyTheSelectedOccurrence [
	| recompile |
	recompile := self recompileIn:
		(self extractIn: self baseFixture selector: #twice expr: 'count abs' to: 'a') changeSet.

	self assert: recompile newSource includesSubstring: '^ a + count abs'
]

{ #category : 'tests - replace all' }
GsExtractTemporaryRefactoringTest >> testReplaceAllWithAnOccurrenceInANestedBlockDeclaresTempAtMethodScope [
	"H1: replace-all where one occurrence is inside a nested block must declare the
	 temporary at METHOD scope (added to the method's | .. | clause), not inside the
	 block -- otherwise the outer occurrence references an undeclared variable and Apply's
	 recompile fails. Select the SECOND (method-level) occurrence of 'count * 2'."
	| src first start ref recompile out |
	src := (self baseFixture compiledMethodAt: #nestedReplaceAll) sourceString.
	first := src indexOfSubCollection: 'count * 2'.
	start := src indexOfSubCollection: 'count * 2' startingAt: first + 'count * 2' size.
	ref := GsExtractTemporaryRefactoring
		class: self baseFixture selector: #nestedReplaceAll meta: false
		selStart: start selStop: start + 'count * 2' size - 1 newName: 'dbl'.
	ref replaceAll: true.
	recompile := self recompileIn: ref changeSet.
	out := recompile newSource.

	"temp added to the METHOD clause (| blk dbl |) -- NOT declared inside the block (which
	 would leave the method-level occurrence undeclared). The block occurrence is replaced
	 too. Under the H1 bug the method clause stays | blk | and this fails."
	self assert: out includesSubstring: 'blk dbl'.
	self assert: out includesSubstring: 'e + dbl'.
	self deny: out includesSubstring: '| dbl |'
]

{ #category : 'tests - replace all' }
GsExtractTemporaryRefactoringTest >> testReplaceAllStaysWithinTheDeclaringBlockAndSkipsASiblingBlock [
	"Scope boundary (L3, reconciled with H1): matchingOccurrences scans the SELECTED
	 occurrence's declaring sequence RECURSIVELY (nodesDo), so an identical expression in a
	 nested block under it is included, but one in a SIBLING block -- not a descendant -- is
	 not. Selecting 'count abs' in block a and replacing all must leave block b untouched and
	 declare the temp in block a."
	| ref out |
	ref := self extractIn: self baseFixture selector: #siblingBlocks expr: 'count abs' to: 'ca'.
	ref replaceAll: true.
	out := (self recompileIn: ref changeSet) newSource.

	self assert: out includesSubstring: 'x + ca'.
	self assert: out includesSubstring: 'ca := count abs'.
	"the sibling block keeps the original expression"
	self assert: out includesSubstring: 'y + count abs'
]

{ #category : 'tests - replace all' }
GsExtractTemporaryRefactoringTest >> testReplaceAllOnAWholeStatementDoesNotLeaveBareReads [
	"M2: a whole-statement expression that appears more than once must NOT be replaced by
	 bare 'name.' statements under replace-all -- only the selected statement becomes the
	 assignment; the source keeps its statement count (no degenerate reads)."
	| ref recompile |
	ref := self extractIn: self baseFixture selector: #assignTwice expr: 'count := 5' to: 'tmp'.
	ref replaceAll: true.
	recompile := self recompileIn: ref changeSet.

	self assert: recompile newSource includesSubstring: 'tmp := count := 5'.
	self assert: (RBParser parseMethod: recompile newSource) body statements size equals: 3
]

{ #category : 'tests - preflight' }
GsExtractTemporaryRefactoringTest >> testAnalysisReportsOccurrenceCount [
	| src start json |
	src := (self baseFixture compiledMethodAt: #twice) sourceString.
	start := src indexOfSubCollection: 'count abs'.
	json := GsExtractTemporaryRefactoring
		analyzeSelectionForClass: self baseFixture
		selector: #twice
		meta: false
		selStart: start
		selStop: start + 'count abs' size - 1.

	self assert: json includesSubstring: '"occurrenceCount":2'.
	self assert: json includesSubstring: '"decline":null'
]

{ #category : 'tests - extract' }
GsExtractTemporaryRefactoringTest >> testBareVariableIsExtractable [
	"A bare variable read can be aliased to a new temporary (create it now, wire it up
	 later) -- this is a legitimate use, not a decline."
	| ref recompile |
	ref := self extractIn: self baseFixture selector: #justVar expr: 'count' to: 'c'.
	recompile := self recompileIn: ref changeSet.

	self assert: ref declineReason isNil.
	self assert: recompile newSource includesSubstring: 'c := count'.
	self assert: recompile newSource includesSubstring: '^ c'
]

{ #category : 'tests - extract' }
GsExtractTemporaryRefactoringTest >> testAssignmentExpressionIsExtractable [
	"An assignment IS a value expression, so it can be named: t := count := 5. Because
	 the selection is the WHOLE statement, the statement becomes the assignment itself --
	 no degenerate bare 't.' statement is left behind (2 statements, not 3)."
	| ref recompile |
	ref := self extractIn: self baseFixture selector: #doAssign expr: 'count := 5' to: 't'.
	recompile := self recompileIn: ref changeSet.

	self assert: ref declineReason isNil.
	self assert: recompile newSource includesSubstring: 't := count := 5'.
	self assert: (RBParser parseMethod: recompile newSource) body statements size equals: 2
]

{ #category : 'tests - decline' }
GsExtractTemporaryRefactoringTest >> testAssignmentTargetIsDeclined [
	"Selecting the WRITE target of an assignment (the leading 'count' in 'count := 5')
	 is declined -- extracting it would redirect the assignment."
	| ref |
	ref := self extractIn: self baseFixture selector: #doAssign expr: 'count' to: 'c'.

	self assert: ref declineReason includesSubstring: 'assignment target'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsExtractTemporaryRefactoringTest >> testBareSuperIsDeclined [
	"'super' is only valid as a message receiver, so a bare 'super' cannot be extracted."
	| ref |
	ref := self extractIn: self baseFixture selector: #usesSuper expr: 'super' to: 'x'.

	self assert: ref declineReason includesSubstring: 'message receiver'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - extract' }
GsExtractTemporaryRefactoringTest >> testSuperSendIsExtractable [
	"The whole 'super printString' send IS extractable (super is the receiver, not
	 standalone)."
	| ref recompile |
	ref := self extractIn: self baseFixture selector: #usesSuper expr: 'super printString' to: 'label'.
	recompile := self recompileIn: ref changeSet.

	self assert: ref declineReason isNil.
	self assert: recompile newSource includesSubstring: 'label := super printString'
]

{ #category : 'tests - decline' }
GsExtractTemporaryRefactoringTest >> testWholeReturnSelectionIsDeclined [
	| ref |
	ref := self extractIn: self baseFixture selector: #justExpr expr: '^ count * 2' to: 'c'.

	self assert: ref declineReason includesSubstring: 'return statement'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - decline' }
GsExtractTemporaryRefactoringTest >> testMultiStatementSelectionIsDeclined [
	| ref |
	ref := self extractIn: self baseFixture selector: #multiStmt expr: 'count := 5. ^ count' to: 'c'.

	self assert: ref declineReason includesSubstring: 'single expression'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - collision' }
GsExtractTemporaryRefactoringTest >> testCollisionWithExistingTemp [
	| ref |
	ref := self extractIn: self baseFixture selector: #hasTemp expr: 'count * 2' to: 'x'.

	self assert: ref newNameCollision notNil
]

{ #category : 'tests - collision' }
GsExtractTemporaryRefactoringTest >> testCollisionWithExistingArgument [
	| ref |
	ref := self extractIn: self baseFixture selector: #withArg: expr: 'count * 2' to: 'a'.

	self assert: ref newNameCollision notNil
]

{ #category : 'tests - collision' }
GsExtractTemporaryRefactoringTest >> testCollisionWithOwnInstanceVariable [
	| ref |
	ref := self extractIn: self baseFixture selector: #toIvar expr: '5 * 2' to: 'count'.

	self assert: ref newNameCollision notNil
]

{ #category : 'tests - collision' }
GsExtractTemporaryRefactoringTest >> testCollisionWithInheritedInstanceVariable [
	| ref |
	ref := self extractIn: self subFixture selector: #subExtract expr: '5 * 2' to: 'count'.

	self assert: ref newNameCollision notNil
]

{ #category : 'tests - collision' }
GsExtractTemporaryRefactoringTest >> testCollisionWithClassVariable [
	| ref |
	ref := self extractIn: self baseFixture selector: #toClassVar expr: '5 * 2' to: 'Registry'.

	self assert: ref newNameCollision notNil
]

{ #category : 'tests - collision' }
GsExtractTemporaryRefactoringTest >> testCollisionWithPseudoVariable [
	| ref |
	ref := self extractIn: self baseFixture selector: #freeName expr: '5 * 2' to: 'self'.

	self assert: ref newNameCollision notNil
]

{ #category : 'tests - collision' }
GsExtractTemporaryRefactoringTest >> testFreeNameHasNoCollision [
	| ref |
	ref := self extractIn: self baseFixture selector: #freeName expr: '5 * 2' to: 'freshName'.

	self assert: ref newNameCollision isNil
]

{ #category : 'tests - declaration' }
GsExtractTemporaryRefactoringTest >> testTempAddedToExistingClause [
	| recompile |
	recompile := self recompileIn:
		(self extractIn: self baseFixture selector: #hasTemps expr: 'b * 2' to: 'c') changeSet.

	self assert: recompile newSource includesSubstring: 'a b c'
]

{ #category : 'tests - declaration' }
GsExtractTemporaryRefactoringTest >> testTempClauseCreatedWhenNone [
	| recompile |
	recompile := self recompileIn:
		(self extractIn: self baseFixture selector: #noTemps expr: 'count * 2' to: 'd') changeSet.

	self assert: recompile newSource includesSubstring: '| d |'
]

{ #category : 'tests - staging' }
GsExtractTemporaryRefactoringTest >> testBuildingTheChangeSetChangesNoSourceAndDoesNotCommit [
	| before |
	before := System needsCommit.
	(self extractIn: self baseFixture selector: #justExpr expr: 'count * 2' to: 'doubled') changeSet.

	self assert: (self baseFixture compiledMethodAt: #justExpr) sourceString
		includesSubstring: '^ count * 2'.
	self deny: (self baseFixture compiledMethodAt: #justExpr) sourceString
		includesSubstring: 'doubled'.
	self assert: System needsCommit equals: before
]

{ #category : 'tests - preview' }
GsExtractTemporaryRefactoringTest >> testPreviewJsonSerializesRecompile [
	| json |
	json := (self extractIn: self baseFixture selector: #justExpr expr: 'count * 2' to: 'doubled')
		previewJsonString.

	self assert: json includesSubstring: 'methodRecompile'
]

{ #category : 'tests - preview' }
GsExtractTemporaryRefactoringTest >> testStartPreviewCarriesTotalsAndPage [
	| json |
	json := (self extractIn: self baseFixture selector: #justExpr expr: 'count * 2' to: 'doubled')
		startPreviewToken: 'm3Tok' maxBytes: 100000.
	[self assert: json includesSubstring: '"total":1'.
	 self assert: json includesSubstring: '"newName":"doubled"'.
	 self assert: json includesSubstring: '"changes":']
		ensure: [GsExtractTemporaryRefactoring clearToken: 'm3Tok']
]

{ #category : 'tests - apply' }
GsExtractTemporaryRefactoringTest >> testApplyRecompilesAndDoesNotCommit [
	| before json |
	before := System needsCommit.
	json := (self extractIn: self baseFixture selector: #justExpr expr: 'count * 2' to: 'doubled')
		applyDeselected: #().

	self assert: json includesSubstring: '"applied":1'.
	self assert: json includesSubstring: '"failed":[]'.
	self assert: (self baseFixture compiledMethodAt: #justExpr) sourceString
		includesSubstring: 'doubled := count * 2'.
	self assert: System needsCommit equals: before
]

{ #category : 'tests - apply' }
GsExtractTemporaryRefactoringTest >> testTokenRoundTripStartThenApply [
	| ref json before |
	before := System needsCommit.
	ref := self extractIn: self baseFixture selector: #justExpr expr: 'count * 2' to: 'doubled'.
	ref startPreviewToken: 'm3rt' maxBytes: 100000.
	[json := GsExtractTemporaryRefactoring applyForToken: 'm3rt' deselected: #().
	 self assert: json includesSubstring: '"applied":1'.
	 self assert: (self baseFixture compiledMethodAt: #justExpr) sourceString
		includesSubstring: 'doubled := count * 2'.
	 self assert: System needsCommit equals: before]
		ensure: [GsExtractTemporaryRefactoring clearToken: 'm3rt']
]

{ #category : 'tests - apply' }
GsExtractTemporaryRefactoringTest >> testPageForTokenOnAnExpiredSessionAnswersAnError [
	self assert: (GsExtractTemporaryRefactoring pageForToken: 'nope' from: 1 maxBytes: 100)
		includesSubstring: 'expired'
]
