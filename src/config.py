"""Runtime configuration for the MuseScore MCP bridge.

All settings are optional environment variables so desktop MCP clients can
configure the bridge without modifying source files.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env_int(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}, got {value}")
    return value


def _env_float(name: str, default: float, *, minimum: float = 0.1) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number, got {raw!r}") from exc
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}, got {value}")
    return value


@dataclass(frozen=True)
class MuseScoreConfig:
    """Connection limits for one MCP server process."""

    host: str = "localhost"
    port: int = 8765
    connect_timeout: float = 5.0
    command_timeout: float = 30.0
    max_response_bytes: int = 8 * 1024 * 1024

    @classmethod
    def from_env(cls) -> "MuseScoreConfig":
        host = os.getenv("MUSESCORE_MCP_HOST", "localhost").strip()
        if not host:
            raise ValueError("MUSESCORE_MCP_HOST must not be empty")
        return cls(
            host=host,
            port=_env_int("MUSESCORE_MCP_PORT", 8765, minimum=1),
            connect_timeout=_env_float("MUSESCORE_MCP_CONNECT_TIMEOUT", 5.0),
            command_timeout=_env_float("MUSESCORE_MCP_COMMAND_TIMEOUT", 30.0),
            max_response_bytes=_env_int(
                "MUSESCORE_MCP_MAX_RESPONSE_BYTES", 8 * 1024 * 1024, minimum=1024
            ),
        )
