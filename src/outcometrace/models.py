"""Shared data models for agent responses, traces, and trial results."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(slots=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None


@dataclass(slots=True)
class ModelResponse:
    content: list[dict[str, Any]]
    stop_reason: str
    usage: Usage = field(default_factory=Usage)
    latency_s: float = 0.0
    response_id: str | None = None


@dataclass(slots=True)
class TraceEvent:
    kind: str
    step: int
    data: dict[str, Any]
    recorded_at: str = field(default_factory=utc_now)


@dataclass(slots=True)
class Trace:
    events: list[TraceEvent] = field(default_factory=list)

    def record(self, kind: str, step: int, **data: Any) -> None:
        self.events.append(TraceEvent(kind=kind, step=step, data=data))

    def events_of_kind(self, kind: str) -> list[TraceEvent]:
        return [event for event in self.events if event.kind == kind]

    def to_dict(self) -> dict[str, Any]:
        return {"events": [asdict(event) for event in self.events]}


@dataclass(slots=True)
class OutcomeScore:
    passed: bool
    checks: dict[str, bool]
    state: dict[str, Any]


@dataclass(slots=True)
class ProcessScore:
    passed: bool
    flags: list[str]
    max_steps_hit: bool = False


@dataclass(slots=True)
class TrialResult:
    run_id: str
    task_id: str
    task_version: str
    provider: str
    model: str
    prompt_version: str
    temperature: float
    trial_n: int
    environment_seed: int
    tool_schema_hash: str
    success: bool
    outcome: OutcomeScore
    process: ProcessScore
    error_category: str | None
    final_text: str
    steps: int
    input_tokens: int
    output_tokens: int
    cost_usd: float | None
    latency_s: float
    trace: Trace
    created_at: str = field(default_factory=utc_now)
    trace_ref: str | None = None

    def to_dict(self, *, include_trace: bool = False) -> dict[str, Any]:
        data = asdict(self)
        if not include_trace:
            data.pop("trace")
        return data

