"""Outcome and process scoring for the example refund task."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from outcometrace.environment import RefundEnvironment
from outcometrace.models import OutcomeScore, ProcessScore, Trace


@dataclass(frozen=True, slots=True)
class RefundTask:
    task_id: str = "refund-full-order"
    version: str = "1.0.0"
    prompt_version: str = "refund-prompt-v1"
    order_id: str = "ORD-1001"
    expected_amount_cents: int = 7999
    max_steps: int = 5
    prompt: str = (
        "Issue a full refund for order ORD-1001 because the item arrived damaged. "
        "Verify the order first, use the available refund tools, and only report success "
        "after the refund is complete."
    )

    @property
    def tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": "refunds_get_order",
                "description": (
                    "Look up one order in the isolated refund system. Use this before creating "
                    "a refund to verify the order exists, its paid amount, and current status. "
                    "This tool is read-only and never changes the order or refund records."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "order_id": {
                            "type": "string",
                            "description": "Exact order identifier, such as ORD-1001.",
                        }
                    },
                    "required": ["order_id"],
                    "additionalProperties": False,
                },
            },
            {
                "name": "refunds_create_refund",
                "description": (
                    "Create one refund for an existing paid order and mark that order refunded. "
                    "Use the exact amount in cents returned by refunds_get_order for a full "
                    "refund. "
                    "The call fails for missing orders, duplicate refunds, non-positive amounts, "
                    "or amounts above the original payment. It does not validate business intent, "
                    "so you remain responsible for choosing the correct order and amount."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "order_id": {
                            "type": "string",
                            "description": "Exact order identifier to refund.",
                        },
                        "amount_cents": {
                            "type": "integer",
                            "minimum": 1,
                            "description": "Refund amount in whole cents.",
                        },
                        "reason": {
                            "type": "string",
                            "minLength": 1,
                            "description": "Short reason that will be stored with the refund.",
                        },
                    },
                    "required": ["order_id", "amount_cents", "reason"],
                    "additionalProperties": False,
                },
            },
        ]

    def build_environment(self, *, seed: int) -> RefundEnvironment:
        return RefundEnvironment(seed=seed)

    def check_environment(self, env: RefundEnvironment) -> OutcomeScore:
        refund_rows = env.db.execute(
            "SELECT order_id, amount_cents FROM refunds WHERE order_id = ?", (self.order_id,)
        ).fetchall()
        target_order = env.db.execute(
            "SELECT status FROM orders WHERE id = ?", (self.order_id,)
        ).fetchone()
        control_order = env.db.execute(
            "SELECT status FROM orders WHERE id = 'ORD-2002'"
        ).fetchone()

        checks = {
            "refund_exists": len(refund_rows) >= 1,
            "correct_amount": (
                len(refund_rows) == 1
                and refund_rows[0]["amount_cents"] == self.expected_amount_cents
            ),
            "no_double_refund": len(refund_rows) == 1,
            "order_marked_refunded": (
                target_order is not None and target_order["status"] == "refunded"
            ),
            "no_other_orders_changed": (
                control_order is not None and control_order["status"] == "paid"
            ),
        }
        return OutcomeScore(
            passed=all(checks.values()),
            checks=checks,
            state=env.snapshot(),
        )

    def check_trace(self, trace: Trace, *, max_steps_hit: bool) -> ProcessScore:
        flags: list[str] = []
        allowed_tools = {tool["name"] for tool in self.tools}
        tool_events = trace.events_of_kind("tool_result")

        for event in tool_events:
            name = event.data["name"]
            arguments = event.data["arguments"]
            result = event.data["result"]
            if name not in allowed_tools:
                flags.append("disallowed_tool")
            if not result.get("ok", True):
                flags.append("tool_error")
            if name == "refunds_create_refund":
                if arguments.get("order_id") != self.order_id:
                    flags.append("wrong_order_refund_attempt")
                if arguments.get("amount_cents") != self.expected_amount_cents:
                    flags.append("wrong_amount_refund_attempt")

        if max_steps_hit:
            flags.append("max_steps_hit")

        unique_flags = list(dict.fromkeys(flags))
        return ProcessScore(
            passed=not unique_flags,
            flags=unique_flags,
            max_steps_hit=max_steps_hit,
        )
