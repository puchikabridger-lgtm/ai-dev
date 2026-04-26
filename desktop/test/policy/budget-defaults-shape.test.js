const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const SHARED_FILE = path.resolve(__dirname, "..", "..", "..", "shared", "budget-defaults.json");

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

console.log("budget-defaults shared JSON:");

test("file exists at the expected repo-root location", () => {
  assert.ok(fs.existsSync(SHARED_FILE), `missing: ${SHARED_FILE}`);
});

test("parses as JSON without errors", () => {
  JSON.parse(fs.readFileSync(SHARED_FILE, "utf8"));
});

test("policy.js loads the shared file as its DEFAULT_BUDGET", () => {
  const fromPolicy = require("../../src/policy").DEFAULT_BUDGET;
  const fromDisk = JSON.parse(fs.readFileSync(SHARED_FILE, "utf8"));
  assert.deepEqual(fromPolicy, fromDisk, "policy.DEFAULT_BUDGET must equal the shared JSON contents");
});

test("has the required top-level keys", () => {
  const cfg = require(SHARED_FILE);
  const required = [
    "session_budget_usd",
    "request_budget_usd",
    "retry_budget_usd",
    "max_codex_calls_per_request",
    "daily_codex_call_limit",
    "daily_high_call_limit",
    "daily_xhigh_call_limit",
    "warn_at_percent",
    "block_at_percent",
    "estimated_call_cost_usd",
    "model_token_prices_usd_per_1m",
  ];
  for (const key of required) {
    assert.ok(Object.prototype.hasOwnProperty.call(cfg, key), `missing key: ${key}`);
  }
});

test("session and request budgets are positive numbers", () => {
  const cfg = require(SHARED_FILE);
  assert.equal(typeof cfg.session_budget_usd, "number");
  assert.ok(cfg.session_budget_usd > 0, "session cap must be > 0");
  assert.equal(typeof cfg.request_budget_usd, "number");
  assert.ok(cfg.request_budget_usd > 0, "request cap must be > 0");
});

test("warn_at_percent < block_at_percent and both are <= 100", () => {
  const cfg = require(SHARED_FILE);
  assert.ok(cfg.warn_at_percent < cfg.block_at_percent, "warn must come before block");
  assert.ok(cfg.block_at_percent <= 100, "block_at_percent should be <= 100");
});

test("estimated_call_cost_usd has every reasoning tier", () => {
  const cfg = require(SHARED_FILE);
  for (const tier of ["none", "low", "medium", "high", "xhigh"]) {
    assert.ok(typeof cfg.estimated_call_cost_usd[tier] === "number", `missing tier cost: ${tier}`);
    assert.ok(cfg.estimated_call_cost_usd[tier] >= 0, `tier cost ${tier} must be >= 0`);
  }
});

test("model_token_prices_usd_per_1m entries each have input + output rates", () => {
  const cfg = require(SHARED_FILE);
  const models = Object.keys(cfg.model_token_prices_usd_per_1m);
  assert.ok(models.length > 0, "at least one model must be priced");
  for (const model of models) {
    const price = cfg.model_token_prices_usd_per_1m[model];
    assert.equal(typeof price.input, "number", `${model}.input must be a number`);
    assert.equal(typeof price.output, "number", `${model}.output must be a number`);
    assert.ok(price.input >= 0, `${model}.input must be >= 0`);
    assert.ok(price.output >= 0, `${model}.output must be >= 0`);
  }
});

if (failed) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll budget-defaults shape tests passed.");
