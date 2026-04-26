// Test loader for desktop/src/renderer/app.js.
//
// app.js is a renderer-context script: it has no require/module access in
// production (nodeIntegration is false in main.js). It expects DOM globals
// (`document`, `window`) and uses `window.aidev.*` (the preload bridge) for
// IPC. At the bottom it calls `boot().catch(error => { document.body.innerHTML = ... })`.
//
// To unit-test pure helpers like parseFeatureDirective / promptQualityDecision /
// compactChatHistory / normalizeChatMessages / supervisorRouteDecision without
// editing the production source, we:
//
// 1. Read the file source from disk.
// 2. Append a single `module.exports = { ... }` line in-memory listing the
//    helpers (and `state`) we want to surface. The on-disk file is untouched.
// 3. Compile and run the augmented source in a Node `vm` context with stub
//    globals so the require chain at the top doesn't blow up.
// 4. Stub window.aidev with no-op IPC so boot() fails fast in a tolerable way;
//    document.body has a writable innerHTML so the boot catch handler doesn't
//    throw.
// 5. Return module.exports.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RENDERER_SRC = path.resolve(__dirname, "..", "..", "src", "renderer", "app.js");

const EXPORT_NAMES = [
  "parseFeatureDirective",
  "promptQualityDecision",
  "compactChatHistory",
  "normalizeChatMessages",
  "supervisorRouteDecision",
  "state",
  "currentChat",
  "featureLabel",
  "featureInstruction",
  "extractRunSummary",
  "summarizePatch",
  "approvalGate",
];

function makeElementStub() {
  const node = {
    id: "",
    className: "",
    textContent: "",
    innerHTML: "",
    value: "",
    style: {},
    dataset: {},
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute() {},
    getAttribute() { return null; },
    focus() {},
    click() {},
    scrollIntoView() {},
  };
  return node;
}

function load() {
  const source = fs.readFileSync(RENDERER_SRC, "utf8");
  const augmented = `${source}\n;module.exports = { ${EXPORT_NAMES.join(", ")} };\n`;

  const documentStub = {
    body: makeElementStub(),
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return makeElementStub(); },
    createDocumentFragment() { return makeElementStub(); },
  };
  const windowStub = {
    addEventListener() {},
    removeEventListener() {},
    aidev: new Proxy({}, {
      get() {
        // Any window.aidev.* invocation in tests becomes a noop returning a
        // never-resolving promise so background calls don't throw.
        return () => new Promise(() => {});
      },
    }),
  };

  const moduleObj = { exports: {} };

  // Wrap the source in a function call so it executes in the HOST realm
  // (rather than a vm-created realm). That makes objects/arrays the source
  // returns share prototypes with the test process, which is what
  // node:assert.deepStrictEqual expects when comparing against host literals.
  // We feed in the few globals the source touches at module load.
  const wrapped =
    `(function(module, exports, document, window) {\n${augmented}\n})`;
  const factory = vm.runInThisContext(wrapped, { filename: RENDERER_SRC });
  factory(moduleObj, moduleObj.exports, documentStub, windowStub);

  return moduleObj.exports;
}

module.exports = load();
