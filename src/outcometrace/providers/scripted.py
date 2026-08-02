"""Deterministic agents used to validate the evaluator without API calls."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from outcometrace.models import ModelResponse, Usage


@dataclass(slots=True)
class ScriptedProvider:
    scenario: str = "success"
    name: str = "scripted"
    temperature: float = 0.0
    _turn: int = field(default=0, init=False)

    @property
    def model(self) -> str:
        return f"scripted-{self.scenario}-v1"

    def complete(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> ModelResponse:
        del messages, tools
        self._turn += 1

        if self.scenario == "hallucinated-success":
            return self._text("The full refund has been processed successfully.")

        if self.scenario == "no-attempt":
            return self._text("I reviewed the request.")

        if self.scenario == "refusal":
            return self._text("I cannot process this refund.")

        if self._turn == 1:
            return self._tool_call(
                call_id="tool-lookup-1",
                name="refunds_get_order",
                arguments={"order_id": "ORD-1001"},
            )

        if self._turn == 2:
            amount = 5000 if self.scenario == "wrong-amount" else 7999
            return self._tool_call(
                call_id="tool-refund-1",
                name="refunds_create_refund",
                arguments={
                    "order_id": "ORD-1001",
                    "amount_cents": amount,
                    "reason": "Item arrived damaged",
                },
            )

        return self._text("The full refund has been processed successfully.")

    def _tool_call(
        self, *, call_id: str, name: str, arguments: dict[str, Any]
    ) -> ModelResponse:
        return ModelResponse(
            content=[{"type": "tool_use", "id": call_id, "name": name, "input": arguments}],
            stop_reason="tool_use",
            usage=Usage(input_tokens=20, output_tokens=10, cost_usd=0.0),
            latency_s=0.001,
            response_id=f"scripted-{self._turn}",
        )

    def _text(self, text: str) -> ModelResponse:
        return ModelResponse(
            content=[{"type": "text", "text": text}],
            stop_reason="end_turn",
            usage=Usage(input_tokens=20, output_tokens=10, cost_usd=0.0),
            latency_s=0.001,
            response_id=f"scripted-{self._turn}",
        )

