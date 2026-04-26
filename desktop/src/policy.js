const fs = require("fs");
const path = require("path");

const DEFAULT_BUDGET = {
  session_budget_usd: 5.0,
  request_budget_usd: 0.5,
  retry_budget_usd: 0.15,
  max_codex_calls_per_request: 2,
  daily_codex_call_limit: 20,
  daily_high_call_limit: 3,
  daily_xhigh_call_limit: 1,
  warn_at_percent: 80,
  block_at_percent: 95,
  estimated_call_cost_usd: {
    none: 0.01,
    low: 0.03,
    medium: 0.08,
    high: 0.25,
    xhigh: 0.6,
  },
  model_token_prices_usd_per_1m: {
    "gpt-5.4-mini": { input: 0.75, cached_input: 0.075, output: 4.5 },
    "gpt-5.4": { input: 2.5, cached_input: 0.25, output: 15.0 },
    "gpt-5.5": { input: 2.5, cached_input: 0.25, output: 15.0 },
    "gpt-5.4-nano": { input: 0.2, cached_input: 0.02, output: 1.25 },
  },
};

const REQUIRES_APPROVAL = new Set(["high", "xhigh"]);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function budgetFile(projectAiDir) {
  return path.join(projectAiDir, "budget", "budget.json");
}

function ledgerFile(projectAiDir) {
  return path.join(projectAiDir, "budget", "ledger.jsonl");
}

function loadBudget(projectAiDir) {
  const fromDisk = readJson(budgetFile(projectAiDir), {});
  return {
    ...DEFAULT_BUDGET,
    ...fromDisk,
    estimated_call_cost_usd: { ...DEFAULT_BUDGET.estimated_call_cost_usd, ...(fromDisk.estimated_call_cost_usd || {}) },
    model_token_prices_usd_per_1m: { ...DEFAULT_BUDGET.model_token_prices_usd_per_1m, ...(fromDisk.model_token_prices_usd_per_1m || {}) },
  };
}

function ledgerEntries(projectAiDir) {
  const file = ledgerFile(projectAiDir);
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {}
  }
  return out;
}

function sessionEstimatedSpend(projectAiDir) {
  let total = 0;
  for (const entry of ledgerEntries(projectAiDir)) {
    const value = Number(entry?.estimated_cost_usd);
    if (Number.isFinite(value)) total += value;
  }
  return total;
}

function todayIsoDate(now) {
  const d = now instanceof Date ? now : new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dailyUsage(projectAiDir, now) {
  const today = todayIsoDate(now);
  const usage = { total: 0, high: 0, xhigh: 0 };
  for (const entry of ledgerEntries(projectAiDir)) {
    const created = String(entry?.created_at || "");
    if (!created.startsWith(today)) continue;
    usage.total += 1;
    if (entry?.reasoning === "high") usage.high += 1;
    if (entry?.reasoning === "xhigh") usage.xhigh += 1;
  }
  return usage;
}

function modelTokenPrice(model, budget) {
  const table = budget.model_token_prices_usd_per_1m || DEFAULT_BUDGET.model_token_prices_usd_per_1m;
  const lower = String(model || "").toLowerCase();
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lower.includes(key.toLowerCase())) return table[key];
  }
  return null;
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.max(1, Math.floor(String(text).length / 4));
}

function expectedOutputTokens(reasoning) {
  return {
    none: 300,
    low: 800,
    medium: 1800,
    high: 4000,
    xhigh: 8000,
  }[reasoning] || 1200;
}

function estimateRequestCost({ model, reasoning, promptText, budget }) {
  const cfg = budget || DEFAULT_BUDGET;
  const price = modelTokenPrice(model, cfg);
  const inputTokens = estimateTokens(promptText);
  const outputTokens = expectedOutputTokens(reasoning);
  if (price) {
    const longCtx = String(model || "").toLowerCase().includes("gpt-5.4") && inputTokens > 272000;
    const inputMul = longCtx ? 2 : 1;
    const outputMul = longCtx ? 1.5 : 1;
    const usd = ((inputTokens * Number(price.input || 0) * inputMul) + (outputTokens * Number(price.output || 0) * outputMul)) / 1_000_000;
    if (usd > 0) return Number(usd.toFixed(6));
  }
  const tier = (cfg.estimated_call_cost_usd || {})[reasoning];
  return Number(((Number.isFinite(tier) ? tier : 0.08)).toFixed(6));
}

