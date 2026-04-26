// Integration tests for listRuns() ordering.
//
// listRuns reads runs from `<projectRoot>/.ai/runs/`. We point projectRoot at a
// temp fixture dir by writing the desktop settings.json before each test, then
// clean up. The settings.json path lives under `.ai/desktop/` which is
// gitignored at the repo root, so this never touches tracked files.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const main = require("./_loader.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SETTINGS_FILE = path.join(REPO_ROOT, ".ai", "desktop", "settings.json");
const SETTINGS_BACKUP = `${SETTINGS_FILE}.test-backup`;


function backupSettings() {
  if (fs.existsSync(SETTINGS_FILE) && !fs.existsSync(SETTINGS_BACKUP)) {
    fs.copyFileSync(SETTINGS_FILE, SETTINGS_BACKUP);
  }
}

function restoreSettings() {
  if (fs.existsSync(SETTINGS_BACKUP)) {
    fs.copyFileSync(SETTINGS_BACKUP, SETTINGS_FILE);
    fs.unlinkSync(SETTINGS_BACKUP);
  } else if (fs.existsSync(SETTINGS_FILE)) {
    // No prior settings.json existed; remove the one we created.
    fs.unlinkSync(SETTINGS_FILE);
  }
}

function pointSettingsAt(projectRoot) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify({ projectRoot }, null, 2) + "\n",
    "utf8",
  );
}

function writeRun(runsDir, runId, { contractCreatedAt, taskType = "general", reasoning = "low", status = "ok", model = "gpt-5.4-mini" } = {}) {
  const runDir = path.join(runsDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "contract.json"),
    JSON.stringify({
      created_at: contractCreatedAt,
      classification: { task_type: taskType, reasoning },
      model,
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(runDir, "audit.json"),
    JSON.stringify({ status }),
    "utf8",
  );
  fs.writeFileSync(path.join(runDir, "request.md"), `request body for ${runId}`, "utf8");
  return runDir;
}

function makeFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "main-tests-listRuns-"));
  fs.mkdirSync(path.join(tmp, ".ai", "runs"), { recursive: true });
  return tmp;
}


test("listRuns sorts newer contract.created_at first", (t) => {
  backupSettings();
  const fixture = makeFixture();
  pointSettingsAt(fixture);
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    restoreSettings();
  });

  const runsDir = path.join(fixture, ".ai", "runs");
  writeRun(runsDir, "20260101-100000-001-aaaaaa", { contractCreatedAt: "2026-01-01T10:00:00Z" });
  writeRun(runsDir, "20260301-100000-001-bbbbbb", { contractCreatedAt: "2026-03-01T10:00:00Z" });
  writeRun(runsDir, "20260201-100000-001-cccccc", { contractCreatedAt: "2026-02-01T10:00:00Z" });

  const runs = main.listRuns();
  const ids = runs.map((r) => r.id);
  assert.deepEqual(ids, [
    "20260301-100000-001-bbbbbb",
    "20260201-100000-001-cccccc",
    "20260101-100000-001-aaaaaa",
  ]);
});

test("listRuns surfaces taskType / reasoning / model from contract", (t) => {
  backupSettings();
  const fixture = makeFixture();
  pointSettingsAt(fixture);
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    restoreSettings();
  });

  const runsDir = path.join(fixture, ".ai", "runs");
  writeRun(runsDir, "20260301-100000-001-bbbbbb", {
    contractCreatedAt: "2026-03-01T10:00:00Z",
    taskType: "ui",
    reasoning: "medium",
    model: "gpt-5.5",
    status: "completed",
  });

  const runs = main.listRuns();
  assert.equal(runs.length, 1);
  const [run] = runs;
  assert.equal(run.taskType, "ui");
  assert.equal(run.reasoning, "medium");
  assert.equal(run.model, "gpt-5.5");
  assert.equal(run.status, "completed");
});

test("listRuns falls back to dir mtime when contract has no created_at", (t) => {
  backupSettings();
  const fixture = makeFixture();
  pointSettingsAt(fixture);
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    restoreSettings();
  });

  const runsDir = path.join(fixture, ".ai", "runs");
  const dir1 = writeRun(runsDir, "20260101-100000-001-aaaaaa", { contractCreatedAt: undefined });
  const dir2 = writeRun(runsDir, "20260201-100000-001-bbbbbb", { contractCreatedAt: undefined });

  // Force dir1 mtime older, dir2 mtime newer.
  const now = Date.now();
  fs.utimesSync(dir1, new Date(now - 60_000), new Date(now - 60_000));
  fs.utimesSync(dir2, new Date(now), new Date(now));

  const runs = main.listRuns();
  const ids = runs.map((r) => r.id);
  assert.deepEqual(ids, [
    "20260201-100000-001-bbbbbb",
    "20260101-100000-001-aaaaaa",
  ]);
});

test("listRuns ties broken deterministically by run id descending", (t) => {
  backupSettings();
  const fixture = makeFixture();
  pointSettingsAt(fixture);
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    restoreSettings();
  });

  const runsDir = path.join(fixture, ".ai", "runs");
  // All three share the same created_at AND we'll force the same mtime, so the
  // tie-breaker (id descending via localeCompare) decides.
  const ts = "2026-04-26T10:00:00Z";
  const dir1 = writeRun(runsDir, "20260426-100000-001-aaaaaa", { contractCreatedAt: ts });
  const dir2 = writeRun(runsDir, "20260426-100000-001-bbbbbb", { contractCreatedAt: ts });
  const dir3 = writeRun(runsDir, "20260426-100000-001-cccccc", { contractCreatedAt: ts });
  const fixedMtime = new Date("2026-04-26T10:00:00Z");
  fs.utimesSync(dir1, fixedMtime, fixedMtime);
  fs.utimesSync(dir2, fixedMtime, fixedMtime);
  fs.utimesSync(dir3, fixedMtime, fixedMtime);

  const runs = main.listRuns();
  const ids = runs.map((r) => r.id);
  assert.deepEqual(ids, [
    "20260426-100000-001-cccccc",
    "20260426-100000-001-bbbbbb",
    "20260426-100000-001-aaaaaa",
  ]);
});

test("listRuns returns empty array when runs dir is missing", (t) => {
  backupSettings();
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "main-tests-listRuns-empty-"));
  pointSettingsAt(fixture);
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    restoreSettings();
  });

  const runs = main.listRuns();
  assert.deepEqual(runs, []);
});
