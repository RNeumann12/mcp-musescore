"""Tests for environment-driven bridge configuration."""

import pytest

from src.config import MuseScoreConfig


def test_config_defaults(monkeypatch):
    for name in (
        "MUSESCORE_MCP_HOST",
        "MUSESCORE_MCP_PORT",
        "MUSESCORE_MCP_CONNECT_TIMEOUT",
        "MUSESCORE_MCP_COMMAND_TIMEOUT",
        "MUSESCORE_MCP_MAX_RESPONSE_BYTES",
    ):
        monkeypatch.delenv(name, raising=False)

    config = MuseScoreConfig.from_env()
    assert config.host == "localhost"
    assert config.port == 8765
    assert config.command_timeout == 30.0


def test_config_environment_overrides(monkeypatch):
    monkeypatch.setenv("MUSESCORE_MCP_HOST", "127.0.0.1")
    monkeypatch.setenv("MUSESCORE_MCP_PORT", "9001")
    monkeypatch.setenv("MUSESCORE_MCP_CONNECT_TIMEOUT", "2.5")
    monkeypatch.setenv("MUSESCORE_MCP_COMMAND_TIMEOUT", "12")
    monkeypatch.setenv("MUSESCORE_MCP_MAX_RESPONSE_BYTES", "4096")

    config = MuseScoreConfig.from_env()
    assert config == MuseScoreConfig("127.0.0.1", 9001, 2.5, 12.0, 4096)


@pytest.mark.parametrize(
    "name,value",
    [
        ("MUSESCORE_MCP_PORT", "nope"),
        ("MUSESCORE_MCP_PORT", "0"),
        ("MUSESCORE_MCP_COMMAND_TIMEOUT", "0"),
        ("MUSESCORE_MCP_MAX_RESPONSE_BYTES", "100"),
    ],
)
def test_config_rejects_invalid_values(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValueError, match=name):
        MuseScoreConfig.from_env()
