"""Fretted-instrument tools exposed by the MuseScore plugin bridge."""

from typing import List, Optional, Union

from ..client import MuseScoreClient
from ..utils.lilypond_converter import note_name_to_midi
from .annotations import DESTRUCTIVE, NON_DESTRUCTIVE, READ_ONLY


def _pitch(value: Optional[Union[int, str]]) -> Optional[int]:
    if value is None:
        return None
    return note_name_to_midi(value) if isinstance(value, str) else value


def setup_fretting_tools(mcp, client: MuseScoreClient):
    """Expose string/fret inspection and editing to MCP clients."""

    @mcp.tool(annotations=READ_ONLY)
    async def get_fingering(
        staff: int = 0,
        start_measure: Optional[int] = None,
        end_measure: Optional[int] = None,
    ):
        """Read note string/fret assignments and tuning for a fretted staff.

        Measure numbers are 1-based and inclusive. Staff indexes are 0-based.
        Use this before moving notes between strings so pitch and playability can
        be verified.
        """
        params = {"staff": staff}
        if start_measure is not None:
            params["startMeasure"] = start_measure
        if end_measure is not None:
            params["endMeasure"] = end_measure
        return await client.send_command("dumpFingering", params)

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def set_note_string(
        tick: int,
        staff: int,
        string: int,
        voice: int = 0,
        pitch: Optional[Union[int, str]] = None,
        fret: Optional[int] = None,
    ):
        """Move one note to an absolute string while preserving its pitch.

        Args:
            tick: Absolute score tick containing the note.
            staff: 0-based staff index.
            string: 0-based MuseScore string index (top TAB line is 0).
            voice: Voice index 0-3.
            pitch: MIDI pitch or note name used to select one note in a chord.
            fret: Explicit fret; normally omit it and let the plugin calculate it.
        """
        try:
            midi_pitch = _pitch(pitch)
        except ValueError as exc:
            return {"error": str(exc), "code": "invalid_pitch", "retryable": False}
        params = {"tick": tick, "staff": staff, "string": string, "voice": voice}
        if midi_pitch is not None:
            params["pitch"] = midi_pitch
        if fret is not None:
            params["fret"] = fret
        return await client.send_command("setNoteString", params)

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def move_note_string(
        tick: int,
        staff: int,
        moves: int,
        voice: int = 0,
        pitch: Optional[Union[int, str]] = None,
    ):
        """Move a note relatively across strings using MuseScore commands.

        Positive ``moves`` uses MuseScore's string-above command; negative uses
        string-below. Pass pitch to disambiguate a note in a chord.
        """
        try:
            midi_pitch = _pitch(pitch)
        except ValueError as exc:
            return {"error": str(exc), "code": "invalid_pitch", "retryable": False}
        params = {"tick": tick, "staff": staff, "moves": moves, "voice": voice}
        if midi_pitch is not None:
            params["pitch"] = midi_pitch
        return await client.send_command("moveNoteString", params)

    @mcp.tool(annotations=DESTRUCTIVE)
    async def remove_notes_at_tick(
        tick: int,
        pitches: List[int],
        staff: int = 0,
    ):
        """Remove selected MIDI pitches from the chord at an absolute tick.

        This is destructive. Read the affected measure first and verify it
        afterwards; plugin undo for deletions is not reliable in every build.
        """
        return await client.send_command(
            "removeNotesAtTick", {"tick": tick, "staff": staff, "pitches": pitches}
        )
