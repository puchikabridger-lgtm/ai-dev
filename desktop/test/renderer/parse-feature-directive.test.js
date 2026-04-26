// Tests for parseFeatureDirective.
//
// Covers /code, /plan, /todolist, /discuss prefix parsing — including
// case-insensitivity and the activeFeature fallback when no slash command
// is present.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { parseFeatureDirective, state } = require("./_loader.js");


test("recognises /code", () => {
  const result = parseFeatureDirective("/code add a button to the toolbar");
  assert.equal(result.feature, "code");
  assert.equal(result.prompt, "add a button to the toolbar");
});

test("recognises /plan", () => {
  const result = parseFeatureDirective("/plan migration to TS");
  assert.equal(result.feature, "plan");
  assert.equal(result.prompt, "migration to TS");
});

test("recognises /todolist", () => {
  const result = parseFeatureDirective("/todolist refactor module loader");
  assert.equal(result.feature, "todolist");
  assert.equal(result.prompt, "refactor module loader");
});

test("recognises /discuss", () => {
  const result = parseFeatureDirective("/discuss what should we name this?");
  assert.equal(result.feature, "discuss");
  assert.equal(result.prompt, "what should we name this?");
});

test("matches uppercase feature directives", () => {
  const result = parseFeatureDirective("/CODE upgrade dependencies");
  assert.equal(result.feature, "code");
  assert.equal(result.prompt, "upgrade dependencies");
});

test("falls back to activeFeature when no slash command is present", () => {
  state.activeFeature = "plan";
  try {
    const result = parseFeatureDirective("upgrade dependencies");
    assert.equal(result.feature, "plan");
    assert.equal(result.prompt, "upgrade dependencies");
  } finally {
    state.activeFeature = "auto";
  }
});

test("falls back to 'auto' when activeFeature is unknown", () => {
  state.activeFeature = "garbage";
  try {
    const result = parseFeatureDirective("upgrade dependencies");
    assert.equal(result.feature, "auto");
  } finally {
    state.activeFeature = "auto";
  }
});

test("does NOT match a slash that is not a known feature", () => {
  // /foobar isn't one of the four — should not be stripped.
  const result = parseFeatureDirective("/foobar do the thing");
  assert.equal(result.feature, "auto");
  assert.equal(result.prompt, "/foobar do the thing");
});

test("requires a word boundary after the directive", () => {
  // /codex should NOT match /code.
  const result = parseFeatureDirective("/codex hello");
  assert.equal(result.feature, "auto");
  assert.equal(result.prompt, "/codex hello");
});

test("trims surrounding whitespace from the prompt body", () => {
  const result = parseFeatureDirective("/code    add a thing  ");
  assert.equal(result.feature, "code");
  assert.equal(result.prompt, "add a thing");
});

test("handles empty / whitespace-only input gracefully", () => {
  const empty = parseFeatureDirective("");
  assert.equal(empty.feature, "auto");
  assert.equal(empty.prompt, "");

  const blank = parseFeatureDirective("   ");
  assert.equal(blank.feature, "auto");
  assert.equal(blank.prompt, "");
});

test("/code with no body returns empty prompt", () => {
  const result = parseFeatureDirective("/code");
  assert.equal(result.feature, "code");
  assert.equal(result.prompt, "");
});
