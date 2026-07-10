"""Contract checks for the MCP surface advertised to connected agents."""

import asyncio

import server


def _tools():
    return {tool.name: tool for tool in asyncio.run(server.mcp.list_tools())}


def test_expected_agent_tools_are_registered():
    tools = _tools()
    assert {
        "get_mcp_status",
        "get_score",
        "diagnose_score",
        "process_sequence",
        "get_fingering",
        "set_note_string",
        "move_note_string",
        "remove_notes_at_tick",
    } <= tools.keys()


def test_safety_annotations_distinguish_reads_and_deletes():
    tools = _tools()
    assert tools["get_score"].annotations.readOnlyHint is True
    assert tools["get_score"].annotations.destructiveHint is False
    assert tools["delete_selection"].annotations.destructiveHint is True
    assert tools["remove_notes_at_tick"].annotations.destructiveHint is True
