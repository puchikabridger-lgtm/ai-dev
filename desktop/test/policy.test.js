const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const policy = require("../src/policy");

function tempProjectAi() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidev-policy-"));
  const aiDir = path.join(root, ".ai");
  fs.mkdirSync(path.join(aiDir, "budget"), { recursive: true });
  return { root, aiDir };
}

function writeBudget(aiDir, budget) {
  fs.writeFileSync(path.join(aiDir, "budget", "budget.json"), JSON.stringify(budget));
}

function writeLedger(aiDir, lines) {
  fs.writeFileSync(
    path.join(aiDir, "budget", "ledger.jsonl"),
    lines.map((line) => JSON.stringify(line)).join("\n") + (lines.length ? "\n" : ""),
  );
}

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

console.log("policy:");

test("preflight passes when budget is clean and reasoning is low", () => {
  const { aiDir } = tempProjectAi();
  const result = policy.preflight({
    projectAiDir: aiDir,
    model: "gpt-5.4-mini",
    reasoning: "low",
    promptText: "small task",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.requiresApproval, false);
});

test("preflight refuses high reasoning unless approval is granted", () => {
  const { aiDir } = tempProjectAi();
  const blocked = policy.preflight({
    projectAiDir: aiDir,
    model: "gpt-5.4-mini",
    reasoning: "high",
    promptText: "big task",
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocked, "approval");
  assert.equal(blocked.reason, "blocked_by_approval");

  const approved = policy.preflight({
    projectAiDir: aiDir,
    model: "gpt-5.4-mini",
    reasoning: "high",
    promptText: "big task",
    approvalGranted: true,
  });
  assert.equal(approved.ok, true);
});

test("preflight blocks when daily call limit reached", () => {
  const { aiDir } = tempProjectAi();
  writeBudget(aiDir, { daily_codex_call_limit: 2 });
  const today = new Date().toISOString().slice(0, 10);
  writeLedger(aiDir, [
    { run_id: "a", model: "m", reasoning: "low", estimated_cost_usd: 0.01, created_at: `${today}T00:00:00` },
    { run_id: "b", model: "m", reasoning: "low", estimated_cost_usd: 0.01, created_at: `${today}T00:00:01` },
  ]);
  const result = policy.preflight({
    projectAiDir: aiDir,
    model: "gpt-5.4-mini",
    reasoning: "low",
    promptText: "x",
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "budget");
  assert.equal(result.reason, "blocked_by_budget");
  assert.equal(result.budgetStatus.call_limit_blocked, true);
});

test("preflight blocks when session spend would exceed budget threshold", () => {
  const { aiDir } = tempProjectAi();
  writeBudget(aiDir, { session_budget_usd: 1.0, request_budget_usd: 5.0, block_at_percent: 95 });
  const today = new Date().toISOString().slice(0, 10);
  writeLedger(aiDir, [
    { run_id: "a", model: "m", reasoning: "low", estimated_cost_usd: 0.99, created_at: `${today}T00:00:00` },
  ]);
  const result = policy.preflight({
    projectAiDir: aiDir,
    model: "gpt-5.4-mini",
    reasoning: "low",
    promptText: "x".repeat(200),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "budget");
});

test("preflight respects budgetGuard:false (does not block on budget but still blocks on approval)", () => {
  const { aiDir } = tempProjectAi();
  writeBudget(aiDir, { daily_codex_call_limit: 1 });
  const today = new Date().toISOString().slice(0, 10);
  writeLedger(aiDir, [
    { run_id: "a", model: "m", reasoning: "low", estimated_cost_usd: 0.01, created_at: `${today}T00:00:00` },
  ]);
  const noBudget = policy.preflight({
    projectAiDir: aiDir,
    model: "gpt-5.4-mini",
    reasoning: "low",
    promptText: "x",
    budgetGuard: false,
  });
  assert.equal(noBudget.ok, true, JSON.stringify(noBudget));

  const stillNeedsApproval = policy.preflight({
    projectAiDir: aiDir,
    model: "gpt-5.4-mini",
    reasoning: "high",
    promptText: "x",
    budgetGuard: false,
  });
  assert.equal(stillNeedsApproval.ok, false);
  assert.equal(stillNeedsApproval.blocked, "approval");
});

test("preflight respects forceBudget override", () => {
  const { aiDir } = tempProjectAi();
  writeBudget(aiDir, { daily_codex_call_limit: 1 });
  const today = new Date().toISOString().slice(0, 10);
  writeLedger(aiDir, [
    { run_id: "a", model: "m", reasoning: "low", estimated_cost_usd: 0.01, created_at: `${today}T00:00:00` },
  ]);
  const result = policy.preflight({
    projectAiDir: aiDir,
    model: "gpt-5.4-mini",
    reasoning: "low",
    promptText: "x",
    forceBudget: true,
  });
  assert.equal(result.ok, true);
});

test("appendLedger writes a JSONL entry session spend can read", () => {
  const { aiDir } = tempProjectAi();
  policy.appendLedger(aiDir, { runId: "r1", model: "gpt-5.4-mini", reasoning: "low", cost: 0.05 });
  policy.appendLedger(aiDir, { runId: "r2", model: "gpt-5.4-mini", reasoning: "low", cost: 0.07 });
  assert.ok(Math.abs(policy.sessionEstimatedSpend(aiDir) - 0.12) < 1e-9);
});

test("dailyUsage counts today's entries by reasoning", () => {
  const { aiDir } = tempProjectAi();
  const today = new Date().toISOString().slice(0, 10);
  writeLedger(aiDir, [
    { run_id: "a", model: "m", reasoning: "low", estimated_cost_usd: 0.01, created_at: `${today}T00:00:00` },
    { run_id: "b", model: "m", reasoning: "high", estimated_cost_usd: 0.01, created_at: `${today}T00:01:00` },
    { run_id: "c", model: "m", reasoning: "high", estimated_cost_usd: 0.01, created_at: `${today}T00:02:00` },
    { run_id: "d", model: "m", reasoning: "xhigh", estimated_cost_usd: 0.01, created_at: `${today}T00:03:00` },
    { run_id: "e", model: "m", reasoning: "low", estimated_cost_usd: 0.01, created_at: "1990-01-01T00:00:00" },
  ]);
  const usage = policy.dailyUsage(aiDir);
  assert.equal(usage.total, 4, "older-day entry should not be counted");
  assert.equal(usage.high, 2);
  assert.equal(usage.xhigh, 1);
});

test("loadBudget merges defaults with on-disk values", () => {
  const { aiDir } = tempProjectAi();
  writeBudget(aiDir, { session_budget_usd: 20 });
  const merged = policy.loadBudget(aiDir);
  assert.equal(merged.session_budget_usd, 20);
  assert.equal(merged.daily_codex_call_limit, 20, "default daily limit should be preserved");
  assert.ok(merged.estimated_call_cost_usd.medium > 0, "default per-tier costs should be preserved");
});

test("requiresApproval flags high and xhigh", () => {
  assert.equal(policy.requiresApproval("none"), false);
  assert.equal(policy.requiresApproval("low"), false);
  assert.equal(policy.requiresApproval("medium"), false);
  assert.equal(policy.requiresApproval("high"), true);
  assert.equal(policy.requiresApproval("xhigh"), true);
});

if (failed) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll policy tests passed.");
