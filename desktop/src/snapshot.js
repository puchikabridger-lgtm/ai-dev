const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const DEFAULT_MAX_BACKUP_BYTES = 2 * 1024 * 1024;

function normalizeRel(file) {
  return file.split(path.sep).join("/");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function needsShell(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(String(command || ""));
}

function backupBeforeFilesIn(root, runDir, beforeSnapshot, options = {}) {
  const isIgnored = typeof options.isSnapshotIgnored === "function" ? options.isSnapshotIgnored : () => false;
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : DEFAULT_MAX_BACKUP_BYTES;
  const backupDir = path.join(runDir, "before-files");
  let skippedBig = 0;
  let backed = 0;
  for (const rel of Object.keys(beforeSnapshot || {})) {
    if (isIgnored(rel)) continue;
    const source = path.join(root, rel);
    let stat;
    try {
      stat = fs.statSync(source);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > maxBytes) {
      skippedBig += 1;
      continue;
    }
    const target = path.join(backupDir, rel);
    ensureDir(path.dirname(target));
    fs.copyFileSync(source, target);
    backed += 1;
  }
  if (skippedBig > 0 || backed > 0) {
    try {
      writeJson(path.join(runDir, "before-files-manifest.json"), {
        backed_up: backed,
        skipped_oversized: skippedBig,
        max_backup_bytes: maxBytes,
        created_at: new Date().toISOString(),
      });
    } catch {}
  }
  return { backed, skippedBig };
}

function gitTrackedFiles(root, options = {}) {
  const gitPath = options.gitPath || "git";
  const inside = cp.spawnSync(gitPath, ["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
    shell: needsShell(gitPath),
    windowsHide: true,
    encoding: "utf8",
  });
  if (inside.status !== 0) return null;
  const result = cp.spawnSync(gitPath, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    shell: needsShell(gitPath),
    windowsHide: true,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  const buf = result.stdout;
  if (!buf || !buf.length) return new Set();
  const out = new Set();
  for (const part of buf.toString("utf8").split("\0")) {
    if (!part) continue;
    out.add(normalizeRel(part));
  }
  return out;
}

module.exports = { backupBeforeFilesIn, gitTrackedFiles, DEFAULT_MAX_BACKUP_BYTES };
