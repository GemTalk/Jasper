"
Correctness of the add / remove instance-variable refactoring (catalog V1):

  - #add appends the variable to the class definition, versions the whole subtree, and declines a
    duplicate/inherited name, an invalid name (including an UPPERCASE first letter), or a name that
    would shadow a class variable;
  - #add also PREDICTS the methods it will break: a method whose own temporary or argument has the
    new variable's name stops compiling once the variable is visible, while a block argument or
    block temporary of that name is fine;
  - #remove drops the variable and reports every method (defining class and descendants) that will
    no longer recompile because it accessed the variable;
  - class options, class variables, class-instance variables, and class-side methods are all
    preserved across the new version (earlier engines dropped options), and the options can be
    replaced with a user-edited set for the acted-on class;
  - applying (with neither migrate nor delete-history) never commits, and a method that references a
    removed variable is dropped and reported;
  - applying stops at the FIRST failure, so no later class is ever versioned onto a stale parent.
    The engine does NOT abort -- that would discard whatever the user had in flight before the
    refactoring started -- it reports `partiallyApplied`, and the client RECOMMENDS an abort (and
    says what one would cost) when changes were already staged.

setUp builds a throwaway hierarchy (GsIVBase -> GsIVSub -> GsIVLeaf) in UserGlobals, with a class
variable, a class-instance variable, and class-side methods on the base so the meta-side of the
new-version machinery is covered; tearDown removes it. Applying an operation creates new, uncommitted class versions; nothing here commits. The
delete-history STEP (deletePriorVersionsOf:) is exercised no-commit against a just-applied version;
the full committing migrate / delete-history round trip (which needs a clean committed transaction)
is exercised via the GCI e2e (gciInstVar.e2e.test.ts).
"
Class {
	#name : 'GsInstVarRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsInstVarRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'asserting' }
GsInstVarRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'asserting' }
GsInstVarRefactoringTest >> assert: aCollection includesItem: anObject [
	self assert: (aCollection includes: anObject)
]

