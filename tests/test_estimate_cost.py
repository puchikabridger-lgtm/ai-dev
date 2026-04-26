"""Unit tests for aidev.estimate_cost."""

import pytest

from aidev import DEFAULT_BUDGET, estimate_cost


@pytest.mark.parametrize(
    "reasoning",
    ["none", "low", "medium", "high", "xhigh"],
)
def test_default_budget_table_returns_known_value(reasoning):
    classification = {"reasoning": reasoning}
    expected = DEFAULT_BUDGET["estimated_call_cost_usd"][reasoning]
    assert estimate_cost(classification, DEFAULT_BUDGET) == pytest.approx(expected)


def test_unknown_reasoning_falls_back_to_medium_estimate():
    classification = {"reasoning": "ultra-mega"}
    expected = DEFAULT_BUDGET["estimated_call_cost_usd"]["medium"]
    assert estimate_cost(classification, DEFAULT_BUDGET) == pytest.approx(expected)


def test_custom_budget_table_is_respected():
    custom = {
        "estimated_call_cost_usd": {
            "none": 0.001,
            "low": 0.002,
            "medium": 0.003,
            "high": 0.004,
            "xhigh": 0.005,
        }
    }
    assert estimate_cost({"reasoning": "high"}, custom) == pytest.approx(0.004)


def test_missing_cost_table_falls_back_to_defaults():
    """A budget object without `estimated_call_cost_usd` should still work."""
    assert estimate_cost({"reasoning": "low"}, {}) == pytest.approx(
        DEFAULT_BUDGET["estimated_call_cost_usd"]["low"]
    )


def test_returns_float():
    """Caller (`build_contract` budget percent) does float math on the result."""
    cost = estimate_cost({"reasoning": "medium"}, DEFAULT_BUDGET)
    assert isinstance(cost, float)


def test_partial_custom_table_falls_back_to_internal_default_for_missing_key():
    """If the custom table omits a key but provides 'medium', missing keys hit the
    inner `.get('medium', 0.08)` fallback inside estimate_cost."""
    custom = {"estimated_call_cost_usd": {"medium": 0.42}}
    assert estimate_cost({"reasoning": "xhigh"}, custom) == pytest.approx(0.42)
