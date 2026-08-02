"""Interfaces that make evaluation tasks and sandboxes replaceable."""

from __future__ import annotations

from typing import Any, Protocol

from outcometrace.models import OutcomeScore, ProcessScore, Trace


class ToolEnvironment(Protocol):
    def execute(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]: ...

    def __enter__(self) -> ToolEnvironment: ...

    def __exit__(self, *args: object) -> None: ...


class EvaluationTask(Protocol):
    task_id: str
    version: str
    prompt_version: str
    prompt: str
    max_steps: int

    @property
    def tools(self) -> list[dict[str, Any]]: ...

    def build_environment(self, *, seed: int) -> ToolEnvironment: ...

    def check_environment(self, env: ToolEnvironment) -> OutcomeScore: ...

    def check_trace(self, trace: Trace, *, max_steps_hit: bool) -> ProcessScore: ...

