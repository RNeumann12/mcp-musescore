"""Time signature and tempo tools for MuseScore MCP."""

from ..client import MuseScoreClient


def setup_time_tempo_tools(mcp, client: MuseScoreClient):
    """Setup time signature and tempo tools."""
    
    @mcp.tool()
    async def set_time_signature(numerator: int = 4, denominator: int = 4):
        """Set the time signature at the cursor.

        Args:
            numerator: Beats per measure (top number)
            denominator: Note value that gets the beat (bottom number)
        """
        return await client.send_command("setTimeSignature", {
            "numerator": numerator,
            "denominator": denominator
        })

    @mcp.tool()
    async def set_tempo(bpm: int = 120):
        """Add a tempo marking (quarter-note BPM) at the cursor position."""
        return await client.send_command("setTempo", {"bpm": bpm})