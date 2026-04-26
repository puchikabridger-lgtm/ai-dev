// Tests for nowRunId / runSortKeys / runMtime.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const main = require("./_loader.js");


test("nowRunId returns a deterministic shape", () => {
  const id = main.nowRunId();
  // Format: YYYYMMDD-HHMMSS-mmm-{hex6}, e.g. 20260426-093014-217-aabbcc.
  assert.match(id, /^\d{8}-\d{6}-\d{3}-[0-9a-f]{6}$/);
});

test("nowRunId includes a prefix when provided", () => {
  const id = main.nowRunId("undo");
  assert.match(id, /^\d{8}-\d{6}-\d{3}-undo-[0-9a-f]{6}$/);
});

test("nowRunId emits unique values when called in succession", () => {
  const ids = new Set();
  for (let i = 0; i < 100; i += 1) {
    ids.add(main.nowRunId());
  }
  // All 100 calls share at most 3-char ms field; the random hex suffix must
  // make every call unique.
  assert.equal(ids.size, 100, "every nowRunId() call should be unique");
});

test("nowRunId ms field is zero-padded to 3 chars", () => {
  // Generate enough samples to be reasonably confident the ms field is always
  // 3 chars (e.g. 001 not 1).
  for (let i = 0; i < 50; i += 1) {
    const id = main.nowRunId();
    const parts = id.split("-");
    assert.equal(parts[2].length, 3, `ms field must be 3 chars: got ${id}`);
  }
});


test("runSortKeys returns ms timestamp for valid contract.created_at", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "main-tests-runSortKeys-"));
  try {
    const expected = Date.parse("2026-04-26T10:00:00Z");
    const key = main.runSortKeys(tmp, { created_at: "2026-04-26T10:00:00Z" });
    assert.equal(key, expected);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("runSortKeys falls back to directory mtime when contract.created_at is missing", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "main-tests-runSortKeys-"));
  try {
    const expected = fs.statSync(tmp).mtimeMs;
    const key = main.runSortKeys(tmp, {});
    assert.equal(key, expected);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("runSortKeys falls back to mtime when contract.created_at is invalid", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "main-tests-runSortKeys-"));
  try {
    const expected = fs.statSync(tmp).mtimeMs;
    const key = main.runSortKeys(tmp, { created_at: "not-a-date" });
    assert.equal(key, expected);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("runSortKeys returns 0 when both inputs are missing and dir does not exist", () => {
  const missing = path.join(os.tmpdir(), `nope-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const key = main.runSortKeys(missing, null);
  assert.equal(key, 0);
});


test("runMtime reflects actual directory mtime", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "main-tests-runMtime-"));
  try {
    const expected = fs.statSync(tmp).mtimeMs;
    assert.equal(main.runMtime(tmp), expected);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("runMtime returns 0 for a missing path", () => {
  const missing = path.join(os.tmpdir(), `nope-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  assert.equal(main.runMtime(missing), 0);
});
