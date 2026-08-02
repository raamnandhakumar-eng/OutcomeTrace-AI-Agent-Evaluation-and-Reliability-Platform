from __future__ import annotations

import json

from outcometrace.metrics import MetricsStore
from outcometrace.providers.scripted import ScriptedProvider
from outcometrace.runner import TrialRunner
from outcometrace.tasks.refund import RefundTask


def run_scenario(scenario: str, *, seed: int = 7):
    return TrialRunner(RefundTask(), ScriptedProvider(scenario=scenario)).run(seed=seed)


def test_success_is_verified_from_database_state() -> None:
    result = run_scenario("success")

    assert result.success is True
    assert result.error_category is None
    assert all(result.outcome.checks.values())
    assert result.outcome.state["refunds"][0]["amount_cents"] == 7999
    assert result.steps == 3
    assert len(result.trace.events_of_kind("tool_schema")) == 1


def test_claimed_success_without_mutation_is_a_failure() -> None:
    result = run_scenario("hallucinated-success")

    assert result.success is False
    assert result.error_category == "hallucinated_success"
    assert result.outcome.checks["refund_exists"] is False
    assert result.final_text == "The full refund has been processed successfully."


def test_wrong_amount_is_caught_even_when_tool_reports_success() -> None:
    result = run_scenario("wrong-amount")

    assert result.success is False
    assert result.error_category == "wrong_final_state"
    assert result.outcome.checks["refund_exists"] is True
    assert result.outcome.checks["correct_amount"] is False
    assert "wrong_amount_refund_attempt" in result.process.flags


def test_every_trial_receives_fresh_seeded_environment() -> None:
    first = run_scenario("success", seed=10)
    second = run_scenario("hallucinated-success", seed=11)

    assert len(first.outcome.state["refunds"]) == 1
    assert second.outcome.state["refunds"] == []
    assert second.outcome.state["orders"][0]["status"] == "paid"


def test_metrics_store_writes_compact_row_and_separate_trace(tmp_path) -> None:
    result = run_scenario("success")
    store = MetricsStore(tmp_path / "runs")

    trace_path = store.save(result)
    row = json.loads(store.trials_path.read_text(encoding="utf-8"))
    trace = json.loads(trace_path.read_text(encoding="utf-8"))

    assert row["run_id"] == result.run_id
    assert row["trace_ref"] == str(trace_path)
    assert "trace" not in row
    assert len(trace["events"]) >= 6
