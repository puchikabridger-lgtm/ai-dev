"""Task classification and model selection helpers for aidev.

Extracted from aidev.py as part of issue #17 Stage 3. Pure refactor:
behavior is byte-equivalent to the prior inline definitions.
"""

from __future__ import annotations

import re
from typing import Any

# Fallback values used when callers don't provide a populated `config["models"]`.
# Kept in lockstep with `aidev.DEFAULT_CONFIG["models"]`; behavior-preserving copy.
_DEFAULT_MODELS: dict[str, Any] = {
    "supervisor": "gpt-5.4-mini",
    "router": "gpt-5.4-mini",
    "executor_default": "gpt-5.4-mini",
    "executor_complex": "gpt-5.4",
    "executor_max": "gpt-5.5",
    "catalog": [],
}


def classify_task(prompt: str, forced_reasoning: str | None = None) -> dict[str, Any]:
    if forced_reasoning in {"extra-high", "extra_high", "extra high"}:
        forced_reasoning = "xhigh"
    lower = prompt.lower()
    words = lower.split()
    def has_word(value: str) -> bool:
        return re.search(rf"\b{re.escape(value)}\b", lower) is not None

    def negated_near(value: str) -> bool:
        return re.search(rf"\b(without|no)\b(?:\W+\w+){{0,4}}\W+{re.escape(value)}\b", lower) is not None

    has_database_risk = ("database" in lower or "база данных" in lower) and not negated_near("database")
    has_auth_risk = any(k in lower for k in ["auth", "authentication", "login", "oauth", "аутентификац", "авторизац"]) and not (
        negated_near("auth") or negated_near("authentication") or negated_near("login")
    )
    has_security_risk = any(k in lower for k in ["security", "encrypted", "encryption", "payment"])
    has_migration_risk = any(k in lower for k in ["migration", "migrations", "миграц"])
    is_important = has_database_risk or has_auth_risk or has_security_risk or has_migration_risk
    ui_keywords = ["ui", "interface", "frontend", "css", "page", "dashboard", "visual", "button", "layout", "website"]
    ui_phrase_patterns = [r"client[-\s]side", r"\bweb client\b", r"\bdesktop client\b", r"\bmobile client\b", r"\bbrowser client\b"]
    is_ui = any(k in lower for k in ui_keywords) or any(re.search(p, lower) for p in ui_phrase_patterns)
    is_bug = any(k in lower for k in ["bug", "error", "fail", "fix", "traceback", "exception", "broken", "не работает", "ошибка"])
    is_easy_error = is_bug and any(k in lower for k in [
        "lint", "linter", "format", "formatter", "typo", "syntax", "semicolon", "import",
        "unused", "bracket", "quote", "прост", "легк", "линтер", "опечат", "скобк"
    ])
    is_narrow_error = is_bug and bool(
        re.search(r"\b(401|403|404|500|502|503|504)\b", lower)
        or re.search(r"\b(invalid_client|invalid_grant|invalid_token|access[_\s-]?denied|access blocked|unauthorized|forbidden)\b", lower)
        or re.search(r"\b(config|configuration|env|environment|credential|credentials|secret|token|key|api key)\b", lower)
    )
    is_small_edit = (
        any(k in lower for k in ["change", "rename", "replace", "поменя", "измени", "замени", "переменн"])
        or has_word("set")
    ) and len(words) <= 40
    is_tiny_create = (
        any(k in lower for k in ["hello world", "hello-world", "simple script", "small script"])
        or (any(k in lower for k in ["one file", "single file"]) and any(k in lower for k in ["create", "make", "code", "write", "создай", "напиши"]))
        or (not is_ui and any(k in lower for k in ["create", "make", "code", "write", "создай", "напиши"]) and len(words) <= 12)
    )
    has_arch_keyword = any(k in lower for k in [
        "architecture", "refactor",
        "full app", "server + client", "server and client", "client + server", "local network",
        "social platform", "архитектур", "база данных", "аутентификац", "авторизац"
    ])
    has_rewrite_keyword = has_word("rewrite") or "перепиш" in lower
    if is_narrow_error and not has_arch_keyword:
        is_arch = False
    else:
        is_arch = has_arch_keyword or is_important or (has_rewrite_keyword and len(words) > 14)
    if is_arch:
        is_tiny_create = False
    is_create = any(k in lower for k in ["create", "build", "make", "code", "сделай", "создай", "напиши программу"])
    is_fullstack = any(k in lower for k in ["server + client", "server and client", "fullstack", "full-stack", "backend and frontend"])
    is_sensitive = has_auth_risk or has_security_risk
    is_large_ui_build = is_ui and is_create and len(words) > 30
    is_whole_project = any(k in lower for k in [
        "entire project", "whole app", "whole project", "from scratch", "с нуля", "целый проект", "весь проект"
    ])
    is_hyper_complex = any(k in lower for k in [
        "hyper", "mega", "very complex", "extremely complex", "without limits", "гипер", "мега", "супер сложн"
    ])
    is_complex_important = is_important and (
        is_fullstack
        or is_whole_project
        or has_migration_risk
        or has_security_risk
        or has_arch_keyword
        or (has_database_risk and has_auth_risk)
        or (has_rewrite_keyword and not is_bug and len(words) > 10)
    )
    is_complex_normal = is_large_ui_build or is_whole_project or (is_create and len(words) > 35)
    if is_whole_project:
        is_tiny_create = False

    task_type = "general"
    if is_arch:
        task_type = "architecture"
    elif is_tiny_create:
        task_type = "small_create"
    elif is_ui:
        task_type = "ui"
    elif is_bug:
        task_type = "bugfix"
    elif is_small_edit:
        task_type = "small_edit"
    elif is_create or is_fullstack:
        task_type = "feature"

    if forced_reasoning:
        reasoning = forced_reasoning
    elif (is_easy_error or is_small_edit or is_tiny_create) and not is_important and not is_arch:
        reasoning = "none"
    elif is_hyper_complex and is_important:
        reasoning = "xhigh"
    elif is_hyper_complex:
        reasoning = "high"
    elif is_complex_important:
        reasoning = "high"
    elif is_important:
        reasoning = "medium"
    elif is_arch or is_complex_normal:
        reasoning = "medium"
    elif is_bug or is_ui or is_create:
        reasoning = "low"
    else:
        reasoning = "low"

    if forced_reasoning is None and is_hyper_complex and is_important:
        reasoning = "xhigh"

    complexity = {"none": "none", "low": "low", "medium": "medium", "high": "high", "xhigh": "extra_high"}[reasoning]
    needs_plan = reasoning in {"high", "xhigh"} or is_ui or is_arch
    risk = "low" if reasoning in {"none", "low"} else "medium" if reasoning == "medium" else "high"

    return {
        "task_type": task_type,
        "complexity": complexity,
        "reasoning": reasoning,
        "risk": risk,
        "needs_plan": needs_plan,
        "is_ui": is_ui,
        "is_tiny_create": is_tiny_create,
        "requires_approval": reasoning in {"high", "xhigh"},
    }


