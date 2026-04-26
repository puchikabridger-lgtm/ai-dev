// Tests for compactChatHistory and normalizeChatMessages.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { compactChatHistory, normalizeChatMessages } = require("./_loader.js");


function makeChat(extra = {}) {
  return {
    id: "c1",
    title: "test",
    chatHistory: { supervisor: [], direct: [] },
    summary: {},
    createdAt: 1_700_000_000_000,
    ...extra,
  };
}


test("compactChatHistory leaves short histories alone", () => {
  const chat = makeChat();
  for (let i = 0; i < 8; i += 1) {
    chat.chatHistory.supervisor.push({ role: i % 2 ? "assistant" : "user", content: `m${i}` });
  }
  compactChatHistory(chat, "supervisor");
  assert.equal(chat.chatHistory.supervisor.length, 8);
  assert.equal(chat.summary.supervisor, undefined);
});

test("compactChatHistory keeps the latest 6 entries when the history exceeds 10", () => {
  const chat = makeChat();
  for (let i = 0; i < 20; i += 1) {
    chat.chatHistory.supervisor.push({ role: i % 2 ? "assistant" : "user", content: `m${i}` });
  }
  compactChatHistory(chat, "supervisor");
  assert.equal(chat.chatHistory.supervisor.length, 6);
  // Last preserved entry should be m19 (since slice(-6) keeps tail).
  assert.equal(chat.chatHistory.supervisor.at(-1).content, "m19");
  assert.equal(chat.chatHistory.supervisor[0].content, "m14");
});

test("compactChatHistory writes a digest summary for the older entries", () => {
  const chat = makeChat();
  for (let i = 0; i < 20; i += 1) {
    chat.chatHistory.supervisor.push({ role: i % 2 ? "assistant" : "user", content: `m${i}` });
  }
  compactChatHistory(chat, "supervisor");
  assert.ok(typeof chat.summary.supervisor === "string");
  assert.ok(chat.summary.supervisor.length > 0);
  // The summary collapses whitespace and is sliced to 700 chars max.
  assert.ok(chat.summary.supervisor.length <= 703); // 700 + "..." sentinel.
});

test("compactChatHistory caps the digest at 700 chars + ellipsis", () => {
  const chat = makeChat();
  // Build long messages to ensure the slice path fires.
  for (let i = 0; i < 20; i += 1) {
    chat.chatHistory.supervisor.push({
      role: i % 2 ? "assistant" : "user",
      content: "x".repeat(200),
    });
  }
  compactChatHistory(chat, "supervisor");
  assert.ok(chat.summary.supervisor.endsWith("..."));
  assert.equal(chat.summary.supervisor.length, 703);
});

test("compactChatHistory ignores non-user/assistant entries", () => {
  const chat = makeChat();
  for (let i = 0; i < 20; i += 1) {
    chat.chatHistory.supervisor.push({ role: i % 2 ? "assistant" : "user", content: `m${i}` });
  }
  // Inject some system entries — they should not be counted.
  for (let i = 0; i < 5; i += 1) {
    chat.chatHistory.supervisor.push({ role: "system", content: `sys${i}` });
  }
  compactChatHistory(chat, "supervisor");
  // After filter (user/assistant only) we had 20, slice(-6) -> 6 left.
  assert.equal(chat.chatHistory.supervisor.length, 6);
  assert.ok(chat.chatHistory.supervisor.every((item) => item.role === "user" || item.role === "assistant"));
});

test("compactChatHistory operates per-mode (supervisor vs direct)", () => {
  const chat = makeChat();
  for (let i = 0; i < 20; i += 1) {
    chat.chatHistory.supervisor.push({ role: i % 2 ? "assistant" : "user", content: `s${i}` });
  }
  for (let i = 0; i < 4; i += 1) {
    chat.chatHistory.direct.push({ role: i % 2 ? "assistant" : "user", content: `d${i}` });
  }
  compactChatHistory(chat, "supervisor");
  assert.equal(chat.chatHistory.supervisor.length, 6);
  assert.equal(chat.chatHistory.direct.length, 4, "other mode is untouched");
});


test("normalizeChatMessages returns existing messages when present", () => {
  const chat = makeChat({ messages: [{ role: "user", content: "hi" }] });
  const out = normalizeChatMessages(chat);
  assert.equal(out.length, 1);
  assert.equal(out[0].content, "hi");
});

test("normalizeChatMessages merges legacy supervisor + direct histories chronologically", () => {
  const chat = makeChat();
  chat.chatHistory.supervisor.push({ role: "user", content: "u1", createdAt: 100 });
  chat.chatHistory.supervisor.push({ role: "assistant", content: "a1", createdAt: 200 });
  chat.chatHistory.direct.push({ role: "user", content: "u2", createdAt: 150 });
  chat.chatHistory.direct.push({ role: "assistant", content: "a2", createdAt: 250 });
  const out = normalizeChatMessages(chat);
  assert.deepEqual(
    out.map((m) => m.content),
    ["u1", "u2", "a1", "a2"],
    "merged in createdAt order",
  );
});

test("normalizeChatMessages tags each message with its mode", () => {
  const chat = makeChat();
  chat.chatHistory.supervisor.push({ role: "user", content: "u1", createdAt: 100 });
  chat.chatHistory.direct.push({ role: "assistant", content: "a1", createdAt: 200 });
  const out = normalizeChatMessages(chat);
  assert.equal(out.find((m) => m.content === "u1").mode, "supervisor");
  assert.equal(out.find((m) => m.content === "a1").mode, "direct");
});

test("normalizeChatMessages drops empty/whitespace-only entries", () => {
  const chat = makeChat();
  chat.chatHistory.supervisor.push({ role: "user", content: "", createdAt: 100 });
  chat.chatHistory.supervisor.push({ role: "user", content: "   ", createdAt: 110 });
  chat.chatHistory.supervisor.push({ role: "user", content: "real", createdAt: 120 });
  const out = normalizeChatMessages(chat);
  assert.equal(out.length, 1);
  assert.equal(out[0].content, "real");
});

test("normalizeChatMessages caches the result on chat.messages", () => {
  const chat = makeChat();
  chat.chatHistory.supervisor.push({ role: "user", content: "hello", createdAt: 100 });
  const first = normalizeChatMessages(chat);
  assert.equal(chat.messages, first, "result is stored on the chat");
  const second = normalizeChatMessages(chat);
  assert.equal(first, second, "second call returns the cached value");
});

test("normalizeChatMessages handles a chat with no history at all", () => {
  const chat = makeChat();
  const out = normalizeChatMessages(chat);
  assert.deepEqual(out, []);
});

test("normalizeChatMessages aligns paired supervisor-user / direct-assistant runs", () => {
  // The aligned-pairs branch fires when supervisor only has users and direct
  // only has assistants and counts match — typical of the pre-merge data shape.
  const chat = makeChat();
  chat.chatHistory.supervisor.push({ role: "user", content: "q1", createdAt: 100 });
  chat.chatHistory.supervisor.push({ role: "user", content: "q2", createdAt: 200 });
  chat.chatHistory.direct.push({ role: "assistant", content: "a1", createdAt: 0 });
  chat.chatHistory.direct.push({ role: "assistant", content: "a2", createdAt: 0 });
  const out = normalizeChatMessages(chat);
  assert.deepEqual(out.map((m) => `${m.mode}:${m.content}`), [
    "supervisor:q1",
    "direct:a1",
    "supervisor:q2",
    "direct:a2",
  ]);
});
