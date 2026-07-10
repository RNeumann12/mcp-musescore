"""Notes and measures tools for MuseScore MCP."""

from typing import List, Optional, Union
from ..client import MuseScoreClient
from ..utils.lilypond_converter import note_name_to_midi
from .annotations import DESTRUCTIVE, NON_DESTRUCTIVE


def setup_notes_measures_tools(mcp, client: MuseScoreClient):
    """Setup notes and measures tools."""

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def add_note(pitch: Union[int, str] = 64, duration: dict = {"numerator": 1, "denominator": 4}, advance_cursor_after_action: bool = True):
        """Add a note at the current cursor position with the specified pitch and duration.

        Args:
            pitch: Either a MIDI pitch value (0-127, where 60 is middle C) or a
                scientific note name like "C4", "Eb5", "F#3" (C4 = middle C = 60).
            duration: Duration as {"numerator": int, "denominator": int} (e.g., {"numerator": 1, "denominator": 4} for quarter note)
            advance_cursor_after_action: Whether to move cursor to next position after adding note
        """
        if isinstance(pitch, str):
            try:
                if "," in pitch:
                    pitch = ",".join(str(note_name_to_midi(p.strip())) for p in pitch.split(","))
                else:
                    pitch = note_name_to_midi(pitch)
            except ValueError as e:
                return {"error": str(e)}

        return await client.send_command("addNote", {
            "pitch": pitch,
            "duration": duration,
            "advanceCursorAfterAction": advance_cursor_after_action
        })

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def add_rest(duration: dict = {"numerator": 1, "denominator": 4}, advance_cursor_after_action: bool = True):
        """Add a rest at the current cursor position.
        
        Args:
            duration: Duration as {"numerator": int, "denominator": int} (e.g., {"numerator": 1, "denominator": 4} for quarter rest)
            advance_cursor_after_action: Whether to move cursor to next position after adding rest
        """
        return await client.send_command("addRest", {
            "duration": duration,
            "advanceCursorAfterAction": advance_cursor_after_action
        })

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def add_tuplet(duration: dict = {"numerator": 1, "denominator": 4}, ratio: dict = {"numerator": 3, "denominator": 2}, advance_cursor_after_action: bool = True):
        """Add a tuplet at the current cursor position.
        
        Args:
            duration: Base duration as {"numerator": int, "denominator": int}
            ratio: Tuplet ratio as {"numerator": int, "denominator": int} (e.g., {"numerator": 3, "denominator": 2} for triplet)
            advance_cursor_after_action: Whether to move cursor to next position after adding tuplet
        """
        return await client.send_command("addTuplet", {
            "duration": duration,
            "ratio": ratio,
            "advanceCursorAfterAction": advance_cursor_after_action
        })

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def add_lyrics(lyrics: List[str], verse: int = 0):
        """Add lyrics to consecutive notes starting from the current cursor position.
        
        Args:
            lyrics: List of lyric syllables to add (e.g., ["Hel", "lo", "world"])
            verse: Verse number (0-based, default is 0 for first verse)
        """
        return await client.send_command("addLyrics", {
            "lyrics": lyrics,
            "verse": verse
        })

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def add_slide(measure: Optional[int] = None, tick: Optional[int] = None,
                        staff: Optional[int] = None, voice: int = 0,
                        pitch: Optional[Union[int, str]] = None,
                        type: str = "straight", text: Optional[str] = None):
        """Add a slide/glissando from a note to the *next* note in the same voice.

        This is a spanner attached to the start note — on a guitar/TAB staff the
        ``straight`` type renders as the slanted slide line (and plays as a pitch
        slide); ``wavy`` is the classic glissando squiggle. There must be a
        following note in the same voice/staff for the slide to land on.

        For a single-finger guitar slide, make sure both the start and target
        notes sit on the same string (see the fretting tools) so it reads and
        plays as one continuous slide.

        Args:
            measure: 1-based measure of the start note (targets beat 1). Omit to use tick/cursor.
            tick: Absolute tick of the start note (beat-precise; preferred).
            staff: Staff index. Defaults to the top staff (0).
            voice: Voice index within the staff (0-3). Defaults to 0.
            pitch: Disambiguate a chord — MIDI value or note name like "D#4".
                Omit when the start position holds a single note.
            type: "straight" (slide, default) or "wavy" (glissando).
            text: Optional label to print on the line (guitar slides usually have none).
        """
        if isinstance(pitch, str):
            try:
                pitch = note_name_to_midi(pitch)
            except ValueError as e:
                return {"error": str(e)}

        params: dict = {"voice": voice, "type": type}
        if measure is not None:
            params["measure"] = measure
        if tick is not None:
            params["tick"] = tick
        if staff is not None:
            params["staff"] = staff
        if pitch is not None:
            params["pitch"] = pitch
        if text is not None:
            params["text"] = text
        return await client.send_command("addSlide", params)

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def insert_measure():
        """Insert a measure at the current position."""
        return await client.send_command("insertMeasure")

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def append_measure(count: int = 1):
        """Append measures to the end of the score."""
        return await client.send_command("appendMeasure", {"count": count})

    @mcp.tool(annotations=DESTRUCTIVE)
    async def delete_selection(measure: Optional[int] = None):
        """Delete the current selection or specified measure."""
        params = {}
        if measure is not None:
            params["measure"] = measure
        return await client.send_command("deleteSelection", params)

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def undo():
        """Undo the last action."""
        return await client.send_command("undo")
