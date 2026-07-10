"""WebSocket client for communicating with MuseScore."""

import asyncio
import websockets
import json
import logging
from typing import Dict, Any, Optional

from ..config import MuseScoreConfig

logger = logging.getLogger("MuseScoreMCP.Client")

# Only these commands may be repeated after an uncertain transport failure.
# Cursor navigation is intentionally excluded because it changes subsequent edit
# position, even though it does not alter notation.
SAFE_RETRY_ACTIONS = {
    "ping",
    "getScore",
    "diagnose",
    "dumpFingering",
    "getCursorInfo",
    "reloadLogic",
}


class MuseScoreClient:
    """Client to communicate with MuseScore WebSocket API."""
    
    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        *,
        config: Optional[MuseScoreConfig] = None,
    ):
        base = config or MuseScoreConfig.from_env()
        self.config = MuseScoreConfig(
            host=host if host is not None else base.host,
            port=port if port is not None else base.port,
            connect_timeout=base.connect_timeout,
            command_timeout=base.command_timeout,
            max_response_bytes=base.max_response_bytes,
        )
        self.uri = f"ws://{self.config.host}:{self.config.port}"
        self.websocket = None
        self._lock = asyncio.Lock()

    @staticmethod
    def _error(message: str, code: str, *, retryable: bool, **details: Any) -> Dict[str, Any]:
        """Return a backward-compatible, agent-readable error payload."""
        result: Dict[str, Any] = {
            "error": message,
            "code": code,
            "retryable": retryable,
        }
        if details:
            result["details"] = details
        return result
    
    async def connect(self):
        """Connect to the MuseScore WebSocket API."""
        try:
            self.websocket = await asyncio.wait_for(
                websockets.connect(
                    self.uri,
                    max_size=self.config.max_response_bytes,
                    open_timeout=self.config.connect_timeout,
                ),
                timeout=self.config.connect_timeout,
            )
            logger.info(f"Connected to MuseScore API at {self.uri}")
            return True
        except asyncio.TimeoutError:
            logger.error(
                "Timed out connecting to MuseScore API at %s after %.1fs",
                self.uri,
                self.config.connect_timeout,
            )
            return False
        except Exception as e:
            logger.error(f"Failed to connect to MuseScore API: {str(e)}")
            return False
    
    async def _reset_socket(self):
        """Drop the current socket so the next call reconnects from scratch.

        MuseScore restarting (or the plugin reloading) leaves us holding a dead
        socket whose send/recv raises. Nulling it here lets send_command pick up
        a fresh connection without the whole MCP server needing a restart.
        """
        if self.websocket is not None:
            try:
                await self.websocket.close()
            except Exception:
                pass
            self.websocket = None

    async def send_command(self, action: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Send a command to MuseScore and wait for response.

        Safe inspection commands retry once on a fresh connection. Mutations
        never retry after uncertain delivery because doing so could duplicate
        an edit.
        """
        if params is None:
            params = {}

        command = {"action": action, "params": params}
        payload = json.dumps(command)

        async with self._lock:
            return await self._send_payload(
                payload, retry_safe=action in SAFE_RETRY_ACTIONS
            )

    async def _send_payload(self, payload: str, *, retry_safe: bool = False) -> Dict[str, Any]:
        """Send one already-serialized command while holding the socket lock."""
        last_error: Optional[str] = None
        for attempt in range(2):
            if not self.websocket:
                if not await self.connect():
                    return self._error(
                        "Not connected to MuseScore. Start MuseScore, open a score, and run the MCP plugin.",
                        "connection_failed",
                        retryable=True,
                        uri=self.uri,
                    )

            try:
                logger.debug("Sending command (%d bytes)", len(payload.encode("utf-8")))
                await self.websocket.send(payload)
                response = await asyncio.wait_for(
                    self.websocket.recv(), timeout=self.config.command_timeout
                )
                response_size = len(response.encode("utf-8")) if isinstance(response, str) else len(response)
                logger.debug("Received response (%d bytes)", response_size)
                try:
                    data = json.loads(response)
                except (json.JSONDecodeError, TypeError) as exc:
                    await self._reset_socket()
                    return self._error(
                        "MuseScore returned an invalid JSON response",
                        "invalid_response",
                        retryable=True,
                        reason=str(exc),
                        response_preview=str(response)[:200],
                    )
                # The plugin wraps every reply as {"status": ..., "result": ...}.
                # Unwrap it so callers see the actual payload (or a normalized error).
                if isinstance(data, dict) and "status" in data:
                    if data.get("status") == "error":
                        return self._error(
                            data.get("message", "Unknown plugin error"),
                            "plugin_error",
                            retryable=False,
                        )
                    return data.get("result", data)
                return data
            except asyncio.TimeoutError:
                last_error = f"command timed out after {self.config.command_timeout:.1f}s"
                logger.warning("%s; resetting socket", last_error)
                await self._reset_socket()
                # Retrying a timed-out mutation could apply it twice. Return the
                # uncertainty to the agent instead of silently duplicating work.
                return self._error(
                    "MuseScore did not respond before the command timeout. The command may have been applied; inspect the score before retrying.",
                    "command_timeout",
                    retryable=False,
                    timeout_seconds=self.config.command_timeout,
                )
            except Exception as e:
                last_error = str(e)
                logger.warning(
                    f"Send failed (attempt {attempt + 1}/2), resetting socket: {last_error}"
                )
                await self._reset_socket()
                if not retry_safe:
                    return self._error(
                        "The connection failed while sending an edit. MuseScore may have applied it; inspect the score before retrying.",
                        "uncertain_delivery",
                        retryable=False,
                        reason=last_error,
                    )

        return self._error(
            f"Lost connection to MuseScore: {last_error}",
            "connection_lost",
            retryable=True,
            uri=self.uri,
        )

    def status(self) -> Dict[str, Any]:
        """Return local bridge state without performing network I/O."""
        return {
            "uri": self.uri,
            "socket_open": self.websocket is not None,
            "connect_timeout_seconds": self.config.connect_timeout,
            "command_timeout_seconds": self.config.command_timeout,
            "max_response_bytes": self.config.max_response_bytes,
        }

    async def close(self):
        """Close the WebSocket connection."""
        if self.websocket:
            await self.websocket.close()
            self.websocket = None
            logger.info("Disconnected from MuseScore API")
