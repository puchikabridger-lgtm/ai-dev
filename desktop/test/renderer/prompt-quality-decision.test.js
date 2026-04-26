// Tests for promptQualityDecision — the "is this prompt vague?" gate.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { promptQualityDecision } = require("./_loader.js");


test("rejects vague prompts (<=4 words, no path-like substring)", () => {
  const result = promptQualityDecision("fix the thing");
  assert.equal(result.ok, false);
  assert.match(result.message, /file, screen, component, bug, or expected behavior/);
});

test("accepts vague-looking prompts that include a file path", () => {
  // <=4 words, BUT contains a path-like token (e.g. ./src/main.js) — accepted.
  const result = promptQualityDecision("fix ./src/main.js");
  assert.equal(result.ok, true);
});

test("accepts paths with backslash (Windows)", () => {
  const result = promptQualityDecision("fix src\\main.js");
  assert.equal(result.ok, true);
});

test("accepts long-enough prompts even without a file reference", () => {
  const result = promptQualityDecision(
    "the form submit button does not advance to the success screen, please investigate and fix",
  );
  assert.equal(result.ok, true);
});

test("rejects single-word action verbs (English)", () => {
  for (const text of ["fix", "improve", "add", "change"]) {
    const result = promptQualityDecision(text);
    assert.equal(result.ok, false, text);
  }
});

test("rejects single-word action verbs (Russian)", () => {
  for (const text of ["сделай", "исправь", "улучши", "добавь", "переделай"]) {
    const result = promptQualityDecision(text);
    assert.equal(result.ok, false, text);
  }
});

test("/discuss bypasses the quality gate entirely", () => {
  const result = promptQualityDecision("fix", "discuss");
  assert.equal(result.ok, true);
});

test("/discuss bypasses even an empty prompt", () => {
  const result = promptQualityDecision("", "discuss");
  assert.equal(result.ok, true);
});

test("non-discuss features still gate empty prompts", () => {
  const result = promptQualityDecision("", "code");
  assert.equal(result.ok, false);
});

test("accepts case-insensitive verbs (mixed case)", () => {
  // The action-only regex uses /i; "FIX" alone should still gate.
  const result = promptQualityDecision("FIX");
  assert.equal(result.ok, false);
});

test("does not gate when the prompt is clearly contextual", () => {
  const result = promptQualityDecision("fix the navbar overflow on mobile");
  assert.equal(result.ok, true);
});
