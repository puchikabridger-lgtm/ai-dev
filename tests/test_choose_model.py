"""Unit tests for aidev.choose_model and normalize_model_name."""

import pytest

from aidev import DEFAULT_CONFIG, choose_model, normalize_model_name


def _classification(reasoning: str = "low", task_type: str = "general") -> dict:
    return {
        "task_type": task_type,
        "complexity": reasoning if reasoning != "xhigh" else "extra_high",
        "reasoning": reasoning,
        "risk": "low",
        "needs_plan": False,
        "is_ui": False,
        "is_tiny_create": False,
        "requires_approval": reasoning in {"high", "xhigh"},
    }


def test_normalize_model_name_aliases_pro_to_55():
    assert normalize_model_name("gpt-5.4-pro") == "gpt-5.5"


def test_normalize_model_name_passthrough():
    assert normalize_model_name("gpt-5.4") == "gpt-5.4"
    assert normalize_model_name("gpt-5.4-mini") == "gpt-5.4-mini"


def test_normalize_model_name_strips_whitespace():
    assert normalize_model_name("  gpt-5.4-mini  ") == "gpt-5.4-mini"


def test_normalize_model_name_handles_empty():
    assert normalize_model_name("") == ""
    assert normalize_model_name(None) == ""  # type: ignore[arg-type]


def test_choose_model_forced_overrides_everything():
    chosen = choose_model(
        DEFAULT_CONFIG,
        _classification("xhigh"),
        forced_model="gpt-5.4-pro",
    )
    assert chosen == "gpt-5.5"  # alias normalized


def test_choose_model_xhigh_picks_executor_max():
    chosen = choose_model(DEFAULT_CONFIG, _classification("xhigh"))
    assert chosen == DEFAULT_CONFIG["models"]["executor_max"]


def test_choose_model_high_picks_executor_complex():
    chosen = choose_model(DEFAULT_CONFIG, _classification("high"))
    assert chosen == DEFAULT_CONFIG["models"]["executor_complex"]


def test_choose_model_medium_picks_executor_complex():
    chosen = choose_model(DEFAULT_CONFIG, _classification("medium"))
    assert chosen == DEFAULT_CONFIG["models"]["executor_complex"]


@pytest.mark.parametrize("reasoning", ["none", "low"])
def test_choose_model_low_reasoning_picks_default(reasoning):
    chosen = choose_model(DEFAULT_CONFIG, _classification(reasoning))
    assert chosen == DEFAULT_CONFIG["models"]["executor_default"]


def test_choose_model_manual_mode_uses_manual_model():
    ui_settings = {
        "supervisor_model_mode": "manual",
        "supervisor_manual_model": "gpt-5.4-pro",
    }
    chosen = choose_model(
        DEFAULT_CONFIG,
        _classification("low"),
        ui_settings=ui_settings,
    )
    # Manual model also flows through normalize_model_name.
    assert chosen == "gpt-5.5"


def test_choose_model_manual_mode_without_manual_model_falls_back_to_auto():
    ui_settings = {
        "supervisor_model_mode": "manual",
        "supervisor_manual_model": "",
    }
    chosen = choose_model(
        DEFAULT_CONFIG,
        _classification("low"),
        ui_settings=ui_settings,
    )
    # No manual model, no `task` mode, no catalog -> auto picks executor_default.
    assert chosen == DEFAULT_CONFIG["models"]["executor_default"]


def test_choose_model_task_mode_matches_task_tag():
    config = {
        **DEFAULT_CONFIG,
        "models": {
            **DEFAULT_CONFIG["models"],
            "catalog": [
                {
                    "model": "specialist-bug-model",
                    "mode": "both",
                    "enabled": True,
                    "task_tags": "bugfix",
                },
                {
                    "model": "fallback-model",
                    "mode": "both",
                    "enabled": True,
                    "task_tags": "*",
                },
            ],
        },
    }
    ui_settings = {"supervisor_model_mode": "task"}
    chosen = choose_model(
        config,
        _classification("low", task_type="bugfix"),
        ui_settings=ui_settings,
    )
    assert chosen == "specialist-bug-model"


def test_choose_model_task_mode_falls_back_to_wildcard_entry():
    config = {
        **DEFAULT_CONFIG,
        "models": {
            **DEFAULT_CONFIG["models"],
            "catalog": [
                {
                    "model": "specialist-only-for-ui",
                    "mode": "both",
                    "enabled": True,
                    "task_tags": "ui",
                },
                {
                    "model": "any-fallback",
                    "mode": "both",
                    "enabled": True,
                    "task_tags": "any",
                },
            ],
        },
    }
    ui_settings = {"supervisor_model_mode": "task"}
    chosen = choose_model(
        config,
        _classification("low", task_type="bugfix"),
        ui_settings=ui_settings,
    )
    assert chosen == "any-fallback"


def test_choose_model_task_mode_skips_disabled_entries():
    config = {
        **DEFAULT_CONFIG,
        "models": {
            **DEFAULT_CONFIG["models"],
            "catalog": [
                {
                    "model": "disabled-bug-model",
                    "mode": "both",
                    "enabled": False,
                    "task_tags": "bugfix",
                },
            ],
        },
    }
    ui_settings = {"supervisor_model_mode": "task"}
    chosen = choose_model(
        config,
        _classification("low", task_type="bugfix"),
        ui_settings=ui_settings,
    )
    # Disabled entry skipped, no other catalog entries, no supervisor_model in
    # ui_settings -> auto path picks executor_default.
    assert chosen == DEFAULT_CONFIG["models"]["executor_default"]


def test_choose_model_handles_missing_executor_keys_with_defaults():
    config = {"models": {}}  # nothing configured
    chosen = choose_model(config, _classification("xhigh"))
    assert chosen == "gpt-5.5"  # the literal default in choose_model
