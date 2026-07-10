from mcp.server.fastmcp import FastMCP
import sys
sys.stdout.reconfigure(encoding='utf-8')
import logging

# Import modular components
from src.client import MuseScoreClient
from src.tools import (
    setup_connection_tools,
    setup_navigation_tools,
    setup_notes_measures_tools,
    setup_staff_instruments_tools,
    setup_time_tempo_tools,
    setup_text_tools,
    setup_sequence_tools,
    setup_fretting_tools
)

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stderr)]
)
logger = logging.getLogger("MuseScoreMCP")

# Create the MCP app and client. These instructions are exposed during MCP
# initialization and help connected agents use the tools safely and efficiently.
mcp = FastMCP(
    "MuseScore Assistant",
    instructions=(
        "Control the currently open MuseScore 4 score. Read get_score before editing; "
        "use 1-based measure numbers and 0-based staff/voice indexes. Prefer process_sequence "
        "for batches, then verify with get_score and diagnose_score. A command_timeout means "
        "the edit may have applied: inspect before retrying. Use get_mcp_status for connection issues."
    ),
)
client = MuseScoreClient()

# Setup all tool categories
setup_connection_tools(mcp, client)
setup_navigation_tools(mcp, client)
setup_notes_measures_tools(mcp, client)
setup_staff_instruments_tools(mcp, client)
setup_time_tempo_tools(mcp, client)
setup_text_tools(mcp, client)
setup_sequence_tools(mcp, client)
setup_fretting_tools(mcp, client)

# Main entry point
if __name__ == "__main__":
    sys.stderr.write("MuseScore MCP Server starting up...\n")
    sys.stderr.flush()
    logger.info("MuseScore MCP Server is running")
    mcp.run()
