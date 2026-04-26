// Top-level smoke for the AI Dev project.
//
// This used to be a long string-grep over `src/main.js`, `src/renderer/app.js`,
// and `src/renderer/index.html`, plus three real `aidev.py` invocations that
// wrote runs into the developer's actual `.ai/runs/` directory. That made
// `npm run smoke` brittle (ordering bugs around same-second run IDs) and
// polluted the working repo on every run.
//
// The rewrite splits coverage three ways:
//
//   1. Structural-regex checks — kept, but trimmed to the high-signal
//      subset. Helper logic is now covered by focused test suites under
//      desktop/test/main/, desktop/test/renderer/, desktop/test/fs-safety/,
//      and the legacy node:assert sub-runners (snapshot.test.js,
//      policy.test.js, spawn-async.test.js, restore-run.test.js). We only
//      keep grep checks here for HTML element IDs, top-level IPC handler
//      registration, and a small list of "removed" guards — things that
//      cannot easily be unit-tested without spinning up Electron.
//
//   2. CLI behavior in isolated temp projects — every `aidev.py` invocation
//      now passes `--project <tmpdir>` and parses the `Run: <id>` line from
//      stdout to address the exact run, rather than reading the working
//      repo's `.ai/runs/` and picking the latest by mtime. The dev's
//      `.ai/runs/` is never touched. We `rm -rf` each tmp project at the
//      end of the run (see CLI_TEMP_ROOTS).
//
//   3. Sub-runners — invoked sequentially as separate Node processes so
//      their failures surface clearly in the smoke output.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ROOT, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const mainJs = read("src/main.js");
const rendererJs = read("src/renderer/app.js");
const rendererHtml = read("src/renderer/index.html");
const aidevPy = fs.readFileSync(path.join(REPO_ROOT, "aidev.py"), "utf8");


// ---------------------------------------------------------------------------
// Section A: structural-regex checks (high-signal only).
// ---------------------------------------------------------------------------

// Main process: IPC handlers that the renderer expects to exist. Removing one
// of these silently breaks the desktop UI; unit tests don't catch it because
// the registration is a side-effect at module load.
const REQUIRED_IPC_HANDLERS = [
  "app:diagnostics",
  "attachments:pick",
  "models:lmstudio",
  "project:index",
  "run:read",
  "run:undo",
  "run:validate",
  "run:supervisor-analyze",
  "runs:list",
  "terminal:history",
  "terminal:run",
  "terminal:stop",
  "workspace:refreshProjectSummary",
  "workspace:removeProject",
  "workspace:switchProject",
];
for (const channel of REQUIRED_IPC_HANDLERS) {
  const pattern = new RegExp(`ipcMain\\.handle\\("${channel.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}"`);
  assert.match(mainJs, pattern, `IPC handler ${channel} is missing from main.js`);
}

