! Jasper Enhanced Inspector vendored source
! ----------------------------------------------------------------------------
! Origin : https://github.com/GemTalk/RemoteServiceReplication
! Source : src-gs/bootstrapRSR.gs
! License: MIT - Copyright (c) GemTalk Systems, Inc. See LICENSE in the origin repository.
!
! Vendored into Jasper and filed into the stone by the Enhanced Inspector
! installer. DO NOT EDIT BY HAND - regenerated from upstream by
! update_enhanced_inspector_support.sh, which re-applies this header and rewrites
! class placement from Globals to the dedicated GsEnhancedInspector dictionary.
! ----------------------------------------------------------------------------
! Class Declarations
! Generated file, do not Edit

doit
(Announcement
	subclass: 'RsrAnnouncement'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrAnnouncement
removeallclassmethods RsrAnnouncement

doit
(RsrAnnouncement
	subclass: 'RsrConnectionStateAnnouncement'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrConnectionStateAnnouncement
removeallclassmethods RsrConnectionStateAnnouncement

doit
(RsrConnectionStateAnnouncement
	subclass: 'RsrConnectionClosed'
	instVarNames: #(connection)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'This Announcement is used to signal that the specified Connection was closed.';
		immediateInvariant.
true.
%

removeallmethods RsrConnectionClosed
removeallclassmethods RsrConnectionClosed

doit
(Error
	subclass: 'RsrError'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrError
removeallclassmethods RsrError

doit
(RsrError
	subclass: 'RsrAlreadyRegistered'
	instVarNames: #(service intendedConnection)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrAlreadyRegistered
removeallclassmethods RsrAlreadyRegistered

doit
(RsrError
	subclass: 'RsrConnectionFailed'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrConnectionFailed
removeallclassmethods RsrConnectionFailed

doit
(RsrError
	subclass: 'RsrHandshakeError'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrHandshakeError
removeallclassmethods RsrHandshakeError

doit
(RsrHandshakeError
	subclass: 'RsrProtocolVersionNegotiationFailed'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrProtocolVersionNegotiationFailed
removeallclassmethods RsrProtocolVersionNegotiationFailed

doit
(RsrHandshakeError
	subclass: 'RsrTokenExchangeFailed'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrTokenExchangeFailed
removeallclassmethods RsrTokenExchangeFailed

doit
(RsrError
	subclass: 'RsrNonresumableError'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrNonresumableError
removeallclassmethods RsrNonresumableError

doit
(RsrError
	subclass: 'RsrOutOfRange'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrOutOfRange
removeallclassmethods RsrOutOfRange

doit
(RsrError
	subclass: 'RsrPromiseError'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrPromiseError
removeallclassmethods RsrPromiseError

doit
(RsrPromiseError
	subclass: 'RsrAlreadyResolved'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrAlreadyResolved
removeallclassmethods RsrAlreadyResolved

doit
(RsrPromiseError
	subclass: 'RsrBrokenPromise'
	instVarNames: #(reason)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrBrokenPromise
removeallclassmethods RsrBrokenPromise

doit
(RsrError
	subclass: 'RsrRemoteError'
	instVarNames: #(originalClassName stack)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrRemoteError
removeallclassmethods RsrRemoteError

doit
(RsrError
	subclass: 'RsrResumableError'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrResumableError
removeallclassmethods RsrResumableError

doit
(RsrError
	subclass: 'RsrServiceRejected'
	instVarNames: #(reason)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrServiceRejected
removeallclassmethods RsrServiceRejected

doit
(RsrError
	subclass: 'RsrSocketError'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrSocketError
removeallclassmethods RsrSocketError

doit
(RsrSocketError
	subclass: 'RsrConnectFailed'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrConnectFailed
removeallclassmethods RsrConnectFailed

doit
(RsrSocketError
	subclass: 'RsrInvalidBind'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrInvalidBind
removeallclassmethods RsrInvalidBind

doit
(RsrSocketError
	subclass: 'RsrSocketClosed'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrSocketClosed
removeallclassmethods RsrSocketClosed

doit
(RsrError
	subclass: 'RsrUnknownClass'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrUnknownClass
removeallclassmethods RsrUnknownClass

doit
(RsrError
	subclass: 'RsrUnknownSID'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrUnknownSID
removeallclassmethods RsrUnknownSID

doit
(RsrError
	subclass: 'RsrUnknownTemplate'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrUnknownTemplate
removeallclassmethods RsrUnknownTemplate

doit
(RsrError
	subclass: 'RsrUnsupportedObject'
	instVarNames: #(object)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrUnsupportedObject
removeallclassmethods RsrUnsupportedObject

doit
(RsrError
	subclass: 'RsrWaitForConnectionCancelled'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrWaitForConnectionCancelled
removeallclassmethods RsrWaitForConnectionCancelled

doit
(Exception
	subclass: 'RsrUnhandledException'
	instVarNames: #(exception)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'This class is used in GemStone and Dolphin to help process unhandled exceptions. Pharo will used the native UnhandledError class.

This should not be signaled outside of the framework.';
		immediateInvariant.
true.
%

removeallmethods RsrUnhandledException
removeallclassmethods RsrUnhandledException

doit
(Notification
	subclass: 'RsrNotification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrNotification
removeallclassmethods RsrNotification

doit
(Object
	subclass: 'RsrForwarder'
	instVarNames: #(_service)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone';
		immediateInvariant.
true.
%

removeallmethods RsrForwarder
removeallclassmethods RsrForwarder

doit
(Object
	subclass: 'RsrObject'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrObject
removeallclassmethods RsrObject

doit
(RsrObject
	subclass: 'RsrAbstractPolicy'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'The Connection Policy

This class defines the abstract interface for Policy. Policy provides a means of preventing Service replication. When a Service is created in a remote Connection and replicated locally, we first verify that the Policy allows the instantiation of the Service Template first. If the Policy does now allow a Service to be created, the incoming message send will be cancelled. RSR will report the message failure with a RsrPolicyRejectedService reason.

Note:
Subclasses of RsrReasonService are alway permitted as they are required by the framework.';
		immediateInvariant.
true.
%

removeallmethods RsrAbstractPolicy
removeallclassmethods RsrAbstractPolicy

doit
(RsrAbstractPolicy
	subclass: 'RsrDefaultPolicy'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrDefaultPolicy
removeallclassmethods RsrDefaultPolicy

doit
(RsrAbstractPolicy
	subclass: 'RsrTestPolicy'
	instVarNames: #(deniedTemplates)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrTestPolicy
removeallclassmethods RsrTestPolicy

doit
(RsrObject
	subclass: 'RsrAbstractReason'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'The superclass for Reasons generated for breaking Promise instances generated by the framework.

If the reason will be replicated, the Reason should subclass RsrReasonService.';
		immediateInvariant.
true.
%

removeallmethods RsrAbstractReason
removeallclassmethods RsrAbstractReason

doit
(RsrAbstractReason
	subclass: 'RsrConnectionClosedBeforeReceivingResponse'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrConnectionClosedBeforeReceivingResponse
removeallclassmethods RsrConnectionClosedBeforeReceivingResponse

doit
(RsrAbstractReason
	subclass: 'RsrDecodingRaisedException'
	instVarNames: #(exception)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrDecodingRaisedException
removeallclassmethods RsrDecodingRaisedException

doit
(RsrObject
	subclass: 'RsrAbstractService'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone';
		immediateInvariant.
true.
%

removeallmethods RsrAbstractService
removeallclassmethods RsrAbstractService

doit
(RsrAbstractService
	subclass: 'RsrService'
	instVarNames: #(_id _connection remoteSelf)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'I represent a class of Objects that know offer Rsr Services.';
		immediateInvariant.
true.
%

removeallmethods RsrService
removeallclassmethods RsrService

doit
(RsrService
	subclass: 'RsrConcurrentTestService'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrConcurrentTestService
removeallclassmethods RsrConcurrentTestService

doit
(RsrConcurrentTestService
	subclass: 'RsrConcurrentTestClient'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrConcurrentTestClient
removeallclassmethods RsrConcurrentTestClient

doit
(RsrConcurrentTestService
	subclass: 'RsrConcurrentTestServer'
	instVarNames: #(counter semaphore stashedProcess)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrConcurrentTestServer
removeallclassmethods RsrConcurrentTestServer

doit
(RsrService
	subclass: 'RsrInstrumentedService'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		comment: 'No class-specific documentation for RsrInstrumentedService, hierarchy is:
Object
  RsrObject
    RsrAbstractService
      RsrService( _id _connection remoteSelf)
        RsrInstrumentedService( sharedVariable preUpdateAction postUpdateAction)
';
		immediateInvariant.
true.
%

removeallmethods RsrInstrumentedService
removeallclassmethods RsrInstrumentedService

doit
(RsrInstrumentedService
	subclass: 'RsrInstrumentedClient'
	instVarNames: #(preUpdateCount postUpdateCount postRegistrationCount)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		comment: 'No class-specific documentation for RsrInstrumentedClient, hierarchy is:
Object
  RsrObject
    RsrAbstractService
      RsrService( _id _connection remoteSelf)
        RsrInstrumentedService
          RsrInstrumentedClient( preUpdateAction postUpdateAction)
';
		immediateInvariant.
true.
%

removeallmethods RsrInstrumentedClient
removeallclassmethods RsrInstrumentedClient

doit
(RsrInstrumentedService
	subclass: 'RsrInstrumentedServer'
	instVarNames: #(preUpdateCount postUpdateCount postRegistrationCount action)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		comment: 'No class-specific documentation for RsrInstrumentedServer, hierarchy is:
Object
  RsrObject
    RsrAbstractService
      RsrService( _id _connection remoteSelf)
        RsrInstrumentedService
          RsrInstrumentedServer( preUpdateAction postUpdateAction)
';
		immediateInvariant.
true.
%

removeallmethods RsrInstrumentedServer
removeallclassmethods RsrInstrumentedServer

doit
(RsrService
	subclass: 'RsrMockService'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Platform-Test';
		immediateInvariant.
true.
%

removeallmethods RsrMockService
removeallclassmethods RsrMockService

doit
(RsrMockService
	subclass: 'RsrMockClient'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Platform-Test';
		immediateInvariant.
true.
%

removeallmethods RsrMockClient
removeallclassmethods RsrMockClient

doit
(RsrMockService
	subclass: 'RsrMockServer'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Platform-Test';
		immediateInvariant.
true.
%

removeallmethods RsrMockServer
removeallclassmethods RsrMockServer

doit
(RsrService
	subclass: 'RsrReasonService'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'This Service services as an abstract superclass for various Promise break reasons that must support replication.';
		immediateInvariant.
true.
%

removeallmethods RsrReasonService
removeallclassmethods RsrReasonService

doit
(RsrReasonService
	subclass: 'RsrPolicyRejectedService'
	instVarNames: #(sid templateName)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'PolicyRejectedService signals to a caller that their peer''s Connection Policy does not permit the described object''s creation.';
		immediateInvariant.
true.
%

removeallmethods RsrPolicyRejectedService
removeallclassmethods RsrPolicyRejectedService

doit
(RsrPolicyRejectedService
	subclass: 'RsrPolicyRejectedServiceClient'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrPolicyRejectedServiceClient
removeallclassmethods RsrPolicyRejectedServiceClient

doit
(RsrPolicyRejectedService
	subclass: 'RsrPolicyRejectedServiceServer'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrPolicyRejectedServiceServer
removeallclassmethods RsrPolicyRejectedServiceServer

doit
(RsrReasonService
	subclass: 'RsrRemoteException'
	instVarNames: #(exceptionClassName tag messageText stack)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrRemoteException
removeallclassmethods RsrRemoteException

doit
(RsrRemoteException
	subclass: 'RsrRemoteExceptionClient'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrRemoteExceptionClient
removeallclassmethods RsrRemoteExceptionClient

doit
(RsrRemoteException
	subclass: 'RsrRemoteExceptionServer'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrRemoteExceptionServer
removeallclassmethods RsrRemoteExceptionServer

doit
(RsrService
	subclass: 'RsrReflectedVariableTestServiceA'
	instVarNames: #(varA)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrReflectedVariableTestServiceA
removeallclassmethods RsrReflectedVariableTestServiceA

doit
(RsrReflectedVariableTestServiceA
	subclass: 'RsrReflectedVariableTestServiceB'
	instVarNames: #(varB)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrReflectedVariableTestServiceB
removeallclassmethods RsrReflectedVariableTestServiceB

doit
(RsrReflectedVariableTestServiceB
	subclass: 'RsrReflectedVariableTestClient'
	instVarNames: #(private)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrReflectedVariableTestClient
removeallclassmethods RsrReflectedVariableTestClient

doit
(RsrReflectedVariableTestServiceB
	subclass: 'RsrReflectedVariableTestServer'
	instVarNames: #(private)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrReflectedVariableTestServer
removeallclassmethods RsrReflectedVariableTestServer

doit
(RsrService
	subclass: 'RsrRemoteAction'
	instVarNames: #(sharedVariable)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrRemoteAction
removeallclassmethods RsrRemoteAction

doit
(RsrRemoteAction
	subclass: 'RsrRemoteActionClient'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrRemoteActionClient
removeallclassmethods RsrRemoteActionClient

doit
(RsrRemoteAction
	subclass: 'RsrRemoteActionServer'
	instVarNames: #(action debugHandler preUpdateHandler postUpdateHandler postRegistrationHandler)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrRemoteActionServer
removeallclassmethods RsrRemoteActionServer

doit
(RsrService
	subclass: 'RsrReturnUnknownService'
	instVarNames: #(sharedVariable)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrReturnUnknownService
removeallclassmethods RsrReturnUnknownService

doit
(RsrReturnUnknownService
	subclass: 'RsrKnownServer'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrKnownServer
removeallclassmethods RsrKnownServer

doit
(RsrService
	subclass: 'RsrSendUnknownService'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrSendUnknownService
removeallclassmethods RsrSendUnknownService

doit
(RsrSendUnknownService
	subclass: 'RsrKnownClient'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrKnownClient
removeallclassmethods RsrKnownClient

doit
(RsrService
	subclass: 'RsrServiceNoInstVars'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrServiceNoInstVars
removeallclassmethods RsrServiceNoInstVars

doit
(RsrServiceNoInstVars
	subclass: 'RsrClientNoInstVars'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrClientNoInstVars
removeallclassmethods RsrClientNoInstVars

doit
(RsrServiceNoInstVars
	subclass: 'RsrServerNoInstVars'
	instVarNames: #(marker)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrServerNoInstVars
removeallclassmethods RsrServerNoInstVars

doit
(RsrService
	subclass: 'RsrServiceReferenceService'
	instVarNames: #(service)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrServiceReferenceService
removeallclassmethods RsrServiceReferenceService

doit
(RsrServiceReferenceService
	subclass: 'RsrClientReferenceService'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrClientReferenceService
removeallclassmethods RsrClientReferenceService

doit
(RsrServiceReferenceService
	subclass: 'RsrServerReferenceService'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrServerReferenceService
removeallclassmethods RsrServerReferenceService

doit
(RsrService
	subclass: 'RsrTestService'
	instVarNames: #(sharedVariable)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrTestService
removeallclassmethods RsrTestService

doit
(RsrTestService
	subclass: 'RsrClientTestService'
	instVarNames: #(privateVariable)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrClientTestService
removeallclassmethods RsrClientTestService

doit
(RsrTestService
	subclass: 'RsrServerTestService'
	instVarNames: #(privateVariable)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrServerTestService
removeallclassmethods RsrServerTestService

doit
(RsrService
	subclass: 'RsrValueHolder'
	instVarNames: #(value)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrValueHolder
removeallclassmethods RsrValueHolder

doit
(RsrValueHolder
	subclass: 'RsrValueHolderClient'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrValueHolderClient
removeallclassmethods RsrValueHolderClient

doit
(RsrValueHolder
	subclass: 'RsrValueHolderServer'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrValueHolderServer
removeallclassmethods RsrValueHolderServer

doit
(RsrService
	subclass: 'RsrVersionService'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone-Test';
		immediateInvariant.
true.
%

removeallmethods RsrVersionService
removeallclassmethods RsrVersionService

doit
(RsrVersionService
	subclass: 'RsrVersionServiceClient'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone-Test';
		immediateInvariant.
true.
%

removeallmethods RsrVersionServiceClient
removeallclassmethods RsrVersionServiceClient

doit
(RsrVersionService
	subclass: 'RsrVersionServiceServer'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone-Test';
		immediateInvariant.
true.
%

removeallmethods RsrVersionServiceServer
removeallclassmethods RsrVersionServiceServer

doit
(RsrObject
	subclass: 'RsrAbstractTemplateResolver'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrAbstractTemplateResolver
removeallclassmethods RsrAbstractTemplateResolver

doit
(RsrAbstractTemplateResolver
	subclass: 'RsrTemplateResolver'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrTemplateResolver
removeallclassmethods RsrTemplateResolver

doit
(RsrObject
	subclass: 'RsrAsyncMournHandler'
	instVarNames: #(process notifier isActive)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone';
		comment: '+++This class is private and shouldn''t be used by any users of RSR+++

In GemStone, Ephemeron interrupts are serviced on the active thread when the interrupt is asserted. This causes a problem in RSR. If we are in a critical section in the service registry, we can end up in a situation where we attempt to re-enter a registry critical section.

A recursive lock isn''t a safe choice to resolve this problem. We may be part way through updating the registry data structures when we process a removal sparked by an Ephemeron mourn.

This class gets around this issue by processing Ephemeron mourning on a separate and distict thread from all others in the program. It is possible that another process might already be processing events asynchronously. In that event, we notify the calling code. If they choose to continue using RSR, we abort the handler and allow RSR to continue its setup.';
		immediateInvariant.
true.
%

removeallmethods RsrAsyncMournHandler
removeallclassmethods RsrAsyncMournHandler

doit
(RsrObject
	subclass: 'RsrBufferedSocketStream'
	instVarNames: #(stream outBuffer writePosition nextToWrite)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrBufferedSocketStream
removeallclassmethods RsrBufferedSocketStream

doit
(RsrObject
	subclass: 'RsrChannel'
	instVarNames: #(connection)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'No class-specific documentation for RsrChannel, hierarchy is:
Object
  RsrObject
    RsrChannel
';
		immediateInvariant.
true.
%

removeallmethods RsrChannel
removeallclassmethods RsrChannel

doit
(RsrChannel
	subclass: 'RsrBinaryStreamChannel'
	instVarNames: #(sink source inStream outStream)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'No class-specific documentation for RsrSocketChannel, hierarchy is:
Object
  RsrObject
    RsrChannel
      RsrSocketChannel( reader writer socket stream)
';
		immediateInvariant.
true.
%

removeallmethods RsrBinaryStreamChannel
removeallclassmethods RsrBinaryStreamChannel

doit
(RsrChannel
	subclass: 'RsrInMemoryChannel'
	instVarNames: #(inQueue outQueue drainProcess)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'Example usage:

	| aQueue bQueue channelA channelB |
	aQueue := SharedQueue new.
	bQueue := SharedQueue new.
	channelA := RsrInMemoryChannel
		inQueue: aQueue
		outQueue: bQueue.
	channelB := RsrInMemoryChannel
		inQueue: bQueue
		outQueue: aQueue.
	connectionA := RsrConnection
		channel: channelA
		transactionSpigot: RsrThreadSafeNumericSpigot naturals
		oidSpigot: RsrThreadSafeNumericSpigot naturals.
	connectionB := RsrConnection
		channel: channelB
		transactionSpigot: RsrThreadSafeNumericSpigot naturals negated
		oidSpigot: RsrThreadSafeNumericSpigot naturals negated.
	connectionA open.
	connectionB open.';
		immediateInvariant.
true.
%

removeallmethods RsrInMemoryChannel
removeallclassmethods RsrInMemoryChannel

doit
(RsrChannel
	subclass: 'RsrNullChannel'
	instVarNames: #(lastCommand)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrNullChannel
removeallclassmethods RsrNullChannel

doit
(RsrObject
	subclass: 'RsrClassResolver'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone';
		immediateInvariant.
true.
%

removeallmethods RsrClassResolver
removeallclassmethods RsrClassResolver

doit
(RsrObject
	subclass: 'RsrCodec'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrCodec
removeallclassmethods RsrCodec

doit
(RsrCodec
	subclass: 'RsrCommandCodec'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrCommandCodec
removeallclassmethods RsrCommandCodec

doit
(RsrCommandCodec
	subclass: 'RsrCommandDecoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'No class-specific documentation for RsrDecoder, hierarchy is:
Object
  RsrObject
    RsrCodec
      RsrDecoder( registry connection decodeCommandMap)
';
		immediateInvariant.
true.
%

removeallmethods RsrCommandDecoder
removeallclassmethods RsrCommandDecoder

doit
(RsrCommandCodec
	subclass: 'RsrCommandEncoder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrCommandEncoder
removeallclassmethods RsrCommandEncoder

doit
(RsrCodec
	subclass: 'RsrProtocolVersionNegotiationCodec'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrProtocolVersionNegotiationCodec
removeallclassmethods RsrProtocolVersionNegotiationCodec

doit
(RsrCodec
	subclass: 'RsrTokenExchangeCodec'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrTokenExchangeCodec
removeallclassmethods RsrTokenExchangeCodec

doit
(RsrObject
	subclass: 'RsrCommand'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'No class-specific documentation for RsrCommand, hierarchy is:
Object
  RsrObject
    RsrCommand( encoding)
';
		immediateInvariant.
true.
%

removeallmethods RsrCommand
removeallclassmethods RsrCommand

doit
(RsrCommand
	subclass: 'RsrMessagingCommand'
	instVarNames: #(snapshots transaction)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrMessagingCommand
removeallclassmethods RsrMessagingCommand

doit
(RsrMessagingCommand
	subclass: 'RsrDeliverResponse'
	instVarNames: #(responseReference)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'No class-specific documentation for RsrDeliverResponse, hierarchy is:
Object
  RsrObject
    RsrCommand( encoding)
      RsrDeliverResponse( transaction response roots retainList)
';
		immediateInvariant.
true.
%

removeallmethods RsrDeliverResponse
removeallclassmethods RsrDeliverResponse

doit
(RsrMessagingCommand
	subclass: 'RsrSendMessage'
	instVarNames: #(receiverReference selectorReference argumentReferences)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'No class-specific documentation for RsrSendMessage, hierarchy is:
Object
  RsrObject
    RsrCommand( encoding)
      RsrSendMessage( transaction receiver selector arguments retainList)
';
		immediateInvariant.
true.
%

removeallmethods RsrSendMessage
removeallclassmethods RsrSendMessage

doit
(RsrCommand
	subclass: 'RsrReleaseServices'
	instVarNames: #(sids)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'No class-specific documentation for RsrReleaseServices, hierarchy is:
Object
  RsrObject
    RsrCommand( encoding)
      RsrReleaseServices( oids)
';
		immediateInvariant.
true.
%

removeallmethods RsrReleaseServices
removeallclassmethods RsrReleaseServices

doit
(RsrObject
	subclass: 'RsrConnection'
	instVarNames: #(channel transactionSpigot oidSpigot log registry pendingMessages specification announcer templateResolver policy)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'Connection is the central mediator for RSR. When using the framework, an associated application will hold onto Connection. When terminating or otherwise done with RSR, it will close the Connection to signal this.

Connection offers a limited public interface. The private methods are subject to change and shouldn''t be used by any application.

The Connection can be monitored by subscribing to any of the Announcements defined under ConnectionStateAnnouncement. See #announcer.

The Connection is generally created indirectly via one of the ConnectionSpecification subclasses.';
		immediateInvariant.
true.
%

removeallmethods RsrConnection
removeallclassmethods RsrConnection

doit
(RsrObject
	subclass: 'RsrConnectionSpecification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrConnectionSpecification
removeallclassmethods RsrConnectionSpecification

doit
(RsrConnectionSpecification
	subclass: 'RsrInternalConnectionSpecification'
	instVarNames: #(connectionA connectionB)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrInternalConnectionSpecification
removeallclassmethods RsrInternalConnectionSpecification

doit
(RsrInternalConnectionSpecification
	subclass: 'RsrInMemoryConnectionSpecification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrInMemoryConnectionSpecification
removeallclassmethods RsrInMemoryConnectionSpecification

doit
(RsrInternalConnectionSpecification
	subclass: 'RsrInternalSocketConnectionSpecification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrInternalSocketConnectionSpecification
removeallclassmethods RsrInternalSocketConnectionSpecification

doit
(RsrConnectionSpecification
	subclass: 'RsrSocketConnectionSpecification'
	instVarNames: #(host port)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'This class is abstract and defines the interface for manufacturing RsrConnection instances which are connected to a peer.

Specialized subclasses are reponsible for either listening for or initiating connections with a peer.';
		immediateInvariant.
true.
%

removeallmethods RsrSocketConnectionSpecification
removeallclassmethods RsrSocketConnectionSpecification

doit
(RsrSocketConnectionSpecification
	subclass: 'RsrAcceptConnection'
	instVarNames: #(portRange listener isListening isWaitingForConnection)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrAcceptConnection
removeallclassmethods RsrAcceptConnection

doit
(RsrAcceptConnection
	subclass: 'RsrGciAcceptConnection'
	instVarNames: #(token)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrGciAcceptConnection
removeallclassmethods RsrGciAcceptConnection

doit
(RsrSocketConnectionSpecification
	subclass: 'RsrInitiateConnection'
	instVarNames: #(token)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'This class is responsible for initating a new RsrConnection. Sending #connect will result in an attempt to connect to the specified host and port. #connect is responsible for initating the attempted connection. If successful, an instance of RsrConnection is returned as a result.

Example: 

| initiator |
initiator := RsrInitiateConnection
	host: ''127.0.0.1''
	port: 51820.
^initiator connect';
		immediateInvariant.
true.
%

removeallmethods RsrInitiateConnection
removeallclassmethods RsrInitiateConnection

doit
(RsrInitiateConnection
	subclass: 'RsrGciInitiateConnection'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrGciInitiateConnection
removeallclassmethods RsrGciInitiateConnection

doit
(RsrObject
	subclass: 'RsrDateAndTime'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrDateAndTime
removeallclassmethods RsrDateAndTime

doit
(RsrObject
	subclass: 'RsrEnvironment'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone';
		immediateInvariant.
true.
%

removeallmethods RsrEnvironment
removeallclassmethods RsrEnvironment

doit
(RsrObject
	subclass: 'RsrEphemeron'
	instVarNames: #(key mournAction)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone';
		immediateInvariant.
true.
%

removeallmethods RsrEphemeron
removeallclassmethods RsrEphemeron

doit
(RsrObject
	subclass: 'RsrGarbageCollector'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone';
		immediateInvariant.
true.
%

removeallmethods RsrGarbageCollector
removeallclassmethods RsrGarbageCollector

doit
(RsrObject
	subclass: 'RsrHandshake'
	instVarNames: #(steps stream)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrHandshake
removeallclassmethods RsrHandshake

doit
(RsrObject
	subclass: 'RsrHandshakeStep'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrHandshakeStep
removeallclassmethods RsrHandshakeStep

doit
(RsrHandshakeStep
	subclass: 'RsrProtocolVersionNegotiation'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'This class serves as the abstract superclass for the classes which implement the actual handshake protocol.

When the Client opens a Socket to the Server, it is responsible for sending the first message.

Client -> Server: SupportedVersions
Server -> Client:
	alt: The Server and Client have overlap in their supported versions
		- Server -> Client: ChosenVersion
	alt: No overlap exists between the Client and Server.
		- Server -> Client: NoVersionOverlap
		- Server: Closes socket';
		immediateInvariant.
true.
%

removeallmethods RsrProtocolVersionNegotiation
removeallclassmethods RsrProtocolVersionNegotiation

doit
(RsrProtocolVersionNegotiation
	subclass: 'RsrProtocolVersionNegotiationClient'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrProtocolVersionNegotiationClient
removeallclassmethods RsrProtocolVersionNegotiationClient

doit
(RsrProtocolVersionNegotiation
	subclass: 'RsrProtocolVersionNegotiationServer'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrProtocolVersionNegotiationServer
removeallclassmethods RsrProtocolVersionNegotiationServer

doit
(RsrHandshakeStep
	subclass: 'RsrTokenExchange'
	instVarNames: #(token)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrTokenExchange
removeallclassmethods RsrTokenExchange

doit
(RsrTokenExchange
	subclass: 'RsrTokenReceiver'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrTokenReceiver
removeallclassmethods RsrTokenReceiver

doit
(RsrTokenExchange
	subclass: 'RsrTokenSender'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrTokenSender
removeallclassmethods RsrTokenSender

doit
(RsrObject
	subclass: 'RsrLog'
	instVarNames: #(verbosity sinks)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrLog
removeallclassmethods RsrLog

doit
(RsrObject
	subclass: 'RsrLogSink'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrLogSink
removeallclassmethods RsrLogSink

doit
(RsrLogSink
	subclass: 'RsrCustomSink'
	instVarNames: #(action)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrCustomSink
removeallclassmethods RsrCustomSink

doit
(RsrLogSink
	subclass: 'RsrTranscriptSink'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrTranscriptSink
removeallclassmethods RsrTranscriptSink

doit
(RsrObject
	subclass: 'RsrLogWithPrefix'
	instVarNames: #(prefix log)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrLogWithPrefix
removeallclassmethods RsrLogWithPrefix

doit
(RsrObject
	subclass: 'RsrMessageSend'
	instVarNames: #(receiver selector arguments)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrMessageSend
removeallclassmethods RsrMessageSend

doit
(RsrObject
	subclass: 'RsrNumericSpigot'
	instVarNames: #(current step)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrNumericSpigot
removeallclassmethods RsrNumericSpigot

doit
(RsrNumericSpigot
	subclass: 'RsrThreadSafeNumericSpigot'
	instVarNames: #(mutex)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrThreadSafeNumericSpigot
removeallclassmethods RsrThreadSafeNumericSpigot

doit
(RsrObject
	subclass: 'RsrPendingMessage'
	instVarNames: #(services promise)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrPendingMessage
removeallclassmethods RsrPendingMessage

doit
(RsrObject
	subclass: 'RsrPromise'
	instVarNames: #(mutex value state resolvedMutex resolutionActions)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'Purpose: Provide a simple Promise interface for use in RSR.

A Promise may be in two high level states -- unresolved and resolved. Resolving a promise means either breaking or fulfilling the promise. Any users of the Notification Interface will be notified of the resolution. See individual methods for details.

Resolution Interface:
- #break:
- #fulfill:

Notification Interface:
- #when:catch:
- #wait
- #value

Example Usage:

```
	| promise |
	promise := Promise new.
	promise
		when: [:anObject | Transcript show: ''Promise fulfilled to: '', anObject asString; cr]
		catch: [:reason | Transcript show: ''Promise broken because of '', reason asString; cr].
	"Time passes"
	promise fulfill: Object new
```

```
	| promise |
	promise := Promise new.
	self runAsynCalculationThenFulfill: promise.
	promise wait.
```';
		immediateInvariant.
true.
%

removeallmethods RsrPromise
removeallclassmethods RsrPromise

doit
(RsrObject
	subclass: 'RsrPromiseResolutionAction'
	instVarNames: #(when catch)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrPromiseResolutionAction
removeallclassmethods RsrPromiseResolutionAction

doit
(RsrObject
	subclass: 'RsrProtocolVersionNegotiationMessage'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'HandshakeMessage serves as a superclass for all Messages used while processing a Connection Handshake.';
		immediateInvariant.
true.
%

removeallmethods RsrProtocolVersionNegotiationMessage
removeallclassmethods RsrProtocolVersionNegotiationMessage

doit
(RsrProtocolVersionNegotiationMessage
	subclass: 'RsrChosenVersion'
	instVarNames: #(version)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'This message is sent when a Server has chosen a version it is willing to talk w/ a client Connection. The Server expects the Client to speak this version.';
		immediateInvariant.
true.
%

removeallmethods RsrChosenVersion
removeallclassmethods RsrChosenVersion

doit
(RsrProtocolVersionNegotiationMessage
	subclass: 'RsrNoVersionOverlap'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'This message is sent when a Server has determined it cannot talk any version of the protocol that the Client has requested to speak.';
		immediateInvariant.
true.
%

removeallmethods RsrNoVersionOverlap
removeallclassmethods RsrNoVersionOverlap

doit
(RsrProtocolVersionNegotiationMessage
	subclass: 'RsrSupportedVersions'
	instVarNames: #(versions)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'When a Client connects to a Server. It is required to send this message w/ the list of supported protocol versions it is willing to speak. The preference of the client is signified by the order of the version numbers in <versions>.';
		immediateInvariant.
true.
%

removeallmethods RsrSupportedVersions
removeallclassmethods RsrSupportedVersions

doit
(RsrObject
	subclass: 'RsrReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #(referenceMapping)
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'RsrReference

Reference instances are created as a by-product of freezing the state of a Service. This typically happens when the framework creates a SendMessage or DeliverResponse command.

The Reference represents and is able to resolve the object it represents. In some cases, the value is immediate. In the case of ServiceReference, the stored Service Identifier is resolved in the context of a connection.

Resolving must occur in the context of a Connection. Though this is true, the minimal information necessary for a Reference to resolve is the Registry.

SendMessage and DeliverResponse store fields like receiver or result as references. They are resolved when the Command is set to execute.

Collaborators:
- ServiceSnapshot
- Encoder
- Decoder';
		immediateInvariant.
true.
%

removeallmethods RsrReference
removeallclassmethods RsrReference

doit
(RsrReference
	subclass: 'RsrImmediateReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrImmediateReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference( value)
';
		immediateInvariant.
true.
%

removeallmethods RsrImmediateReference
removeallclassmethods RsrImmediateReference

doit
(RsrImmediateReference
	subclass: 'RsrBooleanReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrBooleanReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrBooleanReference
';
		immediateInvariant.
true.
%

removeallmethods RsrBooleanReference
removeallclassmethods RsrBooleanReference

doit
(RsrBooleanReference
	subclass: 'RsrFalseReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrFalseReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrFalseReference
';
		immediateInvariant.
true.
%

removeallmethods RsrFalseReference
removeallclassmethods RsrFalseReference

doit
(RsrBooleanReference
	subclass: 'RsrTrueReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrTrueReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference( value)
        RsrTrueReference
';
		immediateInvariant.
true.
%

removeallmethods RsrTrueReference
removeallclassmethods RsrTrueReference

doit
(RsrImmediateReference
	subclass: 'RsrNilReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrNilReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrNilReference
';
		immediateInvariant.
true.
%

removeallmethods RsrNilReference
removeallclassmethods RsrNilReference

doit
(RsrImmediateReference
	subclass: 'RsrValueReference'
	instVarNames: #(intermediate)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrValueReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrValueReference( value)
';
		immediateInvariant.
true.
%

removeallmethods RsrValueReference
removeallclassmethods RsrValueReference

doit
(RsrValueReference
	subclass: 'RsrByteArrayReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrByteArrayReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrValueReference( value)
          RsrByteArrayReference
';
		immediateInvariant.
true.
%

removeallmethods RsrByteArrayReference
removeallclassmethods RsrByteArrayReference

doit
(RsrValueReference
	subclass: 'RsrCharacterArrayReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrCharacterArrayReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrCharacterArrayReference
';
		immediateInvariant.
true.
%

removeallmethods RsrCharacterArrayReference
removeallclassmethods RsrCharacterArrayReference

doit
(RsrCharacterArrayReference
	subclass: 'RsrStringReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrStringReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrCharacterArrayReference( value)
          RsrStringReference
';
		immediateInvariant.
true.
%

removeallmethods RsrStringReference
removeallclassmethods RsrStringReference

doit
(RsrCharacterArrayReference
	subclass: 'RsrSymbolReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrSymbolReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrCharacterArrayReference( value)
          RsrSymbolReference
';
		immediateInvariant.
true.
%

removeallmethods RsrSymbolReference
removeallclassmethods RsrSymbolReference

doit
(RsrValueReference
	subclass: 'RsrCharacterReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrCharacterReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrValueReference( value)
          RsrCharacterReference
';
		immediateInvariant.
true.
%

removeallmethods RsrCharacterReference
removeallclassmethods RsrCharacterReference

doit
(RsrValueReference
	subclass: 'RsrCollectionReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrCollectionReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrValueReference( value)
          RsrCollectionReference
';
		immediateInvariant.
true.
%

removeallmethods RsrCollectionReference
removeallclassmethods RsrCollectionReference

doit
(RsrCollectionReference
	subclass: 'RsrArrayReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrArrayReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrValueReference( value)
          RsrArrayReference
';
		immediateInvariant.
true.
%

removeallmethods RsrArrayReference
removeallclassmethods RsrArrayReference

doit
(RsrCollectionReference
	subclass: 'RsrDictionaryReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrDictionaryReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrValueReference( value)
          RsrDictionaryReference
';
		immediateInvariant.
true.
%

removeallmethods RsrDictionaryReference
removeallclassmethods RsrDictionaryReference

doit
(RsrCollectionReference
	subclass: 'RsrOrderedCollectionReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrOrderedCollectionReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrValueReference( value)
          RsrOrderedCollectionReference
';
		immediateInvariant.
true.
%

removeallmethods RsrOrderedCollectionReference
removeallclassmethods RsrOrderedCollectionReference

doit
(RsrCollectionReference
	subclass: 'RsrSetReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrSetReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrValueReference( value)
          RsrSetReference
';
		immediateInvariant.
true.
%

removeallmethods RsrSetReference
removeallclassmethods RsrSetReference

doit
(RsrValueReference
	subclass: 'RsrDateAndTimeReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrDateAndTimeReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrValueReference( value)
          RsrDateAndTimeReference
';
		immediateInvariant.
true.
%

removeallmethods RsrDateAndTimeReference
removeallclassmethods RsrDateAndTimeReference

doit
(RsrValueReference
	subclass: 'RsrDoubleReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrDoubleReference
removeallclassmethods RsrDoubleReference

doit
(RsrValueReference
	subclass: 'RsrIntegerReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrIntegerReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrIntegerReference( value)
';
		immediateInvariant.
true.
%

removeallmethods RsrIntegerReference
removeallclassmethods RsrIntegerReference

doit
(RsrIntegerReference
	subclass: 'RsrNegativeIntegerReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrNegativeIntegerReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrIntegerReference( value)
          RsrNegativeIntegerReference
';
		immediateInvariant.
true.
%

removeallmethods RsrNegativeIntegerReference
removeallclassmethods RsrNegativeIntegerReference

doit
(RsrIntegerReference
	subclass: 'RsrPositiveIntegerReference'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrPositiveIntegerReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrImmediateReference
        RsrIntegerReference( value)
          RsrPositiveIntegerReference
';
		immediateInvariant.
true.
%

removeallmethods RsrPositiveIntegerReference
removeallclassmethods RsrPositiveIntegerReference

doit
(RsrReference
	subclass: 'RsrServiceReference'
	instVarNames: #(sid)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'No class-specific documentation for RsrServiceReference, hierarchy is:
Object
  RsrObject
    RsrReference
      RsrServiceReference( sid)
';
		immediateInvariant.
true.
%

removeallmethods RsrServiceReference
removeallclassmethods RsrServiceReference

doit
(RsrObject
	subclass: 'RsrRegistryEntry'
	instVarNames: #(ephemeron strongStorage)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone';
		immediateInvariant.
true.
%

removeallmethods RsrRegistryEntry
removeallclassmethods RsrRegistryEntry

doit
(RsrObject
	subclass: 'RsrRemotePromiseResolver'
	instVarNames: #(mutex sendMessage connection extraRoots hasResolved)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'This class is responsible for taking breaking or fulfilling its associated Promise. The Promise exists in the remote RSR instance.

This class may be mutated outside of the thread which created it. Therefore, it contains a protection mutex to ensure consistency.';
		immediateInvariant.
true.
%

removeallmethods RsrRemotePromiseResolver
removeallclassmethods RsrRemotePromiseResolver

doit
(RsrObject
	subclass: 'RsrScientist'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone';
		immediateInvariant.
true.
%

removeallmethods RsrScientist
removeallclassmethods RsrScientist

doit
(RsrObject
	subclass: 'RsrServiceEphemeron'
	instVarNames: #(service action)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone';
		immediateInvariant.
true.
%

removeallmethods RsrServiceEphemeron
removeallclassmethods RsrServiceEphemeron

doit
(RsrObject
	subclass: 'RsrServiceSnapshot'
	instVarNames: #(sid templateName shouldCreateServer slots)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'RsrServiceSnapshot

When a SendMessage or DeliverResponse command is processed, the entire transition closure of the MessageSend/Response is analyzed.

A Snapshot of each Service found during this process is taken. The slots of the Service that need to be replicated are stored in the ServiceSnapshot as references.

In addition, information about the template and service is stored. This allows the peer to reify the correct type of Service. For instance, a local Client will be a Server remotely. A local Server will become a remote Client.

Collaborators:
- Encoder
- Decoder
- Reference';
		immediateInvariant.
true.
%

removeallmethods RsrServiceSnapshot
removeallclassmethods RsrServiceSnapshot

doit
(RsrObject
	subclass: 'RsrSignalErrorInAsString'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrSignalErrorInAsString
removeallclassmethods RsrSignalErrorInAsString

doit
(RsrObject
	subclass: 'RsrSnapshotAnalysis'
	instVarNames: #(roots snapshots connection analyzedObjects)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'No class-specific documentation for RsrSnapshotAnalysis, hierarchy is:
Object
  RsrObject
    RsrSnapshotAnalysis( roots snapshots inFlight connection)
';
		immediateInvariant.
true.
%

removeallmethods RsrSnapshotAnalysis
removeallclassmethods RsrSnapshotAnalysis

doit
(RsrObject
	subclass: 'RsrSocket'
	instVarNames: #(nativeSocket)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone';
		immediateInvariant.
true.
%

removeallmethods RsrSocket
removeallclassmethods RsrSocket

doit
(RsrObject
	subclass: 'RsrSocketPair'
	instVarNames: #(firstSocket secondSocket)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Platform-Test';
		immediateInvariant.
true.
%

removeallmethods RsrSocketPair
removeallclassmethods RsrSocketPair

doit
(RsrObject
	subclass: 'RsrStream'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrStream
removeallclassmethods RsrStream

doit
(RsrStream
	subclass: 'RsrSocketStream'
	instVarNames: #(socket sendBuffer position)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'A stream to put on top of a socket, with a write buffer to avoid sending tiny packets. Bytes are accumulated until either an MSS-worth (we assume a conservative MSS of 1440 bytes) is waiting to be sent, or until flush is sent, to send the data through the underlying socket.';
		immediateInvariant.
true.
%

removeallmethods RsrSocketStream
removeallclassmethods RsrSocketStream

doit
(RsrObject
	subclass: 'RsrStreamChannelLoop'
	instVarNames: #(process channel state)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'No class-specific documentation for RsrEventLoop, hierarchy is:
Object
  RsrObject
    RsrEventLoop( process connection state)
';
		immediateInvariant.
true.
%

removeallmethods RsrStreamChannelLoop
removeallclassmethods RsrStreamChannelLoop

doit
(RsrStreamChannelLoop
	subclass: 'RsrCommandSink'
	instVarNames: #(queue)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'No class-specific documentation for RsrCommandSink, hierarchy is:
Object
  RsrObject
    RsrEventLoop( process connection state)
      RsrCommandSink( queue)
';
		immediateInvariant.
true.
%

removeallmethods RsrCommandSink
removeallclassmethods RsrCommandSink

doit
(RsrStreamChannelLoop
	subclass: 'RsrCommandSource'
	instVarNames: #(decoder)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrCommandSource
removeallclassmethods RsrCommandSource

doit
(RsrObject
	subclass: 'RsrThreadSafeDictionary'
	instVarNames: #(mutex map)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		comment: 'I maintain the associations between locally stored objects and their remote counterparts.';
		immediateInvariant.
true.
%

removeallmethods RsrThreadSafeDictionary
removeallclassmethods RsrThreadSafeDictionary

doit
(RsrObject
	subclass: 'RsrTokenExchangeMessage'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrTokenExchangeMessage
removeallclassmethods RsrTokenExchangeMessage

doit
(RsrTokenExchangeMessage
	subclass: 'RsrToken'
	instVarNames: #(bytes)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrToken
removeallclassmethods RsrToken

doit
(RsrTokenExchangeMessage
	subclass: 'RsrTokenAccepted'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrTokenAccepted
removeallclassmethods RsrTokenAccepted

doit
(RsrTokenExchangeMessage
	subclass: 'RsrTokenRejected'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		immediateInvariant.
true.
%

removeallmethods RsrTokenRejected
removeallclassmethods RsrTokenRejected

doit
(Object
	subclass: 'RsrPlatformInitializer'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication';
		comment: 'Does load-time initialization of any class instance variables of classes defined in Base but that have platform-specific contents and thus can''t be initialized by their own package, and can''t be lazily initialized because that fails on GemStone for non-privileged users.';
		immediateInvariant.
true.
%

removeallmethods RsrPlatformInitializer
removeallclassmethods RsrPlatformInitializer

doit
(Object
	subclass: 'RsrProcessModel'
	instVarNames: #()
	classVars: #()
	classInstVars: #(current)
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Base';
		immediateInvariant.
true.
%

removeallmethods RsrProcessModel
removeallclassmethods RsrProcessModel

doit
(RsrProcessModel
	subclass: 'RsrTestingProcessModel'
	instVarNames: #(forkedException)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Platform-Test';
		immediateInvariant.
true.
%

removeallmethods RsrTestingProcessModel
removeallclassmethods RsrTestingProcessModel

doit
(TestCase
	subclass: 'RsrTestCase'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Platform-Test';
		comment: 'An abstract test class which contains utility methods';
		immediateInvariant.
true.
%

removeallmethods RsrTestCase
removeallclassmethods RsrTestCase

doit
(RsrTestCase
	subclass: 'RsrAsyncMournHandlerTestCase'
	instVarNames: #(handler)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone-Test';
		immediateInvariant.
true.
%

removeallmethods RsrAsyncMournHandlerTestCase
removeallclassmethods RsrAsyncMournHandlerTestCase

doit
(RsrTestCase
	subclass: 'RsrClassResolverTestCase'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Platform-Test';
		immediateInvariant.
true.
%

removeallmethods RsrClassResolverTestCase
removeallclassmethods RsrClassResolverTestCase

doit
(RsrTestCase
	subclass: 'RsrCommandCodecTest'
	instVarNames: #(connection)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrCommandCodecTest
removeallclassmethods RsrCommandCodecTest

doit
(RsrCommandCodecTest
	subclass: 'RsrCommandDecoderTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		comment: 'No class-specific documentation for RsrDecoderTest, hierarchy is:
Object
  TestAsserter
    TestCase( testSelector)
      RsrTestCase
        RsrCodecTest( registry decoder)
          RsrDecoderTest
';
		immediateInvariant.
true.
%

removeallmethods RsrCommandDecoderTest
removeallclassmethods RsrCommandDecoderTest

doit
(RsrCommandCodecTest
	subclass: 'RsrCommandEncoderTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		comment: 'No class-specific documentation for RsrEncoderTest, hierarchy is:
Object
  TestAsserter
    TestCase( testSelector)
      RsrTestCase
        RsrCodecTest( registry decoder)
          RsrEncoderTest( connection)
';
		immediateInvariant.
true.
%

removeallmethods RsrCommandEncoderTest
removeallclassmethods RsrCommandEncoderTest

doit
(RsrTestCase
	subclass: 'RsrConnectionSpecificationTestCase'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrConnectionSpecificationTestCase
removeallclassmethods RsrConnectionSpecificationTestCase

doit
(RsrTestCase
	subclass: 'RsrForwarderTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrForwarderTest
removeallclassmethods RsrForwarderTest

doit
(RsrTestCase
	subclass: 'RsrGarbageCollectorTestCase'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Platform-Test';
		immediateInvariant.
true.
%

removeallmethods RsrGarbageCollectorTestCase
removeallclassmethods RsrGarbageCollectorTestCase

doit
(RsrTestCase
	subclass: 'RsrNumericSpigotTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrNumericSpigotTest
removeallclassmethods RsrNumericSpigotTest

doit
(RsrNumericSpigotTest
	subclass: 'RsrThreadSafeNumericSpigotTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrThreadSafeNumericSpigotTest
removeallclassmethods RsrThreadSafeNumericSpigotTest

doit
(RsrTestCase
	subclass: 'RsrPromiseTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrPromiseTest
removeallclassmethods RsrPromiseTest

doit
(RsrTestCase
	subclass: 'RsrProtocolVersionNegotiationCodecTestCase'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrProtocolVersionNegotiationCodecTestCase
removeallclassmethods RsrProtocolVersionNegotiationCodecTestCase

doit
(RsrTestCase
	subclass: 'RsrSnapshotAnalysisTest'
	instVarNames: #(connection)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		comment: 'No class-specific documentation for RsrSnapshotAnalysisTest, hierarchy is:
Object
  TestAsserter
    TestCase( testSelector)
      RsrTestCase
        RsrSnapshotAnalysisTest
';
		immediateInvariant.
true.
%

removeallmethods RsrSnapshotAnalysisTest
removeallclassmethods RsrSnapshotAnalysisTest

doit
(RsrTestCase
	subclass: 'RsrSocketStreamTestCase'
	instVarNames: #(aStream bStream)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrSocketStreamTestCase
removeallclassmethods RsrSocketStreamTestCase

doit
(RsrTestCase
	subclass: 'RsrSocketTestCase'
	instVarNames: #(sockets)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Platform-Test';
		immediateInvariant.
true.
%

removeallmethods RsrSocketTestCase
removeallclassmethods RsrSocketTestCase

doit
(RsrTestCase
	subclass: 'RsrSystemTestCase'
	instVarNames: #(connectionA connectionB)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrSystemTestCase
removeallclassmethods RsrSystemTestCase

doit
(RsrSystemTestCase
	subclass: 'RsrConnectionTestCase'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrConnectionTestCase
removeallclassmethods RsrConnectionTestCase

doit
(RsrConnectionTestCase
	subclass: 'RsrInMemoryConnectionTestCase'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrInMemoryConnectionTestCase
removeallclassmethods RsrInMemoryConnectionTestCase

doit
(RsrConnectionTestCase
	subclass: 'RsrSocketConnectionTestCase'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrSocketConnectionTestCase
removeallclassmethods RsrSocketConnectionTestCase

doit
(RsrSystemTestCase
	subclass: 'RsrEphemeronMourningDeadlock'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone-Test';
		immediateInvariant.
true.
%

removeallmethods RsrEphemeronMourningDeadlock
removeallclassmethods RsrEphemeronMourningDeadlock

doit
(RsrSystemTestCase
	subclass: 'RsrLifetimeTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrLifetimeTest
removeallclassmethods RsrLifetimeTest

doit
(RsrLifetimeTest
	subclass: 'RsrInMemoryLifetimeTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrInMemoryLifetimeTest
removeallclassmethods RsrInMemoryLifetimeTest

doit
(RsrLifetimeTest
	subclass: 'RsrSocketLifetimeTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrSocketLifetimeTest
removeallclassmethods RsrSocketLifetimeTest

doit
(RsrSystemTestCase
	subclass: 'RsrMessageSendingTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrMessageSendingTest
removeallclassmethods RsrMessageSendingTest

doit
(RsrMessageSendingTest
	subclass: 'RsrInMemoryMessageSendingTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrInMemoryMessageSendingTest
removeallclassmethods RsrInMemoryMessageSendingTest

doit
(RsrMessageSendingTest
	subclass: 'RsrSocketMessageSendingTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrSocketMessageSendingTest
removeallclassmethods RsrSocketMessageSendingTest

doit
(RsrSystemTestCase
	subclass: 'RsrServiceTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrServiceTest
removeallclassmethods RsrServiceTest

doit
(RsrServiceTest
	subclass: 'RsrInMemoryServiceTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrInMemoryServiceTest
removeallclassmethods RsrInMemoryServiceTest

doit
(RsrServiceTest
	subclass: 'RsrSocketServiceTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrSocketServiceTest
removeallclassmethods RsrSocketServiceTest

doit
(RsrSystemTestCase
	subclass: 'RsrSpeciesEquality'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrSpeciesEquality
removeallclassmethods RsrSpeciesEquality

doit
(RsrSpeciesEquality
	subclass: 'RsrInMemorySpeciesEquality'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrInMemorySpeciesEquality
removeallclassmethods RsrInMemorySpeciesEquality

doit
(RsrSpeciesEquality
	subclass: 'RsrSocketSpeciesEquality'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrSocketSpeciesEquality
removeallclassmethods RsrSocketSpeciesEquality

doit
(RsrSystemTestCase
	subclass: 'RsrStressTest'
	instVarNames: #(client server)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrStressTest
removeallclassmethods RsrStressTest

doit
(RsrStressTest
	subclass: 'RsrInMemoryStressTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrInMemoryStressTest
removeallclassmethods RsrInMemoryStressTest

doit
(RsrStressTest
	subclass: 'RsrSocketStressTest'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrSocketStressTest
removeallclassmethods RsrSocketStressTest

doit
(RsrTestCase
	subclass: 'RsrTemplateResolverTestCase'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrTemplateResolverTestCase
removeallclassmethods RsrTemplateResolverTestCase

doit
(RsrTestCase
	subclass: 'RsrTemplateResolverWithClassVersions'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-GemStone-Test';
		immediateInvariant.
true.
%

removeallmethods RsrTemplateResolverWithClassVersions
removeallclassmethods RsrTemplateResolverWithClassVersions

doit
(RsrTestCase
	subclass: 'RsrTestingProcessModelTestCase'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Platform-Test';
		immediateInvariant.
true.
%

removeallmethods RsrTestingProcessModelTestCase
removeallclassmethods RsrTestingProcessModelTestCase

doit
(RsrTestCase
	subclass: 'RsrTokenExchangeCodecTestCase'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'RemoteServiceReplication-Test';
		immediateInvariant.
true.
%

removeallmethods RsrTokenExchangeCodecTestCase
removeallclassmethods RsrTokenExchangeCodecTestCase

! Class implementation for 'RsrConnectionClosed'

!		Class methods for 'RsrConnectionClosed'

category: 'instance creation'
classmethod: RsrConnectionClosed
connection: aConnection

	^self new
		connection: aConnection;
		yourself
%

!		Instance methods for 'RsrConnectionClosed'

category: 'accessing'
method: RsrConnectionClosed
connection
	"The Connection that was closed."

	^connection
%

category: 'accessing'
method: RsrConnectionClosed
connection: aConnection
	"Store the Connection that was closed."

	connection := aConnection
%

! Class implementation for 'RsrAlreadyRegistered'

!		Class methods for 'RsrAlreadyRegistered'

category: 'instance creation'
classmethod: RsrAlreadyRegistered
signalService: aService
intendedConnection: aConnection

	^self new
		service: aService;
		intendedConnection: aConnection;
		signal
%

!		Instance methods for 'RsrAlreadyRegistered'

category: 'accessing'
method: RsrAlreadyRegistered
intendedConnection

	^intendedConnection
%

category: 'accessing'
method: RsrAlreadyRegistered
intendedConnection: aConnection

	intendedConnection := aConnection
%

category: 'accessing'
method: RsrAlreadyRegistered
service

	^service
%

category: 'accessing'
method: RsrAlreadyRegistered
service: aService

	service := aService
%

! Class implementation for 'RsrNonresumableError'

!		Instance methods for 'RsrNonresumableError'

category: 'testing'
method: RsrNonresumableError
isResumable

	^false
%

! Class implementation for 'RsrBrokenPromise'

!		Class methods for 'RsrBrokenPromise'

category: 'signaling'
classmethod: RsrBrokenPromise
signalReason: aReason

	^self new
		reason: aReason;
		signal
%

!		Instance methods for 'RsrBrokenPromise'

category: 'accessing'
method: RsrBrokenPromise
reason

	^reason
%

category: 'accessing'
method: RsrBrokenPromise
reason: aReason

	reason := aReason
%

! Class implementation for 'RsrRemoteError'

!		Class methods for 'RsrRemoteError'

category: 'instance creation'
classmethod: RsrRemoteError
from: anException

	| tag |
	tag := anException tag
		ifNotNil:
			[[anException tag asString]
				on: Error
				do: [:ex | ex return: 'Unable to pack #tag containing an instance of ', anException tag class name]].
	^self new
		originalClassName: anException class name;
		tag: tag;
		messageText: anException messageText;
		stack: RsrProcessModel currentStackDump;
		yourself
%

!		Instance methods for 'RsrRemoteError'

category: 'accessing'
method: RsrRemoteError
originalClassName

	^originalClassName
%

category: 'accessing'
method: RsrRemoteError
originalClassName: aSymbol

	originalClassName := aSymbol
%

category: 'accessing'
method: RsrRemoteError
stack

	^stack
%

category: 'accessing'
method: RsrRemoteError
stack: aString

	stack := aString
%

! Class implementation for 'RsrResumableError'

!		Instance methods for 'RsrResumableError'

category: 'testing'
method: RsrResumableError
isResumable

	^true
%

! Class implementation for 'RsrServiceRejected'

!		Class methods for 'RsrServiceRejected'

category: 'signaling'
classmethod: RsrServiceRejected
signalReason: aReason

	^self new
		reason: aReason;
		signal
%

!		Instance methods for 'RsrServiceRejected'

category: 'accessing'
method: RsrServiceRejected
reason
	"The PolicyRejectedService reason"

	^reason
%

category: 'accessing'
method: RsrServiceRejected
reason: aPolicyRejectedService
	"The PolicyRejectedService reason"

	reason := aPolicyRejectedService
%

! Class implementation for 'RsrUnsupportedObject'

!		Class methods for 'RsrUnsupportedObject'

category: 'exceptioninstantiator'
classmethod: RsrUnsupportedObject
signal: anObject

	^self new
		object: anObject;
		messageText: 'Instances of #', anObject class name, ' do not support replication.';
		signal
%

!		Instance methods for 'RsrUnsupportedObject'

category: 'accessing'
method: RsrUnsupportedObject
object

	^object
%

category: 'accessing'
method: RsrUnsupportedObject
object: anObject

	object := anObject
%

! Class implementation for 'RsrUnhandledException'

!		Class methods for 'RsrUnhandledException'

category: 'signaling'
classmethod: RsrUnhandledException
signal: anException
	"Signal the exception in reference to the provided exception."

	^self new
		exception: anException;
		signal
%

!		Instance methods for 'RsrUnhandledException'

category: 'acccessing'
method: RsrUnhandledException
exception
	"The exception that was unhandled."

	^exception
%

category: 'acccessing'
method: RsrUnhandledException
exception: anException
	"The exception that was unhandled."

	exception := anException
%

! Class implementation for 'RsrObject'

!		Class methods for 'RsrObject'

category: 'tracing'
classmethod: RsrObject
trace

	Transcript
		show: RsrProcessModel currentStackDump;
		cr;
		cr
%

!		Instance methods for 'RsrObject'

category: 'notes'
method: RsrObject
flag: aSymbol

	"Send this message, with a relevant symbol as argument, to flag a message for subsequent retrieval.  For example, you might put the following line in a number of messages:
	self flag: #returnHereUrgently
	Then, to retrieve all such messages, browse all senders of #returnHereUrgently."
%

category: 'delaying'
method: RsrObject
minimalWait
	"Ensure the calling process is not schedulable for a short period of time."

	(Delay forMilliseconds: 1) wait
%

category: 'notes'
method: RsrObject
note: aString
	"This method can be used to leave a note in code. For instance, a code path that needs to be tested."
%

category: 'tracing'
method: RsrObject
trace

	Transcript
		show: RsrProcessModel currentStackDump;
		cr;
		cr
%

! Class implementation for 'RsrAbstractPolicy'

!		Instance methods for 'RsrAbstractPolicy'

category: 'testing'
method: RsrAbstractPolicy
permits: aTemplate
	"Returning true to allow the framework to instantiate 
	a Service received over the Connection."

	self subclassResponsibility
%

! Class implementation for 'RsrDefaultPolicy'

!		Instance methods for 'RsrDefaultPolicy'

category: 'testing'
method: RsrDefaultPolicy
permits: aTemplate
	"Returning true to allow the framework to instantiate 
	a Service received over the Connection."

	^true
%

! Class implementation for 'RsrTestPolicy'

!		Instance methods for 'RsrTestPolicy'

category: 'accessing'
method: RsrTestPolicy
deny: aTemplate

	deniedTemplates add: aTemplate
%

category: 'initialization'
method: RsrTestPolicy
initialize

	super initialize.
	deniedTemplates := Set new
%

category: 'testing'
method: RsrTestPolicy
permits: aTemplate
	"Permit any Template that hasn't been denied"

	^(deniedTemplates includes: aTemplate) not
%

! Class implementation for 'RsrDecodingRaisedException'

!		Class methods for 'RsrDecodingRaisedException'

category: 'instance creation'
classmethod: RsrDecodingRaisedException
exception: anException

	^self new
		exception: anException;
		yourself
%

!		Instance methods for 'RsrDecodingRaisedException'

category: 'accessing'
method: RsrDecodingRaisedException
exception

	^exception
%

category: 'accessing'
method: RsrDecodingRaisedException
exception: anException

	exception := anException
%

! Class implementation for 'RsrService'

!		Class methods for 'RsrService'

category: 'accessing'
classmethod: RsrService
clientClass

	^RsrClassResolver classNamed: self clientClassName
%

category: 'accessing'
classmethod: RsrService
clientClassName

	^(self templateClassName, 'Client') asSymbol
%

category: 'testing'
classmethod: RsrService
isClientClass

	^self name == self clientClassName
%

category: 'testing'
classmethod: RsrService
isServerClass

	^self name == self serverClassName
%

category: 'testing'
classmethod: RsrService
isTemplateClass

	^self name == self templateClassName
%

category: 'accessing'
classmethod: RsrService
serverClass

	^RsrClassResolver classNamed: self serverClassName
%

category: 'accessing'
classmethod: RsrService
serverClassName

	^(self templateClassName, 'Server') asSymbol
%

category: 'accessing'
classmethod: RsrService
templateClass

	^RsrClassResolver classNamed: self templateClassName
%

category: 'accessing'
classmethod: RsrService
templateClassName

	self subclassResponsibility
%

category: 'instance creation'
classmethod: RsrService
_id: anId
connection: aConnection

	^super new
		_id: anId connection: aConnection;
		yourself
%

!		Instance methods for 'RsrService'

category: 'public-events'
method: RsrService
configureProcess
	"#configureProcess is called each time the framework calls into the framework to evaluate generic user code.
	#preUpdate and #postUpdate run in a configuration manner prescribed by the framework."

	Processor activeProcess
		priority: self serviceSchedulingPriority
%

category: 'public-accessing'
method: RsrService
connection
	"Returns the Connection associated w/ the receiver."

	^self _connection
%

category: 'public-debugging'
method: RsrService
debug: anException
raisedDuring: aMessageSend
answerUsing: aResolver

	aResolver break: (RsrRemoteException from: anException)
%

category: 'public-accessing'
method: RsrService
id
	"Returns the Service ID associated w/ the receiver."

	^self _id
%

category: 'public-testing'
method: RsrService
isClient

	^self class isClientClass
%

category: 'public-testing'
method: RsrService
isMirrored

	^_connection ~~ nil
%

category: 'public-testing'
method: RsrService
isNotMirrored

	^self isMirrored not
%

category: 'public-testing'
method: RsrService
isServer

	^self class isServerClass
%

category: 'public-events'
method: RsrService
postRegistration
	"This message is sent immediately after the Service
	is registered with a Connection for the first time.

	The framework views both Client and Server peers as
	the same object. When a peer is created by the
	framework, it will not receive #postRegistration."

	^self
%

category: 'public-events'
method: RsrService
postUpdate
	"#postUpdate is called just after the Service's shared variables are updated by the framework.
	This method can be overridden to ensure internal consistency."

	^self
%

category: 'public-events'
method: RsrService
preUpdate
	"#preUpdate is called just before the Service's shared variables are updated by the framework.
	This method can be overridden to ensure internal consistency.
	Note: If this method raises an exception, RSR will not signal #postUpdate."

	^self
%

category: 'public-registration'
method: RsrService
registerWith: aConnection

	aConnection _ensureRegistered: self
%

category: 'public-events'
method: RsrService
serviceSchedulingPriority

	^Processor userSchedulingPriority
%

category: 'public-synchronization'
method: RsrService
synchronize
	"Synchronize the service w/ its peer."

	remoteSelf == nil
		ifFalse: [remoteSelf _synchronize wait]
%

category: 'public-accessing'
method: RsrService
template
	"Returns the template associated with this Service.
	This method should NOT be redefined."

	^self _template
%

category: 'private-accessing'
method: RsrService
_connection
	"Private - Returns the Connection associated w/ the receiver."

	^_connection
%

category: 'private-accessing'
method: RsrService
_id
	"Private - Returns the Service ID associated w/ the receiver."

	^_id
%

category: 'private-accessing'
method: RsrService
_id: anRsrId
connection: aConnection
	"Private - Configure this Service w/ a Service ID and Connection. This is a side-effect of registering a Service w/ a Connection."

	_id := anRsrId.
	_connection := aConnection.
	remoteSelf := aConnection _forwarderClass on: self
%

category: 'private-synchronization'
method: RsrService
_synchronize
	"Return self to synchronize with the remote peer"

	^self
%

category: 'private-accessing'
method: RsrService
_template
	"Returns the template associated with this Service. General users should use #template."

	^_connection templateResolver templateFor: self
%

! Class implementation for 'RsrConcurrentTestService'

!		Class methods for 'RsrConcurrentTestService'

category: 'accessing'
classmethod: RsrConcurrentTestService
clientClassName

	^#RsrConcurrentTestClient
%

category: 'accessing'
classmethod: RsrConcurrentTestService
serverClassName

	^#RsrConcurrentTestServer
%

category: 'accessing'
classmethod: RsrConcurrentTestService
templateClassName

	^#RsrConcurrentTestService
%

! Class implementation for 'RsrConcurrentTestClient'

!		Instance methods for 'RsrConcurrentTestClient'

category: 'accessing'
method: RsrConcurrentTestClient
counterWithIncrement

	^remoteSelf counterWithIncrement wait
%

category: 'accessing'
method: RsrConcurrentTestClient
delayedCounter

	^remoteSelf delayedCounter wait
%

category: 'actions'
method: RsrConcurrentTestClient
stashProcess

	remoteSelf stashProcess wait
%

! Class implementation for 'RsrConcurrentTestServer'

!		Class methods for 'RsrConcurrentTestServer'

category: 'accessing'
classmethod: RsrConcurrentTestServer
initialCounter

	^0
%

!		Instance methods for 'RsrConcurrentTestServer'

category: 'accessing'
method: RsrConcurrentTestServer
counter: anArray

	counter := anArray
%

category: 'accessing'
method: RsrConcurrentTestServer
counterWithIncrement

	^[counter at: 1] ensure: [counter at: 1 put: (counter at: 1) + 1]
%

category: 'accessing'
method: RsrConcurrentTestServer
delayedCounter

	semaphore signal.
	(Delay forSeconds: 2) wait.
	^counter at: 1
%

category: 'accessing'
method: RsrConcurrentTestServer
semaphore: aSemaphore

	semaphore := aSemaphore
%

category: 'accessing'
method: RsrConcurrentTestServer
stashedProcess

	^stashedProcess
%

category: 'actions'
method: RsrConcurrentTestServer
stashProcess

	stashedProcess := Processor activeProcess
%

! Class implementation for 'RsrInstrumentedService'

!		Class methods for 'RsrInstrumentedService'

category: 'accessing'
classmethod: RsrInstrumentedService
clientClassName

	^#RsrInstrumentedClient
%

category: 'accessing'
classmethod: RsrInstrumentedService
serverClassName

	^#RsrInstrumentedServer
%

category: 'accessing'
classmethod: RsrInstrumentedService
templateClassName

	^#RsrInstrumentedService
%

!		Instance methods for 'RsrInstrumentedService'

category: 'events'
method: RsrInstrumentedService
postRegistration

	self postRegistrationCount: self postRegistrationCount + 1
%

category: 'events'
method: RsrInstrumentedService
postUpdate

	self postUpdateCount: self postUpdateCount + 1
%

category: 'events'
method: RsrInstrumentedService
preUpdate

	self preUpdateCount: self preUpdateCount + 1
%

! Class implementation for 'RsrInstrumentedClient'

!		Instance methods for 'RsrInstrumentedClient'

category: 'accessing'
method: RsrInstrumentedClient
postRegistrationCount

	^postRegistrationCount ifNil: [0]
%

category: 'accessing'
method: RsrInstrumentedClient
postRegistrationCount: anInteger

	postRegistrationCount := anInteger
%

category: 'accessing'
method: RsrInstrumentedClient
postUpdateCount

	^postUpdateCount ifNil: [0]
%

category: 'accessing'
method: RsrInstrumentedClient
postUpdateCount: anInteger

	postUpdateCount := anInteger
%

category: 'accessing'
method: RsrInstrumentedClient
preUpdateCount

	^preUpdateCount ifNil: [0]
%

category: 'accessing'
method: RsrInstrumentedClient
preUpdateCount: anInteger

	preUpdateCount := anInteger
%

category: 'evaluating'
method: RsrInstrumentedClient
return: anObject

	^(remoteSelf return: anObject) wait
%

category: 'evaluating'
method: RsrInstrumentedClient
value

	^remoteSelf evaluateAction wait
%

category: 'evaluating'
method: RsrInstrumentedClient
value: anObject

	^(remoteSelf evaluateAction: anObject) wait
%

! Class implementation for 'RsrInstrumentedServer'

!		Instance methods for 'RsrInstrumentedServer'

category: 'accessing'
method: RsrInstrumentedServer
action

	^action
%

category: 'accessing'
method: RsrInstrumentedServer
action: aBlock

	action := aBlock
%

category: 'evaluating'
method: RsrInstrumentedServer
evaluateAction

	^self action value
%

category: 'evaluating'
method: RsrInstrumentedServer
evaluateAction: anObject

	^self action cull: anObject
%

category: 'accessing'
method: RsrInstrumentedServer
postRegistrationCount

	^postRegistrationCount ifNil: [0]
%

category: 'accessing'
method: RsrInstrumentedServer
postRegistrationCount: anInteger

	postRegistrationCount := anInteger
%

category: 'accessing'
method: RsrInstrumentedServer
postUpdateCount

	^postUpdateCount ifNil: [0]
%

category: 'accessing'
method: RsrInstrumentedServer
postUpdateCount: anInteger

	postUpdateCount := anInteger
%

category: 'accessing'
method: RsrInstrumentedServer
preUpdateCount

	^preUpdateCount ifNil: [0]
%

category: 'accessing'
method: RsrInstrumentedServer
preUpdateCount: anInteger

	preUpdateCount := anInteger
%

category: 'evaluating'
method: RsrInstrumentedServer
return: anObject

	^anObject
%

! Class implementation for 'RsrMockService'

!		Class methods for 'RsrMockService'

category: 'accessing'
classmethod: RsrMockService
clientClassName

	^#RsrMockClient
%

category: 'accessing'
classmethod: RsrMockService
serverClassName

	^#RsrMockServer
%

!		Instance methods for 'RsrMockService'

category: 'initialize'
method: RsrMockService
initialize

	super initialize.
	_id := 1
%

category: 'testing'
method: RsrMockService
isClient

	^self class == RsrMockClient
%

category: 'testing'
method: RsrMockService
isServer

	^self class == RsrMockServer
%

category: 'accessing'
method: RsrMockService
service

	^self
%

! Class implementation for 'RsrPolicyRejectedService'

!		Class methods for 'RsrPolicyRejectedService'

category: 'instance creation'
classmethod: RsrPolicyRejectedService
sid: aSID
templateName: aTemplateName
	"Create an instance of the PolicyRejectedService reason.
	The client is used here because once we send it, we are done with it.
	The client will GC and the server will later GC. We don't care to have
	a server hanging around if we don't need it."

	^self clientClass new
		sid: aSID;
		templateName: aTemplateName;
		yourself
%

category: 'accessing'
classmethod: RsrPolicyRejectedService
templateClassName

	^#RsrPolicyRejectedService
%

!		Instance methods for 'RsrPolicyRejectedService'

category: 'accessing'
method: RsrPolicyRejectedService
sid
	"Service ID"

	^sid
%

category: 'accessing'
method: RsrPolicyRejectedService
sid: aSID
	"Service ID"

	sid := aSID
%

category: 'accessing'
method: RsrPolicyRejectedService
templateName
	"The Template's name"

	^templateName
%

category: 'accessing'
method: RsrPolicyRejectedService
templateName: aTemplateName
	"The Template's name"

	templateName := aTemplateName
%

! Class implementation for 'RsrRemoteException'

!		Class methods for 'RsrRemoteException'

category: 'accessing'
classmethod: RsrRemoteException
clientClassName

	^#RsrRemoteExceptionClient
%

category: 'instance creation'
classmethod: RsrRemoteException
from: anException
	"Create an instance of the RemoteException reason.
	The client is used here because once we send it, we are done with it.
	The client will GC and the server will later GC. We don't care to have
	a server hanging around if we don't need it."

	| tag |
	tag := anException tag
		ifNotNil:
			[[anException tag asString]
				on: Error
				do: [:ex | ex return: 'Unable to pack #tag containing an instance of ', anException tag class name]].
	^self clientClass new
		exceptionClassName: anException class name;
		tag: tag;
		messageText: anException messageText;
		stack: RsrProcessModel currentStackDump;
		yourself
%

category: 'accessing'
classmethod: RsrRemoteException
serverClassName

	^#RsrRemoteExceptionServer
%

category: 'accessing'
classmethod: RsrRemoteException
templateClassName

	^#RsrRemoteException
%

!		Instance methods for 'RsrRemoteException'

category: 'accessing'
method: RsrRemoteException
exceptionClassName

	^exceptionClassName
%

category: 'accessing'
method: RsrRemoteException
exceptionClassName: aSymbol

	exceptionClassName := aSymbol
%

category: 'testing'
method: RsrRemoteException
isRemoteException
	"This is a RemoteException reason"

	^true
%

category: 'accessing'
method: RsrRemoteException
messageText

	^messageText
%

category: 'accessing'
method: RsrRemoteException
messageText: aString

	messageText := aString
%

category: 'printing'
method: RsrRemoteException
printOn: aStream

	aStream
		nextPutAll: exceptionClassName;
		cr;
		nextPutAll: messageText;
		cr;
		nextPutAll: '===================';
		cr;
		nextPutAll: stack
%

category: 'accessing'
method: RsrRemoteException
stack

	^stack
%

category: 'accessing'
method: RsrRemoteException
stack: aString

	stack := aString
%

category: 'accessing'
method: RsrRemoteException
tag

	^tag
%

category: 'accessing'
method: RsrRemoteException
tag: aString

	tag := aString
%

! Class implementation for 'RsrReflectedVariableTestServiceA'

!		Instance methods for 'RsrReflectedVariableTestServiceA'

category: 'accessing'
method: RsrReflectedVariableTestServiceA
varA

	^varA
%

! Class implementation for 'RsrReflectedVariableTestServiceB'

!		Class methods for 'RsrReflectedVariableTestServiceB'

category: 'accessing'
classmethod: RsrReflectedVariableTestServiceB
clientClassName

	^#RsrReflectedVariableTestClient
%

category: 'accessing'
classmethod: RsrReflectedVariableTestServiceB
serverClassName

	^#RsrReflectedVariableTestServer
%

category: 'accessing'
classmethod: RsrReflectedVariableTestServiceB
templateClassName

	^#RsrReflectedVariableTestServiceB
%

!		Instance methods for 'RsrReflectedVariableTestServiceB'

category: 'accessing'
method: RsrReflectedVariableTestServiceB
varB

	^varB
%

! Class implementation for 'RsrReflectedVariableTestClient'

!		Instance methods for 'RsrReflectedVariableTestClient'

category: 'accessing'
method: RsrReflectedVariableTestClient
setVarsToAndReturn: anObject

	^(remoteSelf setVarsToAndReturn: anObject) wait
%

! Class implementation for 'RsrReflectedVariableTestServer'

!		Instance methods for 'RsrReflectedVariableTestServer'

category: 'accessing'
method: RsrReflectedVariableTestServer
setVarsToAndReturn: anObject

	^varA := varB := anObject
%

! Class implementation for 'RsrRemoteAction'

!		Class methods for 'RsrRemoteAction'

category: 'instance creation'
classmethod: RsrRemoteAction
sharedVariable: anObject

	^self new
		sharedVariable: anObject;
		yourself
%

category: 'accessing'
classmethod: RsrRemoteAction
templateClassName

	^#RsrRemoteAction
%

!		Instance methods for 'RsrRemoteAction'

category: 'accessing'
method: RsrRemoteAction
sharedVariable

	^sharedVariable
%

category: 'accessing'
method: RsrRemoteAction
sharedVariable: anObject

	sharedVariable := anObject
%

! Class implementation for 'RsrRemoteActionClient'

!		Instance methods for 'RsrRemoteActionClient'

category: 'evaluating'
method: RsrRemoteActionClient
asyncValue

	^remoteSelf evaluateAction
%

category: 'evaluating'
method: RsrRemoteActionClient
asyncValue: anObject

	^remoteSelf evaluateAction: anObject
%

category: 'evaluating'
method: RsrRemoteActionClient
value

	^self asyncValue wait
%

category: 'evaluating'
method: RsrRemoteActionClient
value: anObject

	^(self asyncValue: anObject) wait
%

! Class implementation for 'RsrRemoteActionServer'

!		Instance methods for 'RsrRemoteActionServer'

category: 'accessing'
method: RsrRemoteActionServer
action

	^action
%

category: 'accessing'
method: RsrRemoteActionServer
action: aBlock

	action := aBlock
%

category: 'debugging'
method: RsrRemoteActionServer
debug: anException
raisedDuring: aMessageSend
answerUsing: aResolver

	^self debugHandler
		value: anException
		value: aMessageSend
		value: aResolver
%

category: 'accessing'
method: RsrRemoteActionServer
debugHandler

	^debugHandler ifNil: [[:x :y :z | nil]]
%

category: 'accessing'
method: RsrRemoteActionServer
debugHandler: aBlock

	debugHandler := aBlock
%

category: 'evaluating'
method: RsrRemoteActionServer
evaluateAction

	^self action value
%

category: 'evaluating'
method: RsrRemoteActionServer
evaluateAction: anObject

	^self action value: anObject
%

category: 'processing'
method: RsrRemoteActionServer
postRegistration

	self postRegistrationHandler value
%

category: 'accessing'
method: RsrRemoteActionServer
postRegistrationHandler

	^postRegistrationHandler ifNil: [[]]
%

category: 'accessing'
method: RsrRemoteActionServer
postRegistrationHandler: aBlock

	postRegistrationHandler := aBlock
%

category: 'processing'
method: RsrRemoteActionServer
postUpdate

	self postUpdateHandler value
%

category: 'accessing'
method: RsrRemoteActionServer
postUpdateHandler

	^postUpdateHandler ifNil: [[]]
%

category: 'accessing'
method: RsrRemoteActionServer
postUpdateHandler: aBlock

	postUpdateHandler := aBlock
%

category: 'processing'
method: RsrRemoteActionServer
preUpdate

	self preUpdateHandler value
%

category: 'accessing'
method: RsrRemoteActionServer
preUpdateHandler

	^preUpdateHandler ifNil: [[]]
%

category: 'accessing'
method: RsrRemoteActionServer
preUpdateHandler: aBlock

	preUpdateHandler := aBlock
%

! Class implementation for 'RsrReturnUnknownService'

!		Class methods for 'RsrReturnUnknownService'

category: 'accessing'
classmethod: RsrReturnUnknownService
clientClassName

	^#RsrDoNotCreateThisClass
%

category: 'accessing'
classmethod: RsrReturnUnknownService
serverClassName

	^#RsrKnownServer
%

category: 'accessing'
classmethod: RsrReturnUnknownService
templateClassName

	^#RsrReturnUnknownService
%

! Class implementation for 'RsrSendUnknownService'

!		Class methods for 'RsrSendUnknownService'

category: 'accessing'
classmethod: RsrSendUnknownService
clientClassName

	^#RsrKnownClient
%

category: 'accessing'
classmethod: RsrSendUnknownService
serverClassName

	^#RsrDoNotCreateThisClass
%

category: 'accessing'
classmethod: RsrSendUnknownService
templateClassName

	^#RsrSendUnknownService
%

! Class implementation for 'RsrServiceNoInstVars'

!		Class methods for 'RsrServiceNoInstVars'

category: 'accessing'
classmethod: RsrServiceNoInstVars
clientClassName

	^#RsrClientNoInstVars
%

category: 'accessing'
classmethod: RsrServiceNoInstVars
serverClassName

	^#RsrServerNoInstVars
%

category: 'accessing'
classmethod: RsrServiceNoInstVars
templateClassName

	^#RsrServiceNoInstVars
%

!		Instance methods for 'RsrServiceNoInstVars'

category: 'testing-methods'
method: RsrServiceNoInstVars
asyncSendReturnArgument: anObject

	^remoteSelf returnArgument: anObject
%

category: 'accessing'
method: RsrServiceNoInstVars
returnArgument: anObject

	^anObject
%

category: 'testing-methods'
method: RsrServiceNoInstVars
sendReturnArgument: anObject

	^(remoteSelf returnArgument: anObject) wait
%

! Class implementation for 'RsrClientNoInstVars'

!		Instance methods for 'RsrClientNoInstVars'

category: 'test selectors'
method: RsrClientNoInstVars
unimplementedRemoteSend
	"Send a selector which is not implemented remotely resuling in a DNU."

	^remoteSelf doNotImplementThisSelectorOrYouWillBreakATest
%

! Class implementation for 'RsrServiceReferenceService'

!		Class methods for 'RsrServiceReferenceService'

category: 'accessing'
classmethod: RsrServiceReferenceService
clientClassName

	^#RsrClientReferenceService
%

category: 'accessing'
classmethod: RsrServiceReferenceService
serverClassName

	^#RsrServerReferenceService
%

category: 'instance creation'
classmethod: RsrServiceReferenceService
service: aService

	^self new
		service: aService;
		yourself
%

category: 'accessing'
classmethod: RsrServiceReferenceService
templateClassName

	^#RsrServiceReferenceService
%

!		Instance methods for 'RsrServiceReferenceService'

category: 'accessing'
method: RsrServiceReferenceService
service
	^ service
%

category: 'accessing'
method: RsrServiceReferenceService
service: anObject
	service := anObject
%

! Class implementation for 'RsrTestService'

!		Class methods for 'RsrTestService'

category: 'accessing'
classmethod: RsrTestService
clientClassName

	^#RsrClientTestService
%

category: 'accessing'
classmethod: RsrTestService
serverClassName

	^#RsrServerTestService
%

category: 'accessing'
classmethod: RsrTestService
templateClassName

	^#RsrTestService
%

!		Instance methods for 'RsrTestService'

category: 'accessing'
method: RsrTestService
remoteSelf

	^remoteSelf
%

category: 'accessing'
method: RsrTestService
sharedVariable

	^sharedVariable
%

category: 'accessing'
method: RsrTestService
sharedVariable: anObject

	sharedVariable := anObject
%

! Class implementation for 'RsrClientTestService'

!		Instance methods for 'RsrClientTestService'

category: 'accessing'
method: RsrClientTestService
privateVariable

	^privateVariable
%

category: 'accessing'
method: RsrClientTestService
privateVariable: anObject

	privateVariable := anObject
%

! Class implementation for 'RsrServerTestService'

!		Instance methods for 'RsrServerTestService'

category: 'accessing'
method: RsrServerTestService
privateVariable

	^privateVariable
%

category: 'accessing'
method: RsrServerTestService
privateVariable: anObject

	privateVariable := anObject
%

! Class implementation for 'RsrValueHolder'

!		Class methods for 'RsrValueHolder'

category: 'accessing'
classmethod: RsrValueHolder
clientClassName

	^#RsrValueHolderClient
%

category: 'accessing'
classmethod: RsrValueHolder
serverClassName

	^#RsrValueHolderServer
%

category: 'accessing'
classmethod: RsrValueHolder
templateClassName

	^#RsrValueHolder
%

category: 'instance creation'
classmethod: RsrValueHolder
value: anRsrObject

	^self new
		value: anRsrObject;
		yourself
%

!		Instance methods for 'RsrValueHolder'

category: 'accessing'
method: RsrValueHolder
value

	^value
%

category: 'accessing'
method: RsrValueHolder
value: anObject

	value := anObject.
	self synchronize
%

! Class implementation for 'RsrVersionService'

!		Class methods for 'RsrVersionService'

category: 'accessing'
classmethod: RsrVersionService
templateClassName

	^#RsrVersionService
%

! Class implementation for 'RsrAbstractTemplateResolver'

!		Instance methods for 'RsrAbstractTemplateResolver'

category: 'resolving'
method: RsrAbstractTemplateResolver
templateFor: aService
	"Resolve the template associated with the provided Service."

	self subclassResponsibility
%

category: 'resolving'
method: RsrAbstractTemplateResolver
templateNamed: aTemplateName
	"Resolve a template with the provided name."

	^self
		templateNamed: aTemplateName
		ifAbsent: [RsrUnknownTemplate signal: aTemplateName]
%

category: 'resolving'
method: RsrAbstractTemplateResolver
templateNamed: aTemplateName
ifAbsent: aBlock
	"Resolve a template with the provided name."

	self flag: 'This should not send #templateClass. This can go away once ServiceSnapshot wire encoding is updated.'.
	^(RsrClassResolver classNamed: aTemplateName ifAbsent: aBlock) templateClass
%

! Class implementation for 'RsrTemplateResolver'

!		Instance methods for 'RsrTemplateResolver'

category: 'resolving'
method: RsrTemplateResolver
templateFor: aService
	"Resolve the template associated with the provided Service."

	| template |
	template := aService class.
	[template isTemplateClass]
		whileFalse: [template := template superclass].
	^template
%

category: 'resolving'
method: RsrTemplateResolver
templateNamed: aTemplateName
ifAbsent: aBlock
	"Resolve a template with the provided name."

	self flag: 'This should not send #templateClass. This can go away once ServiceSnapshot wire encoding is updated.'.
	^(RsrClassResolver classNamed: aTemplateName ifAbsent: [^aBlock value]) templateClass
%

! Class implementation for 'RsrAsyncMournHandler'

!		Class methods for 'RsrAsyncMournHandler'

category: 'accessing'
classmethod: RsrAsyncMournHandler
current

	^SessionTemps current
		at: #CurrentRsrAsyncEventHandler
		ifAbsentPut: [super new]
%

category: 'instance creation'
classmethod: RsrAsyncMournHandler
new

	^RsrError signal: '', self name, ' is a singleton. See #current.'
%

!		Instance methods for 'RsrAsyncMournHandler'

category: 'lifecycle'
method: RsrAsyncMournHandler
ensureStarted
	"Ensure that the handler is currently active."

	self isActive ifFalse: [self start]
%

category: 'initializing'
method: RsrAsyncMournHandler
initialize

	super initialize.
	isActive := false
%

category: 'testing'
method: RsrAsyncMournHandler
isActive

	^isActive
%

category: 'accessing'
method: RsrAsyncMournHandler
process

	^process
%

category: 'other'
method: RsrAsyncMournHandler
runLoop

	[[self isActive]
		whileTrue:
			[[notifier readNotification]
				on: GcFinalizeNotification
				do: [:ex | ex _finalizeEphemerons]]]
		on: SocketError
		do: [:ex | ex return]
%

category: 'lifecycle'
method: RsrAsyncMournHandler
start

	[notifier := GsSignalingSocket newForAsyncExceptions: {GcFinalizeNotification }.
	notifier interrupting: true]
		on: SocketError
		do:
			[:ex |
			RsrNotification signal: 'Async event notifications are already being processed by an external process. Aborting async event processing in RSR.'.
			^self].
	process := RsrProcessModel
		fork:
			[[isActive := true.
			self runLoop]
				ensure:
					[GsSignalingSocket disableAsyncExceptions.
					process := nil.
					notifier := nil.
					isActive := false]]
		at: Processor highIOPriority + 1
		named: 'Ephemeron Mourning Process'
%

category: 'lifecycle'
method: RsrAsyncMournHandler
stop
	"Stop processing Asynchronous Events"

	self isActive
		ifTrue:
			[GsSignalingSocket disableAsyncExceptions.
			Processor yield]
%

! Class implementation for 'RsrBufferedSocketStream'

!		Class methods for 'RsrBufferedSocketStream'

category: 'instance creation'
classmethod: RsrBufferedSocketStream
on: aSocketStream

	^self new
		stream: aSocketStream;
		yourself
%

!		Instance methods for 'RsrBufferedSocketStream'

category: 'writing'
method: RsrBufferedSocketStream
atEnd

	^stream atEnd
%

category: 'writing'
method: RsrBufferedSocketStream
checkAutoFlush

	nextToWrite > 4096
		ifTrue: [ self flush ]
%

category: 'writing'
method: RsrBufferedSocketStream
close

	stream close
%

category: 'writing'
method: RsrBufferedSocketStream
flush

	writePosition = nextToWrite
		ifTrue: [^self].
	stream nextPutAll: (outBuffer copyFrom: writePosition to: nextToWrite - 1).
	writePosition := nextToWrite := 1.
	stream flush
%

category: 'writing'
method: RsrBufferedSocketStream
growOutBufferTo: aNumberOfBytes

	| rounding |
	rounding := ((aNumberOfBytes \\ 4096) + 1) * 4096.
	outBuffer := outBuffer , (ByteArray new: rounding - outBuffer size)
%

category: 'initialization'
method: RsrBufferedSocketStream
initialize

	super initialize.
	outBuffer := ByteArray new: 4096.
	nextToWrite := 1.
	writePosition := 1
%

category: 'writing'
method: RsrBufferedSocketStream
isConnected

	^stream isConnected
%

category: 'writing'
method: RsrBufferedSocketStream
next

	^self next: 1
%

category: 'writing'
method: RsrBufferedSocketStream
next: aCount

	^stream next: aCount
%

category: 'writing'
method: RsrBufferedSocketStream
nextPutAll: aByteArray

	(outBuffer size >= (aByteArray size + nextToWrite))
		ifFalse: [self growOutBufferTo: outBuffer size + nextToWrite].
	outBuffer
		replaceFrom: nextToWrite
		to: nextToWrite + aByteArray size - 1
		with: aByteArray
		startingAt: 1.
	nextToWrite := nextToWrite + aByteArray size.
	self checkAutoFlush
%

category: 'accessing'
method: RsrBufferedSocketStream
stream: aStream

	stream := aStream
%

! Class implementation for 'RsrChannel'

!		Instance methods for 'RsrChannel'

category: 'accessing'
method: RsrChannel
addCommunicationProcessesTo: aSet
	"Add all processes used for Communication to the provided set."
	
	self subclassResponsibility
%

category: 'lifecycle'
method: RsrChannel
close
	"Ensure the channel is closed to further communication."

	^self subclassResponsibility
%

category: 'accessing'
method: RsrChannel
connection

	^connection
%

category: 'accessing'
method: RsrChannel
connection: aConnection

	connection := aConnection
%

category: 'events'
method: RsrChannel
genericError: anError

	^self connection unknownError: anError
%

category: 'testing'
method: RsrChannel
isConnected
	"Report whether the Channel is open between Connections."

	^self subclassResponsibility
%

category: 'accessing'
method: RsrChannel
log

	^self connection log
%

category: 'lifecycle'
method: RsrChannel
open
	"Ensure the channel is open and ready for communication."

	^self subclassResponsibility
%

category: 'events'
method: RsrChannel
received: aCommand
	"A command has come in over the channel. Propogate it to the Connection."

	self connection _receivedCommand: aCommand
%

category: 'events'
method: RsrChannel
send: aCommand
	"Send the provided command over the channel."

	^self subclassResponsibility
%

! Class implementation for 'RsrBinaryStreamChannel'

!		Class methods for 'RsrBinaryStreamChannel'

category: 'instance creation'
classmethod: RsrBinaryStreamChannel
inStream: inStream
outStream: outStream

	^self new
		inStream: inStream;
		outStream: outStream;
		yourself
%

!		Instance methods for 'RsrBinaryStreamChannel'

category: 'accessing'
method: RsrBinaryStreamChannel
addCommunicationProcessesTo: aSet
	"Add all processes used for Communication to the provided set."

	sink addCommunicationProcessesTo: aSet.
	source addCommunicationProcessesTo: aSet
%

category: 'lifecycle'
method: RsrBinaryStreamChannel
close
	"Shutdown the Command sink and source."

	source stop.
	sink stop.
	outStream
		flush;
		close.
	inStream close
%

category: 'lifecycle'
method: RsrBinaryStreamChannel
disconnected
	"The socket has disconnected so the channel is no longer open."

	self connection channelDisconnected
%

category: 'initializing'
method: RsrBinaryStreamChannel
initialize

	super initialize.
	source := RsrCommandSource on: self.
	sink := RsrCommandSink on: self
%

category: 'accessing'
method: RsrBinaryStreamChannel
inStream
	"Returns the stream associated w/ reading"

	^inStream
%

category: 'accessing'
method: RsrBinaryStreamChannel
inStream: aBinaryReadStream
	"Sets the stream associated w/ reading"

	inStream := aBinaryReadStream
%

category: 'testing'
method: RsrBinaryStreamChannel
isConnected

	^self inStream atEnd not and: [self outStream atEnd not]
%

category: 'lifecycle'
method: RsrBinaryStreamChannel
open
	"Ensure the Command sink and source are running"

	source start.
	sink start
%

category: 'accessing'
method: RsrBinaryStreamChannel
outStream
	"Returns the stream associated w/ writing"

	^outStream
%

category: 'accessing'
method: RsrBinaryStreamChannel
outStream: aBinaryWriteStream
	"Sets the stream associated w/ writing"

	outStream := aBinaryWriteStream
%

category: 'command processing'
method: RsrBinaryStreamChannel
send: aCommand
	"Send the provided command over the channel"

	sink enqueue: aCommand
%

category: 'accessing'
method: RsrBinaryStreamChannel
sink

	^sink
%

category: 'accessing'
method: RsrBinaryStreamChannel
source

	^source
%

! Class implementation for 'RsrInMemoryChannel'

!		Class methods for 'RsrInMemoryChannel'

category: 'instance creation'
classmethod: RsrInMemoryChannel
inQueue: inQueue
outQueue: outQueue

	^self new
		inQueue: inQueue;
		outQueue: outQueue;
		yourself
%

!		Instance methods for 'RsrInMemoryChannel'

category: 'accessing'
method: RsrInMemoryChannel
addCommunicationProcessesTo: aSet
	"Add all processes used for Communication to the provided set."
	
	aSet add: drainProcess 
%

category: 'lifecycle'
method: RsrInMemoryChannel
close

	outQueue nextPut: nil.
	inQueue nextPut: nil
%

category: 'processing'
method: RsrInMemoryChannel
drainLoop

	| command |
	[command := inQueue next.
	command isNil]
		whileFalse:
			[self received: command].
	self connection channelDisconnected
%

category: 'accessing'
method: RsrInMemoryChannel
inQueue

	^inQueue
%

category: 'accessing'
method: RsrInMemoryChannel
inQueue: aSharedQueue

	inQueue := aSharedQueue
%

category: 'testing'
method: RsrInMemoryChannel
isConnected

	^drainProcess isNil not
%

category: 'lifecycle'
method: RsrInMemoryChannel
open

	drainProcess := RsrProcessModel
		fork:
			[RsrProcessModel configureCommunicationsProcess.
			self drainLoop.
			drainProcess := nil]
		named: 'InMemoryChannel Receiving'
%

category: 'accessing'
method: RsrInMemoryChannel
outQueue

	^outQueue
%

category: 'accessing'
method: RsrInMemoryChannel
outQueue: aSharedQueue

	outQueue := aSharedQueue
%

category: 'lifecycle'
method: RsrInMemoryChannel
send: aCommand

	outQueue nextPut: aCommand
%

! Class implementation for 'RsrNullChannel'

!		Instance methods for 'RsrNullChannel'

category: 'lifecycle'
method: RsrNullChannel
close

	"NOP"
%

category: 'testing'
method: RsrNullChannel
isConnected

	^true
%

category: 'accessing'
method: RsrNullChannel
lastCommand

	^lastCommand
%

category: 'lifecycle'
method: RsrNullChannel
open

	"NOP"
%

category: 'events'
method: RsrNullChannel
received: aCommand

	lastCommand := aCommand
%

category: 'events'
method: RsrNullChannel
send: aCommand

	lastCommand := aCommand
%

! Class implementation for 'RsrClassResolver'

!		Class methods for 'RsrClassResolver'

category: 'accessing'
classmethod: RsrClassResolver
classNamed: aSymbol

	^self
		classNamed: aSymbol
		ifAbsent: [RsrUnknownClass signal: aSymbol]
%

category: 'accessing'
classmethod: RsrClassResolver
classNamed: aSymbol
ifAbsent: aBlock

	| assoc |
	assoc := System myUserProfile resolveSymbol: aSymbol.
	^assoc
		ifNil: aBlock
		ifNotNil: [assoc value]
%

! Class implementation for 'RsrCodec'

!		Instance methods for 'RsrCodec'

category: 'converting'
method: RsrCodec
bytesAsInteger: bytes

	| res |
	res := 0.
	bytes do: [:e | res := (res bitShift: 8) bitOr: e].
	^res
%

category: 'accessing'
method: RsrCodec
controlWordMax

	^(2 raisedTo: 63) - 1
%

category: 'accessing'
method: RsrCodec
controlWordMin

	^(2 raisedTo: 63) negated
%

category: 'decoding'
method: RsrCodec
decodeControlWord: aStream

	| bytes unsignedResult |
	bytes := aStream next: self sizeOfInteger.
	unsignedResult := self bytesAsInteger: bytes.
	^unsignedResult > self controlWordMax
		ifTrue: [(2 raisedTo: 64) negated + unsignedResult]
		ifFalse: [unsignedResult]
%

category: 'encoding'
method: RsrCodec
encodeControlWord: anInteger
onto: aStream

	| encodedInteger encodedBytes |
	(anInteger between: self controlWordMin and: self controlWordMax)
		ifFalse: [self error: anInteger printString, ' is outside the supported size of a control word.'].
	encodedInteger := (anInteger positive
		ifTrue: [anInteger]
		ifFalse: [(2 raisedTo: 64) + anInteger]).
	encodedBytes := self
		integerAsByteArray: encodedInteger
		ofSize: self sizeOfInteger.
	aStream nextPutAll: encodedBytes
%

category: 'converting'
method: RsrCodec
integerAsByteArray: anInteger
ofSize: aNumberOfBytes

	| bytes int |
	bytes := ByteArray new: aNumberOfBytes.
	int := anInteger.
	aNumberOfBytes
		to: 1
		by: -1
		do:
			[:i | | byte |
			byte := int bitAnd: 16rFF.
			int := int bitShift: -8.
			bytes at: i put: byte].
	int ~= 0
		ifTrue: [self error: 'Loss of precision detected'].
	^bytes
%

category: 'accessing'
method: RsrCodec
sizeOfInteger
	"Return the number of bytes used to encode an integer"

	^8
%

! Class implementation for 'RsrCommandCodec'

!		Instance methods for 'RsrCommandCodec'

category: 'private-accessing-commands'
method: RsrCommandCodec
deliverErrorResponseCommand

	^4
%

category: 'private-accessing-commands'
method: RsrCommandCodec
deliverResponseCommand

	^2
%

category: 'private-accessing'
method: RsrCommandCodec
immediateOID

	^0
%

category: 'private-accessing-commands'
method: RsrCommandCodec
releaseObjectsCommand

	^3
%

category: 'private-accessing-commands'
method: RsrCommandCodec
sendMessageCommand

	^1
%

! Class implementation for 'RsrCommandDecoder'

!		Class methods for 'RsrCommandDecoder'

category: 'instance creation'
classmethod: RsrCommandDecoder
registry: aRegistry

	^self new
		registry: aRegistry;
		yourself
%

!		Instance methods for 'RsrCommandDecoder'

category: 'decoding-commands'
method: RsrCommandDecoder
decodeCommand: aStream
	"Decode an object from the stream"

	| command |
	command := self decodeControlWord: aStream.
	command == self sendMessageCommand ifTrue: [^self decodeSendMessage: aStream].
	command == self deliverResponseCommand ifTrue: [^self decodeDeliverResponse: aStream].
	command == self releaseObjectsCommand ifTrue: [^self decodeReleaseServices: aStream].
	^RsrError signal: 'Unknown command identifier: ', command printString
%

category: 'decoding-commands'
method: RsrCommandDecoder
decodeDeliverResponse: aStream

    | transaction numServices serviceSnapshots response |
    transaction := self decodeControlWord: aStream.
    numServices := self decodeControlWord: aStream.
    serviceSnapshots := (1 to: numServices) collect: [:each | self decodeServiceSnapshot: aStream].
    response := self decodeReference: aStream.
    ^RsrDeliverResponse new
        transaction: transaction;
        snapshots: serviceSnapshots;
        response: response;
        yourself
%

category: 'decoding-services'
method: RsrCommandDecoder
decodeImmediateReference: aStream

	| referenceType |
	referenceType := self decodeControlWord: aStream.
	^(self instanceOfImmediate: referenceType)
		decode: aStream
		using: self
%

category: 'decoding'
method: RsrCommandDecoder
decodeReference: aStream

	| oid |
	oid := self decodeControlWord: aStream.
	oid = self immediateOID ifTrue: [^self decodeImmediateReference: aStream].
	^RsrServiceReference sid: oid
%

category: 'decoding-commands'
method: RsrCommandDecoder
decodeReleaseServices: aStream

	| count oids |
	count := self decodeControlWord: aStream.
	oids := Array new: count.
	1
		to: count
		do:
			[:i | | oid |
			oid := self decodeControlWord: aStream.
			oids at: i put: oid].
	^RsrReleaseServices sids: oids
%

category: 'decoding-commands'
method: RsrCommandDecoder
decodeSendMessage: aStream

	| transaction argCount receiverReference selector numServices serviceSnapshots arguments instance |
	transaction := self decodeControlWord: aStream.
	numServices := self decodeControlWord: aStream.
	serviceSnapshots := (1 to: numServices) collect: [:each | self decodeServiceSnapshot: aStream].
	receiverReference := self decodeReference: aStream.
	selector := self decodeReference: aStream.
	argCount := self decodeControlWord: aStream.
	arguments := (1 to: argCount) collect: [:each | self decodeReference: aStream].
	instance := RsrSendMessage
		transaction: transaction
		receiverReference: receiverReference
		selectorReference: selector
		argumentReferences: arguments.
	instance snapshots: serviceSnapshots.
	^instance
%

category: 'decoding-services'
method: RsrCommandDecoder
decodeServiceSnapshot: aStream

	| snapshot |
	snapshot := RsrServiceSnapshot new.
	snapshot
		decode: aStream
		using: self.
	^snapshot
%

category: 'decoding-services'
method: RsrCommandDecoder
instanceOfImmediate: aReferenceType

	aReferenceType = 1
		ifTrue: [^RsrSymbolReference new].
	aReferenceType = 2
		ifTrue: [^RsrStringReference new].
	aReferenceType = 3
		ifTrue: [^RsrPositiveIntegerReference new].
	aReferenceType = 4
		ifTrue: [^RsrNegativeIntegerReference new].
	aReferenceType = 5
		ifTrue: [^RsrCharacterReference new].
	aReferenceType = 6
		ifTrue: [^RsrNilReference new].
	aReferenceType = 7
		ifTrue: [^RsrTrueReference new].
	aReferenceType = 8
		ifTrue: [^RsrFalseReference new].
	aReferenceType = 9
		ifTrue: [^RsrArrayReference new].
	aReferenceType = 10
		ifTrue: [^RsrByteArrayReference new].
	aReferenceType = 11
		ifTrue: [^RsrSetReference new].
	aReferenceType = 12
		ifTrue: [^RsrOrderedCollectionReference new].
	aReferenceType = 13
		ifTrue: [^RsrDictionaryReference new].
	aReferenceType = 14
		ifTrue: [^RsrDateAndTimeReference new].
	aReferenceType = 15
		ifTrue: [^RsrDoubleReference new].
	self error: 'ReferenceType(', aReferenceType printString, ') not yet implemented'.
%

! Class implementation for 'RsrCommandEncoder'

!		Instance methods for 'RsrCommandEncoder'

category: 'private-encoding'
method: RsrCommandEncoder
encodeDeliverResponse: aDeliverResponse

	^ByteArray streamContents: [:stream | self encodeDeliverResponse: aDeliverResponse onto: stream]
%

category: 'private-encoding'
method: RsrCommandEncoder
encodeDeliverResponse: aDeliverResponse
onto: aStream

	self
		encodeControlWord: self deliverResponseCommand
		onto: aStream.
	self
		encodeControlWord: aDeliverResponse transaction
		onto: aStream.
	self
		encodeControlWord: aDeliverResponse snapshots size
		onto: aStream.
	aDeliverResponse snapshots do: [:each | self encodeServiceSnapshot: each onto: aStream].
	self
		encodeReference: aDeliverResponse response
		onto: aStream
%

category: 'private-encoding'
method: RsrCommandEncoder
encodeReference: aReference
onto: aStream

	aReference
		encode: aStream
		using: self
%

category: 'private-encoding'
method: RsrCommandEncoder
encodeReleaseServices: aReleaseServices

	^ByteArray streamContents: [:stream | self encodeReleaseServices: aReleaseServices onto: stream]
%

category: 'private-encoding'
method: RsrCommandEncoder
encodeReleaseServices: aReleaseServices
onto: aStream

	self
		encodeControlWord: self releaseObjectsCommand
		onto: aStream.
	self
		encodeControlWord: aReleaseServices sids size
		onto: aStream.
	aReleaseServices sids
		do:
			[:sid |
			self
				encodeControlWord: sid
				onto: aStream]
%

category: 'private-encoding'
method: RsrCommandEncoder
encodeSendMessage: aSendMessage

	^ByteArray streamContents: [:stream | self encodeSendMessage: aSendMessage onto: stream]
%

category: 'private-encoding'
method: RsrCommandEncoder
encodeSendMessage: aSendMessage
onto: aStream

	self
		encodeControlWord: self sendMessageCommand
		onto: aStream.
	self
		encodeControlWord: aSendMessage transaction
		onto: aStream.
	self
		encodeControlWord: aSendMessage snapshots size
		onto: aStream.
	aSendMessage snapshots
		do:
			[:each |
			self
				encodeServiceSnapshot: each
				onto: aStream].
	self
		encodeReference:  aSendMessage receiverReference
		onto: aStream.
	self
		encodeReference: aSendMessage selectorReference
		onto: aStream.
	self
		encodeControlWord: aSendMessage argumentReferences size
		onto: aStream.
	aSendMessage argumentReferences
		do:
			[:each |
			self
				encodeReference: each
				onto: aStream]
%

category: 'encoding'
method: RsrCommandEncoder
encodeServiceSnapshot: aServiceSnapshot

	^ByteArray
		streamContents:
			[:stream |
			self
				encodeServiceSnapshot: aServiceSnapshot
				onto: stream]
%

category: 'private-encoding'
method: RsrCommandEncoder
encodeServiceSnapshot: aServiceSnapshot
onto: aStream

	aServiceSnapshot
		encode: aStream
		using: self
%

! Class implementation for 'RsrProtocolVersionNegotiationCodec'

!		Instance methods for 'RsrProtocolVersionNegotiationCodec'

category: 'accessing'
method: RsrProtocolVersionNegotiationCodec
chosenVersionIdentifier

	^1
%

category: 'decoding'
method: RsrProtocolVersionNegotiationCodec
decode: aStream
	"Decode a message from <aStream>"

	| identifier |
	identifier := self decodeControlWord: aStream.
	identifier = self supportedVersionsIdentifier
		ifTrue: [^self decodeSupportedVersions: aStream].
	identifier = self chosenVersionIdentifier
		ifTrue: [^self decodeChosenVersion: aStream].
	identifier = self noVersionOverlapIdentifier
		ifTrue: [^self decodeNoVersionOverlap: aStream].
	^RsrProtocolVersionNegotiationFailed signal: 'Unknown identifier: ', identifier printString
%

category: 'decoding'
method: RsrProtocolVersionNegotiationCodec
decodeChosenVersion: aStream

	| version |
	version := self decodeControlWord: aStream.
	^RsrChosenVersion version: version
%

category: 'decoding'
method: RsrProtocolVersionNegotiationCodec
decodeNoVersionOverlap: aStream

	^RsrNoVersionOverlap new
%

category: 'decoding'
method: RsrProtocolVersionNegotiationCodec
decodeSupportedVersions: aStream

	| numberOfVersions versions |
	numberOfVersions := self decodeControlWord: aStream.
	versions := (1 to: numberOfVersions) collect: [:each | self decodeControlWord: aStream].
	^RsrSupportedVersions versions: versions
%

category: 'encoding'
method: RsrProtocolVersionNegotiationCodec
encodeChosenVersion: aChosenVersion
onto: aStream

	self
		encodeControlWord: self chosenVersionIdentifier
		onto: aStream.
	self
		encodeControlWord: aChosenVersion version
		onto: aStream
%

category: 'encoding'
method: RsrProtocolVersionNegotiationCodec
encodeNoVersionOverlap: aNoVersionOverlap
onto: aStream

	self
		encodeControlWord: self noVersionOverlapIdentifier
		onto: aStream
%

category: 'encoding'
method: RsrProtocolVersionNegotiationCodec
encodeSupportedVersions: aSupportedVersions
onto: aStream

	| versions |
	versions := aSupportedVersions versions.
	self
		encodeControlWord: self supportedVersionsIdentifier
		onto: aStream.
	self
		encodeControlWord: versions size
		onto: aStream.
	versions do: [:each | self encodeControlWord: each onto: aStream]
%

category: 'accessing'
method: RsrProtocolVersionNegotiationCodec
noVersionOverlapIdentifier

	^2
%

category: 'accessing'
method: RsrProtocolVersionNegotiationCodec
supportedVersionsIdentifier

	^0
%

! Class implementation for 'RsrTokenExchangeCodec'

!		Instance methods for 'RsrTokenExchangeCodec'

category: 'decoding'
method: RsrTokenExchangeCodec
decode: aStream

	| identifier |
	identifier := self decodeControlWord: aStream.
	identifier = self tokenIdentifier
		ifTrue: [^self decodeToken: aStream].
	identifier = self tokenAcceptedIdentifier
		ifTrue: [^RsrTokenAccepted new].
	identifier = self tokenRejectedIdentifier
		ifTrue: [^RsrTokenRejected new].
	^RsrTokenExchangeFailed signal: 'Unknown identifier: ', identifier printString
%

category: 'decoding'
method: RsrTokenExchangeCodec
decodeToken: aStream

	| size |
	size := self decodeControlWord: aStream.
	^RsrToken bytes: (aStream next: size)
%

category: 'encoding'
method: RsrTokenExchangeCodec
encodeToken: aToken
onto: aStream

	self
		encodeControlWord: self tokenIdentifier
		onto: aStream.
	self
		encodeControlWord: aToken bytes size
		onto: aStream.
	aStream nextPutAll: aToken bytes
%

category: 'encoding'
method: RsrTokenExchangeCodec
encodeTokenAccepted: aTokenAccepted
onto: aStream

	self
		encodeControlWord: self tokenAcceptedIdentifier
		onto: aStream
%

category: 'encoding'
method: RsrTokenExchangeCodec
encodeTokenRejected: aTokenRejected
onto: aStream

	self
		encodeControlWord: self tokenRejectedIdentifier
		onto: aStream
%

category: 'accessing'
method: RsrTokenExchangeCodec
tokenAcceptedIdentifier

	^1
%

category: 'accessing'
method: RsrTokenExchangeCodec
tokenIdentifier

	^0
%

category: 'accessing'
method: RsrTokenExchangeCodec
tokenRejectedIdentifier

	^2
%

! Class implementation for 'RsrCommand'

!		Instance methods for 'RsrCommand'

category: 'encoding'
method: RsrCommand
encode: aStream
using: anEncoder

	self subclassResponsibility
%

category: 'executing'
method: RsrCommand
executeFor: aConnection

	self subclassResponsibility
%

category: 'reporting'
method: RsrCommand
reportOn: aLog

	self subclassResponsibility
%

! Class implementation for 'RsrMessagingCommand'

!		Instance methods for 'RsrMessagingCommand'

category: 'executing'
method: RsrMessagingCommand
reifyAllIn: aConnection

	| servicesStrongly |
	"Must keep a strong reference to each service until we're sure a parent service is reified"
	servicesStrongly := snapshots collect: [ :each | 
		                    (each instanceIn: aConnection) preUpdate ].
	snapshots do: [ :each | each reifyIn: aConnection ].
	servicesStrongly do: [ :each | each postUpdate ].
	^ servicesStrongly "Sender must keep a strong reference until the root is anchored."
%

category: 'accessing'
method: RsrMessagingCommand
snapshots

	^snapshots
%

category: 'accessing'
method: RsrMessagingCommand
snapshots: anArrayOfSnapshots

	snapshots := anArrayOfSnapshots
%

category: 'accessing'
method: RsrMessagingCommand
transaction
	^ transaction
%

category: 'accessing'
method: RsrMessagingCommand
transaction: anObject
	transaction := anObject
%

! Class implementation for 'RsrDeliverResponse'

!		Class methods for 'RsrDeliverResponse'

category: 'instance creation'
classmethod: RsrDeliverResponse
transaction: aTransactionId
responseReference: aReference
snapshots: anArrayOfSnapshots

	^self new
		transaction: aTransactionId;
		responseReference: aReference;
		snapshots: anArrayOfSnapshots;
		yourself
%

!		Instance methods for 'RsrDeliverResponse'

category: 'encoding'
method: RsrDeliverResponse
encode: aStream
using: anEncoder

	anEncoder
		encodeDeliverResponse: self
		onto: aStream
%

category: 'executing'
method: RsrDeliverResponse
executeFor: aConnection

	| pendingMessage result servicesStrongly |
	pendingMessage := aConnection pendingMessages
		                  removeKey: self transaction
		                  ifAbsent: [ 
		                  ^ self reportUnknownTransactionIn: aConnection ].
	"Must keep a strong reference to each service until the roots are referenced."
	[ 
	servicesStrongly := self reifyAllIn: aConnection.
	result := self responseReference resolve: aConnection.
	"result should now be the root of the services graph"
	servicesStrongly := nil.
	result first == #fulfill
		ifTrue: [ pendingMessage promise fulfill: result last ]
		ifFalse: [ pendingMessage promise break: result last ] ]
		on: Error
		do: [ :ex | 
			pendingMessage promise break:
				(RsrDecodingRaisedException exception: ex) ]
%

category: 'reporting'
method: RsrDeliverResponse
reportOn: aLog

	aLog debug: 'RsrDeliverResponse(', self response class name, ')'
%

category: 'reporting'
method: RsrDeliverResponse
reportUnknownTransactionIn: aConnection

	aConnection log error: 'Unknown transaction (', self transaction asString, ') while processing Response'
%

category: 'accessing'
method: RsrDeliverResponse
response

	^self responseReference
%

category: 'accessing'
method: RsrDeliverResponse
response: anObject

	^self responseReference: anObject
%

category: 'accessing'
method: RsrDeliverResponse
responseReference

	^responseReference
%

category: 'accessing'
method: RsrDeliverResponse
responseReference: aReference

	responseReference := aReference
%

! Class implementation for 'RsrSendMessage'

!		Class methods for 'RsrSendMessage'

category: 'instance creation'
classmethod: RsrSendMessage
transaction: aTransactionId
receiverReference: aServiceReference
selectorReference: aSelectorReference
argumentReferences: anArrayOfReferences

	^self new
		transaction: aTransactionId;
		receiverReference: aServiceReference;
		selectorReference: aSelectorReference;
		argumentReferences: anArrayOfReferences;
		yourself
%

!		Instance methods for 'RsrSendMessage'

category: 'accessing'
method: RsrSendMessage
argumentReferences

	^argumentReferences
%

category: 'accessing'
method: RsrSendMessage
argumentReferences: anArrayOfReferences

	argumentReferences := anArrayOfReferences
%

category: 'encoding'
method: RsrSendMessage
encode: aStream
using: anEncoder

	anEncoder
		encodeSendMessage: self
		onto: aStream
%

category: 'executing'
method: RsrSendMessage
executeFor: aConnection

	| resolver servicesStrongly receiver selector arguments messageSend |
	resolver := RsrRemotePromiseResolver for: self over: aConnection.
	"Must keep a strong reference to each service until the roots are referenced."
	[[RsrProcessModel configureUnhandleExceptionProtection.
	[servicesStrongly := self reifyAllIn: aConnection]
		on: RsrServiceRejected
		do: [:ex | resolver break: ex reason. ^self].
	receiver := self receiverReference resolve: aConnection.
	selector := self selectorReference resolve: aConnection.
	arguments := self argumentReferences collect: [:each | each resolve: aConnection].
	RsrProcessModel renameProcess: '', receiver class name, '>>', selector.
	"receiver and arguments should now be the roots of the service graph, discard strong references."
	servicesStrongly := nil.
	resolver addRoot: receiver. "Ensure we always send back the receiver -- this ensures sending a message results in by-directional syncing."
	messageSend := RsrMessageSend
		               receiver: receiver
		               selector: selector
		               arguments: arguments.
	self perform: messageSend answerUsing: resolver]
		on: self unhandledExceptionClass
		do: [:ex | 
			resolver break: (RsrRemoteException from: ex exception).
			ex return]]
		ensure:
			[resolver hasResolved
				ifFalse: [resolver break: 'Message send terminated without a result']]
%

category: 'reporting'
method: RsrSendMessage
logException: anException
to: aLog

	| message |
	message := String
		streamContents:
			[:stream |
			stream
				print: self receiverReference;
				nextPutAll: '>>';
				print: self selectorReference;
				nextPutAll: ' due to: ';
				nextPutAll: anException description].
	aLog error: message
%

category: 'executing'
method: RsrSendMessage
perform: aMessageSend
answerUsing: aResolver

	[| result |
	aMessageSend receiver configureProcess.
	result := aMessageSend perform.
	RsrProcessModel configureFrameworkProcess.
	aResolver fulfill: result]
		on: self unhandledExceptionClass
		do:
			[:ex | | debugResult |
			debugResult := [aMessageSend receiver
									debug: ex exception
									raisedDuring: aMessageSend
									answerUsing: aResolver]
									on: self unhandledExceptionClass
									do:
										[:debugEx |
										RsrProcessModel configureFrameworkProcess.
										aResolver break: (RsrRemoteException from: debugEx exception).
										ex return].
			RsrProcessModel configureFrameworkProcess.
			aResolver hasResolved
				ifTrue: [ex return]
				ifFalse:
					[ex exception isResumable
						ifTrue: [[ex resume: debugResult] ensure: [aMessageSend receiver configureProcess]] "This needs to be a protected call."
						ifFalse:
							[aResolver break: (RsrRemoteException from: ex exception).
							ex return]]]
%

category: 'accessing'
method: RsrSendMessage
receiverReference

	^receiverReference
%

category: 'accessing'
method: RsrSendMessage
receiverReference: aServiceReference

	receiverReference := aServiceReference
%

category: 'reporting'
method: RsrSendMessage
reportOn: aLog

	aLog debug: 'RsrSendMessage(', self receiverReference asString, '>>', self selectorReference asString, ')'
%

category: 'accessing'
method: RsrSendMessage
selectorReference

	^selectorReference
%

category: 'accessing'
method: RsrSendMessage
selectorReference: aSymbolReference

	selectorReference := aSymbolReference
%

category: 'accessing'
method: RsrSendMessage
unhandledExceptionClass
	"The class which signals that an unhandled execption has been signaled."

	^RsrProcessModel unhandledExceptionClass
%

! Class implementation for 'RsrReleaseServices'

!		Class methods for 'RsrReleaseServices'

category: 'instance creation'
classmethod: RsrReleaseServices
sids: anArrayOfServiceIDs

	^self new
		sids: anArrayOfServiceIDs;
		yourself
%

!		Instance methods for 'RsrReleaseServices'

category: 'encoding'
method: RsrReleaseServices
encode: aStream
using: anEncoder

	anEncoder
		encodeReleaseServices: self
		onto: aStream
%

category: 'executing'
method: RsrReleaseServices
executeFor: aConnection

	sids do: [:sid | aConnection _remoteClientReleased: sid]
%

category: 'reporting'
method: RsrReleaseServices
reportOn: aLog

	aLog debug: 'RsrReleaseObjects(', self sids printString, ')'
%

category: 'accessing'
method: RsrReleaseServices
sids

	^sids
%

category: 'accessing'
method: RsrReleaseServices
sids: anArrayOfServiceIDs

	sids := anArrayOfServiceIDs
%

! Class implementation for 'RsrConnection'

!		Class methods for 'RsrConnection'

category: 'instance creation'
classmethod: RsrConnection
channel: aChannel
transactionSpigot: aNumericSpigot
oidSpigot: anOidSpigot
	"Create a new Connection with an already Configured Channel.
	Provide spigots as their behavior is specified by the Channel creation
	protocols."

	^self
		specification: nil
		channel: aChannel
		transactionSpigot: aNumericSpigot
		oidSpigot: anOidSpigot
%

category: 'instance creation'
classmethod: RsrConnection
new
	"Instances of Connection should not be created via #new.
	Instead use ConnectionSpecification.
	See SystemTestCase>>#setUp for an example."

	self shouldNotImplement
%

category: 'instance creation'
classmethod: RsrConnection
specification: aConnectionSpecification
channel: aChannel
transactionSpigot: aNumericSpigot
oidSpigot: anOidSpigot
	"Create a new Connection with an already Configured Channel.
	Provide spigots as their behavior is specified by the Channel creation
	protocols."

	^super new
		specification: aConnectionSpecification;
		channel: aChannel;
		transactionSpigot: aNumericSpigot;
		oidSpigot: anOidSpigot;
		yourself
%

!		Instance methods for 'RsrConnection'

category: 'public-accessing'
method: RsrConnection
announcer
	"Returns the announcer used by RSR to announce events."

	^announcer
%

category: 'public-lifecycle'
method: RsrConnection
close

	| pm temp |
	channel close.
	temp := Dictionary new.
	pm := pendingMessages.
	pendingMessages := temp.
	pm do: [:each | each promise break: RsrConnectionClosedBeforeReceivingResponse new].
	registry := RsrThreadSafeDictionary new.
	announcer announce: (RsrConnectionClosed connection: self)
%

category: 'public-testing'
method: RsrConnection
isOpen

	^channel isConnected
%

category: 'public-lifecycle'
method: RsrConnection
open

	self platformSpecificOpeningTasks.
	channel open
%

category: 'public-accessing'
method: RsrConnection
policy
	"Policy which determines if we can reify a received Service."

	^policy
%

category: 'public-accessing'
method: RsrConnection
policy: aPolicy
	"Policy which determines if we can reify a received Service."

	policy := aPolicy
%

category: 'public-accessing'
method: RsrConnection
specification
	"Returns the Specification used to create this Connection.
	If the Connection was not create using a Specification, returns nil."

	^specification
%

category: 'public-accessing'
method: RsrConnection
specification: aConnectionSpecification
	"Store the Specification used to the create this Connection."

	specification := aConnectionSpecification
%

category: 'public-accessing'
method: RsrConnection
templateResolver
	"Returns the TemplateResolver used to lookup a template by name or Service."

	^templateResolver
%

category: 'public-accessing'
method: RsrConnection
templateResolver: aTemplateResolver
	"Sets the TemplateResolver, used to lookup a template by name or Service,
	to a custom version."

	templateResolver := aTemplateResolver
%

category: 'public-accessing'
method: RsrConnection
vitalProcesses
	"Return the set of processes required in order for this RSR connection to function.
	This may be a subset of the processes used by RSR.
	For instance, in GemStone, this need not return the ephemeron mourning
	process as this isn't critical to the basic functioning of RSR."

	| processes |
	processes := IdentitySet new.
	channel addCommunicationProcessesTo: processes.
	^processes
%

category: 'public-waiting'
method: RsrConnection
waitUntilClose

	| semaphore |
	semaphore := Semaphore new.
	announcer
		when: RsrConnectionClosed
		send: #signal
		to: semaphore.
	semaphore wait
%

! Class implementation for 'RsrInternalConnectionSpecification'

!		Instance methods for 'RsrInternalConnectionSpecification'

category: 'asserting'
method: RsrInternalConnectionSpecification
assertOpen
	"Assert that connectionA and connectionB are open.
	Signal RsrConnectionFailed if they are not."

	(connectionA isOpen and: [connectionB isOpen])
		ifFalse: [RsrConnectionFailed signal]
%

category: 'connecting'
method: RsrInternalConnectionSpecification
connect
	"Establish an internal Connection pair."

	self subclassResponsibility
%

category: 'accessing'
method: RsrInternalConnectionSpecification
connectionA

	^connectionA
%

category: 'accessing'
method: RsrInternalConnectionSpecification
connectionA: anObject

	^ connectionA := anObject
%

category: 'accessing'
method: RsrInternalConnectionSpecification
connectionB

	^connectionB
%

category: 'accessing'
method: RsrInternalConnectionSpecification
connectionB: anObject

	connectionB := anObject
%

! Class implementation for 'RsrInMemoryConnectionSpecification'

!		Instance methods for 'RsrInMemoryConnectionSpecification'

category: 'connecting'
method: RsrInMemoryConnectionSpecification
connect
	"Establish an internal Connection pair via SharedQueues."

	| aQueue bQueue channelA channelB |
	aQueue := SharedQueue new.
	bQueue := SharedQueue new.
	channelA := RsrInMemoryChannel
		inQueue: aQueue
		outQueue: bQueue.
	channelB := RsrInMemoryChannel
		inQueue: bQueue
		outQueue: aQueue.
	connectionA := RsrConnection
		specification: self
		channel: channelA
		transactionSpigot: RsrThreadSafeNumericSpigot naturals
		oidSpigot: RsrThreadSafeNumericSpigot naturals.
	connectionB := RsrConnection
		specification: self
		channel: channelB
		transactionSpigot: RsrThreadSafeNumericSpigot naturals negated
		oidSpigot: RsrThreadSafeNumericSpigot naturals negated.
	connectionA open.
	connectionB open.
	self assertOpen.
	^connectionA
%

! Class implementation for 'RsrInternalSocketConnectionSpecification'

!		Instance methods for 'RsrInternalSocketConnectionSpecification'

category: 'connecting'
method: RsrInternalSocketConnectionSpecification
connect
	"Establish an internal Connection pair via socket."

	| acceptor initiator |
	acceptor := RsrAcceptConnection port: self defaultPort.
	initiator := RsrInitiateConnection host: '127.0.0.1' port: self defaultPort.
	RsrProcessModel
		fork: [connectionA := acceptor waitForConnection]
		named: 'Pending AcceptConnection'.
	self minimalWait. "Allow other process to schedule."
	connectionB := initiator connect.
	self minimalWait. "Allow other process to schedule."
	self assertOpen.
	connectionA specification: self.
	connectionB specification: self.
	^connectionA
%

category: 'accessing'
method: RsrInternalSocketConnectionSpecification
defaultPort
	"Returns the default port number used to listen for connections."

	^61982
%

! Class implementation for 'RsrSocketConnectionSpecification'

!		Class methods for 'RsrSocketConnectionSpecification'

category: 'instance creation'
classmethod: RsrSocketConnectionSpecification
host: hostnameOrAddress port: port

	^ self subclassResponsibility
%

!		Instance methods for 'RsrSocketConnectionSpecification'

category: 'accessing'
method: RsrSocketConnectionSpecification
host
	"Return the configured hostname or IP address"

	^host
%

category: 'accessing'
method: RsrSocketConnectionSpecification
host: hostnameOrAddress
	"The hostname or IP address used to establish a connection."

	host := hostnameOrAddress
%

category: 'accessing'
method: RsrSocketConnectionSpecification
port
	"The port number used for establishing a socket"

	^port
%

category: 'accessing'
method: RsrSocketConnectionSpecification
port: aPort
	"The port number used for establishing a socket"

	port := aPort
%

category: 'accessing'
method: RsrSocketConnectionSpecification
socketClass
	"Return the class that should be used for creating Socket instances."

	^RsrSocket
%

! Class implementation for 'RsrAcceptConnection'

!		Class methods for 'RsrAcceptConnection'

category: 'instance creation'
classmethod: RsrAcceptConnection
host: hostnameOrAddress port: portNumber

	^ self new
		  host: hostnameOrAddress;
		  portRange: (portNumber to: portNumber);
		  yourself
%

category: 'instance creation'
classmethod: RsrAcceptConnection
host: hostnameOrAddress portRange: anInterval

	^ self new
		  host: hostnameOrAddress;
		  portRange: anInterval;
		  yourself
%

category: 'instance creation'
classmethod: RsrAcceptConnection
port: aPortInteger

	^ self host: self wildcardAddress port: aPortInteger
%

category: 'instance creation'
classmethod: RsrAcceptConnection
portRange: anInterval

	^ self host: self wildcardAddress portRange: anInterval
%

category: 'accessing'
classmethod: RsrAcceptConnection
wildcardAddress

	^'0.0.0.0'
%

category: 'accessing'
classmethod: RsrAcceptConnection
wildcardPort

	^0
%

!		Instance methods for 'RsrAcceptConnection'

category: 'private'
method: RsrAcceptConnection
bind

	"Attempt to listen on each of the port range, answer the successful port or signal RsrInvalidBind"

	portRange do: [ :portToTry | 
		[ 
		listener bindAddress: self host port: portToTry.
		^ portToTry ]
			on: RsrInvalidBind
			do: [ :ex | ex return ] ].
	RsrInvalidBind signal:
		'Cannot bind to any port in range ' , portRange printString
%

category: 'actions'
method: RsrAcceptConnection
cancelWaitForConnection

	listener ifNotNil: [:socket | socket close]
%

category: 'actions'
method: RsrAcceptConnection
ensureListening

	isListening ifTrue: [^self].
	self bind.
	listener listen: 5.
	isListening := true
%

category: 'accessing'
method: RsrAcceptConnection
handshakeSteps
	"Returns a sequence of steps needed to perform a successful handshake."

	^Array
		with: RsrProtocolVersionNegotiationServer new
%

category: 'other'
method: RsrAcceptConnection
initialize

	super initialize.
	listener := self socketClass new.
	isWaitingForConnection := false.
	isListening := false
%

category: 'testing'
method: RsrAcceptConnection
isWaitingForConnection

	^isWaitingForConnection
%

category: 'accessing'
method: RsrAcceptConnection
listeningPort
	"Return the port the underlying socket is listening on.
	This is useful when using the wildcard port to dynamically
	assign a port number."

	isListening ifFalse: [^nil].
	^listener port
%

category: 'accessing'
method: RsrAcceptConnection
portRange

	^ portRange
%

category: 'accessing'
method: RsrAcceptConnection
portRange: anObject

	portRange := anObject
%

category: 'actions'
method: RsrAcceptConnection
waitForConnection

	| socket stream handshake channel connection |
	self ensureListening.
	[isWaitingForConnection := true.
	socket := [listener accept]
		on: RsrSocketError
		do: [:ex | ex resignalAs: RsrWaitForConnectionCancelled new]]
			ensure:
				[listener close.
				listener := nil.
				isWaitingForConnection := false].
	stream := RsrSocketStream on: socket.
	handshake := RsrHandshake
		steps: self handshakeSteps
		stream: stream.
	handshake perform.
	channel := RsrBinaryStreamChannel
		inStream: stream
		outStream: stream.
	connection := RsrConnection
		specification: self
		channel: channel
		transactionSpigot: RsrThreadSafeNumericSpigot naturals
		oidSpigot: RsrThreadSafeNumericSpigot naturals.
	^connection open
%

! Class implementation for 'RsrGciAcceptConnection'

!		Class methods for 'RsrGciAcceptConnection'

category: 'instance creation'
classmethod: RsrGciAcceptConnection
host: hostnameOrAddress
port: port
token: aToken

	^self new
		host: hostnameOrAddress;
		port: port;
		token: aToken;
		yourself
%

!		Instance methods for 'RsrGciAcceptConnection'

category: 'accessing'
method: RsrGciAcceptConnection
handshakeSteps
	"Returns a sequence of steps needed to perform a successful handshake."

	^Array
		with: RsrProtocolVersionNegotiationServer new
		with: (RsrTokenReceiver token: self token)
%

category: 'initializing'
method: RsrGciAcceptConnection
initialize

	super initialize.
	token := RsrToken newRandom
%

category: 'accessing'
method: RsrGciAcceptConnection
token
	"Returns the token used during handshake."

	^token
%

category: 'accessing'
method: RsrGciAcceptConnection
token: aToken
	"Stores the token used during handshake."

	token := aToken
%

! Class implementation for 'RsrInitiateConnection'

!		Class methods for 'RsrInitiateConnection'

category: 'instance creation'
classmethod: RsrInitiateConnection
host: hostnameOrAddress port: port

	^ self new
		  host: hostnameOrAddress;
		  port: port;
		  yourself
%

!		Instance methods for 'RsrInitiateConnection'

category: 'connecting'
method: RsrInitiateConnection
connect

	| socket stream handshake channel connection |
	socket := self socketClass new.
	socket
		connectToHost: self host
		port: self port.
	stream := RsrSocketStream on: socket.
	handshake := RsrHandshake
		steps: self handshakeSteps
		stream: stream.
	handshake perform.
	channel := RsrBinaryStreamChannel
		inStream: stream
		outStream: stream.
	connection := RsrConnection
		specification: self
		channel: channel
		transactionSpigot: RsrThreadSafeNumericSpigot naturals negated
		oidSpigot: RsrThreadSafeNumericSpigot naturals negated.
	^connection open
%

category: 'accessing'
method: RsrInitiateConnection
handshakeSteps
	"Returns a sequence of steps needed to perform a successful handshake."

	^Array
		with: RsrProtocolVersionNegotiationClient new
%

! Class implementation for 'RsrGciInitiateConnection'

!		Class methods for 'RsrGciInitiateConnection'

category: 'instance creation'
classmethod: RsrGciInitiateConnection
host: hostnameOrAddress
port: port
token: aToken

	^self new
		host: hostnameOrAddress;
		port: port;
		token: aToken;
		yourself
%

!		Instance methods for 'RsrGciInitiateConnection'

category: 'accessing'
method: RsrGciInitiateConnection
handshakeSteps
	"Returns a sequence of steps needed to perform a successful handshake."

	^Array
		with: RsrProtocolVersionNegotiationClient new
		with: (RsrTokenSender token: self token)
%

category: 'accessing'
method: RsrGciInitiateConnection
token
	"Returns the token used during handshake."

	^token
%

category: 'accessing'
method: RsrGciInitiateConnection
token: aToken
	"Stores the token used during handshake."

	token := aToken
%

! Class implementation for 'RsrEnvironment'

!		Class methods for 'RsrEnvironment'

category: 'branching'
classmethod: RsrEnvironment
ifPharo: aPharoBlock
ifGemStone: aGemStoneBlock
ifDolphin: aDolphinBlock

	^aGemStoneBlock value
%

! Class implementation for 'RsrEphemeron'

!		Class methods for 'RsrEphemeron'

category: 'instance-creation'
classmethod: RsrEphemeron
on: anObject
mournAction: aBlock

	^self new
        key: anObject;
        mournAction: aBlock;
        beEphemeron: true;
        yourself
%

!		Instance methods for 'RsrEphemeron'

category: 'accessing'
method: RsrEphemeron
key

	^key
%

category: 'accessing'
method: RsrEphemeron
key: anObject

	key := anObject
%

category: 'mourning'
method: RsrEphemeron
mourn

	mournAction value.
    key := mournAction := nil
%

category: 'accessing'
method: RsrEphemeron
mournAction

	^mournAction
%

category: 'accessing'
method: RsrEphemeron
mournAction: aBlock

	mournAction := aBlock
%

! Class implementation for 'RsrGarbageCollector'

!		Class methods for 'RsrGarbageCollector'

category: 'cleaning'
classmethod: RsrGarbageCollector
maximumReclamation

	| sema ephemeron |
	sema := Semaphore new.
	ephemeron := RsrEphemeron
		on: Object new
		mournAction: [sema signal].
	System
		_generationScavenge_vmMarkSweep;
		_generationScavenge_vmMarkSweep.
	^sema waitForMilliseconds: 10
%

! Class implementation for 'RsrHandshake'

!		Class methods for 'RsrHandshake'

category: 'instance creation'
classmethod: RsrHandshake
steps: anArrayOfSteps
stream: aStream

	^self new
		steps: anArrayOfSteps;
		stream: aStream;
		yourself
%

!		Instance methods for 'RsrHandshake'

category: 'performing'
method: RsrHandshake
perform
	"Perform the sequence of configured steps."

	self steps do: [:each | each performOver: self stream]
%

category: 'accessing'
method: RsrHandshake
steps
	"The sequence of handshake steps to perform."

	^steps
%

category: 'accessing'
method: RsrHandshake
steps: anArrayOfSteps
	"The sequence of handshake steps to perform."

	steps := anArrayOfSteps
%

category: 'accessing'
method: RsrHandshake
stream
	"The stream used by each step."

	^stream
%

category: 'accessing'
method: RsrHandshake
stream: aStream
	"The stream used by each step."

	stream := aStream
%

! Class implementation for 'RsrHandshakeStep'

!		Instance methods for 'RsrHandshakeStep'

category: 'performing'
method: RsrHandshakeStep
performOver: aStream
	"Perform the work for this step."

	^self subclassResponsibility
%

! Class implementation for 'RsrProtocolVersionNegotiation'

!		Instance methods for 'RsrProtocolVersionNegotiation'

category: 'accessing'
method: RsrProtocolVersionNegotiation
codec

	^RsrProtocolVersionNegotiationCodec new
%

! Class implementation for 'RsrProtocolVersionNegotiationClient'

!		Instance methods for 'RsrProtocolVersionNegotiationClient'

category: 'handshaking'
method: RsrProtocolVersionNegotiationClient
performOver: aStream
	"Perform the Client's porition of the handshake"

	| supportedVersions answer |
	supportedVersions := RsrSupportedVersions versions: #(1).
	self codec
		encodeSupportedVersions: supportedVersions
		onto: aStream.
	aStream flush.
	answer := self codec decode: aStream.
	answer hasSharedVersion
		ifFalse: [^RsrProtocolVersionNegotiationFailed signal: 'The Client and Server could not agree on an RSR protocol version.']
%

! Class implementation for 'RsrProtocolVersionNegotiationServer'

!		Instance methods for 'RsrProtocolVersionNegotiationServer'

category: 'handshaking'
method: RsrProtocolVersionNegotiationServer
performOver: aStream
	"Peform the Server's side of the handshake."

	| supportedVersions |
	supportedVersions := self codec decode: aStream.
	(supportedVersions versions includes: 1)
		ifTrue:
			[self codec
				encodeChosenVersion: (RsrChosenVersion version: 1)
				onto: aStream.
			aStream flush]
		ifFalse:
			[self codec
				encodeNoVersionOverlap: RsrNoVersionOverlap new
				onto: aStream.
			aStream flush; close.
			^RsrProtocolVersionNegotiationFailed signal: 'Client versions did not overlap w/ Server']
%

! Class implementation for 'RsrTokenExchange'

!		Class methods for 'RsrTokenExchange'

category: 'accessing'
classmethod: RsrTokenExchange
token: aToken

	^self new
		token: aToken;
		yourself
%

!		Instance methods for 'RsrTokenExchange'

category: 'accessing'
method: RsrTokenExchange
codec

	^RsrTokenExchangeCodec new
%

category: 'accessing'
method: RsrTokenExchange
token

	^token
%

category: 'accessing'
method: RsrTokenExchange
token: aToken

	token := aToken
%

! Class implementation for 'RsrTokenReceiver'

!		Instance methods for 'RsrTokenReceiver'

category: 'performing'
method: RsrTokenReceiver
performOver: aStream
	"Send the token. Wait for confirmation."

	| receivedToken |
	receivedToken := self codec decode: aStream.
	receivedToken = self token
		ifTrue:
			[self codec
				encodeTokenAccepted: nil "RsrTokenAccepted new"
				onto: aStream.
			aStream flush]
		ifFalse:
			[self codec
				encodeTokenRejected: nil "RsrTokenRejected new"
				onto: aStream.
			aStream flush.
			RsrTokenExchangeFailed signal]
%

! Class implementation for 'RsrTokenSender'

!		Instance methods for 'RsrTokenSender'

category: 'performing'
method: RsrTokenSender
performOver: aStream
	"Send the token. Wait for confirmation."

	| confirmation |
	self codec
		encodeToken: self token
		onto: aStream.
	aStream flush.
	confirmation := self codec decode: aStream.
	confirmation wasAccepted
		ifFalse: [RsrTokenExchangeFailed signal: 'Token was rejected']
%

! Class implementation for 'RsrLog'

!		Instance methods for 'RsrLog'

category: 'configuring'
method: RsrLog
addSink: aLogSink

	sinks add: aLogSink
%

category: 'logging'
method: RsrLog
critical: aString

	self verbosity >= self levelCritical
		ifTrue: [self log: aString level: #critical]
%

category: 'logging'
method: RsrLog
debug: aString

	self verbosity >= self levelDebug
		ifTrue: [	self log: aString level: #debug]
%

category: 'logging'
method: RsrLog
error: aString

	self verbosity >= self levelError
		ifTrue: [self log: aString level: #error]
%

category: 'logging'
method: RsrLog
info: aString

	self verbosity >= self levelInfo
		ifTrue: [self log: aString level: #info]
%

category: 'initialization'
method: RsrLog
initialize

	super initialize.
	verbosity := self levelTrace.
	sinks := OrderedCollection new
%

category: 'accessing'
method: RsrLog
levelCritical

	^0
%

category: 'accessing'
method: RsrLog
levelDebug

	^4
%

category: 'accessing'
method: RsrLog
levelError

	^1
%

category: 'accessing'
method: RsrLog
levelInfo

	^3
%

category: 'accessing'
method: RsrLog
levelTrace

	^5
%

category: 'accessing'
method: RsrLog
levelWarn

	^2
%

category: 'logging'
method: RsrLog
log: aMessage
level: aLevelString

	| message |
	message := RsrDateAndTime now printString, '-', aLevelString, '-', aMessage.
	sinks do: [:each | each write: message]
%

category: 'logging'
method: RsrLog
trace: aString

	self verbosity >= self levelTrace
		ifTrue: [self log: aString level: #trace]
%

category: 'accessing'
method: RsrLog
verbosity

	^verbosity
%

category: 'accessing'
method: RsrLog
verbosity: aLogLevel

	verbosity := aLogLevel
%

category: 'logging'
method: RsrLog
warning: aString

	self verbosity >= self levelWarn
		ifTrue: [self log: aString level: #warning]
%

! Class implementation for 'RsrLogSink'

!		Instance methods for 'RsrLogSink'

category: 'writing'
method: RsrLogSink
write: aMessage

	self subclassResponsibility
%

! Class implementation for 'RsrCustomSink'

!		Class methods for 'RsrCustomSink'

category: 'instance creation'
classmethod: RsrCustomSink
action: aBlock

	^self new
		action: aBlock;
		yourself
%

!		Instance methods for 'RsrCustomSink'

category: 'accessing'
method: RsrCustomSink
action

	^action
%

category: 'accessing'
method: RsrCustomSink
action: aBlock

	action := aBlock
%

category: 'writing'
method: RsrCustomSink
write: aMessage

	self action value: aMessage
%

! Class implementation for 'RsrTranscriptSink'

!		Instance methods for 'RsrTranscriptSink'

category: 'writing'
method: RsrTranscriptSink
write: aMessageString

	Transcript
		show: aMessageString;
		cr
%

! Class implementation for 'RsrLogWithPrefix'

!		Class methods for 'RsrLogWithPrefix'

category: 'logging'
classmethod: RsrLogWithPrefix
log: aLog

	^self new
		log: aLog;
		yourself
%

category: 'logging'
classmethod: RsrLogWithPrefix
prefix: aString
log: aLog

	^self new
		prefix: aString;
		log: aLog;
		yourself
%

!		Instance methods for 'RsrLogWithPrefix'

category: 'debugging'
method: RsrLogWithPrefix
debug: aString

	^self log debug: self prefix, '/', aString
%

category: 'accessing'
method: RsrLogWithPrefix
log

	^log
%

category: 'accessing'
method: RsrLogWithPrefix
log: aLog

	log := aLog
%

category: 'accessing'
method: RsrLogWithPrefix
prefix

	^prefix
%

category: 'accessing'
method: RsrLogWithPrefix
prefix: aString

	prefix := aString
%

! Class implementation for 'RsrMessageSend'

!		Class methods for 'RsrMessageSend'

category: 'instance creation'
classmethod: RsrMessageSend
receiver: anObject
selector: aSelector
arguments: anArray

	^self new
		receiver: anObject;
		selector: aSelector;
		arguments: anArray;
		yourself
%

!		Instance methods for 'RsrMessageSend'

category: 'accessing'
method: RsrMessageSend
arguments

	^arguments
%

category: 'accessing'
method: RsrMessageSend
arguments: anArray

	arguments := anArray
%

category: 'evaluating'
method: RsrMessageSend
perform

	^self receiver
		perform: self selector
		withArguments: self arguments
%

category: 'accessing'
method: RsrMessageSend
receiver

	^receiver
%

category: 'accessing'
method: RsrMessageSend
receiver: anObject

	receiver := anObject
%

category: 'accessing'
method: RsrMessageSend
selector

	^selector
%

category: 'accessing'
method: RsrMessageSend
selector: aSelector

	selector := aSelector
%

! Class implementation for 'RsrNumericSpigot'

!		Class methods for 'RsrNumericSpigot'

category: 'instance creation'
classmethod: RsrNumericSpigot
naturals

	^self
		start: 1
		step: 1
%

category: 'instance creation'
classmethod: RsrNumericSpigot
new

	^self
		start: 0
		step: 1
%

category: 'instance creation'
classmethod: RsrNumericSpigot
start: aNumber
step: anIncrement

	^super new
		start: aNumber;
		step: anIncrement;
		yourself
%

!		Instance methods for 'RsrNumericSpigot'

category: 'accessing'
method: RsrNumericSpigot
negated

	^self class
		start: current negated
		step: step negated
%

category: 'accessing'
method: RsrNumericSpigot
next

	| result |
	result := current.
	current := current + step.
	^result
%

category: 'accessing'
method: RsrNumericSpigot
next: aCount

	| result |
	result := Array new: aCount.
	1 to: aCount do: [:i | result at: i put: self next].
	^result
%

category: 'accessing'
method: RsrNumericSpigot
start: aNumber

	current := aNumber
%

category: 'accessing'
method: RsrNumericSpigot
step

	^step
%

category: 'accessing'
method: RsrNumericSpigot
step: anIncrement

	step := anIncrement
%

! Class implementation for 'RsrThreadSafeNumericSpigot'

!		Instance methods for 'RsrThreadSafeNumericSpigot'

category: 'initialization'
method: RsrThreadSafeNumericSpigot
initialize

	super initialize.
	mutex := Semaphore forMutualExclusion
%

category: 'accessing'
method: RsrThreadSafeNumericSpigot
next

	^mutex critical: [super next]
%

! Class implementation for 'RsrPendingMessage'

!		Class methods for 'RsrPendingMessage'

category: 'instance creation'
classmethod: RsrPendingMessage
services: aList
promise: aPromise

	^self new
		services: aList;
		promise: aPromise;
		yourself
%

!		Instance methods for 'RsrPendingMessage'

category: 'accessing'
method: RsrPendingMessage
promise

	^promise
%

category: 'accessing'
method: RsrPendingMessage
promise: aPromise

	promise := aPromise
%

category: 'accessing'
method: RsrPendingMessage
services

	^services
%

category: 'accessing'
method: RsrPendingMessage
services: aList

	services := aList
%

! Class implementation for 'RsrPromise'

!		Instance methods for 'RsrPromise'

category: 'private'
method: RsrPromise
assertNotResolved

	self isResolved
		ifTrue: [RsrAlreadyResolved signal].
%

category: 'resolving'
method: RsrPromise
break: aReason
	"Notify the receiver's observers that the Promise will not be fulfilled."

	mutex
		critical:
			[self assertNotResolved.
			value := aReason.
			state := #Broken].
	self notifyActions.
	resolvedMutex signal
%

category: 'signalling'
method: RsrPromise
exception
	"Answer the reason the promise is broken"

	^ self isBroken
		ifTrue: [ value ]
		ifFalse: [ self error: 'Promise not broken' ]
%

category: 'resolving'
method: RsrPromise
fulfill: anObject
	"Fulfill the receiver and notify any observers."

	mutex
		critical:
			[self assertNotResolved.
			value := anObject.
			state := #Fulfilled].
	self notifyActions.
	resolvedMutex signal
%

category: 'private'
method: RsrPromise
initialize

	super initialize.
	mutex := Semaphore forMutualExclusion.
	resolvedMutex := Semaphore new.
	state := #PendingResolution.
	resolutionActions := OrderedCollection new
%

category: 'testing'
method: RsrPromise
isBroken
	"Report if the receiver is currently broken"

	^state == #Broken
%

category: 'testing'
method: RsrPromise
isFulfilled
	"Report is the receiver is currently fulfilled"

	^state == #Fulfilled
%

category: 'testing'
method: RsrPromise
isResolved
	"Report if the receiver is currently resolved."

	^self isFulfilled or: [self isBroken]
%

category: 'private'
method: RsrPromise
notifyActions
	"Activate any registered action's fulfillment blocks.
	Ensure that they are activated only once and that
	future actions are allowed."

	| actions |
	mutex
		critical:
			[actions := resolutionActions.
			resolutionActions := OrderedCollection new].
	actions
		do:
			[:each |
			self isFulfilled
				ifTrue: [RsrProcessModel fork: [each when value: value] named: 'Promise Fulfillment Notification']
				ifFalse: [RsrProcessModel fork: [each catch value: value] named: 'Promise Break Notification']]
%

category: 'observing'
method: RsrPromise
value
	"Alias for #wait"

	^self wait
%

category: 'observing'
method: RsrPromise
wait
	"Wait for a the receiver to be Resolved.
	If fulfilled - return the fulfillment value.
	If broken - raise an RsrBrokenPromise exception w/ the reason."
	<gemstoneDebuggerSignal>

	self waitForResolution.
	^self isBroken
		ifTrue: [RsrBrokenPromise signalReason: value]
		ifFalse: [value]
%

category: 'private'
method: RsrPromise
waitForResolution
	"There doesn't seem to be a great way to implement this method.
	The ensure below is generally safe but does have a side-effect of signaling
	the mutex when the process is terminated while waiting.
	Removing the ensure allows the signal to be lost if the process is terminated
	just after #wait but before #signal is processed.
	In order to solve this, the loop verifies the promise is actually resolved before
	continuing."

	self isResolved
		ifTrue: [^self].
	[[self isResolved] whileFalse: [resolvedMutex wait]] ensure: [resolvedMutex signal]
%

category: 'observing'
method: RsrPromise
when: aWhenBlock
catch: aCatchBlock
	"Activate an appropriate block when the receiver is resolved.
	If the receiver is currently resolved, schedule the block activation.
	The block is activated in a new thread. The thread is not given any specific
	error handler.
	<aWhenBlock> will be sent #value: with the same value provided to #fulfill:.
	<aCatchBlock> will be sent #value: with the same reason provided to #break:."

	| action shouldNotifyActions |
	action := RsrPromiseResolutionAction
		when: aWhenBlock
		catch: aCatchBlock.
	mutex
		critical:
			[shouldNotifyActions := self isResolved.
			resolutionActions add: action].
	shouldNotifyActions ifTrue: [self notifyActions]
%

! Class implementation for 'RsrPromiseResolutionAction'

!		Class methods for 'RsrPromiseResolutionAction'

category: 'instance creation'
classmethod: RsrPromiseResolutionAction
when: aWhenBlock
catch: aCatchBlock

	^self new
		when: aWhenBlock;
		catch: aCatchBlock;
		yourself
%

!		Instance methods for 'RsrPromiseResolutionAction'

category: 'accessing'
method: RsrPromiseResolutionAction
catch

	^catch
%

category: 'accessing'
method: RsrPromiseResolutionAction
catch: aBlock

	catch := aBlock
%

category: 'accessing'
method: RsrPromiseResolutionAction
when

	^when
%

category: 'accessing'
method: RsrPromiseResolutionAction
when: aBlock

	when := aBlock
%

! Class implementation for 'RsrChosenVersion'

!		Class methods for 'RsrChosenVersion'

category: 'instance creation'
classmethod: RsrChosenVersion
version: aVersionNumber

	^self new
		version: aVersionNumber;
		yourself
%

!		Instance methods for 'RsrChosenVersion'

category: 'comparing'
method: RsrChosenVersion
= aChosenVersion

	^self class = aChosenVersion class and: [self version = aChosenVersion version]
%

category: 'testing'
method: RsrChosenVersion
hasSharedVersion
	"Answer whether there is a valid shared protocol version between the Client and Server."

	^true
%

category: 'accessing'
method: RsrChosenVersion
version

	^version
%

category: 'accessing'
method: RsrChosenVersion
version: aVersionNumber

	version := aVersionNumber
%

! Class implementation for 'RsrNoVersionOverlap'

!		Instance methods for 'RsrNoVersionOverlap'

category: 'comparing'
method: RsrNoVersionOverlap
= aNoVersionOverlap

	^self class = aNoVersionOverlap class
%

category: 'comparing'
method: RsrNoVersionOverlap
hash

	^self class hash
%

category: 'testing'
method: RsrNoVersionOverlap
hasSharedVersion
	"Answer whether there is a valid shared protocol version between the Client and Server."

	^false
%

! Class implementation for 'RsrSupportedVersions'

!		Class methods for 'RsrSupportedVersions'

category: 'instance creation'
classmethod: RsrSupportedVersions
versions: anArray

	^self new
		versions: anArray;
		yourself
%

!		Instance methods for 'RsrSupportedVersions'

category: 'comparing'
method: RsrSupportedVersions
= aSupportedVersions

	self class = aSupportedVersions class
		ifFalse: [^false].
	^self versions = aSupportedVersions versions
%

category: 'comparing'
method: RsrSupportedVersions
hash

	^self versions hash
%

category: 'accessing'
method: RsrSupportedVersions
versions

	^versions
%

category: 'accessing'
method: RsrSupportedVersions
versions: anArray

	versions := anArray
%

! Class implementation for 'RsrReference'

!		Class methods for 'RsrReference'

category: 'analyzing'
classmethod: RsrReference
analyze: anObject
using: anAnalyzer

	^self subclassResponsibility
%

category: 'instance creation'
classmethod: RsrReference
from: anObject

	| referenceClass |
	referenceClass := self referenceClassFor: anObject.
	^referenceClass from: anObject
%

category: 'accessing'
classmethod: RsrReference
referenceMapping

	^referenceMapping
%

category: 'accessing'
classmethod: RsrReference
typeIdentifier

	^self subclassResponsibility
%

!		Instance methods for 'RsrReference'

category: 'resolving'
method: RsrReference
resolve: aConnection
	"Resolve the reference in the context of the provided Connection."

	^self subclassResponsibility
%

category: 'accessing'
method: RsrReference
typeIdentifier

	^self class typeIdentifier
%

! Class implementation for 'RsrImmediateReference'

!		Class methods for 'RsrImmediateReference'

category: 'analyzing'
classmethod: RsrImmediateReference
analyze: anObject
using: anAnalyzer

	^anAnalyzer analyzeImmediate: anObject
%

category: 'instance creation'
classmethod: RsrImmediateReference
from: anObject

	^self subclassResponsiblity
%

!		Instance methods for 'RsrImmediateReference'

category: 'accessing'
method: RsrImmediateReference
immediateOID

	^0
%

! Class implementation for 'RsrBooleanReference'

!		Class methods for 'RsrBooleanReference'

category: 'instance creation'
classmethod: RsrBooleanReference
from: aBoolean

	^aBoolean
		ifTrue: [RsrTrueReference new]
		ifFalse: [RsrFalseReference new]
%

!		Instance methods for 'RsrBooleanReference'

category: 'encoding/decoding'
method: RsrBooleanReference
decode: aStream
using: aDecoder

	"Boolean has no additional value"
%

category: 'encoding/decoding'
method: RsrBooleanReference
encode: aStream
using: anEncoder

	anEncoder
		encodeControlWord: anEncoder immediateOID
		onto: aStream.
	anEncoder
		encodeControlWord: self typeIdentifier
		onto: aStream
%

! Class implementation for 'RsrFalseReference'

!		Class methods for 'RsrFalseReference'

category: 'accessing'
classmethod: RsrFalseReference
typeIdentifier

	^8
%

!		Instance methods for 'RsrFalseReference'

category: 'resolving'
method: RsrFalseReference
resolve: aConnection

	^false
%

! Class implementation for 'RsrTrueReference'

!		Class methods for 'RsrTrueReference'

category: 'accessing'
classmethod: RsrTrueReference
typeIdentifier

	^7
%

!		Instance methods for 'RsrTrueReference'

category: 'resolving'
method: RsrTrueReference
resolve: aConnection

	^true
%

! Class implementation for 'RsrNilReference'

!		Class methods for 'RsrNilReference'

category: 'instance creation'
classmethod: RsrNilReference
from: aNil

	^self new
%

category: 'accessing'
classmethod: RsrNilReference
typeIdentifier

	^6
%

!		Instance methods for 'RsrNilReference'

category: 'encoding/decoding'
method: RsrNilReference
decode: aStream
using: aDecoder

	"Nil has no additional value"
%

category: 'encoding/decoding'
method: RsrNilReference
encode: aStream
using: anEncoder

	anEncoder
		encodeControlWord: anEncoder immediateOID
		onto: aStream.
	anEncoder
		encodeControlWord: self typeIdentifier
		onto: aStream
%

category: 'resolving'
method: RsrNilReference
resolve: aConnection

	^nil
%

! Class implementation for 'RsrValueReference'

!		Class methods for 'RsrValueReference'

category: 'instance creation'
classmethod: RsrValueReference
intermediate: anObject

	^self new
		intermediate: anObject;
		yourself
%

!		Instance methods for 'RsrValueReference'

category: 'private-accessing'
method: RsrValueReference
intermediate: anObject
	"Store the intermediate form of this object"

	intermediate := anObject
%

category: 'resolving'
method: RsrValueReference
resolve: aConnection

	^intermediate
%

! Class implementation for 'RsrByteArrayReference'

!		Class methods for 'RsrByteArrayReference'

category: 'instance creation'
classmethod: RsrByteArrayReference
from: aByteArray

	^self intermediate: aByteArray copy
%

category: 'accessing'
classmethod: RsrByteArrayReference
typeIdentifier

	^10
%

!		Instance methods for 'RsrByteArrayReference'

category: 'encoding/decoding'
method: RsrByteArrayReference
decode: aStream
using: aDecoder

	| length |
	length := aDecoder decodeControlWord: aStream.
	intermediate := aStream next: length
%

category: 'encoding/decoding'
method: RsrByteArrayReference
encode: aStream
using: anEncoder

	anEncoder
		encodeControlWord: anEncoder immediateOID
		onto: aStream.
	anEncoder
		encodeControlWord: self typeIdentifier
		onto: aStream.
	anEncoder
		encodeControlWord: intermediate size
		onto: aStream.
	aStream nextPutAll: intermediate
%

! Class implementation for 'RsrCharacterArrayReference'

!		Class methods for 'RsrCharacterArrayReference'

category: 'instance creation'
classmethod: RsrCharacterArrayReference
from: aCharacterArray

	| bytes |
	bytes := self convertToBytes: aCharacterArray.
	^self intermediate: bytes
%

!		Instance methods for 'RsrCharacterArrayReference'

category: 'encoding/decoding'
method: RsrCharacterArrayReference
decode: aStream
using: aDecoder

	| length |
	length := aDecoder decodeControlWord: aStream.
	intermediate := aStream next: length
%

category: 'encoding/decoding'
method: RsrCharacterArrayReference
encode: aStream
using: anEncoder

	anEncoder
		encodeControlWord: anEncoder immediateOID
		onto: aStream.
	anEncoder
		encodeControlWord: self typeIdentifier
		onto: aStream.
	anEncoder
		encodeControlWord: intermediate size
		onto: aStream.
	aStream nextPutAll: intermediate
%

category: 'resolving'
method: RsrCharacterArrayReference
resolve: aConnection

	^self convertBytes: intermediate
%

! Class implementation for 'RsrStringReference'

!		Class methods for 'RsrStringReference'

category: 'accessing'
classmethod: RsrStringReference
typeIdentifier

	^2
%

! Class implementation for 'RsrSymbolReference'

!		Class methods for 'RsrSymbolReference'

category: 'accessing'
classmethod: RsrSymbolReference
typeIdentifier

	^1
%

!		Instance methods for 'RsrSymbolReference'

category: 'converting'
method: RsrSymbolReference
convertBytes: aByteArray

	^(super convertBytes: aByteArray) asSymbol
%

! Class implementation for 'RsrCharacterReference'

!		Class methods for 'RsrCharacterReference'

category: 'instance creation'
classmethod: RsrCharacterReference
from: aCharacter

	^self intermediate: aCharacter codePoint
%

category: 'accessing'
classmethod: RsrCharacterReference
typeIdentifier

	^5
%

!		Instance methods for 'RsrCharacterReference'

category: 'encoding/decoding'
method: RsrCharacterReference
decode: aStream
using: aDecoder

	intermediate := aDecoder decodeControlWord: aStream
%

category: 'encoding/decoding'
method: RsrCharacterReference
encode: aStream
using: anEncoder

	anEncoder
		encodeControlWord: anEncoder immediateOID
		onto: aStream.
	anEncoder
		encodeControlWord: self typeIdentifier
		onto: aStream.
	anEncoder
		encodeControlWord: intermediate
		onto: aStream
%

category: 'resolving'
method: RsrCharacterReference
resolve: aConnection

	^Character codePoint: intermediate
%

! Class implementation for 'RsrCollectionReference'

!		Class methods for 'RsrCollectionReference'

category: 'analyzing'
classmethod: RsrCollectionReference
analyze: aCollection
using: anAnalyzer

	^anAnalyzer analyzeCollection: aCollection
%

category: 'instance creation'
classmethod: RsrCollectionReference
from: aSequencedCollection

	| references |
	references := (1 to: aSequencedCollection size) collect: [:i | RsrReference from: (aSequencedCollection at: i)].
	^self intermediate: references
%

!		Instance methods for 'RsrCollectionReference'

category: 'encoding/decoding'
method: RsrCollectionReference
decode: aStream
using: aDecoder

	| size |
	size := aDecoder decodeControlWord: aStream.
	intermediate := (1 to: size) collect: [:i | aDecoder decodeReference: aStream]
%

category: 'encoding/decoding'
method: RsrCollectionReference
encode: aStream
using: anEncoder

	anEncoder
		encodeControlWord: anEncoder immediateOID
		onto: aStream.
	anEncoder
		encodeControlWord: self typeIdentifier
		onto: aStream.
	anEncoder
		encodeControlWord: intermediate size
		onto: aStream.
	intermediate
		do:
			[:each |
			each
				encode: aStream
				using: anEncoder]
%

! Class implementation for 'RsrArrayReference'

!		Class methods for 'RsrArrayReference'

category: 'accessing'
classmethod: RsrArrayReference
typeIdentifier

	^9
%

!		Instance methods for 'RsrArrayReference'

category: 'resolving'
method: RsrArrayReference
resolve: aConnection

	^intermediate collect: [:each | each resolve: aConnection]
%

! Class implementation for 'RsrDictionaryReference'

!		Class methods for 'RsrDictionaryReference'

category: 'analyzing'
classmethod: RsrDictionaryReference
analyze: aDictionary
using: anAnalyzer

	^anAnalyzer analyzeDictionary: aDictionary
%

category: 'instance creation'
classmethod: RsrDictionaryReference
from: aDictionary

	| referenceStream |
	referenceStream := WriteStream on: (Array new: aDictionary size * 2).
	aDictionary
		keysAndValuesDo:
			[:key :value |
			referenceStream
				nextPut: (RsrReference from: key);
				nextPut: (RsrReference from: value)].
	^self intermediate: referenceStream contents
%

category: 'accessing'
classmethod: RsrDictionaryReference
typeIdentifier

	^13
%

!		Instance methods for 'RsrDictionaryReference'

category: 'encoding/decoding'
method: RsrDictionaryReference
decode: aStream
using: aDecoder

	| size |
	size := aDecoder decodeControlWord: aStream.
	intermediate := (1 to: size * 2) collect: [:each | aDecoder decodeReference: aStream]
%

category: 'encoding/decoding'
method: RsrDictionaryReference
encode: aStream
using: anEncoder

	anEncoder
		encodeControlWord: anEncoder immediateOID
		onto: aStream.
	anEncoder
		encodeControlWord: self typeIdentifier
		onto: aStream.
	anEncoder
		encodeControlWord: intermediate size / 2
		onto: aStream.
	intermediate do: [:each | each encode: aStream using: anEncoder]
%

category: 'resolving'
method: RsrDictionaryReference
resolve: aConnection

	| stream numEntries dictionary |
	stream := ReadStream on: intermediate.
	numEntries := intermediate size / 2.
	dictionary := Dictionary new: numEntries.
	numEntries
		timesRepeat:
			[dictionary
				at: (stream next resolve: aConnection)
				put: (stream next resolve: aConnection)].
	^dictionary
%

! Class implementation for 'RsrOrderedCollectionReference'

!		Class methods for 'RsrOrderedCollectionReference'

category: 'accessing'
classmethod: RsrOrderedCollectionReference
typeIdentifier

	^12
%

!		Instance methods for 'RsrOrderedCollectionReference'

category: 'other'
method: RsrOrderedCollectionReference
resolve: aConnection

	| oc |
	oc := OrderedCollection new: intermediate size.
	intermediate do: [:each | oc add: (each resolve: aConnection)].
	^oc
%

! Class implementation for 'RsrSetReference'

!		Class methods for 'RsrSetReference'

category: 'instance creation'
classmethod: RsrSetReference
from: aSet

	| referenceStream |
	referenceStream := WriteStream on: (Array new: aSet size).
	aSet do:  [:each | referenceStream nextPut: (RsrReference from: each)].
	^self intermediate: referenceStream contents
%

category: 'accessing'
classmethod: RsrSetReference
typeIdentifier

	^11
%

!		Instance methods for 'RsrSetReference'

category: 'resolving'
method: RsrSetReference
resolve: aConnection

	| set |
	set := Set new: intermediate size * 2.
	intermediate do: [:each | set add: (each resolve: aConnection)].
	^set
%

! Class implementation for 'RsrDateAndTimeReference'

!		Class methods for 'RsrDateAndTimeReference'

category: 'instance creation'
classmethod: RsrDateAndTimeReference
from: aDateAndTime

	| intermediate |
	intermediate := RsrDateAndTime microsecondsSinceEpoch: aDateAndTime.
	^self intermediate: intermediate
%

category: 'accessing'
classmethod: RsrDateAndTimeReference
typeIdentifier

	^14
%

!		Instance methods for 'RsrDateAndTimeReference'

category: 'encoding/decoding'
method: RsrDateAndTimeReference
decode: aStream
using: aDecoder

	intermediate := aDecoder decodeControlWord: aStream
%

category: 'encoding/decoding'
method: RsrDateAndTimeReference
encode: aStream
using: anEncoder

	anEncoder
		encodeControlWord: anEncoder immediateOID
		onto: aStream.
	anEncoder
		encodeControlWord: self typeIdentifier
		onto: aStream.
	anEncoder
		encodeControlWord: intermediate
		onto: aStream
%

category: 'resolving'
method: RsrDateAndTimeReference
resolve: aConnection

	^RsrDateAndTime fromMicroseconds: intermediate
%

! Class implementation for 'RsrDoubleReference'

!		Class methods for 'RsrDoubleReference'

category: 'instance creation'
classmethod: RsrDoubleReference
from: aFloat

	| intermediate |
	intermediate := self convertToBytes: aFloat.
	^self intermediate: intermediate
%

category: 'accessing'
classmethod: RsrDoubleReference
typeIdentifier

	^15
%

!		Instance methods for 'RsrDoubleReference'

category: 'encoding/decoding'
method: RsrDoubleReference
decode: aStream
using: aDecoder

	intermediate := aStream next: 8
%

category: 'encoding/decoding'
method: RsrDoubleReference
encode: aStream
using: anEncoder

	anEncoder
		encodeControlWord: anEncoder immediateOID
		onto: aStream.
	anEncoder
		encodeControlWord: self typeIdentifier
		onto: aStream.
	aStream nextPutAll: intermediate
%

category: 'resolving'
method: RsrDoubleReference
resolve: aConnection

	^self convertBytes: intermediate
%

! Class implementation for 'RsrIntegerReference'

!		Class methods for 'RsrIntegerReference'

category: 'converting'
classmethod: RsrIntegerReference
convertToBytes: anInteger

	| stream int |
	anInteger <= 0
		ifTrue: [^#[0]].
	stream := WriteStream on: (ByteArray new: 8).
	int := anInteger.
	[int > 0]
		whileTrue:
			[stream nextPut: (int bitAnd: 16rFF).
			int := int bitShift: -8].
	^stream contents reverse
%

category: 'instance creation'
classmethod: RsrIntegerReference
from: anInteger

	| intermediate |
	intermediate := self convertToBytes: anInteger abs.
	^anInteger positive
		ifTrue: [RsrPositiveIntegerReference intermediate: intermediate]
		ifFalse: [RsrNegativeIntegerReference intermediate: intermediate]
%

!		Instance methods for 'RsrIntegerReference'

category: 'converting'
method: RsrIntegerReference
convertBytes: aByteArray

	^aByteArray
		inject: 0
		into: [:integer :byte | (integer bitShift: 8) bitOr: byte]
%

category: 'encoding/decoding'
method: RsrIntegerReference
decode: aStream
using: aDecoder

	| length |
	length := aDecoder decodeControlWord: aStream.
	intermediate := aStream next: length
%

category: 'encoding/decoding'
method: RsrIntegerReference
encode: aStream
using: anEncoder

	anEncoder
		encodeControlWord: anEncoder immediateOID
		onto: aStream.
	anEncoder
		encodeControlWord: self typeIdentifier
		onto: aStream.
	anEncoder
		encodeControlWord: intermediate size
		onto: aStream.
	aStream nextPutAll: intermediate
%

category: 'resolving'
method: RsrIntegerReference
resolve: aConnection

	^self convertBytes: intermediate
%

! Class implementation for 'RsrNegativeIntegerReference'

!		Class methods for 'RsrNegativeIntegerReference'

category: 'accessing'
classmethod: RsrNegativeIntegerReference
typeIdentifier

	^4
%

!		Instance methods for 'RsrNegativeIntegerReference'

category: 'converting'
method: RsrNegativeIntegerReference
convertBytes: aByteArray

	^(super convertBytes: aByteArray) negated
%

! Class implementation for 'RsrPositiveIntegerReference'

!		Class methods for 'RsrPositiveIntegerReference'

category: 'accessing'
classmethod: RsrPositiveIntegerReference
typeIdentifier

	^3
%

! Class implementation for 'RsrServiceReference'

!		Class methods for 'RsrServiceReference'

category: 'analyzing'
classmethod: RsrServiceReference
analyze: aService
using: anAnalyzer

	^anAnalyzer analyzeService: aService
%

category: 'instance creation'
classmethod: RsrServiceReference
from: aService

	^self sid: aService _id
%

category: 'instance creation'
classmethod: RsrServiceReference
sid: aServiceID

	^self new
		sid: aServiceID;
		yourself
%

!		Instance methods for 'RsrServiceReference'

category: 'encoding/decoding'
method: RsrServiceReference
encode: aStream
using: anEncoder

	anEncoder
		encodeControlWord: self sid
		onto: aStream
%

category: 'resolving'
method: RsrServiceReference
resolve: aConnection

	^aConnection serviceAt: self sid
%

category: 'accessing'
method: RsrServiceReference
sid

	^sid
%

category: 'accessing'
method: RsrServiceReference
sid: aServiceID

	sid := aServiceID
%

! Class implementation for 'RsrRegistryEntry'

!		Class methods for 'RsrRegistryEntry'

category: 'instance creation'
classmethod: RsrRegistryEntry
service: aService
onMourn: aBlock

	| ephemeron |
	ephemeron := RsrServiceEphemeron
		service: aService
		action: aBlock.
	^self new
		ephemeron: ephemeron;
		yourself
%

!		Instance methods for 'RsrRegistryEntry'

category: 'transitions'
method: RsrRegistryEntry
becomeStrong

	strongStorage := self service
%

category: 'transitions'
method: RsrRegistryEntry
becomeWeak

	strongStorage := nil
%

category: 'private-accessing'
method: RsrRegistryEntry
ephemeron: aServiceEphemeron

	ephemeron := aServiceEphemeron
%

category: 'accessing'
method: RsrRegistryEntry
service

	^ephemeron service
%

! Class implementation for 'RsrRemotePromiseResolver'

!		Class methods for 'RsrRemotePromiseResolver'

category: 'instance creation'
classmethod: RsrRemotePromiseResolver
for: aSendMessage
over: aConnection

	^self new
		sendMessage: aSendMessage;
		connection: aConnection;
		yourself
%

!		Instance methods for 'RsrRemotePromiseResolver'

category: 'accessing'
method: RsrRemotePromiseResolver
addRoot: aService

	mutex critical: [extraRoots add: aService]
%

category: 'private'
method: RsrRemotePromiseResolver
assertNotResolved

	self hasResolved
		ifTrue: [RsrAlreadyResolved signal]
%

category: 'resolving'
method: RsrRemotePromiseResolver
break: aReason
	"<aReason> can be any object supported by RSR."

	self resolution: (Array with: #break with: aReason)
%

category: 'accessing'
method: RsrRemotePromiseResolver
connection

	^connection
%

category: 'accessing'
method: RsrRemotePromiseResolver
connection: aConnection

	connection := aConnection
%

category: 'resolving'
method: RsrRemotePromiseResolver
fulfill: result
	"Fulfill the remote promise with a fulfilled value of <result>"

	self resolution: (Array with: #fulfill with: result)
%

category: 'testing'
method: RsrRemotePromiseResolver
hasResolved

	^hasResolved
%

category: 'private'
method: RsrRemotePromiseResolver
initialize

	super initialize.
	extraRoots := OrderedCollection new.
	hasResolved := false.
	mutex := Semaphore forMutualExclusion
%

category: 'resolving'
method: RsrRemotePromiseResolver
resolution: result
	"Process and dispatch the result"

	mutex
		critical:
			[self hasResolved ifTrue: [^self].
			[self
				sendResult: result
				closureRoots: (Array with: result), extraRoots]
				on: Error
				do:
					[:ex | | answer |
					answer := Array
						with: #break
						with: (RsrRemoteException from: ex).
					self
						sendResult: answer
						closureRoots: answer.
					ex return].
			hasResolved := true]
%

category: 'accessing'
method: RsrRemotePromiseResolver
sendMessage

	^sendMessage
%

category: 'accessing'
method: RsrRemotePromiseResolver
sendMessage: aSendMessage

	sendMessage := aSendMessage
%

category: 'resolving'
method: RsrRemotePromiseResolver
sendResult: result
closureRoots: roots

	| analysis resultReference |
	analysis := RsrSnapshotAnalysis
		roots: roots
		connection: self connection.
	analysis perform.
	resultReference := RsrReference from: result.
	self
		sendResultReference: resultReference
		snapshots: analysis snapshots
%

category: 'resolving'
method: RsrRemotePromiseResolver
sendResultReference: resultReference
snapshots: snapshots

	| response |
	response := RsrDeliverResponse
				transaction: self sendMessage transaction
				responseReference: resultReference
				snapshots: snapshots.
	self connection _sendCommand: response
%

! Class implementation for 'RsrScientist'

!		Instance methods for 'RsrScientist'

category: 'instrumenting'
method: RsrScientist
instrument: aBlock
label: aString

	^aBlock value
%

category: 'instrumenting'
method: RsrScientist
profile: aBlock
label: aString

	^aBlock value
%

category: 'instrumenting'
method: RsrScientist
profile: aBlock
label: aString
if: aCondition

	^aBlock value
%

! Class implementation for 'RsrServiceEphemeron'

!		Class methods for 'RsrServiceEphemeron'

category: 'instance creation'
classmethod: RsrServiceEphemeron
service: aService
action: aBlock

	^self new
		service: aService;
		action: aBlock;
		beEphemeron: true;
		yourself
%

!		Instance methods for 'RsrServiceEphemeron'

category: 'accessing'
method: RsrServiceEphemeron
action

	^action
%

category: 'accessing'
method: RsrServiceEphemeron
action: aBlock

	action := aBlock
%

category: 'mourning'
method: RsrServiceEphemeron
mourn

	action value.
	service := action := nil
%

category: 'accessing'
method: RsrServiceEphemeron
service

	^service
%

category: 'accessing'
method: RsrServiceEphemeron
service: aService

	service := aService
%

! Class implementation for 'RsrServiceSnapshot'

!		Class methods for 'RsrServiceSnapshot'

category: 'instance creation'
classmethod: RsrServiceSnapshot
from: aService

	^self new
		snapshot: aService;
		yourself
%

category: 'variable utilites'
classmethod: RsrServiceSnapshot
reflectedVariableIndicesFor: aService
do: aBlock

	| allVariables |
	allVariables := aService class allInstVarNames.
	(self reflectedVariablesFor: aService)
		do:
			[:varName | | index |
			index := allVariables indexOf: varName.
			aBlock value: index]
%

category: 'variable utilites'
classmethod: RsrServiceSnapshot
reflectedVariablesFor: aService

	| currentClass variables template |
	variables := OrderedCollection new.
	template := aService _template.
	currentClass := template.
	[currentClass == RsrService]
		whileFalse:
			[currentClass instVarNames reverseDo: [:each | variables addFirst: each].
			currentClass := currentClass superclass].
	^variables
%

category: 'variable utilites'
classmethod: RsrServiceSnapshot
reflectedVariablesFor: aService
do: aBlock

	self
		reflectedVariableIndicesFor: aService
		do: [:index | aBlock value: (aService instVarAt: index)]
%

!		Instance methods for 'RsrServiceSnapshot'

category: 'accessing'
method: RsrServiceSnapshot
createInstanceRegisteredIn: aConnection

	| instance template |
	templateName isNil
		ifTrue:
			[self flag: 'This should go away once we cleanup the on-the-wire encoding.'.
			RsrUnknownClass signal].
	template := aConnection templateResolver templateNamed: self templateName.
	((aConnection policy permits: template) or: [template inheritsFrom: RsrReasonService])
		ifFalse: [RsrServiceRejected signalReason: (RsrPolicyRejectedService sid: sid templateName: templateName)].
	instance := self shouldCreateServer
		ifTrue: [template serverClass basicNew]
		ifFalse: [template clientClass basicNew].
	aConnection
		_register: instance
		as: self sid.
	^instance
%

category: 'other'
method: RsrServiceSnapshot
decode: aStream
using: aDecoder

	| species instVarCount targetClassName resolver template |
	species := aDecoder decodeControlWord: aStream.
	sid := aDecoder decodeControlWord: aStream.
	instVarCount := aDecoder decodeControlWord: aStream.
	targetClassName := (aDecoder decodeReference: aStream) resolve: nil.
	slots := OrderedCollection new: instVarCount.
	instVarCount timesRepeat: [slots add: (aDecoder decodeReference: aStream)].
	resolver := RsrTemplateResolver new.
	template := resolver templateNamed: targetClassName ifAbsent: [^nil].
	templateName := template name.
	shouldCreateServer := template serverClassName = targetClassName.
%

category: 'encoding/decoding'
method: RsrServiceSnapshot
encode: aStream
using: anEncoder

	anEncoder
		encodeControlWord: self snapshotIdentifier
		onto: aStream.
	anEncoder
		encodeControlWord: self sid
		onto: aStream.
	anEncoder
		encodeControlWord: self slots size
		onto: aStream.
	self targetClassNameReference
		encode: aStream
		using: anEncoder.
	self slots do: [:each | each encode: aStream using: anEncoder]
%

category: 'accessing'
method: RsrServiceSnapshot
instanceIn: aConnection

	| instance |
	instance := aConnection
		serviceAt: self sid
		ifAbsent: [self createInstanceRegisteredIn: aConnection].
	self shouldCreateServer
		ifTrue: [aConnection _stronglyRetain: instance].
	^instance
%

category: 'reifying'
method: RsrServiceSnapshot
reifyIn: aConnection

	| instance referenceStream |
	instance := self instanceIn: aConnection.
	(self class reflectedVariablesFor: instance) size = slots size 
		ifFalse: [ self error: 'Incorrectly encoded instance detected' ].
	referenceStream := ReadStream on: slots.
	self class reflectedVariableIndicesFor: instance do: [ :index | 
		instance
			instVarAt: index
			put: (referenceStream next resolve: aConnection) ].
	^ instance
%

category: 'testing'
method: RsrServiceSnapshot
shouldCreateServer

	^shouldCreateServer
%

category: 'accessing'
method: RsrServiceSnapshot
sid

	^sid
%

category: 'accessing'
method: RsrServiceSnapshot
sid: aServiceID

	sid := aServiceID
%

category: 'accessing'
method: RsrServiceSnapshot
slots

	^slots
%

category: 'accessing'
method: RsrServiceSnapshot
slots: anArrayOfReferences

	slots := anArrayOfReferences
%

category: 'other'
method: RsrServiceSnapshot
snapshot: aService

	| template |
	template := aService _template.
	sid := aService _id.
	templateName := template name.
	"If I am snapshotting a Client, the Snapshot represents a Server."
	shouldCreateServer := aService class isClientClass.
	slots := OrderedCollection new.
	RsrServiceSnapshot
		reflectedVariablesFor: aService
		do: [:each | slots add: (RsrReference from: each)]
%

category: 'accessing'
method: RsrServiceSnapshot
snapshotIdentifier

	^0
%

category: 'other'
method: RsrServiceSnapshot
targetClassName

	| template |
	template := RsrTemplateResolver new templateNamed: self templateName.
	^self shouldCreateServer
		ifTrue: [template serverClassName]
		ifFalse: [template clientClassName]
%

category: 'other'
method: RsrServiceSnapshot
targetClassNameReference

	^RsrSymbolReference from: self targetClassName
%

category: 'other'
method: RsrServiceSnapshot
templateName

	^templateName
%

! Class implementation for 'RsrSignalErrorInAsString'

!		Instance methods for 'RsrSignalErrorInAsString'

category: 'converting'
method: RsrSignalErrorInAsString
asString

	^Error signal
%

! Class implementation for 'RsrSnapshotAnalysis'

!		Class methods for 'RsrSnapshotAnalysis'

category: 'instance creation'
classmethod: RsrSnapshotAnalysis
roots: anArray
connection: aConnection

	^self new
		roots: anArray;
		connection: aConnection;
		yourself
%

!		Instance methods for 'RsrSnapshotAnalysis'

category: 'analyzing'
method: RsrSnapshotAnalysis
analyze: anObject

	(analyzedObjects includes: anObject) ifTrue: [ ^ self ].
	analyzedObjects add: anObject.
	^ (self referenceClassFor: anObject) analyze: anObject using: self
%

category: 'analyzing'
method: RsrSnapshotAnalysis
analyzeCollection: aCollection

	aCollection do: [ :each | self analyze: each ].
	^ aCollection
%

category: 'analyzing'
method: RsrSnapshotAnalysis
analyzeDictionary: aDictionary

	aDictionary keysAndValuesDo: [ :key :value | 
		self
			analyze: key;
			analyze: value ].
	^ aDictionary
%

category: 'accessing'
method: RsrSnapshotAnalysis
analyzedObjects

	^ analyzedObjects
%

category: 'analyzing'
method: RsrSnapshotAnalysis
analyzeImmediate: anImmediateObject

	^anImmediateObject
%

category: 'analyzing'
method: RsrSnapshotAnalysis
analyzeService: aService

	self ensureRegistered: aService.
	RsrServiceSnapshot
		reflectedVariablesFor: aService
		do: [ :each | self analyze: each ].
	snapshots add: (RsrServiceSnapshot from: aService)
%

category: 'accessing'
method: RsrSnapshotAnalysis
connection

	^connection
%

category: 'accessing'
method: RsrSnapshotAnalysis
connection: aConnection

	connection := aConnection
%

category: 'actions'
method: RsrSnapshotAnalysis
ensureRegistered: aService

	self connection _ensureRegistered: aService.
	aService isServer
		ifTrue: [self connection _stronglyRetain: aService]
%

category: 'initialization'
method: RsrSnapshotAnalysis
initialize

	super initialize.
	snapshots := OrderedCollection new.
	analyzedObjects := IdentitySet new
%

category: 'actions'
method: RsrSnapshotAnalysis
perform

	roots do: [:each | self analyze: each]
%

category: 'accessing'
method: RsrSnapshotAnalysis
referenceClassFor: anObject

	^RsrReference referenceClassFor: anObject
%

category: 'accessing'
method: RsrSnapshotAnalysis
roots

	^roots
%

category: 'accessing'
method: RsrSnapshotAnalysis
roots: anArray

	roots := anArray
%

category: 'actions'
method: RsrSnapshotAnalysis
snapshot: aService

	snapshots add: (RsrServiceSnapshot from: aService)
%

category: 'accessing'
method: RsrSnapshotAnalysis
snapshots

	^snapshots
%

category: 'accessing'
method: RsrSnapshotAnalysis
snapshots: anOrderedCollection

	snapshots := anOrderedCollection
%

! Class implementation for 'RsrSocket'

!		Class methods for 'RsrSocket'

category: 'private-instance creation'
classmethod: RsrSocket
_nativeSocket: aGsSignalingSocket
	"Private - Create a instance backed by the provided GsSignalingSocket"

	^self basicNew
		_nativeSocket: aGsSignalingSocket;
		yourself
%

!		Instance methods for 'RsrSocket'

category: 'accepting connections'
method: RsrSocket
accept
	"Return an RsrSocket which is connected to a peer. In the event that the socket is closed while waiting, signal RsrSocketClosed."

	^[self class _nativeSocket: nativeSocket accept]
		on: SocketError
		do: [:ex | ex resignalAs: (RsrSocketError new messageText: ex messageText)]
%

category: 'accepting connections'
method: RsrSocket
bindAddress: address
port: port
	"Bind the socket to the provided port and address. Signal RsrInvalidBind in the event the bind fails."

	[nativeSocket
		bindTo: port
		toAddress: address]
			on: SocketError, OutOfRange
			do: [:ex | ex resignalAs: (RsrInvalidBind new messageText: ex messageText)]
%

category: 'terminating connections'
method: RsrSocket
close
	"Ensure closure of the Socket and cleanup any associated resources."

	nativeSocket close
%

category: 'establishing connections'
method: RsrSocket
connectToHost: hostname
port: port
	"Establish a connect to the provided host and port. If the socket is unable to establish, signal RsrConnectFailed.
	If the socket is bound to an address/port, signal RsrInvalidConnect.
	<hostname> - The name or ip address of a machine which should accept a connection.
	<port> - An integer representing a valid TCP port."

	nativeSocket interrupting: true.
	[nativeSocket
		connectTo: port
		on: hostname]
			on: SocketError, OutOfRange
			do: [:ex | ex resignalAs: (RsrConnectFailed new messageText: ex messageText)]
%

category: 'initialize'
method: RsrSocket
initialize

	super initialize.
	nativeSocket := GsSignalingSocket new.
%

category: 'testing'
method: RsrSocket
isConnected
	"Return true if the socket is open and connected with a peer. Return false otherwise."

	^nativeSocket isConnected
%

category: 'accepting connections'
method: RsrSocket
listen: backlogLength
	"Starting listening for connections. <backlogLength> specifies the number of connections to allow in a pending state.
	The actual backlog may support fewer prending connections depending upon implementation."

	nativeSocket makeListener: backlogLength
%

category: 'accessing'
method: RsrSocket
port
	"Return the port associated with the socket."

	^nativeSocket port
%

category: 'read/write'
method: RsrSocket
read: count
into: bytes
startingAt: index
	"Read <count> number of bytes into <bytes> and place the first byte into slot <index>.
	<bytes> is assumed to be at least <count + index> bytes in size.
	Return the number of bytes successfully read. Signal RsrSocketClosed if the socket is closed before or during the call."

	| numRead |
	[numRead := nativeSocket
		read: count
		into: bytes
		startingAt: index]
			on: SocketError
			do: [:ex | ex resignalAs: (RsrSocketClosed new messageText: ex messageText)].
	^numRead > 0
		ifTrue: [numRead]
		ifFalse:
			[nativeSocket close.
			RsrSocketClosed signal]
%

category: 'read/write'
method: RsrSocket
write: count
from: bytes
startingAt: index
	"Write <count> number of bytes from <bytes> with <index> as the index of the first bytes.
	If <bytes> is smaller than <index + count> the behavior is undefined.
	If the socket is not connected, signal RsrSocketClosed."

	^[nativeSocket
		write: count
		from: bytes
		startingAt: index]
			on: SocketError
			do: [:ex | ex resignalAs: (RsrSocketClosed new messageText: ex messageText)]
%

category: 'private-accessing'
method: RsrSocket
_nativeSocket: aGsSignalingSocket
	"Private - Configure w/ a platform socket"

	nativeSocket := aGsSignalingSocket.
	nativeSocket interrupting: true
%

! Class implementation for 'RsrSocketPair'

!		Class methods for 'RsrSocketPair'

category: 'instance creation'
classmethod: RsrSocketPair
firstSocket: firstSocket
secondSocket: secondSocket

	^super new
		firstSocket: firstSocket;
		secondSocket: secondSocket;
		yourself
%

category: 'accessing'
classmethod: RsrSocketPair
listenPort

	^64455
%

category: 'instance creation'
classmethod: RsrSocketPair
new

	| localhost port listener firstSocket secondSocket |
	localhost := '127.0.0.1'.
	port := 8765.
	listener := self socketClass new.
	secondSocket := self socketClass new.
	listener
		bindAddress: localhost
		port: port.
	listener listen: 1.
	secondSocket
		connectToHost: localhost
		port: port.
	firstSocket := listener accept.
	listener close.
	(firstSocket isConnected and: [secondSocket isConnected])
		ifFalse: [self error: 'Failed to create socket pair'].
	^self
		firstSocket: firstSocket
		secondSocket: secondSocket
%

category: 'accessing'
classmethod: RsrSocketPair
socketClass

	^RsrSocket
%

!		Instance methods for 'RsrSocketPair'

category: 'closing'
method: RsrSocketPair
close

	firstSocket close.
	secondSocket close
%

category: 'accessing'
method: RsrSocketPair
firstSocket

	^firstSocket
%

category: 'accessing'
method: RsrSocketPair
firstSocket: anObject

	firstSocket := anObject
%

category: 'accessing'
method: RsrSocketPair
firstStream

	^self socketStreamClass on: firstSocket
%

category: 'accessing'
method: RsrSocketPair
secondSocket

	^secondSocket
%

category: 'accessing'
method: RsrSocketPair
secondSocket: anObject

	secondSocket := anObject
%

category: 'accessing'
method: RsrSocketPair
secondStream

	^self socketStreamClass on: secondSocket
%

category: 'accessing'
method: RsrSocketPair
socketStreamClass

	^(RsrClassResolver classNamed: #RsrSocketStream)
%

! Class implementation for 'RsrStream'

!		Instance methods for 'RsrStream'

category: 'testing'
method: RsrStream
atEnd
	"Answers when the Stream cannot take or provide any additional bytes."

	^self subclassResponsibility
%

category: 'closing'
method: RsrStream
close
	"Close the Stream. The semantics of this are defined by the subclass."

	self subclassResponsibility
%

category: 'writing'
method: RsrStream
flush
	"Ensure any data cached by the receiver is pushed to its destination."
	"By default, do nothing."
%

category: 'reading'
method: RsrStream
next
	"Read and return exactly 1 byte."

	^self next: 1
%

category: 'reading'
method: RsrStream
next: count
	"Read and return exactly <count> bytes"

	^self subclassResponsibility
%

category: 'writing'
method: RsrStream
nextPutAll: aByteArray
	"Write <aByteArray>'s elements to the backing store."

	^self subclassResponsibility
%

! Class implementation for 'RsrSocketStream'

!		Class methods for 'RsrSocketStream'

category: 'instance creation'
classmethod: RsrSocketStream
on: anRsrSocket

	^self new
		socket: anRsrSocket;
		yourself
%

!		Instance methods for 'RsrSocketStream'

category: 'testing'
method: RsrSocketStream
atEnd
	"Return whether additional bytes could become available on the socket."

	^socket isConnected not
%

category: 'accessing'
method: RsrSocketStream
bufferSize
	"The most bytes we'll send to the underlying socket at once, or 
	attempt to read from the underlying socket at one time."

	^65536
%

category: 'closing'
method: RsrSocketStream
close

	socket close
%

category: 'adding'
method: RsrSocketStream
flush

	"Write buffered bytes to the socket"

	| allBytesWritten |
	allBytesWritten := 0.
	[ allBytesWritten < position ] whileTrue: [ 
		| bytesWritten |
		bytesWritten := socket
			                write: position - allBytesWritten
			                from: sendBuffer
			                startingAt: allBytesWritten + 1.
		allBytesWritten := allBytesWritten + bytesWritten ].
	position := 0
%

category: 'initializing'
method: RsrSocketStream
initialize

	super initialize.
	sendBuffer := ByteArray new: self bufferSize.
	self reset
%

category: 'accessing'
method: RsrSocketStream
next
	"Return the next byte"

	^self next: 1
%

category: 'accessing'
method: RsrSocketStream
next: count

	"Return exactly <count> number of bytes.
	Signal RsrSocketClosed if the socket closes."

	| chunkSize bytes totalRead numRead |
	chunkSize := self bufferSize.
	bytes := ByteArray new: count.
	totalRead := 0.
	[ totalRead < count ] whileTrue: [ 
		numRead := socket
			           read: (chunkSize min: count - totalRead)
			           into: bytes
			           startingAt: totalRead + 1.
		totalRead := totalRead + numRead ].
	^ bytes
%

category: 'adding'
method: RsrSocketStream
nextPut: aByte

	position = sendBuffer size ifTrue: [ self flush ].
	position := position + 1.
	sendBuffer at: position put: aByte
%

category: 'adding'
method: RsrSocketStream
nextPutAll: bytes

	"Write <bytes> to the buffer, sending to socket if the buffer fills."

	| numPut yetToPut |
	numPut := 0.
	[ 
	yetToPut := bytes size - numPut.
	yetToPut > 0 ] whileTrue: [ 
		| copyCount |
		copyCount := yetToPut min: sendBuffer size - position.
		sendBuffer
			replaceFrom: position + 1
			to: position + copyCount
			with: bytes
			startingAt: numPut + 1.
		position := position + copyCount.
		position = sendBuffer size ifTrue: [ self flush ].
		numPut := numPut + copyCount ]
%

category: 'accessing'
method: RsrSocketStream
reset

	position := 0
%

category: 'accessing'
method: RsrSocketStream
socket: anRsrSocket

	socket := anRsrSocket
%

! Class implementation for 'RsrStreamChannelLoop'

!		Class methods for 'RsrStreamChannelLoop'

category: 'instance creation'
classmethod: RsrStreamChannelLoop
on: aChannel

	^self new
		channel: aChannel;
		yourself
%

!		Instance methods for 'RsrStreamChannelLoop'

category: 'accessing'
method: RsrStreamChannelLoop
channel

	^channel
%

category: 'accessing'
method: RsrStreamChannelLoop
channel: aChannel

	channel := aChannel
%

category: 'running'
method: RsrStreamChannelLoop
executeCycle

	self subclassResponsibility
%

category: 'initialization'
method: RsrStreamChannelLoop
initialize

	super initialize.
	state := self stoppedState
%

category: 'testing'
method: RsrStreamChannelLoop
isActive

	^state == self runningState
%

category: 'testing'
method: RsrStreamChannelLoop
isProcessActive

	^process ~~ nil
%

category: 'running'
method: RsrStreamChannelLoop
log

	^RsrLogWithPrefix
		prefix: self class name asString
		log: self channel log
%

category: 'running'
method: RsrStreamChannelLoop
log: aString

	self log debug: aString
%

category: 'running'
method: RsrStreamChannelLoop
report: aCommand

	aCommand reportOn: self log
%

category: 'running'
method: RsrStreamChannelLoop
reportException: anException

	self log: anException description
%

category: 'running'
method: RsrStreamChannelLoop
runLoop

	[self isActive]
		whileTrue:
			[[self executeCycle]
				on: Error
				do:
					[:ex |
					self reportException: ex.
					self channel genericError: ex]]
%

category: 'accessing'
method: RsrStreamChannelLoop
runLoopName
	"Return the name of the associated run loop.
	This name is assigned to the Process used to execute the run loop."

	^self subclassResponsibility
%

category: 'accessing'
method: RsrStreamChannelLoop
runningState

	^#Running
%

category: 'commands'
method: RsrStreamChannelLoop
start

	state := self runningState.
	process := RsrProcessModel
		fork:
			[RsrProcessModel configureCommunicationsProcess.
			self runLoop.
			process := nil]
		named: self runLoopName
%

category: 'commands'
method: RsrStreamChannelLoop
stop

	self isActive ifFalse: [^self].
	state := self stoppedState
%

category: 'accessing'
method: RsrStreamChannelLoop
stoppedState

	^#Stop
%

! Class implementation for 'RsrCommandSink'

!		Instance methods for 'RsrCommandSink'

category: 'accessing'
method: RsrCommandSink
addCommunicationProcessesTo: aSet
	"Add all processes used for Communication to the provided set."
	
	aSet add: process
%

category: 'accessing'
method: RsrCommandSink
encoder

	^RsrCommandEncoder new
%

category: 'commands'
method: RsrCommandSink
enqueue: aCommand

	self isActive ifTrue: [queue nextPut: aCommand]
%

category: 'commands'
method: RsrCommandSink
executeCycle

	[| command |
	command := queue next.
	command == self stopToken
		ifTrue: [^self].
	self writeCommand: command.
	(queue size = 0) "Dolphin does not support #isEmpty"
		ifTrue: [self flush]]
		on: RsrSocketClosed
		do:
			[:ex |
			self reportException: ex.
			self channel disconnected]
%

category: 'commands'
method: RsrCommandSink
flush

	self outStream flush
%

category: 'initialization'
method: RsrCommandSink
initialize

	super initialize.
	queue := SharedQueue new
%

category: 'accessing'
method: RsrCommandSink
outStream

	^self channel outStream
%

category: 'accessing'
method: RsrCommandSink
runLoopName

	^'Connection Writing'
%

category: 'commands'
method: RsrCommandSink
stop

	super stop.
	queue nextPut: self stopToken
%

category: 'accessing'
method: RsrCommandSink
stopToken

	^self stoppedState
%

category: 'writing'
method: RsrCommandSink
write: aByteArray

	self outStream nextPutAll: aByteArray
%

category: 'writing'
method: RsrCommandSink
writeCommand: aCommand

	self report: aCommand.
	aCommand
		encode: self outStream
		using: self encoder
%

! Class implementation for 'RsrCommandSource'

!		Instance methods for 'RsrCommandSource'

category: 'accessing'
method: RsrCommandSource
addCommunicationProcessesTo: aSet
	"Add all processes used for Communication to the provided set."
	
	aSet add: process
%

category: 'accessing'
method: RsrCommandSource
decoder

	^RsrCommandDecoder new
%

category: 'commands'
method: RsrCommandSource
executeCycle

	[| command |
	command := self nextCommand.
	self report: command.
	self channel received: command]
		on: RsrSocketClosed
		do:
			[:ex |
			self reportException: ex.
			self channel disconnected]
%

category: 'accessing'
method: RsrCommandSource
inStream
	"Return the read stream associated w/ this channel."

	^self channel inStream
%

category: 'commands'
method: RsrCommandSource
nextCommand

	^self decoder decodeCommand: self inStream
%

category: 'accessing'
method: RsrCommandSource
runLoopName

	^'Connection Reading'
%

! Class implementation for 'RsrThreadSafeDictionary'

!		Instance methods for 'RsrThreadSafeDictionary'

category: 'accessing'
method: RsrThreadSafeDictionary
at: aKey
ifAbsent: aBlock

	| isPresent result |
	isPresent := true.
	result := self critical: [map at: aKey ifAbsent: [isPresent := false]].
	^isPresent
		ifTrue: [result]
		ifFalse: [aBlock value]
%

category: 'accessing'
method: RsrThreadSafeDictionary
at: aKey
put: aValue

	self critical: [map at: aKey put: aValue].
	^aValue
%

category: 'utilities'
method: RsrThreadSafeDictionary
critical: aBlock

	^mutex critical: aBlock
%

category: 'enumerating'
method: RsrThreadSafeDictionary
do: aBlock

	| values |
	values := self critical: [map values].
	values do: aBlock
%

category: 'initialization'
method: RsrThreadSafeDictionary
initialize

	super initialize.
	mutex := Semaphore forMutualExclusion.
	map := Dictionary new
%

category: 'removing'
method: RsrThreadSafeDictionary
removeKey: anRsrId

	^self critical: [map removeKey: anRsrId ifAbsent: [nil]]
%

category: 'removing'
method: RsrThreadSafeDictionary
removeKey: anRsrId
ifAbsent: aBlock

	| element wasRemoved |
	wasRemoved := true.
	element := self critical: [map removeKey: anRsrId ifAbsent: [wasRemoved := false]].
	^wasRemoved
		ifTrue: [element]
		ifFalse: [aBlock value]
%

! Class implementation for 'RsrTokenExchangeMessage'

!		Instance methods for 'RsrTokenExchangeMessage'

category: 'comparing'
method: RsrTokenExchangeMessage
= aTokenExchangeMessage

	^self class == aTokenExchangeMessage class
%

category: 'hashing'
method: RsrTokenExchangeMessage
hash

	^self class hash
%

! Class implementation for 'RsrToken'

!		Class methods for 'RsrToken'

category: 'instance creation'
classmethod: RsrToken
bytes: aByteArray

	^self new
		bytes: aByteArray;
		yourself
%

!		Instance methods for 'RsrToken'

category: 'comparing'
method: RsrToken
= aToken

	^self class == aToken class and: [self bytes = aToken bytes]
%

category: 'accessing'
method: RsrToken
bytes

	^bytes
%

category: 'accessing'
method: RsrToken
bytes: aByteArray

	bytes := aByteArray
%

category: 'hashing'
method: RsrToken
hash

	^self bytes hash
%

! Class implementation for 'RsrTokenAccepted'

!		Instance methods for 'RsrTokenAccepted'

category: 'testing'
method: RsrTokenAccepted
wasAccepted

	^true
%

! Class implementation for 'RsrTokenRejected'

!		Instance methods for 'RsrTokenRejected'

category: 'testing'
method: RsrTokenRejected
wasAccepted

	^false
%

! Class implementation for 'RsrPlatformInitializer'

!		Class methods for 'RsrPlatformInitializer'

category: 'class initialization'
classmethod: RsrPlatformInitializer
initialize

	RsrReference initializeReferenceMapping
%

! Class implementation for 'RsrProcessModel'

!		Class methods for 'RsrProcessModel'

category: 'configuring'
classmethod: RsrProcessModel
configureCommunicationsProcess
	"Apply framework configuration to the currently running communications process."

	^self current configureCommunicationsProcess
%

category: 'configuring'
classmethod: RsrProcessModel
configureFrameworkProcess
	"Apply framework configuration to the currently running process."

	^self current configureFrameworkProcess
%

category: 'configuring'
classmethod: RsrProcessModel
configureUnhandleExceptionProtection
	"Configure the process to ensure we are able to trap any unhandled exceptions."

	^self current configureUnhandleExceptionProtection
%

category: 'managing-concurrency'
classmethod: RsrProcessModel
currentStackDump

	^self current currentStackDump
%

category: 'managing-concurrency'
classmethod: RsrProcessModel
fork: aBlock
at: aPriority
named: aString

	^self current
		fork: aBlock
		at: aPriority
		named: aString
%

category: 'managing-concurrency'
classmethod: RsrProcessModel
fork: aBlock
named: aString

	^self current fork: aBlock named: aString
%

category: 'managing-concurrency'
classmethod: RsrProcessModel
renameProcess: aString
	"Rename the current process to the provided string"

	^self current renameProcess: aString
%

!		Instance methods for 'RsrProcessModel'

category: 'configuring'
method: RsrProcessModel
communicationsSchedulePriority
	"Returns the priority level used by communications processes."

	^Processor highIOPriority
%

category: 'configuring'
method: RsrProcessModel
configureCommunicationsProcess
	"Apply framework configuration to the currently running communications process."

	Processor activeProcess
		priority: self communicationsSchedulePriority
%

category: 'configuring'
method: RsrProcessModel
configureFrameworkProcess
	"Apply framework configuration to the currently running process."

	Processor activeProcess
		priority: self frameworkSchedulingPriority
%

category: 'managing-concurrency'
method: RsrProcessModel
fork: aBlock
at: aPriority
named: aString

	^[self renameProcess: aString.
	aBlock value] forkAt: aPriority
%

category: 'managing-concurrency'
method: RsrProcessModel
fork: aBlock
named: aString

	^[self renameProcess: aString.
	aBlock value] fork
%

category: 'configuring'
method: RsrProcessModel
frameworkSchedulingPriority
	"Returns the priority level used by normal framework processes."

	^Processor userInterruptPriority
%

category: 'renaming'
method: RsrProcessModel
renameProcess: aString

	Processor activeProcess name: aString
%

! Class implementation for 'RsrTestingProcessModel'

!		Instance methods for 'RsrTestingProcessModel'

category: 'managing-concurrency'
method: RsrTestingProcessModel
fork: aBlock
at: aPriority
named: aString

	^super
		fork: (self protect: aBlock)
		at: aPriority
		named: aString
%

category: 'managing-concurrency'
method: RsrTestingProcessModel
fork: aBlock
named: aString

	^super
		fork: (self protect: aBlock)
		named: aString
%

category: 'accessing'
method: RsrTestingProcessModel
forkedException

	^forkedException
%

category: 'accessing'
method: RsrTestingProcessModel
protect: aBlock

	^[aBlock on: self class unhandledExceptionClass do: [:ue | forkedException := ue exception copy. ue return]]
%

! Class implementation for 'RsrTestCase'

!		Class methods for 'RsrTestCase'

category: 'accessing'
classmethod: RsrTestCase
defaultTimeLimit
	"This is needed for Pharo"

	^5 seconds
%

category: 'testing'
classmethod: RsrTestCase
isAbstract

	^self == RsrTestCase
%

!		Instance methods for 'RsrTestCase'

category: 'asserting'
method: RsrTestCase
assert: anObject
identicalTo: bObject

	self assert: anObject == bObject
%

category: 'utilities'
method: RsrTestCase
assumption: aString
	"This method serves as a marker for assumptions made in the tests.
	Perhaps some of the senders can be removed in the future."
%

category: 'asserting'
method: RsrTestCase
deny: anObject
identicalTo: bObject

	self assert: anObject ~~ bObject
%

category: 'utilities'
method: RsrTestCase
hack: aString
	"Placeholder for things that need to be fixed"
%

category: 'utilities'
method: RsrTestCase
maximumReclamation

	self assert: RsrGarbageCollector maximumReclamation
%

category: 'running'
method: RsrTestCase
runCase

	| pm |
	pm := RsrTestingProcessModel new.
	RsrProcessModel current: pm.
	[super runCase]
		ensure:
			[RsrProcessModel resetCurrent].
	pm forkedException ifNotNil: [:ex | ex signal]
%

category: 'utilities'
method: RsrTestCase
shortWait

	(Delay forMilliseconds: 100) wait
%

! Class implementation for 'RsrAsyncMournHandlerTestCase'

!		Instance methods for 'RsrAsyncMournHandlerTestCase'

category: 'utilities'
method: RsrAsyncMournHandlerTestCase
finalizationProcess

	| proc |
	self finalizeEphemeronWithAction: [proc := Processor activeProcess].
	^proc
%

category: 'utilities'
method: RsrAsyncMournHandlerTestCase
finalizeEphemeronWithAction: aBlock

	| semaphore ephemeron |
	semaphore := Semaphore new.
	ephemeron := RsrEphemeron
		on: Object new
		mournAction:
			[aBlock value.
			semaphore signal].
	RsrGarbageCollector maximumReclamation.
	self assert: (semaphore waitForSeconds: 1)
%

category: 'initializing'
method: RsrAsyncMournHandlerTestCase
setUp

	super setUp.
	handler := RsrAsyncMournHandler current.
	handler start
%

category: 'initializing'
method: RsrAsyncMournHandlerTestCase
tearDown

	handler stop.
	super tearDown
%

category: 'running'
method: RsrAsyncMournHandlerTestCase
testAnotherAsyncHandlerExists

	| notifier |
	handler stop.
	[notifier := GsSignalingSocket newForAsyncExceptions: {GcFinalizeNotification }.
	self
		should: [handler start]
		raise: RsrNotification] ensure: [GsSignalingSocket disableAsyncExceptions].
	self
		shouldnt: [handler start]
		raise: RsrNotification
%

category: 'running'
method: RsrAsyncMournHandlerTestCase
testEnsureSingletonWhileActive

	| duplicateHandler |
	duplicateHandler := RsrAsyncMournHandler current.
	self
		assert: duplicateHandler
		identicalTo: handler
%

category: 'running'
method: RsrAsyncMournHandlerTestCase
testEnsureStarted

	| nonHandlerFinalizeProcess handlerFinalizeProcess1 handlerFinalizeProcess2 |
	handler stop.
	nonHandlerFinalizeProcess := self finalizationProcess.
	self deny: handler isActive.
	handler ensureStarted.
	self assert: handler isActive.
	handlerFinalizeProcess1 := self finalizationProcess.
	handler ensureStarted.
	self assert: handler isActive.
	handlerFinalizeProcess2 := self finalizationProcess.
	self
		deny: nonHandlerFinalizeProcess
		identicalTo: handlerFinalizeProcess1.
	self
		assert: handlerFinalizeProcess1
		identicalTo: handlerFinalizeProcess2
%

category: 'running'
method: RsrAsyncMournHandlerTestCase
testHandlerStops

	| handlerProcess mournProcess |
	handlerProcess := handler process.
	handler stop.
	mournProcess := self finalizationProcess.
	self
		deny: mournProcess
		equals: handlerProcess.
	self deny: handlerProcess isNil
%

category: 'running'
method: RsrAsyncMournHandlerTestCase
testMournEphemeron

	| mournProcess |
	mournProcess := self finalizationProcess.
	self
		assert: mournProcess
		equals: handler process
%

category: 'running'
method: RsrAsyncMournHandlerTestCase
testNewRaisesError

	self
		should: [RsrAsyncMournHandler new]
		raise: RsrError
%

! Class implementation for 'RsrClassResolverTestCase'

!		Instance methods for 'RsrClassResolverTestCase'

category: 'asserting'
method: RsrClassResolverTestCase
assert: aClassName
resolvesTo: expectedClass

	| actualClass |
	actualClass := RsrClassResolver classNamed: aClassName.
	self
		assert: actualClass
		identicalTo: expectedClass
%

category: 'running'
method: RsrClassResolverTestCase
testFailedResolution

	| actual marker |
	self
		should: [RsrClassResolver classNamed: #Xlerb]
		raise: RsrUnknownClass.
	marker := Object new.
	actual := RsrClassResolver
		classNamed: #Xlerb
		ifAbsent: [marker].
	self
		assert: actual
		identicalTo: marker
%

category: 'running'
method: RsrClassResolverTestCase
testSuccessfulResolution

	| actual |
	actual := RsrClassResolver classNamed: #Object.
	self
		assert: actual
		identicalTo: Object.
	actual := RsrClassResolver
		classNamed: #Object
		ifAbsent: [self assert: false].
	self
		assert: actual
		identicalTo: Object
%

! Class implementation for 'RsrCommandCodecTest'

!		Class methods for 'RsrCommandCodecTest'

category: 'testing'
classmethod: RsrCommandCodecTest
isAbstract

	^self == RsrCommandCodecTest
%

!		Instance methods for 'RsrCommandCodecTest'

category: 'accessing'
method: RsrCommandCodecTest
connection

	^connection
%

category: 'other'
method: RsrCommandCodecTest
decoder

	^RsrCommandDecoder new
%

category: 'accessing'
method: RsrCommandCodecTest
encoder

	^RsrCommandEncoder new
%

category: 'encode/decode'
method: RsrCommandCodecTest
encodeReferenceOf: anObject

	| reference |
	reference := RsrReference from: anObject.
	^ByteArray streamContents: [:stream | self encoder encodeReference: reference onto: stream]
%

category: 'running-symbol'
method: RsrCommandCodecTest
genericSymbol

	^#genericSymbol
%

category: 'running-symbol'
method: RsrCommandCodecTest
genericSymbolEncoding

	^#[0 0 0 0 0 0 0 0], "OID = 0"
	#[0 0 0 0 0 0 0 1], "Immediate Type = 1"
	#[0 0 0 0 0 0 0 13], "Length of UTF-8 data"
	#[103 101 110 101 114 105 99 83 121 109 98 111 108]	"#genericSymbol"
%

category: 'accessing-objects'
method: RsrCommandCodecTest
referencedServiceEncoding

	^#[0 0 0 0 0 0 0 0], "type"
	#[0 0 0 0 0 0 0 2], "referencedService's OID = 2"
	#[0 0 0 0 0 0 0 0], "Inst Var Count"
	#[0 0 0 0 0 0 0 0], "Start of service name. OID = 0"
	#[0 0 0 0 0 0 0 1], "Service name = 1 -> Symbol"
	#[0 0 0 0 0 0 0 19], "Length of UTF-8 encoded bytes"
	#[82 115 114 83 101 114 118 101 114 78 111 73 110 115 116 86 97 114 115]. "#RsrServerNoInstVars"
%

category: 'accessing-objects'
method: RsrCommandCodecTest
rootServiceEncoding

	^#[0 0 0 0 0 0 0 0], "type"
	#[0 0 0 0 0 0 0 1], "rootService's OID = 1"
	#[0 0 0 0 0 0 0 1], "Inst Var Count"
	#[0 0 0 0 0 0 0 0], "Start of service name. OID = 0"
	#[0 0 0 0 0 0 0 1], "Service name = 1 -> Symbol"
	#[0 0 0 0 0 0 0 25], "Length of UTF-8 encoded bytes"
	#[82 115 114 83 101 114 118 101 114 82 101 102 101 114 101 110 99 101 83 101 114 118 105 99 101],
	#[0 0 0 0 0 0 0 2]. "#RsrServerReferenceService"
%

category: 'running'
method: RsrCommandCodecTest
serviceNoInstVarsEncoding

	^#[0 0 0 0 0 0 0 0], "type"
	#[0 0 0 0 0 0 0 1], "rootService's OID = 1"
	#[0 0 0 0 0 0 0 0], "Inst Var Count"
	#[0 0 0 0 0 0 0 0], "Start of service name. OID = 0"
	#[0 0 0 0 0 0 0 1], "Service name = 1 -> Symbol"
	#[0 0 0 0 0 0 0 19], "Length of UTF-8 encoded bytes"
	#[82 115 114 83 101 114 118 101 114 78 111 73 110 115 116 86 97 114 115] "#RsrServerNoInstVars"
%

category: 'other'
method: RsrCommandCodecTest
setUp

	super setUp.
	connection := RsrConnection
		channel: RsrNullChannel new
		transactionSpigot: RsrThreadSafeNumericSpigot naturals
		oidSpigot: RsrThreadSafeNumericSpigot naturals.
	connection open
%

category: 'other'
method: RsrCommandCodecTest
tearDown

	connection close.
	connection := nil.
	super tearDown
%

category: 'running-immediates'
method: RsrCommandCodecTest
testArray

	| array encoding |
	array := Array
		with: self genericSymbol
		with: 5
		with: nil.
	encoding :=
		#[0 0 0 0 0 0 0 0], "Immediate Object OID"
		#[0 0 0 0 0 0 0 9], "Array type"
		#[0 0 0 0 0 0 0 3], "3 elements"
		self genericSymbolEncoding, "Generic Symbol"
		#[0 0 0 0 0 0 0 0], "Immediate OID"
		#[0 0 0 0 0 0 0 3], "Positive Integer"
		#[0 0 0 0 0 0 0 1], "num bytes"
		#[5], "5"
		#[0 0 0 0 0 0 0 0], "Immediate OID"
		#[0 0 0 0 0 0 0 6].
	self
		verifyImmediate: array
		encoding: encoding.
	array := Array new.
	encoding :=
		#[0 0 0 0 0 0 0 0], "Immediate OID"
		#[0 0 0 0 0 0 0 9], "Array type"
		#[0 0 0 0 0 0 0 0].
	self
		verifyImmediate: array
		encoding: encoding
%

category: 'running-immediates'
method: RsrCommandCodecTest
testBoolean

	| encoding |
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 7].
	self
		verifyImmediate: true
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 8].
	self
		verifyImmediate: false
		encoding: encoding.
%

category: 'running-immediates'
method: RsrCommandCodecTest
testByteArray

	| bytes encoding |
	bytes := #[].
	encoding :=
		#[0 0 0 0 0 0 0 0], "Immediate Object OID"
		#[0 0 0 0 0 0 0 10], "ByteArray type"
		#[0 0 0 0 0 0 0 0], "size"
		bytes.
	self
		verifyImmediate: bytes
		encoding: encoding.
	bytes := #[1 2 3 4 5].
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 10],
		#[0 0 0 0 0 0 0 5],
		bytes.
	self
		verifyImmediate: bytes
		encoding: encoding
%

category: 'running-immediates'
method: RsrCommandCodecTest
testCharacter

	| encoding |
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 5],
		#[0 0 0 0 0 0 0 0].
	self
		verifyImmediate: (Character codePoint: 0)
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 5],
		#[0 0 0 0 0 0 0 65].
	self
		verifyImmediate: (Character codePoint: 65)
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 5],
		#[0 0 0 0 0 0 0 65].
	self
		verifyImmediate: $A
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 5],
		#[0 0 0 0 0 0 1 212].
	self
		verifyImmediate: (Character codePoint: 16r01D4)
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 5],
		#[0 0 0 0 0 0 131 52].
	self
		verifyImmediate: (Character codePoint: 16r8334)
		encoding: encoding.
%

category: 'running-control words'
method: RsrCommandCodecTest
testControlWord
	
	self
		verifyControlWord: 0
		encoding: #[0 0 0 0 0 0 0 0].
	self
		verifyControlWord: 1
		encoding: #[0 0 0 0 0 0 0 1].
	self
		verifyControlWord: -1
		encoding: #[255 255 255 255 255 255 255 255].
	self
		verifyControlWord: (2 raisedTo: 63) - 1
		encoding: #[127 255 255 255 255 255 255 255].
	self
		verifyControlWord: (2 raisedTo: 63) negated
		encoding: #[128 0 0 0 0 0 0 0]
%

category: 'running-immediates'
method: RsrCommandCodecTest
testDateTime

	| dt encoding |
	dt := RsrDateAndTime posixEpoch.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 14],
		#[0 0 0 0 0 0 0 0].
	self
		verifyImmediate: dt
		encoding: encoding.
	dt := RsrDateAndTime fromMicroseconds: 1562692562657612. "2019-07-09T10:16:02.657612-07:00"
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 14],
		#[0 5 141 66 183 23 33 76].
	self
		verifyImmediate: dt
		encoding: encoding.
	dt := RsrDateAndTime fromMicroseconds: -1000000. "1969-12-31T23:59:59-00:00"
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 14],
		#[255 255 255 255 255 240 189 192].
	self
		verifyImmediate: dt
		encoding: encoding.
	dt := RsrDateAndTime fromMicroseconds: -491277642567488. "1954-06-07T14:59:17.432512-07:00"
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 14],
		#[255 254 65 47 130 160 240 192].
	self
		verifyImmediate: dt
		encoding: encoding
%

category: 'running-immediates'
method: RsrCommandCodecTest
testDictionary

	| dictionary encoding result |
	dictionary := Dictionary new.
	encoding :=
		#[0 0 0 0 0 0 0 0], "Immediate Object OID"
		#[0 0 0 0 0 0 0 13], "Dictionary type"
		#[0 0 0 0 0 0 0 0]. "0 associations"
	self
		verifyImmediate: dictionary
		encoding: encoding.
	dictionary := Dictionary new
		at: 1 put: self genericSymbol;
		at: false put: true;
		yourself.
	encoding := self encodeReferenceOf: dictionary.
	result := (self decoder decodeReference: encoding readStream) resolve: self connection.
	self
		assert: result
		equals: dictionary.
	self
		deny: result
		identicalTo: dictionary.
	"self hack: 'Order is not guaranteed in a dictionary'.
	encoding :=
		#[0 0 0 0 0 0 0 0], ""Immediate OID""
		#[0 0 0 0 0 0 0 13], ""Dictionary Type""
		#[0 0 0 0 0 0 0 2], ""Two assocs""
		#[0 0 0 0 0 0 0 0], ""nil""
		#[0 0 0 0 0 0 0 6],
		#[0 0 0 0 0 0 0 0], ""true""
		#[0 0 0 0 0 0 0 7],
		#[0 0 0 0 0 0 0 0], ""Integer 1""
		#[0 0 0 0 0 0 0 3],
		#[0 0 0 0 0 0 0 1],
		#[1],
		self genericSymbolEncoding.
	self
		verifyImmediate: dictionary
		encoding: encoding"
%

category: 'running-immediates'
method: RsrCommandCodecTest
testDouble

	| encoding |
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 15],
		#[128 0 0 0 0 0 0 0].
	self
		verifyImmediate: -0.0
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 15],
		#[0 0 0 0 0 0 0 0].
	self
		verifyImmediate: 0.0
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 15],
		#[191 240 0 0 0 0 0 0].
	self
		verifyImmediate: -1.0
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 15],
		#[63 240 0 0 0 0 0 0].
	self
		verifyImmediate: 1.0
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 15],
		#[63 185 153 153 153 153 153 154].
	self
		verifyImmediate: 0.1
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 15],
		#[191 185 153 153 153 153 153 154].
	self
		verifyImmediate: -0.1
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 15],
		#[127 240 0 0 0 0 0 0].
	self
		verifyImmediate: RsrDoubleReference infinity
		encoding: encoding
%

category: 'running-immediates'
method: RsrCommandCodecTest
testInteger

	| encoding |
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 3],
		#[0 0 0 0 0 0 0 1],
		#[0].
	self
		verifyImmediate: 0
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 3],
		#[0 0 0 0 0 0 0 1],
		#[4].
	self
		verifyImmediate: 4
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 3],
		#[0 0 0 0 0 0 0 5],
		#[1 15 248 235 121].
	self
		verifyImmediate: 4562938745
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 4],
		#[0 0 0 0 0 0 0 5],
		#[1 15 248 235 121].
	self
		verifyImmediate: -4562938745
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 3],
		#[0 0 0 0 0 0 0 13],
		#[10 101 181 177 179 46 128 92 96 64 190 76 107].
	self
		verifyImmediate: 823759265872134912569713249387
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 4],
		#[0 0 0 0 0 0 0 13],
		#[10 101 181 177 179 46 128 92 96 64 190 76 107].
	self
		verifyImmediate: -823759265872134912569713249387
		encoding: encoding.
%

category: 'running-immediates'
method: RsrCommandCodecTest
testNil

	| encoding |
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 6].
	self
		verifyImmediate: nil
		encoding: encoding
%

category: 'running-immediates'
method: RsrCommandCodecTest
testOrderedCollection

	| oc encoding |
	oc := OrderedCollection new.
	encoding :=
		#[0 0 0 0 0 0 0 0], "Immediate OID"
		#[0 0 0 0 0 0 0 12], "OrderedCollection type"
		#[0 0 0 0 0 0 0 0].
	self
		verifyImmediate: oc
		encoding: encoding.
	oc := OrderedCollection
		with: self genericSymbol
		with: 5
		with: nil.
	encoding :=
		#[0 0 0 0 0 0 0 0], "Immediate Object OID"
		#[0 0 0 0 0 0 0 12], "OrderedCollection type"
		#[0 0 0 0 0 0 0 3], "3 elements"
		self genericSymbolEncoding, "Generic Symbol"
		#[0 0 0 0 0 0 0 0], "Immediate OID"
		#[0 0 0 0 0 0 0 3], "Positive Integer"
		#[0 0 0 0 0 0 0 1], "num bytes"
		#[5], "5"
		#[0 0 0 0 0 0 0 0], "Immediate OID"
		#[0 0 0 0 0 0 0 6].
	self
		verifyImmediate: oc
		encoding: encoding
%

category: 'running-immediates'
method: RsrCommandCodecTest
testSet

	| set encoding result |
	set := Set new.
	encoding :=
		#[0 0 0 0 0 0 0 0], "OID"
		#[0 0 0 0 0 0 0 11], "Set"
		#[0 0 0 0 0 0 0 0]. "0 elements"
	self
		verifyImmediate: set
		encoding: encoding.
	set := Set
		with: true
		with: nil.
	encoding := self encodeReferenceOf: set.
	result := (self decoder decodeReference: encoding readStream) resolve: self connection.
	self
		assert: result
		equals: set.
	self
		deny: result
		identicalTo: set.
	"self hack: 'Hashed collections do not have an ordering'.
	encoding :=
		#[0 0 0 0 0 0 0 0], ""OID""
		#[0 0 0 0 0 0 0 11], ""Set""
		#[0 0 0 0 0 0 0 2], ""2 elements""
		#[0 0 0 0 0 0 0 0], ""true""
		#[0 0 0 0 0 0 0 7],
		#[0 0 0 0 0 0 0 0], ""nil""
		#[0 0 0 0 0 0 0 6].
	self
		verifyImmediate: set
		encoding: encoding"
%

category: 'running-symbol'
method: RsrCommandCodecTest
testString

	| encoding |
	encoding :=
		#[0 0 0 0 0 0 0 0], "OID = 0"
		#[0 0 0 0 0 0 0 2], "Immediate Type = 2"
		#[0 0 0 0 0 0 0 0], "length"
		#[].	 "empty string"
	self
		verifyImmediate: ''
		encoding: encoding.
	encoding :=
		#[0 0 0 0 0 0 0 0], "OID = 0"
		#[0 0 0 0 0 0 0 2], "Immediate Type = 2"
		#[0 0 0 0 0 0 0 13], "length"
		#[103 101 110 101 114 105 99 83 116 114 105 110 103].	 "genericString"
	self
		verifyImmediate: 'genericString'
		encoding: encoding
%

category: 'running-symbol'
method: RsrCommandCodecTest
testSymbol

	self
		verifyImmediate: self genericSymbol
		encoding: self genericSymbolEncoding
%

category: 'asserting'
method: RsrCommandCodecTest
verifyControlWord: anInteger
encoding: bytes

	self subclassResponsibility
%

category: 'asserting'
method: RsrCommandCodecTest
verifyImmediate: anImmediateObject
encoding: encoding

	self subclassResponsibility
%

! Class implementation for 'RsrCommandDecoderTest'

!		Instance methods for 'RsrCommandDecoderTest'

category: 'asserting'
method: RsrCommandDecoderTest
assertReference: bytes
decodesTo: expected

	| actual |
	actual := self decodeReference: bytes.
	self
		assert: actual
		equals: expected
%

category: 'decoding'
method: RsrCommandDecoderTest
decodeReference: bytes

	^(self decoder decodeReference: bytes readStream) resolve: self connection
%

category: 'decoding'
method: RsrCommandDecoderTest
decodeService: anObjectBytes

	^(self decoder decodeServiceSnapshot: anObjectBytes readStream) reifyIn: self connection
%

category: 'running'
method: RsrCommandDecoderTest
testDeliverResponse

	| service response encoding command decodedService |
	service := RsrServerNoInstVars new.
	self connection _ensureRegistered: service.
	response := #responseSymbol.
	encoding :=
		#[0 0 0 0 0 0 0 2], "DeliverResponse Command"
		#[0 0 0 0 0 0 0 1], "Transaction Id"
		#[0 0 0 0 0 0 0 1], "Number of services"
		self serviceNoInstVarsEncoding,
		#[0 0 0 0 0 0 0 0], "Service Name Symbol Reference"
		#[0 0 0 0 0 0 0 1], "Object Type for Symbol"
		#[0 0 0 0 0 0 0 14], "Length of UTF-8 bytes"
		#[114 101 115 112 111 110 115 101 83 121 109 98 111 108]. "#responseSymbol"
	command := self decoder decodeCommand: encoding readStream.
	self
		assert: command class
		equals: RsrDeliverResponse.
	self
		assert: command transaction
		equals: 1.
	self
		assert: command snapshots size
		equals: 1.
	decodedService := command snapshots first reifyIn: self connection.
	self
		assert: decodedService
		equals: service.
	self
		assert: (command response resolve: self connection)
		equals: response
%

category: 'running'
method: RsrCommandDecoderTest
testReleaseServices

	| command encoding |
	encoding :=
		#[0 0 0 0 0 0 0 3], "ReleaseObjects Command"
		#[0 0 0 0 0 0 0 5], "Num OIDS"
		#[0 0 0 0 0 0 0 1], "First OID"
		#[0 0 0 0 0 0 0 2],
		#[0 0 0 0 0 0 0 3],
		#[0 0 0 0 0 0 0 4],
		#[0 0 0 0 0 0 0 5]. "Last OID"
	command := self decoder decodeCommand: encoding readStream.
	self
		assert: command sids
		equals: #(1 2 3 4 5)
%

category: 'running'
method: RsrCommandDecoderTest
testSendMessage

	| service encoding command |
	service := RsrServerNoInstVars new.
	self connection _ensureRegistered: service.
	encoding :=
		#[0 0 0 0 0 0 0 1], "SendMessage Command"
		#[0 0 0 0 0 0 0 1], "Transaction ID"
		#[0 0 0 0 0 0 0 1], "One service is part of this message"
		self serviceNoInstVarsEncoding,
		#[0 0 0 0 0 0 0 1], "Receiver OID"
		#[0 0 0 0 0 0 0 0], "Selector Reference"
		#[0 0 0 0 0 0 0 1], "Object Type for Symbol"
		#[0 0 0 0 0 0 0 8], "Length of UTF-8 bytes"
		#[114 101 116 117 114 110 52 50], "#return42"
		#[0 0 0 0 0 0 0 0]. "Argument Count"
	command := self decoder decodeCommand: encoding readStream.
	self
		assert: command class
		equals: RsrSendMessage.
	self
		assert: command transaction
		equals: 1.
	self
		assert: (command receiverReference resolve: self connection)
		identicalTo: service.
	self
		assert: (command selectorReference resolve: self connection)
		identicalTo: #return42.
	self
		assert: command argumentReferences
		equals: #().
	self
		assert: command snapshots size
		equals: 1
%

category: 'running'
method: RsrCommandDecoderTest
testServiceDecodeIdentity
	"Ensure that decoding an object multiple times results in
	a single object getting created."

	| firstService secondService |
	firstService := self decodeService: self serviceNoInstVarsEncoding.
	secondService := self decodeService: self serviceNoInstVarsEncoding.
	self
		assert: firstService
		identicalTo: secondService
%

category: 'running'
method: RsrCommandDecoderTest
testServiceNoInstVars

	| decodedService |
	decodedService := self decodeService: self serviceNoInstVarsEncoding.
	self
		assert: decodedService class
		equals: RsrServerNoInstVars.
	self
		assert: decodedService _id
		equals: 1
%

category: 'running'
method: RsrCommandDecoderTest
testServiceReferenceService

	| rootService referencedService |
	referencedService := self decodeService: self referencedServiceEncoding.
	self
		assert: referencedService class
		equals: RsrServerNoInstVars.
	self
		assert: referencedService _id
		equals: 2.
	rootService := self decodeService: self rootServiceEncoding.
	self
		assert: rootService class
		equals: RsrServerReferenceService.
	self
		assert: rootService service
		equals: referencedService
%

category: 'asserting'
method: RsrCommandDecoderTest
verifyControlWord: expected
encoding: bytes

	| actual |
	actual := self decoder decodeControlWord: bytes readStream.
	self
		assert: actual
		equals: expected
%

category: 'asserting'
method: RsrCommandDecoderTest
verifyImmediate: expected
encoding: encoding

	| actual |
	actual := (self decoder decodeReference: encoding readStream) resolve: self connection.
	self
		assert: actual
		equals: expected
%

! Class implementation for 'RsrCommandEncoderTest'

!		Instance methods for 'RsrCommandEncoderTest'

category: 'other'
method: RsrCommandEncoderTest
register: aService

	self connection _ensureRegistered: aService
%

category: 'running-immediates'
method: RsrCommandEncoderTest
testDeliverResponse

	| service response command result expectedEncoding |
	service := RsrClientNoInstVars new.
	self register: service.
	response := #responseSymbol.
	command := RsrDeliverResponse
		transaction: 1
		responseReference: (RsrReference from: response)
		snapshots: (Array with: (RsrServiceSnapshot from: service)).
	result := self encoder encodeDeliverResponse: command.
	expectedEncoding :=
		#[0 0 0 0 0 0 0 2], "DeliverResponse Command"
		#[0 0 0 0 0 0 0 1], "Transaction Id"
		#[0 0 0 0 0 0 0 1], "One service is part of this response"
		self serviceNoInstVarsEncoding,
		#[0 0 0 0 0 0 0 0], "Service Name Symbol Reference"
		#[0 0 0 0 0 0 0 1], "Object Type for Symbol"
		#[0 0 0 0 0 0 0 14], "Length of UTF-8 bytes"
		#[114 101 115 112 111 110 115 101 83 121 109 98 111 108]. "#responseSymbol"
	self
		assert: result
		equals: expectedEncoding
%

category: 'running'
method: RsrCommandEncoderTest
testNaN

	| encoding |
	"Signaling NaN is not tested.
	Negative NaN is not tested."
	encoding :=
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 15],
		#[255 248 0 0 0 0 0 0].
	self
		verifyImmediate: RsrDoubleReference nan
		encoding: encoding.
%

category: 'running-immediates'
method: RsrCommandEncoderTest
testReleaseServices

	| command result expectedEncoding |
	command := RsrReleaseServices sids: #(1 2 3 4 5).
	result := self encoder encodeReleaseServices: command.
	expectedEncoding :=
		#[0 0 0 0 0 0 0 3], "ReleaseObjects Command"
		#[0 0 0 0 0 0 0 5], "Num OIDS"
		#[0 0 0 0 0 0 0 1], "First OID"
		#[0 0 0 0 0 0 0 2],
		#[0 0 0 0 0 0 0 3],
		#[0 0 0 0 0 0 0 4],
		#[0 0 0 0 0 0 0 5]. "Last OID"
	self
		assert: result
		equals: expectedEncoding
%

category: 'running-immediates'
method: RsrCommandEncoderTest
testSendMessage

	| service analysis command result expectedEncoding |
	service := RsrClientNoInstVars new.
	self register: service.
	analysis := RsrSnapshotAnalysis
		roots: (Array with: service)
		connection: self connection.
	analysis perform.
	command := RsrSendMessage
		transaction: 1
		receiverReference: (RsrReference from: service)
		selectorReference: (RsrSymbolReference from: #return42)
		argumentReferences: #().
	command snapshots: analysis snapshots.
	result := self encoder encodeSendMessage: command.
	expectedEncoding :=
		#[0 0 0 0 0 0 0 1], "SendMessage Command"
		#[0 0 0 0 0 0 0 1], "Transaction ID"
		#[0 0 0 0 0 0 0 1], "One service is part of this message"
		self serviceNoInstVarsEncoding,
		#[0 0 0 0 0 0 0 1], "Receiver OID"
		#[0 0 0 0 0 0 0 0], "Selector Reference"
		#[0 0 0 0 0 0 0 1], "Object Type for Symbol"
		#[0 0 0 0 0 0 0 8], "Length of UTF-8 bytes"
		#[114 101 116 117 114 110 52 50], "#return42"
		#[0 0 0 0 0 0 0 0]. "Argument Count"
	self
		assert: result
		equals: expectedEncoding
%

category: 'running'
method: RsrCommandEncoderTest
testServiceNoInstVars

	| rootService encodedBytes expectedEncoding |
	rootService := RsrClientNoInstVars new.
	self register: rootService.
	encodedBytes := self encoder encodeServiceSnapshot: (RsrServiceSnapshot from: rootService).
	expectedEncoding := self serviceNoInstVarsEncoding.
	self
		assert: encodedBytes
		equals: expectedEncoding
%

category: 'running'
method: RsrCommandEncoderTest
testServiceReferenceService

	| rootService referencedService encodedObject expectedEncoding |
	referencedService := RsrClientNoInstVars new.
	rootService := RsrClientReferenceService service: referencedService.
	self
		register: rootService;
		register: referencedService.
	encodedObject := self encoder encodeServiceSnapshot: (RsrServiceSnapshot from: rootService).
	expectedEncoding :=
		#[0 0 0 0 0 0 0 0], "type"
		#[0 0 0 0 0 0 0 1], "rootService's OID = 1"
		#[0 0 0 0 0 0 0 1], "Inst Var Count"
		#[0 0 0 0 0 0 0 0], "Start of service name. OID = 0"
		#[0 0 0 0 0 0 0 1], "Service name = 1 -> Symbol"
		#[0 0 0 0 0 0 0 25], "Length of UTF-8 encoded bytes"
		#[82 115 114 83 101 114 118 101 114 82 101 102 101 114 101 110 99 101 83 101 114 118 105 99 101],
		#[0 0 0 0 0 0 0 2]. "#RsrServerReferenceService"
	self
		assert: encodedObject
		equals: expectedEncoding.
	encodedObject := self encoder encodeServiceSnapshot: (RsrServiceSnapshot from: referencedService).
	expectedEncoding :=
		#[0 0 0 0 0 0 0 0], "type"
		#[0 0 0 0 0 0 0 2], "referencedService's OID = 2"
		#[0 0 0 0 0 0 0 0], "Inst Var Count"
		#[0 0 0 0 0 0 0 0], "Start of service name. OID = 0"
		#[0 0 0 0 0 0 0 1], "Service name = 1 -> Symbol"
		#[0 0 0 0 0 0 0 19], "Length of UTF-8 encoded bytes"
		#[82 115 114 83 101 114 118 101 114 78 111 73 110 115 116 86 97 114 115]. "#RsrServerNoInstVars"
	self
		assert: encodedObject
		equals: expectedEncoding
%

category: 'running'
method: RsrCommandEncoderTest
testUnsupportedObject

	self
		should: [self encoder encodeReference: (RsrReference from: Object new) onto: (WriteStream on: ByteArray new)]
		raise: RsrUnsupportedObject
%

category: 'running-immediates'
method: RsrCommandEncoderTest
verifyControlWord: anInteger
encoding: expected

	| actual |
	actual := ByteArray streamContents: [:stream | self encoder encodeControlWord: anInteger onto: stream].
	self
		assert: actual
		equals: expected
%

category: 'running-immediates'
method: RsrCommandEncoderTest
verifyImmediate: anObject
encoding: expected

	| actual |
	actual := ByteArray streamContents: [:stream | self encoder encodeReference: (RsrReference from: anObject) onto: stream].
	self
		assert: actual
		equals: expected
%

! Class implementation for 'RsrConnectionSpecificationTestCase'

!		Instance methods for 'RsrConnectionSpecificationTestCase'

category: 'accessing'
method: RsrConnectionSpecificationTestCase
alternativeLocalhost

	^'127.0.1.1'
%

category: 'accessing'
method: RsrConnectionSpecificationTestCase
localhost

	^'127.0.0.1'
%

category: 'accessing'
method: RsrConnectionSpecificationTestCase
port

	^47652
%

category: 'running'
method: RsrConnectionSpecificationTestCase
testAcceptOnLocalhost

	| acceptor initiator semaphore connectionA connectionB |
	acceptor := RsrAcceptConnection host: self localhost port: self port.
	acceptor ensureListening.
	self assert: acceptor listeningPort equals: self port.
	initiator := RsrInitiateConnection
		             host: self localhost
		             port: self port.
	semaphore := Semaphore new.
	RsrProcessModel
		fork: [ 
			[ connectionA := acceptor waitForConnection ] ensure: [ 
					semaphore signal ] ]
		named: 'Pending AcceptConnection';
		fork: [ 
			[ connectionB := initiator connect ] ensure: [ semaphore signal ] ]
		named: 'Pending InitiateConnection'.
	semaphore
		wait;
		wait.
	self
		assert: connectionA isOpen;
		assert: connectionB isOpen.
	connectionA close.
	connectionB close
%

category: 'running'
method: RsrConnectionSpecificationTestCase
testBindToAvailablePortRange

	"If no one is listening on self port, we should get that port."

	| acceptor initiator semaphore connectionA connectionB |
	acceptor := RsrAcceptConnection
		            host: self localhost
		            portRange: (self port to: self port + 1).
	acceptor ensureListening.
	self assert: acceptor listeningPort equals: self port.
	initiator := RsrInitiateConnection
		             host: self localhost
		             port: acceptor listeningPort.
	semaphore := Semaphore new.
	RsrProcessModel
		fork: [ 
			[ connectionA := acceptor waitForConnection ] ensure: [ 
					semaphore signal ] ]
		named: 'Pending AcceptConnection';
		fork: [ 
			[ connectionB := initiator connect ] ensure: [ semaphore signal ] ]
		named: 'Pending InitiateConnection'.
	semaphore
		wait;
		wait.
	self
		assert: connectionA isOpen;
		assert: connectionB isOpen.
	connectionA close.
	connectionB close
%

category: 'running'
method: RsrConnectionSpecificationTestCase
testBindToPartlyAvailablePortRange

	"Listen on first port to force range to listen on second port."

	| blocker acceptor initiator semaphore connectionA connectionB |
	blocker := RsrAcceptConnection host: self localhost port: self port.
	[ 
	blocker ensureListening.
	self assert: blocker listeningPort equals: self port.
	acceptor := RsrAcceptConnection
		            host: self localhost
		            portRange: (self port to: self port + 1).
	acceptor ensureListening.
	self assert: acceptor listeningPort equals: self port + 1.
	initiator := RsrInitiateConnection
		             host: self localhost
		             port: acceptor listeningPort.
	semaphore := Semaphore new.
	RsrProcessModel
		fork: [ 
			[ connectionA := acceptor waitForConnection ] ensure: [ 
					semaphore signal ] ]
		named: 'Pending AcceptConnection';
		fork: [ 
			[ connectionB := initiator connect ] ensure: [ semaphore signal ] ]
		named: 'Pending InitiateConnection'.
	semaphore
		wait;
		wait.
	self
		assert: connectionA isOpen;
		assert: connectionB isOpen.
	connectionA close.
	connectionB close ] ensure: [ blocker cancelWaitForConnection ]
%

category: 'running'
method: RsrConnectionSpecificationTestCase
testBindToUnavailablePortRange

	"Listen on both ports in range -- range should then fail."

	| blocker1 blocker2 acceptor |
	blocker1 := RsrAcceptConnection host: self localhost port: self port.
	blocker2 := RsrAcceptConnection
		            host: self localhost
		            port: self port + 1.
	[ 
	blocker1 ensureListening.
	self assert: blocker1 listeningPort equals: self port.
	blocker2 ensureListening.
	self assert: blocker2 listeningPort equals: self port + 1.
	acceptor := RsrAcceptConnection
		            host: self localhost
		            portRange: (self port to: self port + 1).
	self should: [ acceptor ensureListening ] raise: RsrInvalidBind ] 
		ensure: [ 
			{ 
				blocker1.
				blocker2 } do: [ :each | each cancelWaitForConnection ] ]
%

category: 'running'
method: RsrConnectionSpecificationTestCase
testBindToWildcardPort

	| acceptor initiator semaphore connectionA connectionB |
	acceptor := RsrAcceptConnection
		host: self localhost
		port: RsrAcceptConnection wildcardPort.
	acceptor ensureListening.
	self assert: acceptor listeningPort > 0.
	initiator := RsrInitiateConnection
		host: self localhost
		port: acceptor listeningPort.
	semaphore := Semaphore new.
	RsrProcessModel
		fork: [[connectionA := acceptor waitForConnection] ensure: [semaphore signal]] named: 'Pending AcceptConnection';
		fork: [[connectionB := initiator connect] ensure: [semaphore signal]] named: 'Pending InitiateConnection'.
	semaphore wait; wait.
	self
		assert: connectionA isOpen;
		assert: connectionB isOpen.
	connectionA close.
	connectionB close
%

category: 'running'
method: RsrConnectionSpecificationTestCase
testCancelWaitForConnection

	| acceptor |
	acceptor := RsrAcceptConnection port: self port.
	RsrProcessModel
		fork: [(Delay forSeconds: 1) wait. acceptor cancelWaitForConnection]
		named: 'Canceling AcceptConnection'.
	self
		should: [acceptor waitForConnection]
		raise: RsrWaitForConnectionCancelled
%

category: 'running'
method: RsrConnectionSpecificationTestCase
testEstablishConnection

	| acceptor initiator semaphore connectionA connectionB |
	acceptor := RsrAcceptConnection port: self port.
	initiator := RsrInitiateConnection
		host: self localhost
		port: self port.
	semaphore := Semaphore new.
	RsrProcessModel
		fork: [[connectionA := acceptor waitForConnection] ensure: [semaphore signal]] named: 'Pending AcceptConnection';
		fork: [[connectionB := initiator connect] ensure: [semaphore signal]] named: 'Pending InitiateConnection'.
	semaphore wait; wait.
	self
		assert: connectionA isOpen;
		assert: connectionB isOpen.
	connectionA close.
	connectionB close
%

category: 'running'
method: RsrConnectionSpecificationTestCase
testFailedAcceptOnAlternativeLocalhost

	| acceptor initiator semaphore |
	acceptor := RsrAcceptConnection
		host: self alternativeLocalhost
		port: self port.
	initiator := RsrInitiateConnection
		host: self localhost
		port: self port.
	semaphore := Semaphore new.
	RsrProcessModel
		fork: [[semaphore signal. acceptor waitForConnection] on: RsrWaitForConnectionCancelled do: [:ex | ex return]]
		named: 'Pending WaitForConnectionCancelled'.
	[semaphore wait.
	self
		should: [initiator connect]
		raise: RsrSocketError]
			ensure: [acceptor cancelWaitForConnection]
%

category: 'running'
method: RsrConnectionSpecificationTestCase
testInternalConnectionSpecificationConnectReturnsConnection
	"Ensure that sending #connect to an InternalConnectionSpecification
	results in returning one of the created Connections."

	| spec connection |
	spec := RsrInMemoryConnectionSpecification new.
	connection := spec connect.
	self assert: connection isOpen.
	connection close.
	spec := RsrInternalSocketConnectionSpecification new.
	connection := spec connect.
	self assert: connection isOpen.
	connection close
%

category: 'running'
method: RsrConnectionSpecificationTestCase
testListenThenLaterAccept

	| acceptor initiator semaphore connectionA connectionB |
	acceptor := RsrAcceptConnection
		host: self localhost 
		port: self port.
	initiator := RsrInitiateConnection
		host: self localhost
		port: self port.
	semaphore := Semaphore new.
	acceptor ensureListening.
	RsrProcessModel
		fork: [semaphore signal. [connectionB := initiator connect] ensure: [semaphore signal]]
		named: 'Pending InitiateConnection'.
	semaphore wait.
	connectionA := acceptor waitForConnection.
	semaphore wait.
	self
		assert: connectionA isOpen;
		assert: connectionB isOpen.
	connectionA close.
	connectionB close
%

! Class implementation for 'RsrForwarderTest'

!		Instance methods for 'RsrForwarderTest'

category: 'running'
method: RsrForwarderTest
testForwarding
	"This test needs to be improved. It is out of sync."

	| service id connection forwarder sendMessage |
	service := RsrTestService clientClass new.
	id := 1.
	connection := RsrConnection
		channel: RsrNullChannel new
		transactionSpigot: RsrThreadSafeNumericSpigot naturals
		oidSpigot: RsrThreadSafeNumericSpigot naturals.
	connection open.
	service registerWith: connection.
	forwarder := service remoteSelf.
	forwarder
		arg1: 15
		arg2: 42.
	sendMessage := connection channel lastCommand.
	self
		assert: sendMessage transaction
		equals: 1.
	self
		assert: (sendMessage receiverReference resolve: connection)
		equals: service.
	self
		assert: (sendMessage selectorReference resolve: connection)
		equals: #arg1:arg2:.
	self
		assert: (sendMessage argumentReferences collect: [:each | each resolve: connection])
		equals: #(15 42).
%

! Class implementation for 'RsrGarbageCollectorTestCase'

!		Instance methods for 'RsrGarbageCollectorTestCase'

category: 'running'
method: RsrGarbageCollectorTestCase
testMaximumReclamation

	self assert: RsrGarbageCollector maximumReclamation
%

! Class implementation for 'RsrNumericSpigotTest'

!		Instance methods for 'RsrNumericSpigotTest'

category: 'accessing'
method: RsrNumericSpigotTest
spigotClass

	^RsrNumericSpigot
%

category: 'running'
method: RsrNumericSpigotTest
testDefault

	| spigot |
	spigot := self spigotClass new.
	self
		assert: spigot next
		equals: 0.
	self
		assert: spigot next
		equals: 1
%

category: 'running'
method: RsrNumericSpigotTest
testFloat

	| spigot |
	spigot := self spigotClass
		start: 0
		step: 0.5.
	self
		assert: spigot next
		equals: 0.
	self
		assert: spigot next
		equals: 0.5.
	self
		assert: spigot next
		equals: 1.0.
%

category: 'running'
method: RsrNumericSpigotTest
testNaturals

	| spigot |
	spigot := self spigotClass naturals.
	self
		assert: spigot next
		equals: 1.
	self
		assert: spigot next
		equals: 2
%

category: 'running'
method: RsrNumericSpigotTest
testNegativeStep

	| spigot |
	spigot := self spigotClass
		start: 0
		step: -1.
	self
		assert: spigot next
		equals: 0.
	self
		assert: spigot next
		equals: -1.
	self
		assert: spigot next
		equals: -2
%

category: 'running'
method: RsrNumericSpigotTest
testNext

	| spigot |
	spigot := self spigotClass naturals.
	self
		assert: (Array with: 1 with: 2 with: 3)
		equals: (spigot next: 3)
%

! Class implementation for 'RsrThreadSafeNumericSpigotTest'

!		Instance methods for 'RsrThreadSafeNumericSpigotTest'

category: 'accessing'
method: RsrThreadSafeNumericSpigotTest
spigotClass

	^RsrThreadSafeNumericSpigot
%

! Class implementation for 'RsrPromiseTest'

!		Instance methods for 'RsrPromiseTest'

category: 'running'
method: RsrPromiseTest
testAsyncBreak

	| promise semaphore expected whenRan first second third |
	promise := RsrPromise new.
	semaphore := Semaphore new.
	expected := Object new.
	whenRan := false.
	promise
		when: [:object | whenRan := true. semaphore signal]
		catch: [:reason | first := reason. semaphore signal].
	promise
		when: [:object | whenRan := true. semaphore signal]
		catch: [:reason | second := reason. semaphore signal].
	self
		deny: promise isResolved;
		deny: promise isBroken;
		deny: promise isFulfilled.
	promise break: expected.
	self
		assert: promise isResolved;
		assert: promise isBroken;
		deny: promise isFulfilled.
	semaphore wait; wait.
	self shortWait. "Ensure any when blocks run if they are going to schedule."
	self deny: whenRan.
	self
		assert: first
		identicalTo: expected.
	self
		assert: second
		identicalTo: expected.
	promise
		when: [:object | whenRan := true. semaphore signal]
		catch: [:reason | third := reason. semaphore signal].
	semaphore wait.
	self shortWait.
	self deny: whenRan.
	self
		assert: third
		identicalTo: expected
%

category: 'running'
method: RsrPromiseTest
testAsyncFulfill

	| promise semaphore expected catchRan first second third |
	promise := RsrPromise new.
	semaphore := Semaphore new.
	expected := Object new.
	catchRan := false.
	promise
		when: [:object | first := object. semaphore signal]
		catch: [:reason | catchRan := true. semaphore signal].
	promise
		when: [:object | second := object. semaphore signal]
		catch: [:reason | catchRan := true. semaphore signal].
	self
		deny: promise isResolved;
		deny: promise isBroken;
		deny: promise isFulfilled.
	promise fulfill: expected.
	self
		assert: promise isResolved;
		deny: promise isBroken;
		assert: promise isFulfilled.
	semaphore wait; wait.
	self shortWait. "Ensure any catch blocks run if they are going to schedule."
	self deny: catchRan.
	self
		assert: first
		identicalTo: expected.
	self
		assert: second
		identicalTo: expected.
	promise
		when: [:object | third := object. semaphore signal]
		catch: [:reason | catchRan := true. semaphore signal].
	semaphore wait.
	self shortWait.
	self deny: catchRan.
	self
		assert: third
		identicalTo: expected
%

category: 'running'
method: RsrPromiseTest
testSyncBreak

	| promise expected exceptionRaised first second third |
	promise := RsrPromise new.
	expected := Object new.
	exceptionRaised := false.
	RsrProcessModel
		fork: [[promise wait] on: RsrBrokenPromise do: [:ex | exceptionRaised := true. first := ex reason. ex return]]
		named: 'Pending BrokenPromise'.
	RsrProcessModel
		fork: [[promise wait] on: RsrBrokenPromise do: [:ex | exceptionRaised := true. second := ex reason. ex return]]
		named: 'Pending BrokenPromise'.
	promise break: expected.
	self shortWait. "Allow results to process."
	self assert: exceptionRaised.
	self
		assert: first
		identicalTo: expected.
	self
		assert: second
		identicalTo: expected.
	self
		should: [promise wait]
		raise: RsrBrokenPromise.
	third := [promise wait]
		on: RsrBrokenPromise
		do: [:ex | ex return: ex reason].
	self
		assert: third
		identicalTo: expected
%

category: 'running'
method: RsrPromiseTest
testSyncFulfill

	| promise expected exceptionRaised first second |
	promise := RsrPromise new.
	expected := Object new.
	exceptionRaised := false.
	RsrProcessModel
		fork: [[first := promise wait] on: RsrBrokenPromise do: [:ex | exceptionRaised := true. ex return]]
		named: 'Pending BrokenPromise'.
	RsrProcessModel
		fork: [[second := promise wait] on: RsrBrokenPromise do: [:ex | exceptionRaised := true. ex return]]
		named: 'Pending BrokenPromise'.
	promise fulfill: expected.
	self shortWait. "Allow results to process."
	self deny: exceptionRaised.
	self
		assert: first
		identicalTo: expected.
	self
		assert: second
		identicalTo: expected.
	self
		assert: promise wait
		identicalTo: expected
%

! Class implementation for 'RsrProtocolVersionNegotiationCodecTestCase'

!		Instance methods for 'RsrProtocolVersionNegotiationCodecTestCase'

category: 'accessing'
method: RsrProtocolVersionNegotiationCodecTestCase
codec

	^RsrProtocolVersionNegotiationCodec new
%

category: 'utilities'
method: RsrProtocolVersionNegotiationCodecTestCase
stream: aBlock

	^ByteArray streamContents: [:stream | aBlock value: stream]
%

category: 'running'
method: RsrProtocolVersionNegotiationCodecTestCase
testChosenVersion

	| chosenVersion encoding result |
	chosenVersion := RsrChosenVersion version: 7.
	encoding :=
		#[0 0 0 0 0 0 0 1], "Type"
		#[0 0 0 0 0 0 0 7]. "Version"
	result := self stream: [:stream | self codec encodeChosenVersion: chosenVersion onto: stream].
	self
		assert: result
		equals: encoding.
	result := self codec decode: encoding readStream.
	self
		assert: result
		equals: chosenVersion
%

category: 'running'
method: RsrProtocolVersionNegotiationCodecTestCase
testNoVersionOverlap

	| noVersionOverlap encoding result |
	noVersionOverlap := RsrNoVersionOverlap new.
	encoding := #[0 0 0 0 0 0 0 2]. "Type"
	result := self stream: [:stream | self codec encodeNoVersionOverlap: noVersionOverlap onto: stream].
	self
		assert: result
		equals: encoding.
	result := self codec decode: encoding readStream.
	self
		assert: result
		equals: noVersionOverlap
%

category: 'running'
method: RsrProtocolVersionNegotiationCodecTestCase
testSupportedVersions

	| supportedVersions encoding result |
	supportedVersions := RsrSupportedVersions versions: #(0 1 2 7).
	encoding :=
		#[0 0 0 0 0 0 0 0], "Type"
		#[0 0 0 0 0 0 0 4], "4 versions supported"
		#[0 0 0 0 0 0 0 0],
		#[0 0 0 0 0 0 0 1],
		#[0 0 0 0 0 0 0 2],
		#[0 0 0 0 0 0 0 7].
	result := self stream: [:stream | self codec encodeSupportedVersions: supportedVersions onto: stream].
	self
		assert: result
		equals: encoding.
	result := self codec decode: encoding readStream.
	self
		assert: result
		equals: supportedVersions
%

! Class implementation for 'RsrSnapshotAnalysisTest'

!		Instance methods for 'RsrSnapshotAnalysisTest'

category: 'utilites'
method: RsrSnapshotAnalysisTest
analyze: anObject

	| analysis |
	analysis := RsrSnapshotAnalysis
		roots: (Array with: anObject)
		connection: connection.
	analysis perform.
	^analysis
%

category: 'running'
method: RsrSnapshotAnalysisTest
setUp

	super setUp.
	connection := RsrConnection
		channel: RsrNullChannel new
		transactionSpigot: RsrThreadSafeNumericSpigot naturals
		oidSpigot: RsrThreadSafeNumericSpigot naturals.
	connection open
%

category: 'running'
method: RsrSnapshotAnalysisTest
tearDown

	connection close.
	connection := nil.
	super tearDown
%

category: 'running'
method: RsrSnapshotAnalysisTest
testArrayCycle

	| array analysis |
	array := Array new: 1.
	array at: 1 put: array.
	analysis := self analyze: array.
	self
		assert: analysis snapshots size equals: 0;
		assert: analysis analyzedObjects size equals: 1.
	array at: 1 put: { array }.
	analysis := self analyze: array.
	self
		assert: analysis snapshots size equals: 0;
		assert: analysis analyzedObjects size equals: 2.
%

category: 'running'
method: RsrSnapshotAnalysisTest
testDictionaryCycle

	| dictionary analysis |
	dictionary := Dictionary new.
	dictionary at: 1 put: dictionary.
	analysis := self analyze: dictionary.
	self
		assert: analysis snapshots size equals: 0;
		assert: analysis analyzedObjects size equals: 2.

	dictionary removeKey: 1.
	dictionary at: dictionary put: 1.
	analysis := self analyze: dictionary.
	self
		assert: analysis snapshots size equals: 0;
		assert: analysis analyzedObjects size equals: 2
%

category: 'running'
method: RsrSnapshotAnalysisTest
testMultiPathsToSameService

	"Tests issue 76, Unnecessary duplicate snapshots being sent."

	| childService parentService orderedCollection analysis |
	childService := RsrRemoteAction clientClass new.
	parentService := RsrRemoteAction clientClass sharedVariable:
		                 childService.
	orderedCollection := OrderedCollection
		                     with: childService
		                     with: parentService.
	analysis := self analyze: orderedCollection.
	self assert: analysis snapshots size equals: 2.
	self
		assert: parentService isMirrored;
		assert: childService isMirrored
%

category: 'running'
method: RsrSnapshotAnalysisTest
testNewServiceInArray
	"Ensure a new service in a collection is properly tagged"

	| service analysis expected |
	service := RsrServerNoInstVars new.
	analysis := self analyze: (Array with: service).
	expected := OrderedCollection with: service.
	self
		assert: analysis snapshots size
		equals: 1.
	self assert: service isMirrored
%

category: 'running'
method: RsrSnapshotAnalysisTest
testNewServicesInDictionary
	"Ensure a new service in a collection is properly tagged"

	| key value dictionary analysis |
	key := RsrServerNoInstVars new.
	value := RsrServerNoInstVars new.
	dictionary := Dictionary new
		at: key put: value;
		yourself.
	analysis := self analyze: dictionary.
	self
		assert: analysis snapshots size
		equals: 2.
	self
		assert: key isMirrored;
		assert: value isMirrored
%

category: 'running'
method: RsrSnapshotAnalysisTest
testOrderedCollectionCycle

	| oc analysis |
	oc := OrderedCollection new.
	oc add: oc.
	analysis := self analyze: oc.
	self
		assert: analysis snapshots size equals: 0;
		assert: analysis analyzedObjects size equals: 1.

	oc := OrderedCollection with: (Array with: oc).
	analysis := self analyze: oc.
	self
		assert: analysis snapshots size equals: 0;
		assert: analysis analyzedObjects size equals: 3
%

category: 'running'
method: RsrSnapshotAnalysisTest
testServiceAllDataObjects
	"While this code is structurally similar to #testClientNoInstVars, it ensures
	that Data Objects are actually encoded in-line."

	| client analysis expected |
	client := RsrRemoteAction clientClass new.
	analysis := self analyze: client.
	expected := OrderedCollection with: client.
	self
		assert: analysis snapshots size
		equals: 1.
	self assert: client isMirrored
%

category: 'running'
method: RsrSnapshotAnalysisTest
testServiceNoInstVars

	| client analysis expected snapshot snapshotTemplate |
	client := RsrClientNoInstVars new.
	analysis := self analyze: client.
	expected := OrderedCollection with: client.
	self assert: client isMirrored.
	self
		assert: analysis snapshots size
		equals: 1.
	snapshot := analysis snapshots first.
	self
		assert: snapshot slots size
		equals: 0.
	self assert: snapshot shouldCreateServer.
	snapshotTemplate := connection templateResolver templateNamed: snapshot templateName.
	self
		assert: snapshotTemplate
		equals: client _template
%

category: 'running'
method: RsrSnapshotAnalysisTest
testServiceReferencingAnotherService
	"While this code is structurally similar to #testClientNoInstVars, it ensures
	that Data Objects are actually encoded in-line."

	| referencedService client analysis |
	referencedService := RsrRemoteAction clientClass new.
	client := RsrRemoteAction clientClass sharedVariable: referencedService.
	analysis := self analyze: client.
	self
		assert: analysis snapshots size
		equals: 2.
	self
		assert: client isMirrored;
		assert: referencedService isMirrored
%

category: 'running'
method: RsrSnapshotAnalysisTest
testServiceWithCycle

	| rootClient referencedClient analysis |
	rootClient := RsrRemoteAction new.
	referencedClient := RsrRemoteAction sharedVariable: rootClient.
	rootClient sharedVariable: referencedClient.
	analysis := self analyze: rootClient.
	self
		assert: analysis snapshots size equals: 2;
		assert: analysis analyzedObjects size equals: 2
%

category: 'running'
method: RsrSnapshotAnalysisTest
testSetCycle

	| set analysis |
	set := Set new.
	set add: set.
	analysis := self analyze: set.
	self
		assert: analysis snapshots size equals: 0;
		assert: analysis analyzedObjects size equals: 1.

	set := Set new.
	set add: (Array with: set).
	analysis := self analyze: set.
	self
		assert: analysis snapshots size equals: 0;
		assert: analysis analyzedObjects size equals: 2
%

! Class implementation for 'RsrSocketStreamTestCase'

!		Instance methods for 'RsrSocketStreamTestCase'

category: 'initializing'
method: RsrSocketStreamTestCase
initializeStreams

	| socketPair |
	socketPair := RsrSocketPair new.
	aStream := socketPair firstStream.
	bStream := socketPair secondStream
%

category: 'initializing'
method: RsrSocketStreamTestCase
setUp

	super setUp.
	self initializeStreams
%

category: 'initializing'
method: RsrSocketStreamTestCase
tearDown

	aStream close.
	bStream close.
	super tearDown
%

category: 'running'
method: RsrSocketStreamTestCase
testNextAfterClose

	aStream close.
	self
		should: [aStream next]
		raise: RsrSocketClosed.
	self
		should: [bStream next]
		raise: RsrSocketClosed
%

category: 'running'
method: RsrSocketStreamTestCase
testNextPutAllAfterClose

	self deny: aStream atEnd.
	aStream close.
	self assert: aStream atEnd.
	self
		should: [ 
			aStream
				nextPutAll: #[ 1 2 3 ];
				flush ]
		raise: RsrSocketClosed
%

category: 'running'
method: RsrSocketStreamTestCase
testSendReceive

	| count bytes |
	count := 1024.
	bytes := ByteArray new: count.
	aStream
		nextPutAll: bytes;
		flush.
	self
		assert: (bStream next: count)
		equals: bytes
%

! Class implementation for 'RsrSocketTestCase'

!		Class methods for 'RsrSocketTestCase'

category: 'accessing'
classmethod: RsrSocketTestCase
defaultTimeLimit

	^20 seconds
%

!		Instance methods for 'RsrSocketTestCase'

category: 'accessing'
method: RsrSocketTestCase
createPair: aBlock

	| address port listener peerA peerB semaphore |
	address := '127.0.0.1'.
	port := 45301.
	listener := self newSocket.
	listener
		bindAddress: address
		port: port.
	listener listen: 1.
	peerB := self newSocket.
	semaphore := Semaphore new.
	RsrProcessModel
		fork: [[peerA := self deferClose: listener accept] ensure: [semaphore signal]]
		named: 'Pending Socket Accept'.
	RsrProcessModel
		fork: [[peerB connectToHost: address port: port] ensure: [semaphore signal]]
		named: 'Pending Socket Connect'.
	semaphore wait; wait.
	listener close.
	((peerA notNil and: [peerA isConnected]) and: [peerB isConnected])
		ifTrue: [aBlock value: peerA value: peerB]
		ifFalse: [self error: 'Unable to create Socket Pair']
%

category: 'cleanup'
method: RsrSocketTestCase
deferClose: aSocket

	sockets nextPut: aSocket.
	^aSocket
%

category: 'accessing'
method: RsrSocketTestCase
newSocket

	^self deferClose: RsrSocket new
%

category: 'running'
method: RsrSocketTestCase
setUp

	super setUp.
	sockets := SharedQueue new.
%

category: 'running'
method: RsrSocketTestCase
tearDown

	[sockets isEmpty]
		whileFalse: [sockets next close].
	super tearDown
%

category: 'running-server'
method: RsrSocketTestCase
testAcceptConnects

	| listener client server |
	listener := self newSocket.
	listener
		bindAddress: '127.0.0.1'
		port: 45300.
	self
		assert: listener port
		equals: 45300.
	listener listen: 1.
	client := self newSocket.
	self
		deny: client isConnected;
		deny: listener isConnected.
	client connectToHost: '127.0.0.1' port: 45300.
	server := self deferClose: listener accept.
	self
		assert: server port
		equals: 45300.
	self assert: (client port > 1023).
	self
		assert: client isConnected;
		assert: server isConnected;
		deny: listener isConnected
%

category: 'running-server'
method: RsrSocketTestCase
testAcceptOnAlreadyClosedSocket

	| listener |
	listener := self newSocket.
	listener
		bindAddress: '127.0.0.1'
		port: 45300.
	listener listen: 1.
	listener close.
	self
		should: [listener accept]
		raise: RsrSocketError
%

category: 'running-server'
method: RsrSocketTestCase
testCloseDuringAccept

	| listener |
	listener := self newSocket.
	listener
		bindAddress: '127.0.0.1'
		port: 45300.
	listener listen: 1.
	RsrProcessModel
		fork: [(Delay forSeconds: 1) wait. listener close]
		named: 'Pending Socket Close'.
	self
		should: [listener accept]
		raise: RsrSocketError
%

category: 'running-client'
method: RsrSocketTestCase
testConnectBoundSocket

	| listener |
	listener := self newSocket.
	listener
		bindAddress: '127.0.0.1'
		port: 45300.
	self
		should:
			[listener
				connectToHost: 'gemtalksystems.com'
				port: 80]
		raise: RsrSocketError
%

category: 'running-client'
method: RsrSocketTestCase
testFailedConnects

	| socket |
	socket := self newSocket.
	self deny: socket isConnected.
	self
		should:
			[socket
				connectToHost: 'do.no.create.used.for.testing.gemtalksystems.com'
				port: 80]
		raise: RsrConnectFailed.
	socket := self newSocket.
	self
		should:
			[socket
				connectToHost: 'gemtalksystems.com'
				port: 70000]
		raise: RsrConnectFailed.
	socket := self newSocket.
	self
		should:
			[socket
				connectToHost: '127.0.0.1'
				port: 79]
		raise: RsrConnectFailed.
	socket close
%

category: 'running-server'
method: RsrSocketTestCase
testInvalidBind

	| listener |
	listener := self newSocket.
	self "This IP is publicly routable and owned by Cloudflare. Should be invalid on all testing hosts."
		should: [listener bindAddress: '1.1.1.1' port: 45300]
		raise: RsrInvalidBind.
	listener := self newSocket.
	self
		should: [listener bindAddress: '127.0.0.1' port: 98765432]
		raise: RsrInvalidBind
%

category: 'running-server'
method: RsrSocketTestCase
testListenWithoutBind

	| listener |
	listener := self newSocket.
	listener listen: 1.
	self assert: (listener port > 1023)
%

category: 'running-read/write'
method: RsrSocketTestCase
testPartialRead

	| peerA peerB writeBuffer readBuffer count numRead |
	self
		createPair:
			[:a :b |
			peerA := a.
			peerB := b].
	count := 1024.
	writeBuffer := ByteArray new: count.
	1
		to: count
		do: [:i | writeBuffer at: i put: (i \\ 256)].
	readBuffer := ByteArray withAll: writeBuffer.
	peerA
		write: count - 1
		from: writeBuffer
		startingAt: 1.
	numRead := peerB
		read: count
		into: readBuffer
		startingAt: 1.
	self
		assert: numRead
		equals: count - 1.
	self
		assert: readBuffer
		equals: writeBuffer
%

category: 'running-read/write'
method: RsrSocketTestCase
testReadAfterPeerClose

	| peerA peerB readBuffer count numRead |
	self
		createPair:
			[:a :b |
			peerA := a.
			peerB := b].
	count := 1024.
	readBuffer := ByteArray new: count.
	peerA close.
	self
		should:
			[numRead := peerB
				read: count
				into: readBuffer
				startingAt: 1]
		raise: RsrSocketClosed
%

category: 'running-read/write'
method: RsrSocketTestCase
testReadWrite

	| peerA peerB writeBuffer readBuffer count numWritten numRead |
	self
		createPair:
			[:a :b |
			peerA := a.
			peerB := b].
	count := 1024.
	writeBuffer := ByteArray new: count.
	1
		to: count
		do: [:i | writeBuffer at: i put: (i \\ 256)].
	readBuffer := ByteArray withAll: writeBuffer.
	numWritten := peerA
		write: count
		from: writeBuffer
		startingAt: 1.
	self
		assert: numWritten
		equals: count.
	numRead := peerB
		read: count
		into: readBuffer
		startingAt: 1.
	self
		assert: numRead
		equals: count.
	self
		assert: readBuffer
		equals: writeBuffer
%

category: 'running-client'
method: RsrSocketTestCase
testSuccessfulConnect

	| socket |
	socket := self newSocket.
	self deny: socket isConnected.
	socket
		connectToHost: 'gemtalksystems.com'
		port: 80.
	self assert: socket isConnected.
	socket close.
	self deny: socket isConnected
%

category: 'running-read/write'
method: RsrSocketTestCase
testUnconnectedReadWrite

	| socket count bytes |
	socket := self newSocket.
	count := 1024.
	bytes := ByteArray new: 1024.
	self
		should:
			[socket
				read: count
				into: bytes
				startingAt: 1]
		raise: RsrSocketClosed.
	self
		should:
			[socket
				write: count
				from: bytes
				startingAt: 1]
		raise: RsrSocketClosed
%

! Class implementation for 'RsrSystemTestCase'

!		Class methods for 'RsrSystemTestCase'

category: 'testing'
classmethod: RsrSystemTestCase
isAbstract

	^self == RsrSystemTestCase
%

!		Instance methods for 'RsrSystemTestCase'

category: 'expecting'
method: RsrSystemTestCase
expectCatch: aPromise

	| semaphore wasFulfilled result whenValue |
	semaphore := Semaphore new.
	wasFulfilled := false.
	aPromise
		when: [:value | whenValue := value. wasFulfilled := true. semaphore signal]
		catch: [:reason | result := reason. semaphore signal].
	semaphore wait.
	self deny: wasFulfilled.
	^result
%

category: 'expecting'
method: RsrSystemTestCase
expectWhen: aPromise

	| semaphore wasBroken result |
	semaphore := Semaphore new.
	wasBroken := false.
	aPromise
		when: [:value | result := value. semaphore signal]
		catch: [:r | wasBroken := true. semaphore signal].
	semaphore wait.
	self deny: wasBroken.
	^result
%

category: 'initialization'
method: RsrSystemTestCase
initializeInMemoryConnections

	| spec |
	spec := RsrInMemoryConnectionSpecification new.
	spec connect.
	connectionA := spec connectionA.
	connectionB := spec connectionB.
	self
		assert: connectionA isOpen;
		assert: connectionB isOpen
%

category: 'initialization'
method: RsrSystemTestCase
initializeSocketConnections

	| spec |
	spec := RsrInternalSocketConnectionSpecification new.
	spec connect.
	connectionA := spec connectionA.
	connectionB := spec connectionB.
	self
		assert: connectionA isOpen;
		assert: connectionB isOpen
%

category: 'accessing'
method: RsrSystemTestCase
peerOf: aService

	| connectionInPeer |
	connectionInPeer := aService _connection.
	connectionInPeer ifNil: [self assert: false description: 'Unable to obtain the peer of an unregistered Service.'].
	^connectionInPeer == connectionA
		ifTrue: [connectionB serviceAt: aService _id]
		ifFalse: [connectionA serviceAt: aService _id]
%

category: 'initialization'
method: RsrSystemTestCase
setUp
	"Subclasses need to start their connections by calling
	#initializeInMemoryConnections or #initializeSocketConnections.
	#tearDown will close connections."

	super setUp
%

category: 'initialization'
method: RsrSystemTestCase
tearDown

	connectionA ifNotNil: [:conn | conn close].
	connectionB ifNotNil: [:conn | conn close].
	connectionA := connectionB := nil.
	super tearDown
%

! Class implementation for 'RsrConnectionTestCase'

!		Class methods for 'RsrConnectionTestCase'

category: 'testing'
classmethod: RsrConnectionTestCase
isAbstract

	^self == RsrConnectionTestCase
%

!		Instance methods for 'RsrConnectionTestCase'

category: 'running'
method: RsrConnectionTestCase
testAllowExistingInstancesOfDeniedTemplate

	| policy template allow value promise result |
	policy := RsrTestPolicy new.
	template := RsrServiceNoInstVars.
	connectionB policy: policy.
	value := Time millisecondClockValue.

	"Send a new instance before Policy denies it."
	allow := template clientClass new.
	allow registerWith: connectionA.
	promise := allow asyncSendReturnArgument: value.
	result := self expectWhen: promise.
	self
		assert: result
		equals: value.

	"Reject the template and try again with the existing instance."
	policy deny: template.
	promise := allow asyncSendReturnArgument: value.
	result := self expectWhen: promise.
	self
		assert: result
		equals: value.
%

category: 'running'
method: RsrConnectionTestCase
testPolicyRejection

	| policy template allow reject value promise result reason |
	policy := RsrTestPolicy new.
	template := RsrServiceNoInstVars.
	connectionB policy: policy.
	value := Time millisecondClockValue.

	"Send a new instance before Policy denies it."
	allow := template clientClass new.
	allow registerWith: connectionA.
	promise := allow asyncSendReturnArgument: value.
	result := self expectWhen: promise.
	self
		assert: result
		equals: value.

	"Reject the template and try again with a new instance."
	policy deny: template.
	reject := template clientClass new.
	reject registerWith: connectionA.
	promise := reject asyncSendReturnArgument: value.
	reason := self expectCatch: promise.
	self
		assert: reason class
		equals: RsrPolicyRejectedServiceServer.
	self
		assert: reason templateName
		equals: template templateClassName.
	self
		assert: reason sid
		equals: reject _id
%

category: 'running'
method: RsrConnectionTestCase
testPolicyRejectsFrameworkTemplate

	| policy template service frameworkService promise result |
	policy := RsrTestPolicy new.
	template := RsrPolicyRejectedService.
	connectionA policy: policy.
	connectionB policy: policy.
	service := RsrServiceNoInstVars clientClass new.
	service registerWith: connectionA.

	"Send a new instance before Policy denies it."
	frameworkService := template clientClass new.
	promise := service asyncSendReturnArgument: frameworkService.
	result := self expectWhen: promise.
	self
		assert: result
		identicalTo: frameworkService.

	"Ensure it is allowed even if the Policy rejects it."
	policy deny: template.
	frameworkService := template clientClass new.
	promise := service asyncSendReturnArgument: frameworkService.
	result := self expectWhen: promise.
	self
		assert: result
		identicalTo: frameworkService.
%

category: 'running'
method: RsrConnectionTestCase
testWaitUntilClose

	| semaphore marker |
	semaphore := Semaphore new.
	marker := false.
	RsrProcessModel
		fork:
			[semaphore signal.
			[connectionB waitUntilClose.
			marker := true]
				ensure: [semaphore signal]]
		named: 'Pending Connection Closure'.
	semaphore wait.
	self deny: marker.
	connectionA close.
	semaphore wait.
	self assert: marker
%

! Class implementation for 'RsrInMemoryConnectionTestCase'

!		Instance methods for 'RsrInMemoryConnectionTestCase'

category: 'running'
method: RsrInMemoryConnectionTestCase
setUp

	super setUp.
	self initializeInMemoryConnections
%

! Class implementation for 'RsrSocketConnectionTestCase'

!		Instance methods for 'RsrSocketConnectionTestCase'

category: 'running'
method: RsrSocketConnectionTestCase
setUp

	super setUp.
	self initializeSocketConnections
%

! Class implementation for 'RsrEphemeronMourningDeadlock'

!		Instance methods for 'RsrEphemeronMourningDeadlock'

category: 'running'
method: RsrEphemeronMourningDeadlock
setUp

	super setUp.
	self initializeSocketConnections
%

category: 'running'
method: RsrEphemeronMourningDeadlock
testEphemeronMourningDoesNotDeadlock
	"The RsrRegistry protects its backing datastructure using a mutex.
	When returning a large number of new Services, the data structure
	can grow triggering a garbage collection. Any services which are 
	collected need to be removed from the registry.
	The ephemeron mourning by default happens on the currently active
	thread. This can result in attempting to access the critical section in
	the registry twice. It isn't safe to use a recursive lock.
	This test is intended to recreate this case ensuring that RSR properly
	activates a background mourning process preventing the deadlock.

	We lock the registry by waiting in a critical section. Then, we mourn an ephemeron.
	This should force the mourning process to wait until the test exits the critical section."

	| service semaphore isRunning |
	"Ensure we are processing #mourn async"
	self assert: RsrAsyncMournHandler current isActive.
	"We now have an ephemeron setup for this service."
	service := RsrClientNoInstVars new
		registerWith: connectionA;
		yourself.
	semaphore := Semaphore new.
	isRunning := true.
	RsrProcessModel
		fork:
			[connectionA _privateRegistryOnlyForTests critical: [semaphore signal; wait]]
		named: 'Lock registry'.
	[semaphore wait.
	service := nil.
	RsrGarbageCollector maximumReclamation.
	self
		assert: RsrAsyncMournHandler current process waitingOn class
		equals: Semaphore]
		ensure: [semaphore signal]
%

! Class implementation for 'RsrLifetimeTest'

!		Class methods for 'RsrLifetimeTest'

category: 'testing'
classmethod: RsrLifetimeTest
isAbstract

	^self == RsrLifetimeTest
%

!		Instance methods for 'RsrLifetimeTest'

category: 'utilities'
method: RsrLifetimeTest
evaluateAsRemoteAction: aBlock
	"Evaluate the block and return the result through RSR."

	| client server |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: aBlock.
	^client value
%

category: 'running'
method: RsrLifetimeTest
testEnsurePushedClientServerLifetime
	"This test is designed to ensure that a Server created via a 'pushed' Client
	exhibit the correct lifetime properties."

	| client sid server actual |
	client := RsrClientNoInstVars new
		registerWith: connectionA;
		synchronize.
	sid := client _id.
	self maximumReclamation. "Ensure the Server is strongly referenced in connectionB."
	server := connectionB
		serviceAt: sid
		ifAbsent: [self assert: false].
	client := nil.
	self maximumReclamation. "Ensure the Client is garbage collected."
	(Delay forSeconds: 1) wait. "Ensure the ReleaseServices Command is propogated and processed by connectionB."
	self maximumReclamation. "Ensure the Server is still referenced even after a garbage collect."
	actual := connectionA
		serviceAt: sid
		ifAbsent: [nil].
	self
		assert: actual
		equals: nil.
	actual := connectionB
		serviceAt: sid
		ifAbsent: [self assert: false].
	self
		assert: actual
		identicalTo: server.
	actual := nil. "Ensure we do not retain an extra reference to the Server."
	server := nil.
	self maximumReclamation. "Ensure Server is removed."
	actual := connectionB
		serviceAt: sid
		ifAbsent: [nil].
	self
		assert: actual
		equals: nil
%

category: 'running'
method: RsrLifetimeTest
testEnsureReturnedServerLifetime
	"Return a newly created Server (that is not registered.) It should persist in the framework until 
	both the associated Client is garbage collected and local references are dropped.

	If you change this method -- change #testEnsureReturnRegisteredServerLifetime as well."

	| client sid server result |
	client := self evaluateAsRemoteAction: [RsrServerNoInstVars new].
	sid := client _id.
	self maximumReclamation. "Ensure the Server instance is referenced."
	server := connectionB
		serviceAt: sid
		ifAbsent: [self assert: false].
	client := nil.
	self maximumReclamation.
	(Delay forSeconds: 1) wait. "Release Client."
	self maximumReclamation.
	"Ensure Client is released."
	result := connectionA
		serviceAt: sid
		ifAbsent: [nil].
	self
		assert: result
		equals: nil.
	"Ensure Server is still registered."
	result := connectionB
		serviceAt: sid
		ifAbsent: [self assert: false].
	self
		assert: result
		equals: server.
	result := server := nil.
	self maximumReclamation.
	result := connectionB
		serviceAt: sid
		ifAbsent: [nil].
	self
		assert: result
		equals: nil
%

category: 'running'
method: RsrLifetimeTest
testEnsureReturnRegisteredServerLifetime
	"Return a newly created Server (that is registered.) It should persist in the framework until 
	both the associated Client is garbage collected and local references are dropped.

	If you change this method -- change #testEnsureReturnedServerLifetime as well."

	| client sid server result |
	client := self evaluateAsRemoteAction: [RsrServerNoInstVars new registerWith: connectionB].
	sid := client _id.
	self maximumReclamation. "Ensure the Server instance is referenced."
	server := connectionB
		serviceAt: sid
		ifAbsent: [self assert: false].
	client := nil.
	self maximumReclamation.
	(Delay forSeconds: 1) wait. "Release Client."
	self maximumReclamation.
	"Ensure Client is released."
	result := connectionA
		serviceAt: sid
		ifAbsent: [nil].
	self
		assert: result
		equals: nil.
	"Ensure Server is still registered."
	result := connectionB
		serviceAt: sid
		ifAbsent: [self assert: false].
	self
		assert: result
		equals: server.
	result := server := nil.
	self maximumReclamation.
	result := connectionB
		serviceAt: sid
		ifAbsent: [nil].
	self
		assert: result
		equals: nil
%

! Class implementation for 'RsrInMemoryLifetimeTest'

!		Instance methods for 'RsrInMemoryLifetimeTest'

category: 'running'
method: RsrInMemoryLifetimeTest
setUp

	super setUp.
	self initializeInMemoryConnections
%

! Class implementation for 'RsrSocketLifetimeTest'

!		Instance methods for 'RsrSocketLifetimeTest'

category: 'running'
method: RsrSocketLifetimeTest
setUp

	super setUp.
	self initializeSocketConnections
%

! Class implementation for 'RsrMessageSendingTest'

!		Class methods for 'RsrMessageSendingTest'

category: 'testing'
classmethod: RsrMessageSendingTest
isAbstract

	^self == RsrMessageSendingTest
%

!		Instance methods for 'RsrMessageSendingTest'

category: 'utilities'
method: RsrMessageSendingTest
terminateCurrentProcess

	Processor activeProcess terminate
%

category: 'running-errors'
method: RsrMessageSendingTest
testAsyncRemoteError

	| client server reason |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [Error new tag: 'tag'; messageText: 'messageText'; signal].
	reason := self expectCatch: client asyncValue.
	self assert: reason isRemoteException.
	self
		assert: reason exceptionClassName
		equals: #Error.
	self
		assert: reason tag
		equals: 'tag'.
	self
		assert: reason messageText
		equals: 'messageText'.
	self
		assert: reason stack isString;
		assert: reason stack size > 0
%

category: 'running'
method: RsrMessageSendingTest
testAsyncReturnArgument

	| client server promise result |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [:arg | arg].
	promise := client asyncValue: client.
	result := self expectWhen: promise.
	self
		assert: result
		identicalTo: client
%

category: 'running'
method: RsrMessageSendingTest
testAsyncReturnService

	| client server service |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [RsrValueHolderServer new].
	service := self expectWhen: client asyncValue.
	self
		assert: service class
		equals: RsrValueHolderClient
%

category: 'running'
method: RsrMessageSendingTest
testChangeRemoteState

	| marker client server |
	marker := false.
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [marker := true].
	client value.
	self assert: marker
%

category: 'running-close during message'
method: RsrMessageSendingTest
testCloseConnectionDuringMessageSend

	| client server promise reason |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [(Delay forSeconds: 10) wait].
	promise := client asyncValue.
	connectionA close.
	reason := self expectCatch: promise.
	self
		assert: reason class
		equals: RsrConnectionClosedBeforeReceivingResponse
%

category: 'running-errors'
method: RsrMessageSendingTest
testDebugHandlerBreak
	"Ensure that if a debug handler resolves the message,
	that the correct reason is received remotely."

	| marker client server reason |
	marker := #testMarker.
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [RsrResumableError signal. 42 "ensure we do not return the marker"].
	server debugHandler: [:exception :messageSend :resolver | resolver break: marker. nil "ensure we do not return the marker"].
	reason := self expectCatch: client asyncValue.
	self
		assert: reason
		equals: marker.
	server action: [RsrNonresumableError signal. 42 "ensure we do not return the marker"].
	reason := self expectCatch: client asyncValue.
	self
		assert: reason
		equals: marker
%

category: 'running-errors'
method: RsrMessageSendingTest
testDebugHandlerException
	"Ensure that an exception that occurs in the debug handler
	is reported back as the reason for Promise breaking."

	| marker client server reason |
	marker := #testMarker.
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [RsrResumableError signal].
	server debugHandler: [:exception :messageSend :resolver | Error signal].
	reason := self expectCatch: client asyncValue.
	self
		assert: reason exceptionClassName
		equals: #Error.
	server action: [RsrNonresumableError signal].
	reason := self expectCatch: client asyncValue.
	self
		assert: reason exceptionClassName
		equals: #Error.
%

category: 'running-errors'
method: RsrMessageSendingTest
testDebugHandlerFulfill
	"Ensure that if a debug handler resolves the message,
	that the fulfillment value is received remotely."

	| marker client server |
	marker := #testMarker.
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [RsrResumableError signal. 42 "ensure we do not return the marker"].
	server debugHandler: [:exception :messageSend :resolver | resolver fulfill: marker. nil "ensure we do not return the marker"].
	self
		assert: client value
		equals: marker.
	server action: [RsrNonresumableError signal. 42 "ensure we do not return the marker"].
	self
		assert: client value
		equals: marker
%

category: 'running-errors'
method: RsrMessageSendingTest
testDebugHandlerNoResolutionWithNonresumableException
	"Ensure that if the debug handler does not resolve the exception
	and the exception is nonresumable, that we Break the Promise
	reporting on the unresolved exception."

	| marker client server reason |
	marker := #testMarker.
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [RsrNonresumableError signal].
	server debugHandler: [:exception :messageSend :resolver | marker].
	reason := self expectCatch: client asyncValue.
	self
		assert: reason exceptionClassName
		equals: #RsrNonresumableError
%

category: 'running-errors'
method: RsrMessageSendingTest
testDebugHandlerNoResolutionWithResumableException
	"Ensure that if the debug handler does not resolve the exception
	and the exception is resumable, we resume with the evaluation
	result of the debug handler."

	| marker client server |
	marker := #testMarker.
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [RsrResumableError signal].
	server debugHandler: [:exception :messageSend :resolver | marker].
	self
		assert: client value
		equals: marker
%

category: 'running'
method: RsrMessageSendingTest
testPrePostUpdate

	| client server pre post |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	pre := post := false.
	server
		preUpdateHandler: [pre := true];
		postUpdateHandler: [post := true];
		action: [].
	client value.
	self
		assert: pre;
		assert: post
%

category: 'running-errors'
method: RsrMessageSendingTest
testPrePostUpdateError

	| client server reason |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [true].
	self assert: client value.
	server
		preUpdateHandler: [Error signal: 'preUpdate'];
		postUpdateHandler: [].
	reason := self expectCatch: client asyncValue.
	self
		assert: reason exceptionClassName
		equals: #Error.
	self
		assert: reason messageText
		equals: 'preUpdate'.
	server
		preUpdateHandler: [];
		postUpdateHandler:  [Error signal: 'postUpdate'].
	reason := self expectCatch: client asyncValue.
	self
		assert: reason exceptionClassName
		equals: #Error.
	self
		assert: reason messageText
		equals: 'postUpdate'.
%

category: 'running-errors'
method: RsrMessageSendingTest
testRemoteError

	| client server reason |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [Error new tag: 'tag'; messageText: 'messageText'; signal].
	[client value]
		on: RsrBrokenPromise
		do: [:ex | reason := ex reason. ex return].
	self assert: reason isRemoteException.
	self
		assert: reason exceptionClassName
		equals: #Error.
	self
		assert: reason tag
		equals: 'tag'.
	self
		assert: reason messageText
		equals: 'messageText'.
	self
		assert: reason stack isString;
		assert: reason stack size > 0
%

category: 'running-errors'
method: RsrMessageSendingTest
testRemoteErrorWithTag

	| client server tag messageText reason |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	tag := nil.
	messageText := 'messageText'.
	server action: [Error new tag: tag; messageText: messageText; signal].
	reason := [client value]
		on: RsrBrokenPromise
		do: [:ex | ex return: ex reason].
	self assert: reason isRemoteException.
	self
		assert: reason tag
		equals: 'messageText'.
	self
		assert: reason messageText
		equals: 'messageText'.
	self
		assert: reason stack isString;
		assert: reason stack size > 0.
	tag := 42.
	reason := [client value]
		on: RsrBrokenPromise
		do: [:ex | ex return: ex reason].
	self
		assert: reason tag
		equals: '42'.
	tag := RsrSignalErrorInAsString new.
	reason := [client value]
		on: RsrBrokenPromise
		do: [:ex | ex return: ex reason].
	self
		assert: reason tag
		equals: 'Unable to pack #tag containing an instance of RsrSignalErrorInAsString'
%

category: 'running-termination'
method: RsrMessageSendingTest
testRemoteProcessTerminationDuringDebugHandler

	| client server reason |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server
		action: [Error signal];
		debugHandler: [:ex :message :resolver | self terminateCurrentProcess].
	reason := self expectCatch: client asyncValue.
	self
		assert: reason
		equals: 'Message send terminated without a result'
%

category: 'running-termination'
method: RsrMessageSendingTest
testRemoteProcessTerminationDuringMessageSend

	| client server reason |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [self terminateCurrentProcess].
	reason := self expectCatch: client asyncValue.
	self
		assert: reason
		equals: 'Message send terminated without a result'
%

category: 'running-termination'
method: RsrMessageSendingTest
testRemoteProcessTerminationDuringPrePostUpdate

	| client server reason |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server
		preUpdateHandler: [self terminateCurrentProcess];
		postUpdateHandler: [];
		action: [].
	reason := self expectCatch: client asyncValue.
	self
		assert: reason
		equals: 'Message send terminated without a result'
%

category: 'running'
method: RsrMessageSendingTest
testReturnAlsoUpdatesLocalService
	"Ensure that when the remote peer service returns a value,
	that it is also sent to update the local service."

	| client server value response |
	client := RsrReflectedVariableTestClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	value := 42.
	self
		deny: client varA
		equals: value.
	self
		deny: client varB
		equals: value.
	response := client setVarsToAndReturn: value.
	self
		assert: response
		equals: value.
	self
		assert: server varA
		equals: value.
	self
		assert: server varB
		equals: value.
	self
		assert: client varA
		equals: value.
	self
		assert: client varB
		equals: value
%

category: 'running'
method: RsrMessageSendingTest
testReturnArgument

	| client server arguments dt response |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [:object | object].
	arguments := OrderedCollection new
		addAll: #( '' #symbol 'string' $h 0 -14 14 18446744073709551616 -18446744073709551616 nil true false );
 		add: (Character codePoint: 16r259F);
		add: (Dictionary new at: 1 put: 2; yourself);
		add: (Set with: 14);
		add: #[1 2 3 4];
		add: (OrderedCollection with: 42 with: 43);
		add: #(1 2 #(nil));
		yourself.
	dt := RsrDateAndTime now.
	response := client value: dt.
	self
		assert: (dt asSeconds * 1000000) rounded
		equals: (response asSeconds * 1000000) rounded.
	arguments
		do:
			[:each | | result |
			result := client value: each.
			self
				assert: result
				equals: each].
	arguments
		do:
			[:each | | result |
			result := server evaluateAction: each.
			self
				assert: result
				equals: each].
	self
		assert: (client value: arguments)
		equals: arguments.
	self
		assert: (server evaluateAction: arguments)
		equals: arguments.
	self
		assert: (client value: client)
		identicalTo: client
%

category: 'running-errors'
method: RsrMessageSendingTest
testReturnInvalidObject

	| client server reason |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [Object new].
	self
		should: [client value]
		raise: RsrBrokenPromise.
	reason := [client value]
		on: RsrBrokenPromise
		do: [:ex | ex return: ex reason].
	self assert: reason isRemoteException.
	self
		assert: reason exceptionClassName
		equals: #RsrUnsupportedObject.
	self
		assert: reason tag
		equals: 'Instances of #Object do not support replication.'.
	self
		assert: reason messageText
		equals: 'Instances of #Object do not support replication.'.
	self
		assert: reason stack isString;
		assert: reason stack size > 0
%

category: 'running'
method: RsrMessageSendingTest
testReturnNewService

	| client server returnedService |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [RsrValueHolderServer new].
	returnedService := client value.
	self
		assert: returnedService class
		equals: RsrValueHolderClient
%

category: 'running'
method: RsrMessageSendingTest
testReturnNewServiceInArray

	| client server array returnedService |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [Array with: RsrValueHolderServer new].
	array := client value.
	returnedService := array first.
	self
		assert: returnedService class
		equals: RsrValueHolderClient
%

category: 'running'
method: RsrMessageSendingTest
testReturnSymbol

	| client server symbol result |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	symbol := #testSymbol.
	server action: [symbol].
	result := client value.
	self
		assert: result
		equals: symbol
%

category: 'running-errors'
method: RsrMessageSendingTest
testSendInvalidObject

	| client server |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [:arg | arg].
	self
		should: [client value: Object new]
		raise: RsrUnsupportedObject
%

category: 'running-errors'
method: RsrMessageSendingTest
testUnimplementedRemoteSend
	"Ensure a remote DNU is reported back to the sender."

	| marker client reason |
	marker := #testMarker.
	client := RsrClientNoInstVars new
		registerWith: connectionA;
		synchronize.
	reason := self expectCatch: client unimplementedRemoteSend.
	self
		assert: reason class
		equals: RsrRemoteExceptionServer.
	self
		assert: reason exceptionClassName
		equals: #MessageNotUnderstood
%

! Class implementation for 'RsrInMemoryMessageSendingTest'

!		Instance methods for 'RsrInMemoryMessageSendingTest'

category: 'running'
method: RsrInMemoryMessageSendingTest
setUp

	super setUp.
	self initializeInMemoryConnections
%

! Class implementation for 'RsrSocketMessageSendingTest'

!		Instance methods for 'RsrSocketMessageSendingTest'

category: 'running'
method: RsrSocketMessageSendingTest
setUp

	super setUp.
	self initializeSocketConnections
%

! Class implementation for 'RsrServiceTest'

!		Class methods for 'RsrServiceTest'

category: 'testing'
classmethod: RsrServiceTest
isAbstract

	^self == RsrServiceTest
%

!		Instance methods for 'RsrServiceTest'

category: 'running-utilities'
method: RsrServiceTest
mirror: aService

	| client |
	client := RsrClientNoInstVars new
		registerWith: connectionA;
		yourself.
	^client sendReturnArgument: aService
%

category: 'running'
method: RsrServiceTest
testAnalyzeServiceRegisteredWithDifferentConnection

	| instance analysis |
	instance := RsrRemoteAction clientClass new.
	analysis := RsrSnapshotAnalysis
		roots: (Array with: instance)
		connection: connectionA.
	analysis perform.
	self assert: instance isMirrored.
	analysis := RsrSnapshotAnalysis
		roots: (Array with: instance)
		connection: connectionB.
	self
		should: [analysis perform]
		raise: RsrAlreadyRegistered
%

category: 'running'
method: RsrServiceTest
testEnsureServersAreCachedAndReused

	| client service1 service2 |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	service1 := connectionB serviceAt: client _id.
	self mirror: client.
	service2 := connectionB serviceAt: client _id.
	self
		assert: service1
		identicalTo: service2
%

category: 'running'
method: RsrServiceTest
testHasRemoteSelf

	| service |
	service := RsrTestService clientClass new.
	self mirror: service.
	self deny: nil == service remoteSelf
%

category: 'running'
method: RsrServiceTest
testInitialization

	| instance |
	instance := RsrRemoteAction clientClass new.
	self
		assert: instance isMirrored
		equals: false.
	self
		assert: instance _id
		equals: nil.
	self
		assert: instance _connection
		equals: nil
%

category: 'running'
method: RsrServiceTest
testIsMirrored

	| instance |
	instance := RsrRemoteAction clientClass new.
	self deny: instance isMirrored.
	self mirror: instance.
	self assert: instance isMirrored
%

category: 'running'
method: RsrServiceTest
testMessageDispatchedConcurrentlyToSingleService
	"Ensure all messages are sent concurrently (including those sent to a single service)"

	| client server counter promise1 promise2 |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	counter := 0.
	server action: [counter := counter + 1. self shortWait. counter].
	promise1 := client asyncValue.
	promise2 := client asyncValue.
	self
		assert: promise1 wait
		equals: 2. "The #shortWait will cause the second counter increment before the counter is returned."
	self
		assert: promise2 wait
		equals: 2
%

category: 'running'
method: RsrServiceTest
testMessagesDispactchedConcurrentlyForMultipleServices
	"Ensure messages are dispatched concurrently"

	| client1 server1 client2 server2 semaphore expected1 expected2 promise1 promise2 |
	client1 := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	client2 := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server1 := connectionB serviceAt: client1 _id.
	server2 := connectionB serviceAt: client2 _id.
	semaphore := Semaphore new.
	expected1 := #expected1.
	expected2 := #expected2.
	server1 action: [semaphore wait. expected1].
	server2 action: [semaphore signal. expected2].
	promise1 := client1 asyncValue.
	promise2 := client2 asyncValue.
	self shortWait.
	self
		assert: promise1 isResolved;
		assert: promise2 isResolved.
	self
		assert: promise1 value
		equals: expected1.
	self
		assert: promise2 value
		equals: expected2
%

category: 'running'
method: RsrServiceTest
testPostRegistration

	| client  server testClient testServer regCount |
	"#registerWith: validation"
	client := RsrInstrumentedClient new.
	self
		assert: client postRegistrationCount
		equals: 0.
	client registerWith: connectionA.
	self
		assert: client postRegistrationCount
		equals: 1.
	client registerWith: connectionA.
	self
		assert: client postRegistrationCount
		equals: 1.
	client synchronize.
	server := self peerOf: client.
	self
		assert: client postRegistrationCount
		equals: 1.
	self
		assert: server postRegistrationCount
		equals: 0.

	"Validate implicit registration of argument Service"
	testClient := RsrInstrumentedClient new.
	server action: [:testServerArg | testServerArg postRegistrationCount].
	regCount := client value: testClient.
	self
		assert: regCount
		equals: 0.
	self
		assert: testClient postRegistrationCount
		equals: 1.
	testServer := self peerOf: testClient.
	self
		assert: testServer postRegistrationCount
		equals: 0.

	"Validate implicit registration of returned Services"
	testClient := testServer := nil.
	server action: [testServer := RsrInstrumentedServer new].
	testClient := client value.
	self
		assert: testClient postRegistrationCount
		equals: 0.
	self
		assert: testServer postRegistrationCount
		equals: 1
%

category: 'running'
method: RsrServiceTest
testPostRegistrationRaisesException

	| client server reason tag badService signaledException caughtException |
	"Return values"
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := self peerOf: client.
	tag := DateAndTime now asString.
	server action: [RsrRemoteActionServer new postRegistrationHandler: [Error new tag: tag; signal]; yourself].
	reason := self expectCatch: client asyncValue.
	self
		assert: reason exceptionClassName
		equals: #Error.
	self
		assert: reason tag
		equals: tag. "This string came through RSR. It is equivalent but not identical."

	"Message sends"
	signaledException := Error new.
	badService := RsrRemoteActionServer new
		postRegistrationHandler: [signaledException signal];
		yourself.
	caughtException := [client value: badService]
		on: Error
		do: [:ex | ex return: ex].
	self
		assert: signaledException
		identicalTo: caughtException "RSR did not alter this exception. It should be identical."
%

category: 'running'
method: RsrServiceTest
testPrePostUpdate

	| client server | 
	client := RsrInstrumentedClient new
		registerWith: connectionA;
		yourself.
	self
		assert: client preUpdateCount
		equals: 0.
	self
		assert: client postUpdateCount
		equals: 0.
	client return: nil.
	server := connectionB serviceAt: client _id.
	self
		assert: client preUpdateCount
		equals: 1.
	self
		assert: client postUpdateCount
		equals: 1.
	self
		assert: server preUpdateCount
		equals: 1.
	self
		assert: server postUpdateCount
		equals: 1.
	client return: nil.
	self
		assert: client preUpdateCount
		equals: 2.
	self
		assert: client postUpdateCount
		equals: 2.
	self
		assert: server preUpdateCount
		equals: 2.
	self
		assert: server postUpdateCount
		equals: 2.
%

category: 'running'
method: RsrServiceTest
testReflectedVariableNames

	| client server clientNames serverNames |
	client := RsrClientTestService new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	clientNames := RsrServiceSnapshot reflectedVariablesFor: client.
	serverNames := RsrServiceSnapshot reflectedVariablesFor: server.
	self
		assert: clientNames
		equals: serverNames.
	self
		assert: clientNames size
		equals: 1.
	self
		assert: (clientNames at: 1) asSymbol
		equals: #sharedVariable.
	client := RsrReflectedVariableTestClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	clientNames := RsrServiceSnapshot reflectedVariablesFor: client.
	serverNames := RsrServiceSnapshot reflectedVariablesFor: server.
	self
		assert: clientNames
		equals: serverNames.
	self
		assert: clientNames size
		equals: 2.
	self
		assert: (clientNames at: 1) asSymbol
		equals: #varA.
	self
		assert: (clientNames at: 2) asSymbol
		equals: #varB
%

category: 'running'
method: RsrServiceTest
testRegisterWith

	| instance |
	instance := RsrRemoteAction clientClass new.
	self deny: instance isMirrored.
	instance registerWith: connectionA.
	self assert: instance isMirrored.
	self
		should: [instance registerWith: connectionB]
		raise: RsrAlreadyRegistered
%

category: 'running'
method: RsrServiceTest
testReturnServerWithoutAssociatedClient

	| client server reason |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [RsrKnownServer new].
	reason := self expectCatch: client asyncValue.
	self
		assert: reason class
		equals: RsrDecodingRaisedException
%

category: 'running'
method: RsrServiceTest
testSendClientWithoutAssociatedServer

	| client server reason |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [:x | x].
	reason := self expectCatch: (client asyncValue: RsrKnownClient new).
	self
		assert: reason class
		equals: RsrRemoteExceptionServer.
	self
		assert: reason exceptionClassName
		equals: #RsrUnknownClass
%

category: 'running'
method: RsrServiceTest
testVariableReflection

	| localService remoteService |
	localService := RsrTestService clientClass new
		sharedVariable: #shared;
		privateVariable: #private;
		yourself.
	self mirror: localService.
	remoteService := connectionB serviceAt: localService _id.
	self
		assert: localService sharedVariable
		identicalTo: remoteService sharedVariable.
	self
		assert: localService privateVariable
		identicalTo: #private.
	self
		assert: remoteService privateVariable
		identicalTo: nil
%

! Class implementation for 'RsrInMemoryServiceTest'

!		Instance methods for 'RsrInMemoryServiceTest'

category: 'running'
method: RsrInMemoryServiceTest
setUp

	super setUp.
	self initializeInMemoryConnections
%

! Class implementation for 'RsrSocketServiceTest'

!		Instance methods for 'RsrSocketServiceTest'

category: 'running'
method: RsrSocketServiceTest
setUp

	super setUp.
	self initializeSocketConnections
%

! Class implementation for 'RsrSpeciesEquality'

!		Class methods for 'RsrSpeciesEquality'

category: 'testing'
classmethod: RsrSpeciesEquality
isAbstract

	^self == RsrSpeciesEquality
%

!		Instance methods for 'RsrSpeciesEquality'

category: 'accessing'
method: RsrSpeciesEquality
basicExamples
	"Give a samples of each species to ensure Collection classes are able to encode each type successfully."

	^{RsrClientNoInstVars new.
	#h.
	#''.
	'h'.
	''.
	0.
	234.
	-97.
	$s.
	nil.
	true.
	false.
	{}.
	{RsrClientNoInstVars new. {}.}.
	#[].
	#[123].
	Set new.
	Set with: 42.
	OrderedCollection new.
	OrderedCollection with: #x.
	Dictionary new.
	Dictionary new at: #key put: #value; yourself.
	RsrDateAndTime posixEpoch.
	RsrDateAndTime fromMicroseconds: -1000000. "1969-12-31T23:59:59-00:00"}
%

category: 'running'
method: RsrSpeciesEquality
testArray

	self
		verify: #();
		verify: (Array withAll: self basicExamples)
%

category: 'running'
method: RsrSpeciesEquality
testBoolean

	self
		verify: true;
		verify: false
%

category: 'running'
method: RsrSpeciesEquality
testByteArray

	self
		verify: #[];
		verify: (ByteArray withAll: (0 to: 255));
		verify: (ByteArray new: 1024)
%

category: 'running'
method: RsrSpeciesEquality
testCharacter

	self
		verify: (Character codePoint: 0);
		verify: (Character codePoint: 65);
		verify: $A;
		verify: (Character codePoint: 16r01D4);
		verify: (Character codePoint: 16r8334)
%

category: 'running'
method: RsrSpeciesEquality
testDateAndTime

	self
		verify: (RsrDateAndTime fromMicroseconds: -491277642567488); "1954-06-07T14:59:17.432512-07:00"
		verify: (RsrDateAndTime fromMicroseconds: 1562692562657612). "2019-07-09T10:16:02.657612-07:00"
%

category: 'running'
method: RsrSpeciesEquality
testDictionary

	| example |
	example := Dictionary new.
	self verify: example.
	self basicExamples do: [:each | each ifNotNil: [example at: each put: each]].
	example at: #testDictionaryPrivateKey put: nil.
	self verify: example
%

category: 'running'
method: RsrSpeciesEquality
testInteger

	self
		verify: 0;
		verify: -1;
		verify: 1;
		verify: (2 raisedTo: 32);
		verify: (2 raisedTo: 32) negated;
		verify: (2 raisedTo: 64);
		verify: (2 raisedTo: 64) negated;
		verify: 4598754392654025898794;
		verify: -13750198234577893465
%

category: 'running'
method: RsrSpeciesEquality
testOrderedCollection

	self
		verify: OrderedCollection new;
		verify: (OrderedCollection withAll: self basicExamples)
%

category: 'running'
method: RsrSpeciesEquality
testService

	| clientClass serverClass |
	clientClass := RsrRemoteAction clientClass.
	serverClass := RsrRemoteAction serverClass.
	self
		verify: clientClass new;
		verify: (clientClass sharedVariable: clientClass new);
		verify: (serverClass sharedVariable: clientClass new)
%

category: 'running'
method: RsrSpeciesEquality
testServiceWithUnsupportedObject

	| service |
	service := RsrClientNoInstVars new
		registerWith: connectionA;
		yourself.
	self
		should: [service sendReturnArgument: (RsrValueHolderClient value: Object new)]
		raise: RsrUnsupportedObject
%

category: 'running'
method: RsrSpeciesEquality
testSet

	self
		verify: Set new;
		verify: (Set withAll: self basicExamples)
%

category: 'running'
method: RsrSpeciesEquality
testString

	self
		verify: '';
		verify: 'string'
%

category: 'running'
method: RsrSpeciesEquality
testSymbol

	self
		verify: #'';
		verify: #symbol
%

category: 'running'
method: RsrSpeciesEquality
testUndefinedObject

	self verify: nil
%

category: 'running'
method: RsrSpeciesEquality
testUnicodeString

	self verify: self unicodeString
%

category: 'running'
method: RsrSpeciesEquality
testUnicodeSymbol

	self verify: self unicodeString asSymbol
%

category: 'running'
method: RsrSpeciesEquality
unicodeString

	^String
		with: $a
		with: (Character codePoint: 16r8349)
		with: (Character codePoint: 16r10E60)
%

category: 'asserting'
method: RsrSpeciesEquality
verify: anObject
	"Send <anObject> through RSR and have it returned. Assert it is equivalent."

	| client server |
	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [:object | server sharedVariable: object. object].
	self
		assert: (client value: anObject)
		equals: anObject.
	self
		assert: client sharedVariable
		equals: anObject
%

! Class implementation for 'RsrInMemorySpeciesEquality'

!		Instance methods for 'RsrInMemorySpeciesEquality'

category: 'running'
method: RsrInMemorySpeciesEquality
setUp

	super setUp.
	self initializeInMemoryConnections
%

! Class implementation for 'RsrSocketSpeciesEquality'

!		Instance methods for 'RsrSocketSpeciesEquality'

category: 'running'
method: RsrSocketSpeciesEquality
setUp

	super setUp.
	self initializeSocketConnections
%

! Class implementation for 'RsrStressTest'

!		Class methods for 'RsrStressTest'

category: 'accessing'
classmethod: RsrStressTest
defaultTimeLimit

	^30 seconds
%

category: 'testing'
classmethod: RsrStressTest
isAbstract

	^self == RsrStressTest
%

!		Instance methods for 'RsrStressTest'

category: 'initialize/release'
method: RsrStressTest
cleanupServices

	client := server := nil
%

category: 'accessing'
method: RsrStressTest
client

	^client
%

category: 'running-utilities'
method: RsrStressTest
concurrentlyRun: aBlock

	| anyCurtailed semaphores |
	anyCurtailed := false.
	semaphores := (1 to: self numThreads) collect: [:each | Semaphore new].
	semaphores do: [:semaphore | RsrProcessModel fork: [[self repeatedlyRun: aBlock. semaphore signal] ifCurtailed: [anyCurtailed := true. semaphore signal]] named: 'Concurrent Test Thread'].
	semaphores do: [:semaphore | semaphore wait].
	self deny: anyCurtailed
%

category: 'initialize/release'
method: RsrStressTest
initializeServices

	client := RsrRemoteActionClient new
		registerWith: connectionA;
		synchronize.
	server := connectionB serviceAt: client _id.
	server action: [:x | x]
%

category: 'accessing'
method: RsrStressTest
numThreads

	^15
%

category: 'running-utilities'
method: RsrStressTest
repeatedlyRun: aBlock

	self repetitions timesRepeat: aBlock
%

category: 'running-utilities'
method: RsrStressTest
repeatedlySend: anObject

	self repeatedlyRun: [self send: anObject]
%

category: 'accessing'
method: RsrStressTest
repetitions

	^1000
%

category: 'running-utilities'
method: RsrStressTest
send: anObject

	self client value: anObject
%

category: 'accessing'
method: RsrStressTest
server

	^server
%

category: 'initialize/release'
method: RsrStressTest
setUp

	super setUp.
	self
		initializeConnections;
		initializeServices
%

category: 'initialize/release'
method: RsrStressTest
tearDown

	self cleanupServices.
	super tearDown
%

category: 'running'
method: RsrStressTest
test10MBytes

	| bytes |
	bytes := ByteArray new: 1024 * 1024 * 10.
	50 timesRepeat: [self send: bytes]
%

category: 'running'
method: RsrStressTest
test1KBytes

	self repeatedlySend: (ByteArray new: 1024)
%

category: 'running'
method: RsrStressTest
test1MBytes

	self repeatedlySend: (ByteArray new: 1024 squared)
%

category: 'running'
method: RsrStressTest
test2KBytes

	self repeatedlySend: (ByteArray new: 1024 *2)
%

category: 'running'
method: RsrStressTest
testBasicSends

	self repeatedlySend: nil
%

category: 'running'
method: RsrStressTest
testConcurrent1KBytes

	self concurrentlyRun: [self client value: (ByteArray new: 1024)]
%

category: 'running'
method: RsrStressTest
testConcurrent2KBytes

	self concurrentlyRun: [self client value: (ByteArray new: 2 * 1024)]
%

category: 'running'
method: RsrStressTest
testConcurrentBasicSends

	self concurrentlyRun: [self client value: nil]
%

! Class implementation for 'RsrInMemoryStressTest'

!		Instance methods for 'RsrInMemoryStressTest'

category: 'initializing'
method: RsrInMemoryStressTest
initializeConnections

	self initializeInMemoryConnections
%

! Class implementation for 'RsrSocketStressTest'

!		Class methods for 'RsrSocketStressTest'

category: 'accessing'
classmethod: RsrSocketStressTest
defaultTimeLimit
	"These tests take longer over a Socket"

	^60 seconds
%

!		Instance methods for 'RsrSocketStressTest'

category: 'initializing'
method: RsrSocketStressTest
initializeConnections

	self initializeSocketConnections
%

! Class implementation for 'RsrTemplateResolverTestCase'

!		Instance methods for 'RsrTemplateResolverTestCase'

category: 'accessing'
method: RsrTemplateResolverTestCase
resolver

	^RsrTemplateResolver new
%

category: 'running'
method: RsrTemplateResolverTestCase
testTemplateFor

	| service template |
	service := RsrRemoteActionClient new.
	template := self resolver templateFor: service.
	self
		assert: template
		identicalTo: RsrRemoteAction.
	service := RsrRemoteActionServer new.
	template := self resolver templateFor: service.
	self
		assert: template
		identicalTo: RsrRemoteAction
%

category: 'running'
method: RsrTemplateResolverTestCase
testTemplateNamed

	| template |
	template := self resolver templateNamed: #RsrRemoteAction.
	self
		assert: template
		identicalTo: RsrRemoteAction.
	self
		should: [self resolver templateNamed: #DoNotCreateThisClass]
		raise: RsrUnknownTemplate
%

category: 'running'
method: RsrTemplateResolverTestCase
testTemplateNamedIfAbsent

	| marker template |
	marker := Object new.
	template := self resolver
		templateNamed: #RsrRemoteAction
		ifAbsent: [marker].
	self
		assert: template
		identicalTo: RsrRemoteAction.
	template := self resolver
		templateNamed: #DoNotCreateThisClass
		ifAbsent: [marker].
	self
		assert: template
		identicalTo: marker
%

! Class implementation for 'RsrTemplateResolverWithClassVersions'

!		Instance methods for 'RsrTemplateResolverWithClassVersions'

category: 'accessing'
method: RsrTemplateResolverWithClassVersions
resolver

	^RsrTemplateResolver new
%

category: 'cleanup'
method: RsrTemplateResolverWithClassVersions
tearDown

	RsrService
		rwSubclass: 'RsrVersionService'
		instVarNames: #()
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		category: 'RemoteServiceReplication-GemStone-Test'
		options: #().
	super tearDown
%

category: 'running'
method: RsrTemplateResolverWithClassVersions
testVersionClassAfterCreatingService

	| template service result |
	template := RsrVersionService.
	service := template clientClass new.
	result := self resolver templateFor: service.
	self
		assert: result
		identicalTo: template.
	"Revision the Service class and Template"
	RsrService
		rwSubclass: 'RsrVersionService'
		instVarNames: {'a' + Time millisecondClockValue printString}
		classVars: #()
		classInstVars: #()
		poolDictionaries: #()
		category: 'RemoteServiceReplication-GemStone-Test'
		options: #().
	result := self resolver templateFor: service.
	self
		assert: result
		identicalTo: template.
	self
		deny: result
		identicalTo: RsrVersionService.
	result := self resolver templateFor: RsrVersionService clientClass new.
	self
		assert: result
		identicalTo: RsrVersionService
%

! Class implementation for 'RsrTestingProcessModelTestCase'

!		Instance methods for 'RsrTestingProcessModelTestCase'

category: 'running'
method: RsrTestingProcessModelTestCase
exceptionCase

	| sema |
	sema := Semaphore new.
	RsrProcessModel fork: [[Error signal] ensure: [sema signal]] ensure: 'Ensure w/ signal'.
	sema wait
%

category: 'running'
method: RsrTestingProcessModelTestCase
noExceptionCase

	| sema |
	sema := Semaphore new.
	RsrProcessModel fork: [sema signal] named: 'Signal Semaphore'.
	sema wait
%

category: 'running'
method: RsrTestingProcessModelTestCase
testCurrentStackDump

	| stack |
	stack := RsrProcessModel currentStackDump.
	self
		assert: stack isString;
		assert: stack size > 0
%

category: 'running'
method: RsrTestingProcessModelTestCase
testException

	| testCase |
	testCase := self class selector: #exceptionCase.
	self
		should: [testCase runCase]
		raise: Exception
%

category: 'running'
method: RsrTestingProcessModelTestCase
testNoException

	| testCase |
	testCase := self class selector: #noExceptionCase.
	self
		shouldnt: [testCase runCase]
		raise: Exception
%

! Class implementation for 'RsrTokenExchangeCodecTestCase'

!		Instance methods for 'RsrTokenExchangeCodecTestCase'

category: 'accessing'
method: RsrTokenExchangeCodecTestCase
codec

	^RsrTokenExchangeCodec new
%

category: 'utilities'
method: RsrTokenExchangeCodecTestCase
stream: aBlock

	^ByteArray streamContents: aBlock
%

category: 'running'
method: RsrTokenExchangeCodecTestCase
testToken

	| tokenBytes expected token result |
	tokenBytes := #[16r58 16r18 16rE8 16rA2 16rB6 16rA6 16r91 16r39 16rD2 16rA6 16rC1 16r13 16r15 16r65 16r0F 16r6A].
	expected := 
		#[0 0 0 0 0 0 0 0], "Type"
		#[0 0 0 0 0 0 0 16], "token byte length"
		tokenBytes.
	token := RsrToken bytes: tokenBytes.
	result := self stream: [:stream | self codec encodeToken: token onto: stream].
	self
		assert: result
		equals: expected.
	result := self codec decode: expected readStream.
	self
		assert: result
		equals: token
%

category: 'running'
method: RsrTokenExchangeCodecTestCase
testTokenAccepted

	| expected tokenAccepted result |
	expected := #[0 0 0 0 0 0 0 1]. "Type"
	tokenAccepted := RsrTokenAccepted new.
	result := self stream: [:stream | self codec encodeTokenAccepted: tokenAccepted onto: stream].
	self
		assert: result
		equals: expected.
	result := self codec decode: expected readStream.
	self
		assert: result
		equals: tokenAccepted
%

category: 'running'
method: RsrTokenExchangeCodecTestCase
testTokenRejected

	| expected tokenRejected result |
	expected := #[0 0 0 0 0 0 0 2]. "Type"
	tokenRejected := RsrTokenRejected new.
	result := self stream: [:stream | self codec encodeTokenRejected: tokenRejected onto: stream].
	self
		assert: result
		equals: expected.
	result := self codec decode: expected readStream.
	self
		assert: result
		equals: tokenRejected
%

! Class extensions for 'RsrCharacterArrayReference'

!		Class methods for 'RsrCharacterArrayReference'

category: '*remoteservicereplication-gemstone'
classmethod: RsrCharacterArrayReference
convertToBytes: aCharacterArray

	^aCharacterArray encodeAsUTF8
%

!		Instance methods for 'RsrCharacterArrayReference'

category: '*remoteservicereplication-gemstone'
method: RsrCharacterArrayReference
convertBytes: aByteArray

	^aByteArray decodeFromUTF8ToString
%

! Class extensions for 'RsrConnection'

!		Instance methods for 'RsrConnection'

category: '*remoteservicereplication'
method: RsrConnection
channel

	^channel
%

category: '*remoteservicereplication'
method: RsrConnection
channel: aChannel

	channel := aChannel.
	channel connection: self
%

category: '*remoteservicereplication'
method: RsrConnection
channelDisconnected

	self log info: 'Disconnected'.
	self close
%

category: '*remoteservicereplication'
method: RsrConnection
initialize

	super initialize.
	transactionSpigot := RsrThreadSafeNumericSpigot naturals.
	pendingMessages := RsrThreadSafeDictionary new.
	registry := RsrThreadSafeDictionary new.
	log := RsrLog new.
	announcer := Announcer new.
	templateResolver := RsrTemplateResolver new.
	policy := RsrDefaultPolicy new
%

category: '*remoteservicereplication'
method: RsrConnection
log

	^log
%

category: '*remoteservicereplication'
method: RsrConnection
mournActionForClientSID: aSID

	^[registry removeKey: aSID.
			self _releaseSID: aSID]
%

category: '*remoteservicereplication'
method: RsrConnection
mournActionForServerSID: aSID

	^[registry removeKey: aSID]
%

category: '*remoteservicereplication'
method: RsrConnection
oidSpigot

	^oidSpigot
%

category: '*remoteservicereplication'
method: RsrConnection
oidSpigot: anIntegerSpigot

	oidSpigot := anIntegerSpigot
%

category: '*remoteservicereplication'
method: RsrConnection
pendingMessages

	^pendingMessages
%

category: '*remoteservicereplication-gemstone'
method: RsrConnection
platformSpecificOpeningTasks
	"Ensure that we are mourning ephemerons asynchronously."

	RsrAsyncMournHandler current ensureStarted
%

category: '*remoteservicereplication'
method: RsrConnection
serviceAt: aSID

	^self
		serviceAt: aSID
		ifAbsent: [RsrUnknownSID signal: aSID printString]
%

category: '*remoteservicereplication'
method: RsrConnection
serviceAt: aSID
ifAbsent: aBlock
	"Return the service associated with the provided SID."

	| entry |
	entry := registry at: aSID ifAbsent: [nil].
	"Ensure we do not hold the lock for long."
	entry == nil
		ifTrue: [^aBlock value].
	"The Service may have been garbage collected but
	the entry may not yet be removed. Ensure we
	evaluate the block in that case as well."
	^entry service
		ifNil: aBlock
		ifNotNil: [:service | service]
%

category: '*remoteservicereplication'
method: RsrConnection
transactionSpigot

	^transactionSpigot
%

category: '*remoteservicereplication'
method: RsrConnection
transactionSpigot: anObject

	transactionSpigot := anObject
%

category: '*remoteservicereplication'
method: RsrConnection
unknownError: anException

	self close
%

category: '*remoteservicereplication'
method: RsrConnection
_ensureRegistered: aService
	aService _connection == nil
		ifTrue: [ 
			self _register: aService as: oidSpigot next.
			aService postRegistration.
			^ self ].
	aService _connection == self
		ifFalse: [ ^ RsrAlreadyRegistered signalService: aService intendedConnection: self ]
%

category: '*remoteservicereplication'
method: RsrConnection
_forwarderClass

	^RsrForwarder
%

category: '*remoteservicereplication-gemstone-test'
method: RsrConnection
_privateRegistryOnlyForTests

	^registry
%

category: '*remoteservicereplication'
method: RsrConnection
_receivedCommand: aCommand
	"Execute the command in the context of the receiving Connection."

	RsrProcessModel
		fork:
			[RsrProcessModel configureFrameworkProcess.
			aCommand executeFor: self]
		named: 'Processing ', aCommand class name
%

category: '*remoteservicereplication'
method: RsrConnection
_register: aService
as: sid

	| registryEntry mournAction |
	aService
		_id: sid
		connection: self.
	mournAction := aService isClient
		ifTrue: [self mournActionForClientSID: sid]
		ifFalse: [self mournActionForServerSID: sid].
	registryEntry := RsrRegistryEntry
		service: aService
		onMourn: mournAction.
	registry
		at: sid
		put: registryEntry
%

category: '*remoteservicereplication'
method: RsrConnection
_releaseSID: aSID

	| command |
	self isOpen
		ifFalse: [^self].
	self log trace: 'Cleaning up OID:', aSID printString.
	command := RsrReleaseServices sids: (Array with: aSID).
	self _sendCommand: command
%

category: '*remoteservicereplication'
method: RsrConnection
_remoteClientReleased: aSID
	"Remotely, a Client instance has been garbage collected.
	Ensure we only reference the associated service weakly."

	| entry |
	entry := registry
		at: aSID
		ifAbsent: [^self].
	entry becomeWeak.
%

category: '*remoteservicereplication'
method: RsrConnection
_sendCommand: aCommand
	"Send the provided Command to our peer."

	channel send: aCommand
%

category: '*remoteservicereplication'
method: RsrConnection
_sendMessage: aMessage
to: aService

"Open coordination window"
	"Send dirty transitive closure of aRemoteMessage"
	"Send DispatchMessage command"
"Coorination window closed"
	"Return Promise"
	| analysis receiverReference selectorReference argumentReferences dispatchCommand promise pendingMessage |
	self isOpen
		ifFalse: [self error: 'Connection is not open'].
	analysis := RsrSnapshotAnalysis
		roots: (Array with: aService), aMessage arguments
		connection: self.
	analysis perform.
	receiverReference := RsrReference from: aService.
	selectorReference := RsrReference from: aMessage selector.
	argumentReferences := aMessage arguments collect: [:each | RsrReference from: each].
	dispatchCommand := RsrSendMessage
		transaction: self transactionSpigot next
		receiverReference: receiverReference
		selectorReference: selectorReference
		argumentReferences: argumentReferences.
	dispatchCommand snapshots: analysis snapshots.
	promise := RsrPromise new.
	pendingMessage := RsrPendingMessage
		services: nil "I don't think we need to cache services here. They will remain on the stack unless they were removed from the transitive closure by another proc"
		promise: promise.
	self pendingMessages
		at: dispatchCommand transaction
		put: pendingMessage.
	self _sendCommand: dispatchCommand.
	^promise
%

category: '*remoteservicereplication'
method: RsrConnection
_stronglyRetain: aServer
	"Retain the already registered server strongly."

	| entry |
	entry := registry
		at: aServer _id
		ifAbsent: [RsrUnknownSID signal: aServer _id printString].
	entry becomeStrong
%

! Class extensions for 'RsrDateAndTime'

!		Class methods for 'RsrDateAndTime'

category: '*remoteservicereplication-gemstone'
classmethod: RsrDateAndTime
fromMicroseconds: anInteger

    ^DateAndTime
        posixSeconds: (anInteger / 1000000)
        offset: Duration zero
%

category: '*remoteservicereplication-gemstone'
classmethod: RsrDateAndTime
microsecondsSinceEpoch: aDateAndTime

	^((aDateAndTime asSeconds - self posixEpoch asSeconds) * 1000000) rounded
%

category: '*remoteservicereplication-gemstone'
classmethod: RsrDateAndTime
now

	^DateAndTime now
%

category: '*remoteservicereplication-gemstone'
classmethod: RsrDateAndTime
posixEpoch

	^DateAndTime
        posixSeconds: 0
        offset: Duration zero
%

! Class extensions for 'RsrDoubleReference'

!		Class methods for 'RsrDoubleReference'

category: '*remoteservicereplication-gemstone'
classmethod: RsrDoubleReference
convertToBytes: aFloat

	| bytes |
	bytes := ByteArray new: 8.
	bytes
		doubleAt: 1
		put: aFloat.
	^bytes
%

category: '*remoteservicereplication-gemstone'
classmethod: RsrDoubleReference
infinity

	^Float fromString: 'Infinity'
%

category: '*remoteservicereplication-gemstone'
classmethod: RsrDoubleReference
nan

	^Float fromString: '-NaN'
%

!		Instance methods for 'RsrDoubleReference'

category: '*remoteservicereplication-gemstone'
method: RsrDoubleReference
convertBytes: aByteArray

	^aByteArray doubleAt: 1
%

! Class extensions for 'RsrForwarder'

!		Class methods for 'RsrForwarder'

category: '*remoteservicereplication'
classmethod: RsrForwarder
on: anRsrObject

	| instance |
	instance := self new.
	instance _service: anRsrObject.
	^instance
%

!		Instance methods for 'RsrForwarder'

category: '*remoteservicereplication'
method: RsrForwarder
doesNotUnderstand: aMessage

	^_service _connection
		_sendMessage: aMessage
		to: _service
%

category: '*remoteservicereplication'
method: RsrForwarder
_service: aService

	_service := aService
%

! Class extensions for 'RsrObject'

!		Class methods for 'RsrObject'

category: '*remoteservicereplication-gemstone'
classmethod: RsrObject
new

	^super new initialize
%

!		Instance methods for 'RsrObject'

category: '*remoteservicereplication-gemstone'
method: RsrObject
initialize

	^self
%

! Class extensions for 'RsrProcessModel'

!		Class methods for 'RsrProcessModel'

category: '*remoteservicereplication-gemstone'
classmethod: RsrProcessModel
current
	^ SessionTemps current
		at: self keyForCurrent
		ifAbsent: [ self resetCurrent ]
%

category: '*remoteservicereplication-gemstone'
classmethod: RsrProcessModel
current: concurrency
	^ SessionTemps current at: self keyForCurrent put: concurrency
%

category: '*remoteservicereplication-gemstone'
classmethod: RsrProcessModel
keyForCurrent
	^ #'RsrCurrentProcessModel'
%

category: '*remoteservicereplication-gemstone'
classmethod: RsrProcessModel
resetCurrent
	^ self current: self new
%

category: '*remoteservicereplication-gemstone'
classmethod: RsrProcessModel
unhandledExceptionClass
	"Return the class which signals that an unhandled exception has been signaled."

	^RsrUnhandledException
%

!		Instance methods for 'RsrProcessModel'

category: '*remoteservicereplication-gemstone'
method: RsrProcessModel
configureUnhandleExceptionProtection

	Processor activeProcess
		breakpointLevel: 1;
		debugActionBlock:
			[:ex |
			({ClientForwarderSend. Halt. RsrUnhandledException.} includes: ex class)
				ifTrue: [ex _signalGciError]
				ifFalse: [RsrUnhandledException signal: ex]].
%

category: '*remoteservicereplication-gemstone'
method: RsrProcessModel
currentStackDump

	^GsProcess stackReportToLevel: 1000
%

! Class extensions for 'RsrReference'

!		Class methods for 'RsrReference'

category: '*remoteservicereplication-gemstone'
classmethod: RsrReference
initializeReferenceMapping
	"RsrReference initializeReferenceMapping"

	referenceMapping := Dictionary new.
	referenceMapping
		at: Symbol
		put: RsrSymbolReference.
	referenceMapping
		at: DoubleByteSymbol
		put: RsrSymbolReference.
	referenceMapping
		at: QuadByteSymbol
		put: RsrSymbolReference.
	referenceMapping
		at: String
		put: RsrStringReference.
    referenceMapping
        at: Unicode7
        put: RsrStringReference.
    referenceMapping
        at: DoubleByteString
        put: RsrStringReference.
    referenceMapping
        at: QuadByteString
        put: RsrStringReference.
	referenceMapping
		at: LargeInteger
		put: RsrIntegerReference.
	referenceMapping
		at: SmallInteger
		put: RsrIntegerReference.
	referenceMapping
		at: Character
		put: RsrCharacterReference.
	referenceMapping
		at: UndefinedObject
		put: RsrNilReference.
	referenceMapping
		at: Boolean
		put: RsrTrueReference.
	referenceMapping
		at: Array
		put: RsrArrayReference.
	referenceMapping
		at: ByteArray
		put: RsrByteArrayReference.
	referenceMapping
		at: Set
		put: RsrSetReference.
	referenceMapping
		at: OrderedCollection
		put: RsrOrderedCollectionReference.
	referenceMapping
		at: Dictionary
		put: RsrDictionaryReference.
	referenceMapping
		at: DateAndTime
		put: RsrDateAndTimeReference.
	referenceMapping
		at: SmallDateAndTime
		put: RsrDateAndTimeReference.
	referenceMapping
		at: SmallDouble
		put: RsrDoubleReference.
	referenceMapping
		at: Float
		put: RsrDoubleReference.
	^referenceMapping
%

category: '*remoteservicereplication'
classmethod: RsrReference
referenceClassFor: anObject

	(anObject isKindOf: RsrService)
		ifTrue: [^RsrServiceReference].
	^self referenceMapping
		at: anObject class
		ifAbsent: [RsrUnsupportedObject signal: anObject]
%

! Class extensions for 'RsrToken'

!		Class methods for 'RsrToken'

category: '*remoteservicereplication-gemstone'
classmethod: RsrToken
newRandom
	"Create a new Token with random bytes."

	| random bytes |
	random := HostRandom new.
	bytes := ByteArray new: 16.
	bytes unsigned32At: 1 put: random integer.
	bytes unsigned32At: 5 put: random integer.
	bytes unsigned32At: 9 put: random integer.
	bytes unsigned32At: 13 put: random integer.
	^self bytes: bytes
%

! Class Initialization

run
RsrPlatformInitializer initialize.
true
%
