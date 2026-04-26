"use strict";

const fs = require("fs");
const path = require("path");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function backupFileOncePerMinute(file, label) {
  if (!fs.existsSync(file)) return;
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ].join("");
  const backup = path.join(path.dirname(file), `${path.basename(file, ".json")}.${label}-${stamp}.json`);
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
  }
}

function nonEmptyChatSessions(value) {
  const sessions = value?.chatSessions;
  if (!sessions || typeof sessions !== "object") return false;
  return Object.values(sessions).some((items) => Array.isArray(items) && items.length);
}

function sanitizedSettings(value) {
  const next = { ...(value || {}) };
  next.auth = { ...(next.auth || {}) };
  delete next.auth.openaiApiKey;
  delete next.auth.anthropicApiKey;
  return next;
}

module.exports = {
  ensureDir,
  readJson,
  writeJson,
  readText,
  backupFileOncePerMinute,
  nonEmptyChatSessions,
  sanitizedSettings,
};
