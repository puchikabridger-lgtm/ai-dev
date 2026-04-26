const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

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

function fileHash(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function fileHashOrNull(abs) {
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return fileHash(abs);
  } catch {
    return null;
  }
}

function needsShell(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(String(command || ""));
}

function restoreRunFromDir(runDir, root, options = {}) {
  if (!fs.existsSync(runDir)) {
    return { ok: false, error: "Run not found." };
  }
  const before = readJson(path.join(runDir, "before-state.json"), {});
  const after = readJson(path.join(runDir, "after-state.json"), {});
  const beforeFiles = before.files || {};
  const afterFiles = after.files;
  if (!afterFiles || typeof afterFiles !== "object") {
    return {
      ok: false,
      error: "Undo unavailable: this run does not have an after-state file map. Re-run the task on the updated app to enable drift-protected undo.",
    };
  }
  const backupDir = path.join(runDir, "before-files");
  const tracked = Array.from(new Set([
    ...Object.keys(beforeFiles),
    ...Object.keys(afterFiles),
  ])).filter((name) => beforeFiles[name] !== afterFiles[name]);
  if (!tracked.length) {
    return { ok: true, restored: [], removed: [], drifted: [] };
  }
  const drifted = [];
  const safeForBackupRestore = [];
  const safeForRemoval = [];
  const safeForGitFallback = [];
  for (const rel of tracked) {
    const abs = path.join(root, rel);
    const recordedAfter = afterFiles[rel];
    const currentHash = fileHashOrNull(abs);
    const hadAfter = Object.prototype.hasOwnProperty.call(afterFiles, rel);
    const hadBefore = Object.prototype.hasOwnProperty.call(beforeFiles, rel);
    if (hadAfter && recordedAfter) {
      if (currentHash !== recordedAfter) {
        drifted.push(rel);
        continue;
      }
    } else {
      if (currentHash !== null) {
        drifted.push(rel);
        continue;
      }
    }
    if (!hadBefore) {
      safeForRemoval.push(rel);
      continue;
    }
    const backup = path.join(backupDir, rel);
    if (fs.existsSync(backup)) {
      safeForBackupRestore.push(rel);
    } else {
      safeForGitFallback.push(rel);
    }
  }
  if (drifted.length) {
    return {
      ok: false,
      error: `Undo refused: ${drifted.length} file(s) have changed since this run finished. Review and revert manually if needed.`,
      drifted: drifted.sort(),
    };
  }
  const removed = [];
  const restored = [];
  for (const rel of safeForRemoval) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      fs.rmSync(abs, { force: true });
      removed.push(rel);
    } catch {}
  }
  for (const rel of safeForBackupRestore) {
    const abs = path.join(root, rel);
    const backup = path.join(backupDir, rel);
    ensureDir(path.dirname(abs));
    fs.copyFileSync(backup, abs);
    restored.push(rel);
  }
  if (safeForGitFallback.length) {
    const git = options.resolveGit ? options.resolveGit() : null;
    const haveGit = options.hasGitRepository ? options.hasGitRepository() : false;
    if (!git || !haveGit) {
      return {
        ok: false,
        error: "Undo needs this run's local backup snapshot or a git repository. Re-run the task once with the updated app to get backup-based undo.",
      };
    }
    const result = cp.spawnSync(git, ["restore", "--source=HEAD", "--worktree", "--staged", "--", ...safeForGitFallback], {
      cwd: root,
      shell: needsShell(git),
      windowsHide: true,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      return { ok: false, error: result.stderr || result.stdout || "Undo failed." };
    }
  }
  return {
    ok: true,
    restored: [...restored, ...safeForGitFallback],
    removed,
    drifted: [],
  };
}

module.exports = { restoreRunFromDir, fileHashOrNull };