function budgetCheck({ cost, budget, reasoning, projectAiDir, now }) {
  const sessionBudget = Number(budget.session_budget_usd) || 0;
  const requestBudget = Number(budget.request_budget_usd) || 0;
  const spent = sessionEstimatedSpend(projectAiDir);
  const sessionAfter = spent + cost;
  const sessionPercent = sessionBudget ? (100 * sessionAfter) / sessionBudget : 100;
  const requestPercent = requestBudget ? (100 * cost) / requestBudget : 100;
  const blockAt = Number(budget.block_at_percent) || 95;
  const warnAt = Number(budget.warn_at_percent) || 80;

  const usage = dailyUsage(projectAiDir, now);
  const dailyLimit = Number(budget.daily_codex_call_limit) || 0;
  const highLimit = Number(budget.daily_high_call_limit) || 0;
  const xhighLimit = Number(budget.daily_xhigh_call_limit) || 0;
  let callLimitBlocked = dailyLimit > 0 && usage.total >= dailyLimit;
  if (reasoning === "high" && highLimit > 0) callLimitBlocked = callLimitBlocked || usage.high >= highLimit;
  if (reasoning === "xhigh" && xhighLimit > 0) callLimitBlocked = callLimitBlocked || usage.xhigh >= xhighLimit;

  const blocked = sessionPercent >= blockAt || requestPercent >= blockAt || callLimitBlocked;
  const warning = sessionPercent >= warnAt || requestPercent >= warnAt;
  return {
    estimated_cost_usd: Number(cost.toFixed(4)),
    session_spent_before_usd: Number(spent.toFixed(4)),
    session_after_usd: Number(sessionAfter.toFixed(4)),
    session_percent_after: Number(sessionPercent.toFixed(2)),
    request_percent: Number(requestPercent.toFixed(2)),
    daily_usage: usage,
    daily_limits: { total: dailyLimit, high: highLimit, xhigh: xhighLimit },
    call_limit_blocked: callLimitBlocked,
    blocked,
    warning,
  };
}

function requiresApproval(reasoning) {
  return REQUIRES_APPROVAL.has(String(reasoning || "").toLowerCase());
}

function preflight({
  projectAiDir,
  model,
  reasoning,
  promptText,
  budgetGuard = true,
  approvalGranted = false,
  forceBudget = false,
  now,
}) {
  const budget = loadBudget(projectAiDir);
  const cost = estimateRequestCost({ model, reasoning, promptText, budget });
  const status = budgetCheck({ cost, budget, reasoning, projectAiDir, now });
  const needsApproval = requiresApproval(reasoning);
  if (budgetGuard && status.blocked && !forceBudget) {
    return {
      ok: false,
      blocked: "budget",
      reason: "blocked_by_budget",
      error: status.call_limit_blocked
        ? `Blocked by daily call limit (${status.daily_usage.total}/${status.daily_limits.total}).`
        : `Blocked by budget guard (request ${status.request_percent}% / session ${status.session_percent_after}%).`,
      budgetStatus: status,
      requiresApproval: needsApproval,
    };
  }
  if (needsApproval && !approvalGranted) {
    return {
      ok: false,
      blocked: "approval",
      reason: "blocked_by_approval",
      error: `Reasoning level "${reasoning}" requires explicit approval.`,
      budgetStatus: status,
      requiresApproval: true,
    };
  }
  return {
    ok: true,
    budgetStatus: status,
    requiresApproval: needsApproval,
  };
}

function appendLedger(projectAiDir, { runId, model, reasoning, cost, now }) {
  const file = ledgerFile(projectAiDir);
  ensureDir(path.dirname(file));
  const entry = {
    run_id: String(runId || ""),
    model: String(model || ""),
    reasoning: String(reasoning || ""),
    estimated_cost_usd: Number(Number(cost || 0).toFixed(4)),
    created_at: (now instanceof Date ? now : new Date()).toISOString().replace(/\.\d{3}Z$/, ""),
  };
  fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

module.exports = {
  DEFAULT_BUDGET,
  loadBudget,
  preflight,
  budgetCheck,
  estimateRequestCost,
  sessionEstimatedSpend,
  dailyUsage,
  appendLedger,
  requiresApproval,
};
