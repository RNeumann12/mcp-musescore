"""Type definitions for MuseScore MCP."""

from .action_types import *

__all__ = [
    "ActionSequence",
    "getScoreAction",
    "addNoteAction", 
    "addRestAction",
    "addTupletAction",
    "addLyricsAction",
    "addSlideAction",
    "addInstrumentAction",
    "setStaffMuteAction",
    "appendMeasureAction",
    "deleteSelectionAction",
    "getCursorInfoAction",
    "goToMeasureAction",
    "nextElementAction",
    "prevElementAction",
    "selectCurrentMeasureAction",
    "insertMeasureAction",
    "goToFinalMeasureAction",
    "goToBeginningOfScoreAction",
    "setTimeSignatureAction",
    "undoAction",
    "nextStaffAction",
    "prevStaffAction"
]