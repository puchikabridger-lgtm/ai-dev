const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");

const { restoreRunFromDir } = require("../src/restore-run");

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function makeWorld() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aidev-restore-"));
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

function backupFile(runDir, rel, contents) {
  const abs = path.join(runDir, "before-files", rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

function recordStates(runDir, before, after) {
  fs.writeFileSync(
    path.join(runDir, "before-state.json"),
    JSON.stringify({ git: { has_git: false }, files: before }),
  );
  fs.writeFileSync(
    path.join(runDir, "after-state.json"),
    JSON.stringify({ git: { has_git: false }, files: after }),
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

console.log("restoreRunFromDir:");

test("happy path: reverts run-modified file when current hash still matches after-state", () => {
  const { root, runDir } = makeWorld();
  const original = Buffer.from("original\n");
  const runChanged = Buffer.from("run wrote this\n");
  backupFile(runDir, "src/foo.txt", original);
  writeFile(root, "src/foo.txt", runChanged);
  recordStates(runDir, { "src/foo.txt": sha256(original) }, { "src/foo.txt": sha256(runChanged) });

  const result = restoreRunFromDir(runDir, root);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.restored, ["src/foo.txt"]);
  assert.equal(fs.readFileSync(path.join(root, "src/foo.txt"), "utf8"), "original\n");
});

test("happy path: removes file the run created when nothing else has touched it", () => {
  const { root, runDir } = makeWorld();
  const created = Buffer.from("new file\n");
  writeFile(root, "src/new.txt", created);
  recordStates(runDir, {}, { "src/new.txt": sha256(created) });

  const result = restoreRunFromDir(runDir, root);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.removed, ["src/new.txt"]);
  assert.equal(fs.existsSync(path.join(root, "src/new.txt")), false);
});

test("drift: refuses to delete a file the user has edited after the run", () => {
  const { root, runDir } = makeWorld();
  const runWrote = Buffer.from("run wrote\n");
  const userEdited = Buffer.from("user edited later\n");
  writeFile(root, "src/created.txt", userEdited);
  recordStates(runDir, {}, { "src/created.txt": sha256(runWrote) });

  const result = restoreRunFromDir(runDir, root);

  assert.equal(result.ok, false);
  assert.deepEqual(result.drifted, ["src/created.txt"]);
  assert.equal(fs.readFileSync(path.join(root, "src/created.txt"), "utf8"), "user edited later\n", "user edit must be preserved");
});

test("drift: refuses to overwrite a file the user has further edited after the run", () => {
  const { root, runDir } = makeWorld();
  const original = Buffer.from("v0\n");
  const runWrote = Buffer.from("v1 from run\n");
  const userLater = Buffer.from("v2 user edit\n");
  backupFile(runDir, "src/code.js", original);
  writeFile(root, "src/code.js", userLater);
  recordStates(runDir, { "src/code.js": sha256(original) }, { "src/code.js": sha256(runWrote) });

  const result = restoreRunFromDir(runDir, root);

  assert.equal(result.ok, false);
  assert.deepEqual(result.drifted, ["src/code.js"]);
  assert.equal(fs.readFileSync(path.join(root, "src/code.js"), "utf8"), "v2 user edit\n", "user edit must be preserved");
});

test("drift: any tracked drift aborts the whole undo (no partial revert)", () => {
  const { root, runDir } = makeWorld();
  const aOriginal = Buffer.from("a0\n");
  const aRun = Buffer.from("a1\n");
  const bRun = Buffer.from("b1\n");
  const bUser = Buffer.from("b2 user\n");
  backupFile(runDir, "a.txt", aOriginal);
  writeFile(root, "a.txt", aRun);
  writeFile(root, "b.txt", bUser);
  recordStates(
    runDir,
    { "a.txt": sha256(aOriginal) },
    { "a.txt": sha256(aRun), "b.txt": sha256(bRun) },
  );

  const result = restoreRunFromDir(runDir, root);

  assert.equal(result.ok, false);
  assert.deepEqual(result.drifted, ["b.txt"]);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "a1\n", "a.txt must NOT have been reverted because the whole undo aborted");
  assert.equal(fs.readFileSync(path.join(root, "b.txt"), "utf8"), "b2 user\n");
});

test("drift: detects when user re-creates a file the run never produced", () => {
  const { root, runDir } = makeWorld();
  const original = Buffer.from("v0\n");
  backupFile(runDir, "deleted.txt", original);
  writeFile(root, "deleted.txt", Buffer.from("user re-created\n"));
  recordStates(
    runDir,
    { "deleted.txt": sha256(original) },
    {},
  );

  const result = restoreRunFromDir(runDir, root);

  assert.equal(result.ok, false);
  assert.deepEqual(result.drifted, ["deleted.txt"]);
  assert.equal(fs.readFileSync(path.join(root, "deleted.txt"), "utf8"), "user re-created\n");
});

test("legacy run without after-state files map: refuses undo (does not delete anything)", () => {
  const { root, runDir } = makeWorld();
  const created = Buffer.from("from run\n");
  writeFile(root, "src/created.txt", created);
  fs.writeFileSync(
    path.join(runDir, "before-state.json"),
    JSON.stringify({ git: { has_git: false }, files: {} }),
  );
  fs.writeFileSync(
    path.join(runDir, "after-state.json"),
    JSON.stringify({ git: { has_git: false } }),
  );

  const result = restoreRunFromDir(runDir, root);

  assert.equal(result.ok, false);
  assert.match(result.error, /after-state file map/);
  assert.equal(fs.existsSync(path.join(root, "src/created.txt")), true, "file must NOT be deleted when after-state is incomplete");
});

test("missing run dir reports run not found", () => {
  const result = restoreRunFromDir(path.join(os.tmpdir(), "does-not-exist-" + Date.now()), os.tmpdir());
  assert.equal(result.ok, false);
  assert.match(result.error, /Run not found/);
});

test("no tracked changes reports an empty success", () => {
  const { root, runDir } = makeWorld();
  recordStates(runDir, {}, {});
  const result = restoreRunFromDir(runDir, root);
  assert.equal(result.ok, true);
  assert.deepEqual(result.restored, []);
  assert.deepEqual(result.removed, []);
});

if (failed) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll restore-run tests passed.");
