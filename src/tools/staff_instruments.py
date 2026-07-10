"""Staff and instrument tools for MuseScore MCP."""

from ..client import MuseScoreClient
from .annotations import NON_DESTRUCTIVE


def setup_staff_instruments_tools(mcp, client: MuseScoreClient):
    """Setup staff and instrument tools."""
    
    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def add_instrument(instrument_id: str):
        """Add a new staff/instrument to the score.
        
        Args:
            instrument_id: ID of the instrument to add
        """
        return await client.send_command("addInstrument", {
            "instrumentId": instrument_id
        })

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def set_staff_mute(staff: int, mute: bool):
        """Mute or unmute a staff.
        
        Args:
            staff: Staff number (0-based)
            mute: True to mute, False to unmute
        """
        return await client.send_command("setStaffMute", {
            "staff": staff,
            "mute": mute
        })