{ #category : 'asserting' }
GsInstVarRefactoringTest >> deny: aCollection includesItem: anObject [
	self deny: (aCollection includes: anObject)
]

{ #category : 'fixture' }
GsInstVarRefactoringTest >> base [
	^UserGlobals at: #GsIVBase
]

{ #category : 'fixture' }
GsInstVarRefactoringTest >> sub [
	^UserGlobals at: #GsIVSub
]

{ #category : 'fixture' }
GsInstVarRefactoringTest >> leaf [
	^UserGlobals at: #GsIVLeaf
]

{ #category : 'fixture' }
GsInstVarRefactoringTest >> compile: aSource in: aClass [
	aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture'
]

{ #category : 'fixture' }
GsInstVarRefactoringTest >> classDefinitionEditFor: aName in: aChangeSet [
	^aChangeSet changes
		detect: [:c | c kind = #classDefinitionEdit and: [c className asString = aName]]
		ifNone: [nil]
]

{ #category : 'fixture' }
GsInstVarRefactoringTest >> add: aName [
	^GsInstVarRefactoring class: self base addInstVar: aName
]

{ #category : 'fixture' }
GsInstVarRefactoringTest >> remove: aName [
	^GsInstVarRefactoring class: self base removeInstVar: aName
]

{ #category : 'running' }
GsInstVarRefactoringTest >> setUp [
	| base sub leaf |
	super setUp.
	"The base carries a class variable AND a class-instance variable, and both sides carry methods,
	 so a new version has to preserve the meta-side shape and copy the class-side methods forward --
	 the parts of makeNewVersionOf: / copyMethodsFrom: an instance-side-only fixture never touched."
	base := Object
		subclass: 'GsIVBase'
		instVarNames: #('count' 'other')
		classVars: #('BaseTag')
		classInstVars: #('registry')
		poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := base
		subclass: 'GsIVSub'
		instVarNames: #('subOwn')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	leaf := sub
		subclass: 'GsIVLeaf'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'combine ^count + other' in: base.
	self compile: 'getOther ^other' in: base.
	self compile: 'readTag ^BaseTag' in: base.
	self compile: 'doubleCount ^count * 2' in: sub.
	self compile: 'readSubOwn ^subOwn' in: sub.
	self compile: 'leafCount ^count negated' in: leaf.
	"Class side: a plain method, one reading the class variable, and one reading the
	 class-INSTANCE variable -- all three must survive onto the new class version."
	self compile: 'describe ^''base''' in: base class.
	self compile: 'tag ^BaseTag' in: base class.
	self compile: 'registry ^registry' in: base class.
	"Seed the class variable and the class-instance variable with VALUES, so the meta-side tests can
	 assert the values -- not merely the slots -- survive the reshape. isNil alone would pass even if
	 makeNewVersionOf: recreated empty slots instead of carrying the existing ones over."
	self compile: 'seedClassState BaseTag := ''tagged''. registry := ''reg''' in: base class.
	base seedClassState
]

{ #category : 'running' }
GsInstVarRefactoringTest >> tearDown [
	#('GsIVLeaf' 'GsIVSub' 'GsIVBase')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddStagesClassDefinitionEditWithNewIvar [
	| change |
	change := self classDefinitionEditFor: 'GsIVBase' in: (self add: 'tally') changeSet.
	self assert: change notNil.
	self assert: change newSource includesSubstring: 'tally'.
	self assert: change newSource includesSubstring: 'count'.
	self assert: change oldSource includesSubstring: 'count'.
	self deny: change oldSource includesSubstring: 'tally'
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddVersionsTheWholeSubtree [
	"base's shape changes, so base + sub + leaf are all recompiled and nothing else is."
	| cs names |
	cs := (self add: 'tally') changeSet.
	names := cs changes collect: [:c | c className asString].
	self assert: names includesItem: 'GsIVBase'.
	self assert: names includesItem: 'GsIVSub'.
	self assert: names includesItem: 'GsIVLeaf'.
	self assert: cs size equals: 3
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddDeclinesDuplicateOwnName [
	self assert: (self add: 'count') decline notNil
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddDeclinesInheritedName [
	"count is inherited by the subclass, so adding it there is also a duplicate."
	self assert: (GsInstVarRefactoring class: self sub addInstVar: 'count') decline notNil
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddDeclinesSubclassOwnName [
	"A subclass (GsIVSub) already declares 'subOwn' as its own instance variable. Adding 'subOwn'
	 to the base would, once inherited, duplicate it on the subclass -- which fails at apply. The
	 analysis must catch it up front and decline, naming the offending subclass, so the user never
	 reaches a preview that could only strand a half-versioned subtree."
	| ref |
	ref := self add: 'subOwn'.
	self assert: ref decline notNil.
	self assert: ref decline includesSubstring: 'GsIVSub'
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddAllowsANameNoSubclassDeclares [
	"The mirror of the decline: a name no descendant owns analyzes cleanly and reaches a change set."
	self assert: (self add: 'freshVar') decline isNil
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddDeclinesInvalidName [
	self assert: (self add: '9bad') decline notNil.
	self assert: (self add: 'has space') decline notNil.
	self assert: (self add: '') decline notNil
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddDeclinesClassVariableShadow [
	| withCvar |
	withCvar := Object
		subclass: 'GsIVCv'
		instVarNames: #()
		classVars: #('Shared')
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	[self assert: (GsInstVarRefactoring class: withCvar addInstVar: 'Shared') decline notNil]
		ensure: [UserGlobals removeKey: #GsIVCv ifAbsent: []]
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddDeclinesInheritedClassVariableShadow [
	"A class variable declared on a SUPERCLASS is still visible to the subclass, so adding an
	 instance variable of that name on the subclass would shadow it and is declined."
	| sup sub |
	sup := Object
		subclass: 'GsIVCvSup'
		instVarNames: #()
		classVars: #('Shared')
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	sub := sup
		subclass: 'GsIVCvSub'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	[self assert: (GsInstVarRefactoring class: sub addInstVar: 'Shared') decline notNil]
		ensure: [#('GsIVCvSub' 'GsIVCvSup') do: [:n | UserGlobals removeKey: n asSymbol ifAbsent: []]]
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testAddHasNoWillNotRecompile [
	"Nothing in the fixture declares a temporary or argument named tally, so adding it breaks
	 nothing. (See the shadowing tests below for the case where something does.)"
	self assert: (self add: 'tally') willNotRecompileSelectorCount equals: 0
]

{ #category : 'tests - add name rules' }
GsInstVarRefactoringTest >> testAddDeclinesUppercaseFirstLetter [
	"A capitalised identifier in a method body reads as a global, so an uppercase instance
	 variable is confusing and shadow-prone. `Tally` used to be accepted."
	| ref |
	ref := self add: 'Tally'.
	self assert: ref decline notNil.
	self assert: ref decline includesSubstring: 'lowercase'
]

{ #category : 'tests - add name rules' }
GsInstVarRefactoringTest >> testAddAcceptsLowercaseFirstLetter [
	self assert: (self add: 'tally') decline isNil
]

{ #category : 'tests - add name rules' }
GsInstVarRefactoringTest >> testAddAcceptsUnderscoreFirstLetter [
	self assert: (self add: '_tally') decline isNil
]

{ #category : 'tests - add name rules' }
GsInstVarRefactoringTest >> testAddAcceptsInteriorUppercaseAndDigits [
	"Only the FIRST character is restricted; camelCase and digits stay legal."
	self assert: (self add: 'tallyForQ2') decline isNil
]

{ #category : 'tests - add shadowing' }
GsInstVarRefactoringTest >> testAddPredictsMethodTemporaryShadowing [
	"Adding an instance variable makes it visible to the whole subtree. GemStone REFUSES a method
	 whose own temporary has that name (verified on live 3.6.2 and 3.7.5 stones), so such a method
	 will not recompile onto the new version -- the preview has to say so."
	| ref |
	self compile: 'shadowTemp | tally | tally := 1. ^tally' in: self sub.
	ref := self add: 'tally'.
	self assert: ref decline isNil.
	self assert: ref willNotRecompileSelectorCount equals: 1.
	self assert: ref willNotRecompileJsonString includesSubstring: 'shadowTemp'.
	self assert: ref willNotRecompileJsonString includesSubstring: 'GsIVSub'
]

{ #category : 'tests - add shadowing' }
GsInstVarRefactoringTest >> testAddPredictsMethodArgumentShadowing [
	| ref |
	self compile: 'shadowArg: tally ^tally' in: self leaf.
	ref := self add: 'tally'.
	self assert: ref willNotRecompileSelectorCount equals: 1.
	self assert: ref willNotRecompileJsonString includesSubstring: 'shadowArg:'
]

{ #category : 'tests - add shadowing' }
GsInstVarRefactoringTest >> testAddPredictsShadowingOnTheActedOnClassItself [
	"Not just descendants: the acted-on class's own methods see the new variable too."
	| ref |
	self compile: 'shadowHere | tally | tally := 2. ^tally' in: self base.
	ref := self add: 'tally'.
	self assert: ref willNotRecompileSelectorCount equals: 1.
	self assert: ref willNotRecompileJsonString includesSubstring: 'GsIVBase'
]

{ #category : 'tests - add shadowing' }
GsInstVarRefactoringTest >> testAddIgnoresBlockArgumentShadowing [
	"GemStone ALLOWS a block argument to shadow an instance variable, so it must not be predicted
	 as broken -- a false positive would scare the user off a change that is fine."
	| ref |
	self compile: 'blockArg ^(#(1 2) collect: [:tally | tally * 2]) last' in: self sub.
	ref := self add: 'tally'.
	self assert: ref willNotRecompileSelectorCount equals: 0
]

{ #category : 'tests - add shadowing' }
GsInstVarRefactoringTest >> testAddIgnoresBlockTemporaryShadowing [
	"Same for a temporary declared INSIDE a block, at any nesting."
	| ref |
	self compile: 'blockTemp ^[ | tally | tally := 3. tally ] value' in: self sub.
	self compile: 'nestedBlockTemp ^[ [ | tally | tally := 4. tally ] value ] value' in: self leaf.
	ref := self add: 'tally'.
	self assert: ref willNotRecompileSelectorCount equals: 0
]

{ #category : 'tests - add shadowing' }
GsInstVarRefactoringTest >> testAddIgnoresClassSideShadowing [
	"Instance variables are invisible to class-side methods, so a class-side temporary of the same
	 name is not a collision."
	| ref |
	self compile: 'classSideTemp | tally | tally := 5. ^tally' in: self base class.
	ref := self add: 'tally'.
	self assert: ref willNotRecompileSelectorCount equals: 0
]

{ #category : 'tests - add shadowing' }
GsInstVarRefactoringTest >> testAddShadowingPredictionMatchesWhatIsActuallyDropped [
	"The point of the prediction: what the preview warns about is exactly what apply drops. Without
	 it the preview promised '0 will not recompile' and then dropped the method anyway."
	| ref result |
	self compile: 'shadowTemp | tally | tally := 1. ^tally' in: self sub.
	self compile: 'keeper ^subOwn' in: self sub.
	ref := self add: 'tally'.
	self assert: ref willNotRecompileSelectorCount equals: 1.
	result := ref applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self assert: result includesSubstring: 'shadowTemp'.
	self deny: result includesSubstring: 'keeper'.
	"...and the method really is gone from the new version, while its untouched sibling survives."
	self deny: ((UserGlobals at: #GsIVSub) includesSelector: #shadowTemp).
	self assert: ((UserGlobals at: #GsIVSub) includesSelector: #keeper)
]

{ #category : 'tests - class side' }
GsInstVarRefactoringTest >> testNewVersionPreservesClassVariables [
	"An earlier engine dropped class OPTIONS across the new version; class variables are the same
	 class of bug, and were untested because the fixture had none."
	self add: 'tally'.
	self assert: ((UserGlobals at: #GsIVBase) classVarNames collect: [:n | n asString])
		includesItem: 'BaseTag'.
	"the VALUE carried over, not just an empty recreated slot"
	self assert: (UserGlobals at: #GsIVBase) tag equals: 'tagged'
]

{ #category : 'tests - class side' }
GsInstVarRefactoringTest >> testNewVersionPreservesClassInstanceVariables [
	self add: 'tally'.
	self assert: ((UserGlobals at: #GsIVBase) class instVarNames collect: [:n | n asString])
		includesItem: 'registry'.
	"the VALUE carried over, not just an empty recreated slot"
	self assert: (UserGlobals at: #GsIVBase) registry equals: 'reg'
]

{ #category : 'tests - class side' }
GsInstVarRefactoringTest >> testNewVersionCopiesClassSideMethodsForward [
	"copyMethodsFrom:to: copies BOTH sides; the meta-side half had no coverage."
	| newBase |
	self add: 'tally'.
	newBase := UserGlobals at: #GsIVBase.
	self assert: (newBase class includesSelector: #describe).
	self assert: (newBase class includesSelector: #tag).
	self assert: (newBase class includesSelector: #registry)
]

{ #category : 'tests - class side' }
GsInstVarRefactoringTest >> testClassSideMethodsStillRunOnTheNewVersion [
	"Copied forward AND still functional -- the class variable and class-instance variable they
	 read have to have come across with them."
	| newBase |
	self add: 'tally'.
	newBase := UserGlobals at: #GsIVBase.
	self assert: newBase describe equals: 'base'.
	self assert: newBase tag equals: 'tagged'.
	self assert: newBase registry equals: 'reg'
]

{ #category : 'tests - class side' }
GsInstVarRefactoringTest >> testClassSideMethodsAreNotReportedAsDropped [
	| result |
	result := (self add: 'tally') applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self assert: result includesSubstring: '"dropped":[]'.
	self deny: result includesSubstring: 'describe'
]

{ #category : 'tests - add' }
GsInstVarRefactoringTest >> testUnknownOperationDeclines [
	"A refactoring built with an operation other than #add / #remove declines rather than acting."
	| ref |
	ref := GsInstVarRefactoring new
		setEnvironment: GsRefactoringEnvironment new
		operation: #frobnicate
		class: self base
		varName: 'x'.
	self assert: ref decline notNil.
	self assert: ref decline includesSubstring: 'Unknown operation'
]

{ #category : 'tests - remove' }
GsInstVarRefactoringTest >> testRemoveStagesClassDefinitionEditDroppingIvar [
	| change |
	change := self classDefinitionEditFor: 'GsIVBase' in: (self remove: 'count') changeSet.
	self assert: change notNil.
	self assert: change newSource includesSubstring: 'other'.
	self deny: change newSource includesSubstring: 'count'
]

{ #category : 'tests - remove' }
GsInstVarRefactoringTest >> testRemoveDeclinesNonOwnIvar [
	"'count' is inherited by the subclass, not owned; only its declaring class can remove it."
	self assert: (GsInstVarRefactoring class: self sub removeInstVar: 'count') decline notNil.
	self assert: (self remove: 'missing') decline notNil
]

{ #category : 'tests - remove' }
GsInstVarRefactoringTest >> testRemoveListsEveryMethodThatWillNotRecompile [
	"combine (base), doubleCount (sub), leafCount (leaf) all read count and will lose it; getOther
	 reads only other and survives."
	| refactoring |
	refactoring := self remove: 'count'.
	refactoring decline.
	self assert: refactoring willNotRecompileSelectorCount equals: 3.
	self assert: refactoring willNotRecompileJsonString includesSubstring: 'combine'.
	self assert: refactoring willNotRecompileJsonString includesSubstring: 'doubleCount'.
	self assert: refactoring willNotRecompileJsonString includesSubstring: 'leafCount'.
	self deny: refactoring willNotRecompileJsonString includesSubstring: 'getOther'
]

{ #category : 'tests - remove' }
GsInstVarRefactoringTest >> testRemoveCleanIvarDropsNothing [
	"Removing an instance variable that no method references reports nothing will-not-recompile and
	 drops no method; the still-referenced sibling ivar and its accessor survive."
	| cls ref result |
	cls := Object
		subclass: 'GsIVClean'
		instVarNames: #('used' 'unused')
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'readUsed ^used' in: cls.
	[ref := GsInstVarRefactoring class: cls removeInstVar: 'unused'.
	 self assert: ref willNotRecompileSelectorCount equals: 0.
	 result := ref applyDeselected: #() options: nil migrate: false deleteHistory: false.
	 self assert: result includesSubstring: '"dropped":[]'.
	 self deny: ((UserGlobals at: #GsIVClean) instVarNames includes: #unused).
	 self assert: ((UserGlobals at: #GsIVClean) includesSelector: #readUsed)]
		ensure: [UserGlobals removeKey: #GsIVClean ifAbsent: []]
]

{ #category : 'tests - json' }
GsInstVarRefactoringTest >> testAnalysisJsonStringShape [
	| json |
	json := GsInstVarRefactoring analyzeClass: self base addInstVar: 'tally'.
	self assert: json includesSubstring: '"decline":null'.
	self assert: json includesSubstring: '"operation":"add"'.
	self assert: json includesSubstring: '"sourceClass":"GsIVBase"'.
	self assert: json includesSubstring: '"affectedCount":3'
]

{ #category : 'tests - json' }
GsInstVarRefactoringTest >> testAnalysisJsonStringReportsDecline [
	| json |
	json := GsInstVarRefactoring analyzeClass: self base addInstVar: 'count'.
	self deny: json includesSubstring: '"decline":null'
]

{ #category : 'tests - json' }
GsInstVarRefactoringTest >> testOutOfScopeJsonCarriesWarningsAndCommitNote [
	| refactoring json |
	refactoring := self remove: 'count'.
	json := refactoring outOfScopeJsonString.
	self assert: json includesSubstring: '"willNotRecompile":'.
	self assert: json includesSubstring: 'commit'.
	self assert: json includesSubstring: '"actedOnClass":"GsIVBase"'
]

{ #category : 'tests - json' }
GsInstVarRefactoringTest >> testPreviewJsonSerializesChangeSet [
	| json |
	json := (self add: 'tally') previewJsonString.
	self assert: (json isKindOf: String).
	self assert: json includesSubstring: 'classDefinitionEdit'.
	self assert: json includesSubstring: 'classReparent'
]

{ #category : 'tests - json' }
GsInstVarRefactoringTest >> testStartPreviewTokenStoresSelfAndPaginates [
	| refactoring start page |
	refactoring := self add: 'tally'.
	start := refactoring startPreviewToken: 'gsivtok1' maxBytes: 100000.
	self assert: start includesSubstring: '"token":"gsivtok1"'.
	self assert: start includesSubstring: '"total":3'.
	page := GsInstVarRefactoring pageForToken: 'gsivtok1' from: 1 maxBytes: 100000.
	self assert: page includesSubstring: 'classDefinitionEdit'.
	GsInstVarRefactoring clearToken: 'gsivtok1'.
	self assert: (GsInstVarRefactoring pageForToken: 'gsivtok1' from: 1 maxBytes: 100) includesSubstring: 'expired'
]

{ #category : 'tests - json' }
GsInstVarRefactoringTest >> testPaginatedPreviewReturnsBoundedPages [
	"A tiny byte budget yields one change per page: the first page is not done and points at the
	 next offset; fetching from the last change reports done."
	| ref total first last |
	ref := self add: 'tally'.
	total := ref changeSet size.
	self assert: total > 1.

	first := ref pageJsonFrom: 1 maxBytes: 1.
	self assert: first includesSubstring: '"nextOffset":2'.
	self assert: first includesSubstring: '"done":false'.

	last := ref pageJsonFrom: total maxBytes: 1000000.
	self assert: last includesSubstring: '"done":true'
]

{ #category : 'tests - no commit' }
GsInstVarRefactoringTest >> testBuildingChangeSetDoesNotCommit [
	| before |
	before := System needsCommit.
	self add: 'tally'.
	self remove: 'count'.
	self assert: System needsCommit equals: before
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testApplyAddInstallsNewVersionWithIvar [
	| refactoring result |
	refactoring := self add: 'tally'.
	result := refactoring applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self assert: result includesSubstring: '"committed":false'.
	self assert: (self base instVarNames includes: #tally).
	self assert: ((self sub new) class allInstVarNames includes: #tally)
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testApplyCompilesAccessorsInTheSameApply [
	"Accessors requested with an add are compiled onto the NEW class version inside the same
	 apply, so they ride the structural change's transaction (committed or aborted together with
	 it) rather than a separate post-apply step that could strand them."
	| refactoring accessors current |
	refactoring := self add: 'tally'.
	accessors := Array
		with: (Array with: 'tally' with: 'tally
^tally')
		with: (Array with: 'tally:' with: 'tally: aValue
tally := aValue').
	refactoring applyDeselected: #() options: nil migrate: false deleteHistory: false accessors: accessors.
	current := UserGlobals at: #GsIVBase.
	self assert: (current instVarNames includes: #tally).
	self assert: (current includesSelector: #tally).
	self assert: (current includesSelector: #'tally:')
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testApplyReportsAnAccessorThatCannotCompileAndInstallsNothing [
	"A getter/setter that will not compile is surfaced in `failed` -- which holds the commit back --
	 and is not installed: the mechanism that makes an add-with-accessors all-or-nothing."
	| refactoring result |
	refactoring := self add: 'tally'.
	result := refactoring applyDeselected: #() options: nil migrate: false deleteHistory: false
		accessors: (Array with: (Array with: 'tally' with: 'tally
^ )( not parseable')).
	"failed non-empty -> the empty-array marker is absent"
	self deny: result includesSubstring: '"failed":[]'.
	self deny: ((UserGlobals at: #GsIVBase) includesSelector: #tally)
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testApplyPreservesClassOptions [
	"The acted-on class's options must survive the new version (the bug the earlier engines had:
	 they passed options: #() and dropped them)."
	| optioned refactoring |
	optioned := Object
		_subclass: 'GsIVOpt'
		instVarNames: #('a')
		format: Object format
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals
		inClassHistory: nil
		description: ''
		options: #(#disallowGciStore).
	[refactoring := GsInstVarRefactoring class: optioned addInstVar: 'b'.
	 refactoring applyDeselected: #() options: nil migrate: false deleteHistory: false.
	 self assert: ((UserGlobals at: #GsIVOpt) _optionsArray includes: #disallowGciStore)]
		ensure: [UserGlobals removeKey: #GsIVOpt ifAbsent: []]
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testApplyEditsClassOptions [
	| optioned refactoring |
	optioned := Object
		_subclass: 'GsIVOpt2'
		instVarNames: #('a')
		format: Object format
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		inDictionary: UserGlobals
		inClassHistory: nil
		description: ''
		options: #().
	[refactoring := GsInstVarRefactoring class: optioned addInstVar: 'b'.
	 refactoring applyDeselected: #() options: #('disallowGciStore') migrate: false deleteHistory: false.
	 self assert: ((UserGlobals at: #GsIVOpt2) _optionsArray includes: #disallowGciStore)]
		ensure: [UserGlobals removeKey: #GsIVOpt2 ifAbsent: []]
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testApplyReparentsSubclassesKeepingOwnMethods [
	"Reshaping the base versions the whole subtree: every descendant is re-parented onto the new
	 version of its superclass and keeps its own methods."
	| ref |
	ref := self add: 'tally'.
	ref applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self assert: self sub superclass == self base.
	self assert: (self sub includesSelector: #readSubOwn).
	self assert: (self sub includesSelector: #doubleCount).
	self assert: self leaf superclass == self sub.
	self assert: (self leaf includesSelector: #leafCount)
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testApplyIgnoresDeselectionApplyingAllChanges [
	"An instance-variable add/remove is all-or-nothing: the shape edit and the descendant reparents
	 must move together, so a deselection is ignored and every staged change is still applied."
	| ref result |
	ref := self add: 'tally'.
	result := ref
		applyDeselected: #('bogus-id-1' 'bogus-id-2')
		options: nil
		migrate: false
		deleteHistory: false.
	self assert: result includesSubstring: '"applied":3'.
	self assert: (self base instVarNames includes: #tally).
	self assert: self sub superclass == self base
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testDeleteHistoryTrimsPriorVersionsToCurrent [
	"Applying versions the acted-on class, so its history gains the prior version;
	 deletePriorVersionsOf: (the delete-history step) then trims that history down to just the
	 current version. Exercised WITHOUT committing (setUp's fixture is abort-restored); the full
	 committing migrate / delete-history round trip is exercised via the GCI e2e, since it needs a
	 clean, committed transaction and so cannot run in a no-commit SUnit test."
	| refactoring current |
	refactoring := self add: 'tally'.
	refactoring applyDeselected: #() options: nil migrate: false deleteHistory: false.
	current := self base.
	self assert: current classHistory size >= 2.

	refactoring deletePriorVersionsOf: current.
	self assert: current classHistory size equals: 1.
	self assert: (current classHistory at: 1) == current
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testMigrateAllInstancesNeverRaisesWithoutACommit [
	"migrateAllInstances must answer an Integer failure count and never propagate an exception --
	 that is what stops a partial migration failure (migrateInstancesTo: reports it in the RETURN
	 VALUE, not by raising) or a raise from being silently swallowed as a clean success. Here the
	 structural change is uncommitted, so migrateInstancesTo: raises (it needs a clean transaction)
	 and the method must CATCH and count it. The real apply commits before migrating; the full
	 migrate+commit round trip is exercised via GCI, which cannot run in a no-commit SUnit test."
	| ref result |
	ref := self add: 'tally'.
	ref applyDeselected: #() options: nil migrate: false deleteHistory: false.
	result := ref migrateAllInstances.

	self assert: (result isKindOf: Integer).
	self assert: result >= 0
]

{ #category : 'tests - apply' }
GsInstVarRefactoringTest >> testApplyRemoveDropsBrokenMethodsAndReportsThem [
	| refactoring result |
	refactoring := self remove: 'count'.
	result := refactoring applyDeselected: #() options: nil migrate: false deleteHistory: false.
	"combine, doubleCount, leafCount reference count -> dropped; getOther survives."
	self assert: result includesSubstring: '"dropped":'.
	self assert: result includesSubstring: 'combine'.
	self assert: (self base compiledMethodAt: #combine environmentId: 0 otherwise: nil) isNil.
	self assert: (self base compiledMethodAt: #getOther environmentId: 0 otherwise: nil) notNil.
	self deny: (self base instVarNames includes: #count)
]

{ #category : 'tests - apply rollback' }
GsInstVarRefactoringTest >> testApplyStopsAtTheFirstFailure [
	"An add/remove is ALL-OR-NOTHING: each class is re-versioned under the NEW version of its
	 parent, so carrying on past a failure would version later classes onto a stale oldToNew entry
	 and leave a half-reshaped subtree. The apply must stop dead at the first failure.

	 The failure is provoked the only way a caller could hit it: the change set is staged (base,
	 sub, leaf, top-down), then the middle class disappears from the symbol list before apply, so
	 applyClassChange: raises 'Class not found' on it."
	| refactoring result |
	refactoring := self add: 'tally'.
	refactoring changeSet.  "stage while the whole hierarchy still exists"
	UserGlobals removeKey: #GsIVSub ifAbsent: [].
	result := refactoring applyDeselected: #() options: nil migrate: false deleteHistory: false.

	"The base (staged first) applied, the sub failed, and the leaf was never attempted -- before the
	 fix the loop ran on and versioned the leaf onto a stale parent."
	self assert: result includesSubstring: '"applied":1'.
	self assert: result includesSubstring: 'GsIVSub'.
	self deny: result includesSubstring: 'GsIVLeaf'.
	"...and the engine does NOT abort: it reports the partial state and leaves the transaction (and
	 therefore the fixture, which is uncommitted work of this session) exactly where it was."
	self assert: result includesSubstring: '"partiallyApplied":true'.
	self assert: (UserGlobals includesKey: #GsIVBase)
]

{ #category : 'tests - apply rollback' }
GsInstVarRefactoringTest >> testSuccessfulApplyReportsNoPartialApply [
	| result |
	result := (self add: 'tally') applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self assert: result includesSubstring: '"partiallyApplied":false'.
	self assert: result includesSubstring: '"failed":[]'
]

{ #category : 'tests - json' }
GsInstVarRefactoringTest >> testOutOfScopeReportsWhetherTheSessionHasUncommittedChanges [
	"The committing options commit the WHOLE session transaction, so the client warns when the
	 session already holds other uncommitted work. setUp's fixture is uncommitted, so it does."
	| json |
	json := (self add: 'tally') outOfScopeJsonString.
	self assert: json includesSubstring: '"sessionHasUncommittedChanges":true'
]

{ #category : 'tests - apply rollback' }
GsInstVarRefactoringTest >> testSucceedingApplyStillReportsItsDroppedMethods [
	"A clean apply reports its dropped methods as usual and flags no partial apply."
	| result |
	result := (self remove: 'count') applyDeselected: #() options: nil migrate: false deleteHistory: false.
	self assert: result includesSubstring: 'combine'.
	self assert: result includesSubstring: '"partiallyApplied":false'
]

{ #category : 'tests - add shadowing' }
GsInstVarRefactoringTest >> testShadowScanIgnoresMethodsThatMerelyMentionTheName [
	"The scan pre-filters on the name appearing in the source before parsing. A method that only
	 SENDS a same-named message (or names it in a comment) declares nothing and must not be
	 reported -- the pre-filter must not turn into the answer."
	| ref |
	self compile: 'mentionsOnly "tally here" ^self class name' in: self sub.
	self compile: 'sendsIt ^self respondsTo: #tally' in: self sub.
	ref := self add: 'tally'.
	self assert: ref willNotRecompileSelectorCount equals: 0
]
