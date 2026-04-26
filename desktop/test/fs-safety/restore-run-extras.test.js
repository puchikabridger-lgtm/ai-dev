// Additional restoreRunFromDir tests, complementary to the home-rolled tests
// already shipped in desktop/test/restore-run.test.js by PR #21.
//
// These exercise the resolveGit/hasGitRepository fallback path plus a few
// edge cases that are not covered in the original file (fileHashOrNull
// inputs, no-op runs, file-already-removed-by-user, identity-only changes).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");

const { restoreRunFromDir, fileHashOrNull } = require("../../src/restore-run");


function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function makeWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidev-fs-safety-"));
  const runDir = path.join(root, ".ai", "runs", "20260101-000000-000-test");
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(runDir, "before-files"), { recursive: true });
  return { root, runDir };
}

function writeFile(root, rel, contents) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

function recordStates(runDir, before, after) {
  fs.writeFileSync(
    path.join(runDir, "before-state.json"),
    JSON.stringify({ git: { has_git: false }, files: before }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(runDir, "after-state.json"),
    JSON.stringify({ git: { has_git: false }, files: after }),
    "utf8",
  );
}

function cleanup(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
}


// -- fileHashOrNull --------------------------------------------------------

test("fileHashOrNull returns null for a missing path", () => {
  const missing = path.join(os.tmpdir(), `nope-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  assert.equal(fileHashOrNull(missing), null);
});

test("fileHashOrNull returns null for a directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aidev-fhon-dir-"));
  try {
    assert.equal(fileHashOrNull(dir), null);
  } finally {
    cleanup(dir);
  }
});

test("fileHashOrNull returns sha256 hex for a regular file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aidev-fhon-file-"));
  try {
    const file = path.join(dir, "x.txt");
    const content = Buffer.from("hello\n");
    fs.writeFileSync(file, content);
    assert.equal(fileHashOrNull(file), sha256(content));
  } finally {
    cleanup(dir);
  }
});


// -- restoreRunFromDir: input validation -----------------------------------

test("restoreRunFromDir reports run-not-found for a missing dir", () => {
  const result = restoreRunFromDir(
    path.join(os.tmpdir(), `does-not-exist-${Date.now()}`),
    os.tmpdir(),
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /Run not found/);
});

test("restoreRunFromDir refuses runs without an after-state file map (legacy guard)", (t) => {
  const { root, runDir } = makeWorld();
  t.after(() => cleanup(root));

  // before-state has files but after-state lacks the `files` key entirely.
  fs.writeFileSync(
    path.join(runDir, "before-state.json"),
    JSON.stringify({ files: {} }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(runDir, "after-state.json"),
    JSON.stringify({ git: { has_git: false } }),
    "utf8",
  );
  writeFile(root, "src/x.txt", Buffer.from("x"));

  const result = restoreRunFromDir(runDir, root);
  assert.equal(result.ok, false);
  assert.match(result.error, /after-state file map/);
  assert.equal(fs.existsSync(path.join(root, "src/x.txt")), true,
    "file must NOT be deleted when after-state is incomplete");
});

test("restoreRunFromDir refuses runs whose after-state.files is not an object", (t) => {
  const { root, runDir } = makeWorld();
  t.after(() => cleanup(root));

  fs.writeFileSync(
    path.join(runDir, "before-state.json"),
    JSON.stringify({ files: {} }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(runDir, "after-state.json"),
    JSON.stringify({ files: "not an object" }),
    "utf8",
  );

  const result = restoreRunFromDir(runDir, root);
  assert.equal(result.ok, false);
  assert.match(result.error, /after-state file map/);
});


// -- restoreRunFromDir: no-op cases ----------------------------------------

test("identical before/after hashes report empty success without touching the workspace", (t) => {
  const { root, runDir } = makeWorld();
  t.after(() => cleanup(root));
  const content = Buffer.from("unchanged\n");
  writeFile(root, "src/static.txt", content);
  recordStates(
    runDir,
    { "src/static.txt": sha256(content) },
    { "src/static.txt": sha256(content) },
  );

  const result = restoreRunFromDir(runDir, root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.restored, []);
  assert.deepEqual(result.removed, []);
  // Confirm we didn't accidentally touch it.
  assert.equal(fs.readFileSync(path.join(root, "src/static.txt"), "utf8"), "unchanged\n");
});

test("a run-removed file (after-state hash null/missing) that is already gone is a no-op", (t) => {
  const { root, runDir } = makeWorld();
  t.after(() => cleanup(root));
  // before had a file with hash X; after-state records an empty files map ->
  // the file should be restored from before-files. But if before-files isn't
  // present, the path falls through to git fallback (covered in the next
  // section). Here we test only that an after-state recorded as `null` still
  // works.
  recordStates(
    runDir,
    {},
    { "src/already-gone.txt": null },
  );

  const result = restoreRunFromDir(runDir, root);
  // before doesn't have it, after recorded null -> not in tracked because
  // beforeFiles[rel] (undefined) === afterFiles[rel] (null) is false, so it
  // IS tracked; recordedAfter is null/falsy, hadAfter true with falsy hash
  // means we hit the else branch: currentHash should be null (file does not
  // exist) -> not drifted; hadBefore false -> safeForRemoval; but the file
  // isn't there, so removal becomes a no-op.
  assert.equal(result.ok, true);
  assert.deepEqual(result.removed, [], "no actual removal happened because the file was already gone");
  assert.deepEqual(result.restored, []);
});


// -- restoreRunFromDir: git-fallback path ----------------------------------
//
// When a tracked file existed in `before` but no local backup is on disk,
// restoreRunFromDir delegates to `git restore --source=HEAD --worktree
// --staged -- <files>`. The caller passes `resolveGit` and
// `hasGitRepository` callbacks; the helper refuses if either is missing.

test("git fallback refuses when resolveGit returns null", (t) => {
  const { root, runDir } = makeWorld();
  t.after(() => cleanup(root));
  const original = Buffer.from("v0\n");
  const runWrote = Buffer.from("v1\n");
  // before tracked the file, but we don't put a backup in before-files,
  // so the helper falls through to the git fallback path.
  writeFile(root, "src/code.js", runWrote);
  recordStates(
    runDir,
    { "src/code.js": sha256(original) },
    { "src/code.js": sha256(runWrote) },
  );

  const result = restoreRunFromDir(runDir, root, {
    resolveGit: () => null,
    hasGitRepository: () => false,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /backup snapshot|git repository/);
  // File must NOT have been touched.
  assert.equal(fs.readFileSync(path.join(root, "src/code.js"), "utf8"), "v1\n");
});

test("git fallback refuses when hasGitRepository returns false even if git resolves", (t) => {
  const { root, runDir } = makeWorld();
  t.after(() => cleanup(root));
  const original = Buffer.from("v0\n");
  const runWrote = Buffer.from("v1\n");
  writeFile(root, "src/code.js", runWrote);
  recordStates(
    runDir,
    { "src/code.js": sha256(original) },
    { "src/code.js": sha256(runWrote) },
  );

  const result = restoreRunFromDir(runDir, root, {
    resolveGit: () => "/usr/bin/git", // fake but non-empty
    hasGitRepository: () => false,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /backup snapshot|git repository/);
});

test("git fallback succeeds end-to-end against a real git repo", (t) => {
  const { root, runDir } = makeWorld();
  t.after(() => cleanup(root));

  // Initialize a real git repo at root and commit the original file.
  function git(...args) {
    const result = cp.spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
    }
    return result;
  }
  git("init", "-q");
  git("config", "user.email", "test@example.test");
  git("config", "user.name", "Test");
  // Disable autocrlf so the round-trip preserves bytes verbatim across
  // platforms (Windows defaults to autocrlf=true, which would mangle our
  // exact-bytes assertion below).
  git("config", "core.autocrlf", "false");
  const original = Buffer.from("v0 committed\n");
  writeFile(root, "src/code.js", original);
  git("add", "src/code.js");
  git("commit", "-q", "-m", "initial");

  // Simulate the run editing the file (no local backup snapshot is captured).
  const runWrote = Buffer.from("v1 from run\n");
  fs.writeFileSync(path.join(root, "src/code.js"), runWrote);
  recordStates(
    runDir,
    { "src/code.js": sha256(original) },
    { "src/code.js": sha256(runWrote) },
  );
  // Note: do NOT create a before-files backup for this rel, so we exercise
  // the git-fallback branch.

  const result = restoreRunFromDir(runDir, root, {
    resolveGit: () => "git",
    hasGitRepository: () => true,
  });

  assert.equal(result.ok, true, `expected ok=true: ${JSON.stringify(result)}`);
  assert.ok(result.restored.includes("src/code.js"), "should report the git-fallback file as restored");
  assert.equal(
    fs.readFileSync(path.join(root, "src/code.js"), "utf8"),
    "v0 committed\n",
    "git restore must put the committed contents back",
  );
});

test("git fallback surfaces the git stderr when the git command fails", (t) => {
  const { root, runDir } = makeWorld();
  t.after(() => cleanup(root));
  const original = Buffer.from("v0\n");
  const runWrote = Buffer.from("v1\n");
  writeFile(root, "src/code.js", runWrote);
  recordStates(
    runDir,
    { "src/code.js": sha256(original) },
    { "src/code.js": sha256(runWrote) },
  );

  // Real `git` resolves and we claim the dir is a repo, but the dir is NOT
  // a git repo, so `git restore` fails. The helper must surface a friendly
  // error rather than crash.
  const result = restoreRunFromDir(runDir, root, {
    resolveGit: () => "git",
    hasGitRepository: () => true,
  });
  assert.equal(result.ok, false);
  assert.ok(result.error && result.error.length > 0, "should report some error text");
  assert.equal(
    fs.readFileSync(path.join(root, "src/code.js"), "utf8"),
    "v1\n",
    "workspace must remain unchanged when undo fails",
  );
});
