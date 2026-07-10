"""TypedDict definitions for MuseScore MCP action sequences."""

from typing import Dict, Any, List, Literal, Union
from typing_extensions import TypedDict


class getScoreAction(TypedDict):
    action: Literal["getScore"]
    params: Dict[str, Any]


class addNoteParams(TypedDict):
    pitch: Union[int, str]
    duration: Dict[Literal["numerator", "denominator"], int]
    advanceCursorAfterAction: bool


class addNoteAction(TypedDict):
    action: Literal["addNote"]
    params: addNoteParams


class addRestParams(TypedDict):
    duration: Dict[Literal["numerator", "denominator"], int]
    advanceCursorAfterAction: bool


class addRestAction(TypedDict):
    action: Literal["addRest"]
    params: addRestParams


class addTupletParams(TypedDict):
    duration: Dict[Literal["numerator", "denominator"], int]
    ratio: Dict[Literal["numerator", "denominator"], int]
    advanceCursorAfterAction: bool


class addTupletAction(TypedDict):
    action: Literal["addTuplet"]
    params: addTupletParams


class addLyricsParams(TypedDict):
    lyrics: List[str]
    verse: int


class addLyricsAction(TypedDict):
    action: Literal["addLyrics"]
    params: addLyricsParams


class addTextMarkerParams(TypedDict, total=False):
    text: str          # required
    measure: int       # 1-based; optional
    tick: int          # optional alternative to measure
    staff: int         # optional


class addSystemTextAction(TypedDict):
    action: Literal["addSystemText"]
    params: addTextMarkerParams


class addStaffTextAction(TypedDict):
    action: Literal["addStaffText"]
    params: addTextMarkerParams


class addRehearsalMarkAction(TypedDict):
    action: Literal["addRehearsalMark"]
    params: addTextMarkerParams


class addChordSymbolAction(TypedDict):
    action: Literal["addChordSymbol"]
    params: addTextMarkerParams


class addSlideParams(TypedDict, total=False):
    measure: int       # 1-based; optional
    tick: int          # absolute tick of the start note (preferred)
    staff: int         # optional, defaults to 0
    voice: int         # optional, defaults to 0
    pitch: int         # disambiguate a chord by MIDI pitch; optional
    type: str          # "straight" (default) or "wavy"
    text: str          # optional line label


class addSlideAction(TypedDict):
    action: Literal["addSlide"]
    params: addSlideParams


class addInstrumentParams(TypedDict):
    instrumentId: str


class addInstrumentAction(TypedDict):
    action: Literal["addInstrument"]
    params: addInstrumentParams


class setStaffMuteParams(TypedDict):
    staff: int
    mute: bool


class setStaffMuteAction(TypedDict):
    action: Literal["setStaffMute"]
    params: setStaffMuteParams


class appendMeasureAction(TypedDict):
    action: Literal["appendMeasure"]
    params: Dict[str, Any]


class deleteSelectionAction(TypedDict):
    action: Literal["deleteSelection"]
    params: Dict[str, Any]


class getCursorInfoAction(TypedDict):
    action: Literal["getCursorInfo"]
    params: Dict[str, Any]


class goToMeasureParams(TypedDict):
    measure: int


class goToMeasureAction(TypedDict):
    action: Literal["goToMeasure"]
    params: goToMeasureParams


class nextElementAction(TypedDict):
    action: Literal["nextElement"]
    params: Dict[str, Any]


class prevElementAction(TypedDict):
    action: Literal["prevElement"]
    params: Dict[str, Any]


class selectCurrentMeasureAction(TypedDict):
    action: Literal["selectCurrentMeasure"]
    params: Dict[str, Any]


class selectCustomRangeParams(TypedDict):
    startTick: int
    endTick: int
    startStaff: int
    endStaff: int


class selectCustomRangeAction(TypedDict):
    action: Literal["selectCustomRange"]
    params: selectCustomRangeParams


class insertMeasureAction(TypedDict):
    action: Literal["insertMeasure"]
    params: Dict[str, Any]


class goToFinalMeasureAction(TypedDict):
    action: Literal["goToFinalMeasure"]
    params: Dict[str, Any]


class goToBeginningOfScoreAction(TypedDict):
    action: Literal["goToBeginningOfScore"]
    params: Dict[str, Any]


class setTimeSignatureParams(TypedDict):
    numerator: int
    denominator: int


class setTimeSignatureAction(TypedDict):
    action: Literal["setTimeSignature"]
    params: setTimeSignatureParams


class setTempoParams(TypedDict):
    bpm: int


class setTempoAction(TypedDict):
    action: Literal["setTempo"]
    params: setTempoParams


class undoAction(TypedDict):
    action: Literal["undo"]
    params: Dict[str, Any]


class nextStaffAction(TypedDict):
    action: Literal["nextStaff"]
    params: Dict[str, Any]


class prevStaffAction(TypedDict):
    action: Literal["prevStaff"]
    params: Dict[str, Any]


class diagnoseAction(TypedDict):
    action: Literal["diagnose"]
    params: Dict[str, Any]


ActionSequence = List[
    getScoreAction | addNoteAction | addRestAction | addTupletAction | 
    addLyricsAction | addSystemTextAction | addStaffTextAction |
    addRehearsalMarkAction | addChordSymbolAction | addSlideAction | addInstrumentAction | setStaffMuteAction |
    appendMeasureAction | deleteSelectionAction |
    getCursorInfoAction | goToMeasureAction | nextElementAction | 
    prevElementAction | selectCurrentMeasureAction | selectCustomRangeAction | insertMeasureAction |
    goToFinalMeasureAction | goToBeginningOfScoreAction | setTimeSignatureAction |
    setTempoAction | undoAction | nextStaffAction | prevStaffAction | diagnoseAction
]
