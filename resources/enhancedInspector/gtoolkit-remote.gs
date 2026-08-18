! Jasper Enhanced Inspector vendored source
! ----------------------------------------------------------------------------
! Origin : https://github.com/feenkcom/gtoolkit-remote
! Source : src-gs/gtoolkit-remote.gs
! License: MIT - Copyright (c) feenk gmbh. See LICENSE in the origin repository.
!
! Vendored into Jasper and filed into the stone by the Enhanced Inspector
! installer. DO NOT EDIT BY HAND - regenerated from upstream by
! update_enhanced_inspector_support.sh, which re-applies this header and rewrites
! class placement from Globals to the dedicated GsEnhancedInspector dictionary.
! ----------------------------------------------------------------------------
! Class Declarations
! Generated file, do not Edit

doit
(Object
	subclass: 'GtPhlowBasicRun'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowBasicRun
removeallclassmethods GtPhlowBasicRun

doit
(GtPhlowBasicRun
	subclass: 'GtPhlowRun'
	instVarNames: #(attributes startIndex endIndex)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowRun
removeallclassmethods GtPhlowRun

doit
(Object
	subclass: 'GtPhlowColor'
	instVarNames: #(name red green blue alpha)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowColor
removeallclassmethods GtPhlowColor

doit
(Object
	subclass: 'GtPhlowDeclarativeListingType'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowDeclarativeListingType
removeallclassmethods GtPhlowDeclarativeListingType

doit
(GtPhlowDeclarativeListingType
	subclass: 'GtPhlowNumberDeclarativeListingType'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowNumberDeclarativeListingType
removeallclassmethods GtPhlowNumberDeclarativeListingType

doit
(GtPhlowDeclarativeListingType
	subclass: 'GtPhlowTextDeclarativeListingType'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowTextDeclarativeListingType
removeallclassmethods GtPhlowTextDeclarativeListingType

doit
(GtPhlowDeclarativeListingType
	subclass: 'GtPhlowTextLinkDeclarativeListingType'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowTextLinkDeclarativeListingType
removeallclassmethods GtPhlowTextLinkDeclarativeListingType

doit
(GtPhlowDeclarativeListingType
	subclass: 'GtPhlowThemeIconNameDeclarativeListingType'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowThemeIconNameDeclarativeListingType
removeallclassmethods GtPhlowThemeIconNameDeclarativeListingType

doit
(GtPhlowDeclarativeListingType
	subclass: 'GtPhlowUnknownDeclarativeListingType'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowUnknownDeclarativeListingType
removeallclassmethods GtPhlowUnknownDeclarativeListingType

doit
(Object
	subclass: 'GtPhlowDeclarativeSpecification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeSpecification';
		immediateInvariant.
true.
%

removeallmethods GtPhlowDeclarativeSpecification
removeallclassmethods GtPhlowDeclarativeSpecification

doit
(GtPhlowDeclarativeSpecification
	subclass: 'GtPhlowActionSpecification'
	instVarNames: #(id priority tooltipText methodSelector phlowDataSource)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeActions';
		immediateInvariant.
true.
%

removeallmethods GtPhlowActionSpecification
removeallclassmethods GtPhlowActionSpecification

doit
(GtPhlowActionSpecification
	subclass: 'GtPhlowButtonActionSpecification'
	instVarNames: #(label iconStencil)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeActions';
		immediateInvariant.
true.
%

removeallmethods GtPhlowButtonActionSpecification
removeallclassmethods GtPhlowButtonActionSpecification

doit
(GtPhlowActionSpecification
	subclass: 'GtPhlowErrorActionSpecification'
	instVarNames: #(errorMessage)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeActions';
		immediateInvariant.
true.
%

removeallmethods GtPhlowErrorActionSpecification
removeallclassmethods GtPhlowErrorActionSpecification

doit
(GtPhlowDeclarativeSpecification
	subclass: 'GtPhlowIconStencil'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Icons';
		immediateInvariant.
true.
%

removeallmethods GtPhlowIconStencil
removeallclassmethods GtPhlowIconStencil

doit
(GtPhlowIconStencil
	subclass: 'GtPhlowNamedIconStencil'
	instVarNames: #(iconName)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Icons';
		immediateInvariant.
true.
%

removeallmethods GtPhlowNamedIconStencil
removeallclassmethods GtPhlowNamedIconStencil

doit
(GtPhlowNamedIconStencil
	subclass: 'GtPhlowBasicGlamorousIconNameStencil'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Icons';
		immediateInvariant.
true.
%

removeallmethods GtPhlowBasicGlamorousIconNameStencil
removeallclassmethods GtPhlowBasicGlamorousIconNameStencil

doit
(GtPhlowBasicGlamorousIconNameStencil
	subclass: 'GtPhlowGlamorousIconNameStencil'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Icons';
		immediateInvariant.
true.
%

removeallmethods GtPhlowGlamorousIconNameStencil
removeallclassmethods GtPhlowGlamorousIconNameStencil

doit
(GtPhlowBasicGlamorousIconNameStencil
	subclass: 'GtPhlowGlamorousVectorIconNameStencil'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Icons';
		immediateInvariant.
true.
%

removeallmethods GtPhlowGlamorousVectorIconNameStencil
removeallclassmethods GtPhlowGlamorousVectorIconNameStencil

doit
(GtPhlowNamedIconStencil
	subclass: 'GtPhlowThemeIconNameStencil'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Icons';
		immediateInvariant.
true.
%

removeallmethods GtPhlowThemeIconNameStencil
removeallclassmethods GtPhlowThemeIconNameStencil

doit
(GtPhlowDeclarativeSpecification
	subclass: 'GtRemotePhlowNavigationAction'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeActions';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowNavigationAction
removeallclassmethods GtRemotePhlowNavigationAction

doit
(GtRemotePhlowNavigationAction
	subclass: 'GtRemotePhlowSpawnObjectAction'
	instVarNames: #(targetObject)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeActions';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowSpawnObjectAction
removeallclassmethods GtRemotePhlowSpawnObjectAction

doit
(GtPhlowDeclarativeSpecification
	subclass: 'GtRemotePhlowViewedObjectClassSpecification'
	instVarNames: #(viewObjectClassName viewObjectInstanceVariableNames)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-InspectorCore';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowViewedObjectClassSpecification
removeallclassmethods GtRemotePhlowViewedObjectClassSpecification

doit
(Object
	subclass: 'GtPhlowRuns'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowRuns
removeallclassmethods GtPhlowRuns

doit
(GtPhlowRuns
	subclass: 'GtPhlowRunsGroup'
	instVarNames: #(items)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowRunsGroup
removeallclassmethods GtPhlowRunsGroup

doit
(Object
	subclass: 'GtPhlowText'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowText
removeallclassmethods GtPhlowText

doit
(GtPhlowText
	subclass: 'GtPhlowRunBasedText'
	instVarNames: #(sourceString attributeRuns)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowRunBasedText
removeallclassmethods GtPhlowRunBasedText

doit
(GtPhlowText
	subclass: 'GtPhlowSubText'
	instVarNames: #(parentText startIndex endIndex)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowSubText
removeallclassmethods GtPhlowSubText

doit
(Object
	subclass: 'GtPhlowTextAttribute'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowTextAttribute
removeallclassmethods GtPhlowTextAttribute

doit
(GtPhlowTextAttribute
	subclass: 'GtPhlowFontEmphasisAttribute'
	instVarNames: #(emphasis)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowFontEmphasisAttribute
removeallclassmethods GtPhlowFontEmphasisAttribute

doit
(GtPhlowTextAttribute
	subclass: 'GtPhlowFontNameAttribute'
	instVarNames: #(fontName)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowFontNameAttribute
removeallclassmethods GtPhlowFontNameAttribute

doit
(GtPhlowTextAttribute
	subclass: 'GtPhlowFontSizeAttribute'
	instVarNames: #(sizeValue)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowFontSizeAttribute
removeallclassmethods GtPhlowFontSizeAttribute

doit
(GtPhlowTextAttribute
	subclass: 'GtPhlowFontWeightAttribute'
	instVarNames: #(weight)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowFontWeightAttribute
removeallclassmethods GtPhlowFontWeightAttribute

doit
(GtPhlowTextAttribute
	subclass: 'GtPhlowTextColorAttribute'
	instVarNames: #(color)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowTextColorAttribute
removeallclassmethods GtPhlowTextColorAttribute

doit
(GtPhlowTextColorAttribute
	subclass: 'GtPhlowTextForegroundAttribute'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowTextForegroundAttribute
removeallclassmethods GtPhlowTextForegroundAttribute

doit
(GtPhlowTextColorAttribute
	subclass: 'GtPhlowTextHighlightAttribute'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowTextHighlightAttribute
removeallclassmethods GtPhlowTextHighlightAttribute

doit
(GtPhlowTextAttribute
	subclass: 'GtPhlowTextDecorationAttribute'
	instVarNames: #(decoration)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowTextDecorationAttribute
removeallclassmethods GtPhlowTextDecorationAttribute

doit
(GtPhlowTextAttribute
	subclass: 'GtPhlowTextUnknownAttribute'
	instVarNames: #(rawData)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowTextUnknownAttribute
removeallclassmethods GtPhlowTextUnknownAttribute

doit
(Object
	subclass: 'GtPhlowTextDecoration'
	instVarNames: #(thickness color styleName typeNames)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowTextDecoration
removeallclassmethods GtPhlowTextDecoration

doit
(Object
	subclass: 'GtPhlowTextHighlight'
	instVarNames: #(color startPosition endPosition)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtPhlowTextHighlight
removeallclassmethods GtPhlowTextHighlight

doit
(Object
	subclass: 'GtPhlowViewSpecification'
	instVarNames: #(phlowDataSource methodSelector title priority dataTransport)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		comment: '{{gtClass:GtPhlowViewSpecification}} provides a declarative UI specification for presenting data that can be easily serialised and sent over the wire, including between applications written in different languages.

A specification contains basic data about the view, like its title and priority, and a data source that handles the actual data of the view.
####Local and and remote instances

An instance of the specification is created remotely based on the remote view. That specification is serialized by sending it {{gtMethod:GtPhlowViewSpecification>>asJSONForExport|label=#selector}}, and based on it a new instance is created locally with the same data using {{gtMethod:GtPhlowViewSpecification class>>fromJSONString:|label=#selector}}. So there will be two instances of the specification, one remotely and one locally.

####Initializing the local instance

The initialisation of the local version of the specification is done in two steps. First, an instance is created and initialized using the initial JSON data. Second, on this instance the inspector calls {{gtMethod:GtPhlowViewSpecification>>initializeFromInspector:|label=#selector}}. 

This call exists so that the specification can initialize the `phlowDataSource` attributes. Views can initialize it with a local object, if all the data of the view was retrieved, or with a proxy to the remote data source.  

So while the local and remote instances of the specification have the same attributes, for the data source attribute the local version can have a proxy, and the remote version the actual object.

dataTransport is an emumerated value indicating whether the data to be displayed will be included with the specification or is available via reference or by key.]

- 1: data is included in the response
- 2: data is available by reference
- 3: data is available by reference and key (tbc)

####Creating local views

Subclasses should override {{gtMethod:GtPhlowViewSpecification>>viewFor:|label=#selector}}  for creating a  local views from a specification.

';
		immediateInvariant.
true.
%

removeallmethods GtPhlowViewSpecification
removeallclassmethods GtPhlowViewSpecification

doit
(GtPhlowViewSpecification
	subclass: 'GtPhlowEmptyViewSpecification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowEmptyViewSpecification
removeallclassmethods GtPhlowEmptyViewSpecification

doit
(GtPhlowViewSpecification
	subclass: 'GtPhlowForwardViewSpecification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowForwardViewSpecification
removeallclassmethods GtPhlowForwardViewSpecification

doit
(GtPhlowViewSpecification
	subclass: 'GtPhlowListingViewSpecification'
	instVarNames: #(totalItemsCount)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		comment: '{{gtClass:GtPhlowListingViewSpecification}} provides support for instantiating local list, tree and column views used to show the items in remote list, tree and column views.

When the remote side is in a different environment, in the local instance of the specification,  `phlowDataSource` is going to be a proxy providing the required API for accessing items in the view. 

When the remote side is Glamorous Toolkit, Pharo and GemStone, the data source is of type {{gtClass:GtRemotePhlowDeclarativeViewListingDataSource}} in the remote instance of the specification.';
		immediateInvariant.
true.
%

removeallmethods GtPhlowListingViewSpecification
removeallclassmethods GtPhlowListingViewSpecification

doit
(GtPhlowListingViewSpecification
	subclass: 'GtPhlowBasicColumnedViewSpecification'
	instVarNames: #(columnSpecifications)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowBasicColumnedViewSpecification
removeallclassmethods GtPhlowBasicColumnedViewSpecification

doit
(GtPhlowBasicColumnedViewSpecification
	subclass: 'GtPhlowColumnedListViewSpecification'
	instVarNames: #(horizontalScrollingEnabled)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		comment: 'GtDeclarativeColumnedList supports a subset of the possible configurations of {{gtClass:name=GtPhlowColumnedListView}}.

Current limitations:

- Only matchParent and fixed column widths are supported

# Internal Representation and Key Implementation Points.


## Instance Variables

	columnTitles:	<Array of String>
	columnWidths:	<Array of Integer|nil>
	items:				<Array of Array>	These are the formatted values to display, not the raw values to send

';
		immediateInvariant.
true.
%

removeallmethods GtPhlowColumnedListViewSpecification
removeallclassmethods GtPhlowColumnedListViewSpecification

doit
(GtPhlowBasicColumnedViewSpecification
	subclass: 'GtPhlowColumnedTreeViewSpecification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowColumnedTreeViewSpecification
removeallclassmethods GtPhlowColumnedTreeViewSpecification

doit
(GtPhlowListingViewSpecification
	subclass: 'GtPhlowListViewSpecification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		comment: '{{gtClass:GtPhlowListViewSpecification}}  provides the data needed to instantiate a local {{gtClass:name=GtPhlowListView}} used to show the items in a remote list view.

The `phlowDataSource` for a list view should provide the following API:
	- `retrieveItems:fromIndex:` returns  the concrete data for displaying a number of items from a certain index
	- `retrieveSentItemAt:` returns a proxy to the item at the given position

When the remote side is Glamorous Toolkit, GemStone or Pharo, in the local instane of the specification `phlowDataSource` is a proxy to an instance of type {{gtClass:GtRemotePhlowDeclarativeViewListDataSource}}. When using the simulation we get directly an instance of type {{gtClass:GtRemotePhlowDeclarativeViewListDataSource}} as the data source.';
		immediateInvariant.
true.
%

removeallmethods GtPhlowListViewSpecification
removeallclassmethods GtPhlowListViewSpecification

doit
(GtPhlowListingViewSpecification
	subclass: 'GtPhlowTreeViewSpecification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowTreeViewSpecification
removeallclassmethods GtPhlowTreeViewSpecification

doit
(GtPhlowViewSpecification
	subclass: 'GtPhlowTextualViewSpecification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowTextualViewSpecification
removeallclassmethods GtPhlowTextualViewSpecification

doit
(GtPhlowTextualViewSpecification
	subclass: 'GtPhlowTextEditorViewSpecification'
	instVarNames: #(string dataSource textStylerSpecification)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowTextEditorViewSpecification
removeallclassmethods GtPhlowTextEditorViewSpecification

doit
(GtPhlowTextualViewSpecification
	subclass: 'GtPhlowTextViewSpecification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowTextViewSpecification
removeallclassmethods GtPhlowTextViewSpecification

doit
(GtPhlowViewSpecification
	subclass: 'GtPhlowViewErrorViewSpecification'
	instVarNames: #(errorMessage)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtPhlowViewErrorViewSpecification
removeallclassmethods GtPhlowViewErrorViewSpecification

doit
(Object
	subclass: 'GtRemotePhlowAction'
	instVarNames: #(id priority tooltipText definingSelector definingClass)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowActions';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowAction
removeallclassmethods GtRemotePhlowAction

doit
(GtRemotePhlowAction
	subclass: 'GtRemotePhlowButtonAction'
	instVarNames: #(actionBlock label iconStencil)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowActions';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowButtonAction
removeallclassmethods GtRemotePhlowButtonAction

doit
(GtRemotePhlowAction
	subclass: 'GtRemotePhlowErrorAction'
	instVarNames: #(errorMessage)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowActions';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowErrorAction
removeallclassmethods GtRemotePhlowErrorAction

doit
(GtRemotePhlowAction
	subclass: 'GtRemotePhlowNoAction'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowActions';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowNoAction
removeallclassmethods GtRemotePhlowNoAction

doit
(Object
	subclass: 'GtRemotePhlowApiWrapper'
	instVarNames: #(currentAction)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeActions';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowApiWrapper
removeallclassmethods GtRemotePhlowApiWrapper

doit
(Object
	subclass: 'GtRemotePhlowCollectionIterator'
	instVarNames: #(targetCollection)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowCollectionIterator
removeallclassmethods GtRemotePhlowCollectionIterator

doit
(GtRemotePhlowCollectionIterator
	subclass: 'GtRemotePhlowSequenceableCollectionIterator'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowSequenceableCollectionIterator
removeallclassmethods GtRemotePhlowSequenceableCollectionIterator

doit
(GtRemotePhlowCollectionIterator
	subclass: 'GtRemotePhlowUnindexedCollectionIterator'
	instVarNames: #(iterationSelector)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowUnindexedCollectionIterator
removeallclassmethods GtRemotePhlowUnindexedCollectionIterator

doit
(GtRemotePhlowUnindexedCollectionIterator
	subclass: 'GtRemotePhlowDictionaryAssociationsIterator'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDictionaryAssociationsIterator
removeallclassmethods GtRemotePhlowDictionaryAssociationsIterator

doit
(GtRemotePhlowUnindexedCollectionIterator
	subclass: 'GtRemotePhlowDictionaryKeysIterator'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDictionaryKeysIterator
removeallclassmethods GtRemotePhlowDictionaryKeysIterator

doit
(GtRemotePhlowUnindexedCollectionIterator
	subclass: 'GtRemotePhlowGenericCollectionIterator'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowGenericCollectionIterator
removeallclassmethods GtRemotePhlowGenericCollectionIterator

doit
(GtRemotePhlowUnindexedCollectionIterator
	subclass: 'GtRemotePhlowPluggableCollectionIterator'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowPluggableCollectionIterator
removeallclassmethods GtRemotePhlowPluggableCollectionIterator

doit
(Object
	subclass: 'GtRemotePhlowColumn'
	instVarNames: #(index title width itemComputation backgroundComputation)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowColumn
removeallclassmethods GtRemotePhlowColumn

doit
(GtRemotePhlowColumn
	subclass: 'GtRemotePhlowExplicitColumn'
	instVarNames: #(spawnObjectComputation type)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowExplicitColumn
removeallclassmethods GtRemotePhlowExplicitColumn

doit
(GtRemotePhlowColumn
	subclass: 'GtRemotePhlowTypedColumn'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowTypedColumn
removeallclassmethods GtRemotePhlowTypedColumn

doit
(GtRemotePhlowTypedColumn
	subclass: 'GtRemotePhlowIconNameColumn'
	instVarNames: #(iconNameComputation)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowIconNameColumn
removeallclassmethods GtRemotePhlowIconNameColumn

doit
(GtRemotePhlowIconNameColumn
	subclass: 'GtRemotePhlowThemeIconNameColumn'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowThemeIconNameColumn
removeallclassmethods GtRemotePhlowThemeIconNameColumn

doit
(GtRemotePhlowTypedColumn
	subclass: 'GtRemotePhlowNumberColumn'
	instVarNames: #(formatComputation)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowNumberColumn
removeallclassmethods GtRemotePhlowNumberColumn

doit
(GtRemotePhlowTypedColumn
	subclass: 'GtRemotePhlowTextColumn'
	instVarNames: #(formatComputation)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowTextColumn
removeallclassmethods GtRemotePhlowTextColumn

doit
(Object
	subclass: 'GtRemotePhlowColumnSpecification'
	instVarNames: #(title cellWidth type spawnsObjects properties)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowColumnSpecification
removeallclassmethods GtRemotePhlowColumnSpecification

doit
(Object
	subclass: 'GtRemotePhlowDataNode'
	instVarNames: #(targetObject nodeId nodeValue)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDataNode
removeallclassmethods GtRemotePhlowDataNode

doit
(GtRemotePhlowDataNode
	subclass: 'GtRemotePhlowTreeNode'
	instVarNames: #(childNodes parentNode)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowTreeNode
removeallclassmethods GtRemotePhlowTreeNode

doit
(GtRemotePhlowTreeNode
	subclass: 'GtRemotePhlowColumnedTreeNode'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowColumnedTreeNode
removeallclassmethods GtRemotePhlowColumnedTreeNode

doit
(Object
	subclass: 'GtRemotePhlowDeclarativeActionDataSource'
	instVarNames: #(phlowAction)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeActions';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeActionDataSource
removeallclassmethods GtRemotePhlowDeclarativeActionDataSource

doit
(GtRemotePhlowDeclarativeActionDataSource
	subclass: 'GtRemotePhlowDeclarativeBlockActionDataSource'
	instVarNames: #(targetBlock)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeActions';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeBlockActionDataSource
removeallclassmethods GtRemotePhlowDeclarativeBlockActionDataSource

doit
(Object
	subclass: 'GtRemotePhlowDeclarativeErrorTestInspectable'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeErrorTestInspectable
removeallclassmethods GtRemotePhlowDeclarativeErrorTestInspectable

doit
(Object
	subclass: 'GtRemotePhlowDeclarativeExamples'
	instVarNames: #(server)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeExamples
removeallclassmethods GtRemotePhlowDeclarativeExamples

doit
(GtRemotePhlowDeclarativeExamples
	subclass: 'GtRemotePhlowDeclarativeActionsExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeActionsExamples
removeallclassmethods GtRemotePhlowDeclarativeActionsExamples

doit
(GtRemotePhlowDeclarativeActionsExamples
	subclass: 'GtRemotePhlowDeclarativeActionsDirectViewedObjectExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeActionsDirectViewedObjectExamples
removeallclassmethods GtRemotePhlowDeclarativeActionsDirectViewedObjectExamples

doit
(GtRemotePhlowDeclarativeActionsDirectViewedObjectExamples
	subclass: 'GtRemotePhlowDeclarativeActionsLocalViewedObjectExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeActionsLocalViewedObjectExamples
removeallclassmethods GtRemotePhlowDeclarativeActionsLocalViewedObjectExamples

doit
(GtRemotePhlowDeclarativeActionsDirectViewedObjectExamples
	subclass: 'GtRemotePhlowDeclarativeActionsRemoteViewedObjectExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeActionsRemoteViewedObjectExamples
removeallclassmethods GtRemotePhlowDeclarativeActionsRemoteViewedObjectExamples

doit
(GtRemotePhlowDeclarativeActionsExamples
	subclass: 'GtRemotePhlowDeclarativeActionsProxySimulationExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeActionsProxySimulationExamples
removeallclassmethods GtRemotePhlowDeclarativeActionsProxySimulationExamples

doit
(GtRemotePhlowDeclarativeExamples
	subclass: 'GtRemotePhlowDeclarativeViewsExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		comment: 'GtRemoteDeclarativeGtExamples demonstrates the use of declarative views in Gtoolkit.

This class runs the examples within the one image, and thus can be run without any external server setup.  Subclasses overwrite various methods to run the examples connecting to the remote server.';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeViewsExamples
removeallclassmethods GtRemotePhlowDeclarativeViewsExamples

doit
(GtRemotePhlowDeclarativeViewsExamples
	subclass: 'GtRemotePhlowDeclarativeViewsDirectViewedObjectExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeViewsDirectViewedObjectExamples
removeallclassmethods GtRemotePhlowDeclarativeViewsDirectViewedObjectExamples

doit
(GtRemotePhlowDeclarativeViewsDirectViewedObjectExamples
	subclass: 'GtRemotePhlowDeclarativeViewsLocalViewedObjectExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeViewsLocalViewedObjectExamples
removeallclassmethods GtRemotePhlowDeclarativeViewsLocalViewedObjectExamples

doit
(GtRemotePhlowDeclarativeViewsDirectViewedObjectExamples
	subclass: 'GtRemotePhlowDeclarativeViewsRemoteViewedObjectExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeViewsRemoteViewedObjectExamples
removeallclassmethods GtRemotePhlowDeclarativeViewsRemoteViewedObjectExamples

doit
(GtRemotePhlowDeclarativeViewsExamples
	subclass: 'GtRemotePhlowDeclarativeViewsProxySimulationExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeViewsProxySimulationExamples
removeallclassmethods GtRemotePhlowDeclarativeViewsProxySimulationExamples

doit
(Object
	subclass: 'GtRemotePhlowDeclarativeTestForCustomProxyInspectable'
	instVarNames: #(collectionOfObjects)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeTestForCustomProxyInspectable
removeallclassmethods GtRemotePhlowDeclarativeTestForCustomProxyInspectable

doit
(Object
	subclass: 'GtRemotePhlowDeclarativeTestInspectable'
	instVarNames: #(string collectionOfObjects)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		comment: 'GtDeclarativeTestInspectable is a simple object that can be used to test the Gt declarative views. 

 
## Internal Representation and Key Implementation Points.

### Instance Variables

	collectionOfObjects:		<Array>  a collection of objects for displaying in lists
	string:		<String> for displaying in a text view

';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeTestInspectable
removeallclassmethods GtRemotePhlowDeclarativeTestInspectable

doit
(Object
	subclass: 'GtRemotePhlowDeclarativeTestWithViewIncrement'
	instVarNames: #(counter)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeTestWithViewIncrement
removeallclassmethods GtRemotePhlowDeclarativeTestWithViewIncrement

doit
(Object
	subclass: 'GtRemotePhlowDeclarativeTextTestInspectable'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeTextTestInspectable
removeallclassmethods GtRemotePhlowDeclarativeTextTestInspectable

doit
(Object
	subclass: 'GtRemotePhlowDeclarativeTreeExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeTreeExamples
removeallclassmethods GtRemotePhlowDeclarativeTreeExamples

doit
(Object
	subclass: 'GtRemotePhlowDeclarativeViewDataSource'
	instVarNames: #(phlowView)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeViewDataSource
removeallclassmethods GtRemotePhlowDeclarativeViewDataSource

doit
(GtRemotePhlowDeclarativeViewDataSource
	subclass: 'GtRemotePhlowDeclarativeForwardViewDataSource'
	instVarNames: #(cachedViewSpecification)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeForwardViewDataSource
removeallclassmethods GtRemotePhlowDeclarativeForwardViewDataSource

doit
(GtRemotePhlowDeclarativeViewDataSource
	subclass: 'GtRemotePhlowDeclarativeTextualViewDataSource'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeTextualViewDataSource
removeallclassmethods GtRemotePhlowDeclarativeTextualViewDataSource

doit
(GtRemotePhlowDeclarativeViewDataSource
	subclass: 'GtRemotePhlowDeclarativeViewListingDataSource'
	instVarNames: #(itemsIterator cachedNodes cachedValueBuilder)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeViewListingDataSource
removeallclassmethods GtRemotePhlowDeclarativeViewListingDataSource

doit
(GtRemotePhlowDeclarativeViewListingDataSource
	subclass: 'GtRemotePhlowDeclarativeViewColumnedListDataSource'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeViewColumnedListDataSource
removeallclassmethods GtRemotePhlowDeclarativeViewColumnedListDataSource

doit
(GtRemotePhlowDeclarativeViewListingDataSource
	subclass: 'GtRemotePhlowDeclarativeViewListDataSource'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeViewListDataSource
removeallclassmethods GtRemotePhlowDeclarativeViewListDataSource

doit
(GtRemotePhlowDeclarativeViewListingDataSource
	subclass: 'GtRemotePhlowDeclarativeViewTreeDataSource'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeViewTreeDataSource
removeallclassmethods GtRemotePhlowDeclarativeViewTreeDataSource

doit
(GtRemotePhlowDeclarativeViewTreeDataSource
	subclass: 'GtRemotePhlowDeclarativeViewColumnedTreeDataSource'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDeclarativeViewColumnedTreeDataSource
removeallclassmethods GtRemotePhlowDeclarativeViewColumnedTreeDataSource

doit
(Object
	subclass: 'GtRemotePhlowDummyTextStyler'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowDummyTextStyler
removeallclassmethods GtRemotePhlowDummyTextStyler

doit
(Object
	subclass: 'GtRemotePhlowNodeValue'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowNodeValue
removeallclassmethods GtRemotePhlowNodeValue

doit
(GtRemotePhlowNodeValue
	subclass: 'GtRemotePhlowItemValue'
	instVarNames: #(background)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowItemValue
removeallclassmethods GtRemotePhlowItemValue

doit
(GtRemotePhlowItemValue
	subclass: 'GtRemotePhlowItemTextualValue'
	instVarNames: #(itemText)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowItemTextualValue
removeallclassmethods GtRemotePhlowItemTextualValue

doit
(GtRemotePhlowItemTextualValue
	subclass: 'GtRemotePhlowItemErrorValue'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		comment: 'I am a node modeling an error that happened during the computation';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowItemErrorValue
removeallclassmethods GtRemotePhlowItemErrorValue

doit
(GtRemotePhlowNodeValue
	subclass: 'GtRemotePhlowRowValue'
	instVarNames: #(columnValues)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowRowValue
removeallclassmethods GtRemotePhlowRowValue

doit
(Object
	subclass: 'GtRemotePhlowNodeValueBuilder'
	instVarNames: #(phlowView)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowNodeValueBuilder
removeallclassmethods GtRemotePhlowNodeValueBuilder

doit
(GtRemotePhlowNodeValueBuilder
	subclass: 'GtRemotePhlowItemBuilder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowItemBuilder
removeallclassmethods GtRemotePhlowItemBuilder

doit
(GtRemotePhlowNodeValueBuilder
	subclass: 'GtRemotePhlowRowBuilder'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowRowBuilder
removeallclassmethods GtRemotePhlowRowBuilder

doit
(Object
	subclass: 'GtRemotePhlowProtoView'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowProtoView
removeallclassmethods GtRemotePhlowProtoView

doit
(GtRemotePhlowProtoView
	subclass: 'GtRemotePhlowView'
	instVarNames: #(title priority definingSelector definingClass)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		comment: 'GtDeclarativeView provides a declarative UI specification for presenting data that can be easily serialised and sent over the wire, including between applications written in different languages.

dataTransport is an emumerated value indicating whether the data to be displayed will be included with the specification or is available via reference or by key.]

- 1: data is included in the response
- 2: data is available by reference
- 3: data is available by reference and key (tbc)


Public API and Key Messages

- message one   
- message two 
- (for bonus points) how to create instances.

   One simple example is simply gorgeous.
 
Internal Representation and Key Implementation Points.

    Instance Variables
	dataTransport:		<Object>


    Implementation Points';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowView
removeallclassmethods GtRemotePhlowView

doit
(GtRemotePhlowView
	subclass: 'GtRemotePhlowEmptyView'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowEmptyView
removeallclassmethods GtRemotePhlowEmptyView

doit
(GtRemotePhlowView
	subclass: 'GtRemotePhlowForwarderView'
	instVarNames: #(viewSelector objectComputation transformation isDeclarative)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowForwarderView
removeallclassmethods GtRemotePhlowForwarderView

doit
(GtRemotePhlowView
	subclass: 'GtRemotePhlowListingView'
	instVarNames: #(itemsProviderComputation transformation)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowListingView
removeallclassmethods GtRemotePhlowListingView

doit
(GtRemotePhlowListingView
	subclass: 'GtRemotePhlowBasicColumnedView'
	instVarNames: #(columns)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		comment: 'I provide functionality for working with columns.';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowBasicColumnedView
removeallclassmethods GtRemotePhlowBasicColumnedView

doit
(GtRemotePhlowBasicColumnedView
	subclass: 'GtRemotePhlowColumnedListView'
	instVarNames: #(horizontalScrollingEnabled)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		comment: 'I support a subset of the possible configurations of {{gtClass:name=GtPhlowColumnedListView}}.

Current limitations:

- Only matchParent and fixed column widths are supported';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowColumnedListView
removeallclassmethods GtRemotePhlowColumnedListView

doit
(GtRemotePhlowBasicColumnedView
	subclass: 'GtRemotePhlowColumnedTreeView'
	instVarNames: #(itemTextBlock childrenBuilder)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		comment: 'I support a subset of the possible configurations of {{gtClass:name=GtPhlowColumnedTreeView}}.

I subclass from {{gtClass:GtRemotePhlowBasicColumnedView}} to reuse the functionality for working with columns and duplicate the API for working with trees from {{gtClass:GtRemotePhlowTreeView}}. This happens in order to also work in GemStone where traits are not available.  Views in the Phlow version targeting the standard GT image  (subclassing {{gtClass:GtPhlowViewDecorator}}) use traits so share a common API. Since traits are not available in GemStone we rely on inheritance. We share the columns API through inheritance instead of the tree api, as the tree API is simpler and does not result in that much duplication.';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowColumnedTreeView
removeallclassmethods GtRemotePhlowColumnedTreeView

doit
(GtRemotePhlowListingView
	subclass: 'GtRemotePhlowListView'
	instVarNames: #(itemTextBlock)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		comment: 'GtDeclarativeList supports a subset of the possible configurations of {{gtClass:name=GtPhlowListView}}.

 
## Internal Representation and Key Implementation Points.

### Instance Variables
	itemsBuilder: 	{{gtClass:BlockClosure}} - A BlockClosure that will return the (unformatted) list of items to be displayed.
	items:				{{gtClass:Array}} - The formatted items to display (not the raw values held in the list)
	itemTextBlock: 	{{gtClass:BlockClosure}} - A BlockClosure (or Symbol) that converts each item to its displayed format.  The result of the BlockClosure must be a JSON primitive type, effectively a string or number.


### Implementation Points
';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowListView
removeallclassmethods GtRemotePhlowListView

doit
(GtRemotePhlowListingView
	subclass: 'GtRemotePhlowTreeView'
	instVarNames: #(itemTextBlock childrenBuilder)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		comment: 'GtPharoDeclarativeTree maps to GtPhlowTreeView in Gt.

When transporting the data, each node in the tree is represented as an Array with three slots:
1. The item''s textual representation
2. The index.  This is an array of indices to the nodes location.
3. An Array of child nodes.
';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowTreeView
removeallclassmethods GtRemotePhlowTreeView

doit
(GtRemotePhlowView
	subclass: 'GtRemotePhlowTextualView'
	instVarNames: #(textBuilder)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowTextualView
removeallclassmethods GtRemotePhlowTextualView

doit
(GtRemotePhlowTextualView
	subclass: 'GtRemotePhlowTextEditorView'
	instVarNames: #(stylerSpecification)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowTextEditorView
removeallclassmethods GtRemotePhlowTextEditorView

doit
(GtRemotePhlowTextualView
	subclass: 'GtRemotePhlowTextView'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowTextView
removeallclassmethods GtRemotePhlowTextView

doit
(GtRemotePhlowView
	subclass: 'GtRemotePhlowViewErrorView'
	instVarNames: #(errorMessage)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowViewErrorView
removeallclassmethods GtRemotePhlowViewErrorView

doit
(Object
	subclass: 'GtRemotePhlowSendObjectTransformation'
	instVarNames: #(valuable)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-PhlowViews';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowSendObjectTransformation
removeallclassmethods GtRemotePhlowSendObjectTransformation

doit
(Object
	subclass: 'GtRemotePhlowSpawnObjectWrapper'
	instVarNames: #(targetObject)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-DeclarativeActions';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowSpawnObjectWrapper
removeallclassmethods GtRemotePhlowSpawnObjectWrapper

doit
(Object
	subclass: 'GtRemotePhlowSpecificationConversionExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowSpecificationConversionExamples
removeallclassmethods GtRemotePhlowSpecificationConversionExamples

doit
(GtRemotePhlowSpecificationConversionExamples
	subclass: 'GtRemotePhlowActionSpecificationConversionExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowActionSpecificationConversionExamples
removeallclassmethods GtRemotePhlowActionSpecificationConversionExamples

doit
(GtRemotePhlowSpecificationConversionExamples
	subclass: 'GtRemotePhlowViewSpecificationConversionExamples'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Examples';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowViewSpecificationConversionExamples
removeallclassmethods GtRemotePhlowViewSpecificationConversionExamples

doit
(Object
	subclass: 'GtRemotePhlowStylableText'
	instVarNames: #(string stylerSpecification highlight)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowStylableText
removeallclassmethods GtRemotePhlowStylableText

doit
(Object
	subclass: 'GtRemotePhlowTextStylerSpecification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowTextStylerSpecification
removeallclassmethods GtRemotePhlowTextStylerSpecification

doit
(GtRemotePhlowTextStylerSpecification
	subclass: 'GtRemotePhlowTextAttributeRunsStylerSpecification'
	instVarNames: #(attributeRuns)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowTextAttributeRunsStylerSpecification
removeallclassmethods GtRemotePhlowTextAttributeRunsStylerSpecification

doit
(GtRemotePhlowTextStylerSpecification
	subclass: 'GtRemotePhlowTextNamedStylerSpecification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowTextNamedStylerSpecification
removeallclassmethods GtRemotePhlowTextNamedStylerSpecification

doit
(GtRemotePhlowTextNamedStylerSpecification
	subclass: 'GtRemotePhlowTextClassStylerSpecification'
	instVarNames: #(stylerClassName)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowTextClassStylerSpecification
removeallclassmethods GtRemotePhlowTextClassStylerSpecification

doit
(GtRemotePhlowTextNamedStylerSpecification
	subclass: 'GtRemotePhlowTextParserStylerSpecification'
	instVarNames: #(parserClassName)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowTextParserStylerSpecification
removeallclassmethods GtRemotePhlowTextParserStylerSpecification

doit
(GtRemotePhlowTextStylerSpecification
	subclass: 'GtRemotePhlowTextNullStylerSpecification'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowTextNullStylerSpecification
removeallclassmethods GtRemotePhlowTextNullStylerSpecification

doit
(GtRemotePhlowTextStylerSpecification
	subclass: 'GtRemoteTextStylerComputableSpecification'
	instVarNames: #(stylerComputation)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-Text';
		immediateInvariant.
true.
%

removeallmethods GtRemoteTextStylerComputableSpecification
removeallclassmethods GtRemoteTextStylerComputableSpecification

doit
(Object
	subclass: 'GtRemotePhlowViewedObject'
	instVarNames: #(object actionSpecificationsBySelector viewSpecificationsBySelector)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-InspectorCore';
		comment: '{{gtClass:GtRemotePhlowViewedObject}} is responsible for serving serialized views to the client inspector.';
		immediateInvariant.
true.
%

removeallmethods GtRemotePhlowViewedObject
removeallclassmethods GtRemotePhlowViewedObject

doit
(Object
	subclass: 'GtRmGeoGpsGroup'
	instVarNames: #(items cache)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-GeolifeDemo';
		immediateInvariant.
true.
%

removeallmethods GtRmGeoGpsGroup
removeallclassmethods GtRmGeoGpsGroup

doit
(GtRmGeoGpsGroup
	subclass: 'GtRmGeoGpsRecordsGroup'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-GeolifeDemo';
		immediateInvariant.
true.
%

removeallmethods GtRmGeoGpsRecordsGroup
removeallclassmethods GtRmGeoGpsRecordsGroup

doit
(GtRmGeoGpsGroup
	subclass: 'GtRmGeoGpsTrajectoriesGroup'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-GeolifeDemo';
		immediateInvariant.
true.
%

removeallmethods GtRmGeoGpsTrajectoriesGroup
removeallclassmethods GtRmGeoGpsTrajectoriesGroup

doit
(GtRmGeoGpsGroup
	subclass: 'GtRmGeoGpsUsersGroup'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-GeolifeDemo';
		immediateInvariant.
true.
%

removeallmethods GtRmGeoGpsUsersGroup
removeallclassmethods GtRmGeoGpsUsersGroup

doit
(Object
	subclass: 'GtRmGeoGpsRecord'
	instVarNames: #(timestamp latitude longitude)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-GeolifeDemo';
		immediateInvariant.
true.
%

removeallmethods GtRmGeoGpsRecord
removeallclassmethods GtRmGeoGpsRecord

doit
(Object
	subclass: 'GtRmGeoGpsTrajectory'
	instVarNames: #(records targetFolderName)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-GeolifeDemo';
		immediateInvariant.
true.
%

removeallmethods GtRmGeoGpsTrajectory
removeallclassmethods GtRmGeoGpsTrajectory

doit
(Object
	subclass: 'GtRmGeolife'
	instVarNames: #(users)
	classVars: #(DEFAULT)
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-GeolifeDemo';
		immediateInvariant.
true.
%

removeallmethods GtRmGeolife
removeallclassmethods GtRmGeolife

doit
(Object
	subclass: 'GtRmGeolifeBaseImporter'
	instVarNames: #(currentDirectory usersCount)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-GeolifeDemo';
		immediateInvariant.
true.
%

removeallmethods GtRmGeolifeBaseImporter
removeallclassmethods GtRmGeolifeBaseImporter

doit
(GtRmGeolifeBaseImporter
	subclass: 'GtRmGeolifeLocalImporter'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-GeolifeDemo';
		immediateInvariant.
true.
%

removeallmethods GtRmGeolifeLocalImporter
removeallclassmethods GtRmGeolifeLocalImporter

doit
(Object
	subclass: 'GtRmGeoUser'
	instVarNames: #(trajectories id)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-GeolifeDemo';
		immediateInvariant.
true.
%

removeallmethods GtRmGeoUser
removeallclassmethods GtRmGeoUser

doit
(Object
	subclass: 'GtRmMovie'
	instVarNames: #(rawData propertyNames)
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-MoviesDemo';
		immediateInvariant.
true.
%

removeallmethods GtRmMovie
removeallclassmethods GtRmMovie

doit
(Object
	subclass: 'GtRmMovieCollection'
	instVarNames: #(rawData propertyNames)
	classVars: #(DEFAULT)
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-MoviesDemo';
		immediateInvariant.
true.
%

removeallmethods GtRmMovieCollection
removeallclassmethods GtRmMovieCollection

doit
(Object
	subclass: 'GtRsrInspectorProxySerializationStrategy'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-InspectorCore';
		immediateInvariant.
true.
%

removeallmethods GtRsrInspectorProxySerializationStrategy
removeallclassmethods GtRsrInspectorProxySerializationStrategy

doit
(GtRsrInspectorProxySerializationStrategy
	subclass: 'GtRsrInspectorProxyDataSerializationStrategy'
	instVarNames: #()
	classVars: #()
	classInstVars: #()
	poolDictionaries: #()
	inDictionary: GsEnhancedInspector
	options: #( #logCreation )
)
		category: 'GToolkit-RemotePhlow-InspectorCore';
		immediateInvariant.
true.
%

removeallmethods GtRsrInspectorProxyDataSerializationStrategy
removeallclassmethods GtRsrInspectorProxyDataSerializationStrategy

! Class implementation for 'GtPhlowBasicRun'

!		Class methods for 'GtPhlowBasicRun'

category: 'instance creation'
classmethod: GtPhlowBasicRun
from: aStartIndex to: aEndIndex attributes: aCollectionOfAttributes
	^ self new 
		initializeFrom: aStartIndex to: aEndIndex attributes: aCollectionOfAttributes
%

category: 'instance creation'
classmethod: GtPhlowBasicRun
fromJSONDictionary: aTextStylerData 
	| typeLabel attributesClass |
 	typeLabel := aTextStylerData at: '__typeLabel'.
			
	typeLabel = GtPhlowRun typeLabel ifTrue: [
 		attributesClass :=  GtPhlowRun ].
		
	^ attributesClass 
		ifNil: [ nil ]
		ifNotNil: [
			attributesClass new  
				initializeFromJSONDictionary: aTextStylerData ]
%

category: 'accessing'
classmethod: GtPhlowBasicRun
typeLabel
	^ '<missing>'
%

!		Instance methods for 'GtPhlowBasicRun'

category: 'styling'
method: GtPhlowBasicRun
applyStyleToText: aText
	self subclassResponsibility
%

category: 'accessing'
method: GtPhlowBasicRun
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation.
	Subclasses will override and add to the dictionary"

	^ Dictionary new 
		at: '__typeLabel' put: self class typeLabel;
		yourself
%

category: 'initialization'
method: GtPhlowBasicRun
initializeFrom: aStartIndex to: aEndIndex attributes: aCollectionOfAttributes 
	self subclassResponsibility
%

! Class implementation for 'GtPhlowRun'

!		Class methods for 'GtPhlowRun'

category: 'instance creation'
classmethod: GtPhlowRun
fromJSONDictionary: anAttributeData 
	^ self new  
		initializeFromJSONDictionary: anAttributeData
%

category: 'accessing'
classmethod: GtPhlowRun
typeLabel
	^ 'phlowRun'
%

!		Instance methods for 'GtPhlowRun'

category: 'comparing'
method: GtPhlowRun
= anObject
	
	self == anObject
		ifTrue: [ ^ true ].
	(anObject class = self class)
		ifFalse: [ ^ false ].

	^ (self startIndex = anObject startIndex) and: [
		self endIndex = anObject endIndex and: [ 
			self attributes = anObject attributes ] ]
%

category: 'accessing'
method: GtPhlowRun
addAttribute: anAttribute
	self attributes add: anAttribute
%

category: 'styling'
method: GtPhlowRun
applyStyleToText: aText
	| subText |
	subText := aText from: startIndex to: endIndex.
	attributes do: [ :anAttribute |
		anAttribute applyStyleToText: subText ]
%

category: 'converting'
method: GtPhlowRun
asDictionaryForExport

	^ super asDictionaryForExport
		at: 'startIndex' put: startIndex;
		at: 'endIndex' put: endIndex;
		at: 'attributes' put: (attributes collect: [ :anAttribute |
			anAttribute asDictionaryForExport ]) asArray;
		yourself
%

category: 'accessing'
method: GtPhlowRun
attributes
	^ attributes
%

category: 'accessing'
method: GtPhlowRun
attributes: aCollection
	attributes := aCollection asOrderedCollection
%

category: 'printing'
method: GtPhlowRun
attributesDescription
	^ String streamContents: [ :aStream |
		self attributesDescriptionOn: aStream ]
%

category: 'printing'
method: GtPhlowRun
attributesDescriptionOn: aStream 
	self attributes 
		do: [ :anAttribute |
			aStream << anAttribute printString ] 
		separatedBy: [ aStream << ' ']
%

category: 'copying'
method: GtPhlowRun
copyFrom: aStartIndex to: anEndIndex
	^ self class
		from: (aStartIndex max: startIndex) - aStartIndex + 1
		to: (anEndIndex min: endIndex) - aStartIndex + 1
		attributes: attributes  copy
%

category: 'accessing'
method: GtPhlowRun
endIndex
	^ endIndex
%

category: 'accessing'
method: GtPhlowRun
gtViewAttributesFor: aView 
	<gtView>
	
	^ aView columnedList 
		title: 'Attributes';
		items: [ self attributes ];
		column: 'Attribute' text: [ :anAttribute | anAttribute printString];
		column: 'Range ' text: [ :_ | self rangeDescription ]
%

category: 'comparing'
method: GtPhlowRun
hash

	^ (self startIndex hash 
		bitXor: self endIndex hash)
		bitXor: self attributes hash
%

category: 'initialization'
method: GtPhlowRun
initializeFrom: aStartIndex to: aEndIndex attributes: aCollectionOfAttributes 
	startIndex := aStartIndex.
	endIndex := aEndIndex.
	self attributes: aCollectionOfAttributes.
%

category: 'initialization'
method: GtPhlowRun
initializeFromJSONDictionary: aRunData
	self 
		initializeFrom: (aRunData at: 'startIndex')
		to: (aRunData at: 'endIndex')
		attributes: ((aRunData at: 'attributes') collect: [ :anAttributeData |
			GtPhlowTextAttribute fromJSONDictionary: anAttributeData ]) 
%

category: 'printing'
method: GtPhlowRun
printOn: aStream
	self rangeDescriptionOn:  aStream.
	aStream << ': '.
	self attributesDescriptionOn: aStream 
%

category: 'printing'
method: GtPhlowRun
rangeDescription
	^ String streamContents: [ :aStream |
		 self rangeDescriptionOn: aStream ]
%

category: 'printing'
method: GtPhlowRun
rangeDescriptionOn: aStream
	aStream 
		print: startIndex;
		<< '-';
		print: endIndex
%

category: 'accessing'
method: GtPhlowRun
startIndex
	^ startIndex
%

! Class implementation for 'GtPhlowColor'

!		Class methods for 'GtPhlowColor'

category: 'instance creation'
classmethod: GtPhlowColor
fromJSONDictionary: aDictionary
	"Answer an instance of the receiver from the supplied dictionary."

	^self new 
		named: (aDictionary at: #name ifAbsent: [ nil ]);
		r: (aDictionary at: #r ifAbsent: [ nil ])
			g: (aDictionary at: #g ifAbsent: [ nil ])
			b: (aDictionary at: #b ifAbsent: [ nil ])
			alpha: (aDictionary at: #a ifAbsent: [ nil ]);
		yourself
%

category: 'instance creation'
classmethod: GtPhlowColor
named: aColorName
	^ self new 
		named: aColorName
%

category: 'instance creation'
classmethod: GtPhlowColor
named: aColorName alpha: anAlpha
	^ self new 
		named: aColorName alpha: anAlpha
%

category: 'instance creation'
classmethod: GtPhlowColor
r: r g: g b: b 
	^ self new 
		r: r g: g b: b alpha: nil
%

category: 'instance creation'
classmethod: GtPhlowColor
r: r g: g b: b alpha: alpha
	^ self new 
		r: r g: g b: b alpha: alpha
%

category: 'accessing - defaults'
classmethod: GtPhlowColor
transparent
	^ self named: #transparent
%

!		Instance methods for 'GtPhlowColor'

category: 'comparing'
method: GtPhlowColor
= anObject
	"For now make this equal only to instances of other phlow colors"
	<return: #Boolean>
	
	self == anObject
		ifTrue: [ ^ true ].
	(anObject class = self class)
		ifFalse: [ ^ false ].

	^ self red = anObject red and: [
		self green = anObject green and: [
			self blue = anObject blue and: [
				self alpha = anObject alpha and: [
					self name = anObject name ] ] ] ]
%

category: 'accessing'
method: GtPhlowColor
alpha
	^ alpha ifNil: [ 0 ]
%

category: 'accessing'
method: GtPhlowColor
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation"

	| data| 
	data := Dictionary new 
		yourself.
		
	name ifNotNil: [ :aValue |
		data at: #name put: aValue ].
	red ifNotNil: [ :aValue |
		data at: #r put: aValue ].
	green ifNotNil: [ :aValue |
		data at: #g put: aValue ].
	blue ifNotNil: [ :aValue |
		data at: #b put: aValue ].
	alpha ifNotNil: [ :aValue |
		data at: #a put: aValue ].
	
	^ data
%

category: 'accessing'
method: GtPhlowColor
blue
	^ blue
%

category: 'accessing'
method: GtPhlowColor
green
	^ green
%

category: 'comparing'
method: GtPhlowColor
hash

	^ self red hash 
		bitXor: (self green hash 
		bitXor: (self blue hash 
		bitXor: (self alpha hash 
		bitXor: self name hash )))
%

category: 'testing'
method: GtPhlowColor
isColor
	^ true
%

category: 'testing'
method: GtPhlowColor
isTransparent
	^ alpha = 0 or: [ name= #transparent ]
%

category: 'accessing'
method: GtPhlowColor
name
	^ name
%

category: 'accessing'
method: GtPhlowColor
named: aColorName
	name := aColorName
%

category: 'accessing'
method: GtPhlowColor
named: aColorName alpha: anAlpha
	name := aColorName.
	alpha := anAlpha
%

category: 'printing'
method: GtPhlowColor
printOn: aStream
	super printOn: aStream.
	
	aStream parenthesize: [
		self isTransparent ifTrue: [ 
			^ aStream nextPutAll: 'transparent' ].
		name ifNotNil: [
			^ aStream nextPutAll: name ].
			
	aStream
		nextPutAll: ' r: ';
		print: red;
		nextPutAll: ' g: ';
		print: green;
		nextPutAll: ' b: ';
		print: blue;
		nextPutAll: ' alpha: ';
		print: alpha]
%

category: 'accessing'
method: GtPhlowColor
r: r g: g b: b alpha: anAlpha
	red := r.
	green := g.
	blue := b.
	alpha := anAlpha
%

category: 'accessing'
method: GtPhlowColor
red
	^ red
%

! Class implementation for 'GtPhlowDeclarativeListingType'

!		Class methods for 'GtPhlowDeclarativeListingType'

category: 'instance creation'
classmethod: GtPhlowDeclarativeListingType
forTypeLabel: aValue 
	^ self allSubclasses
		detect: [ :aSubclass |
			aSubclass typeLabel = aValue ]
		ifFound: [ :aSubclass | aSubclass new ]
		ifNone: [ self unknown ]
%

category: 'types creation'
classmethod: GtPhlowDeclarativeListingType
iconName
	^ GtPhlowThemeIconNameDeclarativeListingType new
%

category: 'types creation'
classmethod: GtPhlowDeclarativeListingType
number
	^ GtPhlowNumberDeclarativeListingType new
%

category: 'types creation'
classmethod: GtPhlowDeclarativeListingType
text
	^ GtPhlowTextDeclarativeListingType new
%

category: 'types creation'
classmethod: GtPhlowDeclarativeListingType
textLink
	^ GtPhlowTextLinkDeclarativeListingType new
%

category: 'accessing'
classmethod: GtPhlowDeclarativeListingType
typeLabel
	^ 'listing type'
%

category: 'types creation'
classmethod: GtPhlowDeclarativeListingType
unknown
	^ GtPhlowUnknownDeclarativeListingType new
%

!		Instance methods for 'GtPhlowDeclarativeListingType'

category: 'testing'
method: GtPhlowDeclarativeListingType
isTextLinkListingType
	^ false
%

category: 'testing'
method: GtPhlowDeclarativeListingType
isUnknown
	^ false
%

category: 'accessing'
method: GtPhlowDeclarativeListingType
typeLabel
	^ self class typeLabel
%

! Class implementation for 'GtPhlowNumberDeclarativeListingType'

!		Class methods for 'GtPhlowNumberDeclarativeListingType'

category: 'accessing'
classmethod: GtPhlowNumberDeclarativeListingType
typeLabel
	^ #number
%

! Class implementation for 'GtPhlowTextDeclarativeListingType'

!		Class methods for 'GtPhlowTextDeclarativeListingType'

category: 'accessing'
classmethod: GtPhlowTextDeclarativeListingType
typeLabel
	^ #text
%

! Class implementation for 'GtPhlowTextLinkDeclarativeListingType'

!		Class methods for 'GtPhlowTextLinkDeclarativeListingType'

category: 'accessing'
classmethod: GtPhlowTextLinkDeclarativeListingType
typeLabel
	^ #textLink
%

!		Instance methods for 'GtPhlowTextLinkDeclarativeListingType'

category: 'testing'
method: GtPhlowTextLinkDeclarativeListingType
isTextLinkListingType
	^ true
%

! Class implementation for 'GtPhlowThemeIconNameDeclarativeListingType'

!		Class methods for 'GtPhlowThemeIconNameDeclarativeListingType'

category: 'accessing'
classmethod: GtPhlowThemeIconNameDeclarativeListingType
typeLabel
	^ #icon
%

! Class implementation for 'GtPhlowUnknownDeclarativeListingType'

!		Class methods for 'GtPhlowUnknownDeclarativeListingType'

category: 'accessing'
classmethod: GtPhlowUnknownDeclarativeListingType
typeLabel
	^ #unknown
%

!		Instance methods for 'GtPhlowUnknownDeclarativeListingType'

category: 'testing'
method: GtPhlowUnknownDeclarativeListingType
isUnknown
	^ true
%

! Class implementation for 'GtPhlowDeclarativeSpecification'

!		Class methods for 'GtPhlowDeclarativeSpecification'

category: 'instance creation'
classmethod: GtPhlowDeclarativeSpecification
fromJSONDictionary: aDictionary
	"Answer an instance of the receiver from the supplied dictionary."

	^self new 
		initializeFromJSONDictionary: aDictionary
%

category: 'accessing'
classmethod: GtPhlowDeclarativeSpecification
typeLabel
	^ nil
%

!		Instance methods for 'GtPhlowDeclarativeSpecification'

category: 'converting'
method: GtPhlowDeclarativeSpecification
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation.
	Subclasses will override and add to the dictionary"
	| dictionaryForExport |
	
	dictionaryForExport :=  Dictionary new 
		at: '__typeName' put: self class name;
		yourself.
	
	self class typeLabel ifNotNil: [ :aLabel |
		dictionaryForExport at: '__typeLabel' put: aLabel ].
		
	^ dictionaryForExport
%

category: 'initialization'
method: GtPhlowDeclarativeSpecification
initializeFromJSONDictionary: aDictionary
%

! Class implementation for 'GtPhlowActionSpecification'

!		Instance methods for 'GtPhlowActionSpecification'

category: 'converting'
method: GtPhlowActionSpecification
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation.
	Subclasses will override and add to the dictionary"

	^ super asDictionaryForExport
		at: 'priority' put: priority;
		at: 'methodSelector' put: methodSelector;
		yourself
%

category: 'initialization'
method: GtPhlowActionSpecification
initializeFromInspector: anInspector
%

category: 'initialization'
method: GtPhlowActionSpecification
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.

	self
		priority: (aDictionary at: 'priority' ifAbsent: [ nil ]);
		methodSelector: (aDictionary at: 'methodSelector' ifAbsent: [ nil ]);
		tooltipText: (aDictionary  at: 'tooltipText' ifAbsent: [ nil ]);
		phlowDataSource: (aDictionary 
			at: 'phlowDataSource' ifAbsent: [ nil ])
%

category: 'accessing'
method: GtPhlowActionSpecification
methodSelector
	^ methodSelector
%

category: 'accessing'
method: GtPhlowActionSpecification
methodSelector: aSelector
	methodSelector := aSelector
%

category: 'accessing'
method: GtPhlowActionSpecification
phlowDataSource
	^ phlowDataSource
%

category: 'accessing'
method: GtPhlowActionSpecification
phlowDataSource: aDataSource
	phlowDataSource := aDataSource
%

category: 'accessing'
method: GtPhlowActionSpecification
priority
	^ priority
%

category: 'accessing'
method: GtPhlowActionSpecification
priority: aNumber
	priority := aNumber
%

category: 'accessing'
method: GtPhlowActionSpecification
tooltipText
	^ tooltipText
%

category: 'accessing'
method: GtPhlowActionSpecification
tooltipText: aTextOrString
	tooltipText := aTextOrString
%

! Class implementation for 'GtPhlowButtonActionSpecification'

!		Class methods for 'GtPhlowButtonActionSpecification'

category: 'accessing'
classmethod: GtPhlowButtonActionSpecification
typeLabel
	^ 'phlowButtonActionSpecification'
%

!		Instance methods for 'GtPhlowButtonActionSpecification'

category: 'converting'
method: GtPhlowButtonActionSpecification
asDictionaryForExport
	| dictionaryForExport|
	dictionaryForExport := super asDictionaryForExport.
	
	label ifNotNil: [ :aText |
		dictionaryForExport at: 'label' put: aText ].
	iconStencil ifNotNil: [ :anIconStencil |
		dictionaryForExport 
			at: 'iconStencil' 
			put: anIconStencil asDictionaryForExport ].
	tooltipText ifNotNil: [ :aText |
		dictionaryForExport at: 'tooltipText' put: aText ].

	^ dictionaryForExport
%

category: 'accessing'
method: GtPhlowButtonActionSpecification
iconStencil
	^ iconStencil
%

category: 'accessing'
method: GtPhlowButtonActionSpecification
iconStencil: anIconStencil
	iconStencil := anIconStencil
%

category: 'initialization'
method: GtPhlowButtonActionSpecification
initializeFromInspector: anInspector
	self phlowDataSource ifNil: [
		self phlowDataSource: (anInspector 
			getDeclarativeActionDataSourceFor: self methodSelector) ]
%

category: 'initialization'
method: GtPhlowButtonActionSpecification
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.
	
	aDictionary 
		at: 'label' 
		ifPresent: [ :aText |
			self label: aText ].
	aDictionary 
		at: 'tooltipText' 
		ifPresent: [ :aText |
			self tooltipText: aText ].
	aDictionary 
		at: 'iconStencil' 
		ifPresent: [ :anIconStencilData |
			anIconStencilData ifNotNil: [
				self iconStencil: (GtPhlowIconStencil 
					phlowIconStencilFromDictionary: anIconStencilData) ] ].
%

category: 'accessing'
method: GtPhlowButtonActionSpecification
label
	^ label
%

category: 'accessing'
method: GtPhlowButtonActionSpecification
label: aLabel
	label := aLabel
%

! Class implementation for 'GtPhlowErrorActionSpecification'

!		Class methods for 'GtPhlowErrorActionSpecification'

category: 'accessing'
classmethod: GtPhlowErrorActionSpecification
typeLabel
	^ 'phlowErrorActionSpecification'
%

!		Instance methods for 'GtPhlowErrorActionSpecification'

category: 'converting'
method: GtPhlowErrorActionSpecification
asDictionaryForExport
	| dictionaryForExport|
	dictionaryForExport := super asDictionaryForExport.
	
	errorMessage ifNotNil: [ :aText |
		dictionaryForExport at: 'errorMessage' put: aText ].
	tooltipText ifNotNil: [ :aText |
		dictionaryForExport at: 'tooltipText' put: aText ].

	^ dictionaryForExport
%

category: 'accessing'
method: GtPhlowErrorActionSpecification
errorMessage
	^ errorMessage
%

category: 'accessing'
method: GtPhlowErrorActionSpecification
errorMessage: aStringMessage
	errorMessage := aStringMessage
%

category: 'accessing'
method: GtPhlowErrorActionSpecification
iconStencil 
	^ nil
%

category: 'accessing'
method: GtPhlowErrorActionSpecification
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.
	
	aDictionary 
		at: 'errorMessage' 
		ifPresent: [ :aText |
			self errorMessage: aText ].
	aDictionary 
		at: 'tooltipText' 
		ifPresent: [ :aText |
			self tooltipText: aText ].
%

category: 'accessing'
method: GtPhlowErrorActionSpecification
label
	^ 'Error'
%

! Class implementation for 'GtPhlowNamedIconStencil'

!		Class methods for 'GtPhlowNamedIconStencil'

category: 'instance creation'
classmethod: GtPhlowNamedIconStencil
forIconName: anIconName
	^ self new 
		iconName: anIconName
%

!		Instance methods for 'GtPhlowNamedIconStencil'

category: 'comparing'
method: GtPhlowNamedIconStencil
= anObject
	"Answer whether the receiver and anObject represent the same object."

	self == anObject
		ifTrue: [ ^ true ].
	self class = anObject class
		ifFalse: [ ^ false ].
		
	^ self iconName = anObject iconName
%

category: 'accessing'
method: GtPhlowNamedIconStencil
asDictionaryForExport
	^ super asDictionaryForExport
		at: 'iconName' put: self iconName;
		yourself
%

category: 'comparing'
method: GtPhlowNamedIconStencil
hash
	"Answer an integer value that is related to the identity of the receiver."

	^ self iconName hash
%

category: 'accessing'
method: GtPhlowNamedIconStencil
iconName
	^ iconName
%

category: 'accessing'
method: GtPhlowNamedIconStencil
iconName: anIconName
	iconName := anIconName
%

category: 'accessing'
method: GtPhlowNamedIconStencil
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.
	
	aDictionary 
		at: 'iconName' 
		ifPresent: [ :anIconName | 
			anIconName ifNotNil: [ 
				self iconName: anIconName ] ]
%

! Class implementation for 'GtPhlowGlamorousIconNameStencil'

!		Class methods for 'GtPhlowGlamorousIconNameStencil'

category: 'accessing'
classmethod: GtPhlowGlamorousIconNameStencil
typeLabel
	^ 'phlowGlamorousIconNameStencil'
%

! Class implementation for 'GtPhlowGlamorousVectorIconNameStencil'

!		Class methods for 'GtPhlowGlamorousVectorIconNameStencil'

category: 'accessing'
classmethod: GtPhlowGlamorousVectorIconNameStencil
typeLabel
	^ 'phlowGlamorousVectorIconNameStencil'
%

! Class implementation for 'GtPhlowThemeIconNameStencil'

!		Class methods for 'GtPhlowThemeIconNameStencil'

category: 'accessing'
classmethod: GtPhlowThemeIconNameStencil
typeLabel
	^ 'phlowThemeIconNameStencil'
%

! Class implementation for 'GtRemotePhlowSpawnObjectAction'

!		Class methods for 'GtRemotePhlowSpawnObjectAction'

category: 'instance creation'
classmethod: GtRemotePhlowSpawnObjectAction
forObject: anObject 
	^ self new 
		targetObject: anObject 
%

!		Instance methods for 'GtRemotePhlowSpawnObjectAction'

category: 'converting'
method: GtRemotePhlowSpawnObjectAction
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation"

	^ super asDictionaryForExport
		at: 'objectWrapper' put: (GtRemotePhlowSpawnObjectWrapper new
				targetObject: targetObject);
		yourself
%

category: 'initialization'
method: GtRemotePhlowSpawnObjectAction
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.

	aDictionary at: 'objectWrapper' ifPresent: [ :anObjectWrapper |
		self
			targetObject: (aDictionary 
				at: 'objectWrapper') targetObject asGtBareProxyObject ].
%

category: 'accessing'
method: GtRemotePhlowSpawnObjectAction
targetObject
	^ targetObject
%

category: 'accessing'
method: GtRemotePhlowSpawnObjectAction
targetObject: anObject 
	targetObject := anObject 
%

! Class implementation for 'GtRemotePhlowViewedObjectClassSpecification'

!		Class methods for 'GtRemotePhlowViewedObjectClassSpecification'

category: 'accessing'
classmethod: GtRemotePhlowViewedObjectClassSpecification
forClass: aClass
	^ self new 
		initializeFromClass: aClass
%

category: 'accessing'
classmethod: GtRemotePhlowViewedObjectClassSpecification
typeLabel
	^ 'phlowViewedObjectClassSpecification'
%

!		Instance methods for 'GtRemotePhlowViewedObjectClassSpecification'

category: 'converting'
method: GtRemotePhlowViewedObjectClassSpecification
asDictionaryForExport
	| dictionaryForExport|
	dictionaryForExport := super asDictionaryForExport.
	
	dictionaryForExport at: 'viewObjectClassName' put: viewObjectClassName.
	dictionaryForExport 
		at: 'viewObjectInstanceVariableNames' 
		put: viewObjectInstanceVariableNames.
	
	^ dictionaryForExport
%

category: 'initialization'
method: GtRemotePhlowViewedObjectClassSpecification
initializeFromClass: aClass
	self viewObjectClassName: aClass name.
	self viewObjectInstanceVariableNames: aClass allInstVarNames
%

category: 'initialization'
method: GtRemotePhlowViewedObjectClassSpecification
initializeFromJSONDictionary: aDictionary
	super initializeFromJSONDictionary: aDictionary.

	self
		viewObjectClassName: (aDictionary 
			at: 'viewObjectClassName' 
			ifAbsent: [ nil ]);
		viewObjectInstanceVariableNames: (aDictionary 
			at: 'viewObjectInstanceVariableNames' 
			ifAbsent: [ nil ])
%

category: 'accessing'
method: GtRemotePhlowViewedObjectClassSpecification
viewObjectClassName
	^ viewObjectClassName
%

category: 'accessing'
method: GtRemotePhlowViewedObjectClassSpecification
viewObjectClassName: anObject
	viewObjectClassName := anObject
%

category: 'accessing'
method: GtRemotePhlowViewedObjectClassSpecification
viewObjectInstanceVariableNames
	^ viewObjectInstanceVariableNames
%

category: 'accessing'
method: GtRemotePhlowViewedObjectClassSpecification
viewObjectInstanceVariableNames: anObject
	viewObjectInstanceVariableNames := anObject
%

! Class implementation for 'GtPhlowRuns'

!		Class methods for 'GtPhlowRuns'

category: 'instance creation'
classmethod: GtPhlowRuns
fromJSONDictionary: aRunsData 
	| typeLabel runsClass |
 	typeLabel := aRunsData at: '__typeLabel'.
			
	typeLabel = GtPhlowRunsGroup typeLabel ifTrue: [
 		runsClass := GtPhlowRunsGroup ].
		
	^ runsClass 
		ifNil: [ nil ]
		ifNotNil: [
			runsClass new  
				initializeFromJSONDictionary: aRunsData ]
%

category: 'accessing'
classmethod: GtPhlowRuns
typeLabel
	^ '<missing>'
%

!		Instance methods for 'GtPhlowRuns'

category: 'styling'
method: GtPhlowRuns
applyStyleToText: aText
	self runsDo: [ :aRun |
		aRun applyStyleToText: aText ]
%

category: 'converting'
method: GtPhlowRuns
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation.
	Subclasses will override and add to the dictionary"

	^ Dictionary new 
		at: '__typeLabel' put: self class typeLabel;
		yourself
%

category: 'gt - extensions'
method: GtPhlowRuns
gtViewIntervalsFor: aView
	<gtView>
	
	^ aView columnedList 
		title: 'Intervals';
		priority: 10;
		items: [ 
			| collectedRuns |
			collectedRuns := OrderedCollection new.
			self runsDo: [ :aRun |
				collectedRuns add: aRun ].
			collectedRuns ];
		column: 'Interval' 
			text: [ :aRun | aRun rangeDescription ]
			width: 150;
		column: 'Attributes' 
			text: [ :aRun | aRun attributesDescription ]
%

category: 'initialization '
method: GtPhlowRuns
initializeFromJSONDictionary: aRunsData
%

category: 'testing'
method: GtPhlowRuns
isEmpty
	^ self subclassResponsibility
%

category: 'testing'
method: GtPhlowRuns
notEmpty
	^ self isEmpty not
%

category: 'enumerating'
method: GtPhlowRuns
runsDo: aBlock
	self subclassResponsibility 
%

! Class implementation for 'GtPhlowRunsGroup'

!		Class methods for 'GtPhlowRunsGroup'

category: 'accessing'
classmethod: GtPhlowRunsGroup
typeLabel
	^ 'phlowRunsGroup'
%

category: 'initialization'
classmethod: GtPhlowRunsGroup
withRuns: aCollectionOfRuns
	^ self new 
		initializeWithRuns: aCollectionOfRuns
%

!		Instance methods for 'GtPhlowRunsGroup'

category: 'accessing'
method: GtPhlowRunsGroup
= anObject
	
	self == anObject
		ifTrue: [ ^ true ].
	(anObject class = self class)
		ifFalse: [ ^ false ].

	^ self items = anObject items
%

category: 'adding'
method: GtPhlowRunsGroup
add: aRun
	self addRun: aRun
%

category: 'adding'
method: GtPhlowRunsGroup
addRun: aRun
	self items add: aRun
%

category: 'converting'
method: GtPhlowRunsGroup
asDictionaryForExport

	^ super asDictionaryForExport
		at: 'items' put: (self items collect: [ :aRun |
			aRun asDictionaryForExport ]) asArray;
		yourself
%

category: 'accessing'
method: GtPhlowRunsGroup
copyFrom: aStartIndex to: anEndIndex
	^ self class withRuns: ((self items 
		reject: [ :aRun |
			(anEndIndex < aRun startIndex) or: [ aStartIndex > aRun endIndex]])
		collect: [ :aRun |
			aRun copyFrom: aStartIndex to: anEndIndex ])
%

category: 'enumerating'
method: GtPhlowRunsGroup
detect: aBlock ifNone: exceptionBlock
	^ self items detect: aBlock ifNone: exceptionBlock
%

category: 'accessing'
method: GtPhlowRunsGroup
hash

	^ self items hash
%

category: 'initialization'
method: GtPhlowRunsGroup
initializeFromJSONDictionary: aRunsData
	items := ((aRunsData at: 'items') collect: [ :aRunData |
		GtPhlowBasicRun fromJSONDictionary:  aRunData ]) asOrderedCollection
%

category: 'initialization'
method: GtPhlowRunsGroup
initializeWithRuns: aCollectionOfRuns
	items := aCollectionOfRuns
%

category: 'testing'
method: GtPhlowRunsGroup
isEmpty
	^ items isNil or: [ items isEmpty ]
%

category: 'accessing'
method: GtPhlowRunsGroup
items
	^ items ifNil: [
		items := OrderedCollection new ]	
%

category: 'enumerating'
method: GtPhlowRunsGroup
itemsDo: aBlock
	items ifNil: [ ^ self ].
	
	items do: aBlock
%

category: 'printing'
method: GtPhlowRunsGroup
printOn: aStream
	super printOn:  aStream.
	aStream parenthesize: [
		aStream
			print: items size;
			<< ' runs' ]
%

category: 'enumerating'
method: GtPhlowRunsGroup
reject: aBlock
	^ self class 
		withRuns: (self items reject: aBlock)
%

category: 'enumerating'
method: GtPhlowRunsGroup
runsDo: aBlock
	self itemsDo: aBlock
%

category: 'accessing'
method: GtPhlowRunsGroup
size
	^ self isEmpty 
		ifTrue: [0] 
		ifFalse: [ self items size ]
%

! Class implementation for 'GtPhlowText'

!		Class methods for 'GtPhlowText'

category: 'accessing'
classmethod: GtPhlowText
forString: aString
	^ GtPhlowRunBasedText new 
		initializeWithString: aString
%

!		Instance methods for 'GtPhlowText'

category: 'attributes'
method: GtPhlowText
addAttribute: aPhlowAttribute
	 self  
	 	addAttribute: aPhlowAttribute 
	 	from: self startIndex
	 	to: self endIndex
%

category: 'attributes'
method: GtPhlowText
addAttribute: aPhlowAttribute from: aStartIndex to: anEndIndex 
	self subclassResponsibility
%

category: 'api - text style'
method: GtPhlowText
bold
	^ self addAttribute: GtPhlowFontWeightAttribute bold
%

category: 'api - text style'
method: GtPhlowText
decorationDo: aBlock
	| anAttribute |
	
	anAttribute := GtPhlowTextDecorationAttribute new.
	aBlock value: anAttribute.
	self addAttribute: anAttribute
%

category: 'accessing'
method: GtPhlowText
endIndex
	^ self subclassResponsibility
%

category: 'api - text style'
method: GtPhlowText
fontName: aName
	self addAttribute: (GtPhlowFontNameAttribute new 
		fontName: aName)
%

category: 'api - text style'
method: GtPhlowText
fontSize: aNumber
	self addAttribute: (GtPhlowFontSizeAttribute new 
		sizeValue: aNumber)
%

category: 'api - text style'
method: GtPhlowText
foreground: aPhlowColor
	self addAttribute: (GtPhlowTextForegroundAttribute new 
		color: aPhlowColor)
%

category: 'test - accessing'
method: GtPhlowText
from: aStart to: anEnd
	"Create and return a subtext of this text form aStart to anEnd."
	<return: #GtPhlowSubText>
	
	^ self subclassResponsibility
%

category: 'api - text style'
method: GtPhlowText
glamorousCodeFont
	self fontName: 'Source Code Pro'
%

category: 'api - text style'
method: GtPhlowText
glamorousRegularFont
	self fontName: 'Source Sans Pro'
%

category: 'gt - extensions'
method: GtPhlowText
gtDisplayText
	^ self asRopedText
%

category: 'gt - extensions'
method: GtPhlowText
gtStringFor: aView
	<gtView>
	self isEmpty ifTrue: [ ^ aView empty ].
	
	^ aView forward 
		title: 'String';
		priority: 5;
		object: [ self asString ];
		view: #gtStringFor:
%

category: 'gt - extensions'
method: GtPhlowText
gtTextFor: aView
	<gtView>
	
	^ aView text
		title: 'Text';
		priority: 2;
		text: [ self ]
%

category: 'api - text style'
method: GtPhlowText
highlight: aColor
	self addAttribute: (GtPhlowTextHighlightAttribute new 
		color: aColor)
%

category: 'testing'
method: GtPhlowText
isEmpty
	^ self size = 0
%

category: 'api - text style'
method: GtPhlowText
italic
	^ self addAttribute: GtPhlowFontEmphasisAttribute italic
%

category: 'api - text style'
method: GtPhlowText
normal
	^ self addAttribute: GtPhlowFontEmphasisAttribute normal
%

category: 'testing'
method: GtPhlowText
notEmpty
	^ self isEmpty not
%

category: 'api - text style'
method: GtPhlowText
oblique
	^ self addAttribute: GtPhlowFontEmphasisAttribute oblique
%

category: 'test - accessing'
method: GtPhlowText
size
	^ self subclassResponsibility
%

category: 'accessing'
method: GtPhlowText
startIndex
	^ self subclassResponsibility
%

category: 'api - text style'
method: GtPhlowText
thin
	^ self addAttribute: GtPhlowFontWeightAttribute thin
%

! Class implementation for 'GtPhlowRunBasedText'

!		Class methods for 'GtPhlowRunBasedText'

category: 'instance creation'
classmethod: GtPhlowRunBasedText
fromJSONDictionary: aDictionary
	^ self new
		initializeFromJSONDictionary: aDictionary
%

category: 'accessing'
classmethod: GtPhlowRunBasedText
typeLabel
	^ 'gtPhlowRunBasedText'
%

!		Instance methods for 'GtPhlowRunBasedText'

category: 'comparing'
method: GtPhlowRunBasedText
= anObject
	
	self == anObject
		ifTrue: [ ^ true ].
	(anObject class = self class)
		ifFalse: [ ^ false ].

	^ self asString = anObject asString and: [
		self attributeRuns = anObject attributeRuns ]
%

category: 'attributes'
method: GtPhlowRunBasedText
addAttribute: aPhlowAttribute from: aStartIndex to: anEndIndex
	| targetRun | 
	targetRun := attributeRuns 
		detect: [ :aRunWithAttributes |
			aRunWithAttributes startIndex = aStartIndex and: [
				aRunWithAttributes endIndex = anEndIndex ] ] 
		ifNone: [
			| newRun |
			newRun := (GtPhlowRun 
				from: aStartIndex
				to: anEndIndex
				attributes: OrderedCollection new).
			attributeRuns addRun: newRun.
			newRun ].
	targetRun addAttribute: aPhlowAttribute
%

category: 'converting'
method: GtPhlowRunBasedText
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation.
	Subclasses will override and add to the dictionary"
	| dataForExport|
	dataForExport := Dictionary new.
	dataForExport
		at: '__typeLabel' put: self class typeLabel;
		at: 'sourceString' put: sourceString.
	attributeRuns ifNotNil: [ :currentAttributeRuns | 
		dataForExport
			at: 'attributeRuns' 
			put: currentAttributeRuns asDictionaryForExport ].

	^ dataForExport
%

category: 'converting'
method: GtPhlowRunBasedText
asRopedText
	^ self 
		gtDo: [ 
			(#GtRemotePhlowLocalTextAttributeRunsStyler asClass new 
				attributeRuns: attributeRuns)
					style: sourceString asRopedText]
		gemstoneDo: [ self ]
%

category: 'converting'
method: GtPhlowRunBasedText
asString
	^ sourceString
%

category: 'accessing'
method: GtPhlowRunBasedText
attributeRuns
	^ attributeRuns
%

category: 'accessing'
method: GtPhlowRunBasedText
attributeRuns: anAttributeRuns
	attributeRuns := anAttributeRuns
%

category: 'test - accessing'
method: GtPhlowRunBasedText
copyFrom: aStartIndex to: anEndIndex
	"Create a copy of this text within a given indices interval.
	Note: I am different from ==#from:to:== in a sense that I don't create a sub-text that points
	to the original text, I create an independent copy which can be safely used in text editors and other tools."

	<return: #BlText>
	| result |
	aStartIndex > anEndIndex ifTrue: [ 
		^ self empty].
	
	result := self class
		forString: (sourceString copyFrom: aStartIndex to: anEndIndex).
		
	self attributeRuns size > 0 ifTrue: [ 
		result
			attributeRuns: (self attributeRuns 
				copyFrom: aStartIndex
				to: anEndIndex) ].
	^ result
%

category: 'test - accessing'
method: GtPhlowRunBasedText
empty
	"Return a similar (the same backend data structure) but empty text"
	<return: #BlText>
	
	^ self class forString: ''
%

category: 'accessing'
method: GtPhlowRunBasedText
endIndex
	^ sourceString size
%

category: 'accessing'
method: GtPhlowRunBasedText
extractRemotePhlowRuns
	^ self attributeRuns
%

category: 'accessing'
method: GtPhlowRunBasedText
forString: aString
	^ self
		initializeWithString: aString
%

category: 'test - accessing'
method: GtPhlowRunBasedText
from: aStart to: anEnd
	"Create and return a subtext of this text form aStart to anEnd."
	<return: #GtPhlowSubText>
	
	aStart <= (anEnd + 1) 
		ifFalse: [ Error signal: 'Start must not exceed end' ].
		
	(self notEmpty or: [ aStart = 1 and: [ anEnd isZero ] ]) 
		ifFalse: [ Error signal: 'If I am empty then start must be 1 and end must be zero' ].

	^ GtPhlowSubText text: self from: aStart to: anEnd
%

category: 'gt - extensions'
method: GtPhlowRunBasedText
gtAttributeTreeFor: aView
	<gtView>
	| attributes |
	attributes := Dictionary new.
	attributeRuns runsDo: [ :aRun | 
			aRun attributes
				do: [ :each | 
					| locations |
					locations := attributes at: each ifAbsentPut: [ OrderedCollection new ].
					(locations notEmpty and: [ locations last last + 1 = aRun startIndex ])
						ifTrue: [ locations at: locations size put: (locations last first to: aRun endIndex) ]
						ifFalse: [ locations add: (aRun startIndex to: aRun endIndex) ] ] ].
	^ aView columnedTree
		title: 'All attributes';
		priority: 20;
		items: [ attributes keys
				asSortedCollection: [ :a :b | (attributes at: a) first first < (attributes at: b) first first ] ];
		children: [ :each | attributes at: each ifAbsent: [ #() ] ];
		column: 'Text'
			text: [ :each | 
				each class = Interval
					ifTrue: [ (self copyFrom: each first to: each last) asRopedText ]
					ifFalse: [ each printString ] ];
		column: 'Interval'
			text: [ :each | 
				each class = Interval
					ifTrue: [ each first printString , '-' , each last printString ]
					ifFalse: [ '' ] ]
			width: 80;
		send: [ :each | 
			each class = Interval
				ifTrue: [ self from: (each first max: 1) to: each last ]
				ifFalse: [ each ] ]
%

category: 'gt - extensions'
method: GtPhlowRunBasedText
gtViewIntervalsFor: aView
	<gtView>
	
	^ aView columnedList 
		title: 'Intervals';
		priority: 10;
		items: [ 
			| collectedRuns |
			collectedRuns := OrderedCollection new.
			attributeRuns runsDo: [ :aRun |
				collectedRuns add: aRun ].
			collectedRuns ];
		column: 'Interval' 
			text: [ :aRun | aRun rangeDescription ]
			width: 150;
		column: 'Text' 
			text: [ :aRun | 
				self 
					copyFrom: aRun startIndex
					to: aRun endIndex ];
		column: 'Attributes' 
			text: [ :aRun | aRun attributesDescription ]
%

category: 'gt - extensions'
method: GtPhlowRunBasedText
gtViewPlainRunsFor: aView
	<gtView>
	
	^ aView forward 
		title: 'Plain Runs';
		priority: 11;
		object: [ attributeRuns ];
		view: #gtViewIntervalsFor: 
%

category: 'comparing'
method: GtPhlowRunBasedText
hash
	^ self asString hash 
		bitXor: self attributeRuns hash
%

category: 'initialization'
method: GtPhlowRunBasedText
initializeFromJSONDictionary: aDictionary
	self initializeWithString: (aDictionary at: 'sourceString').
		
	(aDictionary includesKey: 'attributeRuns') ifTrue: [
		self attributeRuns: (GtPhlowRuns
				fromJSONDictionary: (aDictionary at: 'attributeRuns')) ]
%

category: 'initialization'
method: GtPhlowRunBasedText
initializeWithString: aString 
	sourceString := aString.
	attributeRuns := GtPhlowRunsGroup new
%

category: 'printing'
method: GtPhlowRunBasedText
printOn: aStream
	aStream 
		<< 'Phlow Rope: ';
		<< sourceString
%

category: 'test - accessing'
method: GtPhlowRunBasedText
size
	^ sourceString size
%

category: 'accessing'
method: GtPhlowRunBasedText
startIndex
	^ 1
%

! Class implementation for 'GtPhlowSubText'

!		Class methods for 'GtPhlowSubText'

category: 'instance creation'
classmethod: GtPhlowSubText
text: aPhlowText from: aStartIndex to: anEndIndex
	(aPhlowText isKindOf: self) ifTrue: [
		Error signal: 'Can not create sub text of a subtext' ].

	^ self new
		text: aPhlowText from: aStartIndex to: anEndIndex;
		yourself
%

!		Instance methods for 'GtPhlowSubText'

category: 'attributes'
method: GtPhlowSubText
addAttribute: aPhlowAttribute from: aStartIndex to: anEndIndex 
	parentText 
		addAttribute: aPhlowAttribute from: aStartIndex to: anEndIndex 
%

category: 'copy'
method: GtPhlowSubText
asRopedText
	^ parentText copyFrom: startIndex to: endIndex
%

category: 'assertions'
method: GtPhlowSubText
assertInvariant
	self assertStart: startIndex end: endIndex
%

category: 'assertions'
method: GtPhlowSubText
assertStart: aStartIndex end: anEndIndex
	
	aStartIndex = 0
		ifTrue: [ Error signal: 'Start index must not be zero' ].

	(aStartIndex between: 1 and: (parentText size + 1))
		ifFalse: [Error signal: 'Sub-text start index is out of bounds'] .
	(anEndIndex between: 0 and: parentText size) ifFalse: [ Error signal: 'Sub-text end index is out of bounds!'].
	
	(parentText notEmpty or: [ aStartIndex = 1 and: [ anEndIndex = 0 ] ]) 
		ifFalse: [ Error signal: 'If text is empty, start must be 1 and end index must be Zero!' ].

	(anEndIndex ~= 0  or: [ aStartIndex = 1 ])
		ifFalse: [ Error signal: 'If end index is zero then start index must be 1' ]
%

category: 'copy'
method: GtPhlowSubText
asString
	^ self asRopedText asString
%

category: 'accessing'
method: GtPhlowSubText
endIndex
	^ endIndex
%

category: 'test - accessing'
method: GtPhlowSubText
from: aStart to: anEnd
	self assertInvariant.
	
	(self notEmpty or: [ aStart = 1 and: [ anEnd isZero ] ])
		ifFalse: [ Error signal: 'If I am empty then start must be 1 and end must be zero' ].
	
	^ parentText
		from: ((aStart + startIndex - 1) max: 0)
		to: ((anEnd + startIndex - 1) max: 0)
%

category: 'gt - extensions'
method: GtPhlowSubText
gtAttributeTreeFor: aView
	<gtView>
	
	^ aView forward 
		title: 'All attributes';
		priority: 20;
		object: [ self asRopedText ];
		view: #gtAttributeTreeFor: 
%

category: 'accessing'
method: GtPhlowSubText
printOn: aStream
	aStream 
		<< 'Phlow SubText: ';
		<< self asString
%

category: 'test - accessing'
method: GtPhlowSubText
size
	self assertInvariant.

	^ (startIndex = endIndex and: [ startIndex = 0 ])
		ifTrue: [ 0 ]
		ifFalse: [ endIndex - startIndex + 1 ]
%

category: 'accessing'
method: GtPhlowSubText
startIndex
	^ startIndex
%

category: 'initialization'
method: GtPhlowSubText
text: aPhlowText from: aStartIndex to: anEndIndex 
	startIndex := aStartIndex.
	endIndex := anEndIndex.
	parentText := aPhlowText.
	
	self assertInvariant
%

! Class implementation for 'GtPhlowTextAttribute'

!		Class methods for 'GtPhlowTextAttribute'

category: 'instance creation'
classmethod: GtPhlowTextAttribute
attibuteClassForType: aTypeLabel
	self
		allSubclassesDo: [ :each | each typeLabel = aTypeLabel ifTrue: [ ^ each ] ].
	^ GtPhlowTextUnknownAttribute
%

category: 'instance creation'
classmethod: GtPhlowTextAttribute
fromJSONDictionary: aTextAttributeData 
	| attributeType attributeClass |
	attributeType :=  aTextAttributeData at: '__typeLabel'.
 	
	attributeClass := self attibuteClassForType: attributeType.
		
	^ attributeType 
		ifNil: [ 
			GtPhlowTextUnknownAttribute new
				rawData: aTextAttributeData ]
		ifNotNil: [
			attributeClass new
				initializeFromJSONDictionary: aTextAttributeData  ]
%

category: 'accessing'
classmethod: GtPhlowTextAttribute
typeLabel
	^ 'unknown'
%

!		Instance methods for 'GtPhlowTextAttribute'

category: 'comparing'
method: GtPhlowTextAttribute
= anObject
	"Return true if I am equal to a given object"
	<return: #Boolean>
	
	self == anObject
		ifTrue: [ ^ true ].
	(anObject class = self class)
		ifFalse: [ ^ false ].

	^ self equals: anObject
%

category: 'styling'
method: GtPhlowTextAttribute
applyStyleToText: aText
	self subclassResponsibility
%

category: 'converting'
method: GtPhlowTextAttribute
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation.
	Subclasses will override and add to the dictionary"

	^ Dictionary new 
		at: '__typeLabel' put: self class typeLabel;
		yourself
%

category: 'comparing'
method: GtPhlowTextAttribute
equals: anAttribute
	^ anAttribute class = self class
%

category: 'comparing'
method: GtPhlowTextAttribute
hash
	"Should be overriden by subclasses"
	^ 31 hash
%

category: 'initialization'
method: GtPhlowTextAttribute
initializeFromJSONDictionary: aTextAttributeData 
%

! Class implementation for 'GtPhlowFontEmphasisAttribute'

!		Class methods for 'GtPhlowFontEmphasisAttribute'

category: 'instance creation'
classmethod: GtPhlowFontEmphasisAttribute
italic
	^ self new 
		emphasis: #italic
%

category: 'instance creation'
classmethod: GtPhlowFontEmphasisAttribute
normal
	^ self new 
		emphasis: #normal
%

category: 'instance creation'
classmethod: GtPhlowFontEmphasisAttribute
oblique
	^ self new 
		emphasis: #oblique
%

category: 'accessing'
classmethod: GtPhlowFontEmphasisAttribute
typeLabel
	^ 'phlowFontEmphasisAttribute'
%

!		Instance methods for 'GtPhlowFontEmphasisAttribute'

category: 'styling'
method: GtPhlowFontEmphasisAttribute
applyStyleToText: aText
	aText perform: emphasis asSymbol
%

category: 'converting'
method: GtPhlowFontEmphasisAttribute
asDictionaryForExport
	^ super asDictionaryForExport
		at: 'emphasis' put: emphasis;
		yourself
%

category: 'accessing'
method: GtPhlowFontEmphasisAttribute
emphasis
	^ emphasis
%

category: 'accessing'
method: GtPhlowFontEmphasisAttribute
emphasis: anObject
	emphasis := anObject
%

category: 'comparing'
method: GtPhlowFontEmphasisAttribute
equals: anAnotherAttribute
	^ self emphasis = anAnotherAttribute emphasis
%

category: 'comparing'
method: GtPhlowFontEmphasisAttribute
hash
	"Answer an integer value that is related to the identity of the receiver."

	^ super hash bitXor: self emphasis hash
%

category: 'initialization'
method: GtPhlowFontEmphasisAttribute
initializeFromJSONDictionary: aTextAttributeData
	super initializeFromJSONDictionary: aTextAttributeData.
	emphasis := aTextAttributeData at: 'emphasis'
%

category: 'printing'
method: GtPhlowFontEmphasisAttribute
printOn: aStream
	aStream
		nextPutAll: 'phlow font-emphasis: ';
		nextPutAll: emphasis
%

! Class implementation for 'GtPhlowFontNameAttribute'

!		Class methods for 'GtPhlowFontNameAttribute'

category: 'accessing'
classmethod: GtPhlowFontNameAttribute
typeLabel
	^ 'phlowFontNameAttribute'
%

!		Instance methods for 'GtPhlowFontNameAttribute'

category: 'styling'
method: GtPhlowFontNameAttribute
applyStyleToText: aText
	aText fontName: fontName
%

category: 'converting'
method: GtPhlowFontNameAttribute
asDictionaryForExport
	^ super asDictionaryForExport
		at: 'name' put: fontName;
		yourself
%

category: 'comparing'
method: GtPhlowFontNameAttribute
equals: anAnotherAttribute
	^ self fontName = anAnotherAttribute fontName
%

category: 'accessing'
method: GtPhlowFontNameAttribute
fontName
	^ fontName
%

category: 'accessing'
method: GtPhlowFontNameAttribute
fontName: aString
	fontName := aString
%

category: 'comparing'
method: GtPhlowFontNameAttribute
hash
	"Answer an integer value that is related to the identity of the receiver."

	^ super hash bitXor: self fontName hash
%

category: 'initialization'
method: GtPhlowFontNameAttribute
initializeFromJSONDictionary: aTextAttributeData
	super initializeFromJSONDictionary: aTextAttributeData.
	fontName := aTextAttributeData at: 'name'
%

category: 'printing'
method: GtPhlowFontNameAttribute
printOn: aStream
	aStream
		nextPutAll: 'phlow font-name: ';
		nextPutAll: fontName
%

! Class implementation for 'GtPhlowFontSizeAttribute'

!		Class methods for 'GtPhlowFontSizeAttribute'

category: 'accessing'
classmethod: GtPhlowFontSizeAttribute
typeLabel
	^ 'phlowFontSizeAttribute'
%

!		Instance methods for 'GtPhlowFontSizeAttribute'

category: 'styling'
method: GtPhlowFontSizeAttribute
applyStyleToText: aText
	aText fontSize: self sizeValue
%

category: 'converting'
method: GtPhlowFontSizeAttribute
asDictionaryForExport

	^ super asDictionaryForExport
		at: 'size' put: self sizeValue;
		yourself
%

category: 'comparing'
method: GtPhlowFontSizeAttribute
equals: anAnotherAttribute
	^ self sizeValue = anAnotherAttribute sizeValue
%

category: 'comparing'
method: GtPhlowFontSizeAttribute
hash
	"Answer an integer value that is related to the identity of the receiver."

	^ super hash bitXor: self sizeValue hash
%

category: 'initialization'
method: GtPhlowFontSizeAttribute
initializeFromJSONDictionary: aTextAttributeData 
	super initializeFromJSONDictionary: aTextAttributeData .
	
	sizeValue := aTextAttributeData at: 'size'
%

category: 'printing'
method: GtPhlowFontSizeAttribute
printOn: aStream
	aStream
		nextPutAll: 'phlow font-size: ';
		nextPutAll: self sizeValue asString
%

category: 'accessing'
method: GtPhlowFontSizeAttribute
sizeValue
	^ sizeValue
%

category: 'accessing'
method: GtPhlowFontSizeAttribute
sizeValue: anInteger
	sizeValue := anInteger
%

! Class implementation for 'GtPhlowFontWeightAttribute'

!		Class methods for 'GtPhlowFontWeightAttribute'

category: 'instance creation'
classmethod: GtPhlowFontWeightAttribute
bold
	^ self new 
		weight: #bold
%

category: 'instance creation'
classmethod: GtPhlowFontWeightAttribute
thin
	^ self new 
		weight: #thin
%

category: 'accessing'
classmethod: GtPhlowFontWeightAttribute
typeLabel
	^ 'phlowFontWeightAttribute'
%

!		Instance methods for 'GtPhlowFontWeightAttribute'

category: 'styling'
method: GtPhlowFontWeightAttribute
applyStyleToText: aText
	aText perform: weight asSymbol
%

category: 'converting'
method: GtPhlowFontWeightAttribute
asDictionaryForExport
	^ super asDictionaryForExport
		at: 'weight' put: weight;
		yourself
%

category: 'comparing'
method: GtPhlowFontWeightAttribute
equals: anAnotherAttribute
	^ self weight = anAnotherAttribute weight
%

category: 'comparing'
method: GtPhlowFontWeightAttribute
hash
	"Answer an integer value that is related to the identity of the receiver."

	^ super hash bitXor: self weight hash
%

category: 'initialization'
method: GtPhlowFontWeightAttribute
initializeFromJSONDictionary: aTextAttributeData
	super initializeFromJSONDictionary: aTextAttributeData.
	weight := aTextAttributeData at: 'weight'
%

category: 'printing'
method: GtPhlowFontWeightAttribute
printOn: aStream
	aStream
		nextPutAll: 'phlow font-weight: ';
		nextPutAll: weight
%

category: 'accessing'
method: GtPhlowFontWeightAttribute
weight
	^ weight
%

category: 'accessing'
method: GtPhlowFontWeightAttribute
weight: anObject
	weight := anObject
%

! Class implementation for 'GtPhlowTextColorAttribute'

!		Instance methods for 'GtPhlowTextColorAttribute'

category: 'styling'
method: GtPhlowTextColorAttribute
applyStyleToText: aText
	aText highlight: self color
%

category: 'accessing'
method: GtPhlowTextColorAttribute
asDictionaryForExport
	^ super asDictionaryForExport
		at: 'color' put: self color asDictionaryForExport;
		yourself
%

category: 'accessing'
method: GtPhlowTextColorAttribute
color
	^ color
%

category: 'accessing'
method: GtPhlowTextColorAttribute
color: anObject
	color := anObject
%

category: 'comparing'
method: GtPhlowTextColorAttribute
equals: anAnotherAttribute
	^ self color = anAnotherAttribute color
%

category: 'comparing'
method: GtPhlowTextColorAttribute
hash
	"Answer an integer value that is related to the identity of the receiver."

	^ super hash bitXor: self color hash
%

category: 'initialization'
method: GtPhlowTextColorAttribute
initializeFromJSONDictionary: aTextAttributeData
	super initializeFromJSONDictionary: aTextAttributeData.
	color := GtPhlowColor fromJSONDictionary: (aTextAttributeData at: 'color')
%

! Class implementation for 'GtPhlowTextForegroundAttribute'

!		Class methods for 'GtPhlowTextForegroundAttribute'

category: 'accessing'
classmethod: GtPhlowTextForegroundAttribute
typeLabel
	^ 'phlowTextForegroundAttribute'
%

!		Instance methods for 'GtPhlowTextForegroundAttribute'

category: 'styling'
method: GtPhlowTextForegroundAttribute
applyStyleToText: aText
	aText foreground: self color asColor 
%

category: 'printing'
method: GtPhlowTextForegroundAttribute
printOn: aStream
	aStream
		nextPutAll: 'phlow text-foreground: ';
		nextPutAll: self color printString
%

! Class implementation for 'GtPhlowTextHighlightAttribute'

!		Class methods for 'GtPhlowTextHighlightAttribute'

category: 'accessing'
classmethod: GtPhlowTextHighlightAttribute
typeLabel
	^ 'phlowTextHighlightAttribute'
%

!		Instance methods for 'GtPhlowTextHighlightAttribute'

category: 'styling'
method: GtPhlowTextHighlightAttribute
applyStyleToText: aText
	aText highlight: self color asColor 
%

category: 'printing'
method: GtPhlowTextHighlightAttribute
printOn: aStream
	aStream
		nextPutAll: 'phlow text-background: ';
		nextPutAll: self color printString
%

! Class implementation for 'GtPhlowTextDecorationAttribute'

!		Class methods for 'GtPhlowTextDecorationAttribute'

category: 'accessing'
classmethod: GtPhlowTextDecorationAttribute
new
	^ self basicNew initialize
%

category: 'accessing'
classmethod: GtPhlowTextDecorationAttribute
typeLabel
	^ #phlowTextDecorationAttribute
%

!		Instance methods for 'GtPhlowTextDecorationAttribute'

category: 'styling'
method: GtPhlowTextDecorationAttribute
applyStyleToText: aText
	aText decorationDo: [ :aTextDecorationAttribute |
		decoration applyPropertiesTo: aTextDecorationAttribute ]
%

category: 'converting'
method: GtPhlowTextDecorationAttribute
asDictionaryForExport
	^ super asDictionaryForExport
		at: 'decoration' put: decoration asDictionaryForExport;
		yourself
%

category: 'accessing'
method: GtPhlowTextDecorationAttribute
color
	^ decoration color
%

category: 'accessing'
method: GtPhlowTextDecorationAttribute
color: aColor
	decoration color: aColor
%

category: 'api - decoration'
method: GtPhlowTextDecorationAttribute
dashed
	decoration dashed
%

category: 'accessing'
method: GtPhlowTextDecorationAttribute
decoration
	<return: #GtPhlowTextDecoration>

	^ decoration
%

category: 'accessing'
method: GtPhlowTextDecorationAttribute
decoration: aGTPhlowTextDecoration
	decoration := aGTPhlowTextDecoration
%

category: 'api - decoration'
method: GtPhlowTextDecorationAttribute
dotted
	decoration dotted
%

category: 'api - decoration'
method: GtPhlowTextDecorationAttribute
double
	decoration double
%

category: 'comparing'
method: GtPhlowTextDecorationAttribute
equals: anAnotherAttribute
	^ self decoration = anAnotherAttribute decoration
%

category: 'initialization'
method: GtPhlowTextDecorationAttribute
initialize
	super initialize.
	
	decoration := GtPhlowTextDecoration new
%

category: 'initialization'
method: GtPhlowTextDecorationAttribute
initializeFromJSONDictionary: aTextAttributeData
	super initializeFromJSONDictionary: aTextAttributeData.
	
	decoration := GtPhlowTextDecoration 
		fromJSONDictionary: (aTextAttributeData at: 'decoration')
%

category: 'api - decoration'
method: GtPhlowTextDecorationAttribute
lineThrough
	decoration withLineThrough
%

category: 'api - decoration'
method: GtPhlowTextDecorationAttribute
overline
	decoration withOverline
%

category: 'api - decoration'
method: GtPhlowTextDecorationAttribute
solid
	decoration solid
%

category: 'accessing'
method: GtPhlowTextDecorationAttribute
thickness
	^ decoration thickness
%

category: 'accessing'
method: GtPhlowTextDecorationAttribute
thickness: aNumber
	decoration thickness: aNumber
%

category: 'api - decoration'
method: GtPhlowTextDecorationAttribute
underline
	decoration withUnderline
%

category: 'api - decoration'
method: GtPhlowTextDecorationAttribute
wavy
	decoration wavy
%

! Class implementation for 'GtPhlowTextUnknownAttribute'

!		Class methods for 'GtPhlowTextUnknownAttribute'

category: 'accessing'
classmethod: GtPhlowTextUnknownAttribute
typeLabel
	^ 'phlowTextUnknownAttribute'
%

!		Instance methods for 'GtPhlowTextUnknownAttribute'

category: 'styling'
method: GtPhlowTextUnknownAttribute
applyStyleToText: aText
%

category: 'comparing'
method: GtPhlowTextUnknownAttribute
equals: anAnotherAttribute
	^ self rawData = anAnotherAttribute rawData
%

category: 'comparing'
method: GtPhlowTextUnknownAttribute
hash
	"Answer an integer value that is related to the identity of the receiver."

	^ super hash bitXor: self rawData hash
%

category: 'accessing'
method: GtPhlowTextUnknownAttribute
rawData
	^ rawData
%

category: 'accessing'
method: GtPhlowTextUnknownAttribute
rawData: aTextStylerData 
	rawData := aTextStylerData
%

! Class implementation for 'GtPhlowTextDecoration'

!		Class methods for 'GtPhlowTextDecoration'

category: 'instance creation'
classmethod: GtPhlowTextDecoration
fromJSONDictionary: aTextAttributeData 
	^ self new
		initializeFromJSONDictionary: aTextAttributeData  
%

category: 'accessing'
classmethod: GtPhlowTextDecoration
new
	^ self basicNew initialize
%

!		Instance methods for 'GtPhlowTextDecoration'

category: 'comparing'
method: GtPhlowTextDecoration
= anObject
	"Answer whether the receiver and anObject represent the same object."

	self == anObject
		ifTrue: [ ^ true ].
	self class = anObject class
		ifFalse: [ ^ false ].
		
	^ color = anObject color
		and: [ styleName = anObject styleName
				and: [ thickness = anObject thickness 
					and: [ typeNames = anObject typeNames ]  ] ]
%

category: 'styling'
method: GtPhlowTextDecoration
applyPropertiesTo: aBlTextDecorationAttribute
	styleName ifNotNil: [
		aBlTextDecorationAttribute perform: styleName asSymbol ].
	typeNames do: [ :aTypeName | 
		aBlTextDecorationAttribute perform: aTypeName asSymbol ].
	color ifNotNil: [ :aColor |
		aBlTextDecorationAttribute color: aColor asColor ].
	thickness ifNotNil: [ :aNumber |
		aBlTextDecorationAttribute thickness: aNumber ].
%

category: 'converting'
method: GtPhlowTextDecoration
asDictionaryForExport
	| dictionaryForExport |
	dictionaryForExport := Dictionary new.
	
	dictionaryForExport
		at: 'styleName' put: self styleName;
		at: 'typeNames' put: self typeNames asArray.
		
	self color ifNotNil: [
		dictionaryForExport 
			at: 'color' 
			put: self color asDictionaryForExport ].
	self thickness ifNotNil: [
		dictionaryForExport 
			at: 'thickness' 
			put: self thickness ].
		
	^ dictionaryForExport
%

category: 'accessing'
method: GtPhlowTextDecoration
color
	^ color
%

category: 'accessing'
method: GtPhlowTextDecoration
color: anObject
	color := anObject
%

category: 'api - decoration'
method: GtPhlowTextDecoration
dashed
	styleName := #dashed
%

category: 'api - decoration'
method: GtPhlowTextDecoration
dotted
	styleName := #dotted
%

category: 'api - decoration'
method: GtPhlowTextDecoration
double
	styleName := #double
%

category: 'gt - extensions'
method: GtPhlowTextDecoration
gtPreviewFor: aView
	<gtView>

	^ aView text
		title: 'Preview';
		priority: 1;
		text: [
			'Decoration' asRopedText
				fontSize: 20;
				decorationDo: [ :aTextDecorationAttribute | 
					self applyPropertiesTo: aTextDecorationAttribute ] ]
%

category: 'comparing'
method: GtPhlowTextDecoration
hash
	"Answer an integer value that is related to the identity of the receiver."

	^ color hash
		bitXor: (styleName hash 
			bitXor: (thickness hash 
				bitXor: typeNames hash))
%

category: 'initialization'
method: GtPhlowTextDecoration
initialize
	super initialize.
	
	typeNames := Set new.
	self solid.
	thickness := 1.
%

category: 'initialization'
method: GtPhlowTextDecoration
initializeFromJSONDictionary: aTextDecorationData 
	styleName := aTextDecorationData at: 'styleName'.
	typeNames := (aTextDecorationData at: 'typeNames') asSet.
	
	aTextDecorationData at: 'color' ifPresent: [ :aColorData |
		color := GtPhlowColor fromJSONDictionary: aColorData ].
	aTextDecorationData at: 'thickness' ifPresent: [ :aNumber |
		thickness := aNumber ].
%

category: 'api - decoration'
method: GtPhlowTextDecoration
solid
	styleName := #solid
%

category: 'accessing'
method: GtPhlowTextDecoration
styleName
	^ styleName
%

category: 'accessing'
method: GtPhlowTextDecoration
styleName: anObject
	styleName := anObject
%

category: 'accessing'
method: GtPhlowTextDecoration
thickness
	^ thickness
%

category: 'accessing'
method: GtPhlowTextDecoration
thickness: anObject
	thickness := anObject
%

category: 'accessing'
method: GtPhlowTextDecoration
typeNames
	^ typeNames
%

category: 'accessing'
method: GtPhlowTextDecoration
typeNames: anObject
	typeNames := anObject
%

category: 'api - decoration'
method: GtPhlowTextDecoration
wavy
	styleName := #wavy
%

category: 'api - decoration'
method: GtPhlowTextDecoration
withLineThrough
	typeNames add: #lineThrough
%

category: 'api - decoration'
method: GtPhlowTextDecoration
withOverline
	typeNames add: #overline
%

category: 'api - decoration'
method: GtPhlowTextDecoration
withUnderline
	typeNames add: #underline
%

! Class implementation for 'GtPhlowTextHighlight'

!		Class methods for 'GtPhlowTextHighlight'

category: 'instance creation'
classmethod: GtPhlowTextHighlight
from: start to: end
	^ self new
		startPosition: start;
		endPosition: end;
		yourself
%

category: 'instance creation'
classmethod: GtPhlowTextHighlight
from: start to: end with: aColor
	^ self new
		startPosition: start;
		endPosition: end;
		color: aColor;
		yourself
%

category: 'instance creation'
classmethod: GtPhlowTextHighlight
fromJSONDictionary: aDictionary
	^ self new
		startPosition: (aDictionary at: 'startPosition');
		endPosition: (aDictionary at: 'endPosition');
		color: (aDictionary
				at: 'color'
				ifPresent: [ :dict | (GtPhlowColor fromJSONDictionary: dict) asColor ]
				ifAbsent: [  ]);
		yourself
%

!		Instance methods for 'GtPhlowTextHighlight'

category: 'accessing'
method: GtPhlowTextHighlight
asDictionaryForExport
	| dict |
	dict := Dictionary new.
	dict at: 'startPosition' put: self startPosition.
	dict at: 'endPosition' put: self endPosition.
	color
		ifNotNil: [ dict
				at: 'color'
				put: (GtPhlowColor
						r: color red
						g: color green
						b: color blue
						alpha: color alpha) asDictionaryForExport ].
	^ dict
%

category: 'accessing'
method: GtPhlowTextHighlight
color
	^ color
%

category: 'accessing'
method: GtPhlowTextHighlight
color: anObject
	color := anObject
%

category: 'accessing'
method: GtPhlowTextHighlight
endPosition
	^ endPosition
%

category: 'accessing'
method: GtPhlowTextHighlight
endPosition: anObject
	endPosition := anObject
%

category: 'accessing'
method: GtPhlowTextHighlight
startPosition
	^ startPosition
%

category: 'accessing'
method: GtPhlowTextHighlight
startPosition: anObject
	startPosition := anObject
%

! Class implementation for 'GtPhlowViewSpecification'

!		Class methods for 'GtPhlowViewSpecification'

category: 'data transport'
classmethod: GtPhlowViewSpecification
dataIncluded
	"Answer the enumerated value for the display data being included with the specification"

	^1
%

category: 'data transport'
classmethod: GtPhlowViewSpecification
dataLazy
	"Answer the enumerated value for the display data accessor name being included with the specification.  This can then be used to retrieve the data at a later time"

	^2
%

category: 'instance creation'
classmethod: GtPhlowViewSpecification
fromJSONDictionary: aDictionary
	"Answer an instance of the receiver from the supplied dictionary.
	Subclasses will override this to add their specific attributes"

	^self new 
		title: (aDictionary at: 'title');
		priority: (aDictionary at: 'priority');
		dataTransport: (aDictionary at: 'dataTransport');
		methodSelector: (aDictionary at: 'methodSelector');
		phlowDataSource: (aDictionary 
			at: 'phlowDataSource' ifAbsent: [ nil ]);
		yourself
%

!		Instance methods for 'GtPhlowViewSpecification'

category: 'converting'
method: GtPhlowViewSpecification
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation.
	Subclasses will override and add to the dictionary"

	^ Dictionary new 
		at: 'viewName' put: self viewName;
		at: '__typeName' put: self class name;
		at: 'title' put: title;
		at: 'priority' put: priority;
		at: 'dataTransport' put: dataTransport;
		at: 'methodSelector' put: methodSelector;
		yourself
%

category: 'accessing'
method: GtPhlowViewSpecification
dataTransport
	^ dataTransport
%

category: 'accessing'
method: GtPhlowViewSpecification
dataTransport: anObject
	dataTransport := anObject
%

category: 'accessing'
method: GtPhlowViewSpecification
definingMethod
	^ phlowDataSource ifNotNil: [ :aDataSource | 
		aDataSource definingMethod ]
%

category: 'initialization'
method: GtPhlowViewSpecification
initializeFromInspector: anInspector
%

category: 'testing'
method: GtPhlowViewSpecification
isWithLazyLoading
	^ self dataTransport = self class dataLazy
%

category: 'accessing'
method: GtPhlowViewSpecification
methodSelector
	^ methodSelector
%

category: 'accessing'
method: GtPhlowViewSpecification
methodSelector: aSelector
	methodSelector := aSelector
%

category: 'accessing'
method: GtPhlowViewSpecification
phlowDataSource
	^ phlowDataSource
%

category: 'accessing'
method: GtPhlowViewSpecification
phlowDataSource: aDataSource
	phlowDataSource := aDataSource
%

category: 'printing'
method: GtPhlowViewSpecification
printOn: aStream
	super printOn: aStream.
	aStream
		nextPutAll: ' (';
		nextPutAll: self title;
		nextPutAll: ', ';
		nextPutAll: self priority asString;
		nextPutAll: ')'
%

category: 'accessing'
method: GtPhlowViewSpecification
priority
	^ priority
%

category: 'accessing'
method: GtPhlowViewSpecification
priority: anObject
	priority := anObject
%

category: 'accessing'
method: GtPhlowViewSpecification
title
	^ title
%

category: 'accessing'
method: GtPhlowViewSpecification
title: anObject
	title := anObject
%

category: 'accessing'
method: GtPhlowViewSpecification
viewName
	"Answer the name of the receivers view"

	^self class name
%

! Class implementation for 'GtPhlowEmptyViewSpecification'

!		Class methods for 'GtPhlowEmptyViewSpecification'

category: 'as yet unclassified'
classmethod: GtPhlowEmptyViewSpecification
fromJSONDictionary: aDictionary
	"Answer an instance of the receiver from the supplied dictionary.
	Subclasses will override this to add their specific attributes"

	^ self new
%

!		Instance methods for 'GtPhlowEmptyViewSpecification'

category: 'as yet unclassified'
method: GtPhlowEmptyViewSpecification
viewFor: aView
	"Answer the GtPhlowView for the receiver. We use a forwarder view as
	a way to delegate the creation of the remote view back to this specification."

	^ aView empty
%

! Class implementation for 'GtPhlowForwardViewSpecification'

!		Instance methods for 'GtPhlowForwardViewSpecification'

category: 'api - accessing'
method: GtPhlowForwardViewSpecification
getDeclarativeViewFor: aViewSelector
	"This provides the same API as the inspector proxy, so that view 
	specifications can define a single method for initializing the link 
	between the local and the remote instance of the specification."
	
	^ self phlowDataSource
		getDeclarativeViewFor: aViewSelector
%

category: 'initialization'
method: GtPhlowForwardViewSpecification
initializeFromInspector: anInspector
	self phlowDataSource ifNil: [
		self phlowDataSource: (anInspector 
			getDeclarativeViewFor: self methodSelector) ]
%

category: 'api - accessing'
method: GtPhlowForwardViewSpecification
loadViewSpecificationForForwarding
	| declarativeViewData declarativeView |
	
	declarativeViewData := self retrieveViewSpecificationForForwarding.
	declarativeView := GtPhlowViewSpecification fromDictionary: declarativeViewData.
	
	"At this point we need to configure the specification for new view
	just like the inspector does it when retrieveing views. This links the
	local instance of the specification with a proxy to the remote instance."
	declarativeView
		initializeFromInspector: self.
				
	^ declarativeView
%

category: 'api - accessing'
method: GtPhlowForwardViewSpecification
retrieveForwardTargetDataSource
	"This retrieves directly the datasource for the forwarded view."
	^ self phlowDataSource
		retrieveForwardTargetDataSource
%

category: 'api - accessing'
method: GtPhlowForwardViewSpecification
retrieveViewSpecificationForForwarding
	^ self phlowDataSource
		retrieveViewSpecificationForForwarding
%

! Class implementation for 'GtPhlowListingViewSpecification'

!		Instance methods for 'GtPhlowListingViewSpecification'

category: 'api - accessing'
method: GtPhlowListingViewSpecification
flushItemsIterator 

	phlowDataSource flushItemsIterator
%

category: 'initialization'
method: GtPhlowListingViewSpecification
initializeFromInspector: anInspector
	self phlowDataSource ifNil: [
		self phlowDataSource: (anInspector 
			getDeclarativeViewFor: self methodSelector) ]
%

category: 'accessing'
method: GtPhlowListingViewSpecification
retrieveFormattedItems
	^ self phlowDataSource 
		retrieveItems: self totalItemsCount fromIndex: 1
%

category: 'api - accessing'
method: GtPhlowListingViewSpecification
retrieveItems: anItemsCount fromIndex: anIndex
	^ self phlowDataSource 
		retrieveItems: anItemsCount fromIndex: anIndex
%

category: 'accessing'
method: GtPhlowListingViewSpecification
retrieveItemsFromIndex: anIndex
	^ self retrieveItems: 100 fromIndex: anIndex
%

category: 'api - accessing'
method: GtPhlowListingViewSpecification
retrieveSentItemAt: aSelectionIndex
	^ self phlowDataSource retrieveSentItemAt: aSelectionIndex
%

category: 'api - accessing'
method: GtPhlowListingViewSpecification
retrieveTotalItemsCount
	^ self phlowDataSource retrieveTotalItemsCount
%

category: 'accessing'
method: GtPhlowListingViewSpecification
retriveFormattedItems
	^ self phlowDataSource 
		retrieveItems: self totalItemsCount fromIndex: 1
%

category: 'api - accessing'
method: GtPhlowListingViewSpecification
retriveSentItemAt: aSelectionIndex
	^ self phlowDataSource retriveSentItemAt: aSelectionIndex
%

category: 'accessing'
method: GtPhlowListingViewSpecification
totalItemsCount
	^ totalItemsCount ifNil: [ 
		totalItemsCount := self phlowDataSource retrieveTotalItemsCount ]
%

! Class implementation for 'GtPhlowBasicColumnedViewSpecification'

!		Class methods for 'GtPhlowBasicColumnedViewSpecification'

category: 'instance creation'
classmethod: GtPhlowBasicColumnedViewSpecification
fromJSONDictionary: aDictionary

	| list |

	list := super fromJSONDictionary: aDictionary.
	list
		columnSpecifications: ((aDictionary at: 'columnSpecifications')
			collect: [ :aColumnSpecificationJson |
				GtRemotePhlowColumnSpecification 
					fromJSONDictionary: aColumnSpecificationJson ]).
	
	^list
%

!		Instance methods for 'GtPhlowBasicColumnedViewSpecification'

category: 'converting'
method: GtPhlowBasicColumnedViewSpecification
asDictionaryForExport 
	^ super asDictionaryForExport 
		at: 'columnSpecifications' put: (self columnSpecifications
			collect: [ :aColumnSpecification |
				aColumnSpecification asDictionaryForExport ]);
		yourself
%

category: 'accessing'
method: GtPhlowBasicColumnedViewSpecification
columnSpecifications
	^ columnSpecifications
%

category: 'accessing'
method: GtPhlowBasicColumnedViewSpecification
columnSpecifications: anObject
	columnSpecifications := anObject
%

category: 'accessing'
method: GtPhlowBasicColumnedViewSpecification
columnTitles
	^ self columnSpecifications collect: [ :aColumnSpecification |
		aColumnSpecification title ]
%

category: 'accessing'
method: GtPhlowBasicColumnedViewSpecification
columnTypes
	^ self columnSpecifications collect: [ :aColumnSpecification |
		aColumnSpecification type ]
%

category: 'accessing'
method: GtPhlowBasicColumnedViewSpecification
columnWidths
	^ self columnSpecifications collect: [ :aColumnSpecification |
		aColumnSpecification cellWidth ]
%

category: 'gt - extensions'
method: GtPhlowBasicColumnedViewSpecification
gtViewColumnSpecificationFor: aView
	<gtView>
	
	self columnSpecifications ifNil:  [
		^ aView empty ].
	
	^ aView columnedList
		title: 'Column Specifications';
		priority: 20;
		items: [ self columnSpecifications ];
		column: 'Title' text: [ :aColumnSpecification | 
			aColumnSpecification title ];
		column: 'Type' text: [ :aColumnSpecification | 
			aColumnSpecification type ]
%

category: 'api - accessing'
method: GtPhlowBasicColumnedViewSpecification
retriveSpawnedObjectAtRow: aRowIndex column: aColumnIndex	
	^ self phlowDataSource 
		retriveSpawnedObjectAtRow: aRowIndex column: aColumnIndex
%

! Class implementation for 'GtPhlowColumnedListViewSpecification'

!		Class methods for 'GtPhlowColumnedListViewSpecification'

category: 'instance creation'
classmethod: GtPhlowColumnedListViewSpecification
fromJSONDictionary: aDictionary
	^ (super fromJSONDictionary: aDictionary)
		horizontalScrollingEnabled: (aDictionary 
			at: 'horizontalScrollingEnabled' 
			ifAbsent: [ nil ])
%

!		Instance methods for 'GtPhlowColumnedListViewSpecification'

category: 'converting'
method: GtPhlowColumnedListViewSpecification
asDictionaryForExport 
	^ super asDictionaryForExport 
		at: 'horizontalScrollingEnabled' put: horizontalScrollingEnabled;
		yourself
%

category: 'accessing'
method: GtPhlowColumnedListViewSpecification
horizontalScrollingEnabled
	^ horizontalScrollingEnabled
%

category: 'accessing'
method: GtPhlowColumnedListViewSpecification
horizontalScrollingEnabled: aBoolean
	horizontalScrollingEnabled := aBoolean
%

category: 'accessing'
method: GtPhlowColumnedListViewSpecification
isHorizontalScrollingEnabled
	^ self horizontalScrollingEnabled ifNil: [ false ]
%

! Class implementation for 'GtPhlowColumnedTreeViewSpecification'

!		Instance methods for 'GtPhlowColumnedTreeViewSpecification'

category: 'api - accessing'
method: GtPhlowColumnedTreeViewSpecification
retrieveChildrenForNodeAtPath: aNodePath
	^ self phlowDataSource 
		retrieveChildrenForNodeAtPath: aNodePath
%

category: 'api - accessing'
method: GtPhlowColumnedTreeViewSpecification
retrieveSentItemAtPath: aNodePath
	^ self phlowDataSource 
		retrieveSentItemAtPath:aNodePath
%

category: 'api - accessing'
method: GtPhlowColumnedTreeViewSpecification
retriveSentItemAtPath: aNodePath
	^ self phlowDataSource 
		retriveSentItemAtPath:aNodePath
%

! Class implementation for 'GtPhlowListViewSpecification'

!		Class methods for 'GtPhlowListViewSpecification'

category: 'instance creation'
classmethod: GtPhlowListViewSpecification
fromJSONDictionary: aDictionary
	| list |

	list := super fromJSONDictionary: aDictionary.
	^list
%

!		Instance methods for 'GtPhlowListViewSpecification'

category: 'converting'
method: GtPhlowListViewSpecification
asDictionaryForExport 

	| dictionary |

	dictionary := super asDictionaryForExport.
	"self dataTransport = self class dataIncluded ifTrue: [ 
		dictionary at: #items put: self retriveFormattedItems ]."
	^dictionary
%

! Class implementation for 'GtPhlowTreeViewSpecification'

!		Instance methods for 'GtPhlowTreeViewSpecification'

category: 'api - accessing'
method: GtPhlowTreeViewSpecification
retrieveChildrenForNodeAtPath: aNodePath
	^ self phlowDataSource 
		retrieveChildrenForNodeAtPath: aNodePath
%

category: 'api - accessing'
method: GtPhlowTreeViewSpecification
retrieveSentItemAtPath: aNodePath
	^ self phlowDataSource 
		retrieveSentItemAtPath: aNodePath
%

category: 'api - accessing'
method: GtPhlowTreeViewSpecification
retriveSentItemAtPath: aNodePath
	^ self phlowDataSource 
		retriveSentItemAtPath: aNodePath
%

! Class implementation for 'GtPhlowTextualViewSpecification'

!		Instance methods for 'GtPhlowTextualViewSpecification'

category: 'api - accessing'
method: GtPhlowTextualViewSpecification
getText
	^ self phlowDataSource getText
%

category: 'initialization'
method: GtPhlowTextualViewSpecification
initializeFromInspector: anInspector
	self dataTransport = self class dataIncluded ifTrue: [ ^ self ].
	
	self phlowDataSource ifNil: [
		self phlowDataSource: (anInspector 
			getDeclarativeViewFor: self methodSelector) ]
%

category: 'api - accessing'
method: GtPhlowTextualViewSpecification
retrieveStylableText
	^ self phlowDataSource retrieveStylableText
%

! Class implementation for 'GtPhlowTextEditorViewSpecification'

!		Class methods for 'GtPhlowTextEditorViewSpecification'

category: 'instance creation'
classmethod: GtPhlowTextEditorViewSpecification
fromJSONDictionary: aDictionary
	| editorViewSpecification |
	
	editorViewSpecification := super fromJSONDictionary: aDictionary.
	
	editorViewSpecification dataTransport = self dataIncluded
		ifTrue: [ 
			editorViewSpecification string: (aDictionary at: 'string').
			aDictionary
				at: 'textStylerSpecification'
				ifPresent: [ :aTextStylerSpecificationData | 
					editorViewSpecification
						textStylerSpecification: (#GtRemotePhlowTextStylerSpecification asClass
								fromJSONDictionary: aTextStylerSpecificationData) ] ]
		ifFalse: [ 
			(aDictionary includesKey: 'dataSource') ifTrue: [
				editorViewSpecification phlowDataSource: (aDictionary at: 'dataSource')] ].
	
	^ editorViewSpecification
%

!		Instance methods for 'GtPhlowTextEditorViewSpecification'

category: 'converting'
method: GtPhlowTextEditorViewSpecification
asDictionaryForExport 
	| dictionary |

	dictionary := super asDictionaryForExport.
	self dataTransport = self class dataIncluded ifTrue: [ 
		dictionary at: 'string' put: string.
		textStylerSpecification ifNotNil: [
			dictionary 
				at: 'textStylerSpecification'
				put: textStylerSpecification asDictionaryForExport ] ].
	
	^ dictionary
%

category: 'accessing'
method: GtPhlowTextEditorViewSpecification
string

	^ string "ifNil: [ 
		(string isNil and: [ dataTransport = self class dataLazy ]) ifTrue: 
			[ string := accessor data ] ]."
%

category: 'accessing'
method: GtPhlowTextEditorViewSpecification
string: anObject
	string := anObject
%

category: 'accessing'
method: GtPhlowTextEditorViewSpecification
textStylerSpecification: aTextAttributeRuns
	textStylerSpecification := aTextAttributeRuns
%

! Class implementation for 'GtPhlowTextViewSpecification'

!		Class methods for 'GtPhlowTextViewSpecification'

category: 'instance creation'
classmethod: GtPhlowTextViewSpecification
fromJSONDictionary: aDictionary
	| textViewSpecification |
	
	textViewSpecification := super fromJSONDictionary: aDictionary.
	
	textViewSpecification dataTransport = self dataLazy
		ifTrue: [ 
			(aDictionary includesKey: 'dataSource') ifTrue: [
				textViewSpecification phlowDataSource: (aDictionary at: 'dataSource')] ].
	
	^ textViewSpecification
%

! Class implementation for 'GtPhlowViewErrorViewSpecification'

!		Class methods for 'GtPhlowViewErrorViewSpecification'

category: 'instance creation'
classmethod: GtPhlowViewErrorViewSpecification
fromJSONDictionary: aDictionary

	^ (super fromJSONDictionary: aDictionary)
		errorMessage: (aDictionary at: 'errorMessage' ifAbsent: [ nil ])
%

!		Instance methods for 'GtPhlowViewErrorViewSpecification'

category: 'converting'
method: GtPhlowViewErrorViewSpecification
asDictionaryForExport 
	^ super asDictionaryForExport
		at: 'errorMessage' put: errorMessage;
		yourself
%

category: 'accessing'
method: GtPhlowViewErrorViewSpecification
errorMessage
	^ errorMessage
%

category: 'accessing'
method: GtPhlowViewErrorViewSpecification
errorMessage: anObject
	errorMessage := anObject
%

! Class implementation for 'GtRemotePhlowAction'

!		Class methods for 'GtRemotePhlowAction'

category: 'accessing'
classmethod: GtRemotePhlowAction
handledExceptions
	"Explicitly catch here Halt and Warning as in case an action raising 
	those exceptions is embedded in the debugger it will trigger an
	infinite chain of debuggers.
	https://github.com/feenkcom/gtoolkit/issues/4383"
	
	^ Error, Halt, Warning
%

!		Instance methods for 'GtRemotePhlowAction'

category: 'accessing'
method: GtRemotePhlowAction
asGtDeclarativeAction
	^ nil
%

category: 'message performing'
method: GtRemotePhlowAction
basicOn: anObject perform: aMessageSymbol withArguments: aCollectionOfArguments 
	^ anObject  
		perform: aMessageSymbol
		with: aCollectionOfArguments first
%

category: 'decorating'
method: GtRemotePhlowAction
button
	^ GtRemotePhlowButtonAction new
%

category: 'testing'
method: GtRemotePhlowAction
canBeGtDeclarativeAction
	^ true
%

category: 'accessing'
method: GtRemotePhlowAction
definingClass
	^ definingClass
%

category: 'accessing'
method: GtRemotePhlowAction
definingClass: aClass
	definingClass := aClass
%

category: 'accessing'
method: GtRemotePhlowAction
definingMethod
	^ (self definingClass whichClassIncludesSelector: self definingSelector) 
		ifNil: [ nil ]
		ifNotNil: [ :aClass | aClass compiledMethodAt: self definingSelector ]
%

category: 'accessing'
method: GtRemotePhlowAction
definingSelector

	^ definingSelector
%

category: 'accessing'
method: GtRemotePhlowAction
definingSelector: aSelector

	definingSelector := aSelector
%

category: 'accessing'
method: GtRemotePhlowAction
id
	^ id
%

category: 'accessing'
method: GtRemotePhlowAction
id: anId
	id := anId
%

category: 'decorating'
method: GtRemotePhlowAction
noAction
	^ GtRemotePhlowNoAction new
%

category: 'message performing'
method: GtRemotePhlowAction
on: anObject perform: aMessageSymbol 
	<return: #GtRemotePhlowAction>
	
	^ self 
		on: anObject 
		perform: aMessageSymbol 
		withArguments: { self }
%

category: 'message performing'
method: GtRemotePhlowAction
on: anObject perform: aMessageSymbol withArguments: aCollectionOfArguments
	<return: #GtRemotePhlowAction>
	
	^ [ 
			self 
				basicOn: anObject 
				perform: aMessageSymbol 
				withArguments: aCollectionOfArguments
		
	] 
		on: self class handledExceptions do: [ :anException |
			self 
				phlowErrorActionWithException: anException 
				forBuildContext: nil "(GtPhlowBuildContext new 
					object: anObject; 
					arguments: aCollectionOfArguments) "
				andSelector: aMessageSymbol ]
%

category: 'error handling'
method: GtRemotePhlowAction
phlowErrorActionWithException: anException 
	^ GtRemotePhlowErrorAction new
		errorMessage: anException description
%

category: 'error handling'
method: GtRemotePhlowAction
phlowErrorActionWithException: anException forBuildContext: aContext andSelector: aMessageSymbol
	| phlowErrorAction | 

	phlowErrorAction := self phlowErrorActionWithException: anException.
	
	"aPhlow buildContext: aContext.
	aPhlow failedComputation: aFailedComputation."

	^ phlowErrorAction
%

category: 'accessing'
method: GtRemotePhlowAction
priority
	^ priority
%

category: 'accessing'
method: GtRemotePhlowAction
priority: aNumber
	priority := aNumber
%

category: 'accessing'
method: GtRemotePhlowAction
tooltip: aTextOrString
	self tooltipText: aTextOrString
%

category: 'accessing'
method: GtRemotePhlowAction
tooltipText
	^ tooltipText
%

category: 'accessing'
method: GtRemotePhlowAction
tooltipText: aTextOrString
	tooltipText := aTextOrString
%

! Class implementation for 'GtRemotePhlowButtonAction'

!		Instance methods for 'GtRemotePhlowButtonAction'

category: 'accessing'
method: GtRemotePhlowButtonAction
action: aValuable
	actionBlock := aValuable
%

category: 'accessing'
method: GtRemotePhlowButtonAction
actionBlock
	^ actionBlock
%

category: 'converting'
method: GtRemotePhlowButtonAction
asGtDeclarativeAction
	^ GtPhlowButtonActionSpecification new
		priority: self priority;
		tooltipText: self tooltipText;
		label: self label;
		iconStencil: self iconStencil;
		phlowDataSource: (GtRemotePhlowDeclarativeBlockActionDataSource new
			phlowAction: self;
			targetBlock: self actionBlock)
%

category: 'accessing'
method: GtRemotePhlowButtonAction
icon: anIconStencil
	iconStencil := anIconStencil
%

category: 'accessing'
method: GtRemotePhlowButtonAction
iconStencil
	^ iconStencil
%

category: 'initialization'
method: GtRemotePhlowButtonAction
initialize
	super initialize.

	actionBlock := [ :aButton | 
		"do nothing" ].
%

category: 'accessing'
method: GtRemotePhlowButtonAction
label
	^ label
%

category: 'accessing'
method: GtRemotePhlowButtonAction
label: aStringOrText
	label := aStringOrText
%

! Class implementation for 'GtRemotePhlowErrorAction'

!		Instance methods for 'GtRemotePhlowErrorAction'

category: 'converting'
method: GtRemotePhlowErrorAction
asGtDeclarativeAction
	^ GtPhlowErrorActionSpecification new
		priority: self priority;
		errorMessage: self errorMessage;
		tooltipText: self tooltipText
%

category: 'accessing'
method: GtRemotePhlowErrorAction
errorMessage
	^ errorMessage
%

category: 'accessing'
method: GtRemotePhlowErrorAction
errorMessage: aStringMessage
	errorMessage := aStringMessage
%

! Class implementation for 'GtRemotePhlowApiWrapper'

!		Instance methods for 'GtRemotePhlowApiWrapper'

category: 'accessing'
method: GtRemotePhlowApiWrapper
currentAction
	^ currentAction
%

category: 'accessing'
method: GtRemotePhlowApiWrapper
phlow 
	^ self
%

category: 'accessing'
method: GtRemotePhlowApiWrapper
spawnObject: anObject
	currentAction := GtRemotePhlowSpawnObjectAction forObject: anObject
%

! Class implementation for 'GtRemotePhlowCollectionIterator'

!		Class methods for 'GtRemotePhlowCollectionIterator'

category: 'as yet unclassified'
classmethod: GtRemotePhlowCollectionIterator
forCollection: aCollection
	^ self new
		targetCollection: aCollection
%

!		Instance methods for 'GtRemotePhlowCollectionIterator'

category: 'converting'
method: GtRemotePhlowCollectionIterator
asGPhlowItemsIterator
	^ self
%

category: 'iterating'
method: GtRemotePhlowCollectionIterator
forElementsFrom: startIndex to: endIndex withIndexDo: aBlock
	self subclassResponsibility
%

category: 'iterating'
method: GtRemotePhlowCollectionIterator
retrieveAllItems
	^ self 
		retrieveItems: self totalItemsCount
		fromIndex: 1
%

category: 'iterating'
method: GtRemotePhlowCollectionIterator
retrieveItems: anItemsCount fromIndex: startIndex
	| computedElements endIndex |

	computedElements := OrderedCollection new: anItemsCount.
	endIndex := startIndex + anItemsCount - 1.
	
	self 
		forElementsFrom: startIndex 
		to: endIndex 
		withIndexDo: [ :anItem :anIndex |
			computedElements add: anItem ].
	
	^ computedElements asArray
%

category: 'accessing'
method: GtRemotePhlowCollectionIterator
targetCollection: aCollection
	targetCollection := aCollection
%

category: 'accessing'
method: GtRemotePhlowCollectionIterator
totalItemsCount
	^ targetCollection 
		ifNil: [ 0 ] 
		ifNotNil:  [ :aCollection | aCollection size ]
%

! Class implementation for 'GtRemotePhlowSequenceableCollectionIterator'

!		Instance methods for 'GtRemotePhlowSequenceableCollectionIterator'

category: 'iterating'
method: GtRemotePhlowSequenceableCollectionIterator
forElementsFrom: startIndex to: endIndex withIndexDo: aBlock
	| limitedStartIndex limitedEndIndex |
	
	limitedStartIndex := 1 max: startIndex.
	limitedEndIndex := targetCollection size min: endIndex.
	limitedStartIndex to: limitedEndIndex do: [ :anIndex |
		aBlock value: (targetCollection at: anIndex) value: anIndex ]
%

! Class implementation for 'GtRemotePhlowUnindexedCollectionIterator'

!		Instance methods for 'GtRemotePhlowUnindexedCollectionIterator'

category: 'iterating'
method: GtRemotePhlowUnindexedCollectionIterator
forElementsFrom: startIndex to: endIndex withIndexDo: aBlock
	| limitedStartIndex limitedEndIndex iterationIndex|
	
	limitedStartIndex := 1 max: startIndex.
	limitedEndIndex := targetCollection size min: endIndex.
	
	iterationIndex := 1.
	targetCollection perform: self iterationSelector with: [ :anElement |
		"Terminate the iteration if the last element was visited."
		iterationIndex > limitedEndIndex ifTrue: [ ^ self ].
		
		"While between the start and stop indexes visit each element."
		iterationIndex >= limitedStartIndex ifTrue: [ aBlock value: anElement value: iterationIndex ].
		iterationIndex := iterationIndex + 1 ]
%

category: 'accessing'
method: GtRemotePhlowUnindexedCollectionIterator
iterationSelector
	self subclassResponsibility
%

! Class implementation for 'GtRemotePhlowDictionaryAssociationsIterator'

!		Instance methods for 'GtRemotePhlowDictionaryAssociationsIterator'

category: 'accessing'
method: GtRemotePhlowDictionaryAssociationsIterator
iterationSelector
	^ #associationsDo:
%

! Class implementation for 'GtRemotePhlowDictionaryKeysIterator'

!		Instance methods for 'GtRemotePhlowDictionaryKeysIterator'

category: 'accessing'
method: GtRemotePhlowDictionaryKeysIterator
iterationSelector
	^ #keysDo:
%

! Class implementation for 'GtRemotePhlowGenericCollectionIterator'

!		Instance methods for 'GtRemotePhlowGenericCollectionIterator'

category: 'accessing'
method: GtRemotePhlowGenericCollectionIterator
iterationSelector
	^ #do:
%

! Class implementation for 'GtRemotePhlowPluggableCollectionIterator'

!		Instance methods for 'GtRemotePhlowPluggableCollectionIterator'

category: 'accessing'
method: GtRemotePhlowPluggableCollectionIterator
iterationSelector
	^ iterationSelector
%

category: 'accessing'
method: GtRemotePhlowPluggableCollectionIterator
iterationSelector: aSelector
	iterationSelector := aSelector
%

! Class implementation for 'GtRemotePhlowColumn'

!		Class methods for 'GtRemotePhlowColumn'

category: 'testing'
classmethod: GtRemotePhlowColumn
isAbstract
	^ self name = #GtRemotePhlowColumn
%

!		Instance methods for 'GtRemotePhlowColumn'

category: 'converting'
method: GtRemotePhlowColumn
asGtDeclarativeColumnDataType
	^ self subclassResponsibility
%

category: 'api - scripting'
method: GtRemotePhlowColumn
background: aComputation
	backgroundComputation := aComputation
%

category: 'accessing'
method: GtRemotePhlowColumn
backgroundComputation
	^ backgroundComputation
%

category: 'accessing'
method: GtRemotePhlowColumn
cellWidth
	^ width
%

category: 'computation'
method: GtRemotePhlowColumn
computeItemValuesFor: anObject rowIndex: rowIndex columnIndex: columnIndex
	| cellValue itemValue |
	cellValue := self createRemotePhlowCellValue.
	
	itemValue := self itemComputation 
		cull: anObject cull: rowIndex cull: columnIndex.
		
	self 
		updateValue: cellValue 
		forComputedItem: itemValue 
		rowIndex: rowIndex 
		columnIndex: columnIndex.
	
	self hasBackgroundComputation ifTrue: [
		cellValue 
			background: (self backgroundComputation
				cull: itemValue cull: anObject cull: rowIndex cull: columnIndex) ].
	
	^ cellValue
%

category: 'computation'
method: GtRemotePhlowColumn
createRemotePhlowCellValue
	^ GtRemotePhlowItemTextualValue new
%

category: 'testing'
method: GtRemotePhlowColumn
hasBackgroundComputation
	^ backgroundComputation notNil
%

category: 'accessing'
method: GtRemotePhlowColumn
index
	^ index
%

category: 'accessing'
method: GtRemotePhlowColumn
index: aColumnIndex
	index := aColumnIndex
%

category: 'testing'
method: GtRemotePhlowColumn
isSpawningObject
	^ false
%

category: 'accessing'
method: GtRemotePhlowColumn
item: anItemComputation
	itemComputation := anItemComputation
%

category: 'accessing'
method: GtRemotePhlowColumn
itemComputation
	^ itemComputation ifNil: [ 
		itemComputation := [ :item | item ] ]
%

category: 'computation'
method: GtRemotePhlowColumn
phlowTextOrStringFrom: aComputedItem 
	^ aComputedItem isString
		ifTrue: [ aComputedItem ]
		ifFalse: [ aComputedItem gtDisplayText ]
%

category: 'private - accessing'
method: GtRemotePhlowColumn
rowStencil
	^ nil
%

category: 'accessing'
method: GtRemotePhlowColumn
title
	^ title
%

category: 'api - scripting'
method: GtRemotePhlowColumn
title: anObject
	title := anObject
%

category: 'computation'
method: GtRemotePhlowColumn
updateValue: aCellValue forComputedItem: aComputedItem rowIndex: rowIndex columnIndex: columnIndex
	aCellValue 
		itemText: (self phlowTextOrStringFrom: aComputedItem).
%

category: 'accessing'
method: GtRemotePhlowColumn
width: aCellWidth
	width := aCellWidth
%

! Class implementation for 'GtRemotePhlowExplicitColumn'

!		Instance methods for 'GtRemotePhlowExplicitColumn'

category: 'converting'
method: GtRemotePhlowExplicitColumn
asGtDeclarativeColumnDataType
	^ type ifNil: [
		GtPhlowDeclarativeListingType unknown ]
%

category: 'configuration'
method: GtRemotePhlowExplicitColumn
iconName: aBlock
	self item: aBlock.
	type := GtPhlowDeclarativeListingType iconName
%

category: 'testing'
method: GtRemotePhlowExplicitColumn
isSpawningObject
	^ self asGtDeclarativeColumnDataType isTextLinkListingType
%

category: 'accessing'
method: GtRemotePhlowExplicitColumn
spawnObjectComputation
	"If nil, the cell does not spawn an object"

	^ spawnObjectComputation
%

category: 'configuration'
method: GtRemotePhlowExplicitColumn
text: aBlock
	self item: aBlock.
	type := GtPhlowDeclarativeListingType text
%

category: 'configuration'
method: GtRemotePhlowExplicitColumn
text: aBlock spawn: aSpawnObjectComputation
	"aSpawnObjectComputation should return an Object that should be spawned when clicked on:
		- a link button if the column data type is #text
		- a link icon if the column data type is #icon.

	Setting a spawnObject influences how a cell is rendered"
	
	self item: aBlock.
	spawnObjectComputation := aSpawnObjectComputation.
	type := GtPhlowDeclarativeListingType textLink
%

! Class implementation for 'GtRemotePhlowTypedColumn'

!		Class methods for 'GtRemotePhlowTypedColumn'

category: 'testing'
classmethod: GtRemotePhlowTypedColumn
isAbstract
	^ self name = #GtRemotePhlowTypedColumn
%

! Class implementation for 'GtRemotePhlowIconNameColumn'

!		Class methods for 'GtRemotePhlowIconNameColumn'

category: 'testing'
classmethod: GtRemotePhlowIconNameColumn
isAbstract
	^ self name = #GtRemotePhlowIconNameColumn
%

!		Instance methods for 'GtRemotePhlowIconNameColumn'

category: 'accessing'
method: GtRemotePhlowIconNameColumn
iconName: anIconNameComputation
	iconNameComputation := anIconNameComputation
%

category: 'accessing'
method: GtRemotePhlowIconNameColumn
iconNameComputation
	^ iconNameComputation
%

category: 'computation'
method: GtRemotePhlowIconNameColumn
updateValue: aCellValue forComputedItem: aComputedItem rowIndex: rowIndex columnIndex: columnIndex
	| itemText |
	
	itemText := self iconNameComputation 
		ifNil: [ aComputedItem ]
		ifNotNil: [ :anIconNameComputation |
			anIconNameComputation
				cull: aComputedItem
				cull: rowIndex 
				cull: columnIndex ].
				
	aCellValue 
		itemText: itemText gtDisplayString.
%

! Class implementation for 'GtRemotePhlowThemeIconNameColumn'

!		Instance methods for 'GtRemotePhlowThemeIconNameColumn'

category: 'accessing'
method: GtRemotePhlowThemeIconNameColumn
asGtDeclarativeColumnDataType
	^ GtPhlowDeclarativeListingType iconName
%

! Class implementation for 'GtRemotePhlowNumberColumn'

!		Instance methods for 'GtRemotePhlowNumberColumn'

category: 'converting'
method: GtRemotePhlowNumberColumn
asGtDeclarativeColumnDataType
	^ GtPhlowDeclarativeListingType number
%

category: 'configuration'
method: GtRemotePhlowNumberColumn
format: aBlock
	formatComputation := aBlock
%

category: 'accessing'
method: GtRemotePhlowNumberColumn
formatComputation
	^ formatComputation
%

category: 'computation'
method: GtRemotePhlowNumberColumn
updateValue: aCellValue forComputedItem: aComputedItem rowIndex: rowIndex columnIndex: columnIndex
	| itemText |
	
	itemText := self formatComputation 
		ifNil: [ aComputedItem ]
		ifNotNil: [ :aFomattingComputation |
			aFomattingComputation
				cull: aComputedItem
				cull: rowIndex 
				cull: columnIndex ].
				
	aCellValue 
		itemText: (self phlowTextOrStringFrom: itemText).
%

! Class implementation for 'GtRemotePhlowTextColumn'

!		Instance methods for 'GtRemotePhlowTextColumn'

category: 'converting'
method: GtRemotePhlowTextColumn
asGtDeclarativeColumnDataType
	^ GtPhlowDeclarativeListingType text
%

category: 'configuration'
method: GtRemotePhlowTextColumn
format: aBlock
	formatComputation := aBlock
%

category: 'accessing'
method: GtRemotePhlowTextColumn
formatComputation
	^ formatComputation
%

category: 'computation'
method: GtRemotePhlowTextColumn
updateValue: aCellValue forComputedItem: aComputedItem rowIndex: rowIndex columnIndex: columnIndex
	| itemText |
	
	itemText := self formatComputation 
		ifNil: [ aComputedItem ]
		ifNotNil: [ :aFomattingComputation |
			aFomattingComputation
				cull: aComputedItem
				cull: rowIndex 
				cull: columnIndex ].
	
	aCellValue 
		itemText: (self phlowTextOrStringFrom: itemText).
%

! Class implementation for 'GtRemotePhlowColumnSpecification'

!		Class methods for 'GtRemotePhlowColumnSpecification'

category: 'instance creation'
classmethod: GtRemotePhlowColumnSpecification
fromJSONDictionary: aDictionary
	| column |

	column := self new.
	column
		title: (aDictionary at: #title);
		cellWidth: (aDictionary at: #cellWidth);
		type: (self instantiateTypeFrom: (aDictionary at: #type));
		spawnsObjects: (aDictionary at: #spawnsObjects);
		properties: (aDictionary at: #properties) asOrderedCollection.
		
	^column
%

category: 'instance creation'
classmethod: GtRemotePhlowColumnSpecification
instantiateTypeFrom: aValue
	 ^ GtPhlowDeclarativeListingType forTypeLabel: aValue
%

!		Instance methods for 'GtRemotePhlowColumnSpecification'

category: 'conversion'
method: GtRemotePhlowColumnSpecification
asDictionaryForExport 
	| dictionary |

	dictionary := Dictionary new 
		at: #title put: title;
		at: #cellWidth put: cellWidth;
		at: #type put: type typeLabel;
		at: #spawnsObjects put: spawnsObjects;
		at: #properties put: self properties asArray;
		yourself.

	^ dictionary
%

category: 'accessing'
method: GtRemotePhlowColumnSpecification
cellWidth
	^ cellWidth
%

category: 'accessing'
method: GtRemotePhlowColumnSpecification
cellWidth: anObject
	cellWidth := anObject
%

category: 'testing'
method: GtRemotePhlowColumnSpecification
hasBackground
	^ self hasPropertyNamed: #background
%

category: 'testing'
method: GtRemotePhlowColumnSpecification
hasPropertyNamed: aString 
	^ self properties includes: #background
%

category: 'testing'
method: GtRemotePhlowColumnSpecification
isTextSpawn
	^ self spawnsObjects and: [
		self type isText ]
%

category: 'testing'
method: GtRemotePhlowColumnSpecification
markAsHavingBackground
	self markAsHavingPropertyNamed: #background
%

category: 'testing'
method: GtRemotePhlowColumnSpecification
markAsHavingPropertyNamed: aSymbol 
	(self hasPropertyNamed:  aSymbol) ifTrue: [ ^ self ].
	
	self properties add: aSymbol
%

category: 'accessing'
method: GtRemotePhlowColumnSpecification
printOn: aStream
	super printOn: aStream.
	
	aStream parenthesize: [
		aStream << self title.
		self type ifNotNil: [
			aStream 
				<< ', ';
				<< self type typeLabel ]]
%

category: 'accessing'
method: GtRemotePhlowColumnSpecification
properties
	^ properties ifNil: [ 
		properties := OrderedCollection new ]
%

category: 'accessing'
method: GtRemotePhlowColumnSpecification
properties: anObject
	properties := anObject
%

category: 'accessing'
method: GtRemotePhlowColumnSpecification
spawnsObjects
	^ spawnsObjects
%

category: 'accessing'
method: GtRemotePhlowColumnSpecification
spawnsObjects: anObject
	spawnsObjects := anObject
%

category: 'accessing'
method: GtRemotePhlowColumnSpecification
title
	^ title
%

category: 'accessing'
method: GtRemotePhlowColumnSpecification
title: anObject
	title := anObject
%

category: 'accessing'
method: GtRemotePhlowColumnSpecification
type
	^ type
%

category: 'accessing'
method: GtRemotePhlowColumnSpecification
type: anObject
	type := anObject
%

category: 'accessing'
method: GtRemotePhlowColumnSpecification
typeLabel
	^ self type typeLabel
%

! Class implementation for 'GtRemotePhlowDataNode'

!		Class methods for 'GtRemotePhlowDataNode'

category: 'instance creation'
classmethod: GtRemotePhlowDataNode
fromJSONDictionary: aDictionary
	"Answer an instance of the receiver from the supplied dictionary."

	^self new 
		nodeId: (aDictionary at: #nodeId ifAbsent: [ nil ]);
		nodeValue: (aDictionary 
			at: #nodeValue 
			ifPresent: [ :aNodeValueDictionary |
				self valueType fromJSONDictionary: aNodeValueDictionary ]
			ifAbsent: [ nil ]);
		yourself
%

category: 'accessing'
classmethod: GtRemotePhlowDataNode
valueType
	^ GtRemotePhlowItemValue
%

!		Instance methods for 'GtRemotePhlowDataNode'

category: 'accessing'
method: GtRemotePhlowDataNode
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation"

	| data| 
	
	data := Dictionary new 
		at: #nodeId put: self nodeId;
		at: #nodeValue put: self nodeValue asDictionaryForExport;
		yourself.
	
	^ data
%

category: 'comparing'
method: GtRemotePhlowDataNode
matchesNodeContentWith: aNode
	self class = aNode class ifFalse: [ ^ false].
	
	^ (self nodeId = aNode nodeId) and: [
		self nodeValue = aNode nodeValue and: [
			self targetObject = aNode targetObject ] ] 
%

category: 'accessing'
method: GtRemotePhlowDataNode
nodeId
	^ nodeId
%

category: 'accessing'
method: GtRemotePhlowDataNode
nodeId: anObject
	nodeId := anObject
%

category: 'accessing'
method: GtRemotePhlowDataNode
nodeValue
	^ nodeValue
%

category: 'accessing'
method: GtRemotePhlowDataNode
nodeValue: anObject
	nodeValue := anObject
%

category: 'accessing'
method: GtRemotePhlowDataNode
targetObject
	^ targetObject
%

category: 'accessing'
method: GtRemotePhlowDataNode
targetObject: anObject
	targetObject := anObject
%

! Class implementation for 'GtRemotePhlowTreeNode'

!		Instance methods for 'GtRemotePhlowTreeNode'

category: 'converting'
method: GtRemotePhlowTreeNode
asDictionaryForExport
	| exportDictionary  |
	exportDictionary := super asDictionaryForExport.

	self childNodes ifNotNil: [ :aCollection |
		exportDictionary 
			at: #childNodes 
			put: (aCollection
				collect: [ :aChildNode | aChildNode asDictionaryForExport ])].
	
	^ exportDictionary
%

category: 'accessing'
method: GtRemotePhlowTreeNode
childNodes
	^ childNodes
%

category: 'accessing'
method: GtRemotePhlowTreeNode
childNodes: aCollectionOfNodes
	aCollectionOfNodes do: [ :aChildNode | 
		aChildNode parentNode ifNotNil: [ 
			Error signal: 'Parent must be nil.' ].
		aChildNode parentNode: self ].
	
	childNodes := aCollectionOfNodes.
%

category: 'gt - extensions'
method: GtRemotePhlowTreeNode
gtViewChildrenFor: aView 
	<gtView>
	childNodes ifNil: [ ^ aView empty ].
	
	^ aView columnedTree
		title: 'Child Nodes';
		items: [ childNodes ];
		children: [ :aNode | 
			aNode childNodes ifNil: [ #() ] ];
		column: 'Path' text: [ :aNode | 
			aNode nodePathDescription  ] width: 100;
		column: 'Id' text: [ :aNode | aNode nodeId ] width: 100;
		column: 'Value' text: [ :aNode | aNode nodeValue ]
%

category: 'comparing'
method: GtRemotePhlowTreeNode
matchesNodeContentWith: aNode
	(super matchesNodeContentWith: aNode) ifFalse: [ ^ false ].
	
	(self parentNode
		ifNil: [ aNode parentNode isNil ]
		ifNotNil: [ :aParentNode |
			aParentNode matchesNodeContentWith: aNode parentNode ]) ifFalse: [ ^ false ].
			
	self childNodes 
		ifNil: [ ^ aNode childNodes isNil ].
	self childNodes size = aNode childNodes size ifFalse: [ ^ false ].
	
	self childNodes withIndexDo: [ :aChildNode :anIndex |
		(aChildNode matchesNodeContentWith: (aNode childNodes at: anIndex))
			ifFalse: [ ^ false ] ].
			
	^ true
%

category: 'accessing'
method: GtRemotePhlowTreeNode
nodePath
	^ Array streamContents: [ :aStream | 
		  self withParentNodesDo: [ :eachNode | aStream nextPut: eachNode nodeId ] ] 
%

category: 'accessing'
method: GtRemotePhlowTreeNode
nodePathDescription
	^ String streamContents: [ :aStream |
		self printNodePathOn: aStream ]
%

category: 'accessing'
method: GtRemotePhlowTreeNode
parentNode
	^ parentNode
%

category: 'accessing'
method: GtRemotePhlowTreeNode
parentNode: anObject
	parentNode := anObject
%

category: 'printing'
method: GtRemotePhlowTreeNode
printNodePathOn: aStream
	self nodePath 
		do: [:elem | aStream nextPutAll: elem asString]
		separatedBy: [aStream nextPutAll: '/'] 
%

category: 'printing'
method: GtRemotePhlowTreeNode
printOn: aStream
	super printOn: aStream.
	
	aStream parenthesize: [ 
		self nodePath 
			do: [:elem | aStream nextPutAll: elem asString]
			separatedBy: [aStream nextPutAll: '/'] ]
%

category: 'traversing'
method: GtRemotePhlowTreeNode
withParentNodesDo: aBlock

	self parentNode ifNotNil: [ :aParentNode | 
		aParentNode withParentNodesDo: aBlock ].

	aBlock cull: self
%

! Class implementation for 'GtRemotePhlowColumnedTreeNode'

!		Class methods for 'GtRemotePhlowColumnedTreeNode'

category: 'accessing'
classmethod: GtRemotePhlowColumnedTreeNode
valueType
	^ GtRemotePhlowRowValue
%

!		Instance methods for 'GtRemotePhlowColumnedTreeNode'

category: 'accessing'
method: GtRemotePhlowColumnedTreeNode
columnValueAt: anIndex
	^ self nodeValue columnValueAt: anIndex
%

category: 'gt - extensions'
method: GtRemotePhlowColumnedTreeNode
gtViewColumnValuesFor: aView
	<gtView>
	
	^ aView forward
		title: 'Column Values';
		priority: 10;
		object: [ self nodeValue ];
		view: #gtViewColumnValuesFor:
%

! Class implementation for 'GtRemotePhlowDeclarativeActionDataSource'

!		Class methods for 'GtRemotePhlowDeclarativeActionDataSource'

category: 'instance creation'
classmethod: GtRemotePhlowDeclarativeActionDataSource
forPhlowAction: aPhlowAction
	^ self new
		phlowAction: aPhlowAction
%

!		Instance methods for 'GtRemotePhlowDeclarativeActionDataSource'

category: 'accessing'
method: GtRemotePhlowDeclarativeActionDataSource
phlowAction: aPhlowAction 
	phlowAction := aPhlowAction 
%

! Class implementation for 'GtRemotePhlowDeclarativeBlockActionDataSource'

!		Instance methods for 'GtRemotePhlowDeclarativeBlockActionDataSource'

category: 'accessing'
method: GtRemotePhlowDeclarativeBlockActionDataSource
executeRemoteActionWithPhlowResult
	| phlowApiWrapper |
	
	phlowApiWrapper := self phlowApiWrapper.
	self targetBlock value: phlowApiWrapper.
	
	^ phlowApiWrapper currentAction asDictionaryForExport
%

category: 'accessing'
method: GtRemotePhlowDeclarativeBlockActionDataSource
phlowApiWrapper
	^ GtRemotePhlowApiWrapper new
%

category: 'accessing'
method: GtRemotePhlowDeclarativeBlockActionDataSource
targetBlock
	^ targetBlock
%

category: 'accessing'
method: GtRemotePhlowDeclarativeBlockActionDataSource
targetBlock: aBlockClosure
	targetBlock := aBlockClosure
%

! Class implementation for 'GtRemotePhlowDeclarativeErrorTestInspectable'

!		Instance methods for 'GtRemotePhlowDeclarativeErrorTestInspectable'

category: 'accessing'
method: GtRemotePhlowDeclarativeErrorTestInspectable
gtButtonErrorActionFor: anAction
	<gtAction>
	
	1/0.
	^ anAction button
		tooltip: 'Inspect objects';
		priority: 10;
		label: 'Inspect';
		action: [ :aButton |
			aButton phlow 
				spawnObject: {1 . 2} ]
%

category: 'accessing'
method: GtRemotePhlowDeclarativeErrorTestInspectable
gtColumnedListWithFormatErrorsFor: aView
	<gtView>

	^aView columnedList
		title: 'Columned list - format error';
		priority: 20;
		items: [ 1 to: 4 ];
		column: 'Value' text: [ :item | 
			item < 3 ifTrue: [ 1/ 0]. 
			item ];
		column: 'Lowercase' text: [ :item | 
			item = 2 ifTrue: [ 1/ 0].
			item asString asLowercase ] width: 100.
%

category: 'accessing'
method: GtRemotePhlowDeclarativeErrorTestInspectable
gtForwardListWithFormatErrorsFor: aView
	<gtView>

	^aView forward
		title: 'Forward List - with format errors';
		priority: 45;
		object: [ self ];
		view: #gtListWithFormatErrors:
%

category: 'accessing'
method: GtRemotePhlowDeclarativeErrorTestInspectable
gtForwardListWithIFormatErrorsFor: aView
	<gtView>

	^aView forward
		title: 'Forward List - with format errors';
		priority: 45;
		object: [ self ];
		view: #gtListWithFormatErrors:
%

category: 'accessing'
method: GtRemotePhlowDeclarativeErrorTestInspectable
gtForwardListWithItemsErrorsFor: aView
	<gtView>

	^aView forward
		title: 'Forward List - with item errors';
		priority: 45;
		object: [ self ];
		view: #gtListWithItemsErrors:
%

category: 'accessing'
method: GtRemotePhlowDeclarativeErrorTestInspectable
gtListWithFormatErrors: aView
	<gtView>

	^aView list
		title: 'List - with format errors';
		priority: 15;
		items: [ 1 to: 4 ];
		itemText: [ :item | item < 3 ifTrue: [ 1/ 0]. item ]
%

category: 'accessing'
method: GtRemotePhlowDeclarativeErrorTestInspectable
gtListWithItemsErrors: aView
	<gtView>

	^aView list
		title: 'List - with item errors';
		priority: 15;
		items: [ 1/0. 1 to: 4 ];
		itemText: [ :item | item ]
%

category: 'accessing'
method: GtRemotePhlowDeclarativeErrorTestInspectable
gtStringWithTextErrorFor: aView
	<gtView>
	
	^aView textEditor
		title: 'String - with text error';
		priority: 10;
		text: [ 1/0 . 'text value' ]
%

category: 'accessing'
method: GtRemotePhlowDeclarativeErrorTestInspectable
gtTreeWithChildrenErrorsFor: aView
	<gtView>

	^aView tree
		title: 'Tree - with children errors';
		priority: 30;
		items: [ 1 to: 5 ];
		children: [ :aNumber | 
			1/0 . 
			(aNumber // 2 = aNumber)
				ifTrue: [ #() ] 
				ifFalse: [
					aNumber // 2 to: (aNumber - 1) ] ];
		itemText: [ :x | 
			x asString, ' number']
%

category: 'accessing'
method: GtRemotePhlowDeclarativeErrorTestInspectable
gtTreeWithFormatErrorsFor: aView
	<gtView>

	^aView tree
		title: 'Tree - with format errors';
		priority: 30;
		items: [ 1 to: 5 ];
		children: [ :aNumber | 
			(aNumber // 2 = aNumber)
				ifTrue: [ #() ] 
				ifFalse: [
					aNumber // 2 to: (aNumber - 1) ] ];
		itemText: [ :x | 
			x < 3 ifTrue: [ 1/ 0]. 
			x asString, ' number']
%

category: 'accessing'
method: GtRemotePhlowDeclarativeErrorTestInspectable
gtTreeWithItemsErrorsFor: aView
	<gtView>

	^aView tree
		title: 'Tree - with item errors';
		priority: 30;
		items: [ 1/0 . 1 to: 5 ];
		children: [ :aNumber | 
			(aNumber // 2 = aNumber)
				ifTrue: [ #() ] 
				ifFalse: [
					aNumber // 2 to: (aNumber - 1) ] ];
		itemText: [ :x | 
			x asString, ' number']
%

! Class implementation for 'GtRemotePhlowDeclarativeExamples'

!		Class methods for 'GtRemotePhlowDeclarativeExamples'

category: 'testing'
classmethod: GtRemotePhlowDeclarativeExamples
isAbstract
	^ self name = #GtRemotePhlowDeclarativeExamples
%

!		Instance methods for 'GtRemotePhlowDeclarativeExamples'

category: 'private'
method: GtRemotePhlowDeclarativeExamples
basicServer
	^ server
%

category: 'private'
method: GtRemotePhlowDeclarativeExamples
basicServer: aServer
	server := aServer
%

category: 'private'
method: GtRemotePhlowDeclarativeExamples
getRemoteObject
	^ self subclassResponsibility
%

category: 'examples'
method: GtRemotePhlowDeclarativeExamples
remoteObject
	"Answer the remote GtRemotePhlowDeclarativeTestInspectable instance.
	This will be a proxy with a remote server."

	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	| remoteObject collection |
	remoteObject := self getRemoteObject.

	self assert: remoteObject string equals: 'hello world'.

	collection := remoteObject collectionOfObjects.	"Check the size and immediate value objects, but assume that proxies are working correctly"
	self assert: collection size equals: 3.
	self assert: collection first equals: 42.
	self assert: collection second equals: 'Hello World'.

	^ remoteObject
%

category: 'examples'
method: GtRemotePhlowDeclarativeExamples
remotePhlowSpecificationsProvider
	"Answer the object for returning phlow specifications for the object"

	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider declarativeViews |
	phlowSpecificationsProvider := self retrieveRemotePhlowSpecificationsProvider.	"The set of views can vary depending on configuration,
	just check that a common view is present."
	declarativeViews := phlowSpecificationsProvider getDeclarativeViewMethodNames.
	self assert: (declarativeViews includes: #gtListFor:).

	^ phlowSpecificationsProvider
%

category: 'private'
method: GtRemotePhlowDeclarativeExamples
retrieveRemotePhlowSpecificationsProvider
	"Answer the object that will be used to get phlow specifications"

	^ GtRemotePhlowViewedObject object: self remoteObject.
%

category: 'private'
method: GtRemotePhlowDeclarativeExamples
runningServer
	"Answer a running server.
	No server is required running the examples in a single image.
	Subclasses should overwrite this to start the server"

	<gtExample>
	<after: #stopServer>
	<return: #GtRemotePhlowDeclarativeExamples>
	
%

category: 'private'
method: GtRemotePhlowDeclarativeExamples
stopServer 

	server ifNotNil: 
		[ server stop.
		server := nil ]
%

! Class implementation for 'GtRemotePhlowDeclarativeActionsExamples'

!		Class methods for 'GtRemotePhlowDeclarativeActionsExamples'

category: 'testing'
classmethod: GtRemotePhlowDeclarativeActionsExamples
isAbstract
	^ self name = #GtRemotePhlowDeclarativeActionsExamples
%

!		Instance methods for 'GtRemotePhlowDeclarativeActionsExamples'

category: 'assertions'
method: GtRemotePhlowDeclarativeActionsExamples
assertActionResultForDatasource: actionDatasource
	| actionResult |
	actionResult := GtRemotePhlowNavigationAction
			navigationActionFromDictionary: actionDatasource executeRemoteActionWithPhlowResult.
	self assert: actionResult targetObject notNil
%

category: 'examples - actions'
method: GtRemotePhlowDeclarativeActionsExamples
buttonActionWithIcon
	<gtExample>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider actionSpeficificationData actionSpecification actionDatasource |
	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	actionSpeficificationData := phlowSpecificationsProvider
			getActionSpecificationDataFor: #gtButtonActionWithIconFor:.
	actionSpecification := GtPhlowActionSpecification
			phlowActionFromDictionary: actionSpeficificationData.

	self assert: actionSpecification label equals: nil.
	self assert: actionSpecification priority equals: 11.
	self
		assert: actionSpecification iconStencil
		equals: (GtPhlowGlamorousVectorIconNameStencil forIconName: #playinspect).
	self assert: actionSpecification tooltipText equals: 'Inspect objects'.
	self assert: actionSpecification phlowDataSource equals: nil.
	self
		assert: actionSpecification methodSelector
		equals: #gtButtonActionWithIconFor:.

	actionDatasource := phlowSpecificationsProvider
			getDeclarativeActionDataSourceFor: #gtButtonActionWithIconFor:.

	self assertActionResultForDatasource: actionDatasource.

	^ actionSpecification
%

category: 'examples - actions'
method: GtRemotePhlowDeclarativeActionsExamples
buttonActionWithIconAndLabel
	<gtExample>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider actionSpeficificationData actionSpecification actionDatasource |
	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	actionSpeficificationData := phlowSpecificationsProvider
			getActionSpecificationDataFor: #gtButtonActionWithBothIconAndLabelFor:.
	actionSpecification := GtPhlowActionSpecification
			phlowActionFromDictionary: actionSpeficificationData.

	self assert: actionSpecification label equals: 'Inspect'.
	self assert: actionSpecification priority equals: 12.
	self
		assert: actionSpecification iconStencil
		equals: (GtPhlowGlamorousVectorIconNameStencil forIconName: #playinspect).
	self assert: actionSpecification tooltipText equals: 'Inspect objects'.
	self assert: actionSpecification phlowDataSource equals: nil.
	self
		assert: actionSpecification methodSelector
		equals: #gtButtonActionWithBothIconAndLabelFor:.

	actionDatasource := phlowSpecificationsProvider
			getDeclarativeActionDataSourceFor: #gtButtonActionWithBothIconAndLabelFor:.

	self assertActionResultForDatasource: actionDatasource.

	^ actionSpecification
%

category: 'examples - actions'
method: GtRemotePhlowDeclarativeActionsExamples
buttonActionWithLabel
	<gtExample>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider actionSpeficificationData actionSpecification actionDatasource |
	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	actionSpeficificationData := phlowSpecificationsProvider
			getActionSpecificationDataFor: #gtButtonActionWithLabelFor:.
	actionSpecification := GtPhlowActionSpecification
			phlowActionFromDictionary: actionSpeficificationData.

	self assert: actionSpecification label equals: 'Inspect 1'.
	self assert: actionSpecification priority equals: 10.
	self assert: actionSpecification iconStencil equals: nil.
	self assert: actionSpecification tooltipText equals: 'Inspect objects'.
	self assert: actionSpecification phlowDataSource equals: nil.
	self
		assert: actionSpecification methodSelector
		equals: #gtButtonActionWithLabelFor:.

	actionDatasource := phlowSpecificationsProvider
			getDeclarativeActionDataSourceFor: #gtButtonActionWithLabelFor:.

	self assertActionResultForDatasource: actionDatasource.

	^ actionSpecification
%

! Class implementation for 'GtRemotePhlowDeclarativeActionsDirectViewedObjectExamples'

!		Class methods for 'GtRemotePhlowDeclarativeActionsDirectViewedObjectExamples'

category: 'testing'
classmethod: GtRemotePhlowDeclarativeActionsDirectViewedObjectExamples
isAbstract
	^ self name = #GtRemotePhlowDeclarativeActionsDirectViewedObjectExamples
%

!		Instance methods for 'GtRemotePhlowDeclarativeActionsDirectViewedObjectExamples'

category: 'accessing'
method: GtRemotePhlowDeclarativeActionsDirectViewedObjectExamples
getRemoteObject

	^ GtRemotePhlowDeclarativeTestInspectable new
%

! Class implementation for 'GtRemotePhlowDeclarativeActionsLocalViewedObjectExamples'

!		Instance methods for 'GtRemotePhlowDeclarativeActionsLocalViewedObjectExamples'

category: 'accessing'
method: GtRemotePhlowDeclarativeActionsLocalViewedObjectExamples
remoteViewedObject
	^ GtRemotePhlowViewedObject object: self remoteObject.
%

! Class implementation for 'GtRemotePhlowDeclarativeActionsRemoteViewedObjectExamples'

!		Instance methods for 'GtRemotePhlowDeclarativeActionsRemoteViewedObjectExamples'

category: 'accessing'
method: GtRemotePhlowDeclarativeActionsRemoteViewedObjectExamples
retrieveRemotePhlowSpecificationsProvider
	"Answer the GtRemotePhlowViewedObject proxy for the remote object"

	^ GtRemotePhlowViewedObject object: self remoteObject.
%

! Class implementation for 'GtRemotePhlowDeclarativeActionsProxySimulationExamples'

!		Instance methods for 'GtRemotePhlowDeclarativeActionsProxySimulationExamples'

category: 'accessing'
method: GtRemotePhlowDeclarativeActionsProxySimulationExamples
remoteObject
	<gtExample>
	<after: #stopServer>
	<return: #GtRemoteInspectionSimulation>
	| remoteObject |
	remoteObject := self getRemoteObject.

	^ remoteObject
%

category: 'accessing'
method: GtRemotePhlowDeclarativeActionsProxySimulationExamples
retrieveRemotePhlowSpecificationsProvider

	self remoteObject 
		remoteInspectorProxyDo: [ :aProxy | ^ aProxy ].
	^ nil
%

! Class implementation for 'GtRemotePhlowDeclarativeViewsExamples'

!		Class methods for 'GtRemotePhlowDeclarativeViewsExamples'

category: 'testing'
classmethod: GtRemotePhlowDeclarativeViewsExamples
isAbstract
	^ self name = #GtRemotePhlowDeclarativeViewsExamples
%

!		Instance methods for 'GtRemotePhlowDeclarativeViewsExamples'

category: 'assertions'
method: GtRemotePhlowDeclarativeViewsExamples
assertBasicStyledTextInViewSpecification: aViewSpecification expectedText: anExpectedText
	| obtainedStylableText |
	
	obtainedStylableText := (GtRemotePhlowStylableText 
			fromJSONDictionary: aViewSpecification getText).
			

	self assert: obtainedStylableText string equals: anExpectedText asString.
	self assert: obtainedStylableText stylerSpecification canAffectText.
	
	self 
		assertTextAttributedRunStyleSpecification: obtainedStylableText stylerSpecification
		equalsRuns: ((self shouldConvertUsingDisplayTextObject: anExpectedText)
			ifTrue: [ anExpectedText asRopedText extractRemotePhlowRuns ]
			ifFalse: [ anExpectedText attributeRuns ]).
%

category: 'assertions'
method: GtRemotePhlowDeclarativeViewsExamples
assertChildColumnedTreeNodesInViewDatasource: viewDatasource forParentNode: aParentNode  forObjects: anExpectedCollectionOfObjects andColumnsComputation: aCollectionOfBlockClosures
	^ self 
		assertChildNodesInViewDatasource: viewDatasource 
		forParentNode:  aParentNode
		ofType: GtRemotePhlowColumnedTreeNode
		equalNodes: (self 
			createColumnedNodesWithObjectValues: anExpectedCollectionOfObjects
			andColumnsComputation: aCollectionOfBlockClosures)
%

category: 'assertions'
method: GtRemotePhlowDeclarativeViewsExamples
assertChildNodesInViewDatasource: viewDatasource forParentNode: aParentNode ofType: aPhlowDataNodeClass equalNodes: anExpectedCollectionOfNodes 
	| obtainedChildNodes |
	obtainedChildNodes := (viewDatasource 
		retrieveChildrenForNodeAtPath:  aParentNode  nodePath)
			collect: [ :aNodeValueDictionary |
				aPhlowDataNodeClass 
					fromJSONDictionary: aNodeValueDictionary ].
	self 
		assertListingNodes: obtainedChildNodes 
		equals: anExpectedCollectionOfNodes.
%

category: 'assertions'
method: GtRemotePhlowDeclarativeViewsExamples
assertChildTreeNodesInViewDatasource: viewDatasource forParentNode: aParentNode  forObjects: anExpectedCollectionOfObjects
	^ self 
		assertChildNodesInViewDatasource: viewDatasource 
		forParentNode:  aParentNode
		ofType: GtRemotePhlowTreeNode
		equalNodes: (self 
			createTreeNodesWithObjectValues: anExpectedCollectionOfObjects)
%

category: 'assertions'
method: GtRemotePhlowDeclarativeViewsExamples
assertListingNode: anObtainedObject equals: anExpectedNode 
	self assert: anObtainedObject nodeId = anExpectedNode nodeId.
	self assert: (anObtainedObject matchesNodeContentWith: anExpectedNode)
%

category: 'assertions'
method: GtRemotePhlowDeclarativeViewsExamples
assertListingNodes: obtainedNodes equals: expectedNodes
	self assert:  obtainedNodes size equals: expectedNodes size.
	
	expectedNodes withIndexDo: [ :anExpectedNode :anIndex |
		self 
			assertListingNode: (obtainedNodes at: anIndex) 
			equals: anExpectedNode ]
%

category: 'assertions'
method: GtRemotePhlowDeclarativeViewsExamples
assertNodesInColumnedViewDatasource: viewDatasource forObjects: aCollectionOfObjects andColumnsComputation: aCollectionOfBlockClosures
	^ self 
		assertNodesInViewDatasource: viewDatasource 
		ofType: GtRemotePhlowColumnedTreeNode
		equalNodes: (self 
			createColumnedNodesWithObjectValues: aCollectionOfObjects
			andColumnsComputation: aCollectionOfBlockClosures).
%

category: 'assertions'
method: GtRemotePhlowDeclarativeViewsExamples
assertNodesInListViewDatasource: viewDatasource forObjects: anCollectionOfObjects
	^ self 
		assertNodesInViewDatasource: viewDatasource 
		ofType: GtRemotePhlowDataNode
		equalNodes: (self 
			createListNodesWithObjectValues: anCollectionOfObjects).
%

category: 'assertions'
method: GtRemotePhlowDeclarativeViewsExamples
assertNodesInTreeViewDatasource: viewDatasource forObjects: anCollectionOfObjects
	^ self 
		assertNodesInViewDatasource: viewDatasource 
		ofType: GtRemotePhlowTreeNode
		equalNodes: (self 
			createTreeNodesWithObjectValues: anCollectionOfObjects).
%

category: 'assertions'
method: GtRemotePhlowDeclarativeViewsExamples
assertNodesInViewDatasource: viewSpecification ofType: aPhlowDataNodeClass equalNodes: anExpectedCollectionOfNodes 
	| obtainedNodes |
	
	self 
		assert: viewSpecification retrieveTotalItemsCount 
		equals: anExpectedCollectionOfNodes size.
	
	obtainedNodes := viewSpecification retrieveFormattedItems 
		collect: [ :aNodeValueDictionary |
			aPhlowDataNodeClass 
				fromJSONDictionary: aNodeValueDictionary ].
	
	self 
		assertListingNodes: obtainedNodes 
		equals: anExpectedCollectionOfNodes.
	
	^ obtainedNodes
%

category: 'assertions'
method: GtRemotePhlowDeclarativeViewsExamples
assertStyledJsonTextInViewSpecification: aViewSpecification
	| stylableText |
	
	stylableText := (GtRemotePhlowStylableText 
			fromJSONDictionary: aViewSpecification getText).
	self 
		assert: stylableText string withUnixLineEndings 
		equals: self expectedJsonString withUnixLineEndings.
	self assert: stylableText stylerSpecification canAffectText.
	self 
		assert: stylableText stylerSpecification parserClassName equals: #JSONParser.
%

category: 'assertions'
method: GtRemotePhlowDeclarativeViewsExamples
assertTextAttributedRunStyleSpecification: aStyleSpecification equalsRuns: aRunsCollection
	self 
		assert: aStyleSpecification numberOfRuns 
		equals: aRunsCollection size.
	
	self 
		assert: aStyleSpecification attributeRuns
		equals: aRunsCollection
%

category: 'assertions'
method: GtRemotePhlowDeclarativeViewsExamples
assertTextualViewWithBasicStyledTextWithSelector: aViewSelector title: aTitle priority: aPriority expectedText: anExpectedText
	| phlowSpecificationsProvider viewDictionary viewSpecification dataSource |

	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	viewDictionary :=  phlowSpecificationsProvider getViewDeclaration: aViewSelector.
	viewSpecification := GtPhlowViewSpecification fromDictionary: viewDictionary.
	
	self assert: viewSpecification title equals: aTitle.
	self assert: viewSpecification priority equals: aPriority.
	
	dataSource := phlowSpecificationsProvider getDeclarativeViewFor: aViewSelector.
	self 
		assertBasicStyledTextInViewSpecification: dataSource
		expectedText: anExpectedText.
	
	^ viewSpecification
%

category: 'assertions'
method: GtRemotePhlowDeclarativeViewsExamples
assertUnstyledStringInViewSpecification: aViewSpecification equals: aString
	| stylableText |
	
	stylableText := (GtRemotePhlowStylableText 
		fromJSONDictionary: aViewSpecification getText).
	self assert: stylableText string equals: aString.
	self assert: stylableText stylerSpecification canAffectText not.
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
columnedListView
	<gtExample>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider viewDictionary viewSpecification viewDatasource |
	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	viewDictionary := phlowSpecificationsProvider
			getViewDeclaration: #gtColumnedListFor:.
	viewSpecification := GtPhlowViewSpecification fromDictionary: viewDictionary.

	self assert: viewSpecification title equals: 'Columned list'.
	self assert: viewSpecification columnTitles equals: #(Value Lowercase).
	self assert: viewSpecification columnWidths equals: #(nil 100).
	self
		assert: (viewSpecification columnTypes collect: #typeLabel)
		equals: #(text text).

	self
		assert: viewSpecification dataTransport
		equals: GtPhlowViewSpecification dataLazy.

	viewDatasource := phlowSpecificationsProvider
			getDeclarativeViewFor: #gtColumnedListFor:.
	self
		assertNodesInColumnedViewDatasource: viewDatasource
		forObjects: GtRemotePhlowDeclarativeTestInspectable new collectionOfObjects
		andColumnsComputation: {[ :anObject | anObject ].
				[ :anObject | anObject gtDisplayString asLowercase ]}.

	^ viewSpecification
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
columnedListWithStyledText
	<gtExample>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider viewDictionary viewDataSource viewDatasource |
	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	viewDictionary := phlowSpecificationsProvider
			getViewDeclaration: #gtColumnedListWithStyledTextFor:.
	viewDataSource := GtPhlowViewSpecification fromDictionary: viewDictionary.

	self assert: viewDataSource title equals: 'Columned list - styled text'.
	self
		assert: viewDataSource columnTitles
		equals: {'Plain'.
				'Styled'.
				'Number'}.
	self assert: viewDataSource columnWidths equals: #(nil nil nil).
	self
		assert: (viewDataSource columnTypes collect: #typeLabel)
		equals: #(text text number).
	self
		assert: viewDataSource dataTransport
		equals: GtPhlowViewSpecification dataLazy.

	viewDatasource := phlowSpecificationsProvider
			getDeclarativeViewFor: #gtColumnedListWithStyledTextFor:.

	self
		assertNodesInColumnedViewDatasource: viewDatasource
		forObjects: self objectsForListWithStyledTextComparison
		andColumnsComputation: {[ :anObject | anObject asString ].
				[ :anObject | anObject ].
				[  "(GtPhlowText forString: (index*100) asString) bold":anObject :index | (index * 100) asRopedText bold ]}.

	^ viewDataSource
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
columnedListWithTypedColumns
	<gtExample>
	<after: #stopServer>
	| phlowSpecificationsProvider viewDictionary viewSpecification viewDatasource |

	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	viewDictionary := phlowSpecificationsProvider
			getViewDeclaration: #gtColumnedListWithTypedColumnsFor:.
	viewSpecification := GtPhlowViewSpecification fromDictionary: viewDictionary.

	viewSpecification initializeFromInspector: phlowSpecificationsProvider.

	self assert: viewSpecification title equals: 'Columned list with typed columns'.
	self assert: viewSpecification priority equals: 24.

	self
		assert: viewSpecification methodSelector
		equals: #gtColumnedListWithTypedColumnsFor:.
	self
		assert: (viewSpecification columnSpecifications
				collect: [ :aColumnSpecification | aColumnSpecification typeLabel ])
		equals: #('text' 'number' 'icon').
	self
		assert: viewSpecification columnTitles
		equals: #('Text' 'Number' 'Icon Name').
	self assert: viewSpecification columnWidths equals: #(nil 100 75).

	self assert: viewSpecification totalItemsCount equals: 500.

	self
		assert: (viewSpecification retrieveItems: 2 fromIndex: 1)
		equals: (self expectedColumnedListTypedColumnsTwoItems).

	viewDatasource := phlowSpecificationsProvider
			getDeclarativeViewFor: #gtColumnedListWithTypedColumnsFor:.
	self
		assertNodesInColumnedViewDatasource: viewDatasource
		forObjects: (1 to: 500)
		andColumnsComputation: {[ :aNumber | '+' , (aNumber asFloat printShowingDecimalPlaces: 1) ].
				[ :aNumber | '+' , (aNumber + 1) asString ].
				[ :aNumber | self formatExpectedIconName: aNumber asFloat gtSystemIconName ]}.

	^ viewSpecification
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
columnedTreeView
	<gtExample>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider viewDictionary viewSpecification viewDatasource obtainedNodes |
	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	viewDictionary := phlowSpecificationsProvider
			getViewDeclaration: #gtColumnedTreeFor:.
	viewSpecification := GtPhlowViewSpecification fromDictionary: viewDictionary.

	self assert: viewSpecification title equals: 'Columned Tree'.
	self
		assert: viewSpecification columnTitles
		equals: {'x'.
				'x * x'}.
	self assert: viewSpecification columnWidths equals: #(nil nil).
	self
		assert: (viewSpecification columnTypes collect: #typeLabel)
		equals: #(text text).
	self
		assert: viewSpecification dataTransport
		equals: GtPhlowViewSpecification dataLazy.

	viewDatasource := phlowSpecificationsProvider
			getDeclarativeViewFor: #gtColumnedTreeFor:.

	obtainedNodes := self
			assertNodesInColumnedViewDatasource: viewDatasource
			forObjects: (1 to: 5)
			andColumnsComputation: {[ :aNumber | aNumber ].
					[ :aNumber | aNumber * aNumber ]}.

	self
		assertChildColumnedTreeNodesInViewDatasource: viewDatasource
		forParentNode: obtainedNodes third
		forObjects: (1 to: 2)
		andColumnsComputation: {[ :aNumber | aNumber ].
				[ :aNumber | aNumber * aNumber ]}.

	^ viewSpecification
%

category: 'private'
method: GtRemotePhlowDeclarativeViewsExamples
computeStyledTextForTreeNumber: anInteger
	| computedString|
	computedString := anInteger asString, ' number'.
	(anInteger \\ 2) = 0 
		ifTrue: [
			computedString :=  computedString asRopedText
				bold;
				highlight: (GtPhlowColor named: #yellow) asColor ].
	^ computedString
%

category: 'private'
method: GtRemotePhlowDeclarativeViewsExamples
convertIfNeededUsingDisplayTextObject: anObject 
	"When doing local inspection Phlow text objects are not special.
	They are just like any other normal objects and we convert them 
	as any other object"
	^ (self shouldConvertUsingDisplayTextObject: anObject)
			ifTrue: [ anObject gtDisplayText ]
			ifFalse: [ anObject ]
%

category: 'private'
method: GtRemotePhlowDeclarativeViewsExamples
createColumnedNodesWithObjectValues: aCollectionOfObjects andColumnsComputation: aCollectionOfBlockClosures
	^ self createColumnedNodesWithRowValues:  (aCollectionOfObjects 
		withIndexCollect: [ :anObject :aRowIndex | 
			GtRemotePhlowRowValue new
				columnValues: (aCollectionOfBlockClosures 
					collect: [ :aColumnComputation |
						| columnedText |
						columnedText := self convertIfNeededUsingDisplayTextObject: (aColumnComputation 
							cull: anObject cull: aRowIndex).
						self createPhlowTextValueFromText: columnedText ]) ])
%

category: 'private'
method: GtRemotePhlowDeclarativeViewsExamples
createColumnedNodesWithRowValues: aCollectionOfRowValues
	^ aCollectionOfRowValues withIndexCollect: [ :aRowValue :anIndex | 
	 	GtRemotePhlowColumnedTreeNode new
	 		nodeId: anIndex;
	 		nodeValue: aRowValue ]
%

category: 'private'
method: GtRemotePhlowDeclarativeViewsExamples
createListNodesWithObjectValues: aCollectionOfObjects
	^ self createListNodesWithTextValues: (aCollectionOfObjects 
		collect: [ :anObject | 
			self convertIfNeededUsingDisplayTextObject: anObject ])
%

category: 'private'
method: GtRemotePhlowDeclarativeViewsExamples
createListNodesWithTextValues: aCollectionOfValues
	^ aCollectionOfValues withIndexCollect: [ :aText :anIndex | 
	 	GtRemotePhlowDataNode new
	 		nodeId: anIndex;
	 		nodeValue: (self createPhlowTextValueFromText: aText) ]
%

category: 'private'
method: GtRemotePhlowDeclarativeViewsExamples
createPhlowTextValueFromText: aText
	| convertedText |
	convertedText := aText.
	convertedText class name = #BlRunRopedText ifTrue: [
		convertedText := convertedText asGtPlowText ]. 
	
	^ (GtRemotePhlowItemTextualValue new
	 	itemText: convertedText)
%

category: 'private'
method: GtRemotePhlowDeclarativeViewsExamples
createTreeNodesWithObjectValues: aCollectionOfObjects
	^ self createTreeNodesWithTextValues: (aCollectionOfObjects 
		collect: [ :anObject | 
			self convertIfNeededUsingDisplayTextObject: anObject ])
%

category: 'private'
method: GtRemotePhlowDeclarativeViewsExamples
createTreeNodesWithTextValues: aCollectionOfValues
	^ aCollectionOfValues withIndexCollect: [ :aText :anIndex | 
		| convertedText |
		convertedText := aText.
		convertedText class name = #BlRunRopedText ifTrue: [
			convertedText := convertedText asGtPlowText ]. 
		 GtRemotePhlowTreeNode new
	 		nodeId: anIndex;
	 		nodeValue: (GtRemotePhlowItemTextualValue new
	 			itemText: convertedText)]
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewsExamples
expectedBasicString
	^ 'Now is the time'
%

category: 'accessing - expected'
method: GtRemotePhlowDeclarativeViewsExamples
expectedColumnedListTypedColumnsTwoItems
	^ ((Array new: 2) at: 1 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#columnValues->((Array new: 3) at: 1 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'+1.0'); yourself); at: 2 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'+2'); yourself); at: 3 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->#class); yourself); yourself)); yourself)); add: (#nodeId->1); yourself); at: 2 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#columnValues->((Array new: 3) at: 1 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'+2.0'); yourself); at: 2 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'+3'); yourself); at: 3 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->#class); yourself); yourself)); yourself)); add: (#nodeId->2); yourself); yourself)
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewsExamples
expectedJsonString
	^ '{
	"name":"Me", 
	"age":30, 
	"data":null
}'
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewsExamples
expectedNumberOfRunsForBasicStyledText
	^ 9
%

category: 'accessing - expected'
method: GtRemotePhlowDeclarativeViewsExamples
expectedStyledPhlowTextWithDecorations
	^ GtRemotePhlowDeclarativeTextTestInspectable new  
		styledPhlowTextWithDecorations
%

category: 'accessing - expected'
method: GtRemotePhlowDeclarativeViewsExamples
expectedStyledText
	^ GtRemotePhlowDeclarativeTestInspectable new  
			styledText
%

category: 'utils'
method: GtRemotePhlowDeclarativeViewsExamples
formatExpectedIconName: anIconName
	^ anIconName
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
listView
	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider viewDictionary viewSpecification viewDatasource |
	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	viewDictionary := phlowSpecificationsProvider getViewDeclaration: #gtListFor:.
	viewSpecification := GtPhlowViewSpecification fromDictionary: viewDictionary.

	self assert: viewSpecification title equals: #List.
	self assert: viewSpecification priority equals: 15.

	viewDatasource := phlowSpecificationsProvider
			getDeclarativeViewFor: #gtListFor:.
	self
		assertNodesInListViewDatasource: viewDatasource
		forObjects: GtRemotePhlowDeclarativeTestInspectable new collectionOfObjects.

	^ viewSpecification
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
listViewWithStyledText
	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider viewDictionary viewSpecification viewDatasource |
	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	viewDictionary := phlowSpecificationsProvider
			getViewDeclaration: #gtListWithStyledTextFor:.
	viewSpecification := GtPhlowViewSpecification fromDictionary: viewDictionary.

	self assert: viewSpecification title equals: 'List - styled text'.
	self assert: viewSpecification priority equals: 15.1.

	viewDatasource := phlowSpecificationsProvider
			getDeclarativeViewFor: #gtListWithStyledTextFor:.
	self
		assertNodesInListViewDatasource: viewDatasource
		forObjects: self objectsForListWithStyledTextComparison.

	^ viewSpecification
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewsExamples
objectsForListWithStyledTextComparison
	^ GtRemotePhlowDeclarativeTestInspectable new 
			objectsForListWithStyledText
%

category: 'private'
method: GtRemotePhlowDeclarativeViewsExamples
printForString
	"Answer the string returned in the #gtPrintFor: view.
	Subclasses may overwrite this as appropriate."

	^ 'a GtRemotePhlowDeclarativeTestInspectable'
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
printView
	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider viewDictionary viewSpecification viewDataSource |
	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	viewDictionary := phlowSpecificationsProvider getViewDeclaration: #gtPrintFor:.
	viewSpecification := GtPhlowViewSpecification fromDictionary: viewDictionary.

	self assert: viewSpecification title equals: #Print.
	self assert: viewSpecification string equals: nil.	"self printForString"

	viewDataSource := phlowSpecificationsProvider
			getDeclarativeViewFor: #gtPrintFor:.
	self
		assertUnstyledStringInViewSpecification: viewDataSource
		equals: self printForString.

	^ viewSpecification
%

category: 'private'
method: GtRemotePhlowDeclarativeViewsExamples
shouldConvertUsingDisplayTextObject: anObject 
	"When doing local inspection Phlow text objects are not special.
	They are just like any other normal objects and we convert them 
	as any other object"
	^ anObject isString not
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
textEditorViewWithExplicitStyler
	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider viewDictionary viewSpecification viewDataSource |
	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	viewDictionary := phlowSpecificationsProvider
			getViewDeclaration: #gtStyledStringUsingStylerFor:.
	viewSpecification := GtPhlowViewSpecification fromDictionary: viewDictionary.

	self assert: viewSpecification title equals: 'Styled text (styler)'.
	self assert: viewSpecification priority equals: 11.2.
	self assert: viewSpecification string equals: nil.

	viewDataSource := phlowSpecificationsProvider
			getDeclarativeViewFor: #gtStyledStringUsingStylerFor:.
	self
		assertBasicStyledTextInViewSpecification: viewDataSource
		expectedText: self expectedStyledText.

	^ viewSpecification
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
textEditorViewWithParserStylerClass
	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider viewDictionary viewSpecification viewDataSource |
	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	viewDictionary := phlowSpecificationsProvider
			getViewDeclaration: #gtStyledStringJsonInEditorFor:.
	viewSpecification := GtPhlowViewSpecification fromDictionary: viewDictionary.

	self assert: viewSpecification title equals: 'Styled JSON'.
	self assert: viewSpecification priority equals: 11.5.
	self assert: viewSpecification string equals: nil.

	viewDataSource := phlowSpecificationsProvider
			getDeclarativeViewFor: #gtStyledStringJsonInEditorFor:.
	self assertStyledJsonTextInViewSpecification: viewDataSource.

	^ viewSpecification
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
textEditorViewWithSimpleString
	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider viewDictionary viewSpecification viewDataSource |
	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	viewDictionary := phlowSpecificationsProvider
			getViewDeclaration: #gtStringInTextEditorViewFor:.
	viewSpecification := GtPhlowViewSpecification fromDictionary: viewDictionary.

	self assert: viewSpecification title equals: 'String (editor)'.
	self assert: viewSpecification priority equals: 11.
	self assert: viewSpecification string equals: nil.

	viewDataSource := phlowSpecificationsProvider
			getDeclarativeViewFor: #gtStringInTextEditorViewFor:.
	self
		assertUnstyledStringInViewSpecification: viewDataSource
		equals: 'hello world'.

	^ viewSpecification
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
textEditorViewWithStyledPhlowText
	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	| view |
	view := self
			assertTextualViewWithBasicStyledTextWithSelector: #gtStyledPhlowTextInEditorFor:
			title: 'Styled phlow text (editor)'
			priority: 11.3
			expectedText: GtRemotePhlowDeclarativeTestInspectable new styledPhlowText.

	self assert: view string equals: nil.

	^ view
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
textEditorViewWithStyledText
	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	| view |
	view := self
			assertTextualViewWithBasicStyledTextWithSelector: #gtStyledTextInEditorFor:
			title: 'Styled text (editor)'
			priority: 11.1
			expectedText: self expectedStyledText.

	self assert: view string equals: nil.

	^ view
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
textViewWithSimpleString
	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider viewDictionary viewSpecification viewDataSource |
	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	viewDictionary := phlowSpecificationsProvider
			getViewDeclaration: #gtStringInTextViewFor:.
	viewSpecification := GtPhlowViewSpecification fromDictionary: viewDictionary.

	self assert: viewSpecification title equals: 'String (text)'.
	self assert: viewSpecification priority equals: 10.

	viewDataSource := phlowSpecificationsProvider
			getDeclarativeViewFor: #gtStringInTextViewFor:.
	self
		assertUnstyledStringInViewSpecification: viewDataSource
		equals: 'hello world'.

	^ viewSpecification
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
textViewWithStyledPhlowText
	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	| view |
	view := self
			assertTextualViewWithBasicStyledTextWithSelector: #gtStyledPhlowTextFor:
			title: 'Styled phlow text'
			priority: 10.3
			expectedText: GtRemotePhlowDeclarativeTestInspectable new styledPhlowText.

	^ view
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
textViewWithStyledPhlowTextWithDecorations
	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	| view |
	view := self
			assertTextualViewWithBasicStyledTextWithSelector: #gtStyledPhlowTextWithDecorationsFor:
			title: 'Styled phlow text with decorations'
			priority: 10.6
			expectedText: self expectedStyledPhlowTextWithDecorations.

	^ view
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
textViewWithStyledText
	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	^ self
		assertTextualViewWithBasicStyledTextWithSelector: #gtStyledTextFor:
		title: 'Styled text'
		priority: 10.1
		expectedText: self expectedStyledText
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
treeView
	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider viewDictionary viewSpecification |
	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	viewDictionary := phlowSpecificationsProvider getViewDeclaration: #gtTreeFor:.
	viewSpecification := GtPhlowViewSpecification fromDictionary: viewDictionary.

	self assert: viewSpecification title equals: 'Tree'.
	self assert: viewSpecification priority equals: 30.

	self treeViewLazyCheck: phlowSpecificationsProvider.

	^ viewSpecification
%

category: 'private'
method: GtRemotePhlowDeclarativeViewsExamples
treeViewLazyCheck: viewProxy
	| viewDatasource obtainedNodes|

	viewDatasource := viewProxy getDeclarativeViewFor: #gtTreeFor:.
	self assert: viewDatasource retrieveTotalItemsCount equals: 5.
	
	obtainedNodes := self 
		assertNodesInTreeViewDatasource: viewDatasource 
		forObjects: ((1 to: 5) 
			collect: [ :x | x asString, ' number' ]).
			
	self 
		assertChildTreeNodesInViewDatasource: viewDatasource 
		forParentNode:  obtainedNodes third
		forObjects:  ((1 to: 2) 
			collect: [ :x | x asString, ' number' ]).
%

category: 'examples - views'
method: GtRemotePhlowDeclarativeViewsExamples
treeViewWithStyledText
	<gtExample>
	<after: #stopServer>
	<return: #SubclassResponsibility>
	| phlowSpecificationsProvider viewDictionary viewSpecification |
	phlowSpecificationsProvider := self remotePhlowSpecificationsProvider.
	viewDictionary := phlowSpecificationsProvider
			getViewDeclaration: #gtTreeWithStyledTextFor:.
	viewSpecification := GtPhlowViewSpecification fromDictionary: viewDictionary.

	self assert: viewSpecification title equals: 'Tree - with styled text'.
	self assert: viewSpecification priority equals: 30.1.

	self treeViewWithStyledTextLazyCheck: phlowSpecificationsProvider.

	^ viewSpecification
%

category: 'private'
method: GtRemotePhlowDeclarativeViewsExamples
treeViewWithStyledTextLazyCheck: viewProxy
	| viewDatasource obtainedNodes|

	viewDatasource := viewProxy getDeclarativeViewFor: #gtTreeWithStyledTextFor:.
	self assert: viewDatasource retrieveTotalItemsCount equals: 5.
	
	obtainedNodes := self 
		assertNodesInTreeViewDatasource: viewDatasource 
		forObjects: ((1 to: 5) 
			collect: [ :aNumber | self computeStyledTextForTreeNumber: aNumber ]).
			
	self 
		assertChildTreeNodesInViewDatasource: viewDatasource 
		forParentNode:  obtainedNodes third
		forObjects: ((1 to: 2) 
			collect: [ :aNumber | self computeStyledTextForTreeNumber: aNumber  ]).
%

! Class implementation for 'GtRemotePhlowDeclarativeViewsDirectViewedObjectExamples'

!		Class methods for 'GtRemotePhlowDeclarativeViewsDirectViewedObjectExamples'

category: 'testing'
classmethod: GtRemotePhlowDeclarativeViewsDirectViewedObjectExamples
isAbstract
	^ self name = #GtRemotePhlowDeclarativeViewsDirectViewedObjectExamples
%

!		Instance methods for 'GtRemotePhlowDeclarativeViewsDirectViewedObjectExamples'

category: 'accessing'
method: GtRemotePhlowDeclarativeViewsDirectViewedObjectExamples
getRemoteObject

	^ GtRemotePhlowDeclarativeTestInspectable new
%

! Class implementation for 'GtRemotePhlowDeclarativeViewsLocalViewedObjectExamples'

!		Instance methods for 'GtRemotePhlowDeclarativeViewsLocalViewedObjectExamples'

category: 'accessing'
method: GtRemotePhlowDeclarativeViewsLocalViewedObjectExamples
remoteViewedObject
	^ GtRemotePhlowViewedObject object: self remoteObject.
%

! Class implementation for 'GtRemotePhlowDeclarativeViewsRemoteViewedObjectExamples'

!		Instance methods for 'GtRemotePhlowDeclarativeViewsRemoteViewedObjectExamples'

category: 'accessing'
method: GtRemotePhlowDeclarativeViewsRemoteViewedObjectExamples
retrieveRemotePhlowSpecificationsProvider
	"Answer the GtRemotePhlowViewedObject proxy for the remote object"

	^ GtRemotePhlowViewedObject object: self remoteObject.
%

! Class implementation for 'GtRemotePhlowDeclarativeViewsProxySimulationExamples'

!		Instance methods for 'GtRemotePhlowDeclarativeViewsProxySimulationExamples'

category: 'accessing'
method: GtRemotePhlowDeclarativeViewsProxySimulationExamples
remoteObject
	<gtExample>
	<after: #stopServer>
	<return: #GtRemoteInspectionSimulation>
	| remoteObject |
	remoteObject := self getRemoteObject.

	^ remoteObject
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewsProxySimulationExamples
retrieveRemotePhlowSpecificationsProvider

	self remoteObject 
		remoteInspectorProxyDo: [ :aProxy | ^ aProxy ].
	^ nil
%

! Class implementation for 'GtRemotePhlowDeclarativeTestForCustomProxyInspectable'

!		Instance methods for 'GtRemotePhlowDeclarativeTestForCustomProxyInspectable'

category: 'inspection'
method: GtRemotePhlowDeclarativeTestForCustomProxyInspectable
gtButtonActionWithBothIconAndLabelFor: anAction
	<gtAction>
	
	^ anAction button
		tooltip: 'Inspect object';
		priority: 12;
		label: 'Remote';
		icon: (GtPhlowGlamorousVectorIconNameStencil new 
			iconName: #playinspect);
		action: [ :aButton |
			aButton phlow 
				spawnObject: self ]
%

category: 'inspection'
method: GtRemotePhlowDeclarativeTestForCustomProxyInspectable
gtColumnedListFor: aView
	<gtView>

	^aView columnedList
		title: 'Columned list';
		priority: 20;
		items: [ collectionOfObjects ];
		column: 'Value' text: [ :anObject | anObject ];
		column: 'Lowercase' text: [ :anObject | 
			anObject gtDisplayString asLowercase ] width: 100.
%

category: 'inspection'
method: GtRemotePhlowDeclarativeTestForCustomProxyInspectable
gtListFor: aView
	<gtView>

	^aView list
		title: 'List';
		priority: 15;
		items: [ collectionOfObjects ];
		itemText: [ :item | item ]
%

category: 'initialization'
method: GtRemotePhlowDeclarativeTestForCustomProxyInspectable
initialize  

	super initialize.

	collectionOfObjects := { 
		42. 
		'Hello World'. 
		DateAndTime readFrom: '2021-04-06T14:43:50.123456+02:00' readStream }.
%

! Class implementation for 'GtRemotePhlowDeclarativeTestInspectable'

!		Instance methods for 'GtRemotePhlowDeclarativeTestInspectable'

category: 'accessing'
method: GtRemotePhlowDeclarativeTestInspectable
collectionAt: anIndex put: anObject

	^collectionOfObjects at: anIndex put: anObject
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTestInspectable
collectionOfObjects
	^ collectionOfObjects
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTestInspectable
collectionOfObjects: anObject
	collectionOfObjects := anObject
%

category: 'actions'
method: GtRemotePhlowDeclarativeTestInspectable
gtButtonActionWithBothIconAndLabelFor: anAction
	<gtAction>
	
	^ anAction button
		tooltip: 'Inspect objects';
		priority: 12;
		label: 'Inspect';
		icon: (GtPhlowGlamorousVectorIconNameStencil new 
			iconName: #playinspect);
		action: [ :aButton |
			aButton phlow 
				spawnObject: collectionOfObjects ]
%

category: 'actions'
method: GtRemotePhlowDeclarativeTestInspectable
gtButtonActionWithIconFor: anAction
	<gtAction>
	
	^ anAction button
		tooltip: 'Inspect objects';
		priority: 11;
		icon: (GtPhlowGlamorousVectorIconNameStencil new 
			iconName: #playinspect);
		action: [ :aButton |
			aButton phlow 
				spawnObject: collectionOfObjects ]
%

category: 'actions'
method: GtRemotePhlowDeclarativeTestInspectable
gtButtonActionWithLabelFor: anAction
	<gtAction>
	
	^ anAction button
		tooltip: 'Inspect objects';
		priority: 10;
		label: 'Inspect 1';
		action: [ :aButton |
			aButton phlow 
				spawnObject: 1 ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtColumnedListFor: aView
	<gtView>

	^aView columnedList
		title: 'Columned list';
		priority: 20;
		items: [ collectionOfObjects ];
		column: 'Value' text: [ :anObject | anObject ];
		column: 'Lowercase' text: [ :anObject | 
			anObject gtDisplayString asLowercase ] width: 100.
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtColumnedListSpawnTextFor: aView
	<gtView>

	^aView columnedList
		title: 'Spawn text columned list';
		priority: 20.2;
		items: [ collectionOfObjects ];
		column: 'Value' text: [ :anObject | anObject ];
		column: 'Value with spawn' 
			text: [ :anObject | anObject ] 
			spawn: [ :anObject | anObject ];
		column: 'Class' 
			text: [ :anObject | anObject class name ] 
			spawn: [ :anObject | anObject class ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtColumnedListWithHorizontalScrollingFor: aView
	<gtView>

	^aView columnedList
		title: 'Columned list with scrolling' ;
		priority: 23;
		items: [ 1 to: 500 ];
		withHorizontalScrolling;
		column: 'Value' text: [ :anInteger | anInteger ] width: 250;
		column: 'Value + 1' text: [ :anInteger | anInteger + 1 ] width: 250;
		column: 'Value + 2' text: [ :anInteger | anInteger + 2 ] width: 250;
		column: 'Value + 3' text: [ :anInteger | anInteger + 3 ] width: 250;
		column: 'Value + 4' text: [ :anInteger | anInteger + 4 ] width: 250.
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtColumnedListWithStyledTextFor: aView
	<gtView>

	^aView columnedList
		title: 'Columned list - styled text';
		priority: 20.1;
		items: [ self objectsForListWithStyledText ];
		column: 'Plain' text: [ :anObject | anObject asString ];
		column: 'Styled' text: [ :anObject | anObject ];
		column: 'Number' 
			number: [ :anObject :index | (index*100) asRopedText bold  ].
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtColumnedListWithTypedColumnsFor: aView
	<gtView>

	^aView columnedList
		title: 'Columned list with typed columns';
		priority: 24;
		items: [ 1 to: 500 ];
		column: 'Text' textDo: [ :aColumn | 
			aColumn 
				item: [ :aNumber | aNumber asFloat ];
				format: [ :aFloat | 
					'+',aFloat asString ] ];
		column: 'Number' numberDo: [ :aColumn | 
			aColumn
				item: [ :aNumber | aNumber + 1 ];
				format: [ :aNumber | '+',aNumber asString ];
				width: 100 ];
		column: 'Icon Name' iconNameDo: [ :aColumn | 
			aColumn 
				item: [ :aNumber | aNumber asFloat ];
				iconName: [ :aFloat | 
					aFloat gtSystemIconName ];
				width: 75 ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtColumnedListWithTypedColumnsInGenericColumnFor: aView
	<gtView>

	^aView columnedList
		title: 'Columned list with typed columns - generic';
		priority: 24.1;
		items: [ 1 to: 500 ];
		column: 'Text' do: [ :aColumn | 
			aColumn 
				item: [ :aNumber | aNumber asFloat ];
				text: [ :aFloat | 
					'+',aFloat asString ] ];
		column: 'Icon Name' do: [ :aColumn | 
			aColumn 
				item: [ :aNumber | aNumber asFloat ];
				iconName: [ :aFloat | 
					aFloat gtSystemIconName ];
				width: 75 ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtColumnedTreeFor: aView
	<gtView>

	^aView columnedTree
		title: 'Columned Tree';
		priority: 35;
		items: [ 1 to: 5 ];
		children: [ :aNumber | 
			(aNumber // 2 = aNumber)
				ifTrue: [ #() ] 
				ifFalse: [
					aNumber // 2 to: (aNumber - 1) ] ];
		column: 'x' text: [ :aNumber | aNumber ];
		column: 'x * x' text: [ :aNumber | aNumber * aNumber ];
		send: [ :x | x + 1000 ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtColumnedWithObjectsFor: aView
	<gtView>

	^aView columnedList
		title: 'With Objects';
		priority: 55;
		items: [ {
			'New Instance' -> self class new initialize .
			'Class Object' -> self class.
			'Dictionary With Object Keys' -> {
				Object new -> 'one'.
				Object new -> 'two'} asDictionary.
			'Dictionary With Primitive Data' -> {
				1 -> 10.
				2 -> 20 }.
			'Array With Objects' -> (Array 
				with: Object new 
				with: Object new).
			'Array With Numbers' -> (Array with: 1 with: 2) } ];
		column: 'Key' text: [ :assoc | assoc key ];
		column: 'Object' text: [ :assoc | assoc value ];
		send: [ :assoc | assoc value ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtForwardListFor: aView
	<gtView>

	^aView forward
		title: 'Forward List';
		priority: 45;
		object: [ self ];
		view: #gtLargeListFor:;
		send: [ :x | x * 10 ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtForwardListTwiceFor: aView
	<gtView>

	^aView forward
		title: 'Forward List Twice';
		priority: 46;
		object: [ self ];
		view: #gtForwardListFor:;
		send: [ :x | x + 1 ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtForwardListWithSendFor: aView
	<gtView>

	^aView forward
		title: 'Forward List Send';
		priority: 46;
		object: [ self ];
		view: #gtLargeListFor:;
		send: [ :x | x * 10 + 2 ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtItemsWithBackgroundFor: aView
	<gtView>
	
	^ aView columnedList
		title: 'background: usage';
		priority: 50;
		items: [ {
			'Bob' -> -43.
			'Alice' -> 27.
			'Mike' -> 0.
			'Jane' -> -32.
			'Ben' -> 12
		} ];
		column: 'name' text: [ :x | x key ];
		column: 'value' do: [ :aColumn |
			aColumn
				text: [ :x | x value ];
				background: [ :v |
					v > 0
						ifTrue: [ 
							GtPhlowColor named: #green alpha: 0.3 ]
						ifFalse: [ v < 0
							ifTrue: [ 
								GtPhlowColor named: #red alpha: 0.3 ]
							ifFalse: [ 
								GtPhlowColor named: #gray alpha: 0.3] ] ] ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtLargeColumnedListFor: aView
	<gtView>

	^aView columnedList
		title: 'Large columned list' ;
		priority: 21;
		items: [ 1 to: 1022 ];
		column: 'Value' text: [ :anObject | anObject ];
		column: 'Value * 10' text: [ :anObject | (anObject * 10) asString asLowercase ] width: 100.
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtLargeColumnedListWithIndexFor: aView
	<gtView>

	^aView columnedList
		title: 'Large columned list with index';
		priority: 21;
		items: [ 1 to: 1022 ];
		column: 'Index' text: [ :anObject  :anIndex | anIndex ];
		column: 'Value' text: [ :anObject | anObject ].
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtLargeListFor: aView
	<gtView>

	^aView list
		title: 'Large list';
		priority: 20;
		items: [ 1 to: 1022 ];
		itemText: [ :item | item  ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtListFor: aView
	<gtView>

	^aView list
		title: 'List';
		priority: 15;
		items: [ collectionOfObjects ];
		itemText: [ :item | item ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtListWithSendFor: aView
	<gtView>

	^aView list
		title: 'List with send';
		priority: 15.2;
		items: [ collectionOfObjects ];
		itemText: [ :item | item ];
		send: [ :item | {item. item. item }]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtListWithStyledTextFor: aView
	<gtView>

	^aView list
		title: 'List - styled text';
		priority: 15.1;
		items: [ self objectsForListWithStyledText ];
		itemText: [ :item | item ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtStringInTextEditorViewFor: aView
	<gtView>
	
	^aView textEditor
		title: 'String (editor)';
		priority: 11;
		text: [ self string ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtStringInTextViewFor: aView
	<gtView>
	
	^aView text
		title: 'String (text)';
		priority: 10;
		text: [ self string ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtStyledPhlowTextFor: aView
	<gtView>
	
	^ aView text
		title: 'Styled phlow text';
		priority: 10.3;
		text: [ self styledPhlowText ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtStyledPhlowTextInEditorFor: aView
	<gtView>
	
	^ aView textEditor
		title: 'Styled phlow text (editor)';
		priority: 11.3;
		text: [ self styledPhlowText ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtStyledPhlowTextWithDecorationsFor: aView
	<gtView>
	
	^ aView text
		title: 'Styled phlow text with decorations';
		priority: 10.6;
		text: [ GtRemotePhlowDeclarativeTextTestInspectable new
			styledPhlowTextWithDecorations ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtStyledStringJsonInEditorFor: aView
	<gtView>
	
	^ aView textEditor
		title: 'Styled JSON';
		priority: 11.5;
		text: [ 
			'{
	"name":"Me", 
	"age":30, 
	"data":null
}' ];
		stylerParserClassName: #JSONParser
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtStyledStringUsingStylerFor: aView
	<gtView>
	
	^ aView textEditor
		title: 'Styled text (styler)';
		priority: 11.2;
		text: [ 'Now is the time' ];
		styler: [ GtRemotePhlowDummyTextStyler  new ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtStyledTextFor: aView
	<gtView>
	
	^ aView text
		title: 'Styled text';
		priority: 10.1;
		text: [ self styledText ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtStyledTextInEditorFor: aView
	<gtView>
	
	^ aView textEditor
		title: 'Styled text (editor)';
		priority: 11.1;
		text: [ self styledText ]
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtTreeFor: aView
	<gtView>

	^aView tree
		title: 'Tree';
		priority: 30;
		items: [ 1 to: 5 ];
		children: [ :aNumber | 
			(aNumber // 2 = aNumber)
				ifTrue: [ #() ] 
				ifFalse: [
					aNumber // 2 to: (aNumber - 1) ] ];
		itemText: [ :x | x asString, ' number']
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
gtTreeWithStyledTextFor: aView
	<gtView>

	^aView tree
		title: 'Tree - with styled text';
		priority: 30.1;
		items: [ 1 to: 5 ];
		children: [ :aNumber | 
			(aNumber // 2 = aNumber)
				ifTrue: [ #() ] 
				ifFalse: [
					aNumber // 2 to: (aNumber - 1) ] ];
		itemText: [ :x | 
			| computedString|
			computedString := x asString, ' number'.
			(x \\ 2) = 0 
				ifTrue: [
					computedString := computedString asRopedText
						bold;
						highlight: (GtPhlowColor named: #yellow) asColor ].
			computedString ]
%

category: 'initialization'
method: GtRemotePhlowDeclarativeTestInspectable
initialize 

	super initialize.
	string := 'hello world'.
	collectionOfObjects := { 
		42. 
		'Hello World'. 
		DateAndTime readFrom: '2021-04-06T14:43:50.123456+02:00' readStream }.
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTestInspectable
objectsForListWithStyledText
	^ { 
			'42' asRopedText bold.
			self styledHelloWorld.
			self styledText.
			self styledPhlowText
		}
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTestInspectable
objectsForListWithStyledTextForRemoteComparison
	^ { 
			'42' asRopedText bold.
			self styledHelloWorldForRemoteComparison.
			self styledPhlowTextForRemoteComparison.
			self styledPhlowTextForRemoteComparison
		}
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTestInspectable
printStringFor: anObject
	^ anObject printString
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTestInspectable
string

	^string
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTestInspectable
string: anObject
	string := anObject
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
styledHelloWorld
	| text |
	text := 'Hello World' asRopedText.
	
	(text from: 1 to: 5)
		highlight: (GtPhlowColor named: #yellow) asColor;
		fontSize: 20.
		
	^ text
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
styledHelloWorldForRemoteComparison
	| text |
	text := GtPhlowText forString: 'Hello World'.
	
	(text from: 1 to: 5)
		highlight: (GtPhlowColor named: #yellow) "asColor";
		fontSize: 20.
		
	^ text
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
styledPhlowText
	| text |
	text := GtPhlowText forString: 'Now is the time'.
	text glamorousCodeFont.
	(text from: 12 to: 15) fontSize: 20.
	(text from: 5 to: 6) highlight: (GtPhlowColor named: #yellow) .
	(text from: 1 to: 4) bold.
	(text from: 8 to: 10) foreground: (GtPhlowColor named: #red) .
	(text from: 12 to: 12) glamorousRegularFont.
	(text from: 1 to: 6) italic.
	(text from: 8 to: 15) thin.
	^ text
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
styledPhlowTextForRemoteComparison
	| text |
	text := GtPhlowText forString: 'Now is the time'.
	text glamorousCodeFont.
	(text from: 12 to: 15) fontSize: 20.
	(text from: 5 to: 6) highlight: (GtPhlowColor named: #yellow) "asColor".
	(text from: 1 to: 4) bold.
	(text from: 8 to: 10) foreground: (GtPhlowColor named: #red) "asColor".
	(text from: 12 to: 12) glamorousRegularFont.
	(text from: 1 to: 6) italic.
	(text from: 8 to: 15) thin.
	^ text
%

category: 'inspecting'
method: GtRemotePhlowDeclarativeTestInspectable
styledText
	| text |
	text := 'Now is the time' asRopedText.
	text glamorousCodeFont.
	(text from: 12 to: 15) fontSize: 20.
	(text from: 5 to: 6) highlight: (GtPhlowColor named: #yellow) asColor.
	(text from: 1 to: 4) bold.
	(text from: 8 to: 10) foreground: (GtPhlowColor named: #red) asColor.
	(text from: 12 to: 12) glamorousRegularFont.
	(text from: 1 to: 6) italic.
	(text from: 8 to: 15) thin.
	^ text
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTestInspectable
text

	^string asRopedText 
%

! Class implementation for 'GtRemotePhlowDeclarativeTestWithViewIncrement'

!		Instance methods for 'GtRemotePhlowDeclarativeTestWithViewIncrement'

category: 'accessing'
method: GtRemotePhlowDeclarativeTestWithViewIncrement
gtViewCurrentCounterColumnedListFor: aView
	<gtView>
	
	^ aView columnedList
		title: 'Counter (columned list)';
		priority: 3;
		items: [ { self nextCounter } ];
		column: 'Counter' text: [ 'Counter' ];
		column: 'Value' text: [ :each | each ]
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTestWithViewIncrement
gtViewCurrentCounterFor: aView
	<gtView>
	
	^ aView text
		title: 'Counter (text)';
		priority: 1;
		text: [ self nextCounter asString ] 
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTestWithViewIncrement
gtViewCurrentCounterListFor: aView
	<gtView>
	
	^ aView list
		title: 'Counter (list)';
		priority: 2;
		items: [ {self nextCounter} ]
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTestWithViewIncrement
nextCounter
	^ counter := counter 
		ifNil: [ 1 ]
		ifNotNil: [ counter + 1.]
%

! Class implementation for 'GtRemotePhlowDeclarativeTextTestInspectable'

!		Instance methods for 'GtRemotePhlowDeclarativeTextTestInspectable'

category: 'views'
method: GtRemotePhlowDeclarativeTextTestInspectable
gtStyledPhlowTextWithDecorationsFor: aView
	<gtView>
	
	^ aView text
		title: 'Styled phlow text with decorations';
		priority: 10.3;
		text: [ self styledPhlowTextWithDecorations ]
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTextTestInspectable
styledPhlowTextWithDecorations
	<gtExample>
	<return: #GtPhlowRunBasedText>
	| text |
	text := GtPhlowText
			forString: 'Examples of text decorations:

Different styles:
	Solid style
	Dashed style
	Dotted style
	Wavy style
	
Different types:
	Line Through
	Overline
	Underline
	
Different color:
	Blue color
	
Different thickness:
	Thickness 3
	
Combined decorations:
	Several decorations
'.

	(text from: 51 to: 61)
		decorationDo: [ :aDecoration | 
			aDecoration
				solid;
				underline ].
	(text from: 64 to: 75)
		decorationDo: [ :aDecoration | 
			aDecoration
				dashed;
				underline ].
	(text from: 78 to: 89)
		decorationDo: [ :aDecoration | 
			aDecoration
				dotted;
				underline ].
	(text from: 92 to: 101)
		decorationDo: [ :aDecoration | 
			aDecoration
				wavy;
				underline ].

	(text from: 123 to: 134)
		decorationDo: [ :aDecoration | 
			aDecoration
				solid;
				lineThrough ].
	(text from: 137 to: 144)
		decorationDo: [ :aDecoration | 
			aDecoration
				solid;
				overline ].
	(text from: 147 to: 155)
		decorationDo: [ :aDecoration | 
			aDecoration
				solid;
				underline ].

	(text from: 177 to: 186)
		decorationDo: [ :aDecoration | 
			aDecoration
				underline;
				color: (GtPhlowColor named: #blue) ].

	(text from: 212 to: 222)
		decorationDo: [ :aDecoration | 
			aDecoration
				underline;
				thickness: 3 ].

	(text from: 249 to: 267)
		decorationDo: [ :aDecoration | 
			aDecoration
				underline;
				overline;
				dashed;
				thickness: 3;
				color: (GtPhlowColor named: #blue) ].

	^ text
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTextTestInspectable
styledPhlowTextWithDecorationsForRemoteComparison
	<gtExample>
	<return: #GtPhlowRunBasedText>
	| text |
	text := GtPhlowText
			forString: ('Examples of text decorations:

Different styles:
	Solid style
	Dashed style
	Dotted style
	Wavy style
	
Different types:
	Line Through
	Overline
	Underline
	
Different color:
	Blue color
	
Different thickness:
	Thickness 3
	
Combined decorations:
	Several decorations
' copyReplaceAll: String cr with: String lf).

	(text from: 51 to: 61)
		decorationDo: [ :aDecoration | 
			aDecoration
				solid;
				underline ].
	(text from: 64 to: 75)
		decorationDo: [ :aDecoration | 
			aDecoration
				dashed;
				underline ].
	(text from: 78 to: 89)
		decorationDo: [ :aDecoration | 
			aDecoration
				dotted;
				underline ].
	(text from: 92 to: 101)
		decorationDo: [ :aDecoration | 
			aDecoration
				wavy;
				underline ].

	(text from: 123 to: 134)
		decorationDo: [ :aDecoration | 
			aDecoration
				solid;
				lineThrough ].
	(text from: 137 to: 144)
		decorationDo: [ :aDecoration | 
			aDecoration
				solid;
				overline ].
	(text from: 147 to: 155)
		decorationDo: [ :aDecoration | 
			aDecoration
				solid;
				underline ].

	(text from: 177 to: 186)
		decorationDo: [ :aDecoration | 
			aDecoration
				underline;
				color: (GtPhlowColor named: #blue) ].

	(text from: 212 to: 222)
		decorationDo: [ :aDecoration | 
			aDecoration
				underline;
				thickness: 3 ].

	(text from: 249 to: 267)
		decorationDo: [ :aDecoration | 
			aDecoration
				underline;
				overline;
				dashed;
				thickness: 3;
				color: (GtPhlowColor named: #blue) ].

	^ text
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTextTestInspectable
styledPhlowTextWithHighlights
	<gtExample>
	<return: #GtPhlowRunBasedText>
	| text |
	text := GtPhlowText
			forString: 'Examples of text styling:

Emphases:
	Italic text
	Oblique text
	Normal text

Colors:
	Blue foreground
	Green highlight
	
Weight:
	Thin text
	Bold text
	
Size:
	8px text
	28px text
	
Fonts:
	Helvetica font
	Source Sans Pro font
	
Combined styles:
	Several styles
'.

	(text from: 39 to: 49) italic.
	(text from: 52 to: 63) oblique.
	(text from: 66 to: 76) normal.

	(text from: 88 to: 102) foreground: (GtPhlowColor named: #blue).
	(text from: 105 to: 119) highlight: (GtPhlowColor named: #green).

	(text from: 132 to: 140) thin.
	(text from: 143 to: 152) bold.

	(text from: 162 to: 169) fontSize: 8.
	(text from: 172 to: 180) fontSize: 28.

	(text from: 191 to: 205) fontName: 'Helvetica'.
	(text from: 208 to: 226) fontName: 'Source Sans Pro'.

	(text from: 249 to: 262)
		oblique;
		bold;
		fontSize: 18;
		foreground: (GtPhlowColor named: #red);
		fontName: 'Source Sans Pro'.

	^ text
%

! Class implementation for 'GtRemotePhlowDeclarativeTreeExamples'

!		Instance methods for 'GtRemotePhlowDeclarativeTreeExamples'

category: 'examples'
method: GtRemotePhlowDeclarativeTreeExamples
emptyTree
	<gtExample>
	<return: #GtRemotePhlowTreeView>
	| view |
	view := GtRemotePhlowProtoView new tree.
	self assert: view class equals: GtRemotePhlowTreeView.
	^ view
%

category: 'examples'
method: GtRemotePhlowDeclarativeTreeExamples
expectedFormattedItems
	^ (Array new: 4)
		at: 1
			put: (Dictionary new
					add: #nodeValue
							-> (Dictionary new
									add: #valueTypeName -> 'textualValue';
									add: #itemText -> '1';
									yourself);
					add: #nodeId -> 1;
					yourself);
		at: 2
			put: (Dictionary new
					add: #nodeValue
							-> (Dictionary new
									add: #valueTypeName -> 'textualValue';
									add: #itemText -> '2';
									yourself);
					add: #nodeId -> 2;
					yourself);
		at: 3
			put: (Dictionary new
					add: #nodeValue
							-> (Dictionary new
									add: #valueTypeName -> 'textualValue';
									add: #itemText -> '3';
									yourself);
					add: #nodeId -> 3;
					yourself);
		at: 4
			put: (Dictionary new
					add: #nodeValue
							-> (Dictionary new
									add: #valueTypeName -> 'textualValue';
									add: #itemText -> '4';
									yourself);
					add: #nodeId -> 4;
					yourself);
		yourself
%

category: 'examples'
method: GtRemotePhlowDeclarativeTreeExamples
sentItemAt
	"<gtExample>"
	| treeView declarativeView sentItem sentItems |

	treeView := self treeViewWithItemsAndChildren.
	declarativeView := treeView asGtDeclarativeView.
	sentItems := (1 to: 4) collect: [ :i | treeView sentItemAt: { i } ].
	self assert: sentItems equals: #(1 2 3 4).
	sentItem := treeView sentItemAt: #(2 1).
	self assert: sentItem equals: 1.
	sentItem := treeView sentItemAt: #(3 1).
	self assert: sentItem equals: 1.
	sentItem := treeView sentItemAt: #(4 1).
	self assert: sentItem equals: 1.
	sentItem := treeView sentItemAt: #(4 2).
	self assert: sentItem equals: 2.
	sentItem := treeView sentItemAt: #(4 2 1).
	self assert: sentItem equals: 1.
	^ treeView
%

category: 'examples'
method: GtRemotePhlowDeclarativeTreeExamples
treeViewWithItemsAndChildren
	<gtExample>
	<return: #GtRemotePhlowTreeView>
	| aView declarativeView |
	aView := self emptyTree.
	aView
		items: [ 1 to: 4 ];
		itemText: [ :aNumber | aNumber asString ];
		children: [ :aNumber | aNumber = 0 ifTrue: [ #() ] ifFalse: [ 1 to: aNumber // 2 ] ].
	declarativeView := aView asGtDeclarativeView.

	self assert: declarativeView retrieveTotalItemsCount equals: 4.
	self
		assert: declarativeView retriveFormattedItems
		equals: self expectedFormattedItems.

	^ aView
%

! Class implementation for 'GtRemotePhlowDeclarativeViewDataSource'

!		Class methods for 'GtRemotePhlowDeclarativeViewDataSource'

category: 'as yet unclassified'
classmethod: GtRemotePhlowDeclarativeViewDataSource
forPhlowView: aView
	^ self new
		phlowView: aView
%

!		Instance methods for 'GtRemotePhlowDeclarativeViewDataSource'

category: 'accessing'
method: GtRemotePhlowDeclarativeViewDataSource
definingMethod
	^ self phlowView definingMethod
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewDataSource
phlowView
	^ phlowView
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewDataSource
phlowView: anObject
	phlowView := anObject
%

! Class implementation for 'GtRemotePhlowDeclarativeForwardViewDataSource'

!		Instance methods for 'GtRemotePhlowDeclarativeForwardViewDataSource'

category: 'api'
method: GtRemotePhlowDeclarativeForwardViewDataSource
getDeclarativeViewFor: aViewSelector
	"This mimics the API provided by the inspecotr proxy to initialize views.
	In this case for forwarded views, we allways return the datasource for 
	the target views, as this is the only view the client will request.
	
	We do not check right now if the selector matches, as in some
	cases the method selector is not set correctly in the specification."

	^ cachedViewSpecification
%

category: 'api'
method: GtRemotePhlowDeclarativeForwardViewDataSource
retrieveForwardTargetDataSource
	^ cachedViewSpecification phlowDataSource
%

category: 'api'
method: GtRemotePhlowDeclarativeForwardViewDataSource
retrieveViewSpecificationForForwarding
	| computedPhlowView |
	computedPhlowView := self phlowView computeForwardedView.
	self phlowView hasTransformation ifTrue: [ 
		computedPhlowView 
			copyTransformationFrom: self phlowView transformation ].
			
	cachedViewSpecification := computedPhlowView asGtDeclarativeView.
	cachedViewSpecification methodSelector: computedPhlowView definingSelector.
	
	^ cachedViewSpecification asDictionaryForExport
%

! Class implementation for 'GtRemotePhlowDeclarativeTextualViewDataSource'

!		Instance methods for 'GtRemotePhlowDeclarativeTextualViewDataSource'

category: 'accessing'
method: GtRemotePhlowDeclarativeTextualViewDataSource
computeText
	| computedText stylerSpecification highlight |
	computedText := self phlowView textBuilder value asRopedText.
	stylerSpecification := self
			createRemotePhlowStylerSpecificationForText: computedText.

	stylerSpecification
		ifNil: [ stylerSpecification := GtRemotePhlowTextAttributeRunsStylerSpecification new
					attributeRuns: computedText extractRemotePhlowRuns ].

	self phlowView highlighterSpecification
		ifNotNil: [ :spec | highlight := spec value ].

	^ GtRemotePhlowStylableText new
		string: computedText asString;
		stylerSpecification: stylerSpecification;
		highlight: highlight
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTextualViewDataSource
createRemotePhlowStylerSpecificationForText: aText
	| stylerSpecification |
	
	stylerSpecification := self phlowView stylerSpecification.
	stylerSpecification ifNil: [ ^ nil ].
	stylerSpecification canAffectText ifFalse: [ ^ nil ].
	
	^ stylerSpecification 
		convertToSerializableSpecificationForText: aText.
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTextualViewDataSource
getText 
	^ self computeText asDictionaryForExport
%

category: 'accessing'
method: GtRemotePhlowDeclarativeTextualViewDataSource
retrieveStylableText 
	^ self computeText asDictionaryForExport
%

! Class implementation for 'GtRemotePhlowDeclarativeViewListingDataSource'

!		Instance methods for 'GtRemotePhlowDeclarativeViewListingDataSource'

category: 'accessing'
method: GtRemotePhlowDeclarativeViewListingDataSource
buildMainNodeForObject: anObject atIndex: anIndex 
	^ self buildNodeForObject: anObject atIndex: anIndex 
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewListingDataSource
buildNodeForObject: anObject atIndex: anIndex 
	^ self instantiateNode
		targetObject: anObject;
		nodeId: anIndex;
		nodeValue: (self 
			computeNodeValueForObject: anObject 
			atIndex: anIndex)
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewListingDataSource
cachedNodes
	^ cachedNodes ifNil: [
		cachedNodes := OrderedCollection new ]
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewListingDataSource
computeNodeValueForObject: anObject atIndex: anIndex 
	^ self valueBuilder 
		computeNodeValueForObject: anObject 
		atIndex: anIndex 
%

category: 'api'
method: GtRemotePhlowDeclarativeViewListingDataSource
flushItemsIterator
	"Flush the items iterator to force the displayed values to be regenerated"

	itemsIterator := nil.
	cachedNodes := nil.
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewListingDataSource
formatItem: anObject atIndex: anIndex
	self subclassResponsibility
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewListingDataSource
forNodesFrom: aStartIndex to: anEndIndex withIndexDo: aBlock
	| startIndex stopIndex |
	
	"The interval of nodes that need to be computed and send back to the client"
	startIndex := 1 max: aStartIndex.
	stopIndex  := self itemsIterator totalItemsCount min: anEndIndex.
	
	"Increase the size of the cache to ensure that it can hold all nodes, if required."
	self cachedNodes size + 1 to: stopIndex do: [ :index |
		self cachedNodes add: nil ].
	
	"Iterate over the given interval, 
	and create the nodes that do not have already a cached value."
	self itemsIterator 
		forElementsFrom: startIndex 
		to: stopIndex 
		withIndexDo: [ :anObject :anIndex | 
			(self cachedNodes at: anIndex) ifNil: [
					| newValueNode |
					newValueNode := self 
						buildMainNodeForObject: anObject atIndex: anIndex.
					self cachedNodes at: anIndex put: newValueNode ].
			aBlock cull: (self cachedNodes at: anIndex) cull: anIndex ]
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewListingDataSource
gtViewCachedNodesFor: aView 
	<gtView>
	cachedNodes ifNil: [ ^ aView empty ].
	
	^ aView columnedTree
		title: 'Cached Nodes';
		items: [ cachedNodes ];
		children: [ :aNode | 
			aNode childNodes ifNil: [ #() ] ];
		column: 'Id' text: [ :aNode | aNode nodeId ];
		column: 'Value' text: [ :aNode | aNode nodeValue ]
%

category: 'gt - extensions'
method: GtRemotePhlowDeclarativeViewListingDataSource
instantiateNode
	^ self subclassResponsibility
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewListingDataSource
instantiateValueBuilder
	^ GtRemotePhlowItemBuilder new
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewListingDataSource
itemsIterator
	^ itemsIterator ifNil: [ 
		itemsIterator := self phlowView 
			itemsProviderComputation value asGPhlowItemsIterator ]
%

category: 'api - data retrival'
method: GtRemotePhlowDeclarativeViewListingDataSource
retrieveItems: anItemsCount fromIndex: startIndex
	| computedNodes endIndex |

	computedNodes := OrderedCollection new: anItemsCount.
	endIndex := startIndex + anItemsCount - 1.
	
	self 
		forNodesFrom: startIndex 
		to: endIndex 
		withIndexDo: [ :aNode |
			computedNodes add: aNode ].
	
	^ computedNodes asArray collect: [ :aNodeValue |
		aNodeValue asDictionaryForExport ]
%

category: 'api - data retrival'
method: GtRemotePhlowDeclarativeViewListingDataSource
retrieveSentItemAt: aSelectionIndex
	"Answer the raw value at the supplied index"
	
	self  
		forNodesFrom: aSelectionIndex 
		to: aSelectionIndex 
		withIndexDo: [ :aNode :anItemIndex |
			^ self phlowView transformation 
				transformedValueFrom: aNode targetObject
				selection: aSelectionIndex ].
	^ nil
%

category: 'api - data retrival'
method: GtRemotePhlowDeclarativeViewListingDataSource
retrieveTotalItemsCount
	^ self itemsIterator totalItemsCount
%

category: 'api - data retrival'
method: GtRemotePhlowDeclarativeViewListingDataSource
retriveSentItemAt: aSelectionIndex
	"Answer the raw value at the supplied index"
	
	self  
		forNodesFrom: aSelectionIndex 
		to: aSelectionIndex 
		withIndexDo: [ :aNode :anItemIndex |
			^ self phlowView transformation 
				transformedValueFrom: aNode targetObject
				selection: aSelectionIndex ].
	^ nil
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewListingDataSource
valueBuilder
	^ cachedValueBuilder ifNil: [
		cachedValueBuilder := self instantiateValueBuilder
			phlowView:  self phlowView]
%

! Class implementation for 'GtRemotePhlowDeclarativeViewColumnedListDataSource'

!		Instance methods for 'GtRemotePhlowDeclarativeViewColumnedListDataSource'

category: 'accessing'
method: GtRemotePhlowDeclarativeViewColumnedListDataSource
instantiateNode
	^ GtRemotePhlowColumnedTreeNode new
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewColumnedListDataSource
instantiateValueBuilder
	^ GtRemotePhlowRowBuilder new
%

category: 'api'
method: GtRemotePhlowDeclarativeViewColumnedListDataSource
retriveSpawnedObjectAtRow: aRowIndex column: aColumnIndex	
	self itemsIterator 
		forElementsFrom: aRowIndex 
		to: aRowIndex 
		withIndexDo: [ :aRowObject :anItemIndex |
			| aColumn aSpawnedObject |
			
			aColumn := self phlowView columns at: aColumnIndex.
			aSpawnedObject := aColumn isSpawningObject
				ifTrue: [ aColumn spawnObjectComputation 
					cull: aRowObject cull: anItemIndex  ]
				ifFalse: [ aRowObject ].
			^ aSpawnedObject ].
	^ nil
%

! Class implementation for 'GtRemotePhlowDeclarativeViewListDataSource'

!		Instance methods for 'GtRemotePhlowDeclarativeViewListDataSource'

category: 'accessing'
method: GtRemotePhlowDeclarativeViewListDataSource
instantiateNode
	^ GtRemotePhlowDataNode new
%

! Class implementation for 'GtRemotePhlowDeclarativeViewTreeDataSource'

!		Instance methods for 'GtRemotePhlowDeclarativeViewTreeDataSource'

category: 'accessing'
method: GtRemotePhlowDeclarativeViewTreeDataSource
buildChildNodesFor: aNode 
	| childNodes |
	
	childNodes := OrderedCollection new.
	(self phlowView 
		childrenBuilder cull: aNode targetObject) 
			withIndexDo: [ :anObject :anIndex | 
				childNodes add: (self 
					buildNodeForObject: anObject 
					atIndex: anIndex) ].
		
	^ childNodes asArray
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewTreeDataSource
buildChildrenForNode: aNode atPath: aNodePath
	self ensureChildrenForNode: aNode.
	aNodePath isEmpty ifTrue: [ 
		^ aNode childNodes ].
		
	^ self 
		buildChildrenForNode: (aNode childNodes at: aNodePath first)
		atPath: aNodePath allButFirst
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewTreeDataSource
ensureChildrenForNode: aNode 
	aNode childNodes ifNotNil: [ ^ self ].
	
	aNode childNodes: (self buildChildNodesFor: aNode)
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewTreeDataSource
instantiateNode
	^ GtRemotePhlowTreeNode new
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewTreeDataSource
locateNode: aNode atPath: aNodePath
	aNodePath isEmpty ifTrue: [ 
		^ aNode ].
		
	^ self 
		locateNode: (aNode childNodes at: aNodePath first)
		atPath: aNodePath allButFirst
%

category: 'api - data retrival'
method: GtRemotePhlowDeclarativeViewTreeDataSource
retrieveChildrenForNodeAtPath: aNodePath
	self 
		forNodesFrom: aNodePath first 
		to: aNodePath first 
		withIndexDo: [ :aNode |
			^ (self 
				buildChildrenForNode: aNode 
				atPath: aNodePath allButFirst)
					collect: [ :aNodeValue |
						aNodeValue asDictionaryForExport ] ].
	^ #()
%

category: 'api - data retrival'
method: GtRemotePhlowDeclarativeViewTreeDataSource
retrieveSentItemAtPath: aNodePath
	self 
		forNodesFrom: aNodePath first 
		to: aNodePath first 
		withIndexDo: [ :aNode :aSelectionIndex |
			| targetNode targetObject |
			targetNode := self 
				locateNode: aNode 
				atPath: aNodePath allButFirst.
			targetObject := targetNode targetObject.
			^ self phlowView transformation 
				transformedValueFrom: targetObject
				selection: aSelectionIndex ].
	^ nil
%

category: 'api - data retrival'
method: GtRemotePhlowDeclarativeViewTreeDataSource
retriveSentItemAtPath: aNodePath
	self 
		forNodesFrom: aNodePath first 
		to: aNodePath first 
		withIndexDo: [ :aNode :aSelectionIndex |
			| targetNode targetObject |
			targetNode := self 
				locateNode: aNode 
				atPath: aNodePath allButFirst.
			targetObject := targetNode targetObject.
			^ self phlowView transformation 
				transformedValueFrom: targetObject
				selection: aSelectionIndex ].
	^ nil
%

! Class implementation for 'GtRemotePhlowDeclarativeViewColumnedTreeDataSource'

!		Instance methods for 'GtRemotePhlowDeclarativeViewColumnedTreeDataSource'

category: 'accessing'
method: GtRemotePhlowDeclarativeViewColumnedTreeDataSource
instantiateNode
	^ GtRemotePhlowColumnedTreeNode new
%

category: 'accessing'
method: GtRemotePhlowDeclarativeViewColumnedTreeDataSource
instantiateValueBuilder
	^ GtRemotePhlowRowBuilder new
%

! Class implementation for 'GtRemotePhlowDummyTextStyler'

!		Instance methods for 'GtRemotePhlowDummyTextStyler'

category: 'accessing'
method: GtRemotePhlowDummyTextStyler
affectsText
	^ true
%

category: 'accessing'
method: GtRemotePhlowDummyTextStyler
style: aText

	aText glamorousCodeFont.
	(aText from: 12 to: 15) fontSize: 20.
	(aText from: 5 to: 6) highlight: (GtPhlowColor named: #yellow) asColor.
	(aText from: 1 to: 4) bold.
	(aText from: 8 to: 10) foreground: (GtPhlowColor named: #red) asColor.
	(aText from: 12 to: 12) glamorousRegularFont.
	(aText from: 1 to: 6) italic.
	(aText from: 8 to: 15) thin.
	^ aText 
%

! Class implementation for 'GtRemotePhlowNodeValue'

!		Instance methods for 'GtRemotePhlowNodeValue'

category: 'printing'
method: GtRemotePhlowNodeValue
descriptionOn: aStream 
	
%

category: 'printing'
method: GtRemotePhlowNodeValue
printOn: aStream 
	super printOn: aStream .
	
	aStream parenthesize: [
		self descriptionOn: aStream ]
%

! Class implementation for 'GtRemotePhlowItemValue'

!		Class methods for 'GtRemotePhlowItemValue'

category: 'instance creation'
classmethod: GtRemotePhlowItemValue
fromJSONDictionary: aDictionary
	"Answer an instance of the receiver from the supplied dictionary."
	| valueClass |

	valueClass := self valueTypeFrom: aDictionary.
		
	^ valueClass new
		initializeFromJSONDictionary: aDictionary
%

category: 'instance creation'
classmethod: GtRemotePhlowItemValue
mySubclasses
	"LW hook"
	^self allSubclasses
%

category: 'instance creation'
classmethod: GtRemotePhlowItemValue
valueTypeFrom: aDictionary
	^aDictionary
		at: #valueTypeName
		ifPresent: 
			[:aTypeName |
			"We do a manual check for the types that are by default in GT, 
			as it will be faster; this is called for every value in a table.
			If the type is not found we iterate subclasses ."
			| detectedType |
			detectedType := nil.
			aTypeName = GtRemotePhlowItemTextualValue valueTypeName
				ifTrue: [detectedType := GtRemotePhlowItemTextualValue].
			aTypeName = GtRemotePhlowItemErrorValue valueTypeName
				ifTrue: [detectedType := GtRemotePhlowItemErrorValue].
			detectedType ifNotNil: [^detectedType].
			GtRemotePhlowItemValue mySubclasses
				do: [:aSubclass | aSubclass valueTypeName = aTypeName ifTrue: [^aSubclass]].
			GtRemotePhlowItemValue]
		ifAbsent: [GtRemotePhlowItemValue]
%

category: 'accessing'
classmethod: GtRemotePhlowItemValue
valueTypeName
	^ 'item'
%

!		Instance methods for 'GtRemotePhlowItemValue'

category: 'comparing'
method: GtRemotePhlowItemValue
= anObject
	self == anObject ifTrue: [ ^ true ].
	self class = anObject class ifFalse: [ ^ false ].
	
	^ self background = anObject background
%

category: 'converting'
method: GtRemotePhlowItemValue
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation"

	| data | 
	
	data := Dictionary new 
		at: #valueTypeName put: self class valueTypeName;
		yourself.
		
	"We check the attribute here instead of using the accessor,
	as subclasses can provide default value in case the background is nil"
	background ifNotNil: [ :aBackground |
		data at: #background put: aBackground asDictionaryForExport  ].
	
	^ data
%

category: 'accessing'
method: GtRemotePhlowItemValue
background
	^ background
%

category: 'accessing'
method: GtRemotePhlowItemValue
background: anObject
	background := anObject
%

category: 'printing'
method: GtRemotePhlowItemValue
descriptionOn: aStream 
	self printBackgroundOn: aStream.
%

category: 'comparing'
method: GtRemotePhlowItemValue
hash 
	^ 31 hash bitXor: self background hash
%

category: 'initialization'
method: GtRemotePhlowItemValue
initializeFromJSONDictionary: aDictionary
	aDictionary 
		at: #background 
		ifPresent: [ :aBackgroundValue |
			self background: (GtPhlowColor fromJSONDictionary: aBackgroundValue) ]
%

category: 'testing'
method: GtRemotePhlowItemValue
isErrorItemValue
	^ false
%

category: 'printing'
method: GtRemotePhlowItemValue
printBackgroundOn: aStream 
	self background ifNotNil: [ :aBackground |
		aStream 
			<< ', background: ';
			print: aBackground ]
%

! Class implementation for 'GtRemotePhlowItemTextualValue'

!		Class methods for 'GtRemotePhlowItemTextualValue'

category: 'accessing'
classmethod: GtRemotePhlowItemTextualValue
valueTypeName
	^ 'textualValue'
%

!		Instance methods for 'GtRemotePhlowItemTextualValue'

category: 'comparing'
method: GtRemotePhlowItemTextualValue
= anObject
	super = anObject  ifFalse: [ ^ false ].
	
	^ self itemText = anObject itemText
%

category: 'converting'
method: GtRemotePhlowItemTextualValue
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation"

	| data currentText currentTextData | 
	
	data := super asDictionaryForExport.
	currentText := self itemText.
	currentTextData := (currentText isNil or: [currentText isString])
		ifTrue: [ currentText ] 
		ifFalse: [ currentText asDictionaryForExport ].
	
	data at: #itemText put: currentTextData.
	
	^ data
%

category: 'printing'
method: GtRemotePhlowItemTextualValue
descriptionOn: aStream 
	
	aStream print: self itemText.
	super descriptionOn: aStream 
%

category: 'comparing'
method: GtRemotePhlowItemTextualValue
hash 
	^ super hash bitXor: self itemText hash
%

category: 'initialization'
method: GtRemotePhlowItemTextualValue
initializeFromJSONDictionary: aDictionary
	| textData |
	super initializeFromJSONDictionary: aDictionary.
	
	textData := aDictionary at: #itemText.
	self itemText: ((textData isNil or: [ textData isString ]) 
		ifTrue: [ textData ]
		ifFalse: [ GtPhlowRunBasedText fromJSONDictionary: textData ])
	
%

category: 'accessing'
method: GtRemotePhlowItemTextualValue
itemText
	^ itemText
%

category: 'accessing'
method: GtRemotePhlowItemTextualValue
itemText: anObject
	itemText := anObject
%

! Class implementation for 'GtRemotePhlowItemErrorValue'

!		Class methods for 'GtRemotePhlowItemErrorValue'

category: 'accessing'
classmethod: GtRemotePhlowItemErrorValue
valueTypeName
	^ 'errorValue'
%

!		Instance methods for 'GtRemotePhlowItemErrorValue'

category: 'accessing'
method: GtRemotePhlowItemErrorValue
background
	^ super background ifNil: [
		"#errorBackgroundColor"
		GtPhlowColor  
			r: 1.0 
			g: 0.4701857282502444 
			b: 0.458455522971652   ]
%

category: 'testing'
method: GtRemotePhlowItemErrorValue
isErrorItemValue
	^ true
%

! Class implementation for 'GtRemotePhlowRowValue'

!		Class methods for 'GtRemotePhlowRowValue'

category: 'instance creation'
classmethod: GtRemotePhlowRowValue
fromJSONDictionary: aDictionary
	"Answer an instance of the receiver from the supplied dictionary."

	^self new 
		columnValues: (aDictionary 
			at: #columnValues 
			ifPresent: [ :aCollection |
				aCollection collect: [ :anItemValueDictionary |
					GtRemotePhlowItemValue fromJSONDictionary: anItemValueDictionary ] ]
			ifAbsent: [ nil ]);
		yourself
%

!		Instance methods for 'GtRemotePhlowRowValue'

category: 'comparing'
method: GtRemotePhlowRowValue
= anObject
	self == anObject ifTrue: [ ^ true ].
	self class = anObject class ifFalse: [ ^ false ].
	
	^ self columnValues = anObject columnValues
%

category: 'converting'
method: GtRemotePhlowRowValue
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation"

	| data| 
	data := Dictionary new 
		at: #columnValues put: (self columnValues 
			collect: [ :aColumnValue | aColumnValue asDictionaryForExport ]);
		yourself.
	
	^ data
%

category: 'accessing'
method: GtRemotePhlowRowValue
columnValueAt: anIndex
	^ self columnValues at: anIndex
%

category: 'accessing'
method: GtRemotePhlowRowValue
columnValues
	^ columnValues
%

category: 'accessing'
method: GtRemotePhlowRowValue
columnValues: anObject
	columnValues := anObject
%

category: 'printing'
method: GtRemotePhlowRowValue
descriptionOn: aStream 
	aStream 
		print: self columnValues size;
		<< ' columns'
%

category: 'gt - extensions'
method: GtRemotePhlowRowValue
gtViewColumnValuesFor: aView
	<gtView>
	
	^ aView list
		title: 'Column Values';
		priority: 10;
		items: [ self columnValues]
%

category: 'comparing'
method: GtRemotePhlowRowValue
hash 
	^ self columnValues hash
%

! Class implementation for 'GtRemotePhlowNodeValueBuilder'

!		Instance methods for 'GtRemotePhlowNodeValueBuilder'

category: 'accessing'
method: GtRemotePhlowNodeValueBuilder
computeNodeValueForObject: anObject atIndex: anIndex 
	^ self subclassResponsibility
%

category: 'accessing'
method: GtRemotePhlowNodeValueBuilder
phlowView
	^ phlowView
%

category: 'accessing'
method: GtRemotePhlowNodeValueBuilder
phlowView: anObject
	phlowView := anObject
%

category: 'building'
method: GtRemotePhlowNodeValueBuilder
withErrorHandlingCompute: aBlock
	^ aBlock
		on: Error 
		do: [ :anError |
			GtRemotePhlowItemErrorValue new
				itemText: anError description ] 
%

! Class implementation for 'GtRemotePhlowItemBuilder'

!		Instance methods for 'GtRemotePhlowItemBuilder'

category: 'building'
method: GtRemotePhlowItemBuilder
basicComputeNodeValueForObject: anObject atIndex: anIndex 
	^ GtRemotePhlowItemTextualValue new 
		itemText: (self 
			formatItem: anObject 
			atIndex: anIndex)
%

category: 'building'
method: GtRemotePhlowItemBuilder
computeNodeValueForObject: anObject atIndex: anIndex 
	^ self withErrorHandlingCompute: [ 
		self basicComputeNodeValueForObject: anObject atIndex: anIndex ] 
%

category: 'accessing'
method: GtRemotePhlowItemBuilder
formatItem: anObject atIndex: rowIndex
	| computedValue |
	computedValue := self phlowView itemComputation 
		cull: anObject cull: rowIndex.
		
	"This check is an optimisation for not creating text values if not needed."
	^ computedValue isString 
		ifTrue: [ computedValue ]
		ifFalse: [ computedValue gtDisplayText ]
%

! Class implementation for 'GtRemotePhlowRowBuilder'

!		Instance methods for 'GtRemotePhlowRowBuilder'

category: 'accessing'
method: GtRemotePhlowRowBuilder
computeNodeValueForObject: anObject atIndex: aRowIndex 
	| phlowColumns columnValues |

	phlowColumns := self phlowView columns.
	columnValues := Array new: phlowColumns size.
	
	phlowColumns withIndexDo: [ :aColumn :aColumnIndex | 
		| computedValue |
	
		computedValue := self withErrorHandlingCompute: [ 
			aColumn 
				computeItemValuesFor: anObject
				rowIndex: aRowIndex
				columnIndex: aColumnIndex ].
	
		columnValues 
			at: aColumnIndex
			put: computedValue ].

	^ GtRemotePhlowRowValue new
		columnValues: columnValues
%

! Class implementation for 'GtRemotePhlowProtoView'

!		Instance methods for 'GtRemotePhlowProtoView'

category: 'decorating'
method: GtRemotePhlowProtoView
columnedList

	^ self declarativeViewOfType: GtRemotePhlowColumnedListView
%

category: 'decorating'
method: GtRemotePhlowProtoView
columnedTree

	^ self declarativeViewOfType: GtRemotePhlowColumnedTreeView
%

category: 'private'
method: GtRemotePhlowProtoView
declarativeViewOfType: aGtDeclarativeViewClass
	"Answer a new declarative view instance"

	^ aGtDeclarativeViewClass new.
%

category: 'decorating'
method: GtRemotePhlowProtoView
empty

	^ self declarativeViewOfType: GtRemotePhlowEmptyView
%

category: 'decorating'
method: GtRemotePhlowProtoView
forward

	^ self declarativeViewOfType: GtRemotePhlowForwarderView
%

category: 'decorating'
method: GtRemotePhlowProtoView
list

	^ self declarativeViewOfType: GtRemotePhlowListView
%

category: 'decorating'
method: GtRemotePhlowProtoView
text

	^ self declarativeViewOfType: GtRemotePhlowTextView
%

category: 'decorating'
method: GtRemotePhlowProtoView
textEditor

	^ self declarativeViewOfType: GtRemotePhlowTextEditorView
%

category: 'decorating'
method: GtRemotePhlowProtoView
tree

	^ self declarativeViewOfType: GtRemotePhlowTreeView
%

! Class implementation for 'GtRemotePhlowView'

!		Class methods for 'GtRemotePhlowView'

category: 'accessing'
classmethod: GtRemotePhlowView
handledExceptions
	"Explicitly catch here Halt and Warning as in case an action raising 
	those exceptions is embedded in the debugger it will trigger an
	infinite chain of debuggers.
	https://github.com/feenkcom/gtoolkit/issues/4383"
	
	^ Error, Halt, Warning
%

!		Instance methods for 'GtRemotePhlowView'

category: 'accessing'
method: GtRemotePhlowView
actionUpdateButton
	"stub"
%

category: 'converting'
method: GtRemotePhlowView
asGtDeclarativeView
	^ nil
%

category: 'message performning'
method: GtRemotePhlowView
basicOn: anObject perform: aMessageSymbol withArguments: aCollectionOfArguments 
	^ anObject  
		perform: aMessageSymbol
		with: aCollectionOfArguments first
%

category: 'testing'
method: GtRemotePhlowView
canBeGtDeclarativeView
	^ true
%

category: 'copying'
method: GtRemotePhlowView
copyTransformationFrom: aSendBlock
	"Do nothing by default. This is a callback used by forward views that define #send: to still work in case the view that we forward to does not support #send:"
%

category: 'accessing'
method: GtRemotePhlowView
definingClass
	^ definingClass
%

category: 'accessing'
method: GtRemotePhlowView
definingClass: aClass
	definingClass := aClass
%

category: 'accessing'
method: GtRemotePhlowView
definingMethod
	^ (definingClass whichClassIncludesSelector: definingSelector) 
		ifNil: [ nil ]
		ifNotNil: [ :aClass | aClass compiledMethodAt: definingSelector ]
%

category: 'accessing'
method: GtRemotePhlowView
definingSelector

	^ definingSelector
%

category: 'accessing'
method: GtRemotePhlowView
definingSelector: aSelector

	definingSelector := aSelector
%

category: 'message performing'
method: GtRemotePhlowView
on: anObject perform: aMessageSymbol 
	<return: #GtRemotePhlowView>
	
	^ self 
		on: anObject 
		perform: aMessageSymbol 
		withArguments: { self }
%

category: 'message performning'
method: GtRemotePhlowView
on: anObject perform: aMessageSymbol withArguments: aCollectionOfArguments
	<return: #GtRemotePhlowView>
	
	^ [ 
			self 
				basicOn: anObject 
				perform: aMessageSymbol 
				withArguments: aCollectionOfArguments
	] on: self class handledExceptions do: [ :anError |
			self 
				phlowErrorViewWithException: anError 
				forBuildContext: nil "(GtPhlowBuildContext new 
					object: anObject; 
					arguments: aCollectionOfArguments) "
				andSelector: aMessageSymbol ]
%

category: 'message performning'
method: GtRemotePhlowView
phlowErrorViewWithException: anException 
	| aTitle |
	aTitle := 'Error'.
	
	^ GtRemotePhlowViewErrorView new
		title: aTitle;
		errorMessage: anException description
%

category: 'error handling'
method: GtRemotePhlowView
phlowErrorViewWithException: anException forBuildContext: aContext andSelector: aMessageSymbol
	| aPhlow | 

	aPhlow := self phlowErrorViewWithException: anException.
	
	"aPhlow buildContext: aContext.
	aPhlow failedComputation: aFailedComputation."

	^ aPhlow
%

category: 'printing'
method: GtRemotePhlowView
printOn: aStream
	super printOn: aStream.
	
	aStream parenthesize: [
		aStream << (self title ifNil: ['']) ]
%

category: 'accessing'
method: GtRemotePhlowView
priority
	^ priority
%

category: 'accessing'
method: GtRemotePhlowView
priority: anObject
	priority := anObject
%

category: 'accessing'
method: GtRemotePhlowView
title
	^ title
%

category: 'accessing'
method: GtRemotePhlowView
title: anObject
	title := anObject
%

category: 'adding - update definitions'
method: GtRemotePhlowView
updateWhen: anAnnouncement if: anIfCondition in: anAnnouncer
	"Stub"
%

category: 'adding - update definitions'
method: GtRemotePhlowView
updateWhen: anAnnouncement in: anAnnouncer
	"Stub"
%

! Class implementation for 'GtRemotePhlowForwarderView'

!		Instance methods for 'GtRemotePhlowForwarderView'

category: 'converting'
method: GtRemotePhlowForwarderView
asGtDeclarativeView
	"Answer the receiver as a GtDeclarativeView."

	^ GtPhlowForwardViewSpecification new 
		title: self title;
		priority: self priority;
		phlowDataSource: (GtRemotePhlowDeclarativeForwardViewDataSource 
			forPhlowView: self);
		dataTransport: GtPhlowViewSpecification dataLazy
%

category: 'testing'
method: GtRemotePhlowForwarderView
canBeGtDeclarativeView
	^ isDeclarative ifNil: [ true ] 
%

category: 'converting'
method: GtRemotePhlowForwarderView
computeForwardedView
	| targetObject computedView |
	
	[ targetObject := objectComputation value ] 
		on: Error do: [ :anError |
			^ self 
				phlowErrorViewWithException: anError  ].
				
	computedView := self on: targetObject perform: viewSelector.
	
	computedView class = self class ifTrue: [
		"If we the forward is to another forwarder view we follow the chain
		to reach the first view that is now a forward view."
		^ computedView computeForwardedView ].
		
	^ computedView
%

category: 'accessing'
method: GtRemotePhlowForwarderView
defaultTransformation
	^ GtRemotePhlowSendObjectTransformation forValuable: [ :anObject | anObject ]
%

category: 'testing'
method: GtRemotePhlowForwarderView
hasTransformation
	<return: #Boolean>
	^ transformation notNil
%

category: 'configuring'
method: GtRemotePhlowForwarderView
markAsNotDeclarative
	isDeclarative := false
%

category: 'api - scripting'
method: GtRemotePhlowForwarderView
object: anObjectComputation
	objectComputation := anObjectComputation.
%

category: 'api - scripting'
method: GtRemotePhlowForwarderView
send: aBlock
	"Define what object should be displayed on selection and fire select or spawn item requests"
	self transformation: (GtRemotePhlowSendObjectTransformation forValuable: aBlock)
%

category: 'accessing'
method: GtRemotePhlowForwarderView
transformation 	
	^ transformation ifNil: [ 
		transformation := self defaultTransformation ]
%

category: 'accessing'
method: GtRemotePhlowForwarderView
transformation: aGtPhlowSendTransformation
	transformation := aGtPhlowSendTransformation.
%

category: 'api - scripting'
method: GtRemotePhlowForwarderView
view: aSelector
	viewSelector := aSelector
%

! Class implementation for 'GtRemotePhlowListingView'

!		Instance methods for 'GtRemotePhlowListingView'

category: 'copying'
method: GtRemotePhlowListingView
copyTransformationFrom: aTransformation
	aTransformation ifNil: [ ^ self ].
	self send: aTransformation valuable
%

category: 'accessing'
method: GtRemotePhlowListingView
defaultItemsComputation
	^ #() asGPhlowItemsIterator
%

category: 'accessing'
method: GtRemotePhlowListingView
defaultTransformation
	^ GtRemotePhlowSendObjectTransformation forValuable: [ :anObject | anObject ]
%

category: 'api - scripting'
method: GtRemotePhlowListingView
items: aBlockClosure
	itemsProviderComputation := aBlockClosure
%

category: 'accessing'
method: GtRemotePhlowListingView
itemsProviderComputation
	^ itemsProviderComputation ifNil: [ 
		itemsProviderComputation := self defaultItemsComputation ]
%

category: 'api - scripting'
method: GtRemotePhlowListingView
send: aBlock
	"Define what object should be displayed on selection and fire select or spawn item requests"
	self transformation: (GtRemotePhlowSendObjectTransformation forValuable: aBlock)
%

category: 'accessing'
method: GtRemotePhlowListingView
transformation 	
	^ transformation ifNil: [ 
		transformation := self defaultTransformation ]
%

category: 'accessing'
method: GtRemotePhlowListingView
transformation: aGtPhlowSendTransformation
	transformation := aGtPhlowSendTransformation.
%

! Class implementation for 'GtRemotePhlowBasicColumnedView'

!		Instance methods for 'GtRemotePhlowBasicColumnedView'

category: 'accessing'
method: GtRemotePhlowBasicColumnedView
column
	<return: #GtRemotePhlowExplicitColumn>
	
	^ self explicitColumn
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
column: aTitleString do: aBlock
	| aColumn |
	aColumn := self column.
	aColumn title: aTitleString.
	aBlock value: aColumn
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
column: aTitleString iconName: anIconNameComputation
	self column: aTitleString iconNameDo: [ :aColumn |
		aColumn
			item: [ :each | each ];
			iconName: anIconNameComputation ]
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
column: aTitleString iconName: anIconNameComputation width: aNumber
	self column: aTitleString iconNameDo: [ :aColumn |
		aColumn
			item: [ :each | each ];
			iconName: anIconNameComputation;
			width: aNumber ]
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
column: aTitle iconNameDo: aBlock
	aBlock value: (self iconNameColumn title: aTitle)
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
column: aTitleString item: anItemComputation text: aBlock	
	self column: aTitleString textDo: [ :aColumn |
		aColumn
			item: anItemComputation;
			format: aBlock ]
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
column: aTitle number: aBlock
	self numberColumn
		title: aTitle;
		item: aBlock
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
column: aTitle number: aBlock format: aFormatBlock
	self numberColumn
		title: aTitle;
		item: aBlock;
		format: aFormatBlock
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
column: aTitle numberDo: aBlock
	aBlock value: (self numberColumn title: aTitle)
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
column: aTitleString text: aBlock	
	self column: aTitleString textDo: [ :aColumn |
		aColumn
			item: [ :each | each ];
			format: aBlock ]
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
column: columnName text: aBlockClosure spawn: aSpawnBlock
	| aColumn |
	aColumn := self column.
	aColumn title: columnName.
	aColumn text: aBlockClosure spawn: aSpawnBlock.
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
column: columnName text: aBlockClosure spawn: aSpawnBlock width: aNumberOrNil
	| aColumn |
	aColumn := self column.
	aColumn title: columnName.
	aColumn text: aBlockClosure spawn: aSpawnBlock.
	aColumn width: aNumberOrNil.
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
column: aTitleString text: aBlock weight: aNumber
	self column: aTitleString textDo: [ :aColumn |
		aColumn
			item: [ :each | each ];
			format: aBlock;
			weight: aNumber ]
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
column: aTitleString text: aBlock width: aNumber
	self column: aTitleString textDo: [ :aColumn |
		aColumn
			item: [ :each | each ];
			format: aBlock;
			width: aNumber ]
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
column: aTitleString textDo: aBlock
	aBlock value: (self textColumn title: aTitleString)
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
columnOfType: aColumnClass
	<return: #GtRemotePhlowColumn>
	| aColumn |
	
	aColumn := aColumnClass new index: self columns size + 1.
	self columns add: aColumn.
	^ aColumn
%

category: 'accessing'
method: GtRemotePhlowBasicColumnedView
columns
	^ columns ifNil: [
		columns := OrderedCollection new ]
%

category: 'accessing'
method: GtRemotePhlowBasicColumnedView
configureColumnsSpecificationOn: aViewSpecification
	aViewSpecification
		columnSpecifications: (columns asArray collect: [ :aColumn | 
			| columnSpecification|
			columnSpecification := GtRemotePhlowColumnSpecification new
				title: aColumn title;
				cellWidth: aColumn cellWidth;
				type: aColumn asGtDeclarativeColumnDataType;
				spawnsObjects: aColumn isSpawningObject.
			
			aColumn hasBackgroundComputation ifTrue: [ 
				columnSpecification  markAsHavingBackground ].
			columnSpecification ] )
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
explicitColumn
	<return: #GtRemotePhlowExplicitColumn>

	^ self columnOfType: GtRemotePhlowExplicitColumn
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
iconNameColumn
	<return: #GtRemotePhlowThemeIconNameColumn>

	^ self columnOfType: GtRemotePhlowThemeIconNameColumn
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
numberColumn
	<return: #GtRemotePhlowNumberColumn>

	^ self columnOfType: GtRemotePhlowNumberColumn
%

category: 'api - scripting column'
method: GtRemotePhlowBasicColumnedView
textColumn
	<return: #GtRemotePhlowTextColumn>

	^ self columnOfType: GtRemotePhlowTextColumn
%

! Class implementation for 'GtRemotePhlowColumnedListView'

!		Instance methods for 'GtRemotePhlowColumnedListView'

category: 'accessing'
method: GtRemotePhlowColumnedListView
asGtDeclarativeView
	"Answer the receiver as a GtDeclarativeView.
	nil = not supported"

	| viewSpecification |
	viewSpecification := GtPhlowColumnedListViewSpecification new 
		phlowDataSource: (GtRemotePhlowDeclarativeViewColumnedListDataSource 
			forPhlowView: self);
		title: self title;
		priority: self priority;
		horizontalScrollingEnabled:  horizontalScrollingEnabled;
		dataTransport: GtPhlowViewSpecification dataLazy.
		
	self configureColumnsSpecificationOn: viewSpecification.
	
	^ viewSpecification
%

category: 'testing'
method: GtRemotePhlowColumnedListView
isHorizontalScrollingEnabled
	^ horizontalScrollingEnabled ifNil: [ false ]
%

category: 'api - scripting'
method: GtRemotePhlowColumnedListView
withHorizontalScrolling
	horizontalScrollingEnabled := true
%

category: 'api - scripting'
method: GtRemotePhlowColumnedListView
withoutHorizontalScrolling
	horizontalScrollingEnabled := false
%

! Class implementation for 'GtRemotePhlowColumnedTreeView'

!		Instance methods for 'GtRemotePhlowColumnedTreeView'

category: 'accessing'
method: GtRemotePhlowColumnedTreeView
asGtDeclarativeView
	"Answer the receiver as a GtDeclarativeView."

	| viewSpecification |
	
	viewSpecification := GtPhlowColumnedTreeViewSpecification new 
		title: self title;
		priority: self priority;
		phlowDataSource: (GtRemotePhlowDeclarativeViewColumnedTreeDataSource 
			forPhlowView: self);
		dataTransport: GtPhlowViewSpecification dataLazy.
		
	self configureColumnsSpecificationOn: viewSpecification.
	
	^ viewSpecification
%

category: 'accessing'
method: GtRemotePhlowColumnedTreeView
children: aBlock

	childrenBuilder := aBlock
%

category: 'accessing'
method: GtRemotePhlowColumnedTreeView
childrenBuilder

	^ childrenBuilder
%

category: 'accessing'
method: GtRemotePhlowColumnedTreeView
defaultItemsComputation
	^ [ #() ]
%

category: 'accessing'
method: GtRemotePhlowColumnedTreeView
expandAll
	"To implement"
%

category: 'accessing'
method: GtRemotePhlowColumnedTreeView
itemComputation
	^ self itemText
%

category: 'accessing'
method: GtRemotePhlowColumnedTreeView
itemsBuilder
	^ self itemsProviderComputation
%

category: 'accessing'
method: GtRemotePhlowColumnedTreeView
itemText

	^ itemTextBlock ifNil: [ 
		itemTextBlock := [ :item | item ] ]
%

category: 'accessing'
method: GtRemotePhlowColumnedTreeView
itemText: aBlock

	itemTextBlock := aBlock
%

! Class implementation for 'GtRemotePhlowListView'

!		Instance methods for 'GtRemotePhlowListView'

category: 'converting'
method: GtRemotePhlowListView
asGtDeclarativeView
	"Answer the receiver as a GtDeclarativeView.
	nil = not supported"

	^ GtPhlowListViewSpecification new 
		title: self title;
		priority: self priority;
		phlowDataSource: (GtRemotePhlowDeclarativeViewListDataSource 
			forPhlowView: self);
		dataTransport: GtPhlowViewSpecification dataLazy.
%

category: 'private - accessing'
method: GtRemotePhlowListView
itemComputation

	^ self itemText
%

category: 'accessing'
method: GtRemotePhlowListView
itemText
	"Answer the BlockClosure that will convert each item to its displayed format.
	The result of the BlockClosure must be a JSON primitive type, effectively a string or number."

	^ itemTextBlock ifNil: [ 
		itemTextBlock := [ :item | item ] ] 
%

category: 'api - scripting'
method: GtRemotePhlowListView
itemText: aBlockClosure

	itemTextBlock := aBlockClosure
%

! Class implementation for 'GtRemotePhlowTreeView'

!		Instance methods for 'GtRemotePhlowTreeView'

category: 'converting'
method: GtRemotePhlowTreeView
asGtDeclarativeView
	"Answer the receiver as a GtDeclarativeView."

	^ GtPhlowTreeViewSpecification new 
		title: self title;
		priority: self priority;
		phlowDataSource: (GtRemotePhlowDeclarativeViewTreeDataSource 
			forPhlowView: self);
		dataTransport: GtPhlowViewSpecification dataLazy
%

category: 'accessing'
method: GtRemotePhlowTreeView
children: aBlock

	childrenBuilder := aBlock
%

category: 'accessing'
method: GtRemotePhlowTreeView
childrenBuilder

	^ childrenBuilder
%

category: 'accessing'
method: GtRemotePhlowTreeView
defaultItemsComputation
	^ [ #() ]
%

category: 'accessing'
method: GtRemotePhlowTreeView
expandAll
	"To implement"
%

category: 'accessing'
method: GtRemotePhlowTreeView
itemComputation
	^ self itemText
%

category: 'accessing'
method: GtRemotePhlowTreeView
itemsBuilder
	^ self itemsProviderComputation
%

category: 'accessing'
method: GtRemotePhlowTreeView
itemText

	^ itemTextBlock ifNil: [ 
		itemTextBlock := [ :item | item ] ]
%

category: 'api - scripting'
method: GtRemotePhlowTreeView
itemText: aBlock

	itemTextBlock := aBlock
%

! Class implementation for 'GtRemotePhlowTextualView'

!		Instance methods for 'GtRemotePhlowTextualView'

category: 'accessing'
method: GtRemotePhlowTextualView
aptitude: anAptitude
	"stub method"
%

category: 'accessing'
method: GtRemotePhlowTextualView
highlighterSpecification
	^ nil
%

category: 'accessing'
method: GtRemotePhlowTextualView
text: aBlockClosure
	"Set the BlockClosure that will generate the string to be displayed.
	The result of the BlockClosure must be a String (not a BlText)."

	textBuilder := aBlockClosure
%

category: 'accessing'
method: GtRemotePhlowTextualView
textBuilder
	^ textBuilder
%

! Class implementation for 'GtRemotePhlowTextEditorView'

!		Instance methods for 'GtRemotePhlowTextEditorView'

category: 'converting'
method: GtRemotePhlowTextEditorView
asGtDeclarativeView
	"Answer the receiver as a GtDeclarativeView.
	nil = not supported"

	^ GtPhlowTextEditorViewSpecification new 
		title: self title;
		priority: self priority;
		phlowDataSource: (GtRemotePhlowDeclarativeTextualViewDataSource 
			forPhlowView: self);
		dataTransport: GtPhlowViewSpecification dataLazy.
%

category: 'accessing'
method: GtRemotePhlowTextEditorView
styler: aBlockClosure
	"Set the computation that will create the styler."

	stylerSpecification := GtRemoteTextStylerComputableSpecification new 
		stylerComputation: aBlockClosure
%

category: 'accessing'
method: GtRemotePhlowTextEditorView
stylerClassName: aStylerClassName
	stylerSpecification := GtRemotePhlowTextClassStylerSpecification new 
		stylerClassName: aStylerClassName
%

category: 'accessing'
method: GtRemotePhlowTextEditorView
stylerParserClassName: aParserClassName
	stylerSpecification := GtRemotePhlowTextParserStylerSpecification new 
		parserClassName: aParserClassName
%

category: 'accessing'
method: GtRemotePhlowTextEditorView
stylerSpecification
	^ stylerSpecification
%

! Class implementation for 'GtRemotePhlowTextView'

!		Instance methods for 'GtRemotePhlowTextView'

category: 'accessing'
method: GtRemotePhlowTextView
asGtDeclarativeView
	"Answer the receiver as a GtDeclarativeView.
	nil = not supported"

	^ GtPhlowTextViewSpecification new 
		title: self title;
		priority: self priority;
		phlowDataSource: (GtRemotePhlowDeclarativeTextualViewDataSource 
			forPhlowView: self);
		dataTransport: GtPhlowViewSpecification dataLazy.
%

category: 'accessing'
method: GtRemotePhlowTextView
stylerSpecification
	"Should be extended to support a styler that could be applied on the text"
	^ nil
%

! Class implementation for 'GtRemotePhlowViewErrorView'

!		Instance methods for 'GtRemotePhlowViewErrorView'

category: 'converting'
method: GtRemotePhlowViewErrorView
asGtDeclarativeView
	"Answer the receiver as a GtDeclarativeView."

	^GtPhlowViewErrorViewSpecification new 
		title: self title;
		priority: self priority;
		errorMessage: self errorMessage;
		dataTransport: GtPhlowViewSpecification dataIncluded.
%

category: 'accessing'
method: GtRemotePhlowViewErrorView
errorMessage
	^ errorMessage
%

category: 'accessing'
method: GtRemotePhlowViewErrorView
errorMessage: aStringMessage
	errorMessage := aStringMessage
%

! Class implementation for 'GtRemotePhlowSendObjectTransformation'

!		Class methods for 'GtRemotePhlowSendObjectTransformation'

category: 'instance creation'
classmethod: GtRemotePhlowSendObjectTransformation
forValuable: aValuable
	^ self new
		valuable: aValuable
%

!		Instance methods for 'GtRemotePhlowSendObjectTransformation'

category: 'api - converting'
method: GtRemotePhlowSendObjectTransformation
asPhlowSendTransformation
	^ self
%

category: 'asserting'
method: GtRemotePhlowSendObjectTransformation
assertValuable: aBlock
	self
		assert: [ aBlock isNotNil ].
	self
		assert: [ aBlock argumentCount <= 2 ].
%

category: 'api - transformation'
method: GtRemotePhlowSendObjectTransformation
transformedValueFrom: aSelectedObject selection: aSelectionIndices
	^ self valuable cull: aSelectedObject cull: aSelectionIndices
%

category: 'accessing'
method: GtRemotePhlowSendObjectTransformation
valuable
	^ valuable
%

category: 'accessing'
method: GtRemotePhlowSendObjectTransformation
valuable: anObject
	valuable := anObject
%

! Class implementation for 'GtRemotePhlowSpawnObjectWrapper'

!		Instance methods for 'GtRemotePhlowSpawnObjectWrapper'

category: 'accessing'
method: GtRemotePhlowSpawnObjectWrapper
targetObject
	^ targetObject
%

category: 'accessing'
method: GtRemotePhlowSpawnObjectWrapper
targetObject: anObject
	targetObject := anObject
%

! Class implementation for 'GtRemotePhlowActionSpecificationConversionExamples'

!		Instance methods for 'GtRemotePhlowActionSpecificationConversionExamples'

category: 'examples'
method: GtRemotePhlowActionSpecificationConversionExamples
convertButtonActionWithIcon
	"Demonstrate converting a button action to a declarative specification"

	<gtExample>
	<return: #GtPhlowButtonActionSpecification>
	| phlowAction declarativeSpecification |
	phlowAction := self createProtoActions button
			tooltip: 'Inspect objects';
			priority: 12;
			icon: (GtPhlowGlamorousVectorIconNameStencil new iconName: #playinspect).

	declarativeSpecification := phlowAction asGtDeclarativeAction.

	self assert: declarativeSpecification tooltipText equals: 'Inspect objects'.
	self assert: declarativeSpecification label equals: nil.
	self
		assert: declarativeSpecification iconStencil
		equals: (GtPhlowGlamorousVectorIconNameStencil forIconName: #playinspect).
	self assert: declarativeSpecification priority equals: 12.

	self
		assert: declarativeSpecification asDictionaryForExport
		equals: self expectedButtonActionWithIconSpecification.

	^ declarativeSpecification
%

category: 'examples'
method: GtRemotePhlowActionSpecificationConversionExamples
convertButtonActionWithIconAndLabel
	"Demonstrate converting a button action to a declarative specification"

	<gtExample>
	<return: #GtPhlowButtonActionSpecification>
	| phlowAction declarativeSpecification |
	phlowAction := self createProtoActions button
			tooltip: 'Inspect objects';
			priority: 12;
			label: 'Inspect';
			icon: (GtPhlowGlamorousVectorIconNameStencil new iconName: #playinspect).

	declarativeSpecification := phlowAction asGtDeclarativeAction.

	self assert: declarativeSpecification tooltipText equals: 'Inspect objects'.
	self assert: declarativeSpecification label equals: 'Inspect'.
	self
		assert: declarativeSpecification iconStencil
		equals: (GtPhlowGlamorousVectorIconNameStencil forIconName: #playinspect).
	self assert: declarativeSpecification priority equals: 12.

	self
		assert: declarativeSpecification asDictionaryForExport
		equals: self expectedButtonActionWithIconAndLabelSpecification.

	^ declarativeSpecification
%

category: 'examples'
method: GtRemotePhlowActionSpecificationConversionExamples
convertButtonActionWithLabelAndNoTooltip
	"Demonstrate converting a button action to a declarative specification"

	<gtExample>
	<return: #GtPhlowButtonActionSpecification>
	| phlowAction declarativeSpecification |
	phlowAction := self createProtoActions button
			label: 'Inspect';
			priority: 12.

	declarativeSpecification := phlowAction asGtDeclarativeAction.

	self assert: declarativeSpecification tooltipText equals: nil.
	self assert: declarativeSpecification label equals: 'Inspect'.
	self assert: declarativeSpecification iconStencil equals: nil.
	self assert: declarativeSpecification priority equals: 12.

	self
		assert: declarativeSpecification asDictionaryForExport
		equals: self expectedButtonActionWithLabelAndNoTooltipSpecification.

	^ declarativeSpecification
%

category: 'accessing'
method: GtRemotePhlowActionSpecificationConversionExamples
createProtoActions
	^ GtRemotePhlowAction new
%

category: 'data'
method: GtRemotePhlowActionSpecificationConversionExamples
expectedButtonActionWithIconAndLabelSpecification
	^ Dictionary new
		add: '__typeName' -> #GtPhlowButtonActionSpecification;
		add: '__typeLabel' -> 'phlowButtonActionSpecification';
		add: 'iconStencil'
				-> (Dictionary new
						add: '__typeName' -> #GtPhlowGlamorousVectorIconNameStencil;
						add: '__typeLabel' -> 'phlowGlamorousVectorIconNameStencil';
						add: 'iconName' -> #playinspect;
						yourself);
		add: 'priority' -> 12;
		add: 'tooltipText' -> 'Inspect objects';
		add: 'methodSelector' -> nil;
		add: 'label' -> 'Inspect';
		yourself
%

category: 'data'
method: GtRemotePhlowActionSpecificationConversionExamples
expectedButtonActionWithIconSpecification
	^ Dictionary new
		add: '__typeName' -> #GtPhlowButtonActionSpecification;
		add: '__typeLabel' -> 'phlowButtonActionSpecification';
		add: 'iconStencil'
				-> (Dictionary new
						add: 'iconName' -> #playinspect;
						add: '__typeName' -> #GtPhlowGlamorousVectorIconNameStencil;
						add: '__typeLabel' -> 'phlowGlamorousVectorIconNameStencil';
						yourself);
		add: 'priority' -> 12;
		add: 'tooltipText' -> 'Inspect objects';
		add: 'methodSelector' -> nil;
		yourself
%

category: 'data'
method: GtRemotePhlowActionSpecificationConversionExamples
expectedButtonActionWithLabelAndNoTooltipSpecification
	^ Dictionary new
		add: '__typeName' -> #GtPhlowButtonActionSpecification;
		add: '__typeLabel' -> 'phlowButtonActionSpecification';
		add: 'priority' -> 12;
		add: 'methodSelector' -> nil;
		add: 'label' -> 'Inspect';
		yourself
%

! Class implementation for 'GtRemotePhlowViewSpecificationConversionExamples'

!		Instance methods for 'GtRemotePhlowViewSpecificationConversionExamples'

category: 'examples'
method: GtRemotePhlowViewSpecificationConversionExamples
convertColumnedList
	"Demonstrate converting a columned list phlow view to a declarative specification"

	<gtExample>
	<return: #GtPhlowColumnedListViewSpecification>
	| phlowView declarativeSpecification |
	phlowView := self createProtoViews columnedList
			title: #Test;
			priority: 10;
			items: [ #(1 2 3) ];
			column: 'One' text: [ :item | item ];
			column: 'Two'
				text: [ :item | item asString ]
				width: 100.
	declarativeSpecification := phlowView asGtDeclarativeView.

	self assert: declarativeSpecification title equals: #Test.
	self assert: declarativeSpecification priority equals: 10.
	self assert: declarativeSpecification columnTitles equals: #('One' 'Two').
	self assert: declarativeSpecification columnWidths equals: #(nil 100).

	self
		assert: declarativeSpecification retriveFormattedItems
		equals: self expectedColumnedListWithNumbersItems.

	^ declarativeSpecification
%

category: 'examples'
method: GtRemotePhlowViewSpecificationConversionExamples
convertColumnedListWithTextColumns
	"Check the conversion to declarative specification with data"

	<gtExample>
	<return: #GtPhlowColumnedListViewSpecification>
	| declarativeSpecification |
	declarativeSpecification := (GtRemotePhlowDeclarativeTestInspectable new
			gtColumnedListFor: self createProtoViews) asGtDeclarativeView.

	self assert: declarativeSpecification title equals: 'Columned list'.
	self assert: declarativeSpecification priority equals: 20.
	self
		assert: declarativeSpecification columnTitles
		equals: #('Value' 'Lowercase').
	self assert: declarativeSpecification columnWidths equals: #(nil 100).

	self
		assert: declarativeSpecification retriveFormattedItems
		equals: self expectedColumnedListForExampleObjectItems.

	^ declarativeSpecification
%

category: 'examples'
method: GtRemotePhlowViewSpecificationConversionExamples
convertColumnedListWithTypedColumns
	"Check the conversion to declarative specification with data"

	<gtExample>
	<return: #GtPhlowColumnedListViewSpecification>
	| declarativeSpecification |
	declarativeSpecification := (GtRemotePhlowDeclarativeTestInspectable new
			gtColumnedListWithTypedColumnsFor: self createProtoViews) asGtDeclarativeView.

	self
		assert: declarativeSpecification title
		equals: 'Columned list with typed columns'.
	self assert: declarativeSpecification priority equals: 24.
	self
		assert: (declarativeSpecification columnSpecifications
				collect: [ :aColumnSpecification | aColumnSpecification typeLabel ])
		equals: #('text' 'number' 'icon').
	self
		assert: declarativeSpecification columnTitles
		equals: #('Text' 'Number' 'Icon Name').
	self assert: declarativeSpecification columnWidths equals: #(nil 100 75).

	^ declarativeSpecification
%

category: 'examples'
method: GtRemotePhlowViewSpecificationConversionExamples
convertColumnedTree
	"Demonstrate converting a columned tree phlow view to a declarative specification"

	<gtExample>
	<return: #GtPhlowColumnedTreeViewSpecification>
	| phlowView declarativeSpecification |
	phlowView := self createProtoViews columnedTree
			title: #Test;
			priority: 10;
			items: [ 1 to: 4 ];
			children: [ :aNumber | aNumber = 0 ifTrue: [ #() ] ifFalse: [ 1 to: aNumber // 2 ] ];
			column: 'One' text: [ :item | item ];
			column: 'Two'
				text: [ :item | (item + 1) asString ]
				width: 100.
	declarativeSpecification := phlowView asGtDeclarativeView.

	self assert: declarativeSpecification title equals: #Test.
	self assert: declarativeSpecification priority equals: 10.
	self assert: declarativeSpecification columnTitles equals: #('One' 'Two').
	self assert: declarativeSpecification columnWidths equals: #(nil 100).

	self
		assert: declarativeSpecification retriveFormattedItems
		equals: self expectedColumnedTreeWithNumberItems.

	^ declarativeSpecification
%

category: 'examples'
method: GtRemotePhlowViewSpecificationConversionExamples
convertListWithNumbers
	"Demonstrate converting a columned list phlow view to a declarative specification"

	<gtExample>
	<return: #GtPhlowListViewSpecification>
	| phlowView declarativeSpecification |
	phlowView := self createProtoViews list
			title: #Test;
			priority: 10;
			items: [ #(1 2 3) ];
			itemText: [ :item | 'Number: ' , item asString ].
	declarativeSpecification := phlowView asGtDeclarativeView.

	self assert: declarativeSpecification title equals: #Test.
	self assert: declarativeSpecification priority equals: 10.
	self
		assert: declarativeSpecification retriveFormattedItems
		equals: self expectedListWithNumberItems.

	^ declarativeSpecification
%

category: 'examples'
method: GtRemotePhlowViewSpecificationConversionExamples
convertListWithObjects
	"Check the conversion to declarative specification with data"

	<gtExample>
	<return: #GtPhlowListViewSpecification>
	| phlowView declarativeSpecification |
	phlowView := GtRemotePhlowDeclarativeTestInspectable new
			gtListFor: self createProtoViews.
	declarativeSpecification := phlowView asGtDeclarativeView.

	self assert: declarativeSpecification title equals: 'List'.
	self assert: declarativeSpecification priority equals: 15.
	self
		assert: declarativeSpecification retriveFormattedItems
		equals: self expectedListForExampleObjectItems.

	^ declarativeSpecification
%

category: 'examples'
method: GtRemotePhlowViewSpecificationConversionExamples
convertListWithStyledText
	<gtExample>
	<return: #GtPhlowListViewSpecification>
	| phlowView declarativeSpecification |
	phlowView := GtRemotePhlowDeclarativeTestInspectable new
			gtListWithStyledTextFor: self createProtoViews.
	declarativeSpecification := phlowView asGtDeclarativeView.

	self assert: declarativeSpecification title equals: 'List - styled text'.
	self assert: declarativeSpecification priority equals: 15.1.
	self
		assert: declarativeSpecification retriveFormattedItems
		equals: self expectedListForStyledText.

	^ declarativeSpecification
%

category: 'examples'
method: GtRemotePhlowViewSpecificationConversionExamples
convertText
	"Demonstrate converting a columned list phlow view to a declarative specification"

	<gtExample>
	<return: #GtPhlowTextViewSpecification>
	| phlowView declarativeSpecification |
	phlowView := self createProtoViews text
			title: #Test;
			priority: 11;
			text: [ 'hello world' ].
	declarativeSpecification := phlowView asGtDeclarativeView.

	self assert: declarativeSpecification title equals: #Test.
	self assert: declarativeSpecification priority equals: 11.

	self
		assert: declarativeSpecification retrieveStylableText
		equals: self expectedTextEditorBasicStringStylableTextData.

	^ declarativeSpecification
%

category: 'examples'
method: GtRemotePhlowViewSpecificationConversionExamples
convertTextEditor
	"Demonstrate converting a columned list phlow view to a declarative specification"

	<gtExample>
	<return: #GtPhlowTextEditorViewSpecification>
	| phlowView declarativeSpecification |
	phlowView := self createProtoViews textEditor
			title: 'String (editor)';
			priority: 11;
			text: [ 'hello world' ].
	declarativeSpecification := phlowView asGtDeclarativeView.

	self assert: declarativeSpecification title equals: 'String (editor)'.
	self assert: declarativeSpecification priority equals: 11.
	self assert: declarativeSpecification string equals: nil.

	self
		assert: declarativeSpecification retrieveStylableText
		equals: self expectedTextEditorBasicStringStylableTextData.

	^ declarativeSpecification
%

category: 'examples'
method: GtRemotePhlowViewSpecificationConversionExamples
convertTree
	"Demonstrate converting a tree phlow view to a declarative specification"

	<gtExample>
	<return: #GtPhlowTreeViewSpecification>
	| phlowView declarativeSpecification |
	phlowView := self createProtoViews tree
			title: #Test;
			priority: 10;
			items: [ 1 to: 4 ];
			children: [ :aNumber | aNumber = 0 ifTrue: [ #() ] ifFalse: [ 1 to: aNumber // 2 ] ].
	declarativeSpecification := phlowView asGtDeclarativeView.

	self assert: declarativeSpecification title equals: #Test.
	self assert: declarativeSpecification priority equals: 10.
	self
		assert: declarativeSpecification retriveFormattedItems
		equals: self expectedTreeWithNumberItems.

	^ declarativeSpecification
%

category: 'accessing'
method: GtRemotePhlowViewSpecificationConversionExamples
createProtoViews
	^ GtRemotePhlowProtoView new
%

category: 'accessing - data'
method: GtRemotePhlowViewSpecificationConversionExamples
expectedColumnedListForExampleObjectItems
	^ ((Array new: 3) at: 1 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#columnValues->((Array new: 2) at: 1 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'42'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself); at: 2 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'42'); yourself); yourself)); yourself)); add: (#nodeId->1); yourself); at: 2 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#columnValues->((Array new: 2) at: 1 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'Hello World'); yourself); at: 2 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'hello world'); yourself); yourself)); yourself)); add: (#nodeId->2); yourself); at: 3 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#columnValues->((Array new: 2) at: 1 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'2021-04-06T14:43:50.123456+02:00'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself); at: 2 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'2021-04-06t14:43:50.123456+02:00'); yourself); yourself)); yourself)); add: (#nodeId->3); yourself); yourself)
%

category: 'accessing - data'
method: GtRemotePhlowViewSpecificationConversionExamples
expectedColumnedListWithNumbersItems
	^ ((Array new: 3) at: 1 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#columnValues->((Array new: 2) at: 1 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'1'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself); at: 2 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'1'); yourself); yourself)); yourself)); add: (#nodeId->1); yourself); at: 2 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#columnValues->((Array new: 2) at: 1 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'2'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself); at: 2 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'2'); yourself); yourself)); yourself)); add: (#nodeId->2); yourself); at: 3 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#columnValues->((Array new: 2) at: 1 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'3'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself); at: 2 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'3'); yourself); yourself)); yourself)); add: (#nodeId->3); yourself); yourself)
%

category: 'accessing - data'
method: GtRemotePhlowViewSpecificationConversionExamples
expectedColumnedTreeWithNumberItems
	^ ((Array new: 4) at: 1 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#columnValues->((Array new: 2) at: 1 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'1'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself); at: 2 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'2'); yourself); yourself)); yourself)); add: (#nodeId->1); yourself); at: 2 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#columnValues->((Array new: 2) at: 1 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'2'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself); at: 2 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'3'); yourself); yourself)); yourself)); add: (#nodeId->2); yourself); at: 3 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#columnValues->((Array new: 2) at: 1 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'3'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself); at: 2 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'4'); yourself); yourself)); yourself)); add: (#nodeId->3); yourself); at: 4 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#columnValues->((Array new: 2) at: 1 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'4'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself); at: 2 put: ((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'5'); yourself); yourself)); yourself)); add: (#nodeId->4); yourself); yourself)
%

category: 'accessing - data'
method: GtRemotePhlowViewSpecificationConversionExamples
expectedListForExampleObjectItems
	^ ((Array new: 3) at: 1 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'42'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself)); add: (#nodeId->1); yourself); at: 2 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'Hello World'); yourself)); add: (#nodeId->2); yourself); at: 3 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'2021-04-06T14:43:50.123456+02:00'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself)); add: (#nodeId->3); yourself); yourself)
%

category: 'accessing - data'
method: GtRemotePhlowViewSpecificationConversionExamples
expectedListForStyledText
	^ ((Array new: 4) at: 1 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'42'); add: ('attributeRuns'->((Dictionary new) add: ('items'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('startIndex'->1); add: ('endIndex'->2); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('__typeLabel'->'phlowFontWeightAttribute'); add: ('weight'->#bold); yourself); yourself)); yourself); yourself)); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself)); add: (#nodeId->1); yourself); at: 2 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'Hello World'); add: ('attributeRuns'->((Dictionary new) add: ('items'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('startIndex'->1); add: ('endIndex'->5); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 2) at: 1 put: ((Dictionary new) add: ('color'->((Dictionary new) add: (#a->1.0); add: (#r->1.0); add: (#g->1.0); add: (#b->0.0); yourself)); add: ('__typeLabel'->'phlowTextHighlightAttribute'); yourself); at: 2 put: ((Dictionary new) add: ('__typeLabel'->'phlowFontSizeAttribute'); add: ('size'->20); yourself); yourself)); yourself); yourself)); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself)); add: (#nodeId->2); yourself); at: 3 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'Now is the time'); add: ('attributeRuns'->((Dictionary new) add: ('items'->((Array new: 9) at: 1 put: ((Dictionary new) add: ('startIndex'->1); add: ('endIndex'->11); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('name'->'Source Code Pro'); add: ('__typeLabel'->'phlowFontNameAttribute'); yourself); yourself)); yourself); at: 2 put: ((Dictionary new) add: ('startIndex'->13); add: ('endIndex'->15); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('name'->'Source Code Pro'); add: ('__typeLabel'->'phlowFontNameAttribute'); yourself); yourself)); yourself); at: 3 put: ((Dictionary new) add: ('startIndex'->1); add: ('endIndex'->4); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('__typeLabel'->'phlowFontWeightAttribute'); add: ('weight'->#bold); yourself); yourself)); yourself); at: 4 put: ((Dictionary new) add: ('startIndex'->1); add: ('endIndex'->6); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('__typeLabel'->'phlowFontEmphasisAttribute'); add: ('emphasis'->'italic'); yourself); yourself)); yourself); at: 5 put: ((Dictionary new) add: ('startIndex'->5); add: ('endIndex'->6); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('color'->((Dictionary new) add: (#a->1.0); add: (#r->1.0); add: (#g->1.0); add: (#b->0.0); yourself)); add: ('__typeLabel'->'phlowTextHighlightAttribute'); yourself); yourself)); yourself); at: 6 put: ((Dictionary new) add: ('startIndex'->8); add: ('endIndex'->10); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('color'->((Dictionary new) add: (#a->1.0); add: (#r->1.0); add: (#g->0.0); add: (#b->0.0); yourself)); add: ('__typeLabel'->'phlowTextForegroundAttribute'); yourself); yourself)); yourself); at: 7 put: ((Dictionary new) add: ('startIndex'->8); add: ('endIndex'->15); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('__typeLabel'->'phlowFontWeightAttribute'); add: ('weight'->#thin); yourself); yourself)); yourself); at: 8 put: ((Dictionary new) add: ('startIndex'->12); add: ('endIndex'->12); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('name'->'Source Sans Pro'); add: ('__typeLabel'->'phlowFontNameAttribute'); yourself); yourself)); yourself); at: 9 put: ((Dictionary new) add: ('startIndex'->12); add: ('endIndex'->15); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('__typeLabel'->'phlowFontSizeAttribute'); add: ('size'->20); yourself); yourself)); yourself); yourself)); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself)); add: (#nodeId->3); yourself); at: 4 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'Now is the time'); add: ('attributeRuns'->((Dictionary new) add: ('items'->((Array new: 9) at: 1 put: ((Dictionary new) add: ('startIndex'->1); add: ('endIndex'->11); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('name'->'Source Code Pro'); add: ('__typeLabel'->'phlowFontNameAttribute'); yourself); yourself)); yourself); at: 2 put: ((Dictionary new) add: ('startIndex'->13); add: ('endIndex'->15); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('name'->'Source Code Pro'); add: ('__typeLabel'->'phlowFontNameAttribute'); yourself); yourself)); yourself); at: 3 put: ((Dictionary new) add: ('startIndex'->1); add: ('endIndex'->4); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('__typeLabel'->'phlowFontWeightAttribute'); add: ('weight'->#bold); yourself); yourself)); yourself); at: 4 put: ((Dictionary new) add: ('startIndex'->1); add: ('endIndex'->6); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('__typeLabel'->'phlowFontEmphasisAttribute'); add: ('emphasis'->'italic'); yourself); yourself)); yourself); at: 5 put: ((Dictionary new) add: ('startIndex'->5); add: ('endIndex'->6); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('color'->((Dictionary new) add: (#a->1.0); add: (#r->1.0); add: (#g->1.0); add: (#b->0.0); yourself)); add: ('__typeLabel'->'phlowTextHighlightAttribute'); yourself); yourself)); yourself); at: 6 put: ((Dictionary new) add: ('startIndex'->8); add: ('endIndex'->10); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('color'->((Dictionary new) add: (#a->1.0); add: (#r->1.0); add: (#g->0.0); add: (#b->0.0); yourself)); add: ('__typeLabel'->'phlowTextForegroundAttribute'); yourself); yourself)); yourself); at: 7 put: ((Dictionary new) add: ('startIndex'->8); add: ('endIndex'->15); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('__typeLabel'->'phlowFontWeightAttribute'); add: ('weight'->#thin); yourself); yourself)); yourself); at: 8 put: ((Dictionary new) add: ('startIndex'->12); add: ('endIndex'->12); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('name'->'Source Sans Pro'); add: ('__typeLabel'->'phlowFontNameAttribute'); yourself); yourself)); yourself); at: 9 put: ((Dictionary new) add: ('startIndex'->12); add: ('endIndex'->15); add: ('__typeLabel'->'phlowRun'); add: ('attributes'->((Array new: 1) at: 1 put: ((Dictionary new) add: ('__typeLabel'->'phlowFontSizeAttribute'); add: ('size'->20); yourself); yourself)); yourself); yourself)); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself)); add: (#nodeId->4); yourself); yourself)
%

category: 'accessing - data'
method: GtRemotePhlowViewSpecificationConversionExamples
expectedListWithNumberItems
	^ ((Array new: 3) at: 1 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'Number: 1'); yourself)); add: (#nodeId->1); yourself); at: 2 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'Number: 2'); yourself)); add: (#nodeId->2); yourself); at: 3 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->'Number: 3'); yourself)); add: (#nodeId->3); yourself); yourself)
%

category: 'accessing - data'
method: GtRemotePhlowViewSpecificationConversionExamples
expectedTextEditorBasicStringStylableTextData
	^ ((Dictionary new) add: ('string'->'hello world'); add: ('__typeLabel'->'remotePhlowText'); add: ('stylerSpecification'->((Dictionary new) add: ('__typeLabel'->'remotePhlowTextAttributeRunsStylerSpecification'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself)
%

category: 'accessing - data'
method: GtRemotePhlowViewSpecificationConversionExamples
expectedTreeWithNumberItems
	^ ((Array new: 4) at: 1 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'1'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself)); add: (#nodeId->1); yourself); at: 2 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'2'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself)); add: (#nodeId->2); yourself); at: 3 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'3'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself)); add: (#nodeId->3); yourself); at: 4 put: ((Dictionary new) add: (#nodeValue->((Dictionary new) add: (#valueTypeName->'textualValue'); add: (#itemText->((Dictionary new) add: ('__typeLabel'->'gtPhlowRunBasedText'); add: ('sourceString'->'4'); add: ('attributeRuns'->((Dictionary new) add: ('items'->#()); add: ('__typeLabel'->'phlowRunsGroup'); yourself)); yourself)); yourself)); add: (#nodeId->4); yourself); yourself)
%

! Class implementation for 'GtRemotePhlowStylableText'

!		Class methods for 'GtRemotePhlowStylableText'

category: 'instance creation'
classmethod: GtRemotePhlowStylableText
fromJSONDictionary: aDictionary
	^ self new
		initializeFromJSONDictionary: aDictionary
%

category: 'accessing'
classmethod: GtRemotePhlowStylableText
typeLabel
	^ 'remotePhlowText'
%

!		Instance methods for 'GtRemotePhlowStylableText'

category: 'converting'
method: GtRemotePhlowStylableText
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation.
	Subclasses will override and add to the dictionary"

	| dataForExport |
	dataForExport := Dictionary new.
	dataForExport
		at: '__typeLabel' put: self class typeLabel;
		at: 'string' put: self string.
	self stylerSpecification
		ifNotNil: [ :aStylerSpecification | 
			dataForExport
				at: 'stylerSpecification'
				put: aStylerSpecification asDictionaryForExport ].
	highlight
		ifNotNil: [ dataForExport at: 'highlight' put: highlight asDictionaryForExport ].

	^ dataForExport
%

category: 'accessing'
method: GtRemotePhlowStylableText
createStyledText
	^ self stylerSpecification 
		ifNil: [ string asRopedText ]
		ifNotNil: [ :aStylerSpecification |
			aStylerSpecification createBlStyler 
				style: string asRopedText]
%

category: 'accessing'
method: GtRemotePhlowStylableText
highlight
	^ highlight
%

category: 'accessing'
method: GtRemotePhlowStylableText
highlight: aGtPhlowTextHighlight
	highlight := aGtPhlowTextHighlight
%

category: 'initialization'
method: GtRemotePhlowStylableText
initializeFromJSONDictionary: aDictionary
	self string: (aDictionary at: 'string').

	(aDictionary includesKey: 'stylerSpecification')
		ifTrue: [ self
				stylerSpecification: (GtRemotePhlowTextStylerSpecification
						fromJSONDictionary: (aDictionary at: 'stylerSpecification')) ].
	aDictionary
		at: 'highlight'
		ifPresent: [ :dict | self highlight: (GtPhlowTextHighlight fromJSONDictionary: dict) ]
%

category: 'accessing'
method: GtRemotePhlowStylableText
string
	^ string
%

category: 'accessing'
method: GtRemotePhlowStylableText
string: anObject
	string := anObject
%

category: 'accessing'
method: GtRemotePhlowStylableText
stylerSpecification
	^ stylerSpecification
%

category: 'accessing'
method: GtRemotePhlowStylableText
stylerSpecification: anObject
	stylerSpecification := anObject
%

! Class implementation for 'GtRemotePhlowTextStylerSpecification'

!		Class methods for 'GtRemotePhlowTextStylerSpecification'

category: 'instance creation'
classmethod: GtRemotePhlowTextStylerSpecification
fromJSONDictionary: aTextStylerSpecificationData 
	| typeLabel stylerSpecificationClass |
 	typeLabel := aTextStylerSpecificationData at: '__typeLabel'.
 	
 	stylerSpecificationClass := self stylerSpecificationClassForType: typeLabel.
		
	^ stylerSpecificationClass 
		ifNil: [ nil ]
		ifNotNil: [
			stylerSpecificationClass new 
				initializeFromJSONDictionary: aTextStylerSpecificationData ]
%

category: 'instance creation'
classmethod: GtRemotePhlowTextStylerSpecification
stylerSpecificationClassForType: aTypeLabel 
	aTypeLabel = GtRemotePhlowTextAttributeRunsStylerSpecification typeLabel ifTrue: [
 		^ GtRemotePhlowTextAttributeRunsStylerSpecification  ].
			
	aTypeLabel = GtRemotePhlowTextClassStylerSpecification typeLabel ifTrue: [
 		^ GtRemotePhlowTextClassStylerSpecification  ].
			
	aTypeLabel = GtRemotePhlowTextParserStylerSpecification typeLabel ifTrue: [
 		^  GtRemotePhlowTextParserStylerSpecification ].
 		
 	^ nil
%

category: 'accessing'
classmethod: GtRemotePhlowTextStylerSpecification
typeLabel
	^ '<missing>'
%

!		Instance methods for 'GtRemotePhlowTextStylerSpecification'

category: 'converting'
method: GtRemotePhlowTextStylerSpecification
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation.
	Subclasses will override and add to the dictionary"

	^ Dictionary new 
		at: '__typeLabel' put: self class typeLabel;
		yourself
%

category: 'testing'
method: GtRemotePhlowTextStylerSpecification
canAffectText
	^ true
%

category: 'converting'
method: GtRemotePhlowTextStylerSpecification
convertToSerializableSpecificationForText: aText
	^ self
%

category: 'initialization'
method: GtRemotePhlowTextStylerSpecification
initializeFromJSONDictionary: aTextStylerSpecificationData 
	
%

! Class implementation for 'GtRemotePhlowTextAttributeRunsStylerSpecification'

!		Class methods for 'GtRemotePhlowTextAttributeRunsStylerSpecification'

category: 'accessing'
classmethod: GtRemotePhlowTextAttributeRunsStylerSpecification
typeLabel
	^ 'remotePhlowTextAttributeRunsStylerSpecification'
%

!		Instance methods for 'GtRemotePhlowTextAttributeRunsStylerSpecification'

category: 'converting'
method: GtRemotePhlowTextAttributeRunsStylerSpecification
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation.
	Subclasses will override and add to the dictionary"

	^ super asDictionaryForExport
		at: 'attributeRuns' put: attributeRuns  asDictionaryForExport;
		yourself
%

category: 'accessing'
method: GtRemotePhlowTextAttributeRunsStylerSpecification
attributeRuns
	^ attributeRuns
%

category: 'accessing'
method: GtRemotePhlowTextAttributeRunsStylerSpecification
attributeRuns: aCollection
	attributeRuns := aCollection
%

category: 'testing'
method: GtRemotePhlowTextAttributeRunsStylerSpecification
canAffectText
	^ attributeRuns notNil and: [ attributeRuns notEmpty ]
%

category: 'gt - extensions'
method: GtRemotePhlowTextAttributeRunsStylerSpecification
gtViewRunWithAttributesFor: aView 
	<gtView>
	
	^ aView forward 
		title: 'Runs';
		object: [ attributeRuns ];
		view: #gtViewIntervalsFor:
%

category: 'initialization'
method: GtRemotePhlowTextAttributeRunsStylerSpecification
initializeFromJSONDictionary: aTextStylerSpecificationData 
	super initializeFromJSONDictionary: aTextStylerSpecificationData .
	
	attributeRuns := GtPhlowRuns fromJSONDictionary:   (aTextStylerSpecificationData at: 'attributeRuns')
%

category: 'accessing'
method: GtRemotePhlowTextAttributeRunsStylerSpecification
numberOfRuns
	^ attributeRuns 
		ifNil: [ 0 ] 
		ifNotNil: [ attributeRuns size ]
%

! Class implementation for 'GtRemotePhlowTextClassStylerSpecification'

!		Class methods for 'GtRemotePhlowTextClassStylerSpecification'

category: 'accessing'
classmethod: GtRemotePhlowTextClassStylerSpecification
typeLabel
	^ 'remotePhlowTextClassStylerSpecification'
%

!		Instance methods for 'GtRemotePhlowTextClassStylerSpecification'

category: 'converting'
method: GtRemotePhlowTextClassStylerSpecification
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation.
	Subclasses will override and add to the dictionary"

	^ super asDictionaryForExport
		at: 'stylerClassName' put: stylerClassName;
		yourself
%

category: 'initialization'
method: GtRemotePhlowTextClassStylerSpecification
initializeFromJSONDictionary: aTextStylerSpecificationData 
	super initializeFromJSONDictionary: aTextStylerSpecificationData .
	
	stylerClassName := (aTextStylerSpecificationData at: 'stylerClassName') asSymbol
%

category: 'accessing'
method: GtRemotePhlowTextClassStylerSpecification
stylerClassName
	^ stylerClassName
%

category: 'accessing'
method: GtRemotePhlowTextClassStylerSpecification
stylerClassName: aClassName
	stylerClassName := aClassName
%

! Class implementation for 'GtRemotePhlowTextParserStylerSpecification'

!		Class methods for 'GtRemotePhlowTextParserStylerSpecification'

category: 'accessing'
classmethod: GtRemotePhlowTextParserStylerSpecification
typeLabel
	^ 'remotePhlowTextParserStylerSpecification'
%

!		Instance methods for 'GtRemotePhlowTextParserStylerSpecification'

category: 'converting'
method: GtRemotePhlowTextParserStylerSpecification
asDictionaryForExport
	"Answer the receiver as a dictionary ready for JSON serialisation.
	Subclasses will override and add to the dictionary"

	^ super asDictionaryForExport
		at: 'parserClassName' put: parserClassName;
		yourself
%

category: 'accessing'
method: GtRemotePhlowTextParserStylerSpecification
initializeFromJSONDictionary: aTextStylerSpecificationData 
	super initializeFromJSONDictionary: aTextStylerSpecificationData .
	
	parserClassName := (aTextStylerSpecificationData at: 'parserClassName') asSymbol
%

category: 'accessing'
method: GtRemotePhlowTextParserStylerSpecification
parserClassName
	^ parserClassName
%

category: 'accessing'
method: GtRemotePhlowTextParserStylerSpecification
parserClassName: aClassName
	parserClassName := aClassName
%

! Class implementation for 'GtRemotePhlowTextNullStylerSpecification'

!		Class methods for 'GtRemotePhlowTextNullStylerSpecification'

category: 'accessing'
classmethod: GtRemotePhlowTextNullStylerSpecification
typeLabel
	^ 'remotePhlowTextNullStylerSpecification'
%

!		Instance methods for 'GtRemotePhlowTextNullStylerSpecification'

category: 'testing'
method: GtRemotePhlowTextNullStylerSpecification
canAffectText
	^ false
%

! Class implementation for 'GtRemoteTextStylerComputableSpecification'

!		Instance methods for 'GtRemoteTextStylerComputableSpecification'

category: 'converting'
method: GtRemoteTextStylerComputableSpecification
convertToSerializableSpecificationForText: aText
	| computedStyler styledText |
	
	computedStyler := self stylerComputation value.
	styledText := computedStyler style: aText.
	^ GtRemotePhlowTextAttributeRunsStylerSpecification new
		attributeRuns: styledText extractRemotePhlowRuns
%

category: 'accessing'
method: GtRemoteTextStylerComputableSpecification
stylerComputation
	^ stylerComputation
%

category: 'accessing'
method: GtRemoteTextStylerComputableSpecification
stylerComputation: aComputation
	stylerComputation := aComputation
%

! Class implementation for 'GtRemotePhlowViewedObject'

!		Class methods for 'GtRemotePhlowViewedObject'

category: 'instance creation'
classmethod: GtRemotePhlowViewedObject
object: anObject

	^ self new initializeWith: anObject
%

!		Instance methods for 'GtRemotePhlowViewedObject'

category: 'accessing'
method: GtRemotePhlowViewedObject
actionSpecificationsBySelector
	actionSpecificationsBySelector ifNil: [ 
		self initializeActionSpecifications ].
	^ actionSpecificationsBySelector
%

category: 'initialization'
method: GtRemotePhlowViewedObject
computeActionSpecificationForPhlowAction: aPhlowAction
	^ [ aPhlowAction asGtDeclarativeAction ] 
		on: Error do: [ :anError |
			| errorView |
			errorView := aPhlowAction phlowErrorViewWithException: anError.
			errorView title: aPhlowAction title.
			errorView priority: aPhlowAction priority.
			
			errorView asGtDeclarativeAction ]
%

category: 'initialization'
method: GtRemotePhlowViewedObject
computeDeclarativeActionSpecifications
	| specifications phlowActions |
	
	specifications := OrderedCollection new. 

	phlowActions := self phlowDeclarativeActions.
	phlowActions
		do: [ :aPhlowAction | 
			| actionSpecification |
			actionSpecification := self 
				computeActionSpecificationForPhlowAction: aPhlowAction.
			actionSpecification
				ifNotNil: [ 
					actionSpecification methodSelector: aPhlowAction definingSelector.
					specifications add: actionSpecification ] ].
					
	^ specifications
%

category: 'initialization'
method: GtRemotePhlowViewedObject
computeDeclarativeViewSpecifications
	| specifications phlowViews |

	specifications := OrderedCollection new. 
	
	phlowViews := self phlowDeclarativeViews.
	phlowViews do: [ :aPhlowView | 
		| viewSpecification |
		viewSpecification := self computeViewSpecificationForPhlowView: aPhlowView.
		viewSpecification
			ifNotNil: [ 
				viewSpecification methodSelector: aPhlowView definingSelector.
				specifications add: viewSpecification ] ].
					 
	^ specifications
%

category: 'initialization'
method: GtRemotePhlowViewedObject
computeViewSpecificationForPhlowView: aPhlowView
	^ [ aPhlowView asGtDeclarativeView ] 
		on: Error do: [ :anError |
			| errorView |
			errorView := aPhlowView phlowErrorViewWithException: anError.
			errorView title: aPhlowView title.
			errorView priority: aPhlowView priority.
			
			errorView asGtDeclarativeView ]
%

category: 'api - views'
method: GtRemotePhlowViewedObject
getActionSpecificationDataFor: anActionSelector
	| declarativeAction |
	declarativeAction := self getActionSpecificationFor: anActionSelector.
	^ self specificationDataForAction: declarativeAction
%

category: 'api - actions'
method: GtRemotePhlowViewedObject
getActionSpecificationFor: anActionSelector
	^ self actionSpecificationsBySelector 
		at: anActionSelector
%

category: 'api - actions'
method: GtRemotePhlowViewedObject
getActionSpecifications
	^ self getActionSpecificationsData
%

category: 'api - actions'
method: GtRemotePhlowViewedObject
getActionSpecificationsData
	| actionsSpecifications |
	actionsSpecifications := self actionSpecificationsBySelector 
		collect: [ :anActionSpecification |
			self specificationDataForAction: anActionSpecification ].
	^ Dictionary new
		at: 'actions' put: actionsSpecifications asArray;
		yourself
%

category: 'api - actions'
method: GtRemotePhlowViewedObject
getActionSpecificationsPhlowDataSource
	| actionsSpecifications |
	actionsSpecifications := (self actionSpecificationsBySelector 
		collect: [ :anActionSpecification |
			(self specificationDataForAction: anActionSpecification)
				ifNotNil: [ :aDictionary |
					aDictionary 
						at: 'phlowDataSource' 
							put: anActionSpecification phlowDataSource;
						yourself ] ]).
	^ Dictionary new
		at: 'actions' put: actionsSpecifications asArray;
		yourself
%

category: 'api - actions'
method: GtRemotePhlowViewedObject
getActionSpecificationsWithPhlowDataSource
	| actionsSpecifications |
	actionsSpecifications := (self actionSpecificationsBySelector 
		collect: [ :anActionSpecification |
			(self specificationDataForAction: anActionSpecification)
				ifNotNil: [ :aDictionary |
					aDictionary 
						at: 'phlowDataSource' 
							put: anActionSpecification phlowDataSource;
						yourself ] ]).
	^ Dictionary new
		at: 'actions' put: actionsSpecifications asArray;
		yourself
%

category: 'api  - inspector'
method: GtRemotePhlowViewedObject
getClassSpecification
	^ GtRemotePhlowViewedObjectClassSpecification forClass: object class
%

category: 'api  - inspector'
method: GtRemotePhlowViewedObject
getClassSpecificationData 
	^ self getClassSpecification asDictionaryForExport
%

category: 'api - actions'
method: GtRemotePhlowViewedObject
getDeclarativeActionDataSourceFor: anActionSelector
	^ (self getActionSpecificationFor: anActionSelector) phlowDataSource
%

category: 'api - views deprecated'
method: GtRemotePhlowViewedObject
getDeclarativeViewFor: viewSelector
	^ self getViewSpecificationFor: viewSelector
%

category: 'api - views'
method: GtRemotePhlowViewedObject
getDeclarativeViewMethodNames
	"Answer the set of declarative view selectors provided by the object"

	^ self viewSpecificationsBySelector keys
%

category: 'api  - inspector'
method: GtRemotePhlowViewedObject
getInspectorSpecificationData
	^ Dictionary new 
		at: 'gtDisplayString' put: (
			self getRemoteObjectGtDisplayString);
		at: 'views' put:   (self getViewSpecificationsData
			at: 'views');
		at: 'actions' put: (self getActionSpecificationsData
			at: 'actions');
		at:'class' put: self getClassSpecificationData;
		yourself
%

category: 'api  - inspector'
method: GtRemotePhlowViewedObject
getInspectorSpecificationWithPhlowDataSource
	^ Dictionary new 
		at: 'gtDisplayString' put: (
			self getRemoteObjectGtDisplayString);
		at: 'views' put:   (self getViewSpecificationWithPhlowDataSource
			at: 'views');
		at: 'actions' put: (self getActionSpecificationsWithPhlowDataSource
			at: 'actions');
		at:'class' put: self getClassSpecificationData;
		yourself
%

category: 'api - printing'
method: GtRemotePhlowViewedObject
getRemoteObjectGtDisplayString
	^ object gtDisplayString
%

category: 'api - views deprecated'
method: GtRemotePhlowViewedObject
getViewDeclaration: aViewSelector
	^ self getViewSpecificationDataFor: aViewSelector
%

category: 'api - views deprecated'
method: GtRemotePhlowViewedObject
getViewsDeclarations
	^ self getViewSpecificationsData
%

category: 'api - views deprecated'
method: GtRemotePhlowViewedObject
getViewsDeclarationsWithPhlowDataSource
	^ self getViewSpecificationWithPhlowDataSource
%

category: 'api - views'
method: GtRemotePhlowViewedObject
getViewSpecificationDataFor: aViewSelector
	| declarativeView |
	declarativeView := self getViewSpecificationFor: aViewSelector.
	^ self specificationDataForView: declarativeView
%

category: 'api - views'
method: GtRemotePhlowViewedObject
getViewSpecificationFor: viewSelector
	^ self viewSpecificationsBySelector at: viewSelector
%

category: 'api - views'
method: GtRemotePhlowViewedObject
getViewSpecificationsData
	| viewDeclarations |
	viewDeclarations := (self viewSpecificationsBySelector 
		collect: [ :aViewSpecification |
			self specificationDataForView: aViewSpecification ]).
	^ Dictionary new
		at: 'views' put: viewDeclarations asArray;
		yourself
%

category: 'api  - inspector'
method: GtRemotePhlowViewedObject
getViewSpecificationWithPhlowDataSource
	| viewDeclarations |
	viewDeclarations := (self viewSpecificationsBySelector 
		collect: [ :aViewSpecification |
			(self specificationDataForView: aViewSpecification)
				ifNotNil: [ :aDictionary |
					aDictionary 
						at: 'phlowDataSource' put: aViewSpecification;
						yourself ] ]).
	^ Dictionary new
		at: 'views' put: viewDeclarations asArray;
		yourself
%

category: 'gt - extensions'
method: GtRemotePhlowViewedObject
gtViewCurrentViewsFor: aView
	<gtView>
	
	^ aView columnedList
		title: 'Current views';
		priority: 10;
		items: [ (viewSpecificationsBySelector
			ifNil: [ #() ] ifNotNil: [ :aDictionary | aDictionary values ]) 
				sort: [ :a :b |  a priority < b priority ]];
		column: 'Title' text: [ :aViewAccessor | aViewAccessor title ];
		column: 'Selector' text: [ :aViewAccessor | aViewAccessor methodSelector ];
		column: 'View' text: [ :aViewAccessor | aViewAccessor viewName ];
		column: 'Priority' text: [ :aViewAccessor | aViewAccessor priority ] width: 75;
		column: 'Transport' text: [ :aViewAccessor | aViewAccessor dataTransport ] width: 75;
		send: [ :aDeclarativeView | aDeclarativeView ]
%

category: 'gt - extensions'
method: GtRemotePhlowViewedObject
gtViewsCurrentActionsFor: aView
	<gtView>
	
	^ aView columnedList
		title: 'Current actions';
		priority: 20;
		items: [ (actionSpecificationsBySelector
			ifNil: [ #() ] ifNotNil: [ :aDictionary | aDictionary values ]) 
				sort: [ :a :b |  a priority < b priority ]];
		column: 'Tooltip' text: [ :aViewAccessor | aViewAccessor tooltipText ];
		column: 'Label' text: [ :aViewAccessor | aViewAccessor label ];
		"column: 'Icon' 
			icon: [ :aViewAccessor | 
				aViewAccessor iconStencil ifNil: [BlElement new
					size: 0@0] ] 
			width: 75;"
		column: 'Selector' text: [ :aViewAccessor | aViewAccessor methodSelector ];
		column: 'Priority' text: [ :aViewAccessor | aViewAccessor priority ] width: 70;
		send: [ :aDeclarativeView | aDeclarativeView ]
%

category: 'initialization'
method: GtRemotePhlowViewedObject
initializeActionSpecifications
	actionSpecificationsBySelector := Dictionary new.

	self computeDeclarativeActionSpecifications
		do: [ :anActionSpecification |
			actionSpecificationsBySelector
				at: anActionSpecification methodSelector
				put: anActionSpecification ] 
%

category: 'initialization'
method: GtRemotePhlowViewedObject
initializeViewSpecifications
	viewSpecificationsBySelector := Dictionary new.

	self computeDeclarativeViewSpecifications
		do: [ :aViewSpecification| 
			viewSpecificationsBySelector
				at: aViewSpecification methodSelector
				put: aViewSpecification ] 
%

category: 'initialization'
method: GtRemotePhlowViewedObject
initializeWith: anObject
	object := anObject
%

category: 'accessing'
method: GtRemotePhlowViewedObject
object

	^ object
%

category: 'initialization'
method: GtRemotePhlowViewedObject
phlowDeclarativeActions
	"Retrieve the declarative phlow actions of the current object."
	
	 ^ object gtDeclarativePhlowActions.
%

category: 'initialization'
method: GtRemotePhlowViewedObject
phlowDeclarativeViews
	"Retrieve the objects declarative views.
	If the default Raw view can't be declarative, provide one that is."
	| views |

	views := object gtDeclarativePhlowViews.
	views 
		detect: [ :each | each title = 'Raw' ]
		ifNone: [ views := views, (Array with: (object 
			gtRemoteGtRawFor: #GtPhlowView asClass empty)) ].
	
	^ views
%

category: 'utils'
method: GtRemotePhlowViewedObject
specificationDataForAction: anActionSpecification

	^ anActionSpecification asDictionaryForExport
%

category: 'utils'
method: GtRemotePhlowViewedObject
specificationDataForView: aViewSpecification

	^ aViewSpecification asDictionaryForExport
%

category: 'accessing'
method: GtRemotePhlowViewedObject
viewSpecificationsBySelector
	viewSpecificationsBySelector ifNil: [ 
		self initializeViewSpecifications ].
	^ viewSpecificationsBySelector
%

! Class implementation for 'GtRmGeoGpsGroup'

!		Instance methods for 'GtRmGeoGpsGroup'

category: 'accessing'
method: GtRmGeoGpsGroup
add: anObject
	self clearCache.
	self items add: anObject
%

category: 'accessing'
method: GtRmGeoGpsGroup
addAll: aCollection
	self clearCache.
	self items addAll: aCollection
%

category: 'accessing'
method: GtRmGeoGpsGroup
cacheAt: aKey ifAbsentPut: aBlock
	cache ifNil: [ 
		cache := Dictionary new].
	^ cache 
		at: aKey
		ifAbsentPut: [ aBlock value ]
%

category: 'accessing'
method: GtRmGeoGpsGroup
clearCache
	cache := nil
%

category: 'accessing'
method: GtRmGeoGpsGroup
collect: aBlock
	^ self items  collect: aBlock
%

category: 'accessing'
method: GtRmGeoGpsGroup
detect: aBlock ifNone: exceptionBlock
	^ self items 
		detect: aBlock ifNone: exceptionBlock
%

category: 'accessing'
method: GtRmGeoGpsGroup
do: aBlock 
	self items do: aBlock
%

category: 'accessing'
method: GtRmGeoGpsGroup
items
	^ items ifNil: [
		items := OrderedCollection new ]
%

category: 'printing'
method: GtRmGeoGpsGroup
printOn: aStream
	super printOn: aStream.
	
	aStream 
		<< '[';
		print: self size;
		<< ' items';
		<< ']'
%

category: 'accessing'
method: GtRmGeoGpsGroup
select: aBlock
	^ self class new 
		addAll: (self items  select: aBlock)
%

category: 'accessing'
method: GtRmGeoGpsGroup
size
	^ self items size
%

category: 'accessing'
method: GtRmGeoGpsGroup
sumNumbers: aBlock
	^ self items
		inject: 0 
		into: [ :sum :each |  sum + (aBlock value: each) ]
%

! Class implementation for 'GtRmGeoGpsRecordsGroup'

!		Instance methods for 'GtRmGeoGpsRecordsGroup'

category: 'accessing'
method: GtRmGeoGpsRecordsGroup
computeDistance
	| distance |
	self size = 1 ifTrue: [ ^ 0 ].
	distance := 0.
	1 to: self size - 1 do: [ :anIndex |
		distance := distance + (self
			distanceFrom: (self items at: anIndex)
			to: (self items at: anIndex + 1)) ].
	^ distance
%

category: 'accessing'
method: GtRmGeoGpsRecordsGroup
computeDistanceWithBug
	| distance |
	self size = 1 ifTrue: [ ^ 0 ].
	distance := 0.
	1 to: self size + 1 do: [ :anIndex |
		distance := distance + (self
			distanceFrom: (self items at: anIndex)
			to: (self items at: anIndex + 1)) ].
	^ distance
%

category: 'accessing'
method: GtRmGeoGpsRecordsGroup
distance
	^ self 
		cacheAt: 'distance' 
		ifAbsentPut: [
			self computeDistance ]
%

category: 'accessing'
method: GtRmGeoGpsRecordsGroup
distanceBetween: firstPosition and: secondPosition
        "T3GeoTools distanceBetween: 5.33732@50.926 and: 5.49705@50.82733"

        | c |
        c := (firstPosition y degreesToRadians sin 
        	* secondPosition y degreesToRadians sin)
                + (firstPosition y degreesToRadians cos 
                	* secondPosition y degreesToRadians cos
                        * (secondPosition x degreesToRadians 
                        	- firstPosition x degreesToRadians) cos).
        c := c >= 0 ifTrue: [ 1 min: c ] ifFalse: [ -1 max: c ].
        ^ c arcCos * 6371000
%

category: 'accessing'
method: GtRmGeoGpsRecordsGroup
distanceFrom: firstRecord to: secondRecord
	| c |
    c := (firstRecord longitude degreesToRadians sin 
    	* secondRecord longitude degreesToRadians sin)
			+ (firstRecord longitude degreesToRadians cos 
				* secondRecord longitude degreesToRadians cos
            		* (secondRecord latitude degreesToRadians 
            			- firstRecord latitude degreesToRadians) cos).
    c := c >= 0 ifTrue: [ 1 min: c ] ifFalse: [ -1 max: c ].
    ^ c arcCos * 6371000
%

category: 'gt - extensions'
method: GtRmGeoGpsRecordsGroup
gtItemsFor: aView
	<gtView>
	
	^ aView columnedList
		title: 'Records';
		items: [ self items ];
		column: 'Timestamp' text: [ :aRecord | aRecord timestamp ];
		column: 'Latitude' text: [ :aRecord | aRecord latitude ];
		column: 'Longitude' text: [ :aRecord | aRecord longitude ]
%

! Class implementation for 'GtRmGeoGpsTrajectoriesGroup'

!		Instance methods for 'GtRmGeoGpsTrajectoriesGroup'

category: 'accessing'
method: GtRmGeoGpsTrajectoriesGroup
allRecords
	^ self 
		cacheAt: 'allRecords' 
		ifAbsentPut: [  
			self items
				inject: GtRmGeoGpsRecordsGroup new 
				into: [ :records :aTrajectory |
					records addAll: aTrajectory records items.
					records ] ]
%

category: 'gt - extensions'
method: GtRmGeoGpsTrajectoriesGroup
gtItemsFor: aView
	<gtView>
	
	^ aView columnedList
		title: 'Trajectories';
		items: [ self items ];
		column: 'Filename' text: [ :aTrajectory | 
			aTrajectory targetFolderName ];
		column: 'Records' text: [ :aTrajectory | 
			aTrajectory numberOfRecords ];
		column: 'Distance (km)' text: [ :aTrajectory | 
			self 
				gtDo: [
					(aTrajectory distance /1000) printShowingDecimalPlaces: 2] 
				gemstoneDo: [
					(aTrajectory distance /1000) asStringUsingFormat: #(0 2 false)  ] ]
%

! Class implementation for 'GtRmGeoGpsUsersGroup'

!		Instance methods for 'GtRmGeoGpsUsersGroup'

category: 'accessing'
method: GtRmGeoGpsUsersGroup
allRecords
	^ self 
		cacheAt: 'allRecords'
		ifAbsentPut: [ 
			self allTrajectories allRecords ]
%

category: 'accessing'
method: GtRmGeoGpsUsersGroup
allTrajectories
	^ self 
		cacheAt: 'allTrajectories'
		ifAbsentPut: [  
			self items
				inject: GtRmGeoGpsTrajectoriesGroup new 
				into: [ :trajectories :aUser |
					trajectories addAll: aUser trajectories.
					trajectories ] ]
%

category: 'gt - extensions'
method: GtRmGeoGpsUsersGroup
gtItemsFor: aView
	<gtView>
	
	^ aView columnedList
		title: 'Users';
		priority: 5;
		items: [ self items ];
		column: 'Id' text: [ :aUser | aUser id ];
		column: 'Number of trajectories' 
			text: [ :aUser | aUser numberOfTrajectories ];
		column: 'Number of records' 
			text: [ :aUser | aUser numberOfRecords  ]
%

category: 'gt - extensions'
method: GtRmGeoGpsUsersGroup
gtViewAllTrajectoriesFor: aView
	<gtView>
	
	^ aView forward
		title: 'All trajectories';
		priority: 45;
		object: [ self allTrajectories ];
		view: #gtItemsFor:
%

category: 'accessing'
method: GtRmGeoGpsUsersGroup
removeUser: aString
	"Remove the supplied user.
	GS only has #detect:ifNone: (not #detect:ifFound:)"

	(items
		detect: [ :user | user id = aString ]
		ifNone: [ nil ]) ifNotNil:
			[ :user | items remove: user ]
%

category: 'accessing'
method: GtRmGeoGpsUsersGroup
shortDistancesWithBug
	^ self allTrajectories select: [ :aTrajectory |
		aTrajectory distanceWithBug < 5 ]
%

! Class implementation for 'GtRmGeoGpsRecord'

!		Class methods for 'GtRmGeoGpsRecord'

category: 'instance creation'
classmethod: GtRmGeoGpsRecord
fromJsonDictionary: aDictionary
	^ self new 
		initializeFomJsonDictionary: aDictionary
%

!		Instance methods for 'GtRmGeoGpsRecord'

category: 'converting'
method: GtRmGeoGpsRecord
asJsonDictionary
	^ {
		#timestamp -> self timestamp.
		#latitude -> self latitude.
		#longitude -> self longitude } asDictionary
%

category: 'accessing'
method: GtRmGeoGpsRecord
asPoint

	^ self longitude @ self latitude
%

category: 'accessing'
method: GtRmGeoGpsRecord
googleMapsUrl
	^ 'https://www.google.com/maps/search/?api=1&query='
		,self latitude printString
		,'%2C'
		, self longitude printString 
%

category: 'initialization'
method: GtRmGeoGpsRecord
initializeFomJsonDictionary: aDictionary
	self latitude: (aDictionary at: #latitude).
	self longitude: (aDictionary at: #longitude).
	self timestamp: (aDictionary at: #timestamp)
%

category: 'accessing'
method: GtRmGeoGpsRecord
latitude
	^ latitude
%

category: 'accessing'
method: GtRmGeoGpsRecord
latitude: aFloat
	latitude := aFloat
%

category: 'accessing'
method: GtRmGeoGpsRecord
longitude
	^ longitude
%

category: 'accessing'
method: GtRmGeoGpsRecord
longitude: aFloat
	longitude := aFloat
%

category: 'printing'
method: GtRmGeoGpsRecord
printOn: aStream
	super printOn: aStream.
	
	aStream 
		<< '(';
		print: self timestamp;
		<< '; ';
		print: self latitude;
		<< ', ';
		print: self longitude;
		<< ')'
%

category: 'accessing'
method: GtRmGeoGpsRecord
timestamp
	^ timestamp
%

category: 'accessing'
method: GtRmGeoGpsRecord
timestamp: aDateAndTime
	timestamp := aDateAndTime
%

! Class implementation for 'GtRmGeoGpsTrajectory'

!		Class methods for 'GtRmGeoGpsTrajectory'

category: 'instance creation'
classmethod: GtRmGeoGpsTrajectory
fromJsonDictionary: aDictionary
	^ self new 
		initializeFomJsonDictionary: aDictionary
%

!		Instance methods for 'GtRmGeoGpsTrajectory'

category: 'adding'
method: GtRmGeoGpsTrajectory
addRecord: aRecord
	self records add: aRecord
%

category: 'accessing'
method: GtRmGeoGpsTrajectory
asJsonDictionary
	^ {
		'targetFolderName' -> self targetFolderName.
		'records' -> self recordsAsJsonData  } asDictionary
%

category: 'accessing'
method: GtRmGeoGpsTrajectory
distance
	^ self records distance
%

category: 'accessing'
method: GtRmGeoGpsTrajectory
distanceWithBug
	^ self records computeDistanceWithBug
%

category: 'gt - extensions'
method: GtRmGeoGpsTrajectory
gtViewGpsRecordsFor: aView
	<gtView>
	
	^ aView columnedList
		title: 'Records';
		priority: 10;
		items: [ self records items ];
		column: 'Timestamp' text: [ :aRecord | aRecord timestamp ];
		column: 'Latitude' text: [ :aRecord | aRecord latitude ];
		column: 'Longitude' text: [ :aRecord | aRecord longitude ]
%

category: 'initialization'
method: GtRmGeoGpsTrajectory
initializeFomJsonDictionary: aDictionary
	self targetFolderName: (aDictionary at: 'targetFolderName').
	
	(aDictionary at: 'records') do: [ :aRecordData |
		self addRecord:  (GtRmGeoGpsRecord 
			fromJsonDictionary: aRecordData) ].
%

category: 'accessing'
method: GtRmGeoGpsTrajectory
numberOfRecords
	^ self records size
%

category: 'printing'
method: GtRmGeoGpsTrajectory
printOn: aStream
	super printOn: aStream.
	
	aStream 
		<< '(';
		print: self targetFolderName;
		<< '; ';
		print: self records size;
		<< ' records';
		<< ')'
%

category: 'accessing'
method: GtRmGeoGpsTrajectory
records
	^ records ifNil: [
		records := GtRmGeoGpsRecordsGroup new ]
%

category: 'accessing'
method: GtRmGeoGpsTrajectory
recordsAsJsonData
	^ (self records collect: [ :aRecord |
			aRecord asJsonDictionary ]) asArray
%

category: 'accessing'
method: GtRmGeoGpsTrajectory
targetFolderName
	^ targetFolderName
%

category: 'accessing'
method: GtRmGeoGpsTrajectory
targetFolderName: aFolderName
	targetFolderName := aFolderName
%

! Class implementation for 'GtRmGeolife'

!		Class methods for 'GtRmGeolife'

category: 'accessing'
classmethod: GtRmGeolife
defaultInstance
	^ DEFAULT ifNil: [
		DEFAULT := self new ]
%

category: 'accessing'
classmethod: GtRmGeolife
resetDefaultInstance
	DEFAULT := nil
%

!		Instance methods for 'GtRmGeolife'

category: 'adding'
method: GtRmGeolife
addUser: aUser
	self users add: aUser
%

category: 'adding'
method: GtRmGeolife
addUsers: aCollection
	self users addAll: aCollection
%

category: 'accessing'
method: GtRmGeolife
allRecords
	
	^ self users allRecords
%

category: 'accessing'
method: GtRmGeolife
allTrajectories
	
	^ self users allTrajectories
%

category: 'initialization'
method: GtRmGeolife
defaultUsersGroup
	^ GtRmGeoGpsUsersGroup new
%

category: 'adding'
method: GtRmGeolife
ensureUserWithId: anId
	^ self users 
		detect: [ :aUser | aUser id = anId ]
		ifNone: [ 
			| newUser |
			newUser := GtRmGeoUser new 
				id: anId.
			self addUser: newUser.
			newUser ]
%

category: 'gt - extensions'
method: GtRmGeolife
gtViewAllTrajectoriesFor: aView
	<gtView>
	
	^ aView forward
		title: 'Trajectories';
		priority: 45;
		object: [ self allTrajectories ];
		view: #gtItemsFor:
%

category: 'gt - extensions'
method: GtRmGeolife
gtViewSummaryDataFor: aView
	<gtView>
	
	^ aView columnedList
		title: 'Overview';
		priority: 1;
		items: [ self summaryData ];
		column: 'Name' text: [ :array | array first ];
		column: 'Value' text: [ :array | array second value ];
		send: [ :array | array third value ]
%

category: 'gt - extensions'
method: GtRmGeolife
gtViewUsersFor: aView
	<gtView>
	
	^ aView forward
		title: 'Users';
		priority: 10;
		object: [ self users ];
		view: #gtItemsFor:
%

category: 'accessing'
method: GtRmGeolife
numberOfUsers
	^ self users size
%

category: 'printing'
method: GtRmGeolife
printOn: aStream
	super printOn: aStream.
	
	aStream 
		<< '(';
		print: self numberOfUsers;
		<< ' users';
		<< ')'
%

category: 'accessing'
method: GtRmGeolife
removeUser: aString

	self users removeUser: aString
%

category: 'accessing'
method: GtRmGeolife
summaryData
	^ {
		{'Users'. [ self users size]. [self users]}.
		{'Trajectories'. [ self allTrajectories size]. [self allTrajectories]}.
		{'Records'. [ self allRecords size]. [self allRecords]}
	}
%

category: 'accessing'
method: GtRmGeolife
users
	^ users ifNil: [
		users := self defaultUsersGroup ]
%

! Class implementation for 'GtRmGeolifeBaseImporter'

!		Instance methods for 'GtRmGeolifeBaseImporter'

category: 'importing'
method: GtRmGeolifeBaseImporter
createRecordFromLine: aLine
	| parts record |
	record := GtRmGeoGpsRecord new.
	parts := aLine splitOn: ','.
	
	record 
		timestamp: (DateAndTime  
			date: (Date fromString: parts sixth)
			time: (Time fromString: parts seventh));
		longitude: (parts second asNumber);
		latitude:(parts first asNumber).
		
	^ record
%

category: 'importing'
method: GtRmGeolifeBaseImporter
createTrajectoryFromDirectory: aTrajectoryFolder 
	| trajectory lines |
	
	trajectory := GtRmGeoGpsTrajectory new.
	trajectory targetFolderName: aTrajectoryFolder basename.
	lines := aTrajectoryFolder contents lines.
	7 to: lines size do: [ :anIndex |
		| record | 
		record := self createRecordFromLine: (lines at: anIndex).
		trajectory addRecord: record ].
		
	^ trajectory
%

category: 'accessing'
method: GtRmGeolifeBaseImporter
directoriesToImport
	| directories |
	
	directories := (currentDirectory / 'Data') directories.
	^ usersCount 
		ifNil: [ directories ] 
		ifNotNil: [ directories first: usersCount ]
%

category: 'accessing'
method: GtRmGeolifeBaseImporter
usersCount: aNumber
	usersCount := aNumber
%

! Class implementation for 'GtRmGeolifeLocalImporter'

!		Instance methods for 'GtRmGeolifeLocalImporter'

category: 'importing'
method: GtRmGeolifeLocalImporter
createUserFromDirectory: aUserFolder
	| user |
	
	user := GtRmGeoUser new.
	user id: aUserFolder basename.
	((aUserFolder / 'Trajectory') childrenMatching: '*.plt') 
		do: [ :aTrajectoryFolder |
			| trajectory |
			trajectory := self createTrajectoryFromDirectory: aTrajectoryFolder.
			user addTrajectory:trajectory ].
	
	^ user
%

category: 'importing'
method: GtRmGeolifeLocalImporter
importFromDirectory: aDirectory
	| geoLife |
	
	currentDirectory := aDirectory.
	geoLife := GtRmGeolife new.
	
	self directoriesToImport do: [ :aUserFolder |
		self 
			importUserFromDirectory: aUserFolder
			into: geoLife ].
		
	^ geoLife
%

category: 'importing'
method: GtRmGeolifeLocalImporter
importUserFromDirectory: aUserFolder into: aGeolife
	| user |
	user := self createUserFromDirectory: aUserFolder.
	aGeolife addUser: user
%

! Class implementation for 'GtRmGeoUser'

!		Class methods for 'GtRmGeoUser'

category: 'accessing'
classmethod: GtRmGeoUser
fromJsonDictionary: aDictionary
	^ self new 
		initializeFomJsonDictionary: aDictionary
%

!		Instance methods for 'GtRmGeoUser'

category: 'adding'
method: GtRmGeoUser
addTrajectory: aTrajectory 
	self trajectories add: aTrajectory
%

category: 'adding'
method: GtRmGeoUser
addTrajectoryFromJsonData: aJsonData
	self addTrajectory: (GtRmGeoGpsTrajectory 
		fromJsonDictionary:  aJsonData)
%

category: 'accessing'
method: GtRmGeoUser
allRecords
	
	^ self trajectories allRecords
%

category: 'accessing'
method: GtRmGeoUser
asJsonDictionary
	^ {
		'id' -> self id.
		'trajectories' -> self trajectoriesAsJsonData  } asDictionary
%

category: 'gt - extensions'
method: GtRmGeoUser
gtViewRecordsFor: aView
	<gtView>
	
	^ aView columnedList
		title: 'Records';
		priority: 10;
		items: [ self allRecords items ];
		column: 'Timestamp' text: [ :aRecord | aRecord timestamp ];
		column: 'Lat' text: [ :aRecord | aRecord latitude ];
		column: 'Lon' text: [ :aRecord | aRecord longitude ]
		
	"^ aView forward
		title: 'Records';
		priority: 10;
		object: [ self allRecords ];
		view: #gtItemsFor: "
%

category: 'gt - extensions'
method: GtRmGeoUser
gtViewSummaryDataFor: aView
	<gtView>
	
	^ aView columnedList
		title: 'Overview';
		priority: 1;
		items: [ self summaryData ];
		column: 'Name' text: [ :array | array first ];
		column: 'Value' text: [ :array | array second value ];
		send: [ :array | array third value ]
%

category: 'gt - extensions'
method: GtRmGeoUser
gtViewTrajectoriesFor: aView
	<gtView>
	
	^ aView forward
		title: 'Trajectories';
		priority: 5;
		object: [ self trajectories ];
		view: #gtItemsFor:
%

category: 'accessing'
method: GtRmGeoUser
id
	^ id
%

category: 'accessing'
method: GtRmGeoUser
id: anObject
	id := anObject
%

category: 'initialization'
method: GtRmGeoUser
initializeFomJsonDictionary: aDictionary
	self id: (aDictionary at: 'id').
	
	(aDictionary at: 'trajectories') do: [ :aTrajectoryData |
		self addTrajectory:  (GtRmGeoGpsTrajectory 
			fromJsonDictionary: aTrajectoryData) ].
%

category: 'accessing'
method: GtRmGeoUser
numberOfRecords
	^ self trajectories sumNumbers: [ :aTrajectory |
		aTrajectory numberOfRecords ]
%

category: 'accessing'
method: GtRmGeoUser
numberOfTrajectories
	^ self trajectories size
%

category: 'printing'
method: GtRmGeoUser
printOn: aStream
	super printOn: aStream.
	
	aStream 
		<< '(';
		print: self id;
		<< '; ';
		print: self trajectories size;
		<< ' trajectories';
		<< ')'
%

category: 'accessing'
method: GtRmGeoUser
summaryData
	^ {
		{'Trajectories'. [ self trajectories size]. [self trajectories]}.
		{'Records'. [ self allRecords size]. [self allRecords]}
	}
%

category: 'accessing'
method: GtRmGeoUser
trajectories
	^ trajectories ifNil: [
		trajectories := GtRmGeoGpsTrajectoriesGroup new ]
%

category: 'accessing'
method: GtRmGeoUser
trajectoriesAsJsonData
	^ (self trajectories collect: [ :aTrajectory |
			aTrajectory asJsonDictionary ]) asArray
%

! Class implementation for 'GtRmMovie'

!		Class methods for 'GtRmMovie'

category: 'instance creation'
classmethod: GtRmMovie
fromRawData: aRawData withProperties: aCollectionOfPropertyNames
	^ self new 
		rawData: aRawData;
		propertyNames:aCollectionOfPropertyNames
%

!		Instance methods for 'GtRmMovie'

category: 'gt - extensions'
method: GtRmMovie
gtViewDetailsFor: aView 
	<gtView>
	
	^ aView columnedList 
		title: 'Details';
		priority: 20;
		items: [ 1 to: propertyNames size ];
		column: 'Key' text: [ :anIndex | propertyNames at: anIndex ];
		column: 'Value' text: [ :anIndex | rawData at: anIndex ];
		send: [ :anIndex | rawData at: anIndex ]
%

category: 'accessing'
method: GtRmMovie
propertyNames
	^ propertyNames
%

category: 'accessing'
method: GtRmMovie
propertyNames: aCollectionOfPropertyNames
	propertyNames := aCollectionOfPropertyNames
%

category: 'accessing'
method: GtRmMovie
rawData
	^ rawData
%

category: 'accessing'
method: GtRmMovie
rawData: anObject
	rawData := anObject
%

! Class implementation for 'GtRmMovieCollection'

!		Class methods for 'GtRmMovieCollection'

category: 'accessing'
classmethod: GtRmMovieCollection
defaultInstance
	^ DEFAULT ifNil: [
		DEFAULT := self new ]
%

category: 'instance creation'
classmethod: GtRmMovieCollection
fromFullData: anArray 
	^ self new 
		initializeFromFullData: anArray 
%

category: 'instance creation'
classmethod: GtRmMovieCollection
fromRawData: aRawData withProperties: aCollectionOfPropertyNames
	^ self new 
		initializeFromData: aRawData
		propertyNames:aCollectionOfPropertyNames
%

category: 'accessing'
classmethod: GtRmMovieCollection
resetDefaultInstance
	DEFAULT := nil
%

!		Instance methods for 'GtRmMovieCollection'

category: 'accessing'
method: GtRmMovieCollection
directors
	^ self groupedByPropertyNamed: 'Directors'
%

category: 'accessing'
method: GtRmMovieCollection
groupDataBy: aBlock
	| groups |
	groups := Dictionary new.
	rawData do: [ :each |
		| key |
		key := aBlock value: each.
		key ifNotNil: [
		(groups 
			at: key
			ifAbsentPut: [ OrderedCollection new ]) add: each ] ].
	^ groups
%

category: 'accessing'
method: GtRmMovieCollection
groupedByPropertyNamed: aPropertyName 
	^ ((self groupDataBy: [ :aRow | 
		self 
			propertyNamed: aPropertyName
			inData: aRow ]) asGPhlowAssociationsIterator retrieveAllItems
		collect: [ :assoc | 
			assoc key -> (self movieCollectionFrom: assoc value)])
		sort: [ :a :b | 
			a key asString < b key asString ]
%

category: 'gt - extensions'
method: GtRmMovieCollection
gtViewDirectorsFor: aView
	<gtView>
	
	^ aView columnedList 
		title: 'Directors';
		priority: 20;
		items: [ self directors ];
		column: 'Director' text: [ :each | 
			each key  ];
		column: 'Count' text: [ :each | 
			each value size ];
		send: [ :each | each value ]
%

category: 'gt - extensions'
method: GtRmMovieCollection
gtViewMoviesFor: aView
	<gtView>
	
	^ aView columnedList 
		title: 'Movies';
		priority: 40;
		items: [ 1 to: self rawData size ];
		column: 'Title' text: [ :anIndex | 
			self 
				propertyNamed: 'Title' 
				atDataIndex: anIndex ];
		column: 'Release Date' text: [ :anIndex | 
			self 
				propertyNamed: 'Release Date' 
				atDataIndex: anIndex ];
		column: 'Directors' text: [ :anIndex |
			self 
				propertyNamed: 'Release Date' 
				atDataIndex: anIndex  ];
		column: 'Genres' text: [ :anIndex | 
			self 
				propertyNamed: 'Genres' 
				atDataIndex: anIndex ];
		send: [ :anIndex |
			self movieAtIndex: anIndex ]
%

category: 'gt - extensions'
method: GtRmMovieCollection
gtViewMoviesWithDetailsFor: aView
	<gtView>
	| currentView |
	
	currentView := aView columnedList 
		title: 'Movies with details';
		priority: 45;
		items: [ 1 to: self rawData size ].
		
	propertyNames do: [ :aPropertyName |
		currentView 
			column: aPropertyName 
			text: [ :anIndex |
				self 
					propertyNamed: aPropertyName
					atDataIndex: anIndex ] ].
	currentView send: [ :anIndex |
		self movieAtIndex: anIndex ].
	
	^ currentView
%

category: 'gt - extensions'
method: GtRmMovieCollection
gtViewYearsFor: aView
	<gtView>
	
	^ aView columnedList 
		title: 'Years';
		priority: 30;
		items: [ self years ];
		column: 'Year' text: [ :each | 
			each key  ];
		column: 'Count' text: [ :each | 
			each value size ];
		send: [ :each | each value ]
%

category: 'initialization'
method: GtRmMovieCollection
initializeFromData: aRawData propertyNames: aCollectionOfPropertyNames 
	self
		rawData: aRawData;
		propertyNames:aCollectionOfPropertyNames
%

category: 'initialization'
method: GtRmMovieCollection
initializeFromFullData: fullData 
	| data transformedData |
	data := fullData copyFrom: 2 to: fullData size + 1.
	transformedData := data collect: [ :each | self transformData: each ].
	self 
		initializeFromData:  transformedData
		propertyNames: (self transformData: fullData first )
%

category: 'accessing'
method: GtRmMovieCollection
movieAtIndex: anIndex 
	^ GtRmMovie 
		fromRawData: (rawData at: anIndex)
		withProperties: propertyNames
%

category: 'accessing'
method: GtRmMovieCollection
movieCollectionFrom: aCollectionOfMoviesData
	^ GtRmMovieCollection
		 fromRawData: aCollectionOfMoviesData 
		 withProperties: propertyNames 
%

category: 'accessing - properties'
method: GtRmMovieCollection
propertyNamed: aPropertyName atDataIndex: anIndex 
	^ self 
		propertyNamed: aPropertyName 
		inData: (rawData at: anIndex).
%

category: 'accessing - properties'
method: GtRmMovieCollection
propertyNamed: aPropertyName inData: aDataRow
	^ aDataRow at: (propertyNames indexOf: aPropertyName)
%

category: 'accessing'
method: GtRmMovieCollection
propertyNames
	^ propertyNames
%

category: 'accessing'
method: GtRmMovieCollection
propertyNames: aCollectionOfPropertyNames
	propertyNames := aCollectionOfPropertyNames
%

category: 'accessing'
method: GtRmMovieCollection
rawData
	^ rawData
%

category: 'accessing'
method: GtRmMovieCollection
rawData: anObject
	rawData := anObject
%

category: 'accessing'
method: GtRmMovieCollection
size
	^ rawData size
%

category: 'initialization'
method: GtRmMovieCollection
transformData: aCollection
	^ aCollection collect: [ :each |
		String streamContents: [ :aStream |
			each ifNotNil: [ aStream << each ] ] ]
%

category: 'accessing'
method: GtRmMovieCollection
years
	^ self groupedByPropertyNamed: 'Year'
%

! Class implementation for 'GtRsrInspectorProxySerializationStrategy'

!		Class methods for 'GtRsrInspectorProxySerializationStrategy'

category: 'accessing'
classmethod: GtRsrInspectorProxySerializationStrategy
strategyLabel
	^ 'InspectorProxy'
%

!		Instance methods for 'GtRsrInspectorProxySerializationStrategy'

category: 'accessing'
method: GtRsrInspectorProxySerializationStrategy
serialize: anObject
	"Called from GemStone. We defined is also for GT as it does not references GemStone specific classes"
	| inspectorWrapper |
	inspectorWrapper := GtRemotePhlowViewedObject object: anObject.
	^ self serializedDataForInspectorWrapper: inspectorWrapper
%

category: 'accessing'
method: GtRsrInspectorProxySerializationStrategy
serializedDataForInspectorWrapper: anInspectorWrapper
	"Called from GemStone. We defined is also for GT as it does not references GemStone specific classes"
	| dictionaryData proxyData |
	
	dictionaryData := Dictionary new.
	
	dictionaryData 
		at: 'proxyObject'
		put: anInspectorWrapper.
		
	proxyData := anInspectorWrapper getInspectorSpecificationWithPhlowDataSource.
	dictionaryData 
		at: 'proxyData'
		put: proxyData.
	
	^ dictionaryData asGtRsrProxyObjectForConnection: nil
%

! Class implementation for 'GtRsrInspectorProxyDataSerializationStrategy'

!		Class methods for 'GtRsrInspectorProxyDataSerializationStrategy'

category: 'accessing'
classmethod: GtRsrInspectorProxyDataSerializationStrategy
strategyLabel
	^ 'InspectorProxyData'
%

!		Instance methods for 'GtRsrInspectorProxyDataSerializationStrategy'

category: 'accessing'
method: GtRsrInspectorProxyDataSerializationStrategy
deserialize: viewProxyData
	^ viewProxyData
%

! Class extensions for 'AbstractDictionary'

!		Instance methods for 'AbstractDictionary'

category: '*GToolkit-RemotePhlow-InspectorExtensions-GemStone'
method: AbstractDictionary
asGPhlowAssociationsIterator
	^ GtRemotePhlowDictionaryAssociationsIterator forCollection: self
%

category: '*GToolkit-RemotePhlow-InspectorExtensions-GemStone'
method: AbstractDictionary
asGPhlowKeysIterator
	^ GtRemotePhlowDictionaryKeysIterator forCollection: self
%

category: '*GToolkit-RemotePhlow-InspectorExtensions-GemStone'
method: AbstractDictionary
gtItemsFor: aView
	^ aView columnedList
		title: 'Items';
		priority: 1;
		items: [ self asGPhlowAssociationsIterator ];
		column: 'Key' text: [ :assoc | assoc key ];
		column: 'Value' text: [ :assoc | assoc value ];
		send: [ :assoc | assoc value ]
%

category: '*GToolkit-RemotePhlow-InspectorExtensions-GemStone'
method: AbstractDictionary
gtRemoteKeysFor: aView
	<gtView>
	^ aView list
		title: 'Keys';
		priority: 5;
		items: [ self asGPhlowKeysIterator ]
%

! Class extensions for 'AbstractFileReference'

!		Instance methods for 'AbstractFileReference'

category: '*GToolkit-RemotePhlow-GemStone'
method: AbstractFileReference
gtChildren
	self isDirectory ifFalse: [ ^ Array new ].

	^ (self directories sort: [:a :b | a basename < b basename ]) , 
		(self files sort: [:a :b | a basename < b basename ]).
%

category: '*GToolkit-RemotePhlow-GemStone'
method: AbstractFileReference
gtChildrenWithParent
	| aChildrenCollection |
	self isDirectory ifFalse: [ ^ Array new ].
	
	aChildrenCollection := self gtChildren.
	aChildrenCollection := self isRoot
		ifTrue: [ aChildrenCollection ]
		ifFalse: [ aChildrenCollection asOrderedCollection
			addFirst: self parent;
			yourself ].
	^ aChildrenCollection
%

category: '*GToolkit-RemotePhlow-GemStone'
method: AbstractFileReference
gtContentsFor: aView
	<gtView>
	
	self isFile ifFalse: [ ^ aView empty ].

	^ aView textEditor
		title: 'Contents';
		priority: 50;
		text: [ self contents ]
%

category: '*GToolkit-RemotePhlow-GemStone'
method: AbstractFileReference
gtDetails
	| details |

	details := {
		{ #self . self }.
		{ #printString. self printString }.
		{ #gtDisplayString. self gtDisplayString }.
		{ #pathString . self pathString }.
		{ #base . self base }.
		{ #basename . self basename }.
		{ #extension . self extension }.
		{ #parent . self parent }.
		{ #path . self path }.
		{ #fullPath . self fullPath }.
		{ #absolutePath . self absolutePath }. 
		{ #fileSystem . self fileSystem }.
		{ #exists . self exists }.
		{ #isFile . self isFile }.
		{ #isDirectory . self isDirectory }.
		{ #isAbsolute . self isAbsolute }.
		{ #isRelative . self isRelative }.
	}.
	self exists ifTrue: [
		details := details , {
			{ #isReadable . [self isReadable] on: Error do: ['unsuported'] }.
			{ #isWritable . [self isWritable] on: Error do: ['unsuported'] }.
			{ #size . self size size . self size }.
			{ #uid . self uid }.
			{ #gid . self gid }.
			{ #inode . self inode }.
			{ #creationTime . [self creationTime ] 
				on: Error do: ['unsuported']}.
			{ #modificationTime . self modificationTime }.
			{ #changeTime . self changeTime }.
			{ #accessTime . self accessTime }.
			{ #permissions . self permissions }.
	} ].
	^ details
%

category: '*GToolkit-RemotePhlow-GemStone'
method: AbstractFileReference
gtDetailsFor: composite
	<gtView>

	^ composite columnedList
		title: 'Details';
		priority: 60;
		items: [ self gtDetails ];
		column: 'key' text: [ :each | each first ] width: 250;
		column: 'value' text: [ :each | each second ];
		send: [ :each | each last ]
%

category: '*GToolkit-RemotePhlow-GemStone'
method: AbstractFileReference
gtItemsFor: aView
	<gtView>
	self isDirectory
		ifFalse: [ ^ aView empty ].

	^ aView columnedList
		title: 'Items';
		priority: 1;
		items: [ self gtChildrenWithParent ];
		column: 'Icon' 
			iconName: [ :each | 
				each isDirectory
					ifTrue: [ #emptyPackage ]
					ifFalse: [ #workspace ] ]
			width: 35;
		column: 'Name'  text: [ :each | 
			(self isChildOf: each)
				ifTrue: [ '..' ]
				ifFalse: [ each basename asString ] ];
		column: 'Size' 
			text: [ :each | 
				[ each isDirectory 
					ifTrue: [ '--' ]
					ifFalse: [ each humanReadableSize asString ] ]
				on: Error
				do: [ :anException | anException return: '' ] ]
			width: 100;
		column: 'Creation' 
			text: [ :each | 
				[ String
					streamContents: [ :s | 
						each creationTime printYMDOn: s.
						s nextPut: Character space.
						each creationTime printHMSOn: s ] ]
				on: Error
				do: [ :anException | anException return: '' ] ]
			width: 150
%

category: '*GToolkit-RemotePhlow-GemStone'
method: AbstractFileReference
gtPathFor: aView
	<gtView>
	
	^ aView columnedList
		title: 'Path';
		priority: 55;
		items: [ 
			self asFileReference asAbsolute path withParents ];
		column: 'Icon'
			iconName: [ :aPath | 
				aPath asFileReference exists
					ifTrue: [ #smallOk  ]
					ifFalse: [  #changeRemove ] ]
			width: 35;
		column: 'Name'
			text: [ :aPath | 
				aPath asFileReference basename
					, (aPath asFileReference isDirectory ifTrue: [ '/' ] ifFalse: [ '' ]) ];
		send: [ :aPath |
			aPath asFileReference ]
%

category: '*GToolkit-RemotePhlow-GemStone'
method: AbstractFileReference
gtTreeFor: aView
	<gtView>
	self isDirectory
		ifFalse: [ ^ aView empty ].
	^ aView columnedTree
		title: 'Tree' ;
		priority: 10;
		items: [ self gtChildren ];
		children: [ :each | each gtChildren ];
		column: 'Icon' 
			iconName: [ :each | 
				each isDirectory
					ifTrue: [ #emptyPackage ]
					ifFalse: [ #workspace ] ]
			width: 35;
		column: 'Name'  text: [ :each | 
			(self isChildOf: each)
				ifTrue: [ '..' ]
				ifFalse: [ each basename asString ] ];
		column: 'Size' 
			text: [ :each | 
				[ each isDirectory 
					ifTrue: [ '--' ]
					ifFalse: [ each humanReadableSize asString ] ]
				on: Error
				do: [ :anException | anException return: '' ] ]
			width: 100;
		column: 'Creation' 
			text: [ :each | 
				[ String
					streamContents: [ :s | 
						each creationTime printYMDOn: s.
						s nextPut: Character space.
						each creationTime printHMSOn: s ] ]
				on: Error
				do: [ :anException | anException return: '' ] ]
			width: 150
%

category: '*GToolkit-RemotePhlow-GemStone'
method: AbstractFileReference
humanReadableSize

	^ self size humanReadableSISizeString
%

! Class extensions for 'Behavior'

!		Instance methods for 'Behavior'

category: '*GToolkit-RemotePhlow-Gemstone'
method: Behavior
gtMethodsListRemoteFor: aView
	<gtView>

	^ aView list
		title: 'Methods List';
		priority: 10;
		items: [ (self methodDictForEnv: 0) values asSortedCollection: [ :a :b | a selector < b selector ] ];
		itemText: [ :method | method selector ]
%

category: '*GToolkit-RemotePhlow-Gemstone'
method: Behavior
gtSubclasses
	"A hack to figure out all subclasses since Metaclass3>>_subclasses always answers nil"
	| allClasses result |

	allClasses := Array new.
	System myUserProfile symbolList
		do: [ :dict | allClasses addAll: (dict select: [ :each | each isBehavior ]) ].
	result := allClasses select: [ :each | each isBehavior and: [ each superclass = self ] ].
	^ result
%

category: '*GToolkit-RemotePhlow-Gemstone'
method: Behavior
gtSubclassesFor: aView
	<gtView>

	^ aView tree
		title: 'Subclasses';
		priority: 11;
		items: [ self gtSubclasses ];
		itemText: [ :cls | cls name ];
		children: [ :cls | cls gtSubclasses ]
%

category: '*GToolkit-RemotePhlow-Gemstone'
method: Behavior
gtSuperclassesFor: aView
	<gtView>

	^ aView list
		title: 'Superclasses';
		priority: 12;
		items: [ self allSuperClasses reversed ];
		itemText: [ :cls | cls name ]
%

! Class extensions for 'Collection'

!		Class methods for 'Collection'

category: '*GToolkit-RemotePhlow-GemStone'
classmethod: Collection
gtGsInspectorIconName
	^ #collectionIcon
%

!		Instance methods for 'Collection'

category: '*GToolkit-RemotePhlow-PhlowViews'
method: Collection
asGPhlowItemsIterator
	^ GtRemotePhlowGenericCollectionIterator forCollection: self
%

category: '*GToolkit-RemotePhlow-InspectorExtensions-Remote'
method: Collection
gtItemsFor: aView
	<gtView>
	^ aView list
		title: 'Items';
		priority: 50;
		items: [ self ];
		itemText: [ :eachItem | eachItem gtDisplayString ]
%

! Class extensions for 'Dictionary'

!		Instance methods for 'Dictionary'

category: '*GToolkit-RemotePhlow-GemStone'
method: Dictionary
gtDisplayOn: aStream

	GtGemStoneRemotePhlowDictionaryPrinter
		displayStringFor: self 
		on: aStream
%

! Class extensions for 'GtPhlowColor'

!		Instance methods for 'GtPhlowColor'

category: '*GToolkit-RemotePhlow-GemStone'
method: GtPhlowColor
asColor
	^ self
%

! Class extensions for 'GtPhlowViewSpecification'

!		Class methods for 'GtPhlowViewSpecification'

category: '*GToolkit-RemotePhlow-GemStone'
classmethod: GtPhlowViewSpecification
globalsDictionary

	self halt.  "How to look up classes?"
	^ GsCurrentSession currentSession symbolList
%

category: '*GToolkit-RemotePhlow-GemStone'
classmethod: GtPhlowViewSpecification
new

	^ super new initialize
%

category: '*GToolkit-RemotePhlow-GemStone'
classmethod: GtPhlowViewSpecification
readJsonString: aString

	self halt.
	^ JsonParser parse: aString
%

!		Instance methods for 'GtPhlowViewSpecification'

category: '*GToolkit-RemotePhlow-GemStone'
method: GtPhlowViewSpecification
writeJsonString: aJsonObject

	^ aJsonObject asJson
%

! Class extensions for 'GtRemotePhlowDeclarativeTestForCustomProxyInspectable'

!		Class methods for 'GtRemotePhlowDeclarativeTestForCustomProxyInspectable'

category: '*GToolkit-RemotePhlow-GemStone'
classmethod: GtRemotePhlowDeclarativeTestForCustomProxyInspectable
new

	^ super new initialize
%

! Class extensions for 'GtRemotePhlowDeclarativeTestInspectable'

!		Class methods for 'GtRemotePhlowDeclarativeTestInspectable'

category: '*GToolkit-RemotePhlow-GemStone'
classmethod: GtRemotePhlowDeclarativeTestInspectable
new

	^ super new initialize
%

! Class extensions for 'GtRemotePhlowViewedObject'

!		Class methods for 'GtRemotePhlowViewedObject'

category: '*GToolkit-RemotePhlow-Gemstone'
classmethod: GtRemotePhlowViewedObject
new

	^ super new initialize
%

!		Instance methods for 'GtRemotePhlowViewedObject'

category: '*GToolkit-RemotePhlow-GemStone'
method: GtRemotePhlowViewedObject
addRawSelfNodeTo: variableNodes

	^ self "TBS"
%

category: '*GToolkit-RemotePhlow-GemStone'
method: GtRemotePhlowViewedObject
rawViewData
	"Answer the data for the raw view"
	| variableBindings |

	variableBindings := object gtRemoteVariableValuePairsWithSelfIf: true.

	^ Array streamContents: [ :stream |
		variableBindings do: [ :binding |
			| icon name value |
			name := binding key.
			value := binding value.

			icon := ([ value class gtGsInspectorIconName ]
					on: Error 
					do: [ :error | #smallWarningIcon ]).
			
			stream nextPut: { icon. name. value } ] ].
%

! Class extensions for 'Integer'

!		Instance methods for 'Integer'

category: '*GToolkit-RemotePhlow-GemStone'
method: Integer
humanReadableSISizeOn: aStream
	"Print a SI representation of myself on the argument. See humanReadableSIByteSize for better comment."

	| exponent base |
	base := 1000.
	self < base
		ifTrue: [ ^ aStream print: self; space; nextPut: $B ].
	exponent := ((self log:10) / (base log:10)) asInteger.
	aStream nextPutAll: (self / (base raisedTo: exponent)) asFloat asString.
	aStream
		space;
		nextPut: ('kMGTPE' at: exponent);
		nextPut: $B
%

category: '*GToolkit-RemotePhlow-GemStone'
method: Integer
humanReadableSISizeString
	"Return the receiver as a string with SI binary (International System of Units) file size, e.g. '50 KB'. It means that it takes 1000 and not 1024 as unit as humanReadableByteSizeString does."

	"(1000 * 1000 * 1000) humanReadableSISizeString >>> '1.00 GB'"
	"(1000 * 1000 * 1000) humanReadableByteSizeString >>> '953 MB'"
	"(1024 * 1024 * 1024) humanReadableSISizeString >>> '1.07 GB'"


	^ String streamContents: [ :s|
		self humanReadableSISizeOn: s ]
%

! Class extensions for 'Magnitude'

!		Class methods for 'Magnitude'

category: '*GToolkit-RemotePhlow-GemStone'
classmethod: Magnitude
gtGsInspectorIconName
	^ #magnitudeIcon
%

! Class extensions for 'Object'

!		Instance methods for 'Object'

category: '*GToolkit-RemotePhlow-GemStone'
method: Object
asRopedText
	^ GtPhlowText forString: self asString
%

category: '*GToolkit-RemotePhlow-InspectorExtensions-Remote'
method: Object
gtActionBrowseFor: anAction
	<gtAction>
	
	^ anAction button
		tooltip: 'Browse class for current object';
		priority: 70;
		icon: (GtPhlowGlamorousVectorIconNameStencil new 
			iconName: #emphasizedBrowse);
		action: [ :aButton |
			aButton phlow 
				spawnObject: self class ]
%

category: '*GToolkit-RemotePhlow-InspectorExtensions-Remote'
method: Object
gtActionInspectFor: anAction
	<gtAction>
	
	^ anAction button
		tooltip:'Inspect current object';
		priority: 75;
		icon: (GtPhlowGlamorousVectorIconNameStencil new 
			iconName: #inspect);
		action: [ :aButton |
			aButton phlow 
				spawnObject: self ]
%

category: '*GToolkit-RemotePhlow-Remote'
method: Object
gtActionsInCurrentContext
	"Answer a collection of the object's declarative actions"

	^ self gtDeclarativeActionPragmas collect: [ :aPragma |
		| methodSelector phlowAction |
		methodSelector := aPragma method selector.
			
		phlowAction := GtRemotePhlowAction new  noAction
			on: self
			perform: methodSelector.
		
		phlowAction definingSelector: methodSelector.
		phlowAction definingClass: self class.
		phlowAction ]
%

category: '*GToolkit-RemotePhlow-Remote'
method: Object
gtDeclarativeActionPragmas
	"Answer a collection of the object's declarative view selectors"

	^ Pragma 
		allNamed: #gtAction
		from: self class
		to: Object
%

category: '*GToolkit-RemotePhlow-InspectorCore'
method: Object
gtDeclarativePhlowActions
	"Answer a collection of the object's declarative phlow actions"
	
	^ self gtActionsInCurrentContext
		select: [ :aPhlowAction | aPhlowAction canBeGtDeclarativeAction ]
%

category: '*GToolkit-RemotePhlow-InspectorCore'
method: Object
gtDeclarativePhlowViews
	"Answer a collection of the object's declarative phlow view"
	
	^ self gtViewsInCurrentContext
		select: [ :aPhlowView | aPhlowView canBeGtDeclarativeView ]
%

category: '*GToolkit-RemotePhlow-Remote'
method: Object
gtDeclarativeViewPragmas
	"Answer a collection of the object's declarative view selectors"

	^ Pragma 
		allNamed: #gtView
		from: self class
		to: Object
%

category: '*GToolkit-RemotePhlow-Remote'
method: Object
gtDeclarativeViewPragms
	"Answer a collection of the object's declarative view selectors"

	^ self gtDeclarativeViewPragmas
%

category: '*GToolkit-RemotePhlow-GemStone'
method: Object
gtDeclarativeViewSelectors
	"Answer a collection of the object's declarative view selectors"

	^ ((Pragma 
		allNamed: #gtView
		from: self class
		to: Object) collect: [ :each | each method selector ]) asSet asArray
%

category: '*GToolkit-RemotePhlow-GemStone'
method: Object
gtDisplayOn: writeStream
	self printOn: writeStream
%

category: '*GToolkit-RemotePhlow-GemStone'
method: Object
gtDisplayString
  | ws contents |
  ws := PrintStream printingOn: String new "maxSize: 100".

  [ self gtDisplayOn: ws ] 
	on: Error 
	do: [ :error | ^ '<error printing>' ].
  contents := ws _collection.

  ^ contents size > 200
    ifTrue: [ (contents copyFrom: 1 to: 200) , '...' ]
    ifFalse: [ contents ]
%

category: '*GToolkit-RemotePhlow-GemStone'
method: Object
gtDisplayText
	^ [ self gtDisplayString asRopedText ]
		on: Error 
		do: [ :e | e printString asRopedText 
			foreground: (GtPhlowColor named: #red) ]
%

category: '*GToolkit-RemotePhlow-GemStone'
method: Object
gtGsInspectorIconName
	^ #classIcon
%

category: '*GToolkit-RemotePhlow-InspectorExtensions-Remote'
method: Object
gtPrintFor: aView
	<gtView>
	^ aView textEditor
		title: 'Print';
		priority: 110;
		text: [ self printString ]
%

category: '*GToolkit-RemotePhlow-InspectorExtensions-Remote'
method: Object
gtRawFor: aView
	<gtView>
	^ aView columnedList
		title: 'Raw';
		priority: 100;
		items: [ self gtRemoteVariableValuePairsWithSelfIf: true ];
		column: 'Icon' 
			iconName: [ :anAssociation | anAssociation value class gtSystemIconName ]
			width: 36;
		column: 'Variable' text: [ :anAssociation | anAssociation key ];
		column: 'Value' text: [ :anAssociation | anAssociation value gtDisplayString ];
		send: [ :anAssociation | anAssociation value ]
%

category: '*GToolkit-RemotePhlow-GemStone'
method: Object
gtRemoteVariableValuePairsWithSelfIf: aBoolean
	| instVarNames bindings instanceVariables indexedVarsSize |
	instVarNames := self class allInstVarNames.
	indexedVarsSize := self basicSize - instVarNames size.
	bindings := OrderedCollection new: instVarNames size + 1.
	instanceVariables := OrderedCollection new: instVarNames size + 1.
	
	aBoolean ifTrue: [ bindings add: 'self' -> self ].
	
	instVarNames doWithIndex: [ :each :index | 
		instanceVariables add: (each -> (self instVarAt: index))].
	bindings addAll: (instanceVariables sort: [ :a :b | a key < b key ]).
	
	1 to: (indexedVarsSize min: 21) do: [ :index | 
		bindings add: (index asString -> (self _at: index)) ].
	
	((indexedVarsSize - 20) max: 22) to: indexedVarsSize do: [ :index | 
		bindings add: (index asString -> (self _at: index)) ].
	
	^ bindings
%

category: '*GToolkit-RemotePhlow-GemStone'
method: Object
gtSystemIconName
	^ self gtGsInspectorIconName
%

category: '*GToolkit-RemotePhlow-Remote'
method: Object
gtViewsInCurrentContext
	"Answer a collection of the object's declarative views"

	^ self gtDeclarativeViewPragmas collect: [ :aPragma |
		| methodSelector phlowView |
		methodSelector := aPragma method selector.
			
		phlowView := GtRemotePhlowProtoView new empty 
			on: self
			perform: methodSelector.
		
		phlowView definingSelector: methodSelector.
		phlowView definingClass: self class.
		phlowView ]
%

! Class extensions for 'OrderedCollection'

!		Instance methods for 'OrderedCollection'

category: '*GToolkit-RemotePhlow-GemStone'
method: OrderedCollection
gtDisplayOn: aStream

	GtGemStoneRemotePhlowCollectionPrinter
		displayStringFor: self 
		on: aStream
%

! Class extensions for 'PrintStream'

!		Instance methods for 'PrintStream'

category: '*GToolkit-RemotePhlow-GemStone'
method: PrintStream
parenthesize: aBlock
	self nextPut: $(.
	aBlock ensure: [ self nextPut: $) ]
%

! Class extensions for 'Semaphore'

!		Instance methods for 'Semaphore'

category: '*GToolkit-RemotePhlow-GemStone'
method: Semaphore
gtDisplayOn: aStream
	"Reuse the printOn: implementation"
	self printOn: aStream
%

! Class extensions for 'SequenceableCollection'

!		Instance methods for 'SequenceableCollection'

category: '*GToolkit-RemotePhlow-PhlowViews'
method: SequenceableCollection
asGPhlowItemsIterator
	^ GtRemotePhlowSequenceableCollectionIterator forCollection: self
%

category: '*GToolkit-RemotePhlow-InspectorExtensions-Remote'
method: SequenceableCollection
gtItemsFor: aView
	^ aView columnedList
		title: 'Items';
		priority: 50;
		items: [ self ];
		column: 'Index' 
			text: [ :eachItem :eachIndex | eachIndex  ]
			width: 45;
		column: 'Item' 
			text: [ :eachItem | eachItem gtDisplayString ].
%

! Class extensions for 'String'

!		Class methods for 'String'

category: '*GToolkit-RemotePhlow-GemStone'
classmethod: String
gtGsInspectorIconName
	^ #stringIcon
%

!		Instance methods for 'String'

category: '*GToolkit-RemotePhlow-GemStone'
method: String
asRopedText
	^ GtPhlowText forString: self
%

category: '*GToolkit-RemotePhlow-GemStone'
method: String
gtDisplayOn: writeStream
	writeStream nextPutAll: self
%

category: '*GToolkit-RemotePhlow-InspectorExtensions-Remote'
method: String
gtStringFor: aView
	<gtView>

	^ aView text
		title: 'String';
		priority: 9;
		text: [ self ]
%

! Class extensions for 'WriteStream'

!		Instance methods for 'WriteStream'

category: '*GToolkit-RemotePhlow-Remote'
method: WriteStream
parenthesize: aBlock
	self nextPut: $(.
	aBlock ensure: [ self nextPut: $) ]
%

