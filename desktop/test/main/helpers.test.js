// Pure-helper unit tests for desktop/src/main.js.
//
// These exercise functions that have no project-state dependency (no
// settings(), no projectRoot()). For helpers that DO touch project state
// (listRuns, validationCommandForRun, nowRunId-shape) see the dedicated
// test files in this directory.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const main = require("./_loader.js");


test("normalizeModelName aliases gpt-5.4-pro to gpt-5.5", () => {
  assert.equal(main.normalizeModelName("gpt-5.4-pro"), "gpt-5.5");
});

test("normalizeModelName trims whitespace", () => {
  assert.equal(main.normalizeModelName("  gpt-5.4-mini  "), "gpt-5.4-mini");
});

test("normalizeModelName passes through unknown values", () => {
  assert.equal(main.normalizeModelName("custom-model"), "custom-model");
});

test("normalizeModelName handles null/undefined", () => {
  assert.equal(main.normalizeModelName(null), "");
  assert.equal(main.normalizeModelName(undefined), "");
  assert.equal(main.normalizeModelName(""), "");
});


test("allowedModelSet always contains the three built-in models", () => {
  const allowed = main.allowedModelSet({ modelCatalog: [] });
  assert.ok(allowed.has("gpt-5.4-mini"));
  assert.ok(allowed.has("gpt-5.4"));
  assert.ok(allowed.has("gpt-5.5"));
});

test("allowedModelSet adds enabled catalog entries", () => {
  const allowed = main.allowedModelSet({
    modelCatalog: [
      { model: "custom-a", enabled: true },
      { model: "custom-b", enabled: false },
      { model: "  custom-c  ", enabled: true },
    ],
  });
  assert.ok(allowed.has("custom-a"));
  assert.ok(!allowed.has("custom-b"), "disabled entries must be skipped");
  assert.ok(allowed.has("custom-c"), "trimmed model names should be added");
});

test("allowedModelSet falls back to DEFAULT_SETTINGS catalog when input is empty", () => {
  const allowed = main.allowedModelSet({ modelCatalog: [] });
  // Built-in default catalog includes gpt-5.4-mini / gpt-5.4 / gpt-5.5 already.
  assert.ok(allowed.has("gpt-5.4-mini"));
  assert.ok(allowed.has("gpt-5.4"));
});


test("attachmentKind classifies common image extensions", () => {
  for (const file of ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.bmp", "g.ico"]) {
    assert.equal(main.attachmentKind(file), "image", file);
  }
});

test("attachmentKind classifies office documents", () => {
  for (const file of ["doc.pdf", "x.docx", "y.xlsx", "z.pptx"]) {
    assert.equal(main.attachmentKind(file), "document", file);
  }
});

test("attachmentKind classifies archives", () => {
  for (const file of ["pkg.zip", "src.tar", "blob.gz", "snap.7z", "log.rar"]) {
    assert.equal(main.attachmentKind(file), "archive", file);
  }
});

test("attachmentKind falls back to file for unknown extensions", () => {
  assert.equal(main.attachmentKind("readme.md"), "file");
  assert.equal(main.attachmentKind("noext"), "file");
});


test("isReadableTextAttachment recognizes common code/text extensions", () => {
  for (const ext of [".js", ".ts", ".md", ".json", ".py", ".html", ".yaml", ".sql"]) {
    assert.equal(main.isReadableTextAttachment(`file${ext}`), true, ext);
  }
});

test("isReadableTextAttachment rejects images and binaries", () => {
  for (const ext of [".png", ".pdf", ".zip", ".docx", ".bin", ".exe"]) {
    assert.equal(main.isReadableTextAttachment(`file${ext}`), false, ext);
  }
});


test("normalizeRel converts platform separators to forward slashes", () => {
  assert.equal(main.normalizeRel("a/b/c"), "a/b/c");
  // Use path.sep replacement explicitly so the test is portable.
  const path = require("node:path");
  const sample = ["a", "b", "c"].join(path.sep);
  assert.equal(main.normalizeRel(sample), "a/b/c");
});


test("isSnapshotIgnored matches well-known directories", () => {
  for (const rel of ["node_modules/foo.js", ".git/HEAD", "dist/index.js", "build/out.js", "__pycache__/x.py"]) {
    assert.equal(main.isSnapshotIgnored(rel), true, rel);
  }
});

test("isSnapshotIgnored matches well-known runtime paths", () => {
  for (const rel of [".ai/runs/123/audit.json", ".ai/desktop/settings.json", ".ai/budget/ledger.jsonl"]) {
    assert.equal(main.isSnapshotIgnored(rel), true, rel);
  }
});

