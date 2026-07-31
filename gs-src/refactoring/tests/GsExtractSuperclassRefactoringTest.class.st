"
Correctness of the extract-superclass refactorings (V6 insert superclass, V7 extract superclass).
V6 inserts a new empty class between a class and its superclass; V7 does the same above a chosen
set of siblings and hoists their common instance variables and methods up into it. Both are one
engine (GsExtractSuperclassRefactoring): V6 is extract above ONE class hoisting ZERO members.

The apply creates the new superclass fresh (a #classAdd), then -- because changing a class's
superclass or ivar list means a new class version (GemStone has no reparent/addInstVarName:) --
re-versions every extracted class and its descendant subtree top-down, re-parenting the extracted
classes onto the new class and their descendants onto their freshly-versioned ancestor. Hoisted
ivars move onto the new class; hoisted methods are added to it and removed from the extracted
classes.

This suite pins down, on Object -> GsESAnimal -> {GsESDog, GsESCat, GsESFish} with
GsESDog -> GsESPuppy:

  - V6: inserting an empty superclass leaves the anchor's methods/ivars intact and keeps the whole
    subtree correctly parented;
  - V7: hoisting an identical method/ivar moves it to the new class and both extracted classes
    inherit it; member classification marks identical / divergent / partial / unhoistable members;
  - declines: name collision, bad sibling, hoisting an unhoistable (super / foreign-ivar) method;
  - across all: the descendant subtree survives the reversioning, apply is all-or-nothing, and
    building/applying compiles-in-stone-only and never commits.

setUp builds the throwaway hierarchy in UserGlobals; tearDown removes it (children first).
"
Class {
	#name : 'GsExtractSuperclassRefactoringTest',
	#superclass : 'TestCase',
	#category : 'Refactoring-Tests-Core'
}

{ #category : 'asserting' }
GsExtractSuperclassRefactoringTest >> assert: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) > 0
]

