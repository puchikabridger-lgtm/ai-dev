const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const assert = require("node:assert/strict");

const { backupBeforeFilesIn, gitTrackedFiles } = require("../src/snapshot");

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

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aidev-snapshot-"));
}

function writeFile(root, rel, contents) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

console.log("snapshot:");

test("backupBeforeFilesIn copies files within size cap", () => {
  const root = makeRoot();
  const runDir = path.join(root, ".ai", "runs", "20260101-000000-000-test");
  fs.mkdirSync(runDir, { recursive: true });
  writeFile(root, "src/a.js", "small a");
  writeFile(root, "src/b.js", "small b");
  const before = { "src/a.js": "h1", "src/b.js": "h2" };
  const stats = backupBeforeFilesIn(root, runDir, before);
  assert.equal(stats.backed, 2);
  assert.equal(stats.skippedBig, 0);
  assert.equal(fs.readFileSync(path.join(runDir, "before-files", "src/a.js"), "utf8"), "small a");
  assert.equal(fs.readFileSync(path.join(runDir, "before-files", "src/b.js"), "utf8"), "small b");
});

test("backupBeforeFilesIn skips oversized files and records them in the manifest", () => {
  const root = makeRoot();
  const runDir = path.join(root, ".ai", "runs", "20260101-000000-001-test");
  fs.mkdirSync(runDir, { recursive: true });
  writeFile(root, "src/small.js", "tiny");
  writeFile(root, "assets/big.bin", Buffer.alloc(50_000, 0xab));
  const before = { "src/small.js": "h1", "assets/big.bin": "h2" };
  const stats = backupBeforeFilesIn(root, runDir, before, { maxBytes: 1024 });
  assert.equal(stats.backed, 1);
  assert.equal(stats.skippedBig, 1);
  assert.equal(fs.existsSync(path.join(runDir, "before-files", "src/small.js")), true);
  assert.equal(fs.existsSync(path.join(runDir, "before-files", "assets/big.bin")), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, "before-files-manifest.json"), "utf8"));
  assert.equal(manifest.backed_up, 1);
  assert.equal(manifest.skipped_oversized, 1);
  assert.equal(manifest.max_backup_bytes, 1024);
});

test("backupBeforeFilesIn honors isSnapshotIgnored callback", () => {
  const root = makeRoot();
  const runDir = path.join(root, ".ai", "runs", "20260101-000000-002-test");
  fs.mkdirSync(runDir, { recursive: true });
  writeFile(root, "src/a.js", "ok");
  writeFile(root, ".ai/runs/old/data.json", "ignore me");
  const before = { "src/a.js": "h1", ".ai/runs/old/data.json": "h2" };
  const stats = backupBeforeFilesIn(root, runDir, before, {
    isSnapshotIgnored: (rel) => rel.startsWith(".ai/runs"),
  });
  assert.equal(stats.backed, 1);
  assert.equal(fs.existsSync(path.join(runDir, "before-files", "src/a.js")), true);
  assert.equal(fs.existsSync(path.join(runDir, "before-files", ".ai/runs/old/data.json")), false);
});

test("backupBeforeFilesIn silently skips files removed before backup runs", () => {
  const root = makeRoot();
  const runDir = path.join(root, ".ai", "runs", "20260101-000000-003-test");
  fs.mkdirSync(runDir, { recursive: true });
  writeFile(root, "src/exists.js", "yes");
  const before = { "src/exists.js": "h1", "src/missing.js": "h2" };
  const stats = backupBeforeFilesIn(root, runDir, before);
  assert.equal(stats.backed, 1);
  assert.equal(stats.skippedBig, 0);
});

test("gitTrackedFiles returns the cached + untracked set, excluding gitignored paths", function () {
  const probe = cp.spawnSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" });
  if (probe.status !== 0) {
    console.log("  skip gitTrackedFiles (git not on PATH)");
    return;
  }
  const root = makeRoot();
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const opts = { cwd: root, encoding: "utf8", env };
  cp.spawnSync("git", ["init", "-q"], opts);
  cp.spawnSync("git", ["config", "core.autocrlf", "false"], opts);
  writeFile(root, ".gitignore", "ignored.txt\nbuild/\n");
  writeFile(root, "tracked.txt", "in repo");
  writeFile(root, "ignored.txt", "ignored");
  writeFile(root, "build/output.bin", "ignored too");
  cp.spawnSync("git", ["add", ".gitignore", "tracked.txt"], opts);
  cp.spawnSync("git", ["commit", "-q", "-m", "init"], opts);
  writeFile(root, "untracked.txt", "new file");

  const tracked = gitTrackedFiles(root);
  assert.ok(tracked, "should return a Set in a git repo");
  assert.equal(tracked.has("tracked.txt"), true, "tracked file should be in set");
  assert.equal(tracked.has("untracked.txt"), true, "non-ignored untracked file should be in set");
  assert.equal(tracked.has("ignored.txt"), false, "gitignored file should NOT be in set");
  assert.equal(tracked.has("build/output.bin"), false, "files under gitignored dir should NOT be in set");
});

test("gitTrackedFiles returns null when not inside a git work tree", () => {
  const probe = cp.spawnSync(process.platform === "win32" ? "where" : "which", ["git"], { encoding: "utf8" });
  if (probe.status !== 0) {
    console.log("  skip gitTrackedFiles non-repo (git not on PATH)");
    return;
  }
  const root = makeRoot();
  const tracked = gitTrackedFiles(root);
  assert.equal(tracked, null);
});

if (failed) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll snapshot tests passed.");
