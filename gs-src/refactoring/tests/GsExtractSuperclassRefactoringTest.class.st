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
GsESDog -> GsESPuppy -> GsESRunt (a two-deep subtree below the anchor):

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
	| animal dog cat puppy |
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
	puppy := dog
		subclass: 'GsESPuppy'
		instVarNames: #('cuteness')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	puppy
		subclass: 'GsESRunt'
		instVarNames: #('speckles')
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
	self compile: 'puppyM ^ 1' in: (self classNamed: 'GsESPuppy').
	self compile: 'runtM ^ 2' in: (self classNamed: 'GsESRunt')
]

{ #category : 'running' }
GsExtractSuperclassRefactoringTest >> tearDown [
	"children first (a class is removed before its superclass)"
	#('GsESRunt' 'GsESPuppy' 'GsESDog' 'GsESCat' 'GsESFish' 'GsESPet' 'GsESAnimal')
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

	self assert: json includesSubstring: '"failed":[]'.
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
GsExtractSuperclassRefactoringTest >> testInsertDeclinesWhenNameIsANonClassGlobal [
	"#379 hardening. classNamed: only matches a Class binding, so a name bound to a
	 NON-class global slipped past the precondition and applyClassAdd:'s
	 subclass:...inDictionary: silently rebound (clobbered) it. The objectNamed: guard
	 in computeAnalysis now declines any existing binding for the new name, with the
	 change set empty so nothing is created and the global is left intact."
	| ref |
	UserGlobals at: #GsESPet put: 42.
	[ref := GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog') insertSuperclassNamed: 'GsESPet' inDictionary: nil.

	 self assert: ref decline notNil.
	 "The decline names the symbol list, not the target dictionary: the question asked is
	  system-wide, so the message must not read as a collision in the class's own dictionary."
	 self assert: ref decline includesSubstring: 'already in use as a global on the symbol list'.
	 "A global decline empties the change set, so nothing is created."
	 self assert: ref changeSet changes isEmpty.
	 "the pre-existing non-class global is untouched"
	 self assert: (UserGlobals at: #GsESPet) equals: 42]
		ensure: [UserGlobals removeKey: #GsESPet ifAbsent: []]
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
GsExtractSuperclassRefactoringTest >> testExtractHoistsDivergentMethodAnchorVersionWins [
	"The design decision worth pinning: when the anchor and a sibling BOTH implement the selector
	 with DIFFERENT source, hoisting it keeps the ANCHOR's version and the sibling loses its own,
	 inheriting the anchor's behaviour. That is the outcome most likely to surprise someone, and
	 the one a future change is most likely to break silently. #describe is 'a dog' on GsESDog and
	 'a cat' on GsESCat."
	| json |
	json := (GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #(#describe) hoistInstVars: #())
		applyDeselected: #().

	self assert: json includesSubstring: '"failed":[]'.
	self assert: ((self classNamed: 'GsESPet') includesSelector: #describe).
	self deny: ((self classNamed: 'GsESDog') includesSelector: #describe).
	"The sibling's OWN divergent version is gone..."
	self deny: ((self classNamed: 'GsESCat') includesSelector: #describe).
	"...and it now answers the anchor's, not its own."
	self assert: (self classNamed: 'GsESCat') new describe equals: 'a dog'.
	self assert: (self classNamed: 'GsESDog') new describe equals: 'a dog'
]

{ #category : 'tests - V7 extract' }
GsExtractSuperclassRefactoringTest >> testExtractDeclinesHoistingAnIvarADescendantAlreadyOwns [
	"Hoisting puts the name on the NEW superclass, so every class under it inherits the name --
	 including the subtrees of the siblings being extracted. A class down there that already
	 declares the name would be re-versioned with a duplicate declaration, which GemStone rejects.

	 Note the reachable shape: it cannot be a descendant of the ANCHOR, because GemStone already
	 forbids a subclass from redeclaring an ivar its ancestor owns -- the fixture could not even be
	 built that way. It has to be a descendant of a SIBLING, owning an ivar that sibling does NOT
	 have but the anchor is hoisting. GsESDog owns 'bark'; GsESCat does not; so a subclass of
	 GsESCat may legally own 'bark' today, and hoisting 'bark' would collide with it.

	 Before the precondition existed, that collision surfaced from applyClassChange: PART-WAY
	 THROUGH the apply, leaving the new class created and some reparents done."
	| ref |
	(self classNamed: 'GsESCat')
		subclass: 'GsESKitten'
		instVarNames: #('bark')
		classVars: #() classInstVars: #() poolDictionaries: #()
		inDictionary: UserGlobals.
	[ref := GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #() hoistInstVars: #('bark').

	 self assert: ref decline notNil.
	 self assert: ref decline includesSubstring: 'GsESKitten'.
	 self assert: ref decline includesSubstring: 'already declares it'.
	 "A global decline empties the change set, so nothing is created."
	 self assert: ref changeSet changes isEmpty.
	 self deny: (UserGlobals includesKey: #GsESPet)]
		ensure: [UserGlobals removeKey: #GsESKitten ifAbsent: []]
]

{ #category : 'tests - V7 extract' }
GsExtractSuperclassRefactoringTest >> testExtractStillHoistsWhenOnlyTheSiblingOwnsTheIvar [
	"The guard must not over-reach: a SIBLING being extracted alongside the anchor is expected to
	 own the name too (that is the whole point -- it loses its copy and inherits the hoisted one),
	 so it must not be mistaken for a blocking descendant."
	| ref |
	ref := GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #() hoistInstVars: #('name').

	self assert: ref decline isNil
]

{ #category : 'tests - V7 extract' }
GsExtractSuperclassRefactoringTest >> testExtractHoistsIdenticalMethod [
	| json |
	json := (GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #(#eat) hoistInstVars: #())
		applyDeselected: #().

	self assert: json includesSubstring: '"failed":[]'.
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
GsExtractSuperclassRefactoringTest >> testExtractWithSiblingReparentsDeepSubtree [
	"With a sibling in the extracted set the apply stream interleaves classAdd, the Dog and Cat
	 edits and the Puppy + Runt reparents. The anchor's WHOLE descendant subtree, two deep
	 (GsESDog -> GsESPuppy -> GsESRunt), must reparent top-down onto each freshly-versioned
	 ancestor -- the grandchild onto the anchor's new version, the great-grandchild onto the
	 grandchild's -- keep its own methods, and inherit the hoisted selector all the way down."
	| json |
	json := (GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #(#eat) hoistInstVars: #())
		applyDeselected: #().

	self assert: json includesSubstring: '"failed":[]'.
	"depth 1: the grandchild reparents onto the anchor's new version"
	self assert: (self classNamed: 'GsESPuppy') superclass name asString equals: 'GsESDog'.
	self assert: ((self classNamed: 'GsESPuppy') includesSelector: #puppyM).
	"depth 2: the great-grandchild reparents onto the grandchild's new version (top-down ordering)"
	self assert: (self classNamed: 'GsESRunt') superclass name asString equals: 'GsESPuppy'.
	self assert: ((self classNamed: 'GsESRunt') includesSelector: #runtM).
	self assert: (self ownIvarsOf: 'GsESRunt') includes: 'speckles'.
	"the hoisted #eat lives on GsESPet and is understood all the way down to the great-grandchild"
	self assert: ((self classNamed: 'GsESPuppy') canUnderstand: #eat).
	self assert: ((self classNamed: 'GsESRunt') canUnderstand: #eat)
]

{ #category : 'tests - V7 extract' }
GsExtractSuperclassRefactoringTest >> testExtractHoistsIdenticalInstVar [
	| json |
	json := (GsExtractSuperclassRefactoring
		class: (self classNamed: 'GsESDog')
		extractSuperclassNamed: 'GsESPet' inDictionary: nil
		siblings: #('GsESCat') hoistMethods: #() hoistInstVars: #('name'))
		applyDeselected: #().

	self assert: json includesSubstring: '"failed":[]'.
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

	self assert: json includesSubstring: '"failed":[]'.
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

	self assert: json includesSubstring: '"failed":[]'.
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
	"assert a phrase unique to the super-send branch -- 'super' alone is a substring of the
	 selector #superGreet the reason echoes, so it would pass for ANY reason (a false pass)."
	self assert: (greet at: 3) includesSubstring: 'sends super'
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
	"'sends super', not 'super' -- the latter is a substring of the echoed selector #superGreet."
	self assert: ref decline includesSubstring: 'sends super'.
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

	self assert: (UserGlobals includesKey: #GsESPet).
	"...and the REPARENT survived the deselection too, which is the all-or-nothing property this
	 test is named for -- the new class existing only shows the first change went through."
	self assert: (self classNamed: 'GsESDog') superclass name asString equals: 'GsESPet'
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
	self assert: json includesSubstring: '"failed":[]'
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