test("isSnapshotIgnored matches log/tmp/bak extensions", () => {
  for (const rel of ["a.log", "b.tmp", "c.bak"]) {
    assert.equal(main.isSnapshotIgnored(rel), true, rel);
  }
});

test("isSnapshotIgnored does NOT match ordinary source files", () => {
  for (const rel of ["src/index.js", "README.md", "package.json", "tests/foo.test.js"]) {
    assert.equal(main.isSnapshotIgnored(rel), false, rel);
  }
});

test("isSnapshotIgnored handles empty/whitespace input", () => {
  assert.equal(main.isSnapshotIgnored(""), false);
  assert.equal(main.isSnapshotIgnored("/"), false);
});


test("modelContextLimit returns 1M+ for gpt-4.1", () => {
  assert.equal(main.modelContextLimit("gpt-4.1-mini"), 1047576);
});

test("modelContextLimit returns 128k for gpt-5 family", () => {
  assert.equal(main.modelContextLimit("gpt-5.4-mini"), 128000);
  assert.equal(main.modelContextLimit("gpt-5.5"), 128000);
});

test("modelContextLimit returns 128k default for unknown models", () => {
  assert.equal(main.modelContextLimit("anthropic-claude"), 128000);
  assert.equal(main.modelContextLimit(""), 128000);
});


test("modelTokenPrices returns the gpt-5.4-mini row", () => {
  const prices = main.modelTokenPrices("gpt-5.4-mini");
  assert.ok(prices);
  assert.equal(prices.input, 0.75);
  assert.equal(prices.output, 4.5);
});

test("modelTokenPrices returns the gpt-5.4 row", () => {
  const prices = main.modelTokenPrices("gpt-5.4");
  assert.ok(prices);
  assert.equal(prices.input, 2.5);
  assert.equal(prices.output, 15);
});

test("modelTokenPrices uses longest-prefix match (mini before main)", () => {
  // 'gpt-5.4-mini' is more specific than 'gpt-5.4'; ensure a model name that
  // contains both substrings hits the more specific one.
  const prices = main.modelTokenPrices("custom-gpt-5.4-mini-experimental");
  assert.ok(prices);
  assert.equal(prices.input, 0.75, "should match gpt-5.4-mini, not gpt-5.4");
});

test("modelTokenPrices returns null for unknown models", () => {
  assert.equal(main.modelTokenPrices("anthropic-claude"), null);
  assert.equal(main.modelTokenPrices(""), null);
});


test("tokenCost returns zero estimate for unknown models", () => {
  const result = main.tokenCost("anthropic-claude", 1000, 500, "estimate");
  assert.equal(result.estimated_usd, 0);
  assert.equal(result.actual_usd, null);
  assert.equal(result.source, "no_model_price");
});

test("tokenCost computes estimate from per-1M rates", () => {
  // gpt-5.4-mini: input 0.75/1M, output 4.5/1M. Use 200k tokens each (< 272k
  // long-context threshold) so we get the plain rate with no multiplier.
  const result = main.tokenCost("gpt-5.4-mini", 200_000, 200_000, "estimate");
  // (200_000 * 0.75 + 200_000 * 4.5) / 1_000_000 = 1.05.
  assert.equal(result.estimated_usd, 1.05);
  assert.equal(result.confidence, "medium");
  assert.equal(result.actual_usd, null, "estimate source -> null actual_usd");
  assert.equal(result.source, "token_price_estimate");
});

test("tokenCost reports actual_usd when source is codex_cli", () => {
  const result = main.tokenCost("gpt-5.4-mini", 100_000, 50_000, "codex_cli");
  assert.notEqual(result.actual_usd, null);
  assert.equal(result.source, "codex_cli_tokens_x_configured_price");
  assert.equal(result.confidence, "high");
});

test("tokenCost applies long-context multiplier above 272k tokens for gpt-5.4", () => {
  // gpt-5.4 has the long-context multiplier: input 2x, output 1.5x.
  const short = main.tokenCost("gpt-5.4", 100_000, 100_000, "estimate");
  const long = main.tokenCost("gpt-5.4", 300_000, 300_000, "estimate");
  // Long-context input multiplier alone makes the long estimate larger per
  // token. Compare per-token cost.
  const shortPerToken = short.estimated_usd / 200_000;
  const longPerToken = long.estimated_usd / 600_000;
  assert.ok(longPerToken > shortPerToken, "long-context multiplier increases per-token cost");
  assert.equal(long.long_context_multiplier.input, 2);
  assert.equal(long.long_context_multiplier.output, 1.5);
});


test("extractCliTokenUsage falls back to estimate when no usage lines present", () => {
  const usage = main.extractCliTokenUsage("hello world", "");
  assert.equal(usage.source, "estimate");
  assert.equal(usage.input, undefined);
  assert.equal(usage.output, undefined);
});

