"""Append-only JSONL metrics and separate full-trace storage."""

from __future__ import annotations

import json
from pathlib import Path

from outcometrace.models import TrialResult


class MetricsStore:
    def __init__(self, root: str | Path = "runs") -> None:
        self.root = Path(root)
        self.traces_dir = self.root / "traces"
        self.trials_path = self.root / "trials.jsonl"

    def save(self, result: TrialResult) -> Path:
        self.traces_dir.mkdir(parents=True, exist_ok=True)
        trace_path = self.traces_dir / f"{result.run_id}.json"
        trace_path.write_text(
            json.dumps(result.trace.to_dict(), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        result.trace_ref = str(trace_path)
        with self.trials_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(result.to_dict(), sort_keys=True) + "\n")
        return trace_path

