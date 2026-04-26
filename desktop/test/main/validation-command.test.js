// Tests for validationCommandForRun argv shape.
//
// These tests pin down the validation-command selection logic: explicit
// override from .ai/config/project.json, language-aware default, npm-script
// fallback. They also assert that python file paths get passed through
// formatArg, which is the core protection added by issue #5.

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

function assertShellCommand(actual, display) {
  assert.equal(actual.display, display);
  assert.equal(actual.argv, null);
  assert.equal(actual.shellString, display);
}

function assertNpmCommand(actual, display, args) {
  assert.equal(actual.display, display);
  assert.ok(Array.isArray(actual.argv), "expected argv command");
  assert.match(path.basename(actual.argv[0]), /^npm(\.cmd)?$/i);
  assert.deepEqual(actual.argv.slice(1), args);
  assert.equal(actual.shellString, null);
}

function assertPythonCommand(actual, display, args) {
  assert.equal(actual.display, display);
  assert.ok(Array.isArray(actual.argv), "expected argv command");
  assert.match(path.basename(actual.argv[0]), /^python(3)?(\.exe)?$/i);
  assert.deepEqual(actual.argv.slice(1), args);
  assert.equal(actual.shellString, null);
}

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

function makeFixture({ packageScripts = null, projectConfig = null, hasPytest = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "main-tests-validation-"));
  if (packageScripts) {
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ scripts: packageScripts }, null, 2),
      "utf8",
    );
  }
  if (hasPytest) {
    fs.writeFileSync(path.join(tmp, "pytest.ini"), "[pytest]\n", "utf8");
  }
  if (projectConfig) {
    fs.mkdirSync(path.join(tmp, ".ai", "config"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".ai", "config", "project.json"),
      JSON.stringify(projectConfig, null, 2),
      "utf8",
    );
  }
  return tmp;
}


test("validationCommandForRun honors explicit project config validation.command", (t) => {
  backupSettings();
  const fixture = makeFixture({
    packageScripts: { test: "vitest" },
    projectConfig: { validation: { command: "make verify" } },
  });
  pointSettingsAt(fixture);
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    restoreSettings();
  });

  const cmd = main.validationCommandForRun({ audit: { changed_files: ["src/app.js"] } });
  assertShellCommand(cmd, "make verify");
});

test("validationCommandForRun picks `npm run check` when js changed and `check` script exists", (t) => {
  backupSettings();
  const fixture = makeFixture({ packageScripts: { check: "node --check src/main.js", test: "node --test" } });
  pointSettingsAt(fixture);
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    restoreSettings();
  });

  const cmd = main.validationCommandForRun({ audit: { changed_files: ["src/main.js"] } });
  assertNpmCommand(cmd, "npm run check", ["run", "check"]);
});

test("validationCommandForRun picks `npm test` when js changed and only `test` script exists", (t) => {
  backupSettings();
  const fixture = makeFixture({ packageScripts: { test: "node --test" } });
  pointSettingsAt(fixture);
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    restoreSettings();
  });

  const cmd = main.validationCommandForRun({ audit: { changed_files: ["src/main.js"] } });
  assertNpmCommand(cmd, "npm test", ["test"]);
});

test("validationCommandForRun picks `npm run lint` when only `lint` script exists for js changes", (t) => {
  backupSettings();
  const fixture = makeFixture({ packageScripts: { lint: "eslint ." } });
  pointSettingsAt(fixture);
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    restoreSettings();
  });

  const cmd = main.validationCommandForRun({ audit: { changed_files: ["src/main.js"] } });
  assertNpmCommand(cmd, "npm run lint", ["run", "lint"]);
});

test("validationCommandForRun builds python -m py_compile for python changes only", (t) => {
  backupSettings();
  const fixture = makeFixture();
  pointSettingsAt(fixture);
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    restoreSettings();
  });

  const cmd = main.validationCommandForRun({ audit: { changed_files: ["aidev.py"] } });
  assertPythonCommand(cmd, "python -m py_compile aidev.py", ["-m", "py_compile", "aidev.py"]);
});

test("validationCommandForRun quotes python paths with spaces (no shell injection)", (t) => {
  backupSettings();
  const fixture = makeFixture();
  pointSettingsAt(fixture);
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    restoreSettings();
  });

  const cmd = main.validationCommandForRun({
    audit: { changed_files: ["a/b c/script.py", "ok/path.py"] },
  });
  // formatArg quotes the spaced one and leaves the simple one alone.
  assertPythonCommand(
    cmd,
    'python -m py_compile "a/b c/script.py" ok/path.py',
    ["-m", "py_compile", "a/b c/script.py", "ok/path.py"],
  );
});

test("validationCommandForRun excludes non-py files from the py_compile arg list", (t) => {
  backupSettings();
  const fixture = makeFixture();
  pointSettingsAt(fixture);
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    restoreSettings();
  });

  const cmd = main.validationCommandForRun({
    audit: { changed_files: ["a.py", "README.md", "b.py"] },
  });
  assertPythonCommand(cmd, "python -m py_compile a.py b.py", ["-m", "py_compile", "a.py", "b.py"]);
});

test("validationCommandForRun falls back to npm test/check when only non-code files changed", (t) => {
  backupSettings();
  const fixture = makeFixture({ packageScripts: { test: "vitest" } });
  pointSettingsAt(fixture);
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    restoreSettings();
  });

  const cmd = main.validationCommandForRun({ audit: { changed_files: ["README.md"] } });
  assertNpmCommand(cmd, "npm test", ["test"]);
});

test("validationCommandForRun returns empty string when nothing applies", (t) => {
  backupSettings();
  const fixture = makeFixture(); // no package.json, no pytest, no config.
  pointSettingsAt(fixture);
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    restoreSettings();
  });

  const cmd = main.validationCommandForRun({ audit: { changed_files: ["README.md"] } });
  assert.equal(cmd, null);
});

test("validationCommandForRun handles missing audit/changed_files gracefully", (t) => {
  backupSettings();
  const fixture = makeFixture({ packageScripts: { test: "vitest" } });
  pointSettingsAt(fixture);
  t.after(() => {
    fs.rmSync(fixture, { recursive: true, force: true });
    restoreSettings();
  });

  // No audit at all.
  assertNpmCommand(main.validationCommandForRun({}), "npm test", ["test"]);
  // changed_files missing.
  assertNpmCommand(main.validationCommandForRun({ audit: {} }), "npm test", ["test"]);
  // changed_files not an array.
  assertNpmCommand(main.validationCommandForRun({ audit: { changed_files: null } }), "npm test", ["test"]);
});