test("extractCliTokenUsage parses input/output/total from stdout", () => {
  const stdout = "input tokens: 1,234\noutput tokens: 567\ntotal tokens: 1801";
  const usage = main.extractCliTokenUsage(stdout, "");
  assert.equal(usage.source, "codex_cli");
  assert.equal(usage.input, 1234);
  assert.equal(usage.output, 567);
  assert.equal(usage.total, 1801);
});

test("extractCliTokenUsage parses prompt/completion synonyms", () => {
  const stdout = "prompt tokens 250\ncompletion tokens 100";
  const usage = main.extractCliTokenUsage(stdout, "");
  assert.equal(usage.input, 250);
  assert.equal(usage.output, 100);
});

test("extractCliTokenUsage searches stderr too", () => {
  const usage = main.extractCliTokenUsage("", "input tokens: 99");
  assert.equal(usage.input, 99);
  assert.equal(usage.source, "codex_cli");
});


test("formatArg leaves simple identifiers alone", () => {
  assert.equal(main.formatArg("foo.py"), "foo.py");
  assert.equal(main.formatArg("a-b_c"), "a-b_c");
});

test("formatArg quotes paths containing spaces", () => {
  assert.equal(main.formatArg("path with spaces.py"), '"path with spaces.py"');
});

test("formatArg escapes embedded double quotes", () => {
  assert.equal(main.formatArg('odd"name.py'), '"odd\\"name.py"');
});

test("formatArg quotes paths containing shell-meaningful punctuation", () => {
  // Per the regex /\s|[{}":,]/, braces/colons/commas trigger quoting. This
  // protects against accidental shell parsing for argument-style values.
  assert.equal(main.formatArg("a:b"), '"a:b"');
  assert.equal(main.formatArg("a,b"), '"a,b"');
  assert.equal(main.formatArg("{x}"), '"{x}"');
});


test("needsShell only flags .cmd/.bat on Windows", () => {
  if (process.platform === "win32") {
    assert.equal(main.needsShell("npm.cmd"), true);
    assert.equal(main.needsShell("foo.bat"), true);
    assert.equal(main.needsShell("python.exe"), false);
    assert.equal(main.needsShell("/usr/bin/python"), false);
  } else {
    assert.equal(main.needsShell("npm.cmd"), false);
    assert.equal(main.needsShell("foo.bat"), false);
  }
});

test("needsShell handles non-string inputs", () => {
  assert.equal(main.needsShell(null), false);
  assert.equal(main.needsShell(undefined), false);
});


test("providerForModel returns lowercase provider for matching catalog entry", () => {
  const merged = {
    modelCatalog: [
      { model: "gpt-5.4-mini", provider: "OpenAI" },
      { model: "local-llama", provider: "LM-Studio" },
    ],
  };
  assert.equal(main.providerForModel(merged, "gpt-5.4-mini"), "openai");
  assert.equal(main.providerForModel(merged, "local-llama"), "lm-studio");
});

test("providerForModel returns empty string when no match", () => {
  assert.equal(main.providerForModel({ modelCatalog: [] }, "anything"), "");
  assert.equal(main.providerForModel({}, "anything"), "");
});


test("providerBaseUrl returns lmstudio default when provider is lmstudio", () => {
  const url = main.providerBaseUrl({ auth: {} }, "lmstudio");
  assert.equal(url, "http://127.0.0.1:1234/v1");
});

test("providerBaseUrl honors auth.lmStudioUrl when set", () => {
  const url = main.providerBaseUrl({ auth: { lmStudioUrl: "http://lan-host:1234/v1" } }, "lmstudio");
  assert.equal(url, "http://lan-host:1234/v1");
});

test("providerBaseUrl returns auth.localModelUrl for local provider", () => {
  const url = main.providerBaseUrl({ auth: { localModelUrl: "http://127.0.0.1:11434/v1" } }, "local");
  assert.equal(url, "http://127.0.0.1:11434/v1");
});

test("providerBaseUrl returns empty string for unrecognised provider", () => {
  assert.equal(main.providerBaseUrl({ auth: {} }, "openai"), "");
  assert.equal(main.providerBaseUrl({ auth: {} }, ""), "");
});


test("commandExists returns false for an obviously bogus name", () => {
  // "definitely-not-a-real-tool-xyz123" must not exist on PATH.
  assert.equal(main.commandExists("definitely-not-a-real-tool-xyz123"), false);
});

test("commandExists returns false for empty input", () => {
  assert.equal(main.commandExists(""), false);
  assert.equal(main.commandExists(null), false);
});