{ #category : 'asserting' }
GsExtractSuperclassRefactoringTest >> deny: aString includesSubstring: aSubstring [
	self assert: (aString indexOfSubCollection: aSubstring) = 0
]

{ #category : 'asserting' }
GsExtractSuperclassRefactoringTest >> assert: aCollection includes: anObject [
	self assert: (aCollection includes: anObject)
]

{ #category : 'asserting' }
GsExtractSuperclassRefactoringTest >> deny: aCollection includes: anObject [
	self assert: (aCollection includes: anObject) not
]

{ #category : 'fixture' }
GsExtractSuperclassRefactoringTest >> compile: aSource in: aClass [
	[aClass
		compileMethod: aSource
		dictionaries: System myUserProfile symbolList
		category: 'fixture']
		on: CompileWarning
		do: [:ex | ex resume: nil]
]

{ #category : 'fixture' }
GsExtractSuperclassRefactoringTest >> classNamed: aName [
	^UserGlobals at: aName asSymbol
]

{ #category : 'fixture' }
GsExtractSuperclassRefactoringTest >> ownIvarsOf: aName [
	^(self classNamed: aName) instVarNames collect: [:e | e asString]
]

{ #category : 'fixture' }
GsExtractSuperclassRefactoringTest >> allIvarsOf: aName [
	^(self classNamed: aName) allInstVarNames collect: [:e | e asString]
]

{ #category : 'fixture' }
GsExtractSuperclassRefactoringTest >> methodCandidate: aSelector in: ref [
	^ref candidateMethods detect: [:m | (m at: 1) asString = aSelector asString] ifNone: [nil]
]

{ #category : 'fixture' }
GsExtractSuperclassRefactoringTest >> ivarCandidate: aName in: ref [
	^ref candidateInstVars detect: [:v | (v at: 1) asString = aName asString] ifNone: [nil]
]

{ #category : 'fixture' }
GsExtractSuperclassRefactoringTest >> changeOfKind: aKind for: aName in: cs [
	^cs changes detect: [:c | c kind = aKind and: [c className = aName]] ifNone: [nil]
]

{ #category : 'running' }
GsExtractSuperclassRefactoringTest >> setUp [
	| animal dog cat |
	animal := Object
		subclass: 'GsESAnimal'
		instVarNames: #()
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	dog := animal
		subclass: 'GsESDog'
		instVarNames: #('name' 'age' 'bark')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	cat := animal
		subclass: 'GsESCat'
		instVarNames: #('name' 'age' 'meow')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	animal
		subclass: 'GsESFish'
		instVarNames: #('name')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	dog
		subclass: 'GsESPuppy'
		instVarNames: #('cuteness')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	self compile: 'eat ^ 42' in: dog.
	self compile: 'sleep ^ ''zzz''' in: dog.
	self compile: 'describe ^ ''a dog''' in: dog.
	self compile: 'fetch ^ ''fetching''' in: dog.
	self compile: 'barkSound ^ bark' in: dog.
	self compile: 'superGreet ^ super hash' in: dog.
	self compile: 'nameGetter ^ name' in: dog.
	self compile: 'eat ^ 42' in: cat.
	self compile: 'sleep ^ ''zzz''' in: cat.
	self compile: 'describe ^ ''a cat''' in: cat.
	self compile: 'nameGetter ^ name' in: cat.
	self compile: 'eat ^ 42' in: (self classNamed: 'GsESFish').
	self compile: 'puppyM ^ 1' in: (self classNamed: 'GsESPuppy')
]

{ #category : 'running' }
GsExtractSuperclassRefactoringTest >> tearDown [
	#('GsESPuppy' 'GsESDog' 'GsESCat' 'GsESFish' 'GsESPet' 'GsESAnimal')
		do: [:nm | UserGlobals removeKey: nm asSymbol ifAbsent: []]
]

{ #category : 'tests - V6 insert' }
GsExtractSuperclassRefactoringTest >> testInsertEmptySuperclassStagesClassAdd [
	| ref cs add |
	ref := GsExtractSuperclassRefactoring class: (self classNamed: 'GsESDog') insertSuperclassNamed: 'GsESPet' inDictionary: nil.
	cs := ref changeSet.
	add := cs changes detect: [:c | c kind = #classAdd] ifNone: [nil].

	self assert: ref decline isNil.
	self assert: add notNil.
	self assert: add className equals: 'GsESPet'.
	self assert: (self changeOfKind: #classDefinitionEdit for: 'GsESDog' in: cs) notNil
]

{ #category : 'tests - V6 insert' }
GsExtractSuperclassRefactoringTest >> testInsertEmptySuperclassApplies [
	| json |
	json := (GsExtractSuperclassRefactoring class: (self classNamed: 'GsESDog') insertSuperclassNamed: 'GsESPet' inDictionary: nil)
		applyDeselected: #().

	self deny: json includesSubstring: '"failed":[{'.
	"the new class slots between Animal and Dog"
	self assert: (self classNamed: 'GsESPet') superclass name asString equals: 'GsESAnimal'.
	self assert: (self classNamed: 'GsESDog') superclass name asString equals: 'GsESPet'.
	"...and starts empty"
	self assert: (self ownIvarsOf: 'GsESPet') isEmpty.
	self assert: (self classNamed: 'GsESPet') selectors isEmpty.
	"the anchor keeps its own methods + ivars"
	self assert: ((self classNamed: 'GsESDog') includesSelector: #eat).
	self assert: (self ownIvarsOf: 'GsESDog') includes: 'name'
]

{ #category : 'tests - V6 insert' }
GsExtractSuperclassRefactoringTest >> testInsertReparentsDeepSubtree [
	"A grandchild of the anchor must stay correctly parented onto the anchor's new version."
	(GsExtractSuperclassRefactoring class: (self classNamed: 'GsESDog') insertSuperclassNamed: 'GsESPet' inDictionary: nil)
		applyDeselected: #().

	self assert: (self classNamed: 'GsESPuppy') superclass name asString equals: 'GsESDog'.
	self assert: ((self classNamed: 'GsESPuppy') includesSelector: #puppyM).
	self assert: ((self classNamed: 'GsESPuppy') canUnderstand: #eat)
]

{ #category : 'tests - V6 insert' }
GsExtractSuperclassRefactoringTest >> testInsertDoesNotMigrateExistingInstances [
	"Existing instances keep their prior class version (standard GemStone evolution, no migrate)."
	| d |
	d := (self classNamed: 'GsESDog') new.
	(GsExtractSuperclassRefactoring class: (self classNamed: 'GsESDog') insertSuperclassNamed: 'GsESPet' inDictionary: nil)
		applyDeselected: #().

	self deny: d class == (self classNamed: 'GsESDog')
]

{ #category : 'tests - V7 extract' }
GsExtractSuperclassRefactoringTest >> testExtractHoistsIdenticalMethod [
	| json |
	json := (GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #(#eat) hoistInstVars: #())
		applyDeselected: #().

	self deny: json includesSubstring: '"failed":[{'.
	self assert: ((self classNamed: 'GsESPet') includesSelector: #eat).
	self deny: ((self classNamed: 'GsESDog') includesSelector: #eat).
	self deny: ((self classNamed: 'GsESCat') includesSelector: #eat).
	self assert: ((self classNamed: 'GsESDog') canUnderstand: #eat).
	self assert: ((self classNamed: 'GsESCat') canUnderstand: #eat).
	"the non-hoisted methods stay put"
	self assert: ((self classNamed: 'GsESDog') includesSelector: #describe).
	self assert: ((self classNamed: 'GsESCat') includesSelector: #describe)
]

{ #category : 'tests - V7 extract' }
GsExtractSuperclassRefactoringTest >> testExtractHoistsIdenticalInstVar [
	| json |
	json := (GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #() hoistInstVars: #('name'))
		applyDeselected: #().

	self deny: json includesSubstring: '"failed":[{'.
	self assert: (self ownIvarsOf: 'GsESPet') includes: 'name'.
	self deny: (self ownIvarsOf: 'GsESDog') includes: 'name'.
	self deny: (self ownIvarsOf: 'GsESCat') includes: 'name'.
	self assert: (self allIvarsOf: 'GsESDog') includes: 'name'.
	self assert: (self allIvarsOf: 'GsESCat') includes: 'name'.
	"a non-hoisted own ivar stays"
	self assert: (self ownIvarsOf: 'GsESDog') includes: 'bark'
]

{ #category : 'tests - V7 extract' }
GsExtractSuperclassRefactoringTest >> testExtractHoistsMethodAndItsIvarTogether [
	"Hoisting a shared accessor together with its ivar: nameGetter (^ name) + name move to Pet."
	| json |
	json := (GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #(#nameGetter) hoistInstVars: #('name'))
		applyDeselected: #().

	self deny: json includesSubstring: '"failed":[{'.
	self assert: ((self classNamed: 'GsESPet') includesSelector: #nameGetter).
	self assert: (self ownIvarsOf: 'GsESPet') includes: 'name'.
	self assert: ((self classNamed: 'GsESDog') canUnderstand: #nameGetter)
]

{ #category : 'tests - V7 extract' }
GsExtractSuperclassRefactoringTest >> testExtractFromSingleAnchorHoistsChosenMethod [
	"V6/V7 unified: extract above ONE class (no siblings) can still hoist a chosen method up."
	| json |
	json := (GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #() hoistMethods: #(#eat) hoistInstVars: #())
		applyDeselected: #().

	self deny: json includesSubstring: '"failed":[{'.
	self assert: ((self classNamed: 'GsESPet') includesSelector: #eat).
	self deny: ((self classNamed: 'GsESDog') includesSelector: #eat).
	self assert: ((self classNamed: 'GsESDog') canUnderstand: #eat)
]

{ #category : 'tests - classification' }
GsExtractSuperclassRefactoringTest >> testIdenticalMethodClassifiedAndDefaultChecked [
	| ref eat |
	ref := GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #() hoistInstVars: #().
	eat := self methodCandidate: #eat in: ref.

	self assert: eat notNil.
	self assert: (eat at: 2) equals: #identical.
	self assert: (ref defaultChecksMember: (eat at: 2))
]

{ #category : 'tests - classification' }
GsExtractSuperclassRefactoringTest >> testDivergentMethodClassified [
	| ref describe |
	ref := GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #() hoistInstVars: #().
	describe := self methodCandidate: #describe in: ref.

	self assert: describe notNil.
	self assert: (describe at: 2) equals: #divergent.
	self deny: (ref defaultChecksMember: (describe at: 2))
]

{ #category : 'tests - classification' }
GsExtractSuperclassRefactoringTest >> testPartialMethodClassified [
	"fetch is implemented only by the anchor, not the chosen sibling."
	| ref fetch |
	ref := GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #() hoistInstVars: #().
	fetch := self methodCandidate: #fetch in: ref.

	self assert: fetch notNil.
	self assert: (fetch at: 2) equals: #partial
]

{ #category : 'tests - classification' }
GsExtractSuperclassRefactoringTest >> testSuperSendMethodUnhoistable [
	| ref greet |
	ref := GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #() hoistInstVars: #().
	greet := self methodCandidate: #superGreet in: ref.

	self assert: greet notNil.
	self assert: (greet at: 2) equals: #unhoistable.
	self assert: (greet at: 3) includesSubstring: 'super'
]

{ #category : 'tests - classification' }
GsExtractSuperclassRefactoringTest >> testForeignIvarMethodUnhoistable [
	"barkSound (^ bark) touches an ivar that is NOT shared (only the anchor owns it), so it is not
	 hoistable while that ivar stays below."
	| ref bs |
	ref := GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #() hoistInstVars: #().
	bs := self methodCandidate: #barkSound in: ref.

	self assert: bs notNil.
	self assert: (bs at: 2) equals: #unhoistable.
	self assert: (bs at: 3) includesSubstring: 'instance variable'
]

{ #category : 'tests - classification' }
GsExtractSuperclassRefactoringTest >> testInstVarsClassified [
	| ref name bark |
	ref := GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #() hoistInstVars: #().
	name := self ivarCandidate: 'name' in: ref.
	bark := self ivarCandidate: 'bark' in: ref.

	self assert: (name at: 2) equals: #identical.
	self assert: (ref defaultChecksMember: (name at: 2)).
	self assert: (bark at: 2) equals: #partial
]

{ #category : 'tests - classification' }
GsExtractSuperclassRefactoringTest >> testSingleAnchorDefaultChecksNothing [
	"With no sibling to deduplicate against, even an 'identical' member is not pre-checked (V6
	 defaults to a pure insert)."
	| ref eat |
	ref := GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #() hoistMethods: #() hoistInstVars: #().
	eat := self methodCandidate: #eat in: ref.

	self assert: (eat at: 2) equals: #identical.
	self deny: (ref defaultChecksMember: (eat at: 2))
]

{ #category : 'tests - declines' }
GsExtractSuperclassRefactoringTest >> testDeclinesOnNameCollision [
	| ref |
	ref := GsExtractSuperclassRefactoring class: (self classNamed: 'GsESDog') insertSuperclassNamed: 'GsESCat' inDictionary: nil.

	self assert: ref decline notNil.
	self assert: ref decline includesSubstring: 'already exists'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - declines' }
GsExtractSuperclassRefactoringTest >> testDeclinesOnBadSibling [
	| ref |
	ref := GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESPuppy') hoistMethods: #() hoistInstVars: #().

	self assert: ref decline notNil.
	self assert: ref decline includesSubstring: 'not a subclass of'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - declines' }
GsExtractSuperclassRefactoringTest >> testDeclinesHoistingSuperSendMethod [
	| ref |
	ref := GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #(#superGreet) hoistInstVars: #().

	self assert: ref decline notNil.
	self assert: ref decline includesSubstring: 'super'.
	self assert: ref changeSet isEmpty
]

{ #category : 'tests - declines' }
GsExtractSuperclassRefactoringTest >> testDeclinesHoistingForeignIvarMethodWithoutItsIvar [
	"Hoisting barkSound (^ bark) without also hoisting bark is declined; hoisting both is viable."
	| without with |
	without := GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #() hoistMethods: #(#barkSound) hoistInstVars: #().
	with := GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #() hoistMethods: #(#barkSound) hoistInstVars: #('bark').

	self assert: without decline notNil.
	self assert: without decline includesSubstring: 'instance variable'.
	self assert: with decline isNil
]

{ #category : 'tests - declines' }
GsExtractSuperclassRefactoringTest >> testDeclinesAboveAClassWithNoSuperclass [
	| ref |
	ref := GsExtractSuperclassRefactoring class: Object insertSuperclassNamed: 'GsESPet' inDictionary: nil.

	self assert: ref decline notNil.
	self assert: ref decline includesSubstring: 'no superclass'
]

{ #category : 'tests - apply' }
GsExtractSuperclassRefactoringTest >> testApplyIsAllOrNothingIgnoringDeselection [
	"Extract-superclass is all-or-nothing: a deselected id is ignored and the new class is still
	 created."
	(GsExtractSuperclassRefactoring class: (self classNamed: 'GsESDog') insertSuperclassNamed: 'GsESPet' inDictionary: nil)
		startPreviewToken: 'esTok' maxBytes: 100000.
	[GsExtractSuperclassRefactoring applyForToken: 'esTok' deselected: #('1' '2' '3')]
		ensure: [GsExtractSuperclassRefactoring clearToken: 'esTok'].

	self assert: (UserGlobals includesKey: #GsESPet)
]

{ #category : 'tests - apply' }
GsExtractSuperclassRefactoringTest >> testBuildingCompilesNothingAndDoesNotCommit [
	| before |
	before := System needsCommit.
	(GsExtractSuperclassRefactoring class: (self classNamed: 'GsESDog') insertSuperclassNamed: 'GsESPet' inDictionary: nil) changeSet.

	self deny: (UserGlobals includesKey: #GsESPet).
	self assert: System needsCommit equals: before
]

{ #category : 'tests - apply' }
GsExtractSuperclassRefactoringTest >> testApplyDoesNotCommit [
	| before |
	before := System needsCommit.
	(GsExtractSuperclassRefactoring class: (self classNamed: 'GsESDog') insertSuperclassNamed: 'GsESPet' inDictionary: nil)
		applyDeselected: #().

	self assert: System needsCommit equals: before
]

{ #category : 'tests - apply' }
GsExtractSuperclassRefactoringTest >> testApplyReportsNotCommitted [
	| json |
	json := (GsExtractSuperclassRefactoring class: (self classNamed: 'GsESDog') insertSuperclassNamed: 'GsESPet' inDictionary: nil)
		applyDeselected: #().

	self assert: json includesSubstring: '"committed":false'.
	self deny: json includesSubstring: '"failed":[{'
]

{ #category : 'tests - apply' }
GsExtractSuperclassRefactoringTest >> testApplyForTokenOnAnExpiredSessionAnswersAnError [
	self assert: (GsExtractSuperclassRefactoring applyForToken: 'nope' deselected: #())
		includesSubstring: 'expired'
]

{ #category : 'tests - apply' }
GsExtractSuperclassRefactoringTest >> testPageForTokenOnAnExpiredSessionAnswersAnError [
	self assert: (GsExtractSuperclassRefactoring pageForToken: 'nope' from: 1 maxBytes: 1000)
		includesSubstring: 'expired'
]

{ #category : 'tests - preview' }
GsExtractSuperclassRefactoringTest >> testAnalysisReportsDeclineAndNewClass [
	| ok bad |
	ok := GsExtractSuperclassRefactoring
		analyzeClass: (self classNamed: 'GsESDog') extractSuperclassNamed: 'GsESPet'
		siblings: #('GsESCat') hoistMethods: #(#eat) hoistInstVars: #().
	bad := GsExtractSuperclassRefactoring
		analyzeClass: (self classNamed: 'GsESDog') extractSuperclassNamed: 'GsESCat'
		siblings: #() hoistMethods: #() hoistInstVars: #().

	self assert: ok includesSubstring: '"decline":null'.
	self assert: ok includesSubstring: '"newClass":"GsESPet"'.
	self assert: ok includesSubstring: '"sharedParent":"GsESAnimal"'.
	self assert: bad includesSubstring: 'already exists'
]

{ #category : 'tests - preview' }
GsExtractSuperclassRefactoringTest >> testStartPreviewCarriesTotalsAndPage [
	| json |
	json := (GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #(#eat) hoistInstVars: #('name'))
		startPreviewToken: 'esTok2' maxBytes: 100000.
	[self assert: json includesSubstring: '"newClass":"GsESPet"'.
	 self assert: json includesSubstring: '"changes":'.
	 self assert: json includesSubstring: 'classAdd']
		ensure: [GsExtractSuperclassRefactoring clearToken: 'esTok2']
]

{ #category : 'tests - preview' }
GsExtractSuperclassRefactoringTest >> testCandidatesJsonCarriesClassifiedMembers [
	| json |
	json := GsExtractSuperclassRefactoring candidatesForClass: (self classNamed: 'GsESDog') siblings: #('GsESCat').

	self assert: json includesSubstring: '"selector":"eat"'.
	self assert: json includesSubstring: '"kind":"identical"'.
	self assert: json includesSubstring: '"kind":"divergent"'.
	self assert: json includesSubstring: '"name":"name"'
]
