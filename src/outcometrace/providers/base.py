"""Provider boundary used by the evaluation runner."""

from __future__ import annotations

from typing import Any, Protocol

from outcometrace.models import ModelResponse


class AgentProvider(Protocol):
    name: str
    model: str
    temperature: float

    def complete(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> ModelResponse: ...

