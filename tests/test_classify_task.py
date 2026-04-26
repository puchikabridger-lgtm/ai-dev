"""Unit tests for aidev.classify_task.

Covers the rules captured in `.ai/rules/reasoning.md` and the regression cases
from issue #7 (narrow auth/OAuth errors must not get pulled up to architecture).
"""

import pytest

from aidev import classify_task


def test_typo_error_is_none_reasoning():
    result = classify_task("fix typo in README")
    assert result["reasoning"] == "none"
    assert result["task_type"] == "bugfix"
    assert result["requires_approval"] is False
    assert result["risk"] == "low"


def test_linter_error_is_none_reasoning():
    result = classify_task("fix linter error in app.py")
    assert result["reasoning"] == "none"
    assert result["task_type"] == "bugfix"


def test_small_rename_is_none():
    result = classify_task("rename helper to compute_total")
    assert result["reasoning"] == "none"
    assert result["task_type"] == "small_edit"


def test_tiny_create_is_none_reasoning():
    result = classify_task("write hello world script")
    assert result["reasoning"] == "none"
    assert result["task_type"] == "small_create"
    assert result["is_tiny_create"] is True


def test_plain_bug_falls_to_low():
    # Avoid UI keywords (page, button, dashboard, ...) so this stays a bugfix.
    # Includes a bug marker (`error`) without easy-error markers and without
    # small_edit verbs, so it should land on the bug branch with `low` reasoning.
    result = classify_task("we get a runtime error on startup, please investigate why")
    assert result["task_type"] == "bugfix"
    assert result["reasoning"] == "low"


def test_ui_request_classified_as_ui_with_low_or_medium_reasoning():
    result = classify_task("tweak the dashboard button color")
    assert result["is_ui"] is True
    assert result["task_type"] == "ui"
    assert result["reasoning"] in {"low", "medium"}
    assert result["needs_plan"] is True


def test_narrow_oauth_fix_is_medium_not_high():
    """Regression for #7: narrow OAuth/auth fixes must not get pulled to high.

    Per `.ai/rules/reasoning.md`, direct auth/OAuth/database/config fixes where
    the likely edit is narrow are `medium`, never automatically `high`.
    """
    result = classify_task("fix the oauth redirect url for staging")
    assert result["reasoning"] == "medium"
    assert result["requires_approval"] is False
    assert result["risk"] == "medium"


def test_narrow_database_config_fix_is_medium():
    result = classify_task("update the database connection string in config")
    assert result["reasoning"] == "medium"
    assert result["requires_approval"] is False


def test_complex_auth_and_database_rewrite_is_high():
    result = classify_task(
        "rewrite the entire authentication architecture and migrate the database schema"
    )
    assert result["reasoning"] in {"high", "xhigh"}
    assert result["requires_approval"] is True
    assert result["risk"] == "high"
    assert result["needs_plan"] is True


def test_hyper_complex_security_is_xhigh():
    result = classify_task(
        "build a hyper complex fullstack payment system with encryption from scratch"
    )
    assert result["reasoning"] == "xhigh"
    assert result["complexity"] == "extra_high"
    assert result["requires_approval"] is True


def test_architecture_keyword_pushes_to_medium_or_higher():
    result = classify_task("refactor the architecture of the rendering pipeline")
    assert result["task_type"] == "architecture"
    assert result["reasoning"] in {"medium", "high", "xhigh"}
    assert result["needs_plan"] is True


def test_negation_does_not_trigger_auth_risk():
    """`without auth` should not be treated as auth/security work."""
    result = classify_task("write a one-file demo without auth or login")
    # Without the auth flag, this should remain a tiny_create / small task,
    # not get pushed up to medium or higher.
    assert result["reasoning"] in {"none", "low"}
    assert result["requires_approval"] is False


def test_forced_reasoning_extra_high_normalizes_to_xhigh():
    for forced in ("extra-high", "extra_high", "extra high"):
        result = classify_task("simple task", forced_reasoning=forced)
        assert result["reasoning"] == "xhigh", forced
        assert result["complexity"] == "extra_high", forced


def test_forced_reasoning_overrides_classification():
    result = classify_task("fix typo", forced_reasoning="high")
    assert result["reasoning"] == "high"
    assert result["requires_approval"] is True


def test_classification_returns_required_keys():
    result = classify_task("anything")
    expected_keys = {
        "task_type",
        "complexity",
        "reasoning",
        "risk",
        "needs_plan",
        "is_ui",
        "is_tiny_create",
        "requires_approval",
    }
    assert expected_keys.issubset(result.keys())


@pytest.mark.parametrize(
    "reasoning,expected_risk",
    [
        ("none", "low"),
        ("low", "low"),
        ("medium", "medium"),
        ("high", "high"),
        ("xhigh", "high"),
    ],
)
def test_risk_mapping_for_each_reasoning(reasoning, expected_risk):
    result = classify_task("something", forced_reasoning=reasoning)
    assert result["risk"] == expected_risk


def test_russian_easy_error_with_bug_keyword_is_none_reasoning():
    """A Russian phrase that has both a bug marker (`ошибк`) and an easy-error
    marker (`опечат`) should hit the `is_easy_error` path and be `none`."""
    result = classify_task("ошибка опечатка в файле")
    assert result["reasoning"] == "none"
    assert result["task_type"] == "bugfix"


def test_russian_rename_is_small_edit_none():
    """Russian small-edit verb (`переименуй`/`переменная`) without bug markers
    still hits `is_small_edit` via the `переменн` stem."""
    result = classify_task("переменная rename")
    assert result["reasoning"] == "none"
    assert result["task_type"] == "small_edit"
