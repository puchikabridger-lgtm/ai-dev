#!/usr/bin/env python3
"""
Local AI development orchestrator for Codex.

Default behavior is safe: create a task contract and run record without spending
money. Use --execute to call `codex exec`.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import textwrap
import time
import uuid
from pathlib import Path
from typing import Any


def initial_project_root() -> Path:
    argv = sys.argv[1:]
    if "--project" in argv:
        index = argv.index("--project")
        if index + 1 < len(argv):
            return Path(argv[index + 1]).expanduser().resolve()
    env_root = os.environ.get("AIDEV_PROJECT_ROOT", "").strip()
    if env_root:
        return Path(env_root).expanduser().resolve()
    return Path.cwd().resolve()


ROOT = initial_project_root()
AI_DIR = ROOT / ".ai"
CONFIG_DIR = AI_DIR / "config"
RULES_DIR = AI_DIR / "rules"
PROJECT_DIR = AI_DIR / "project"
SUMMARIES_DIR = AI_DIR / "summaries"
RUNS_DIR = AI_DIR / "runs"
BUDGET_DIR = AI_DIR / "budget"


DEFAULT_CONFIG: dict[str, Any] = {
    "version": 1,
    "backend": {
        "default": "codex_cli",
        "codex_cli_command": "codex",
        "sandbox": "workspace-write",
        "skip_git_repo_check": True,
        "timeout_seconds": 1800
    },
    "models": {
        "supervisor": "gpt-5.4-mini",
        "router": "gpt-5.4-mini",
        "executor_default": "gpt-5.4-mini",
        "executor_complex": "gpt-5.4",
        "executor_max": "gpt-5.5",
        "catalog": []
    },
    "supervisor": {
        "model": "gpt-5.4-mini",
        "reasoning": "low"
    },
    "reasoning": {
        "default": "none",
        "prefer": ["none", "low", "medium"],
        "requires_approval": ["high", "xhigh"]
    },
    "approval": {
        "ask_for_high": True,
        "ask_for_xhigh": True,
        "remember_approvals": True
    },
    "execution": {
        "default_execute": False,
        "max_changed_files_low": 3,
        "max_changed_files_medium": 12,
        "max_auto_retries": 1
    }
}


DEFAULT_BUDGET: dict[str, Any] = {
    "session_budget_usd": 5.0,
    "request_budget_usd": 0.50,
    "retry_budget_usd": 0.15,
    "max_codex_calls_per_request": 2,
    "daily_codex_call_limit": 20,
    "daily_high_call_limit": 3,
    "daily_xhigh_call_limit": 1,
    "warn_at_percent": 80,
    "block_at_percent": 95,
    "estimated_call_cost_usd": {
        "none": 0.01,
        "low": 0.03,
        "medium": 0.08,
        "high": 0.25,
        "xhigh": 0.60
    },
    "model_token_prices_usd_per_1m": {
        "gpt-5.4-mini": {"input": 0.75, "cached_input": 0.075, "output": 4.50, "source": "OpenAI model docs, checked 2026-04-26"},
        "gpt-5.4": {"input": 2.50, "cached_input": 0.25, "output": 15.00, "source": "OpenAI model docs, checked 2026-04-26"},
        "gpt-5.5": {"input": 2.50, "cached_input": 0.25, "output": 15.00, "source": "temporary GPT-5.4-compatible estimate until verified pricing is configured"},
        "gpt-5.4-nano": {"input": 0.20, "cached_input": 0.02, "output": 1.25, "source": "OpenAI model docs, checked 2026-04-26"}
    }
}


DEFAULT_RULES = {
    "global.md": """# Global Rules

- User intent has priority over model assumptions.
- Prefer the cheapest reliable model and lowest useful reasoning level.
- Use `none`, `low`, or `medium` by default.
- Ask before using `high` or `extra high`.
- Do not perform unrelated refactors, renames, formatting, or dependency changes.
- If the task scope is unclear, ask before editing.
""",
    "project.md": """# Project Rules

- Keep changes scoped to the current user request.
- Preserve existing project style and structure.
- Update `.ai` summaries only after code changes are complete.
""",
    "reasoning.md": """# Reasoning Routing Rules

- Use `none` for easy mechanical tasks: fix a simple linter/syntax/formatting error, change or rename a variable, change a constant or label, fix a typo, add/remove a bracket, paste a small snippet, answer from visible context, or make a one-line/single-obvious edit.
- Use `low` for medium/simple engineering tasks with local judgment: ordinary small bugfixes, small text/code changes, single-file examples, hello-world/simple scripts when they need minor choices, direct file creation, and questions that need brief inspection but no deep project analysis.
- Use `medium` for complex normal work and easy important work: small-to-moderate features, UI builds/tweaks, modest multi-file changes, non-risky architecture cleanup, small projects, and direct auth/OAuth/database/config fixes where the likely edit is narrow.
- Use `high` for complex important work or hyper-complex normal work: database schema/migrations, auth architecture, security/payment/encryption work, full projects from scratch, broad behavior changes, large rewrites, or ambiguous work where mistakes are likely.
- Use `extra high` (`xhigh` internally) only when work is both hyper-complex and important: fullstack plus persistence plus auth/security, production-critical systems, very broad tasks with high blast radius, or work that combines extreme complexity with database/auth/security risk.
- Never choose `high` or `extra high` just because the task mentions auth, OAuth, database, or "rewrite". First decide whether the likely change is narrow (`medium`) or broad/risky (`high`/`xhigh`).
""",
    "ui.md": """# UI Rules

- Build the actual usable interface, not a placeholder landing page, unless requested.
- Check mobile and desktop layout for overflow, clipping, and overlap.
- Prefer DOM, console, accessibility, and structured text checks before vision checks.
- Use screenshots as validation, not as the main data format.
""",
    "learned.md": """# Learned Rules

