"""Command-line entrypoint for repeatable OutcomeTrace trials."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from outcometrace.metrics import MetricsStore
from outcometrace.providers.base import AgentProvider
from outcometrace.providers.scripted import ScriptedProvider
from outcometrace.runner import TrialRunner
from outcometrace.stats import wilson_interval
from outcometrace.tasks.refund import RefundTask

SCRIPTED_AGENTS = (
    "success",
    "hallucinated-success",
    "wrong-amount",
    "no-attempt",
    "refusal",
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="outcometrace")
    subparsers = parser.add_subparsers(dest="command", required=True)
    run = subparsers.add_parser("run", help="Run the refund evaluation task")
    run.add_argument("--agent", choices=(*SCRIPTED_AGENTS, "anthropic"), default="success")
    run.add_argument("--model", help="Exact model ID; required for --agent anthropic")
    run.add_argument("--temperature", type=float, default=0.0)
    run.add_argument("--trials", type=int, default=1)
    run.add_argument("--seed", type=int, default=1000)
    run.add_argument("--output-dir", type=Path, default=Path("runs"))
    run.add_argument("--input-price-per-million", type=float)
    run.add_argument("--output-price-per-million", type=float)
    return parser


def make_provider(args: argparse.Namespace) -> AgentProvider:
    if args.agent != "anthropic":
        return ScriptedProvider(scenario=args.agent)
    if not args.model:
        raise SystemExit("--model is required when --agent anthropic")
    from outcometrace.providers.anthropic import AnthropicProvider

    return AnthropicProvider(
        model=args.model,
        temperature=args.temperature,
        input_price_per_million=args.input_price_per_million,
        output_price_per_million=args.output_price_per_million,
    )


def run_command(args: argparse.Namespace) -> int:
    if args.trials <= 0:
        raise SystemExit("--trials must be positive")

    store = MetricsStore(args.output_dir)
    results = []
    for trial_n in range(1, args.trials + 1):
        provider = make_provider(args)
        result = TrialRunner(RefundTask(), provider).run(
            trial_n=trial_n,
            seed=args.seed + trial_n - 1,
        )
        store.save(result)
        results.append(result)
        print(
            json.dumps(
                {
                    "trial": trial_n,
                    "success": result.success,
                    "error_category": result.error_category,
                    "run_id": result.run_id,
                },
                sort_keys=True,
            )
        )

    successes = sum(result.success for result in results)
    lower, upper = wilson_interval(successes, len(results))
    print(
        json.dumps(
            {
                "summary": {
                    "successes": successes,
                    "trials": len(results),
                    "success_rate": successes / len(results),
                    "wilson_95": [lower, upper],
                    "metrics_path": str(store.trials_path),
                }
            },
            sort_keys=True,
        )
    )
    return 0 if successes == len(results) else 1


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "run":
        return run_command(args)
    raise SystemExit(f"Unknown command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())

