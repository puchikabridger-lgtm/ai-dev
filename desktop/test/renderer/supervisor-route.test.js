// Tests for supervisorRouteDecision — the supervisor-vs-direct router.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { supervisorRouteDecision, state } = require("./_loader.js");


function resetChat() {
  state.chats = [
    {
      id: "chat-1",
      title: "Test chat",
      drafts: { supervisor: "", direct: "" },
      chatHistory: { supervisor: [], direct: [] },
      attachments: { supervisor: [], direct: [] },
      createdAt: Date.now(),
    },
  ];
  state.activeChatId = "chat-1";
}


test("/code always routes through supervisor", () => {
  resetChat();
  const result = supervisorRouteDecision("anything", [], "code");
  assert.equal(result.useSupervisor, true);
  assert.match(result.reason, /\/code/);
});

test("/plan always routes through supervisor", () => {
  resetChat();
  const result = supervisorRouteDecision("anything", [], "plan");
  assert.equal(result.useSupervisor, true);
  assert.match(result.reason, /\/plan/);
});

test("/todolist always routes through supervisor", () => {
  resetChat();
  const result = supervisorRouteDecision("anything", [], "todolist");
  assert.equal(result.useSupervisor, true);
  assert.match(result.reason, /\/todolist/);
});

test("/discuss skips supervisor", () => {
  resetChat();
  const result = supervisorRouteDecision("anything", [], "discuss");
  assert.equal(result.useSupervisor, false);
  assert.match(result.reason, /\/discuss/);
});

test("auto: code-signal keyword routes through supervisor", () => {
  resetChat();
  const result = supervisorRouteDecision("please fix the failing test in the api module");
  assert.equal(result.useSupervisor, true);
  assert.match(result.reason, /code/i);
});

test("auto: non-code-signal keyword skips supervisor", () => {
  resetChat();
  const result = supervisorRouteDecision("explain how this estimate compares to last month");
  assert.equal(result.useSupervisor, false);
});

test("auto: ambiguous prompt defaults to supervisor (safe fallback)", () => {
  resetChat();
  const result = supervisorRouteDecision("hello there friend");
  assert.equal(result.useSupervisor, true);
  assert.match(result.reason, /ambiguous/i);
});

test("auto: a code-extension attachment routes through supervisor", () => {
  resetChat();
  const result = supervisorRouteDecision("hello there friend", [{ ext: ".js", path: "/x/y.js" }]);
  assert.equal(result.useSupervisor, true);
});

test("auto: a non-code attachment alone does not flip the router", () => {
  resetChat();
  const result = supervisorRouteDecision(
    "explain how this estimate compares to last month",
    [{ ext: ".png", path: "/x/y.png" }],
  );
  assert.equal(result.useSupervisor, false);
});

test("auto: code-signal in chat history pulls the router toward supervisor", () => {
  resetChat();
  state.chats[0].chatHistory.supervisor = [
    { role: "user", content: "build a refactor branch", createdAt: Date.now() },
  ];
  const result = supervisorRouteDecision("ok carry on");
  assert.equal(result.useSupervisor, true);
});

test("auto: russian code-signal also routes to supervisor", () => {
  resetChat();
  const result = supervisorRouteDecision("исправь баг в модуле авторизации");
  assert.equal(result.useSupervisor, true);
});

test("auto: russian non-code signal skips supervisor", () => {
  resetChat();
  const result = supervisorRouteDecision("объясни как это работает");
  assert.equal(result.useSupervisor, false);
});

test("auto: no prompt + no attachments + empty history defaults to supervisor", () => {
  resetChat();
  const result = supervisorRouteDecision("", [], "auto");
  assert.equal(result.useSupervisor, true);
});
