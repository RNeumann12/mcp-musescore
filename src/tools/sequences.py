"""Sequence processing tools for MuseScore MCP."""

from ..client import MuseScoreClient
from ..types import ActionSequence
from .annotations import NON_DESTRUCTIVE


def setup_sequence_tools(mcp, client: MuseScoreClient):
    """Setup sequence processing tools."""

    async def _process(sequence: ActionSequence):
        if not isinstance(sequence, list) or not sequence:
            return {
                "error": "sequence must be a non-empty list of action objects",
                "code": "invalid_sequence",
                "retryable": False,
            }
        for index, step in enumerate(sequence):
            if not isinstance(step, dict) or not isinstance(step.get("action"), str):
                return {
                    "error": f"sequence step {index} must contain a string action",
                    "code": "invalid_sequence",
                    "retryable": False,
                    "details": {"step": index},
                }
            if "params" in step and not isinstance(step["params"], dict):
                return {
                    "error": f"sequence step {index} params must be an object",
                    "code": "invalid_sequence",
                    "retryable": False,
                    "details": {"step": index, "action": step["action"]},
                }
        return await client.send_command("processSequence", {"sequence": sequence})

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def processSequence(sequence: ActionSequence):
        """Legacy alias for process_sequence."""
        return await _process(sequence)

    @mcp.tool(annotations=NON_DESTRUCTIVE)
    async def process_sequence(sequence: ActionSequence):
        """Run an ordered batch of bridge actions with preflight shape validation.

        The result reports every failed step. This is not yet atomic: if a later
        step fails, earlier edits remain applied, so verify the score afterwards.
        """
        return await _process(sequence)
