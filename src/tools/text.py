"""Text marker tools for MuseScore MCP (section labels, rehearsal marks, cues).

These attach a text *annotation* to a segment — the proper way to mark sections,
as opposed to overloading lyrics. All three accept the same optional positioning:
a 1-based ``measure``, an absolute ``tick``, or (default) the current cursor
selection.
"""

from typing import Optional
from ..client import MuseScoreClient
from .annotations import NON_DESTRUCTIVE


def setup_text_tools(mcp, client: MuseScoreClient):
    """Setup text marker tools."""

    def _params(text: str, measure: Optional[int], tick: Optional[int], staff: Optional[int]) -> dict:
        params = {"text": text}
        if measure is not None:
            params["measure"] = measure
        if tick is not None:
            params["tick"] = tick
        if staff is not None:
            params["staff"] = staff
        return params

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def add_system_text(text: str, measure: Optional[int] = None,
                              tick: Optional[int] = None, staff: Optional[int] = None):
        """Add system text — a label shown once above the system and on every part.

        This is the right way to mark sections ("Verse", "Chorus", "Intro",
        "Bridge") instead of abusing lyrics.

        Args:
            text: The label to write (e.g. "Chorus").
            measure: 1-based measure to attach to. Omit to use the current cursor.
            tick: Absolute tick to attach to (alternative to measure).
            staff: Staff index. Defaults to the top staff (0).
        """
        return await client.send_command("addSystemText", _params(text, measure, tick, staff))

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def add_rehearsal_mark(text: str, measure: Optional[int] = None,
                                 tick: Optional[int] = None, staff: Optional[int] = None):
        """Add a rehearsal mark — the boxed section marker (e.g. "A", "B", "1").

        Args:
            text: The mark text (e.g. "A").
            measure: 1-based measure to attach to. Omit to use the current cursor.
            tick: Absolute tick to attach to (alternative to measure).
            staff: Staff index. Defaults to the top staff (0).
        """
        return await client.send_command("addRehearsalMark", _params(text, measure, tick, staff))

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def add_staff_text(text: str, measure: Optional[int] = None,
                             tick: Optional[int] = None, staff: Optional[int] = None):
        """Add staff text — a cue attached to a single staff (e.g. "pizz.", "solo").

        Args:
            text: The cue text.
            measure: 1-based measure to attach to. Omit to use the current cursor.
            tick: Absolute tick to attach to (alternative to measure).
            staff: Staff index (defaults to the staff of the current cursor).
        """
        return await client.send_command("addStaffText", _params(text, measure, tick, staff))

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def add_chord_symbol(text: str, measure: Optional[int] = None,
                               tick: Optional[int] = None, staff: Optional[int] = None):
        """Add (or replace) a chord symbol — a HARMONY annotation MuseScore renders
        specially (e.g. "Cm7", "G/B", "F#dim", "Bb"). This is the proper element
        for chord names, not staff text or lyrics.

        Replace semantics: if a chord symbol already exists at the same beat and
        staff it is removed first, so re-labelling a bar overwrites cleanly instead
        of stacking a second symbol. The result reports ``replaced`` (count cleared).

        Chord symbols usually sit on beats, so for precise placement pass an
        absolute ``tick`` rather than just a ``measure`` (which targets beat 1).

        Args:
            text: The chord (e.g. "Cmaj7"). MuseScore parses and formats it.
            measure: 1-based measure (targets beat 1). Omit to use the current cursor.
            tick: Absolute tick for beat-precise placement (alternative to measure).
            staff: Staff index. Defaults to the top staff (0).
        """
        return await client.send_command("addChordSymbol", _params(text, measure, tick, staff))
