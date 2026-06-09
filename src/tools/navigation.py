"""Cursor and navigation tools for MuseScore MCP."""

from ..client import MuseScoreClient


def _position_label(sel: dict, score_info: dict) -> str:
    """Build a short 'm3 b1 staff0' position label from a selection."""
    parts = []
    if "startTick" in sel:
        tick = sel["startTick"]
        # 4/4 math fallback; refined from real measure boundaries when available.
        measure_num = (tick // 1920) + 1
        beat_num = ((tick % 1920) // 480) + 1
        measures = score_info.get("measures") if isinstance(score_info, dict) else None
        if measures:
            measures = sorted(measures, key=lambda m: m.get("startTick", 0))
            current_m = measures[0]
            for m in measures:
                if m.get("startTick", 0) > tick:
                    break
                current_m = m
            measure_num = current_m.get("measure", measure_num)
            beat_num = (max(0, tick - current_m.get("startTick", 0)) // 480) + 1
        parts.append(f"m{measure_num} b{beat_num}")

    if "startStaff" in sel:
        start_s = sel["startStaff"]
        end_s = sel.get("endStaff", start_s)
        parts.append(f"staff{start_s}" if end_s in (start_s, start_s + 1) else f"staff{start_s}-{end_s}")
    return " ".join(parts) if parts else "?"


def setup_navigation_tools(mcp, client: MuseScoreClient):
    """Setup cursor and navigation tools."""

    async def _run(action: str, params=None, full: bool = False):
        """Run a navigation command. With full=True, append the selection as
        LilyPond; otherwise return only a compact position label (saves tokens)."""
        res = await client.send_command(action, params)
        if not (isinstance(res, dict) and res.get("success") and "currentSelection" in res):
            return res

        sel = res["currentSelection"]
        score_info = res.get("currentScore") if isinstance(res.get("currentScore"), dict) else {}
        label = _position_label(sel, score_info or {})

        if not full:
            return label

        from ..utils.lilypond_converter import json_to_lilypond
        return f"{label}\n{json_to_lilypond(sel)}"

    @mcp.tool()
    async def get_cursor_info():
        """Get the current cursor position and the selected music as LilyPond."""
        return await _run("getCursorInfo", full=True)

    @mcp.tool()
    async def go_to_measure(measure: int):
        """Navigate to a specific measure (1-based)."""
        return await _run("goToMeasure", {"measure": measure}, full=True)

    @mcp.tool()
    async def go_to_final_measure():
        """Navigate to the final measure of the score."""
        return await _run("goToFinalMeasure")

    @mcp.tool()
    async def go_to_beginning_of_score():
        """Navigate to the beginning of the score."""
        return await _run("goToBeginningOfScore")

    @mcp.tool()
    async def next_element():
        """Move the cursor to the next element."""
        return await _run("nextElement")

    @mcp.tool()
    async def prev_element():
        """Move the cursor to the previous element."""
        return await _run("prevElement")

    @mcp.tool()
    async def next_staff():
        """Move the cursor to the next staff."""
        return await _run("nextStaff")

    @mcp.tool()
    async def prev_staff():
        """Move the cursor to the previous staff."""
        return await _run("prevStaff")

    @mcp.tool()
    async def select_current_measure():
        """Select the current measure and return it as LilyPond."""
        return await _run("selectCurrentMeasure", full=True)

    @mcp.tool()
    async def select_custom_range(start_tick: int, end_tick: int, start_staff: int, end_staff: int):
        """Select a tick range across staves (precise, can span measure bounds); returns it as LilyPond."""
        params = {
            "startTick": start_tick,
            "endTick": end_tick,
            "startStaff": start_staff,
            "endStaff": end_staff,
        }
        return await _run("selectCustomRange", params, full=True)
