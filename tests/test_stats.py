from __future__ import annotations

import pytest

from outcometrace.stats import wilson_interval


def test_wilson_interval_for_eight_of_ten() -> None:
    lower, upper = wilson_interval(8, 10)

    assert lower == pytest.approx(0.490, abs=0.001)
    assert upper == pytest.approx(0.943, abs=0.001)


@pytest.mark.parametrize("successes,trials", [(-1, 10), (11, 10), (0, 0)])
def test_wilson_interval_rejects_invalid_counts(successes: int, trials: int) -> None:
    with pytest.raises(ValueError):
        wilson_interval(successes, trials)

