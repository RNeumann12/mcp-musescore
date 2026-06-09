"""Connection and utility tools for MuseScore MCP."""

from typing import Optional

from ..client import MuseScoreClient


def setup_connection_tools(mcp, client: MuseScoreClient):
    """Setup connection and utility tools."""

    @mcp.tool()
    async def ping_musescore():
        """Ping the MuseScore WebSocket API to check connection."""
        return await client.send_command("ping")

    @mcp.tool()
    async def reload_plugin():
        """Hot-reload the MuseScore plugin logic (mcp-logic.js) without restarting MuseScore."""
        return await client.send_command("reloadLogic")

    @mcp.tool()
    async def get_score(start_measure: Optional[int] = None, end_measure: Optional[int] = None):
        """Read the current score as compact LilyPond (the whole score by default).

        Pass start_measure/end_measure (1-based, inclusive) to fetch only a slice
        of a large score and save tokens.
        """
        params = {}
        if start_measure is not None:
            params["startMeasure"] = start_measure
        if end_measure is not None:
            params["endMeasure"] = end_measure

        res = await client.send_command("getScore", params)
        if res.get("success") and "analysis" in res:
            from ..utils.lilypond_converter import json_to_lilypond
            analysis = res["analysis"]
            lily_str = json_to_lilypond(analysis)

            title = analysis.get("title") or "Untitled"
            header = f"{title} | {analysis.get('numMeasures', '?')} measures | {len(analysis.get('staves', []))} staves"

            # Surface musical context up front so the model sees it without parsing.
            measures = analysis.get("measures") or []
            first_ts = next((m.get("timeSig") for m in measures if m.get("timeSig")), None)
            if first_ts:
                header += f" | {first_ts.get('numerator')}/{first_ts.get('denominator')}"
            if isinstance(analysis.get("tempo"), (int, float)):
                header += f" | {int(round(analysis['tempo']))}bpm"

            if start_measure is not None or end_measure is not None:
                header += f" | showing measures {start_measure or 1}-{end_measure or analysis.get('numMeasures', '?')}"
            return f"{header}\n{lily_str}"
        return res