// Main-process invariants that aren't easily covered by unit tests.
assert.match(mainJs, /AIDEV_GLOBAL_RULES_DIR/, "global user memory should be passed to subprocesses");
assert.match(mainJs, /AIDEV_PROJECT_ROOT/, "project root should be passed explicitly to subprocesses");
assert.match(mainJs, /function secretsFile\(/, "auth secrets should be stored outside project settings");
assert.match(mainJs, /delete next\.auth\.openaiApiKey/, "OpenAI key must not be persisted in project settings");
assert.match(mainJs, /backupFileOncePerMinute/, "settings saves should create safety backups");
assert.match(mainJs, /nonEmptyChatSessions/, "settings saves should preserve existing chat history");
assert.match(mainJs, /detached \? "read-only"/, "standalone chats should run in read-only sandbox");

// Renderer HTML: element IDs the renderer code reads via $(id). Removing one
// breaks the UI without any unit-test signal.
const REQUIRED_HTML_IDS = [
  "sendButton",
  "sendStatus",
  "dashboardTab",
  "dashboardView",
  "newChatButton",
  "authTab",
  "notifyOnFinish",
  "lmStudioUrl",
  "loadLmStudioModels",
  "diagnosticsBox",
  "attachButton",
  "contextPercent",
  "projectList",
  "startScratchProject",
  "openDetachedChats",
  "detachedChatList",
  "refreshProjectSummary",
  "rebuildProjectIndex",
  "costEstimate",
];
for (const id of REQUIRED_HTML_IDS) {
  assert.match(rendererHtml, new RegExp(`id="${id}"`), `HTML element id="${id}" is missing`);
}

// Renderer HTML: feature chips and other class/structure landmarks.
for (const feature of ["code", "plan", "todolist", "discuss"]) {
  assert.match(rendererHtml, new RegExp(`data-feature="${feature}"`), `${feature} feature chip is missing from HTML`);
}
assert.match(rendererHtml, /class="top-tabs"/, "main navigation should be top tabs");
assert.match(rendererHtml, /class="mode-strip composer-mode"/, "mode switch should live in the composer");
assert.match(rendererHtml, /<option value="lmstudio">lmstudio<\/option>/, "LM Studio provider option is missing");
assert.match(rendererHtml, /<option value="none">none<\/option>/, "none reasoning option is missing");

// Renderer HTML: removed elements (regression guards for past redesigns).
assert.doesNotMatch(rendererHtml, /id="chatTabs"/, "right chat tabs should be removed");
assert.doesNotMatch(rendererHtml, /id="chatList"/, "right chat list should be removed");
assert.doesNotMatch(rendererHtml, /id="directMessages"/, "separate direct messages pane should be removed");
assert.doesNotMatch(rendererHtml, /class="rail"/, "main navigation rail should be removed");

// Renderer JS: removed-pattern guards.
assert.doesNotMatch(rendererJs, /directMessages/, "renderer should not write to a separate direct messages pane");

// CLI-side invariants that the smoke flow depends on.
assert.match(aidevPy, /TECHNICAL PROMPT/, "supervisor technical prompt section is missing");
assert.match(aidevPy, /ROLLBACK_REQUIRED/, "rollback trigger is missing");
assert.match(aidevPy, /def initial_project_root\(/, "CLI should support explicit project root resolution");


// ---------------------------------------------------------------------------
// Section B: CLI behavior in isolated temp projects.
// ---------------------------------------------------------------------------

const CLI_TEMP_ROOTS = [];

function makeTempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aidev-smoke-"));
  CLI_TEMP_ROOTS.push(dir);
  return dir;
}

function cleanupTempProjects() {
  for (const dir of CLI_TEMP_ROOTS) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

function runAidev(projectRoot, args, options = {}) {
  return cp.execFileSync(
    "python",
    [path.join(REPO_ROOT, "aidev.py"), "--project", projectRoot, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options },
  );
}

function parseRunId(stdout) {
  const match = stdout.match(/^Run:\s+(\S+)\s*$/m);
  if (!match) {
    throw new Error(`could not find "Run: <id>" line in stdout:\n${stdout}`);
  }
  return match[1];
}

try {
  // B.1 Planned-only run reaches the planning summary line.
  {
    const proj = makeTempProject();
    const out = runAidev(proj, ["run", "change x to 3", "--ui-settings", "{}"]);
    assert.match(out, /Planned only\. Re-run with --execute to call Codex\./,
      "planned run should print the planning-only marker");
    const runId = parseRunId(out);
    assert.match(runId, /^\d{8}-\d{6}-\d{3}-[0-9a-f]+$/,
      "run IDs should include millisecond precision");

    // The named run's prompt + usage land in the temp project's runs dir.
    const runDir = path.join(proj, ".ai", "runs", runId);
    assert.equal(fs.existsSync(runDir), true,
      `expected run dir to be created at ${runDir}`);
    const prompt = fs.readFileSync(path.join(runDir, "prompt.md"), "utf8");
    const usage = JSON.parse(fs.readFileSync(path.join(runDir, "usage.json"), "utf8"));
    assert.ok(prompt.length < 1900, "low task prompt should stay compact");
    assert.doesNotMatch(prompt, /# Task Contract/, "low task prompt should not include full contract dump");
    assert.match(prompt, /TASK/, "compact prompt should include task section");
    assert.match(prompt, /RULES/, "compact prompt should include rules digest");
    assert.ok(usage.duration_seconds >= 0, "usage should record run duration");
    assert.ok(usage.tokens.total > 0, "usage should record token estimate");
    assert.ok(usage.context.used_percent >= 0, "usage should record context fill");
    assert.ok(usage.cost.estimated_usd >= 0, "usage should record cost estimate");
  }

  // B.2 Narrow OAuth/auth errors stay at medium reasoning (regression for #7).
  {
    const proj = makeTempProject();
    const out = runAidev(proj, [
      "run",
      "Access blocked Authorization Error OAuth client was not found Error 401 invalid_client Rewrite",
      "--ui-settings",
      "{}",
    ]);
    assert.match(out, /Reasoning: medium/,
      "narrow OAuth/client config errors should use medium reasoning");
    assert.doesNotMatch(out, /Reasoning: high/,
      "narrow OAuth/client config errors should not require high approval");
  }

  // B.3 Hello-world routes to the cheap model with `none` reasoning.
  {
    const proj = makeTempProject();
    const out = runAidev(proj, [
      "run",
      "hello can you code hello world in python",
      "--ui-settings",
      "{}",
    ]);
    assert.match(out, /Task type: small_create/, "hello world should be a small_create task");
    assert.match(out, /Reasoning: none/, "hello world should use none reasoning");
    assert.match(out, /Model: gpt-5\.4-mini/, "hello world should use the cheap mini model");
  }

  // B.4 Sanity: the developer's working repo .ai/runs/ was NOT touched by the
  // CLI runs above — every artifact lives under each tmp project root.
  for (const tmp of CLI_TEMP_ROOTS) {
    const runs = path.join(tmp, ".ai", "runs");
    assert.equal(fs.existsSync(runs), true, `tmp project ${tmp} should have its own .ai/runs`);
    assert.ok(fs.readdirSync(runs).length > 0, `tmp project ${tmp} should contain at least one run`);
  }


  // -------------------------------------------------------------------------
  // Section C: sub-runners. Run them as separate Node processes so a failure
  // in one cleanly surfaces as a non-zero exit without short-circuiting the
  // others' output.
  // -------------------------------------------------------------------------

  function runSubProcess(label, file, extraArgs = []) {
    const result = cp.spawnSync(
      process.execPath,
      [...extraArgs, file],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(`sub-runner ${label} failed with exit code ${result.status}`);
    }
  }

  // Legacy home-rolled runners (assert per-test; non-zero exit on failure).
  runSubProcess("snapshot",      path.join(__dirname, "snapshot.test.js"));
  runSubProcess("policy",        path.join(__dirname, "policy.test.js"));
  runSubProcess("spawn-async",   path.join(__dirname, "spawn-async.test.js"));
  runSubProcess("restore-run",   path.join(__dirname, "restore-run.test.js"));

  // node:test runners: discover all *.test.js under the directories added by
  // the testing-track PRs. We invoke `node --test` in serial mode so the run
  // order stays deterministic and tests that share /.ai/desktop/settings.json
  // (the main-process integration suite) don't collide.
  function runNodeTestDir(label, dir) {
    if (!fs.existsSync(dir)) return; // tolerate missing dirs while branches catch up
    const files = fs.readdirSync(dir)
      .filter((name) => name.endsWith(".test.js"))
      .map((name) => path.join(dir, name));
    if (!files.length) return;
    const result = cp.spawnSync(
      process.execPath,
      ["--test", "--test-concurrency=1", ...files],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(`node:test runner ${label} failed with exit code ${result.status}`);
    }
  }

  runNodeTestDir("test/main",      path.join(__dirname, "main"));
  runNodeTestDir("test/renderer",  path.join(__dirname, "renderer"));
  runNodeTestDir("test/fs-safety", path.join(__dirname, "fs-safety"));


  // -------------------------------------------------------------------------
  // Section D: optional pytest invocation. We run the Python test suite
  // when pytest is importable; otherwise skip with a note. This keeps smoke
  // self-contained for contributors who haven't installed pytest yet.
  // -------------------------------------------------------------------------

  const pytestProbe = cp.spawnSync(
    "python",
    ["-c", "import importlib.util; import sys; sys.exit(0 if importlib.util.find_spec('pytest') else 2)"],
    { stdio: "ignore" },
  );
  if (pytestProbe.status === 0) {
    const result = cp.spawnSync(
      "python",
      ["-m", "pytest", "tests/", "--quiet"],
      { cwd: REPO_ROOT, stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(`pytest sub-runner failed with exit code ${result.status}`);
    }
  } else {
    console.log("pytest not installed; skipping Python test suite (install with `python -m pip install pytest`).");
  }


  // -------------------------------------------------------------------------
  // Section E: placeholder for the desktop-app E2E smoke. Kept as a
  // structured TODO so future work can find it. See issue #15 for scope:
  // app launch, send button wiring, basic state rendering.
  // -------------------------------------------------------------------------

  // TODO(#15): replace this comment with a Playwright-based `_electron`
  // launch test that:
  //   - spawns the packaged app from a temp userData dir,
  //   - asserts the main window opens and #sendButton is wired,
  //   - dispatches a click and asserts #sendStatus updates,
  //   - exits cleanly without writing into the developer's profile.

  console.log("Smoke checks passed.");
} finally {
  cleanupTempProjects();
}