def choose_model(
    config: dict[str, Any],
    classification: dict[str, Any],
    forced_model: str | None = None,
    ui_settings: dict[str, Any] | None = None,
) -> str:
    if forced_model:
        return normalize_model_name(forced_model)
    models = config.get("models", _DEFAULT_MODELS)
    ui_settings = ui_settings or {}
    mode = str(ui_settings.get("supervisor_model_mode") or "auto").lower()
    manual_model = str(ui_settings.get("supervisor_manual_model") or "").strip()
    task_type = str(classification.get("task_type") or "").lower()
    reasoning_tag = str(classification.get("reasoning") or "").lower()
    catalog = model_catalog_from(config, ui_settings)
    if mode == "manual" and manual_model:
        return normalize_model_name(manual_model)
    if mode == "task":
        fallback_model = ""
        for item in catalog:
            if not item["enabled"]:
                continue
            if item["mode"] not in {"both", "supervisor", "any"}:
                continue
            tags = set(item["task_tags"])
            if task_type and task_type in tags:
                return normalize_model_name(item["model"])
            if reasoning_tag and reasoning_tag in tags:
                return normalize_model_name(item["model"])
            if "*" in tags or "any" in tags or "default" in tags:
                fallback_model = fallback_model or item["model"]
        if fallback_model:
            return fallback_model
        supervisor_default = str(ui_settings.get("supervisor_model") or "").strip()
        if supervisor_default:
            return normalize_model_name(supervisor_default)
    reasoning = classification["reasoning"]
    if reasoning == "xhigh":
        return normalize_model_name(models.get("executor_max", "gpt-5.5"))
    if reasoning in {"medium", "high"}:
        return normalize_model_name(models.get("executor_complex", "gpt-5.4"))
    return normalize_model_name(models.get("executor_default", "gpt-5.4-mini"))


def normalize_model_name(model: str) -> str:
    value = str(model or "").strip()
    if value == "gpt-5.4-pro":
        return "gpt-5.5"
    return value


def supervisor_policy(config: dict[str, Any]) -> dict[str, str]:
    supervisor = config.get("supervisor", {})
    models = config.get("models", _DEFAULT_MODELS)
    return {
        "model": supervisor.get("model") or models.get("supervisor") or models.get("router") or "gpt-5.4-mini",
        "reasoning": supervisor.get("reasoning") or "low",
    }


def normalize_tags(value: Any) -> list[str]:
    if isinstance(value, str):
        items = value.split(",")
    elif isinstance(value, list):
        items = value
    else:
        return []
    return [str(item).strip().lower() for item in items if str(item).strip()]


def model_catalog_from(config: dict[str, Any], ui_settings: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    catalog: list[dict[str, Any]] = []
    sources: list[list[Any]] = []
    if ui_settings and isinstance(ui_settings.get("model_catalog"), list):
        sources.append(ui_settings["model_catalog"])
    if isinstance(config.get("models", {}).get("catalog"), list):
        sources.append(config["models"]["catalog"])
    for source in sources:
        for item in source:
            if not isinstance(item, dict):
                continue
            model = str(item.get("model") or item.get("name") or "").strip()
            if not model:
                continue
            catalog.append({
                "id": str(item.get("id") or model),
                "label": str(item.get("label") or model),
                "model": model,
                "provider": str(item.get("provider") or "openai"),
                "reasoning": str(item.get("reasoning") or "medium"),
                "mode": str(item.get("mode") or "both").lower(),
                "enabled": bool(item.get("enabled", True)),
                "task_tags": normalize_tags(item.get("task_tags") or item.get("taskTags") or []),
            })
    return catalog
