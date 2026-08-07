! Jasper Enhanced Inspector vendored source
! ----------------------------------------------------------------------------
! Origin : https://github.com/feenkcom/gt4gemstone
! Source : src-gs/Announcements.gs
! License: MIT - Copyright (c) feenk gmbh. See LICENSE in the origin repository.
!
! Vendored into Jasper and filed into the stone by the Enhanced Inspector
! installer. DO NOT EDIT BY HAND - regenerated from upstream by
! update_gemstone_gt_support.sh, which re-applies this header and rewrites
! class placement from Globals to the dedicated GsEnhancedInspector dictionary.
! ----------------------------------------------------------------------------
! Class Declarations
! Generated file, do not Edit

doit
(Error
	subclass: 'WeakBlockUnsupported'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone';
		immediateInvariant.
true.
%

removeallmethods WeakBlockUnsupported
removeallclassmethods WeakBlockUnsupported

doit
(Object
	subclass: 'Announcement'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone';
		comment: 'This class is the superclass for events that someone might want to announce, such as a button click or an attribute change. Typically you create subclasses for your own events you want to announce.';
		immediateInvariant.
true.
%

removeallmethods Announcement
removeallclassmethods Announcement

doit
(Announcement
	subclass: 'AnnouncementMockA'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone-Test';
		comment: 'This is a simple test mock.';
		immediateInvariant.
true.
%

removeallmethods AnnouncementMockA
removeallclassmethods AnnouncementMockA

doit
(Announcement
	subclass: 'AnnouncementMockB'
	instVarNames: #(parameter)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone-Test';
		comment: 'This is a simple test mock';
		immediateInvariant.
true.
%

removeallmethods AnnouncementMockB
removeallclassmethods AnnouncementMockB

doit
(AnnouncementMockB
	subclass: 'AnnouncementMockC'
	instVarNames: #(announcingCounter)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone-Test';
		comment: 'This is a simple test mock';
		immediateInvariant.
true.
%

removeallmethods AnnouncementMockC
removeallclassmethods AnnouncementMockC

doit
(Announcement
	subclass: 'AnnouncementMockD'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone-Test';
		immediateInvariant.
true.
%

removeallmethods AnnouncementMockD
removeallclassmethods AnnouncementMockD

doit
(Announcement
	subclass: 'GemToGemAnnouncement'
	instVarNames: #(signalMessage sessionSerialNum)
	classVars: #(RegisteredSessions Registry)
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone';
		immediateInvariant.
true.
%

removeallmethods GemToGemAnnouncement
removeallclassmethods GemToGemAnnouncement

doit
(Object
	subclass: 'AnnouncementSubscription'
	instVarNames: #(announcer announcementClass subscriber action)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone';
		comment: 'The subscription is a single entry in a SubscriptionRegistry.
Several subscriptions by the same object is possible.

I know how to make myself weak or strong, only use this capability if it can''t be determined at subscribe time though, as it uses become: (for thread-safety), which is quite slow.';
		immediateInvariant.
true.
%

removeallmethods AnnouncementSubscription
removeallclassmethods AnnouncementSubscription

doit
(Object
	subclass: 'Announcer'
	instVarNames: #(registry deliveryErrorHandler)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone';
		comment: 'The implementation uses a threadsafe subscription registry, in the sense that registering, unregistering, and announcing from an announcer at the same time in different threads should never cause failures.

GemStone adds a "delivery error handler" to catch errors during delivery of announcements.
The default handler invokes the default action for the exception.
The ignore handler ignores the error and simply returns from the #deliver: method.
The report to GCI handler bypasses any default action and immediately returns to the GCI.
A developer can specify a customer block, as desired.
Additionally, one can specify a custom handler around the #announce: message senf and automatically revert to the previous handler afterward.';
		immediateInvariant.
true.
%

removeallmethods Announcer
removeallclassmethods Announcer

doit
(Object
	subclass: 'AnnouncerSubscriberMockA'
	instVarNames: #(announcer)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone-Test';
		comment: 'I am a mock class for testing in announcers';
		immediateInvariant.
true.
%

removeallmethods AnnouncerSubscriberMockA
removeallclassmethods AnnouncerSubscriberMockA

doit
(AnnouncerSubscriberMockA
	subclass: 'AnnouncerSubscriberMockB'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone-Test';
		comment: 'I am a mock class for testing in announcers';
		immediateInvariant.
true.
%

removeallmethods AnnouncerSubscriberMockB
removeallclassmethods AnnouncerSubscriberMockB

doit
(Object
	subclass: 'MessageSend'
	instVarNames: #(receiver selector arguments)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone';
		immediateInvariant.
true.
%

removeallmethods MessageSend
removeallclassmethods MessageSend

doit
(Object
	subclass: 'SubscriptionRegistry'
	instVarNames: #(subscriptions monitor)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone';
		comment: 'The subscription registry is a threadsafe storage for the subscriptions to an Announcer.

In Pharo, subscriptionsFor: protocol is not implemented.
This is because Announcer does not provide public access to its registery for encapsulation reasons.
(We do not want access to the announcer from action blocks to break encapsulation to other subscribers)';
		immediateInvariant.
true.
%

removeallmethods SubscriptionRegistry
removeallclassmethods SubscriptionRegistry

doit
(Object
	subclass: 'WeakAnnouncementSubscription'
	instVarNames: #(receiver selector announcer announcementClass subscriber)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone';
		comment: 'The subscription is a single entry in a SubscriptionRegistry.
Several subscriptions by the same object is possible.

This subscription references the receiver weakly. If the receiver is garbage collected, the subscription is automatically removed from the SubscriptionRegistry. A MessageSend is dynamically generated to make ephemeron finalization easier.';
		immediateInvariant.
true.
%

removeallmethods WeakAnnouncementSubscription
removeallclassmethods WeakAnnouncementSubscription

doit
(Object
	subclass: 'WeakSubscriptionBuilder'
	instVarNames: #(announcer)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone';
		immediateInvariant.
true.
%

removeallmethods WeakSubscriptionBuilder
removeallclassmethods WeakSubscriptionBuilder

doit
(Set
	subclass: 'AnnouncementSet'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone';
		comment: 'If you want to register the same action for multiple events, simply create an AnnouncementSet using a comma: 

	Parent>>initialize 
	    super initialize. 
	    self session announcer on: AddChild, RemoveChild do: [:it | self changeChild: it child]
	
Motivation example: Often the UI is built after/independently from the model. You want to have the model raise fine-grained announcements to enable the layers on top, but sometimes it is easier in the UI to refresh everything whenever something happens.';
		immediateInvariant.
true.
%

removeallmethods AnnouncementSet
removeallclassmethods AnnouncementSet

doit
(TestCase
	subclass: 'AnnouncementSetTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone-Test';
		comment: 'SUnit tests for announcement sets';
		immediateInvariant.
true.
%

removeallmethods AnnouncementSetTest
removeallclassmethods AnnouncementSetTest

doit
(TestCase
	subclass: 'AnnouncerTest'
	instVarNames: #(announcer)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone-Test';
		comment: 'An AnnouncerTest is a test class used to test Announcer.

Instance Variables
	announcer:		<Announcer>  the announcer to test

announcer
	- the announcer that is tested
';
		immediateInvariant.
true.
%

removeallmethods AnnouncerTest
removeallclassmethods AnnouncerTest

doit
(AnnouncerTest
	subclass: 'WeakAnnouncerTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'Announcements-Core-GemStone-Test';
		comment: 'SUnit tests for weak announcements';
		immediateInvariant.
true.
%

removeallmethods WeakAnnouncerTest
removeallclassmethods WeakAnnouncerTest

! Class implementation for 'Announcement'

!		Class methods for 'Announcement'

category: 'public'
classmethod: Announcement
, anAnnouncementClass
	^ AnnouncementSet with: self with: anAnnouncementClass
%

category: 'public'
classmethod: Announcement
andSubclasses
	^ AnnouncementSet withAll: self withAllSubclasses
%

category: 'converting'
classmethod: Announcement
asAnnouncement
	^ self new
%

category: 'deprecated'
classmethod: Announcement
handles: anAnnouncement
	^ self handlesAnnouncement: anAnnouncement
%

category: 'testing'
classmethod: Announcement
handlesAnnouncement: anAnnouncement
	"The receiver acts as a filter to determine whether subscribers who used the receiver as signaling tag (event identifier class or symbol) should receive incoming announcement. In particular, registering to a superclass will receive the announcements from all subclasses."

	^ anAnnouncement isKindOf: self
%

category: 'instance creation'
classmethod: Announcement
new

	^super new
		initialize;
		yourself.
%

!		Instance methods for 'Announcement'

category: 'converting'
method: Announcement
asAnnouncement
	^ self
%

category: 'initialization'
method: Announcement
prepareForDelivery
	"This method will be executed once before subscriptions delivery.
	If nobody subscribed on me this method will not be called.
	It allows to put some heavy initialization logic here. It will be executed only 
	if there is interest on me"
%

! Class implementation for 'AnnouncementMockB'

!		Class methods for 'AnnouncementMockB'

category: 'instance creation'
classmethod: AnnouncementMockB
with: anObject
	^self new 
		parameter: anObject 
%

!		Instance methods for 'AnnouncementMockB'

category: 'accessing'
method: AnnouncementMockB
parameter
	^ parameter
%

category: 'accessing'
method: AnnouncementMockB
parameter: anObject
	parameter := anObject
%

! Class implementation for 'AnnouncementMockC'

!		Instance methods for 'AnnouncementMockC'

category: 'accessing'
method: AnnouncementMockC
announcingCounter
	^ announcingCounter
%

category: 'initialization'
method: AnnouncementMockC
initialize
	super initialize.
	announcingCounter := 0
%

category: 'initialization'
method: AnnouncementMockC
prepareForDelivery

	announcingCounter := announcingCounter + 1
%

! Class implementation for 'GemToGemAnnouncement'

!		Class methods for 'GemToGemAnnouncement'

category: 'accessing'
classmethod: GemToGemAnnouncement
announcer

	| ann |
	ann := SessionTemps current at: #GemToGemAnnouncement_Announcer otherwise: nil.
	ann == nil 
		ifTrue: [
			ann := Announcer new.
			SessionTemps current at: #GemToGemAnnouncement_Announcer put: ann].
	^ann
%

category: 'announcing'
classmethod: GemToGemAnnouncement
broadcast

	self new broadcast
%

category: 'announcing'
classmethod: GemToGemAnnouncement
broadcastMessage: aString

	(self new
		signalMessage: aString;
		yourself) broadcast
%

category: 'registration'
classmethod: GemToGemAnnouncement
cleanRegisteredSessions
	(self registeredSessions select: [ :each | ((System descriptionOfSessionSerialNum: each) at: 1) == nil ])
		do: [ :each | self registeredSessions remove: each ]
%

category: 'initialization'
classmethod: GemToGemAnnouncement
initialize
	"self initialize"
	
	RegisteredSessions := RcIdentityBag new: 100.
	Registry := Dictionary new.
	self allSubclasses do: [:cl | cl initialize].
%

category: 'announcing'
classmethod: GemToGemAnnouncement
installStaticHandler
  | handler |
  self registeredSessions add: GsCurrentSession currentSession serialNumber.
  handler := InterSessionSignal addDefaultHandler: [:ex |
     GemToGemAnnouncement signal: ex sentInt 
               message: ex sentMessage 
	      sessionSerialNum: ex sendingSession .
     System enableSignaledGemStoneSessionError .
     ex resume
  ].
  SessionTemps current at: #GemToGemStaticException put: handler.
  System enableSignaledGemStoneSessionError.
%

category: 'accessing'
classmethod: GemToGemAnnouncement
registeredSessions
	
	RegisteredSessions == nil ifTrue: [ RegisteredSessions := RcIdentityBag new: 100 ].
	^RegisteredSessions
%

category: 'registration'
classmethod: GemToGemAnnouncement
registerForGemToGemSignalling

	self registry at: self signalNumber put: self
%

category: 'accessing'
classmethod: GemToGemAnnouncement
registry

	Registry == nil ifTrue: [ Registry := Dictionary new ].
	^Registry
%

category: 'instance creation'
classmethod: GemToGemAnnouncement
signal: aSignal message: aString sessionSerialNum: aSerialNumber

	| cl  |
	cl := self registry at: aSignal ifAbsent: [ ^self ].
	self announcer announce: (cl new
		signalMessage: aString;
		sessionSerialNum: aSerialNumber;
		yourself)
%

category: 'constants'
classmethod: GemToGemAnnouncement
signalNumber

	^0
%

category: 'testing'
classmethod: GemToGemAnnouncement
staticHandlerInstalled

	^(SessionTemps current at: #GemToGemStaticException otherwise: nil) ~~ nil
%

category: 'announcing'
classmethod: GemToGemAnnouncement
uninstallStaticHandler

  | handler |
  self registeredSessions removeIfPresent: GsCurrentSession currentSession serialNumber.
  handler := SessionTemps current at: #GemToGemStaticException otherwise: nil.
  System disableSignaledGemStoneSessionError.
  handler ifNotNil: [ Exception removeStaticException: handler ].
%

!		Instance methods for 'GemToGemAnnouncement'

category: 'signalling'
method: GemToGemAnnouncement
broadcast

	| badSerialNumbers |
	badSerialNumbers := Array new.
	self registeredSessions do: [:aSessionSerialNumber |
		[System _sendSignal: self signalNumber toSess: aSessionSerialNumber withMessage: self signalMessage]
			on: Error
			do: [:ex | 
				"Gem is no longer around or no longer listening"
				badSerialNumbers add: aSessionSerialNumber.
				ex return]].
	self registeredSessions removeAll: badSerialNumbers
%

category: 'accessing'
method: GemToGemAnnouncement
registeredSessions

	^self class registeredSessions
%

category: 'signalling'
method: GemToGemAnnouncement
replyToSenderWithSignal: aSignalNumber message: aString

	System 
		_sendSignal: aSignalNumber 
		toSess: sessionSerialNum 
		withMessage: aString
%

category: 'accessing'
method: GemToGemAnnouncement
sessionSerialNum

	^sessionSerialNum
%

category: 'accessing'
method: GemToGemAnnouncement
sessionSerialNum: aSerialNumber

	sessionSerialNum := aSerialNumber
%

category: 'accessing'
method: GemToGemAnnouncement
signalMessage

	signalMessage == nil ifTrue: [ signalMessage := '' ].
	^signalMessage
%

category: 'accessing'
method: GemToGemAnnouncement
signalMessage: aString

	aString size > 1023 ifTrue: [self error: 'message too large for Gem to Gem Signalling'].
	signalMessage := aString
%

category: 'accessing'
method: GemToGemAnnouncement
signalNumber

	^self class signalNumber
%

! Class implementation for 'AnnouncementSubscription'

!		Instance methods for 'AnnouncementSubscription'

category: 'accessing'
method: AnnouncementSubscription
action

	^ action
%

category: 'accessing'
method: AnnouncementSubscription
action: anObject

	action := anObject
%

category: 'accessing'
method: AnnouncementSubscription
announcementClass

	^ announcementClass
%

category: 'accessing'
method: AnnouncementSubscription
announcementClass: anObject

	announcementClass := anObject
%

category: 'accessing'
method: AnnouncementSubscription
announcer

	^ announcer
%

category: 'accessing'
method: AnnouncementSubscription
announcer: anAnnouncer
	announcer := anAnnouncer
%

category: 'announcing'
method: AnnouncementSubscription
deliver: anAnnouncement
	" deliver an announcement to receiver. In case of failure, it will be handled in separate process"

	^ (self handlesAnnouncement: anAnnouncement ) ifTrue: [
		[action cull: anAnnouncement cull: announcer] 
"Pharo has:
			on: UnhandledError fork: [:ex | ex pass ]]
GemStone has:
"			on: Error
			do: announcer deliveryErrorHandler]
%

category: 'testing'
method: AnnouncementSubscription
handlesAnnouncement: anAnnouncement

	^ announcementClass handlesAnnouncement: anAnnouncement
%

category: 'converting'
method: AnnouncementSubscription
makeStrong
	"This subscription is already strong."

	^self
%

category: 'converting'
method: AnnouncementSubscription
makeWeak
	"Convert to a WeakAnnouncementSubscription."

	| newSub |
	(action isKindOf: BlockClosure) ifTrue: [WeakBlockUnsupported signal].
	newSub := WeakAnnouncementSubscription
		announcer: announcer
		announcementClass: announcementClass
		receiver: action receiver
		selector: action selector.
	^announcer
		replace: self
		with: newSub
%

category: 'accessing'
method: AnnouncementSubscription
subscriber
	^ subscriber
%

category: 'accessing'
method: AnnouncementSubscription
subscriber: aSubscriber
	subscriber := aSubscriber
%

category: 'accessing'
method: AnnouncementSubscription
valuable: aValuable
	"Used when subscriber should be extracted from valuable object"
	self action:  aValuable.
	self subscriber: aValuable receiver.
%

! Class implementation for 'Announcer'

!		Class methods for 'Announcer'

category: 'instance creation'
classmethod: Announcer
new

	^super new
		initialize;
		yourself.
%

!		Instance methods for 'Announcer'

category: 'announce'
method: Announcer
announce: anAnnouncement

	| announcement |
	announcement := anAnnouncement asAnnouncement.	
	registry ifNotNil: [
		registry deliver: announcement
		].
	^ announcement
%

category: 'private'
method: Announcer
basicSubscribe: subscription
	^ registry add: subscription
%

category: 'exception handling'
method: Announcer
defaultDeliveryErrors
	self deliveryErrorHandler: [ :ex | ex defaultAction ]
%

category: 'exception handling'
method: Announcer
deliveryErrorHandler
	"Answer the one argument block exception handler to be 
	 used when delivering announcements encounters an error.
	 The argument to the block will be the exception that
	 was thrown (Error or a subclass of it)."

	^ deliveryErrorHandler
%

category: 'exception handling'
method: Announcer
deliveryErrorHandler: aOneArgBlock
	"Set the exception handler to be used when delivering
	 announcements encounters an error.
	 The argument to the block will be the exception that
	 was thrown (Error or a subclass of it)."

	deliveryErrorHandler := aOneArgBlock
%

category: 'exception handling'
method: Announcer
during: aBlock handleDeliveryErrorsUsing: anExceptionHandler
	| savedHandler |
	savedHandler := self deliveryErrorHandler.
	self deliveryErrorHandler: anExceptionHandler.
	^ aBlock
		ensure: [ self deliveryErrorHandler: savedHandler ]
%

category: 'testing'
method: Announcer
handleSubscriberClass: eventClass
	^ self subscriptions 
		ifNil: [ false ]
		ifNotNil: [:subscriptions | subscriptions handleSubscriberClass: eventClass]
%

category: 'testing'
method: Announcer
hasSubscriber: anObject

	registry subscriptionsOf: anObject do: [:each | ^ true].
	^ false
%

category: 'exception handling'
method: Announcer
ignoreDeliveryErrors
	self deliveryErrorHandler: [ :ex | ex return ]
%

category: 'initialization'
method: Announcer
initialize
	super initialize.
	registry := SubscriptionRegistry new.
	self defaultDeliveryErrors.
%

category: 'statistics'
method: Announcer
numberOfSubscriptions
	^ registry numberOfSubscriptions
%

category: 'subscription'
method: Announcer
removeSubscription: subscription
	"Remove the given subscription from the receiver"
	
	^ registry remove: subscription
%

category: 'private'
method: Announcer
replace: subscription with: newOne
	^ registry replace: subscription with: newOne
%

category: 'exception handling'
method: Announcer
reportToGciOnDeliveryErrors
	self deliveryErrorHandler: [ :ex | ex _signalGciError ]
%

category: 'accessing'
method: Announcer
subscriptions

	^ registry
%

category: 'accessing'
method: Announcer
subscriptionsForClass: subscriberClass
	"Return the list of subscription for a given class"
	^ self subscriptions subscriptionsForClass: subscriberClass
%

category: 'subscription'
method: Announcer
unsubscribe: anObject
	"Unsubscribe all subscriptions of anObject from the receiver"
	
	registry removeSubscriber: anObject
%

category: 'accessing'
method: Announcer
weak
	"Return an object which allows the creation of weak subscriptions"

	^WeakSubscriptionBuilder on: self
%

category: 'registration api'
method: Announcer
when: anAnnouncementClass do: aValuable
	"Declare that when anAnnouncementClass is raised, aValuable is executed.  Pay attention that such method as well as #when:do: should not be used on weak announcer since the block holds the receiver and more strongly."
	
	aValuable hasReceiver ifFalse: [self error: 'Cannot determine aValuable''s subscriber. Use #when:do:for:, instead.'].
	^ self when: anAnnouncementClass do: aValuable for: aValuable receiver
%

category: 'subscription'
method: Announcer
when: anAnnouncementClass do: aValuable for: aSubscriber
	"Declare that when anAnnouncementClass is raised, aValuable is executed and define the subscriber."
	
	^ registry add: (
		AnnouncementSubscription new 
			announcer: self;
			announcementClass: anAnnouncementClass;
			valuable: aValuable;
			subscriber: aSubscriber;
			yourself)
%

category: 'registration api'
method: Announcer
when: anAnnouncementClass send: aSelector to: anObject
	"Declare that when anAnnouncementClass is raised, anObject should receive the message aSelector.
    When the message expects one argument (eg #fooAnnouncement:) the announcement is passed as argument.
    When the message expects two arguments (eg #fooAnnouncement:announcer:) both the announcement and 
    the announcer are passed as argument"

	^ self
		when: anAnnouncementClass
		do: (MessageSend receiver: anObject selector: aSelector)
%

! Class implementation for 'AnnouncerSubscriberMockA'

!		Instance methods for 'AnnouncerSubscriberMockA'

category: 'accessing'
method: AnnouncerSubscriberMockA
announcer
	^ announcer
%

category: 'accessing'
method: AnnouncerSubscriberMockA
announcer: anAnnouncer
	announcer := anAnnouncer
%

category: 'events'
method: AnnouncerSubscriberMockA
registerEvents
	self announcer when: AnnouncementMockA do: [ :evt | " something" ] for: self "GemStone can't identiy this block's receiver".
%

! Class implementation for 'MessageSend'

!		Class methods for 'MessageSend'

category: 'instance creation'
classmethod: MessageSend
message: aMessage to: anObject
	^ self
		receiver: anObject
		selector: aMessage selector
		arguments: aMessage arguments
%

category: 'instance creation'
classmethod: MessageSend
receiver: anObject selector: aSymbol
	^ self receiver: anObject selector: aSymbol arguments: #()
%

category: 'instance creation'
classmethod: MessageSend
receiver: anObject selector: aSymbol argument: aParameter
	^ self receiver: anObject selector: aSymbol arguments: (Array with: aParameter)
%

category: 'instance creation'
classmethod: MessageSend
receiver: anObject selector: aSymbol arguments: anArray
	^ self new
		receiver: anObject;
		selector: aSymbol;
		arguments: anArray
%

!		Instance methods for 'MessageSend'

category: 'comparing'
method: MessageSend
= anObject
	^ anObject species == self species 
		and: [receiver == anObject receiver
		and: [selector == anObject selector
		and: [arguments = anObject arguments]]]
%

category: 'accessing'
method: MessageSend
arguments
	^ arguments
%

category: 'accessing'
method: MessageSend
arguments: anArray
	arguments := anArray
%

category: 'private'
method: MessageSend
collectArguments: anArgArray
	"Private"

	| staticArgs |
	staticArgs := self arguments.
	^ anArgArray size = staticArgs size
		ifTrue: [ anArgArray ]
		ifFalse: [ 
			(staticArgs isEmpty
				ifTrue: [ staticArgs := Array new: selector numArgs ]
				ifFalse: [ staticArgs copy ])
				replaceFrom: 1
				to: (anArgArray size min: staticArgs size)
				with: anArgArray
				startingAt: 1 ]
%

category: 'evaluating'
method: MessageSend
cull: arg
	^ selector numArgs = 0
		ifTrue: [ self value ]
		ifFalse: [ self value: arg ]
%

category: 'evaluating'
method: MessageSend
cull: arg1 cull: arg2
	^ selector numArgs < 2
		ifTrue: [ self cull: arg1 ]
		ifFalse: [ self value: arg1 value: arg2 ]
%

category: 'evaluating'
method: MessageSend
cull: arg1 cull: arg2 cull: arg3
	^ selector numArgs < 3
		ifTrue: [ self cull: arg1 cull: arg2 ]
		ifFalse: [ self value: arg1 value: arg2 value: arg3 ]
%

category: 'comparing'
method: MessageSend
hash
	^ receiver hash bitXor: selector hash
%

category: 'testing'
method: MessageSend
hasReceiver

	^true
%

category: 'testing'
method: MessageSend
isMessageSend
	^true
%

category: 'testing'
method: MessageSend
isValid
	^true
%

category: 'accessing'
method: MessageSend
message
	^ Message selector: selector arguments: arguments
%

category: 'accessing'
method: MessageSend
numArgs
	"Answer the number of arguments in this message"

	^ arguments size
%

category: 'printing'
method: MessageSend
printOn: aStream
	aStream
		nextPutAll: self class name;
		nextPut: $(;
		print: selector;
		nextPutAll: ' -> ';
		print: receiver;
		nextPut: $)
%

category: 'accessing'
method: MessageSend
receiver
	^ receiver
%

category: 'accessing'
method: MessageSend
receiver: anObject
	receiver := anObject
%

category: 'accessing'
method: MessageSend
selector
	^ selector
%

category: 'accessing'
method: MessageSend
selector: aSymbol
	selector := aSymbol
%

category: 'evaluating'
method: MessageSend
value
	"Send the message and answer the return value"

	arguments ifNil: [ ^ receiver perform: selector ].

	^ receiver perform: selector withArguments: (self collectArguments: arguments)
%

category: 'evaluating'
method: MessageSend
value: anObject
	^ receiver perform: selector with: anObject
%

category: 'evaluating'
method: MessageSend
value: anObject1 value: anObject2
	^ receiver perform: selector with: anObject1 with: anObject2
%

category: 'evaluating'
method: MessageSend
value: anObject1 value: anObject2 value: anObject3
	^ receiver
		perform: selector
		with: anObject1
		with: anObject2
		with: anObject3
%

category: 'evaluating'
method: MessageSend
valueWithArguments: anArray
	^ receiver perform: selector withArguments: (self collectArguments: anArray)
%

category: 'evaluating'
method: MessageSend
valueWithEnoughArguments: anArray
	"call the selector with enough arguments from arguments and anArray"

	| args |
	args := Array new: selector numArgs.
	args
		replaceFrom: 1
		to: (arguments size min: args size)
		with: arguments
		startingAt: 1.
	args size > arguments size
		ifTrue: [ 
			args
				replaceFrom: arguments size + 1
				to: (arguments size + anArray size min: args size)
				with: anArray
				startingAt: 1 ].
	^ receiver perform: selector withArguments: args
%

! Class implementation for 'SubscriptionRegistry'

!		Class methods for 'SubscriptionRegistry'

category: 'instance creation'
classmethod: SubscriptionRegistry
new

	^super new
		initialize;
		yourself.
%

!		Instance methods for 'SubscriptionRegistry'

category: 'add/remove'
method: SubscriptionRegistry
add: subscription
	^ self protected: [
		subscriptions add: subscription  ]
%

category: 'announcing'
method: SubscriptionRegistry
deliver: anAnnouncement
	|  interestedSubscriptions |
	"using a copy, so subscribers can unsubscribe from announcer "
	
	subscriptions isEmpty ifTrue: [ ^ self ].
	self protected: [ 
		interestedSubscriptions := self subscriptionsHandling: anAnnouncement ].
	interestedSubscriptions isEmpty ifTrue: [ ^self ].
	
	anAnnouncement prepareForDelivery.
	self deliver: anAnnouncement to: interestedSubscriptions
%

category: 'private'
method: SubscriptionRegistry
deliver: anAnnouncement to: subs
	^ self deliver: anAnnouncement to: subs startingAt: 1
%

category: 'private'
method: SubscriptionRegistry
deliver: anAnnouncement to: subs startingAt: startIndex
	
	startIndex to: subs size do: [ :index| | subscription |
		subscription := subs at: index.
		[ subscription deliver: anAnnouncement ] 
			"Ensure delivery to remaining announcements"
			ifCurtailed: [
				self deliver: anAnnouncement to: subs startingAt: index + 1 ]]
%

category: 'testing'
method: SubscriptionRegistry
handleSubscriberClass: eventClass
	"Return true if the receiver has a callback subscribed for the event class"

	^ subscriptions anySatisfy: [ :sub | sub subscriber isKindOf: eventClass ]
%

category: 'initialization'
method: SubscriptionRegistry
initialize
	monitor := Semaphore forMutualExclusion.
	self reset
%

category: 'accessing'
method: SubscriptionRegistry
numberOfSubscriptions
	^ subscriptions size
%

category: 'private'
method: SubscriptionRegistry
protected: aBlock
	^ monitor critical: [ aBlock value ]
%

category: 'add/remove'
method: SubscriptionRegistry
remove: subscription
	^ self protected: [
		subscriptions remove: subscription ifAbsent: nil ]

%

category: 'add/remove'
method: SubscriptionRegistry
removeSubscriber: subscriber
	
	^ self protected: [
		subscriptions removeAllSuchThat: [:subscription | subscription subscriber == subscriber ]]

%

category: 'add/remove'
method: SubscriptionRegistry
replace: subscription with: newOne

	" Note that it will signal an error if subscription is not there "
	self protected: [
		subscriptions remove: subscription.
		subscriptions add: newOne 
	].
	^ newOne
%

category: 'initialization'
method: SubscriptionRegistry
reset
	"subscriber -> subscriptions"
	
	subscriptions := IdentitySet new
	


%

category: 'accessing'
method: SubscriptionRegistry
subscriptions
	^ subscriptions
%

category: 'accessing'
method: SubscriptionRegistry
subscriptionsForClass: subscriberClass
	"Return the list of subscription for a given class"

	^ Array
		streamContents: [ :s | 
			subscriptions
				do: [ :each | 
					(each subscriber isKindOf: subscriberClass)
						ifTrue: [ s nextPut: each subscriber ] ] ]
%

category: 'accessing'
method: SubscriptionRegistry
subscriptionsHandling: anAnnouncement
	^ Array streamContents: [ :s|
			subscriptions do: [:each| 
				(each handlesAnnouncement: anAnnouncement)
					ifTrue: [ s nextPut: each ]]]
%

category: 'iterating'
method: SubscriptionRegistry
subscriptionsOf: aSubscriber do: aBlock
	| copy |
	
	self protected: [ copy := subscriptions copy ].
	
	copy do: 
		[:subscription | 
			subscription subscriber == aSubscriber 
				ifTrue: [ aBlock value: subscription ]	]
%

! Class implementation for 'WeakAnnouncementSubscription'

!		Class methods for 'WeakAnnouncementSubscription'

category: 'instance creation'
classmethod: WeakAnnouncementSubscription
announcer: anAnnouncer
announcementClass: anAnnouncementClass
receiver: anObject
selector: aSelector

	^self new
		receiver: anObject;
		selector: aSelector;
		announcer: anAnnouncer;
		announcementClass: anAnnouncementClass;
		beEphemeron: true;
		yourself
%

!		Instance methods for 'WeakAnnouncementSubscription'

category: 'accessing'
method: WeakAnnouncementSubscription
action

	^MessageSend
		receiver: receiver
		selector: selector
%

category: 'accessing'
method: WeakAnnouncementSubscription
announcementClass

	^announcementClass
%

category: 'accessing'
method: WeakAnnouncementSubscription
announcementClass: anAnnouncementClass

	announcementClass := anAnnouncementClass
%

category: 'accessing'
method: WeakAnnouncementSubscription
announcer

	^announcer
%

category: 'accessing'
method: WeakAnnouncementSubscription
announcer: anAnnouncer

	announcer := anAnnouncer
%

category: 'announcing'
method: WeakAnnouncementSubscription
deliver: anAnnouncement

	^ (self handlesAnnouncement: anAnnouncement ) ifTrue: [
		[self action cull: anAnnouncement cull: announcer] 
"Pharo has:
			on: UnhandledError fork: [:ex | ex pass ]]
GemStone has:
"			on: Error
			do: announcer deliveryErrorHandler]
%

category: 'testing'
method: WeakAnnouncementSubscription
handlesAnnouncement: anAnnouncement

	^ announcementClass handlesAnnouncement: anAnnouncement
%

category: 'converting'
method: WeakAnnouncementSubscription
makeStrong

	| newSub |
	newSub := AnnouncementSubscription new
		announcer: announcer;
		announcementClass: announcementClass;
		valuable: self action;
		subscriber: receiver;
		yourself.
	self beEphemeron: false.
	^announcer
		replace: self
		with: newSub
%

category: 'converting'
method: WeakAnnouncementSubscription
makeWeak
	"This subscription is already weak."

	^self
%

category: 'finalizing'
method: WeakAnnouncementSubscription
mourn

	announcer removeSubscription: self
%

category: 'accessing'
method: WeakAnnouncementSubscription
receiver: anObject

	receiver := anObject
%

category: 'accessing'
method: WeakAnnouncementSubscription
selector: aSelector

	selector := aSelector
%

category: 'accessing'
method: WeakAnnouncementSubscription
subscriber

	^receiver
%

category: 'accessing'
method: WeakAnnouncementSubscription
subscriber: anObject

	receiver := anObject
%

! Class implementation for 'WeakSubscriptionBuilder'

!		Class methods for 'WeakSubscriptionBuilder'

category: 'instance creation'
classmethod: WeakSubscriptionBuilder
on: anAnnouncer

	^super new
		announcer: anAnnouncer;
		yourself
%

!		Instance methods for 'WeakSubscriptionBuilder'

category: 'accessing'
method: WeakSubscriptionBuilder
announcer: anAnnouncer

	announcer := anAnnouncer
%

category: 'accessing'
method: WeakSubscriptionBuilder
weak
	"This already handles the creation of weak registrations."

	^self
%

category: 'registration'
method: WeakSubscriptionBuilder
when: anAnnouncementClass
send: aSelector
to: anObject

	| subscription |
	(anObject isKindOf: BlockClosure)
		ifTrue: [WeakBlockUnsupported signal].
	subscription := WeakAnnouncementSubscription
		announcer: announcer
		announcementClass: anAnnouncementClass
		receiver: anObject
		selector: aSelector.
	^announcer basicSubscribe: subscription
%

! Class implementation for 'AnnouncementSet'

!		Instance methods for 'AnnouncementSet'

category: 'adding'
method: AnnouncementSet
, anAnnouncementClass
	self add: anAnnouncementClass
%

category: 'deprecated'
method: AnnouncementSet
handles: anAnnouncement
	^ self handlesAnnouncement: anAnnouncement
%

category: 'testing'
method: AnnouncementSet
handlesAnnouncement: anAnnouncement
	"If any of the set handles the announcements, subscribers should receive it."
	^ self anySatisfy: [ :each | each handlesAnnouncement: anAnnouncement ]
%

! Class implementation for 'AnnouncementSetTest'

!		Instance methods for 'AnnouncementSetTest'

category: 'tests'
method: AnnouncementSetTest
testIncludeOnlyOnce
	| set |
	set := AnnouncementMockA , AnnouncementMockB , AnnouncementMockA.
	self assert: set size equals: 2
%

category: 'tests'
method: AnnouncementSetTest
testInstanceCreation
	| set |
	set := AnnouncementMockA , AnnouncementMockB.
	self assert: set size equals: 2
%

! Class implementation for 'AnnouncerTest'

!		Instance methods for 'AnnouncerTest'

category: 'private'
method: AnnouncerTest
newAnnouncer
	^ Announcer new
%

category: 'running'
method: AnnouncerTest
setUp
	super setUp.
	announcer := self newAnnouncer
%

category: 'tests - subscribers'
method: AnnouncerTest
testAccessingSubscribers
	| subscribers |
	subscribers := announcer subscriptionsForClass: self class.
	self assert: subscribers size equals: 0.
	
	announcer
		when: AnnouncementMockA
		do: [ "1" ]
		for: self "GemStone can't identiy this block's receiver".
	announcer
		when: AnnouncementMockB
		do: [ "2" ]
		for: self "GemStone can't identiy this block's receiver".
	subscribers := announcer subscriptionsForClass: self class.
	self assert: subscribers size equals: 2.
	
	subscribers do: [ :subscriber |	announcer unsubscribe: subscriber ].
	
	subscribers := announcer subscriptionsForClass: self class.
	self assert: subscribers size equals: 0.
	
%

category: 'tests'
method: AnnouncerTest
testAnnounceClass
	self assert: (announcer announce: AnnouncementMockA) class equals: AnnouncementMockA
%

category: 'tests'
method: AnnouncerTest
testAnnounceInstance
	| instance |
	instance := AnnouncementMockA new.
	self assert: (announcer announce: instance) equals: instance
%

category: 'tests - subscribing'
method: AnnouncerTest
testAnnounceWorkWithinExceptionHandlerBlocks
	|  found |
	
	announcer when: Announcement do: [ found := true ].
	
	[ "NotFound" Error signal ]
		on: "NotFound" Error
		do: [ announcer announce: Announcement new ].
		
	self assert: found
%

category: 'tests'
method: AnnouncerTest
testAnnouncingReentrant
	"Test that it is safe to announce when handling announcement,
	so announcer are reentrant"
 
	| bool ok |

	ok := bool := false.
	announcer when: Announcement do: [
		bool ifFalse: [
			bool := true.
			announcer announce:  Announcement new. ]
		ifTrue: [ ok := true ] 
	].

	self should: [ announcer announce: Announcement new. ] notTakeMoreThan: (Duration seconds: 1).
	self assert: ok

%

category: 'tests - subscribers'
method: AnnouncerTest
testHandleSubscriberClass
	announcer
		when: AnnouncementMockA
		do: [  ]
		for: self "GemStone can't identiy this block's receiver".
	self assert: (announcer handleSubscriberClass: self class).
	self deny: (announcer handleSubscriberClass: AnnouncementMockA).
%

category: 'tests'
method: AnnouncerTest
testIssue253
	"unsubscribe during announcement ... hard to duplicate problem since we're using an IdentityDictionary 
	 and collistionbucket density is a function of oop density"
	
	| block |
	block := [ :ann | announcer unsubscribe: block ].
	announcer
		when: AnnouncementMockA
			send: #value:
			to: block;
		when: AnnouncementMockB
			send: #value:
			to: block;
		when: AnnouncementMockC
			send: #value:
			to: block;
		when: AnnouncementMockD
			send: #value:
			to: block;
		yourself.
		
	announcer announce: AnnouncementMockA.
%

category: 'tests'
method: AnnouncerTest
testNoArgBlock
	"we are supposed to accept zero-argument blocks as actions "

	| counter |
	counter := nil.
	announcer
		when: AnnouncementMockA
		do: [ counter := 1 ]
		for: self "GemStone can't identiy this block's receiver".
	announcer announce: AnnouncementMockA new.
	self assert: counter equals: 1
%

category: 'tests'
method: AnnouncerTest
testPreparationAnnouncementDelivery
	| announcement |
	
	announcer when: AnnouncementMockC send: #value: to: [ :ann | #firstBlock ].
	announcer when: AnnouncementMockC send: #value: to: [ :ann | #lastBlock ].	
		
	announcement := AnnouncementMockC new.
	announcer announce: announcement.
	self assert: announcement announcingCounter equals: 1.
	announcer announce: announcement.
	self assert: announcement announcingCounter equals: 2.
	announcement := announcer announce: AnnouncementMockC.
	self assert: announcement announcingCounter equals: 1

%

category: 'tests'
method: AnnouncerTest
testPreparationAnnouncementDeliveryWhenNoSubscriptions

	| instance |
	announcer when: AnnouncementMockA send: #value: to: [ :ann | ].
		
	instance := announcer announce: AnnouncementMockC.
	
	self assert: instance announcingCounter equals: 0
%

category: 'tests - subscribing'
method: AnnouncerTest
testSubscribeBlock
	| announcement instance |
	announcer
		when: AnnouncementMockA
		do: [ :ann | announcement := ann ]
		for: self "GemStone can't identiy this block's receiver".
	announcement := nil.
	instance := announcer announce: AnnouncementMockA.
	self assert: announcement equals: instance.
	announcement := nil.
	instance := announcer announce: AnnouncementMockB.
	self assert: announcement isNil
%

category: 'test - subscribers'
method: AnnouncerTest
testSubscribersForClass
	| subscribers mockA mockB |
	self assert: announcer numberOfSubscriptions equals: 0.
	
	mockA := AnnouncerSubscriberMockA new.
	mockA announcer: announcer.
	mockB := AnnouncerSubscriberMockB new.
	mockB announcer: announcer.
	mockA registerEvents.
	mockB registerEvents.
	
	self assert: announcer numberOfSubscriptions > 0.
	subscribers := announcer subscriptionsForClass: AnnouncerSubscriberMockA.
	self assert: subscribers size equals: 2.
	"AnnouncerSubscriberMockB inherits AnnouncerSubscriberMockA"
	subscribers := announcer subscriptionsForClass: AnnouncerSubscriberMockB.
	self assert: subscribers size equals: 1.
	subscribers := announcer subscriptionsForClass: self class.
	self assert: subscribers size equals: 0.
%

category: 'tests - subscribing'
method: AnnouncerTest
testSubscribeSend
	| announcement instance |
	announcer when: AnnouncementMockA send: #value: to: [ :ann | announcement := ann ].
		
	announcement := nil.
	instance := announcer announce: AnnouncementMockA.
	self assert: announcement equals: instance.
	
	announcement := nil.
	instance := announcer announce: AnnouncementMockB new.
	self assert: announcement isNil
%

category: 'tests - subscribing'
method: AnnouncerTest
testSubscribeSet
	| announcement instance |
	announcer
		when: AnnouncementMockA , AnnouncementMockC
		do: [ :ann | announcement := ann ]
		for: self "GemStone can't identiy this block's receiver".
	announcement := nil.
	instance := announcer announce: AnnouncementMockA.
	self assert: announcement equals: instance.
	announcement := nil.
	instance := announcer announce: AnnouncementMockB.
	self assert: announcement isNil.
	announcement := nil.
	instance := announcer announce: AnnouncementMockC.
	self assert: announcement equals: instance
%

category: 'tests - subscribing'
method: AnnouncerTest
testSubscribeSubclass
	| announcement instance |
	announcer
		when: AnnouncementMockB
		do: [ :ann | announcement := ann ]
		for: self "GemStone can't identiy this block's receiver".
	announcement := nil.
	instance := announcer announce: AnnouncementMockA.
	self assert: announcement isNil.
	announcement := nil.
	instance := announcer announce: AnnouncementMockB.
	self assert: announcement equals: instance.
	announcement := nil.
	instance := announcer announce: AnnouncementMockC.
	self assert: announcement equals: instance
%

category: 'tests'
method: AnnouncerTest
testTwoArgBlock
	"we are supposed to accept two-argument blocks as actions "

	| flag |
	flag := false.
	announcer
		when: AnnouncementMockA
		do: [ :ann :announcer2 | flag := announcer2 == announcer ].
	announcer announce: AnnouncementMockA new.
	self assert: flag
%

category: 'tests - unsubscribing'
method: AnnouncerTest
testUnsubscribeBlock
	| announcement |
	announcer
		when: AnnouncementMockA
		do: [ :ann | announcement := ann ]
		for: self "GemStone can't identiy this block's receiver".
	announcer unsubscribe: self.
	announcement := nil.
	announcer announce: AnnouncementMockA new.
	self assert: announcement isNil
%

category: 'tests - unsubscribing'
method: AnnouncerTest
testUnsubscribeSend
	| announcement receiver |
	announcer when: AnnouncementMockA send: #value: to: (receiver := [ :ann | announcement := ann ]).
	announcer unsubscribe: receiver.

	announcement := nil.
	announcer announce: AnnouncementMockA new.
	self assert: announcement isNil
%

category: 'tests - unsubscribing'
method: AnnouncerTest
testUnsubscribeSet
	| announcement |
	announcer
		when: AnnouncementMockA , AnnouncementMockB
		do: [ :ann | announcement := ann ]
		for: self "GemStone can't identiy this block's receiver".
	announcer unsubscribe: self.
	announcement := nil.
	announcer announce: AnnouncementMockA new.
	self assert: announcement isNil.
	announcement := nil.
	announcer announce: AnnouncementMockB new.
	self assert: announcement isNil
%

! Class implementation for 'WeakAnnouncerTest'

!		Instance methods for 'WeakAnnouncerTest'

category: 'asserting'
method: WeakAnnouncerTest
assert: anObject
identicalTo: bObject

	^self assert: anObject == bObject
%

category: 'utilities'
method: WeakAnnouncerTest
maximumReclamation

	System _generationScavenge_vmMarkSweep.
	System _generationScavenge_vmMarkSweep.
	(Delay forMilliseconds: 10) wait.
%

category: 'tests'
method: WeakAnnouncerTest
testMakeStrong

	| counter collector forwarder subscription |
	counter := 0.
	collector := [ counter := counter + 1 ].
	forwarder := MessageSend receiver: collector selector: #value.
	subscription := announcer weak when: AnnouncementMockA send: #value to: forwarder.
	
	" shouldn't go away, we are still holding a reference to 'forwarder': "
	self maximumReclamation.
	announcer announce: AnnouncementMockA.
	self assert: counter equals: 1.
	
	"Shouldn't go away since we converted to a strong sub"
	subscription := subscription makeStrong.
	forwarder := nil.
	self maximumReclamation.
	announcer announce: AnnouncementMockA.
	self assert: counter equals: 2
%

category: 'tests'
method: WeakAnnouncerTest
testNoDeadWeakSubscriptions

	self maximumReclamation.
	self assert: (WeakAnnouncementSubscription allInstancesInMemory select: [ :sub | sub subscriber isNil ]) isEmpty.
	self assert: (WeakAnnouncementSubscription allInstancesInMemory select: [ :sub | sub subscriber isNil ]) isEmpty
%

category: 'tests'
method: WeakAnnouncerTest
testWeakBlockUnsupported
	"We support weak blocks though they aren't all that useful."

	| counter |
	counter := 0.
	self
		should: [announcer weak when: AnnouncementMockA send: #value to: []]
		raise: WeakBlockUnsupported.
	self
		should: [(announcer when: AnnouncementMockA do: [ :ann | counter := counter + 1 ] for: self) makeWeak]
		raise: WeakBlockUnsupported
%

category: 'tests'
method: WeakAnnouncerTest
testWeakDoubleAnnouncer

	| a1 a2 o |
	a1 := Announcer new.
	a2 := Announcer new.
	o := Object new.
	self 
		assert: a1 subscriptions numberOfSubscriptions
		equals: 0.
	self
		assert: a2 subscriptions numberOfSubscriptions
		equals: 0.
	
	a1 weak
		when: Announcement
		send: #abcdef
		to: o.
	a2 weak
		when: Announcement
		send: #abcdef
		to: o.	
	self 
		assert: a1 subscriptions numberOfSubscriptions
		equals: 1.
	self
		assert: a2 subscriptions numberOfSubscriptions
		equals: 1.
	
	self maximumReclamation.
	self 
		assert: a1 subscriptions numberOfSubscriptions
		equals: 1.
	self
		assert: a2 subscriptions numberOfSubscriptions
		equals: 1.	

	o := nil.
	self maximumReclamation.
	self 
		assert: a1 subscriptions numberOfSubscriptions
		equals: 0.
	self
		assert: a2 subscriptions numberOfSubscriptions
		equals: 0.
%

category: 'tests'
method: WeakAnnouncerTest
testWeakObject

	| counter collector forwarder |
	counter := 0.
	collector := [ counter := counter + 1 ].
	forwarder := MessageSend receiver: collector selector: #value.
	(announcer when: AnnouncementMockA send: #value to: forwarder) makeWeak.
	
	" shouldn't go away, we are still holding a reference to 'forwarder': "
	self maximumReclamation.
	announcer announce: AnnouncementMockA.
	self assert: counter equals: 1.
	
	" should go away as we let the only reference to 'forwarder' go: "
	forwarder := nil.
	self maximumReclamation.
	announcer announce: AnnouncementMockA.
	self assert: counter equals: 1
%

category: 'tests'
method: WeakAnnouncerTest
testWeakSubscription

	| obj subscription |
	obj := Object new.
	subscription := (announcer when: AnnouncementMockA send: #value to: obj) makeWeak.
	self assert: obj identicalTo: subscription subscriber
%

! Class extensions for 'ExecBlock'

!		Instance methods for 'ExecBlock'

category: '*Announcements-Extensions-GemStone'
method: ExecBlock
hasReceiver
	"Not all blocks record the receiver, so we need to know whether a block has done so."

	^ (staticLink notNil and: [self selfOffsetInVC > 1])
		or: [self _selfOffsetInSelf > 0]
%

category: '*Announcements-Extensions-GemStone'
method: ExecBlock
receiver

	^self selfValue
%

! Class extensions for 'TestAsserter'

!		Instance methods for 'TestAsserter'

category: '*Announcements-Extensions-GemStone'
method: TestAsserter
should: aBlock notTakeMoreThan: aDuration
	"Throw an exception if aBlock should take longer than aDuration to run.
	 This is a toy implementation. It is should stop after the time limit.
	 Instead, it just sees how long it took and complains if it was too long."

	| msToRun actualDuration |
	msToRun := Time millisecondsElapsedTime: aBlock.
	actualDuration := Duration seconds: msToRun / 1000.
	self assert: actualDuration <= aDuration
		description: 'Block evaluation took more than the expected ', aDuration printString.
	^ actualDuration
%

! Class Initialization

run
GemToGemAnnouncement initialize.
true
%
