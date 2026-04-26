"""Budget, cost estimation, token accounting, and ledger helpers.

Extracted from aidev.py as Stage 2 of the #17 refactor. Pure refactor:
all behavior is preserved; aidev.py re-exports these names so existing
callers and tests keep working.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path
from typing import Any


SHARED_DIR = Path(__file__).parent.parent / "shared"
with (SHARED_DIR / "budget-defaults.json").open("r", encoding="utf-8") as _budget_file:
    DEFAULT_BUDGET: dict[str, Any] = json.load(_budget_file)


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


def session_estimated_spend(budget_dir: Path) -> float:
    ledger = budget_dir / "ledger.jsonl"
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


def daily_usage(budget_dir: Path) -> dict[str, int]:
    ledger = budget_dir / "ledger.jsonl"
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


def budget_check(cost: float, budget: dict[str, Any], classification: dict[str, Any], budget_dir: Path) -> dict[str, Any]:
    session_budget = float(budget.get("session_budget_usd", 5.0))
    request_budget = float(budget.get("request_budget_usd", 0.5))
    spent = session_estimated_spend(budget_dir)
    session_after = spent + cost
    session_percent = 100 * session_after / session_budget if session_budget else 100
    request_percent = 100 * cost / request_budget if request_budget else 100
    block_at = float(budget.get("block_at_percent", 95))
    warn_at = float(budget.get("warn_at_percent", 80))

    usage = daily_usage(budget_dir)
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


def append_ledger(run_id: str, model: str, classification: dict[str, Any], cost: float, budget_dir: Path) -> None:
    entry = {
        "run_id": run_id,
        "model": model,
        "reasoning": classification["reasoning"],
        "estimated_cost_usd": round(cost, 4),
        "created_at": dt.datetime.now().isoformat(timespec="seconds"),
    }
    budget_dir.mkdir(parents=True, exist_ok=True)
    with (budget_dir / "ledger.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