Rules learned from user corrections will be appended here.
"""
}


def now_id() -> str:
    now = dt.datetime.now()
    stamp = now.strftime("%Y%m%d-%H%M%S")
    millis = f"{now.microsecond // 1000:03d}"
    return f"{stamp}-{millis}-{uuid.uuid4().hex[:6]}"


def read_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return dict(default)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return dict(default)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def deep_merge_defaults(value: Any, defaults: Any) -> Any:
    if isinstance(defaults, dict):
        base = value if isinstance(value, dict) else {}
        merged = dict(base)
        for key, default_value in defaults.items():
            merged[key] = deep_merge_defaults(base.get(key), default_value)
        return merged
    return defaults if value is None else value


def run_cmd(args: list[str], cwd: Path = ROOT, input_text: str | None = None, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(cwd),
        input=input_text,
        text=True,
        capture_output=True,
        timeout=timeout,
        shell=False,
    )


def has_git() -> bool:
    git = shutil.which("git")
    if not git:
        return False
    result = run_cmd([git, "rev-parse", "--is-inside-work-tree"], timeout=20)
    return result.returncode == 0 and result.stdout.strip() == "true"


def ensure_workspace() -> None:
    for path in [CONFIG_DIR, RULES_DIR, PROJECT_DIR, SUMMARIES_DIR, RUNS_DIR, BUDGET_DIR]:
        path.mkdir(parents=True, exist_ok=True)

    config_path = CONFIG_DIR / "project.json"
    if not config_path.exists():
        write_json(config_path, DEFAULT_CONFIG)
    else:
        write_json(config_path, deep_merge_defaults(read_json(config_path, {}), DEFAULT_CONFIG))

    budget_path = BUDGET_DIR / "budget.json"
    if not budget_path.exists():
        write_json(budget_path, DEFAULT_BUDGET)
    else:
        write_json(budget_path, deep_merge_defaults(read_json(budget_path, {}), DEFAULT_BUDGET))

    for name, body in DEFAULT_RULES.items():
        target = RULES_DIR / name
        if not target.exists():
            target.write_text(body, encoding="utf-8")

    for name, body in {
        "overview.md": "# Project Overview\n\nNot discovered yet. Run `python aidev.py init`.\n",
        "architecture.md": "# Architecture\n\nNot discovered yet.\n",
        "commands.md": "# Commands\n\nNot discovered yet.\n",
        "file-index.json": "{}\n",
    }.items():
        target = PROJECT_DIR / name
        if not target.exists():
            target.write_text(body, encoding="utf-8")


def detect_package_manager() -> str | None:
    if (ROOT / "pnpm-lock.yaml").exists():
        return "pnpm"
    if (ROOT / "yarn.lock").exists():
        return "yarn"
    if (ROOT / "package-lock.json").exists():
        return "npm"
    if (ROOT / "package.json").exists():
        return "npm"
    if (ROOT / "pyproject.toml").exists():
        return "python"
    if (ROOT / "requirements.txt").exists():
        return "python"
    return None


def detect_commands() -> dict[str, str | None]:
    package_json = ROOT / "package.json"
    if package_json.exists():
        data = read_json(package_json, {})
        scripts = data.get("scripts", {}) if isinstance(data.get("scripts"), dict) else {}
        pm = detect_package_manager() or "npm"
        run_prefix = "pnpm" if pm == "pnpm" else "yarn" if pm == "yarn" else "npm run"
        return {
            "dev": f"{run_prefix} dev" if "dev" in scripts else None,
            "build": f"{run_prefix} build" if "build" in scripts else None,
            "test": f"{run_prefix} test" if "test" in scripts else None,
            "lint": f"{run_prefix} lint" if "lint" in scripts else None,
        }
    if (ROOT / "pyproject.toml").exists() or (ROOT / "requirements.txt").exists():
        return {"dev": None, "build": None, "test": "python -m pytest", "lint": None}
    return {"dev": None, "build": None, "test": None, "lint": None}


def bootstrap() -> dict[str, Any]:
    ensure_workspace()
    codex = shutil.which("codex")
    discovered = {
        "root": str(ROOT),
        "has_git": has_git(),
        "codex_cli": codex,
        "package_manager": detect_package_manager(),
        "commands": detect_commands(),
        "detected_at": dt.datetime.now().isoformat(timespec="seconds"),
    }

    overview = textwrap.dedent(f"""\
    # Project Overview

    Root: `{discovered["root"]}`
    Git repository: `{discovered["has_git"]}`
    Package manager: `{discovered["package_manager"]}`
    Codex CLI: `{discovered["codex_cli"]}`
    """)
    (PROJECT_DIR / "overview.md").write_text(overview, encoding="utf-8")

    commands = ["# Commands", ""]
    for key, value in discovered["commands"].items():
        commands.append(f"- {key}: `{value}`")
    (PROJECT_DIR / "commands.md").write_text("\n".join(commands) + "\n", encoding="utf-8")

    write_json(CONFIG_DIR / "discovered.json", discovered)
    return discovered


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
    models = config.get("models", DEFAULT_CONFIG["models"])
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
    models = config.get("models", DEFAULT_CONFIG["models"])
    return {
        "model": supervisor.get("model") or models.get("supervisor") or models.get("router") or "gpt-5.4-mini",
        "reasoning": supervisor.get("reasoning") or "low",
    }


def load_rules() -> dict[str, str]:
    rules = {}
    global_dir = os.environ.get("AIDEV_GLOBAL_RULES_DIR", "").strip()
    if global_dir:
        global_path = Path(global_dir)
        if global_path.exists():
            for path in sorted(global_path.glob("*.md")):
                rules[f"global/{path.name}"] = path.read_text(encoding="utf-8")
    for path in sorted(RULES_DIR.glob("*.md")):
        if path.name in {"global.md", "learned.md"} and global_dir:
            continue
        rules[path.name] = path.read_text(encoding="utf-8")
    return rules


def estimate_cost(classification: dict[str, Any], budget: dict[str, Any]) -> float:
    table = budget.get("estimated_call_cost_usd", DEFAULT_BUDGET["estimated_call_cost_usd"])
    return float(table.get(classification["reasoning"], table.get("medium", 0.08)))


def model_token_price(model: str, budget: dict[str, Any]) -> dict[str, Any] | None:
    table = budget.get("model_token_prices_usd_per_1m", DEFAULT_BUDGET["model_token_prices_usd_per_1m"])
    lower = model.lower()
    for key in sorted(table, key=len, reverse=True):
        if key.lower() in lower:
            return dict(table[key])
    return None


def estimate_token_cost(model: str, input_tokens: int, output_tokens: int, budget: dict[str, Any]) -> dict[str, Any]:
    price = model_token_price(model, budget)
    if not price:
        return {"estimated_usd": 0.0, "actual_usd": None, "source": "no_model_price", "confidence": "unknown"}
    input_rate = float(price.get("input") or 0)
    output_rate = float(price.get("output") or 0)
    multiplier_input = 2.0 if ("gpt-5.4" in model.lower() and input_tokens > 272000) else 1.0
    multiplier_output = 1.5 if ("gpt-5.4" in model.lower() and input_tokens > 272000) else 1.0
    usd = ((input_tokens * input_rate * multiplier_input) + (output_tokens * output_rate * multiplier_output)) / 1_000_000
    return {
        "estimated_usd": round(usd, 6),
        "actual_usd": None,
        "source": "token_price_estimate",
        "confidence": "high" if price else "unknown",
        "rates_per_1m": {
            "input": input_rate,
            "cached_input": float(price.get("cached_input") or 0),
            "output": output_rate,
        },
        "pricing_source": price.get("source", "configured"),
        "long_context_multiplier": {"input": multiplier_input, "output": multiplier_output},
    }


def estimated_output_tokens_for_reasoning(reasoning: str) -> int:
    return {
        "none": 300,
        "low": 800,
        "medium": 1800,
        "high": 4000,
        "xhigh": 8000,
    }.get(reasoning, 1200)


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, int(len(text) / 4))


def model_context_limit(model: str) -> int:
    lower = model.lower()
    if "gpt-5" in lower:
        return 128000
    if "gpt-4.1" in lower:
        return 1047576
    if "gpt-4o" in lower:
        return 128000
    return 128000


def extract_cli_token_usage(stdout: str, stderr: str) -> dict[str, Any]:
    text = "\n".join([stdout or "", stderr or ""])
    usage: dict[str, Any] = {"source": "estimate"}
    patterns = {
        "input_tokens": r"(?:input|prompt)\s+tokens?\D+([0-9][0-9,]*)",
        "output_tokens": r"(?:output|completion)\s+tokens?\D+([0-9][0-9,]*)",
        "total_tokens": r"total\s+tokens?\D+([0-9][0-9,]*)",
    }
    for key, pattern in patterns.items():
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            usage[key] = int(match.group(1).replace(",", ""))
            usage["source"] = "codex_cli"
    return usage


def build_usage_report(
    model: str,
    reasoning: str,
    prompt_text: str,
    codex_result: dict[str, Any] | None,
    estimated_cost: float,
    phase_seconds: dict[str, float],
    budget: dict[str, Any] | None = None,
) -> dict[str, Any]:
    stdout = str((codex_result or {}).get("stdout", ""))
    stderr = str((codex_result or {}).get("stderr", ""))
    last_message = str((codex_result or {}).get("last_message", ""))
    parsed = extract_cli_token_usage(stdout, stderr)
    input_tokens = int(parsed.get("input_tokens") or estimate_tokens(prompt_text))
    output_tokens = int(parsed.get("output_tokens") or estimate_tokens("\n".join([stdout, stderr, last_message])))
    total_tokens = int(parsed.get("total_tokens") or input_tokens + output_tokens)
    context_limit = model_context_limit(model)
    total_duration = float(phase_seconds.get("total") or sum(phase_seconds.values()))
    token_cost = estimate_token_cost(model, input_tokens, output_tokens, budget or DEFAULT_BUDGET)
    if parsed.get("source") == "codex_cli":
        token_cost["actual_usd"] = token_cost["estimated_usd"]
        token_cost["source"] = "codex_cli_tokens_x_configured_price"
    if not token_cost.get("estimated_usd"):
        token_cost["estimated_usd"] = round(estimated_cost, 4)
        token_cost["source"] = "reasoning_tier_fallback"
    return {
        "model": model,
        "reasoning": reasoning,
        "phase_seconds": {key: round(value, 3) for key, value in phase_seconds.items()},
        "duration_seconds": round(total_duration, 3),
        "tokens": {
            "input": input_tokens,
            "output": output_tokens,
            "total": total_tokens,
            "source": parsed.get("source", "estimate"),
        },
        "context": {
            "limit_tokens": context_limit,
            "used_tokens": input_tokens,
            "used_percent": round((100 * input_tokens / context_limit) if context_limit else 0, 2),
        },
        "cost": {
            **token_cost,
            "tier_fallback_usd": round(estimated_cost, 4),
        },
        "io": {
            "prompt_chars": len(prompt_text),
            "stdout_chars": len(stdout),
            "stderr_chars": len(stderr),
            "last_message_chars": len(last_message),
        },
    }


def session_estimated_spend() -> float:
    ledger = BUDGET_DIR / "ledger.jsonl"
    if not ledger.exists():
        return 0.0
    total = 0.0
    for line in ledger.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            total += float(json.loads(line).get("estimated_cost_usd", 0))
        except (json.JSONDecodeError, TypeError, ValueError):
            continue
    return total


def daily_usage() -> dict[str, int]:
    ledger = BUDGET_DIR / "ledger.jsonl"
    today = dt.datetime.now().date().isoformat()
    usage = {"total": 0, "high": 0, "xhigh": 0}
    if not ledger.exists():
        return usage
    for line in ledger.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        created = str(entry.get("created_at", ""))
        if not created.startswith(today):
            continue
        usage["total"] += 1
        reasoning = entry.get("reasoning")
        if reasoning == "high":
            usage["high"] += 1
        if reasoning == "xhigh":
            usage["xhigh"] += 1
    return usage


def budget_check(cost: float, budget: dict[str, Any], classification: dict[str, Any]) -> dict[str, Any]:
    session_budget = float(budget.get("session_budget_usd", 5.0))
    request_budget = float(budget.get("request_budget_usd", 0.5))
    spent = session_estimated_spend()
    session_after = spent + cost
    session_percent = 100 * session_after / session_budget if session_budget else 100
    request_percent = 100 * cost / request_budget if request_budget else 100
    block_at = float(budget.get("block_at_percent", 95))
    warn_at = float(budget.get("warn_at_percent", 80))

    usage = daily_usage()
    daily_limit = int(budget.get("daily_codex_call_limit", 20))
    high_limit = int(budget.get("daily_high_call_limit", 3))
    xhigh_limit = int(budget.get("daily_xhigh_call_limit", 1))
    call_limit_blocked = usage["total"] >= daily_limit
    if classification["reasoning"] == "high":
        call_limit_blocked = call_limit_blocked or usage["high"] >= high_limit
    if classification["reasoning"] == "xhigh":
        call_limit_blocked = call_limit_blocked or usage["xhigh"] >= xhigh_limit

    blocked = session_percent >= block_at or request_percent >= block_at or call_limit_blocked
    warning = session_percent >= warn_at or request_percent >= warn_at
    return {
        "estimated_cost_usd": round(cost, 4),
        "session_spent_before_usd": round(spent, 4),
        "session_after_usd": round(session_after, 4),
        "session_percent_after": round(session_percent, 2),
        "request_percent": round(request_percent, 2),
        "daily_usage": usage,
        "daily_limits": {
            "total": daily_limit,
            "high": high_limit,
            "xhigh": xhigh_limit,
        },
        "call_limit_blocked": call_limit_blocked,
        "blocked": blocked,
        "warning": warning,
    }


def parse_ui_settings(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


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


def build_contract(
    prompt: str,
    classification: dict[str, Any],
    model: str,
    budget_status: dict[str, Any],
    feature_flags: dict[str, Any] | None = None,
    supervisor: dict[str, str] | None = None,
) -> dict[str, Any]:
    feature = str((feature_flags or {}).get("request_feature") or "auto")
    forbidden = [
        "unrequested architecture refactors",
        "unrequested dependency changes",
        "unrelated formatting churn",
        "renaming unrelated symbols",
        "editing files outside the task scope",
        "continuing after validation fails without reporting the failure",
    ]
    allowed = ["read relevant files", "edit files required for the direct request", "run relevant checks"]
    if feature == "plan":
        allowed = ["read relevant files", "produce a technical implementation plan"]
        forbidden.extend(["editing files", "running code changes", "claiming implementation is complete"])
    if feature == "todolist":
        allowed.extend(["split work into ordered stages", "verify each stage before moving to the next", "stop when a stage cannot be verified"])
        forbidden.append("doing later stages before earlier stages are verified")
    if classification["is_ui"]:
        allowed.extend(["run UI checks", "capture DOM/console/screenshot evidence when useful"])
        forbidden.append("marking UI work done without mobile and desktop sanity checks")

    enhanced_prompt = build_enhanced_prompt(prompt, classification, allowed, forbidden, feature)

    return {
        "user_request": prompt,
        "enhanced_prompt": enhanced_prompt,
        "classification": classification,
        "supervisor": supervisor or {},
        "model": model,
        "allowed_actions": allowed,
        "forbidden_actions": forbidden,
        "technical_prompt": build_technical_prompt(prompt, classification, allowed, forbidden, feature),
        "success_criteria": [
            "the direct user request is satisfied",
            "changes stay inside the task scope",
            "relevant checks pass or failures are reported",
            "changed files are summarized when useful",
        ],
        "rollback_criteria": [
            "changed files exceed the expected task scope",
            "validation fails after a risky or broad change",
            "the implementation changes unrelated behavior",
            "Codex reports uncertainty about a destructive edit after making changes",
        ],
        "stage_policy": {
            "mode": feature,
            "requires_todo_stages": feature == "todolist",
            "verify_each_stage": feature == "todolist",
        },
        "feature_flags": feature_flags or {},
        "budget": budget_status,
        "created_at": dt.datetime.now().isoformat(timespec="seconds"),
    }


def build_enhanced_prompt(
    prompt: str,
    classification: dict[str, Any],
    allowed: list[str],
    forbidden: list[str],
    feature: str = "auto",
) -> str:
    task_type = classification.get("task_type", "general")
    reasoning = classification.get("reasoning", "low")
    needs_plan = classification.get("needs_plan", False)
    lines = [
        f"User request: {prompt}",
        "",
        f"Interpret this as a {task_type} task.",
        f"Use {reasoning} reasoning.",
    ]
    if feature == "todolist":
        lines.append("Start with a concrete TODO list of stages. Execute stages in order. After each stage, verify before moving on.")
    elif feature == "plan":
        lines.append("Return a technical plan only. Do not edit files.")
    elif needs_plan:
        lines.append("Start by forming a concise implementation plan before editing.")
    else:
        lines.append("Keep the change direct and avoid unnecessary planning text.")
    lines.extend([
        "",
        "Do exactly what the user asked for. If the request implies creating code, create or modify the needed project files instead of only returning a snippet.",
        "Use the existing project structure and style. Inspect relevant files before editing.",
        "If execution goes out of scope, validation fails, or a risky edit was made, stop and explicitly write ROLLBACK_REQUIRED with the reason.",
        "",
        "Allowed actions:",
        *[f"- {item}" for item in allowed],
        "",
        "Do not:",
        *[f"- {item}" for item in forbidden],
        "",
        "Success criteria:",
        "- the requested behavior exists in the project",
        "- no unrelated files are changed",
        "- important changes and checks are reported clearly",
    ])
    if classification.get("is_ui"):
        lines.extend([
            "",
            "UI-specific requirements:",
            "- build the actual usable interface, not a placeholder page",
            "- check obvious responsive/layout problems",
            "- avoid clipped text, overlap, tiny controls, and decorative-only UI",
        ])
    if classification.get("is_tiny_create"):
        lines.extend([
            "",
            "Tiny task handling:",
            "- keep the implementation minimal",
            "- do not scan or redesign the whole project",
            "- create the requested file directly when the target is clear",
        ])
    return "\n".join(lines)


def build_technical_prompt(
    prompt: str,
    classification: dict[str, Any],
    allowed: list[str],
    forbidden: list[str],
    feature: str,
) -> str:
    lines = [
        "Technical supervisor prompt",
        f"User intent: {prompt}",
        f"Task type: {classification.get('task_type', 'general')}",
        f"Reasoning: {classification.get('reasoning', 'low')}",
        f"Workflow feature: {feature}",
        "",
        "What to do:",
        "- inspect only files relevant to the request",
        "- keep changes minimal and tied to the requested outcome",
        "- preserve existing architecture, naming, style, and public behavior unless the request requires changing them",
        "- run or recommend the most relevant validation command",
        *[f"- {item}" for item in allowed],
        "",
        "What not to do:",
        "- do not broaden scope",
        "- do not rewrite unrelated modules",
        "- do not add dependencies unless there is no simpler local option",
        "- do not hide failed checks",
        *[f"- {item}" for item in forbidden],
        "",
        "Rollback trigger:",
        "- if changed files are unrelated or too broad, report ROLLBACK_REQUIRED",
        "- if checks fail and the fix is not obvious, report ROLLBACK_REQUIRED",
        "- if the implementation likely damages existing behavior, report ROLLBACK_REQUIRED",
    ]
    if feature == "todolist":
        lines.extend([
            "",
            "Staged TODO workflow:",
            "1. Write the TODO stages before editing.",
            "2. Complete exactly one stage at a time.",
            "3. Verify that stage.",
            "4. Continue only if verification is acceptable.",
            "5. In the final response, report each stage as done/failed/skipped.",
        ])
    if feature == "plan":
        lines.extend([
            "",
            "Planning-only workflow:",
            "- produce a plan with stages, files likely affected, validation, and risks",
            "- do not edit files",
        ])
    return "\n".join(lines)


def get_git_state() -> dict[str, str | bool]:
    if not has_git():
        return {"has_git": False, "status": "", "diff": ""}
    git = shutil.which("git") or "git"
    status = run_cmd([git, "status", "--porcelain"], timeout=60)
    diff = run_cmd([git, "diff", "--binary"], timeout=120)
    return {
        "has_git": True,
        "status": status.stdout,
        "diff": diff.stdout,
    }


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


SNAPSHOT_IGNORED_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    "dist",
    "build",
}

SNAPSHOT_IGNORED_PATHS = {
    ".ai/runs",
    ".ai/desktop/settings.json",
    ".ai/desktop/secrets.json",
    ".ai/desktop/terminal-history.json",
    ".ai/budget/ledger.jsonl",
}

SNAPSHOT_IGNORED_EXTENSIONS = {".log", ".tmp", ".bak"}


def is_snapshot_ignored(rel: str) -> bool:
    normalized = rel.replace("\\", "/").strip("/")
    if not normalized:
        return False
    parts = normalized.split("/")
    if not parts:
        return False
    if normalized in SNAPSHOT_IGNORED_PATHS:
        return True
    if any(normalized.startswith(f"{path}/") for path in SNAPSHOT_IGNORED_PATHS):
        return True
    if Path(normalized).suffix.lower() in SNAPSHOT_IGNORED_EXTENSIONS:
        return True
    return any(part in SNAPSHOT_IGNORED_DIRS for part in parts)


def snapshot_files() -> dict[str, str]:
    result: dict[str, str] = {}
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT).as_posix()
        if is_snapshot_ignored(rel):
            continue
        result[rel] = file_hash(path)
    return result


def backup_before_files(run_dir: Path, before_snapshot: dict[str, str]) -> None:
    backup_dir = run_dir / "before-files"
    for rel in before_snapshot:
        if is_snapshot_ignored(rel):
            continue
        source = ROOT / rel
        if not source.is_file():
            continue
        target = backup_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(source, target)
        except OSError:
            pass


def changed_files(before_snapshot: dict[str, str]) -> list[str]:
    after = snapshot_files()
    all_names = set(before_snapshot) | set(after)
    return sorted(name for name in all_names if before_snapshot.get(name) != after.get(name))


def rules_digest(rules: dict[str, str], classification: dict[str, Any]) -> str:
    base = [
        "Obey the user request exactly.",
        "Prefer minimal edits and no unrelated refactors.",
        "Do not rename, reformat, add dependencies, or broaden scope unless required.",
        "If the task is unclear or needs broader work, stop and explain.",
    ]
    reasoning = classification.get("reasoning")
    if reasoning in {"high", "xhigh"}:
        base.append("For high-risk work, make a concise plan before editing.")
    if classification.get("is_ui"):
        base.extend([
            "For UI work, build the usable interface and check obvious layout issues.",
            "Avoid clipped text, overlap, tiny controls, and placeholder-only screens.",
        ])
    learned = rules.get("learned.md", "").strip()
    learned_lines = [
        line.strip("- ").strip()
        for line in learned.splitlines()
        if line.strip().startswith("-")
    ][:4]
    base.extend(learned_lines)
    return "\n".join(f"- {item}" for item in base)


def compact_task_brief(contract: dict[str, Any]) -> str:
    classification = contract.get("classification", {})
    budget = contract.get("budget", {})
    return "\n".join([
        f"Task type: {classification.get('task_type', 'general')}",
        f"Reasoning: {classification.get('reasoning', 'medium')}",
        f"Model: {contract.get('model', 'unknown')}",
        f"Risk: {classification.get('risk', 'medium')}",
        f"Needs plan: {'yes' if classification.get('needs_plan') else 'no'}",
        f"Estimated request budget: {budget.get('request_percent', 'unknown')}%",
    ])


def tier_limits(reasoning: str) -> dict[str, int]:
    return {
        "none": {"prompt": 1400, "rules": 500},
        "low": {"prompt": 1800, "rules": 700},
        "medium": {"prompt": 3600, "rules": 1000},
        "high": {"prompt": 7000, "rules": 1400},
        "xhigh": {"prompt": 9500, "rules": 1800},
    }.get(reasoning, {"prompt": 3600, "rules": 1000})


def trim_chars(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 80)].rstrip() + "\n...[trimmed to keep prompt compact]"


def build_codex_prompt(contract: dict[str, Any], rules: dict[str, str]) -> str:
    classification = contract.get("classification", {})
    reasoning = str(classification.get("reasoning", "low"))
    limits = tier_limits(reasoning)
    digest = trim_chars(rules_digest(rules, classification), limits["rules"])
    enhanced = contract.get("enhanced_prompt", contract.get("user_request", ""))
    technical = contract.get("technical_prompt", "")
    allowed = "\n".join(f"- {item}" for item in contract.get("allowed_actions", []))
    forbidden = "\n".join(f"- {item}" for item in contract.get("forbidden_actions", []))
    rollback = "\n".join(f"- {item}" for item in contract.get("rollback_criteria", []))

    technical_limit = 320 if reasoning == "none" else 420 if reasoning == "low" else max(900, limits["prompt"] // 3)
    sections = [
        "You are Codex executing one supervised local task.",
        "",
        "TASK",
        trim_chars(enhanced, max(700, limits["prompt"] // 2)),
        "",
        "SETTINGS",
        compact_task_brief(contract),
        "",
        "RULES",
        digest,
        "",
        "TECHNICAL PROMPT",
        trim_chars(technical, technical_limit),
    ]

    if reasoning in {"none", "low"}:
        sections.extend([
            "",
            "SCOPE",
            "Allowed:",
            allowed,
            "Forbidden:",
            forbidden,
        ])
    elif reasoning in {"medium", "high", "xhigh"}:
        sections.extend([
            "",
            "SCOPE",
            "Allowed:",
            allowed,
            "Forbidden:",
            forbidden,
            "Rollback required if:",
            rollback,
        ])

    if contract.get("stage_policy", {}).get("requires_todo_stages"):
        sections.extend([
            "",
            "TODO STAGE CONTRACT",
            "- Start by writing the staged TODO list.",
            "- Execute stages sequentially.",
            "- Verify each stage before continuing.",
            "- Stop on failed verification and report ROLLBACK_REQUIRED if rollback is safer than continuing.",
        ])

    if reasoning in {"high", "xhigh"}:
        compact_contract = {
            "user_request": contract.get("user_request"),
            "classification": classification,
            "model": contract.get("model"),
            "budget": contract.get("budget"),
        }
        sections.extend([
            "",
            "CONTRACT SUMMARY",
            json.dumps(compact_contract, indent=2, ensure_ascii=False),
        ])

    sections.extend([
        "",
        "FINAL RESPONSE",
        "- what changed",
        "- files changed",
        "- checks run",
        "- if the user asked for a run command, server command, usage command, or next command, include the exact command to run",
        "- rollback needed? yes/no and why",
        "- remaining risk, if any",
    ])
    return trim_chars("\n".join(str(section) for section in sections if section is not None), limits["prompt"])


def approval_allowed(classification: dict[str, Any], assume_yes: bool) -> bool:
    if not classification["requires_approval"]:
        return True
    if assume_yes:
        return True
    if not sys.stdin.isatty():
        return False
    answer = input(f"Task requires {classification['reasoning']} reasoning. Approve? [y/N] ").strip().lower()
    return answer in {"y", "yes", "да", "d"}


def append_ledger(run_id: str, model: str, classification: dict[str, Any], cost: float) -> None:
    entry = {
        "run_id": run_id,
        "model": model,
        "reasoning": classification["reasoning"],
        "estimated_cost_usd": round(cost, 4),
        "created_at": dt.datetime.now().isoformat(timespec="seconds"),
    }
    with (BUDGET_DIR / "ledger.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")


def execute_codex(prompt: str, run_dir: Path, config: dict[str, Any], model: str) -> dict[str, Any]:
    command = config.get("backend", {}).get("codex_cli_command", "codex")
    executable = shutil.which(command)
    if not executable:
        return {"ok": False, "error": f"`{command}` was not found in PATH"}

    last_message = run_dir / "codex-last-message.md"
    args = [
        executable,
        "exec",
        "-",
        "--cd",
        str(ROOT),
        "-m",
        model,
        "-s",
        config.get("backend", {}).get("sandbox", "workspace-write"),
        "--output-last-message",
        str(last_message),
    ]
    if config.get("backend", {}).get("skip_git_repo_check", True):
        args.append("--skip-git-repo-check")

    timeout = int(config.get("backend", {}).get("timeout_seconds", 1800))
    started = time.perf_counter()
    stdout_parts: list[str] = []
    stderr_parts: list[str] = []

    def pump(pipe: Any, target: Any, parts: list[str]) -> None:
        try:
            for line in iter(pipe.readline, ""):
                if not line:
                    break
                parts.append(line)
                target.write(line)
                target.flush()
        finally:
            try:
                pipe.close()
            except Exception:
                pass

    try:
        process = subprocess.Popen(
            args,
            cwd=str(ROOT),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            shell=False,
        )
        stdout_thread = threading.Thread(target=pump, args=(process.stdout, sys.stdout, stdout_parts), daemon=True)
        stderr_thread = threading.Thread(target=pump, args=(process.stderr, sys.stderr, stderr_parts), daemon=True)
        stdout_thread.start()
        stderr_thread.start()
        if process.stdin:
            try:
                process.stdin.write(prompt)
                process.stdin.close()
            except BrokenPipeError:
                pass
        returncode = process.wait(timeout=timeout)
        stdout_thread.join(timeout=2)
        stderr_thread.join(timeout=2)
    except subprocess.TimeoutExpired:
        try:
            process.kill()  # type: ignore[name-defined]
        except Exception:
            pass
        return {"ok": False, "error": f"Codex timed out after {timeout} seconds", "duration_seconds": round(time.perf_counter() - started, 3)}
    duration = time.perf_counter() - started

    stdout_text = "".join(stdout_parts)
    stderr_text = "".join(stderr_parts)
    (run_dir / "codex-stdout.txt").write_text(stdout_text, encoding="utf-8")
    (run_dir / "codex-stderr.txt").write_text(stderr_text, encoding="utf-8")
    last_message_text = last_message.read_text(encoding="utf-8") if last_message.exists() else ""
    return {
        "ok": returncode == 0,
        "returncode": returncode,
        "last_message_path": str(last_message) if last_message.exists() else None,
        "duration_seconds": round(duration, 3),
        "stdout": stdout_text,
        "stderr": stderr_text,
        "last_message": last_message_text,
    }


def audit_run(contract: dict[str, Any], files: list[str], codex_result: dict[str, Any]) -> dict[str, Any]:
    if contract.get("feature_flags", {}).get("scope_guard") is False:
        return {
            "status": "pass" if codex_result.get("ok") else "needs_review",
            "changed_files": files,
            "scope_warnings": [],
            "codex_ok": codex_result.get("ok"),
            "codex_returncode": codex_result.get("returncode"),
            "scope_guard": "disabled",
            "created_at": dt.datetime.now().isoformat(timespec="seconds"),
        }

    reasoning = contract["classification"]["reasoning"]
    max_low = DEFAULT_CONFIG["execution"]["max_changed_files_low"]
    max_medium = DEFAULT_CONFIG["execution"]["max_changed_files_medium"]
    scope_warnings: list[str] = []
    rollback_requested = "ROLLBACK_REQUIRED" in str(codex_result.get("last_message", ""))

    if reasoning in {"none", "low"} and len(files) > max_low:
        scope_warnings.append(f"{reasoning.capitalize()}-reasoning task changed {len(files)} files; expected at most {max_low}.")
    if reasoning == "medium" and len(files) > max_medium:
        scope_warnings.append(f"Medium task changed {len(files)} files; expected at most {max_medium}.")
    if any(path.startswith(".ai/runs/") for path in files):
        scope_warnings.append("Run artifacts changed during task execution.")
    if rollback_requested:
        scope_warnings.append("Codex requested rollback in final response.")

    return {
        "status": "rollback_requested" if rollback_requested else "pass" if codex_result.get("ok") and not scope_warnings else "needs_review",
        "changed_files": files,
        "scope_warnings": scope_warnings,
        "rollback_requested": rollback_requested,
        "codex_ok": codex_result.get("ok"),
        "codex_returncode": codex_result.get("returncode"),
        "created_at": dt.datetime.now().isoformat(timespec="seconds"),
    }


def command_init(_: argparse.Namespace) -> int:
    discovered = bootstrap()
    print("AI workspace initialized.")
    print(f"Root: {discovered['root']}")
    print(f"Codex CLI: {discovered['codex_cli']}")
    print(f"Package manager: {discovered['package_manager']}")
    return 0


def command_run(args: argparse.Namespace) -> int:
    run_started = time.perf_counter()
    phase_seconds: dict[str, float] = {}

    def measure_phase(name: str, func):
        started = time.perf_counter()
        try:
            return func()
        finally:
            phase_seconds[name] = phase_seconds.get(name, 0.0) + (time.perf_counter() - started)

    ensure_workspace()
    config = read_json(CONFIG_DIR / "project.json", DEFAULT_CONFIG)
    budget = read_json(BUDGET_DIR / "budget.json", DEFAULT_BUDGET)
    ui_settings = parse_ui_settings(args.ui_settings)

    prompt = " ".join(args.prompt).strip()
    if not prompt:
        print("No prompt provided.", file=sys.stderr)
        return 2

    classification = measure_phase("classify", lambda: classify_task(prompt, args.reasoning))
    model = measure_phase("choose_model", lambda: choose_model(config, classification, args.model, ui_settings))
    cost = measure_phase("estimate_budget", lambda: estimate_cost(classification, budget))
    budget_status = measure_phase("budget_check", lambda: budget_check(cost, budget, classification))
    feature_flags = {
        "budget_guard": not args.no_budget_guard,
        "scope_guard": not args.no_scope_guard,
        **ui_settings,
    }
    supervisor = supervisor_policy(config)
    if str(ui_settings.get("supervisor_reasoning") or "").strip():
        supervisor["reasoning"] = str(ui_settings["supervisor_reasoning"]).strip()
    contract = measure_phase("build_contract", lambda: build_contract(prompt, classification, model, budget_status, feature_flags, supervisor))
    rules = measure_phase("load_rules", load_rules)

    run_id = now_id()
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=False)

    write_json(run_dir / "contract.json", contract)
    (run_dir / "request.md").write_text(prompt + "\n", encoding="utf-8")
    codex_prompt = measure_phase("build_prompt", lambda: build_codex_prompt(contract, rules))
    (run_dir / "prompt.md").write_text(codex_prompt, encoding="utf-8")
    prompt_input_tokens = estimate_tokens(codex_prompt)
    prompt_output_tokens = estimated_output_tokens_for_reasoning(classification["reasoning"])
    token_preflight_cost = estimate_token_cost(model, prompt_input_tokens, prompt_output_tokens, budget)
    if token_preflight_cost.get("source") != "no_model_price":
        cost = float(token_preflight_cost.get("estimated_usd") or cost)
        budget_status = measure_phase("budget_check_token", lambda: budget_check(cost, budget, classification))
        contract["budget"] = budget_status
        contract["preflight_cost"] = {
            **token_preflight_cost,
            "input_tokens": prompt_input_tokens,
            "output_tokens": prompt_output_tokens,
        }
        write_json(run_dir / "contract.json", contract)

    print(f"Run: {run_id}")
    print(f"Task type: {classification['task_type']}")
    print(f"Supervisor: {supervisor['model']} ({supervisor['reasoning']})")
    print(f"Reasoning: {classification['reasoning']}")
    print(f"Model: {model}")
    if args.execute:
        print(f"Estimated cost: ${cost:.4f}")
        print(f"Budget request usage: {budget_status['request_percent']}%")
    else:
        print("Actual spend: $0.0000")
        print(f"Estimated if executed: ${cost:.4f}")
        print(f"Budget request usage if executed: {budget_status['request_percent']}%")

    if args.execute and feature_flags.get("budget_guard") is not False and budget_status["blocked"] and not args.force_budget:
        write_json(run_dir / "audit.json", {"status": "blocked_by_budget", "budget": budget_status})
        print("Blocked by budget guard. Use --force-budget only if you really want to continue.")
        return 3

    if args.execute and classification["requires_approval"] and not approval_allowed(classification, args.yes_high):
        write_json(run_dir / "audit.json", {"status": "blocked_by_approval", "classification": classification})
        print("Blocked: high/extra high reasoning requires user approval.")
        return 4

    if not args.execute:
        write_json(run_dir / "audit.json", {"status": "planned_only", "execute": False})
        phase_seconds["total"] = time.perf_counter() - run_started
        write_json(run_dir / "usage.json", build_usage_report(model, classification["reasoning"], codex_prompt, None, cost, phase_seconds, budget))
        print("Planned only. Re-run with --execute to call Codex.")
        print(f"Contract: {run_dir / 'contract.json'}")
        return 0

    before_git = measure_phase("git_before", get_git_state)
    before_snapshot = measure_phase("snapshot_before", snapshot_files)
    write_json(run_dir / "before-state.json", {"git": before_git, "files": before_snapshot})
    measure_phase("backup_before", lambda: backup_before_files(run_dir, before_snapshot))

    codex_result = measure_phase("codex_exec", lambda: execute_codex(codex_prompt, run_dir, config, model))
    if codex_result.get("duration_seconds") is not None:
        phase_seconds["codex_exec"] = float(codex_result["duration_seconds"])
    after_git = measure_phase("git_after", get_git_state)
    write_json(run_dir / "after-state.json", {"git": after_git})
    if after_git.get("diff"):
        (run_dir / "after-diff.patch").write_text(str(after_git["diff"]), encoding="utf-8")

    files = measure_phase("changed_files", lambda: changed_files(before_snapshot))
    audit = measure_phase("audit", lambda: audit_run(contract, files, codex_result))
    write_json(run_dir / "audit.json", audit)
    phase_seconds["total"] = time.perf_counter() - run_started
    usage_report = build_usage_report(model, classification["reasoning"], codex_prompt, codex_result, cost, phase_seconds, budget)
    write_json(run_dir / "usage.json", usage_report)
    append_ledger(run_id, model, classification, float(usage_report.get("cost", {}).get("actual_usd") or usage_report.get("cost", {}).get("estimated_usd") or cost))

    print(f"Codex ok: {codex_result.get('ok')}")
    print(f"Audit status: {audit['status']}")
    print(f"Changed files: {len(files)}")
    if audit["scope_warnings"]:
        print("Scope warnings:")
        for warning in audit["scope_warnings"]:
            print(f"- {warning}")
    print(f"Run folder: {run_dir}")
    return 0 if codex_result.get("ok") else 5


def command_latest(_: argparse.Namespace) -> int:
    ensure_workspace()
    runs = [p for p in RUNS_DIR.iterdir() if p.is_dir()]
    if not runs:
        print("No runs yet.")
        return 0
    runs.sort(key=lambda p: (p.stat().st_mtime_ns, p.name))
    latest = runs[-1]
    print(latest)
    audit = latest / "audit.json"
    if audit.exists():
        print(audit.read_text(encoding="utf-8"))
    return 0


def normalize_argv(argv: list[str]) -> list[str]:
    commands = {"init", "run", "latest"}
    if not argv:
        return ["init"]
    if argv[0] in commands or argv[0].startswith("-"):
        return argv
    return ["run"] + argv


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Local supervisor for Codex-oriented AI development.")
    parser.add_argument("--project", help="Project root. Can also be set with AIDEV_PROJECT_ROOT.")
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init", help="Initialize .ai workspace and auto-detect project settings.")
    init.add_argument("--project", help=argparse.SUPPRESS)
    init.set_defaults(func=command_init)

    run = sub.add_parser("run", help="Create a task contract and optionally execute Codex.")
    run.add_argument("--project", help=argparse.SUPPRESS)
    run.add_argument("prompt", nargs="*", help="User request.")
    run.add_argument("--execute", action="store_true", help="Actually run `codex exec`.")
    run.add_argument("--yes-high", action="store_true", help="Approve high/xhigh reasoning for this run.")
    run.add_argument("--force-budget", action="store_true", help="Bypass budget block for this run.")
    run.add_argument("--no-budget-guard", action="store_true", help="Disable budget guard for this run.")
    run.add_argument("--no-scope-guard", action="store_true", help="Disable scope guard warnings for this run.")
    run.add_argument("--ui-settings", help="JSON feature flags from a UI client.")
    run.add_argument("--model", help="Override executor model.")
    run.add_argument("--reasoning", choices=["none", "low", "medium", "high", "xhigh", "extra-high", "extra_high", "extra high"], help="Override reasoning level.")
    run.set_defaults(func=command_run)

    latest = sub.add_parser("latest", help="Print latest run folder and audit.")
    latest.add_argument("--project", help=argparse.SUPPRESS)
    latest.set_defaults(func=command_latest)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    ns = parser.parse_args(normalize_argv(argv or sys.argv[1:]))
    return int(ns.func(ns))


if __name__ == "__main__":
    raise SystemExit(main())
