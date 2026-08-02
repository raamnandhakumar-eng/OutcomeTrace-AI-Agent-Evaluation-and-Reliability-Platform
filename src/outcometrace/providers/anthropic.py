"""Optional Anthropic Messages API adapter."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from outcometrace.models import ModelResponse, Usage


@dataclass(slots=True)
class AnthropicProvider:
    model: str
    temperature: float = 0.0
    max_tokens: int = 1024
    input_price_per_million: float | None = None
    output_price_per_million: float | None = None
    name: str = "anthropic"
    _client: Any = field(init=False, repr=False)

    def __post_init__(self) -> None:
        try:
            import anthropic
        except ImportError as exc:
            raise RuntimeError(
                "Install the Anthropic adapter with: pip install -e '.[anthropic]'"
            ) from exc
        self._client = anthropic.Anthropic()

    def complete(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> ModelResponse:
        started = time.perf_counter()
        response = self._client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            temperature=self.temperature,
            tools=tools,
            messages=messages,
        )
        latency_s = time.perf_counter() - started
        content = [block.model_dump(mode="json") for block in response.content]
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens
        cost_usd = self._calculate_cost(input_tokens, output_tokens)
        return ModelResponse(
            content=content,
            stop_reason=response.stop_reason or "unknown",
            usage=Usage(
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_usd=cost_usd,
            ),
            latency_s=latency_s,
            response_id=response.id,
        )

    def _calculate_cost(self, input_tokens: int, output_tokens: int) -> float | None:
        if self.input_price_per_million is None or self.output_price_per_million is None:
            return None
        return (
            input_tokens * self.input_price_per_million
            + output_tokens * self.output_price_per_million
        ) / 1_000_000
