"""Unit tests for aidev.build_codex_prompt prompt assembly.

Note: at lower reasoning tiers, `tier_limits` caps the assembled prompt
aggressively (1400 chars at `none`, 1800 at `low`). The boilerplate added by
`build_enhanced_prompt` / `build_technical_prompt` already exceeds those
budgets, so trailing sections (SCOPE, FINAL RESPONSE, etc.) get truncated by
the outer `trim_chars`. The tests below assert that contract: required
front-of-prompt sections always survive, and optional later sections appear
only at higher reasoning tiers where there is headroom.
"""

import json

import pytest

from aidev import (
    DEFAULT_RULES,
    build_codex_prompt,
    build_contract,
    classify_task,
    tier_limits,
)


def _budget_status() -> dict:
    return {
        "decision": "ok",
        "reason": "",
        "request_estimate_usd": 0.05,
        "request_budget_usd": 0.5,
        "request_percent": 10.0,
    }


def _make_contract(prompt: str, *, forced_reasoning=None, feature_flags=None):
    classification = classify_task(prompt, forced_reasoning=forced_reasoning)
    return build_contract(
        prompt=prompt,
        classification=classification,
        model="gpt-5.4-mini",
        budget_status=_budget_status(),
        feature_flags=feature_flags,
        supervisor={"model": "gpt-5.4-mini", "reasoning": "low"},
    )


# Sections that fit within the budget at every reasoning tier.
ALWAYS_PRESENT_SECTIONS = (
    "You are Codex executing one supervised local task.",
    "TASK",
    "SETTINGS",
    "RULES",
)


@pytest.mark.parametrize("reasoning", ["none", "low", "medium", "high", "xhigh"])
def test_prompt_contains_front_sections_for_each_reasoning(reasoning):
    contract = _make_contract("do something", forced_reasoning=reasoning)
    prompt = build_codex_prompt(contract, DEFAULT_RULES)
    for section in ALWAYS_PRESENT_SECTIONS:
        assert section in prompt, f"missing {section!r} for reasoning={reasoning}"


@pytest.mark.parametrize("reasoning", ["none", "low", "medium", "high", "xhigh"])
def test_prompt_respects_tier_limit(reasoning):
    contract = _make_contract("do something", forced_reasoning=reasoning)
    prompt = build_codex_prompt(contract, DEFAULT_RULES)
    limit = tier_limits(reasoning)["prompt"]
    assert len(prompt) <= limit, (
        f"prompt length {len(prompt)} exceeds tier limit {limit} for {reasoning}"
    )


@pytest.mark.parametrize("reasoning", ["high", "xhigh"])
def test_prompt_contains_final_response_at_high_tiers(reasoning):
    """At high/xhigh tiers there is enough budget for FINAL RESPONSE to survive."""
    contract = _make_contract("do something", forced_reasoning=reasoning)
    prompt = build_codex_prompt(contract, DEFAULT_RULES)
    assert "FINAL RESPONSE" in prompt
    assert "TECHNICAL PROMPT" in prompt


def test_high_reasoning_includes_scope_with_rollback_section():
    contract = _make_contract("do something", forced_reasoning="high")
    prompt = build_codex_prompt(contract, DEFAULT_RULES)
    assert "SCOPE" in prompt
    assert "Allowed:" in prompt
    assert "Forbidden:" in prompt
    assert "Rollback required if:" in prompt


def test_high_reasoning_includes_contract_summary_json():
    contract = _make_contract("do something", forced_reasoning="high")
    prompt = build_codex_prompt(contract, DEFAULT_RULES)
    assert "CONTRACT SUMMARY" in prompt
    summary_index = prompt.index("CONTRACT SUMMARY")
    json_start = prompt.index("{", summary_index)
    # Find the matching closing brace by walking depth.
    depth = 0
    json_end = json_start
    for i in range(json_start, len(prompt)):
        ch = prompt[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                json_end = i + 1
                break
    parsed = json.loads(prompt[json_start:json_end])
    assert parsed["model"] == "gpt-5.4-mini"
    assert parsed["classification"]["reasoning"] == "high"


def test_xhigh_reasoning_includes_contract_summary():
    contract = _make_contract("do something", forced_reasoning="xhigh")
    prompt = build_codex_prompt(contract, DEFAULT_RULES)
    assert "CONTRACT SUMMARY" in prompt


def test_low_reasoning_omits_contract_summary():
    contract = _make_contract("rename helper to compute_total")
    assert contract["classification"]["reasoning"] in {"none", "low"}
    prompt = build_codex_prompt(contract, DEFAULT_RULES)
    assert "CONTRACT SUMMARY" not in prompt


def test_medium_reasoning_omits_contract_summary():
    contract = _make_contract("do something", forced_reasoning="medium")
    prompt = build_codex_prompt(contract, DEFAULT_RULES)
    assert "CONTRACT SUMMARY" not in prompt


def test_todolist_feature_at_high_adds_todo_stage_contract_section():
    """TODO STAGE CONTRACT only fits within the prompt budget at high+ tiers."""
    contract = _make_contract(
        "add staged feature work",
        forced_reasoning="high",
        feature_flags={"request_feature": "todolist"},
    )
    assert contract["stage_policy"]["requires_todo_stages"] is True
    prompt = build_codex_prompt(contract, DEFAULT_RULES)
    assert "TODO STAGE CONTRACT" in prompt
    assert "Start by writing the staged TODO list" in prompt


def test_non_todolist_feature_omits_todo_stage_contract_section():
    contract = _make_contract("do something", forced_reasoning="high")
    prompt = build_codex_prompt(contract, DEFAULT_RULES)
    assert "TODO STAGE CONTRACT" not in prompt


def test_prompt_includes_user_request_text():
    contract = _make_contract("do something distinctive_xyz")
    prompt = build_codex_prompt(contract, DEFAULT_RULES)
    # The enhanced prompt is built around the original user request, so the
    # distinctive marker word must appear somewhere in the assembled output.
    assert "distinctive_xyz" in prompt


def test_prompt_includes_model_in_settings_block():
    contract = _make_contract("do something")
    prompt = build_codex_prompt(contract, DEFAULT_RULES)
    assert "gpt-5.4-mini" in prompt


def test_tier_limits_for_each_reasoning_level():
    levels = ["none", "low", "medium", "high", "xhigh"]
    limits = [tier_limits(level)["prompt"] for level in levels]
    # Limits must be strictly non-decreasing as reasoning grows.
    assert limits == sorted(limits)
    # Unknown reasoning falls back to the medium tier limits.
    assert tier_limits("bogus") == tier_limits("medium")


def test_unknown_tier_uses_medium_prompt_limit():
    contract = _make_contract("do something", forced_reasoning="medium")
    contract["classification"]["reasoning"] = "bogus"
    prompt = build_codex_prompt(contract, DEFAULT_RULES)
    assert len(prompt) <= tier_limits("medium")["prompt"]
