"""Unit tests for bridge failure handling; no MuseScore process required."""

import asyncio
import json

from src.client.websocket_client import MuseScoreClient
from src.config import MuseScoreConfig


class FakeSocket:
    def __init__(self, response=None, *, block=False, receive_error=None):
        self.response = response
        self.block = block
        self.receive_error = receive_error
        self.sent = []
        self.closed = False

    async def send(self, payload):
        self.sent.append(json.loads(payload))

    async def recv(self):
        if self.receive_error is not None:
            raise self.receive_error
        if self.block:
            await asyncio.Event().wait()
        return self.response

    async def close(self):
        self.closed = True


def _config(**changes):
    values = dict(
        host="localhost",
        port=8765,
        connect_timeout=0.1,
        command_timeout=0.1,
        max_response_bytes=4096,
    )
    values.update(changes)
    return MuseScoreConfig(**values)


def test_unwraps_plugin_success(monkeypatch):
    socket = FakeSocket('{"status":"success","result":{"success":true}}')

    async def connect(*args, **kwargs):
        return socket

    monkeypatch.setattr("src.client.websocket_client.websockets.connect", connect)
    client = MuseScoreClient(config=_config())
    result = asyncio.run(client.send_command("ping"))
    assert result == {"success": True}
    assert socket.sent == [{"action": "ping", "params": {}}]


def test_timeout_is_not_retried_because_mutation_state_is_unknown(monkeypatch):
    socket = FakeSocket(block=True)

    async def connect(*args, **kwargs):
        return socket

    monkeypatch.setattr("src.client.websocket_client.websockets.connect", connect)
    client = MuseScoreClient(config=_config(command_timeout=0.01))
    result = asyncio.run(client.send_command("addNote", {"pitch": 60}))
    assert result["code"] == "command_timeout"
    assert result["retryable"] is False
    assert len(socket.sent) == 1
    assert socket.closed is True


def test_invalid_json_returns_structured_error_and_resets_socket(monkeypatch):
    socket = FakeSocket("not json")

    async def connect(*args, **kwargs):
        return socket

    monkeypatch.setattr("src.client.websocket_client.websockets.connect", connect)
    client = MuseScoreClient(config=_config())
    result = asyncio.run(client.send_command("getScore"))
    assert result["code"] == "invalid_response"
    assert result["retryable"] is True
    assert result["details"]["response_preview"] == "not json"
    assert socket.closed is True


def test_connection_failure_explains_recovery(monkeypatch):
    async def connect(*args, **kwargs):
        raise OSError("refused")

    monkeypatch.setattr("src.client.websocket_client.websockets.connect", connect)
    client = MuseScoreClient(config=_config())
    result = asyncio.run(client.send_command("ping"))
    assert result["code"] == "connection_failed"
    assert result["retryable"] is True
    assert "run the MCP plugin" in result["error"]


def test_failed_edit_reply_is_not_retried(monkeypatch):
    socket = FakeSocket(receive_error=OSError("connection closed"))
    connections = 0

    async def connect(*args, **kwargs):
        nonlocal connections
        connections += 1
        return socket

    monkeypatch.setattr("src.client.websocket_client.websockets.connect", connect)
    client = MuseScoreClient(config=_config())
    result = asyncio.run(client.send_command("addNote", {"pitch": 60}))
    assert result["code"] == "uncertain_delivery"
    assert result["retryable"] is False
    assert connections == 1
    assert len(socket.sent) == 1


def test_failed_read_reply_reconnects_once(monkeypatch):
    sockets = [
        FakeSocket(receive_error=OSError("connection closed")),
        FakeSocket('{"status":"success","result":{"success":true}}'),
    ]

    async def connect(*args, **kwargs):
        return sockets.pop(0)

    monkeypatch.setattr("src.client.websocket_client.websockets.connect", connect)
    client = MuseScoreClient(config=_config())
    result = asyncio.run(client.send_command("getScore"))
    assert result == {"success": True}
    assert sockets == []
