"""Agent execution loop that treats the sandbox outcome as ground truth."""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

from outcometrace.environment import ToolExecutionError
from outcometrace.models import Trace, TrialResult
from outcometrace.providers.base import AgentProvider
from outcometrace.scoring import classify_failure
from outcometrace.task import EvaluationTask


class TrialRunner:
    def __init__(self, task: EvaluationTask, provider: AgentProvider) -> None:
        self.task = task
        self.provider = provider

    def run(self, *, trial_n: int = 1, seed: int = 1) -> TrialResult:
        trace = Trace()
        messages: list[dict[str, Any]] = [{"role": "user", "content": self.task.prompt}]
        trace.record("prompt", step=0, role="user", content=self.task.prompt)
        trace.record("tool_schema", step=0, tools=self.task.tools)

        steps = 0
        input_tokens = 0
        output_tokens = 0
        total_latency_s = 0.0
        costs: list[float] = []
        final_text = ""
        last_had_tool_calls = False

        with self.task.build_environment(seed=seed) as env:
            for step in range(1, self.task.max_steps + 1):
                steps = step
                response = self.provider.complete(messages=messages, tools=self.task.tools)
                input_tokens += response.usage.input_tokens
                output_tokens += response.usage.output_tokens
                total_latency_s += response.latency_s
                if response.usage.cost_usd is not None:
                    costs.append(response.usage.cost_usd)

                trace.record(
                    "assistant",
                    step=step,
                    response_id=response.response_id,
                    stop_reason=response.stop_reason,
                    content=response.content,
                    usage={
                        "input_tokens": response.usage.input_tokens,
                        "output_tokens": response.usage.output_tokens,
                        "cost_usd": response.usage.cost_usd,
                    },
                    latency_s=response.latency_s,
                )
                messages.append({"role": "assistant", "content": response.content})
                final_text = _extract_text(response.content) or final_text
                tool_calls = [
                    block for block in response.content if block.get("type") == "tool_use"
                ]
                last_had_tool_calls = bool(tool_calls)
                if not tool_calls:
                    break

                tool_results: list[dict[str, Any]] = []
                for call in tool_calls:
                    name = str(call.get("name", ""))
                    arguments = call.get("input")
                    if not isinstance(arguments, dict):
                        arguments = {}
                    try:
                        result = env.execute(name, arguments)
                    except (ToolExecutionError, KeyError, TypeError, ValueError) as exc:
                        result = {
                            "ok": False,
                            "error_type": type(exc).__name__,
                            "error": str(exc),
                        }
                    trace.record(
                        "tool_result",
                        step=step,
                        call_id=call.get("id"),
                        name=name,
                        arguments=arguments,
                        result=result,
                    )
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": call.get("id"),
                            "content": json.dumps(result, sort_keys=True),
                            "is_error": result.get("ok") is False,
                        }
                    )
                messages.append({"role": "user", "content": tool_results})

            max_steps_hit = steps == self.task.max_steps and last_had_tool_calls
            outcome = self.task.check_environment(env)
            process = self.task.check_trace(trace, max_steps_hit=max_steps_hit)

        error_category = classify_failure(
            outcome=outcome,
            process=process,
            trace=trace,
            final_text=final_text,
        )
        return TrialResult(
            run_id=str(uuid.uuid4()),
            task_id=self.task.task_id,
            task_version=self.task.version,
            provider=self.provider.name,
            model=self.provider.model,
            prompt_version=self.task.prompt_version,
            temperature=self.provider.temperature,
            trial_n=trial_n,
            environment_seed=seed,
            tool_schema_hash=_schema_hash(self.task.tools),
            success=outcome.passed and process.passed,
            outcome=outcome,
            process=process,
            error_category=error_category,
            final_text=final_text,
            steps=steps,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=sum(costs) if costs else None,
            latency_s=total_latency_s,
            trace=trace,
        )


def _extract_text(content: list[dict[str, Any]]) -> str:
    return "\n".join(
        str(block.get("text", "")) for block in content if block.get("type") == "text"
    ).strip()


def _schema_hash(tools: list[dict[str, Any]]) -> str:
    encoded = json.dumps(tools, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()[:16]
