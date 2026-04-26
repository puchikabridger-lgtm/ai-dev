const state = {
  settings: {},
  runs: [],
  selectedRun: null,
  mode: "supervisor",
  activeChatId: "chat-1",
  chats: [
    {
      id: "chat-1",
      title: "New chat",
      html: "",
      drafts: { supervisor: "", direct: "" },
      chatHistory: { supervisor: [], direct: [] },
      attachments: { supervisor: [], direct: [] },
      createdAt: Date.now(),
    },
  ],
  drafts: {
    supervisor: "",
    direct: "",
  },
  chatHistory: {
    supervisor: [],
    direct: [],
  },
  root: "",
  projects: [],
  memory: {},
  projectIndex: {},
  budget: {},
  config: {},
  activeRun: false,
  currentProcess: null,
  processLog: "",
  liveOutput: {},
  pendingPrompt: "",
  pendingAttachments: [],
  pendingRunRequest: null,
  activeFeature: "auto",
  workspaceMode: "project",
  currentRunId: "",
  pendingClientStartedAt: 0,
  terminal: {
    open: false,
    cwd: "",
    history: [],
    historyIndex: null,
    suggestion: "",
    running: false,
  },
  runOptions: {
    approveHigh: false,
    forceBudget: false,
  },
};

const DETACHED_CHAT_KEY = "__detached_chats__";

function reasoningLabel(reasoning) {
  if (reasoning === "none") return "none";
  if (reasoning === "xhigh") return "extra high";
  return reasoning || "low";
}

let saveSettingsTimer = null;
let saveBudgetTimer = null;
let saveUiTimer = null;

const $ = (id) => document.getElementById(id);

let sendClickCount = 0;

function setSendStatus(text, kind = "info") {
  const node = $("sendStatus");
  if (!node) return;
  node.textContent = text;
  node.dataset.kind = kind;
}

// This is intentionally independent from the normal app flow. If Send is clicked,
// this status must change even when backend wiring fails later.
document.addEventListener("click", (event) => {
  if (event.target?.id !== "sendButton") return;
  sendClickCount += 1;
  setSendStatus(`Send clicked (${sendClickCount}). Checking input...`);
}, true);

window.addEventListener("error", (event) => {
  setSendStatus(`UI error: ${event.message}`, "error");
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason?.message || String(event.reason || "Unknown error");
  setSendStatus(`UI error: ${reason}`, "error");
});

const toggles = [
  ["scopeGuard", "Scope Guard", "Warn when Codex changes more than the task likely needs."],
  ["budgetGuard", "Budget Guard", "Block expensive runs before they start."],
  ["askHigh", "Ask before high/extra high", "Require approval before expensive reasoning."],
  ["promptImprove", "Prompt improvement", "Include stricter supervisor instructions in contracts."],
  ["projectSummaries", "Project summaries", "Keep compact project memory enabled."],
  ["autoFix", "Auto-fix failures", "Reserved for bounded retry loops."],
  ["visualQa", "Visual QA", "Reserved for UI screenshot and DOM checks."],
  ["localFirst", "Local LLM first", "Reserved for local model routing."],
];

async function boot() {
  setSendStatus("Loading app...");
  const initial = await loadState();
  renderAll(initial);
  attachEvents();
  attachResizers();
  await loadTerminalHistory();
  setSendStatus("Ready");
}

function ensureSettingsShape() {
  state.settings = {
    mode: "supervisor",
    pythonPath: "python",
    codexCommand: "codex",
    projectRoot: state.root || state.settings.projectRoot || "",
    directModel: "gpt-5.4-mini",
    directReasoning: "medium",
    supervisorModel: "gpt-5.4-mini",
    supervisorReasoning: "low",
    supervisorModelMode: "auto",
    supervisorManualModel: "gpt-5.4-mini",
    scopeGuard: true,
    budgetGuard: true,
    askHigh: true,
    promptImprove: true,
    projectSummaries: true,
    autoFix: false,
    visualQa: false,
    localFirst: false,
    notifyOnFinish: false,
    useCodexLogin: true,
    auth: {
      openaiApiKey: "",
      anthropicApiKey: "",
      openaiBaseUrl: "https://api.openai.com/v1",
      localModelUrl: "http://127.0.0.1:11434/v1",
      lmStudioUrl: "http://127.0.0.1:1234/v1",
    },
    modelCatalog: [
      { id: "builtin-mini", label: "gpt-5.4 mini", model: "gpt-5.4-mini", provider: "openai", reasoning: "low", mode: "both", taskTags: ["default", "none", "low"], enabled: true },
      { id: "builtin-main", label: "gpt-5.4", model: "gpt-5.4", provider: "openai", reasoning: "medium", mode: "both", taskTags: ["ui", "bugfix", "feature", "medium"], enabled: true },
      { id: "builtin-max", label: "gpt-5.5", model: "gpt-5.5", provider: "openai", reasoning: "high", mode: "supervisor", taskTags: ["high", "xhigh", "auth", "architecture"], enabled: true },
    ],
    layout: { sidebarWidth: 292, inspectorWidth: 340 },
    projectRegistry: [],
    chatSessions: {},
    defaultProjectsDir: "",
    model: "gpt-5.4-mini",
    reasoning: "medium",
    ...state.settings,
  };
  state.settings.auth = {
    openaiApiKey: "",
    anthropicApiKey: "",
    openaiBaseUrl: "https://api.openai.com/v1",
    localModelUrl: "http://127.0.0.1:11434/v1",
    lmStudioUrl: "http://127.0.0.1:1234/v1",
    ...(state.settings.auth || {}),
  };
  if (!Array.isArray(state.settings.modelCatalog) || !state.settings.modelCatalog.length) {
    state.settings.modelCatalog = [
      { id: "builtin-mini", label: "gpt-5.4 mini", model: "gpt-5.4-mini", provider: "openai", reasoning: "low", mode: "both", taskTags: ["default", "none", "low"], enabled: true },
      { id: "builtin-main", label: "gpt-5.4", model: "gpt-5.4", provider: "openai", reasoning: "medium", mode: "both", taskTags: ["ui", "bugfix", "feature", "medium"], enabled: true },
      { id: "builtin-max", label: "gpt-5.5", model: "gpt-5.5", provider: "openai", reasoning: "high", mode: "supervisor", taskTags: ["high", "xhigh", "auth", "architecture"], enabled: true },
    ];
  }
  if (!state.settings.directModel) state.settings.directModel = state.settings.model || "gpt-5.4-mini";
  if (!state.settings.supervisorModel) state.settings.supervisorModel = "gpt-5.4-mini";
  if (!state.settings.directReasoning) state.settings.directReasoning = "medium";
  if (!state.settings.supervisorReasoning) state.settings.supervisorReasoning = "low";
  if (!state.settings.supervisorModelMode) state.settings.supervisorModelMode = "auto";
  if (!state.settings.supervisorManualModel) state.settings.supervisorManualModel = state.settings.supervisorModel || "gpt-5.4-mini";
  if (!state.settings.layout) state.settings.layout = { sidebarWidth: 292, inspectorWidth: 340 };
  if (!Array.isArray(state.settings.projectRegistry)) state.settings.projectRegistry = [];
  if (!state.settings.chatSessions || typeof state.settings.chatSessions !== "object") state.settings.chatSessions = {};
}

async function loadState() {
  const next = await window.aidev.getState();
  state.root = next.root;
  state.settings = next.settings;
  state.runs = next.runs;
  state.budget = next.budget || {};
  state.config = normalizeConfig(next.config || {});
  state.memory = next.memory || {};
  state.projectIndex = next.projectIndex || {};
  ensureSettingsShape();
  state.projects = normalizeProjects(state.settings.projectRegistry);
  loadProjectChats();
  return next;
}

function renderAll(initial = {}) {
  $("projectName").textContent = shortPath(initial.root || "");
  $("budgetPill").textContent = budgetLabel(initial.budget || {});
  $("codexPill").textContent = initial.discovered?.codex_cli ? "Codex ready" : "Codex unknown";
  renderRuns();
  renderDashboard();
  renderToggles();
  renderBudget(initial.budget || state.budget || {});
  fillSettings();
  renderAuth();
  renderChatNavigation();
  renderProjectSidebar();
  applyLayout();
  renderAttachmentTray();
  updateContextMeter();
  restoreActiveChatDom();
  syncModePanel();
  resizePrompt();
  renderInspector();
  updateRunControls();
  renderTerminal();
}

function attachEvents() {
  document.querySelectorAll(".top-tab").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  document.querySelectorAll(".mode").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  $("sendButton").addEventListener("click", () => submit());
  $("terminalToggle").addEventListener("click", () => toggleTerminal());
  $("terminalPickCwd").addEventListener("click", pickTerminalCwd);
  $("terminalStop").addEventListener("click", stopTerminal);
  $("terminalClear").addEventListener("click", () => {
    $("terminalOutput").textContent = "";
  });
  $("terminalInput").addEventListener("input", updateTerminalSuggestion);
  $("terminalInput").addEventListener("keydown", handleTerminalKeydown);
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "j") {
      event.preventDefault();
      toggleTerminal();
    }
  });
  $("attachButton").addEventListener("click", addAttachments);
  document.querySelectorAll(".feature-chip").forEach((button) => {
    button.addEventListener("click", () => setFeature(button.dataset.feature || "auto"));
  });
  $("newChatButton").addEventListener("click", () => newChat());
  $("openDetachedChats").addEventListener("click", () => switchDetachedChats());
  $("startScratchProject").addEventListener("click", startScratchProject);
  $("useExistingProject").addEventListener("click", openProject);
  $("refreshProjectSummary").addEventListener("click", refreshActiveProjectSummary);
  $("rebuildProjectIndex").addEventListener("click", rebuildProjectIndex);
  $("chatTitleInput").addEventListener("input", () => {
    currentChat().title = $("chatTitleInput").value.trim() || "Chat";
    currentChat().updatedAt = Date.now();
    renderChatNavigation();
    renderProjectSidebar();
    scheduleUiSave();
  });
  $("stopButton").addEventListener("click", () => window.aidev.stop());
  $("openRuns").addEventListener("click", () => openPath(`${state.root}\\.ai\\runs`));
  $("openProject").addEventListener("click", openProject);
  $("newProject").addEventListener("click", newProject);
  $("addModel").addEventListener("click", addModelFromForm);
  $("loadLmStudioModels").addEventListener("click", loadLmStudioModels);
  $("runDiagnostics").addEventListener("click", runDiagnostics);
  $("openProjectFolder").addEventListener("click", () => openPath(state.root));
  $("openAiFolder").addEventListener("click", () => openPath(`${state.root}\\.ai`));
  $("promptInput").addEventListener("input", () => {
    currentChat().drafts[state.mode] = $("promptInput").value;
    currentChat().updatedAt = Date.now();
    resizePrompt();
    updateContextMeter();
    scheduleUiSave();
  });
  $("promptInput").addEventListener("wheel", (event) => {
    const el = $("promptInput");
    const canScroll = el.scrollHeight > el.clientHeight + 1;
    if (!canScroll) {
      event.preventDefault();
    }
  }, { passive: false });
  $("modeModel").addEventListener("change", () => {
    const current = state.mode === "direct" ? "directModel" : "supervisorModel";
    state.settings[current] = $("modeModel").value.trim();
    if (state.mode === "supervisor") {
      state.settings.supervisorManualModel = $("modeModel").value.trim();
    }
    state.settings.model = state.settings.directModel || state.settings.model;
    scheduleSettingsSave();
    updateContextMeter();
  });
  $("modeReasoning").addEventListener("change", () => {
    const current = state.mode === "direct" ? "directReasoning" : "supervisorReasoning";
    state.settings[current] = $("modeReasoning").value;
    state.settings.reasoning = state.settings.directReasoning || state.settings.reasoning;
    scheduleSettingsSave();
    updateContextMeter();
  });
  ["openaiApiKey", "anthropicApiKey", "openaiBaseUrl", "localModelUrl", "lmStudioUrl", "supervisorModelMode", "supervisorManualModel"].forEach((id) => {
    $(id).addEventListener("input", scheduleSettingsSave);
    $(id).addEventListener("change", scheduleSettingsSave);
  });
  $("useCodexLogin").addEventListener("click", () => {
    state.settings.useCodexLogin = !state.settings.useCodexLogin;
    $("useCodexLogin").classList.toggle("on", Boolean(state.settings.useCodexLogin));
    scheduleSettingsSave();
  });
  $("promptInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.ctrlKey && event.shiftKey) {
      event.preventDefault();
      submit();
    } else if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      submit();
    }
  });

  ["pythonPath", "codexCommand", "sandboxMode", "timeoutSeconds", "executorDefault", "executorComplex", "executorMax"].forEach((id) => {
    $(id).addEventListener("input", scheduleSettingsSave);
    $(id).addEventListener("change", scheduleSettingsSave);
  });
  ["sessionBudget", "requestBudget", "retryBudget", "maxCalls", "dailyCalls", "dailyHighCalls", "dailyXhighCalls", "warnPercent", "blockPercent"].forEach((id) => {
    $(id).addEventListener("input", scheduleBudgetSave);
    $(id).addEventListener("change", scheduleBudgetSave);
  });

  window.aidev.onProcessStart((payload) => {
    state.activeRun = true;
    state.currentProcess = payload;
    state.liveOutput[payload.id] = "";
    state.processLog = `Started: ${payload.title}\n${payload.command}\n\n`;
    setSendStatus(`Started: ${payload.title}`);
    updateRunControls();
    appendCodexStarted(payload);
    renderInspector();
  });
  window.aidev.onProcessOutput((payload) => {
    state.processLog += payload.text;
    appendLiveOutput(payload);
    renderInspector();
  });
  window.aidev.onProcessHeartbeat((payload) => {
    const elapsed = Number(payload.clientElapsedSeconds || payload.elapsedSeconds || 0);
    state.processLog += `Still running... ${elapsed}s elapsed from prompt.\n`;
    setSendStatus(`Still running... ${elapsed}s from prompt`);
    if (elapsed % 30 === 0) {
      appendMessage(targetMessages(payload.id), "system", `Still working... ${elapsed}s from prompt`);
    }
    renderInspector();
  });
  window.aidev.onProcessError((payload) => {
    state.activeRun = false;
    updateRunControls();
    setSendStatus(`Process error: ${humanError(payload.message)}`, "error");
    appendMessage(targetMessages(payload.id), "error", humanError(payload.message));
    state.processLog += `ERROR: ${payload.message}\n`;
    renderInspector();
  });
  window.aidev.onProcessFinish(async (payload) => {
    state.activeRun = false;
    updateRunControls();
    setSendStatus(payload.stopped ? "Stopped." : `Finished with code ${payload.code}`);
    delete state.liveOutput[payload.id];
    state.processLog += `\nFinished with code ${payload.code}${payload.signal ? ` (${payload.signal})` : ""}\n`;
    const messageContainer = $("supervisorMessages");
    const keepScroll = {
      stick: shouldStickToBottom(messageContainer),
      top: messageContainer?.scrollTop || 0,
    };
    document.getElementById(`live-${payload.id}`)?.remove();
    const wasDetached = isDetachedChatMode();
    saveActiveChatDom();
    const refreshed = await loadState();
    if (wasDetached) {
      state.workspaceMode = "chat";
      loadChatsForKey(DETACHED_CHAT_KEY);
    }
    state.runs = payload.runs || refreshed.runs || await window.aidev.listRuns();
    renderRuns();
    state.processLog = "";
    renderAll(refreshed);
    if (wasDetached) {
      state.workspaceMode = "chat";
      loadChatsForKey(DETACHED_CHAT_KEY);
      $("projectName").textContent = "Chats";
      $("viewTitle").textContent = "Chats";
      restoreActiveChatDom();
      renderChatNavigation();
      renderProjectSidebar();
    }
    if (!keepScroll.stick && messageContainer) {
      messageContainer.scrollTop = keepScroll.top;
    }
    if (state.runs[0] && !String(payload.id || "").includes("direct")) {
      state.currentRunId = state.runs[0].id;
      await selectRun(state.runs[0].id);
    }
    if (String(payload.id || "").includes("direct") && payload.code === 0) {
      const latest = wasDetached ? null : (state.runs[0] ? await window.aidev.readRun(state.runs[0].id) : null);
      attachClientTiming(latest, payload);
      appendDirectResult(payload, latest);
      if (latest) {
        state.selectedRun = latest;
        renderInspector();
      }
    }
    await handleFinish(payload);
  });
  window.aidev.onTerminalStart((payload) => {
    state.terminal.running = true;
    terminalWrite(`\n> ${payload.command}\n`, "command");
    renderTerminal();
  });
  window.aidev.onTerminalOutput((payload) => {
    terminalWrite(payload.text, payload.stream);
  });
  window.aidev.onTerminalFinish((payload) => {
    state.terminal.running = false;
    terminalWrite(`\n[exit ${payload.code}${payload.signal ? `, ${payload.signal}` : ""}]\n`, payload.code === 0 ? "system" : "stderr");
    renderTerminal();
  });
  window.aidev.onTerminalError((payload) => {
    state.terminal.running = false;
    terminalWrite(`\n[terminal error] ${payload.message}\n`, "stderr");
    renderTerminal();
  });
}

function applyLayout() {
  const layout = state.settings.layout || {};
  const sidebar = Math.max(220, Math.min(520, Number(layout.sidebarWidth || 292)));
  const inspector = Math.max(260, Math.min(560, Number(layout.inspectorWidth || 340)));
  document.documentElement.style.setProperty("--sidebar-width", `${sidebar}px`);
  document.documentElement.style.setProperty("--inspector-width", `${inspector}px`);
}

function attachResizers() {
  const content = document.querySelector(".content");
  const leftHandle = $("leftResize");
  const rightHandle = $("rightResize");
  if (!content || !leftHandle || !rightHandle) return;
  const startDrag = (handle, side, event) => {
    event.preventDefault();
    handle.classList.add("dragging");
    const rect = content.getBoundingClientRect();
    const move = (moveEvent) => {
      if (side === "left") {
        state.settings.layout.sidebarWidth = Math.max(220, Math.min(520, moveEvent.clientX - rect.left));
      } else {
        state.settings.layout.inspectorWidth = Math.max(260, Math.min(560, rect.right - moveEvent.clientX));
      }
      applyLayout();
    };
    const up = () => {
      handle.classList.remove("dragging");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      scheduleUiSave();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  leftHandle.addEventListener("mousedown", (event) => startDrag(leftHandle, "left", event));
  rightHandle.addEventListener("mousedown", (event) => startDrag(rightHandle, "right", event));
}

function scheduleSettingsSave() {
  if (saveSettingsTimer) clearTimeout(saveSettingsTimer);
  saveSettingsTimer = setTimeout(() => {
    saveSettings().catch((error) => {
      appendMessage($("supervisorMessages"), "error", error.message || String(error));
    });
  }, 400);
}

function scheduleBudgetSave() {
  if (saveBudgetTimer) clearTimeout(saveBudgetTimer);
  saveBudgetTimer = setTimeout(() => {
    saveBudget().catch((error) => {
      appendMessage($("supervisorMessages"), "error", error.message || String(error));
    });
  }, 400);
}

function scheduleUiSave() {
  if (saveUiTimer) clearTimeout(saveUiTimer);
  saveUiTimer = setTimeout(() => {
    saveWorkspaceUi().catch((error) => setSendStatus(`UI save error: ${error.message || error}`, "error"));
  }, 500);
}

function switchView(viewName) {
  document.querySelectorAll(".top-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("view-active"));
  $(`${viewName}View`).classList.add("view-active");
  $("viewTitle").textContent = titleCase(viewName);
}

function setMode(mode) {
  saveActiveChatDom();
  state.mode = mode;
  document.querySelectorAll(".mode").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  $("promptInput").value = currentChat().drafts[mode] || "";
  renderAttachmentTray();
  syncModePanel();
  resizePrompt();
  updateContextMeter();
  updateRunControls();
}

async function submit() {
  setSendStatus("Send handler started.");
  const parsed = parseFeatureDirective($("promptInput").value);
  const prompt = parsed.prompt;
  let feature = parsed.feature;
  if (isDetachedChatMode() && (feature === "code" || feature === "todolist")) {
    feature = "discuss";
    setFeature("discuss");
    appendMessage(targetMessages(state.mode), "system", "Standalone chats are for discussion and planning. Switched this request to /discuss.");
  }
  const attachments = currentAttachments();
  if (!prompt) {
    setSendStatus("Write a prompt first.", "warn");
    appendMessage(targetMessages(state.mode), "error", "Write a prompt first.");
    return;
  }
  if (state.mode !== "direct") {
    const quality = promptQualityDecision(prompt, feature);
    if (!quality.ok) {
      appendClarificationRequest(quality.message);
      setSendStatus("Needs clarification before running.", "clarification");
      return;
    }
  }
  setSendStatus(`Queued in ${featureLabel(feature)} mode.`);
  const clientStartedAt = Date.now();
  state.pendingPrompt = prompt;
  state.pendingAttachments = attachments;
  state.pendingClientStartedAt = clientStartedAt;
  currentChat().drafts[state.mode] = prompt;
  state.currentRunId = "";
  state.processLog = `Queued: ${state.mode}\n`;
  renderInspector();
  if (isDetachedChatMode()) {
    const effectiveFeature = feature === "plan" ? "plan" : "discuss";
    const history = directHistoryForPrompt();
    appendMessage($("supervisorMessages"), "user", userMessageWithAttachments(prompt, attachments));
    rememberChat("direct", "user", prompt);
    appendPipelineStep(`routing: ${effectiveFeature}`, buildPromptPreview(state.mode, prompt, history, attachments, effectiveFeature));
    setSendStatus(effectiveFeature === "plan" ? "Standalone plan request sent." : "Standalone discussion request sent.");
    await invokeDirectWithApproval({
      prompt,
      history,
      attachments,
      feature: effectiveFeature,
      detached: true,
      supervisorMode: state.mode === "supervisor",
      settings: modeSettings(state.mode),
      options: state.runOptions,
      clientStartedAt,
      routeDecision: {
        route: `standalone_${state.mode}_${effectiveFeature}`,
        reason: `Standalone chat is not bound to a project folder. Supervisor mode: ${state.mode === "supervisor" ? "on" : "off"}.`,
      },
    });
    $("promptInput").value = "";
    currentChat().drafts[state.mode] = "";
    clearCurrentAttachments();
    resizePrompt();
    return;
  }
  if (feature === "discuss") {
    const history = directHistoryForPrompt();
    appendMessage($("supervisorMessages"), "user", userMessageWithAttachments(prompt, attachments));
    rememberChat("direct", "user", prompt);
    appendPipelineStep("routing: discuss", buildPromptPreview("direct", prompt, history, attachments, feature));
    setSendStatus("Discussion request sent.");
    await invokeDirectWithApproval({
      prompt,
      history,
      attachments,
      feature,
      settings: modeSettings("direct"),
      options: state.runOptions,
      clientStartedAt,
      routeDecision: { route: "feature_discuss", reason: "User selected /discuss." },
    });
    $("promptInput").value = "";
    currentChat().drafts[state.mode] = "";
    clearCurrentAttachments();
    resizePrompt();
    return;
  }
  if (feature === "plan") {
    appendMessage($("supervisorMessages"), "user", userMessageWithAttachments(prompt, attachments));
    rememberChat("supervisor", "user", prompt);
    appendPipelineStep("routing: plan", "Supervisor will create a plan only. No code execution.");
    const analysis = await safeInvoke(() => window.aidev.supervisorAnalyze({ prompt, attachments, feature, settings: modeSettings("supervisor"), options: state.runOptions }));
    if (analysis?.run) appendSupervisorAnalysis(analysis.run);
    $("promptInput").value = "";
    currentChat().drafts.supervisor = "";
    clearCurrentAttachments();
    resizePrompt();
    return;
  }
  if (feature === "code" || feature === "todolist") {
    appendMessage($("supervisorMessages"), "user", userMessageWithAttachments(prompt, attachments));
    rememberChat("supervisor", "user", prompt);
    const route = supervisorRouteDecision(prompt, attachments, feature);
    appendPipelineStep("routing: supervisor", route.reason);
    appendPipelineStep("analyzing prompt...", feature === "todolist"
      ? "Supervisor is creating a staged todo contract with verification gates."
      : "Supervisor is creating a strict technical prompt with scope guardrails.");
    const analysis = await safeInvoke(() => window.aidev.supervisorAnalyze({ prompt, attachments, feature, settings: modeSettings("supervisor"), options: state.runOptions }));
    if (!analysis?.run) return;
    appendSupervisorAnalysis(analysis.run);
    setSendStatus("Supervisor request sent to Codex.");
    await invokeSupervisorWithApproval({ prompt, attachments, feature, execute: true, settings: modeSettings("supervisor"), options: state.runOptions, expectedRun: analysis.run, clientStartedAt });
    $("promptInput").value = "";
    currentChat().drafts[state.mode] = "";
    clearCurrentAttachments();
    resizePrompt();
    return;
  }
  if (state.mode === "direct") {
    const history = directHistoryForPrompt();
    appendMessage($("supervisorMessages"), "user", userMessageWithAttachments(prompt, attachments));
    rememberChat("direct", "user", prompt);
    appendPipelineStep("analyzing prompt...", buildPromptPreview("direct", prompt, history, attachments, feature));
    setSendStatus("Direct request sent to backend.");
    await invokeDirectWithApproval({
      prompt,
      history,
      attachments,
      feature,
      settings: modeSettings("direct"),
      options: state.runOptions,
      clientStartedAt,
      routeDecision: { route: feature === "code" ? "feature_code_direct" : "manual_direct", reason: feature === "code" ? "User selected /code in Direct mode." : "User selected Direct mode." },
    });
    $("promptInput").value = "";
    currentChat().drafts.direct = "";
    clearCurrentAttachments();
    resizePrompt();
    return;
  }
  appendMessage($("supervisorMessages"), "user", userMessageWithAttachments(prompt, attachments));
  rememberChat("supervisor", "user", prompt);
  const route = supervisorRouteDecision(prompt, attachments, feature);
  if (!route.useSupervisor) {
    const history = directHistoryForPrompt();
    appendPipelineStep("routing: direct", `${route.reason}\n\n${buildPromptPreview("direct", prompt, history, attachments, feature)}`);
    setSendStatus("Supervisor skipped. Direct request sent to Codex.");
    state.processLog = `Queued: direct\nRouter: ${route.reason}\n`;
    renderInspector();
    await invokeDirectWithApproval({
      prompt,
      history,
      attachments,
      feature,
      settings: modeSettings("direct"),
      options: state.runOptions,
      clientStartedAt,
      routeDecision: { route: "auto_direct", reason: route.reason },
    });
    $("promptInput").value = "";
    currentChat().drafts.supervisor = "";
    clearCurrentAttachments();
    resizePrompt();
    return;
  }
  appendPipelineStep("routing: supervisor", route.reason);
  appendPipelineStep("analyzing prompt...", "Supervisor is creating a stricter prompt and choosing reasoning/model.");
  setSendStatus("Supervisor is analyzing the prompt.");
  const analysis = await safeInvoke(() => window.aidev.supervisorAnalyze({ prompt, attachments, feature, settings: modeSettings("supervisor"), options: state.runOptions }));
  if (!analysis?.run) return;
  appendSupervisorAnalysis(analysis.run);
  setSendStatus("Supervisor request sent to Codex.");
  await invokeSupervisorWithApproval({ prompt, attachments, feature, execute: true, settings: modeSettings("supervisor"), options: state.runOptions, expectedRun: analysis.run, clientStartedAt });
  $("promptInput").value = "";
  currentChat().drafts.supervisor = "";
  clearCurrentAttachments();
  resizePrompt();
}

function setFeature(feature) {
  state.activeFeature = ["auto", "code", "plan", "todolist", "discuss"].includes(feature) ? feature : "auto";
  document.querySelectorAll(".feature-chip").forEach((button) => {
    button.classList.toggle("active", button.dataset.feature === state.activeFeature);
  });
  updateContextMeter();
}

function isDetachedChatMode() {
  return state.workspaceMode === "chat";
}

async function loadTerminalHistory() {
  try {
    state.terminal.history = await window.aidev.terminalHistory();
  } catch {
    state.terminal.history = [];
  }
  state.terminal.cwd = state.terminal.cwd || state.root;
  renderTerminal();
}

function renderTerminal() {
  const workspace = document.querySelector(".workspace");
  const panel = $("terminalPanel");
  if (workspace) workspace.classList.toggle("terminal-open", Boolean(state.terminal.open));
  if (panel) panel.classList.toggle("open", Boolean(state.terminal.open));
  $("terminalToggle")?.classList.toggle("active", Boolean(state.terminal.open));
  if ($("terminalCwd")) $("terminalCwd").textContent = state.terminal.cwd || state.root || ".";
  if ($("terminalStop")) $("terminalStop").disabled = !state.terminal.running;
}

function toggleTerminal(force) {
  state.terminal.open = typeof force === "boolean" ? force : !state.terminal.open;
  state.terminal.cwd = state.terminal.cwd || state.root;
  renderTerminal();
  if (state.terminal.open) {
    setTimeout(() => $("terminalInput")?.focus(), 0);
  }
}

async function pickTerminalCwd() {
  const result = await window.aidev.pickTerminalCwd(state.terminal.cwd || state.root);
  if (result?.canceled || !result.path) return;
  state.terminal.cwd = result.path;
  renderTerminal();
  setSendStatus(`Terminal folder: ${result.path}`);
}

async function stopTerminal() {
  await window.aidev.stopTerminal();
}

async function runTerminalCommand() {
  const input = $("terminalInput");
  const command = String(input?.value || "").trim();
  if (!command || state.terminal.running) return;
  state.terminal.historyIndex = null;
  state.terminal.suggestion = "";
  updateTerminalSuggestion();
  input.value = "";
  try {
    const result = await window.aidev.runTerminal({
      command,
      cwd: state.terminal.cwd || state.root,
    });
    if (Array.isArray(result?.history)) state.terminal.history = result.history;
    if (result?.cwd) state.terminal.cwd = result.cwd;
    renderTerminal();
  } catch (error) {
    terminalWrite(`\n[terminal error] ${error?.message || error}\n`, "stderr");
  }
}

function handleTerminalKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    runTerminalCommand();
    return;
  }
  if (event.key === "Tab") {
    const completion = terminalCompletion($("terminalInput").value);
    if (completion) {
      event.preventDefault();
      $("terminalInput").value = completion;
      state.terminal.suggestion = "";
      updateTerminalSuggestion();
    }
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveTerminalHistory(-1);
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveTerminalHistory(1);
  }
}

function moveTerminalHistory(direction) {
  const input = $("terminalInput");
  const history = state.terminal.history || [];
  if (!history.length || !input) return;
  if (state.terminal.historyIndex === null) {
    state.terminal.historyIndex = history.length;
  }
  state.terminal.historyIndex = Math.max(0, Math.min(history.length, state.terminal.historyIndex + direction));
  input.value = state.terminal.historyIndex >= history.length ? "" : history[state.terminal.historyIndex];
  updateTerminalSuggestion();
}

function terminalCompletion(value) {
  const prefix = String(value || "");
  if (!prefix) return "";
  const lower = prefix.toLowerCase();
  const seen = new Set();
  for (const command of [...(state.terminal.history || [])].reverse()) {
    const normalized = String(command || "");
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (key.startsWith(lower) && normalized.length > prefix.length) return normalized;
  }
  return "";
}

function updateTerminalSuggestion() {
  const input = $("terminalInput");
  const node = $("terminalSuggestion");
  if (!input || !node) return;
  const value = input.value || "";
  const completion = terminalCompletion(value);
  state.terminal.suggestion = completion;
  if (!completion) {
    node.innerHTML = "";
    return;
  }
  const suffix = completion.slice(value.length);
  node.innerHTML = `<span class="terminal-suggestion-prefix">${escapeHtml(value)}</span><span>${escapeHtml(suffix)}</span>`;
}

function terminalWrite(text, kind = "stdout") {
  const output = $("terminalOutput");
  if (!output) return;
  const chunk = String(text || "");
  output.textContent += chunk;
  if (output.textContent.length > 60000) output.textContent = output.textContent.slice(-60000);
  output.scrollTop = output.scrollHeight;
}

function parseFeatureDirective(rawPrompt) {
  const raw = String(rawPrompt || "").trim();
  const match = raw.match(/^\/(code|plan|todolist|discuss)\b\s*/i);
  const feature = match ? match[1].toLowerCase() : state.activeFeature;
  return {
    feature: ["code", "plan", "todolist", "discuss"].includes(feature) ? feature : "auto",
    prompt: match ? raw.slice(match[0].length).trim() : raw,
  };
}

function featureLabel(feature) {
  if (feature === "code") return "/code";
  if (feature === "plan") return "/plan";
  if (feature === "todolist") return "/todolist";
  if (feature === "discuss") return "/discuss";
  return state.mode;
}

function featureInstruction(feature) {
  if (feature === "code") return "Feature /code: write or modify code as needed. Prefer complete implementation over discussion.";
  if (feature === "plan") return "Feature /plan: produce a concrete implementation plan only. Do not edit files or execute code.";
  if (feature === "todolist") return "Feature /todolist: execute the work as a staged todo list. Complete one stage, verify it, then continue to the next stage. Stop and report if a stage fails.";
  if (feature === "discuss") return "Feature /discuss: discuss the project conversationally. Do not write code, do not propose a step-by-step execution plan, and do not edit files.";
  return "";
}

function supervisorRouteDecision(prompt, attachments = [], feature = "auto") {
  if (feature === "code") {
    return { useSupervisor: true, reason: "Supervisor needed: /code requests code-writing guardrails." };
  }
  if (feature === "plan") {
    return { useSupervisor: true, reason: "Supervisor needed: /plan requests a planning-only contract." };
  }
  if (feature === "todolist") {
    return { useSupervisor: true, reason: "Supervisor needed: /todolist requires staged execution and validation." };
  }
  if (feature === "discuss") {
    return { useSupervisor: false, reason: "Supervisor skipped: /discuss is conversation-only." };
  }
  const text = String(prompt || "").trim();
  const chat = currentChat();
  const contextText = [
    ...(chat.chatHistory?.supervisor || []),
    ...(chat.chatHistory?.direct || []),
  ].slice(-8).map((item) => `${item.role}: ${item.content}`).join("\n");
  const lower = `${contextText}\n${text}`.toLowerCase();
  const codeSignals = [
    "code", "coding", "implement", "build", "fix", "bug", "refactor", "test", "typescript", "javascript",
    "python", "electron", "react", "css", "html", "api", "backend", "frontend", "database", "migration",
    "component", "function", "class", "method", "module", "file", "diff", "patch", "ci", "lint",
    "код", "напис", "реализ", "сделай", "добавь", "исправь", "баг", "рефактор", "тест", "файл",
    "компонент", "функц", "класс", "модул", "верст", "интерфейс", "кнопк", "страниц", "приложен",
  ];
  const nonCodeSignals = [
    "объясни", "расскажи", "что думаешь", "можно ли", "как лучше", "идея", "план без реализации",
    "как можно", "как улучшить", "что улучшить", "предложи улучшения", "посоветуй",
    "summarize", "explain", "what do you think", "can i", "is it possible", "pros and cons",
    "estimate", "compare", "brainstorm", "question", "how can", "how to improve", "what should improve",
  ];
  const codeExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".css", ".html", ".py", ".json", ".md", ".yml", ".yaml", ".ps1", ".cmd", ".sh", ".sql"]);
  const hasCodeAttachment = (attachments || []).some((item) => codeExtensions.has(String(item.ext || "").toLowerCase()));
  const hasCodeSignal = hasCodeAttachment || codeSignals.some((signal) => lower.includes(signal));
  const hasNonCodeSignal = nonCodeSignals.some((signal) => lower.includes(signal));

  if (hasCodeSignal) {
    return {
      useSupervisor: true,
      reason: "Supervisor needed: router marked this as a code-writing or code-changing task.",
    };
  }
  if (hasNonCodeSignal) {
    return {
      useSupervisor: false,
      reason: "Supervisor skipped: router did not mark this as a code-writing task.",
    };
  }
  return {
    useSupervisor: true,
    reason: "Supervisor needed: task is ambiguous, so code guardrails stay enabled.",
  };
}

function promptQualityDecision(prompt, feature = "auto") {
  if (feature === "discuss") return { ok: true };
  const text = String(prompt || "").trim();
  const words = text.split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  const vague = words.length <= 4 && !/[./\\][\w.-]+/.test(text);
  const actionOnly = /^(сделай|исправь|улучши|добавь|переделай|fix|improve|add|change)$/i.test(lower);
  if (vague || actionOnly) {
    return {
      ok: false,
      message: "Add one concrete target before I run this: file, screen, component, bug, or expected behavior.",
    };
  }
  return { ok: true };
}

async function safeInvoke(action) {
  try {
    return await action();
  } catch (error) {
    const message = error?.message || String(error);
    setSendStatus(`Error: ${message}`, "error");
    appendMessage(targetMessages(state.mode), "error", message);
    state.processLog = `ERROR: ${message}\n`;
    renderInspector();
    return null;
  }
}

async function maybeOfferApprovalForBlockedRun() {
  state.runs = await window.aidev.listRuns();
  renderRuns();
  const latestId = state.runs[0]?.id;
  if (!latestId) return false;
  const latest = await window.aidev.readRun(latestId);
  const status = String(latest?.audit?.status || "");
  if (status !== "blocked_by_budget" && status !== "blocked_by_approval") return false;
  const gate = approvalGate(latest);
  if (!gate.needsApproval) return false;
  appendApprovalCard(gate);
  return true;
}

async function invokeDirectWithApproval(payload) {
  state.pendingRunRequest = { kind: "direct", payload: { ...payload } };
  const result = await safeInvoke(() => window.aidev.direct(payload));
  if (result !== null) return result;
  await maybeOfferApprovalForBlockedRun();
  return null;
}

async function invokeSupervisorWithApproval(payload) {
  state.pendingRunRequest = { kind: "supervisor", payload: { ...payload } };
  return safeInvoke(() => window.aidev.supervisor(payload));
}

function updateRunControls() {
  $("sendButton").disabled = state.activeRun;
  $("stopButton").disabled = !state.activeRun;
  $("sendButton").textContent = "Send";
  if (state.activeRun) {
    setSendStatus("Running...");
  }
  syncModePanel();
}

function resetRunOptions() {
  state.runOptions.approveHigh = false;
  state.runOptions.forceBudget = false;
  state.pendingRunRequest = null;
}

function targetMessages(idOrTitle) {
  return $("supervisorMessages");
}

function normalizeProjects(items) {
  const currentRoot = state.root || state.settings.projectRoot || "";
  const base = Array.isArray(items) ? items : [];
  const seen = new Set();
  const result = [];
  for (const item of base) {
    if (!item?.root || seen.has(item.root)) continue;
    seen.add(item.root);
    result.push({
      id: item.id || `project-${seen.size}`,
      root: item.root,
      name: item.name || shortPath(item.root),
      summary: item.summary || "No summary yet.",
      open: item.open !== false,
      lastUsed: Number(item.lastUsed || 0),
    });
  }
  if (currentRoot && !seen.has(currentRoot)) {
    result.unshift({
      id: `project-${Date.now()}`,
      root: currentRoot,
      name: shortPath(currentRoot),
      summary: "Current project.",
      open: true,
      lastUsed: Date.now(),
    });
  }
  return result.sort((a, b) => Number(b.lastUsed || 0) - Number(a.lastUsed || 0));
}

function emptyChat(chat) {
  const hasPrompt = Object.values(chat.drafts || {}).some((value) => String(value || "").trim());
  const hasHistory = Object.values(chat.chatHistory || {}).some((items) => Array.isArray(items) && items.length);
  const hasMessages = Array.isArray(chat.messages) && chat.messages.length;
  const hasHtml = String(chat.html || "").trim();
  return !hasPrompt && !hasHistory && !hasMessages && !hasHtml && placeholderChatTitle(chat.title);
}

function serializableChats() {
  saveActiveChatDom();
  return state.chats
    .filter((chat) => !emptyChat(chat))
    .map((chat) => ({
      ...chat,
      updatedAt: chat.updatedAt || chat.createdAt || Date.now(),
    }))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function loadProjectChats() {
  state.workspaceMode = "project";
  loadChatsForKey(state.root);
}

function loadChatsForKey(key) {
  const saved = state.settings.chatSessions?.[key] || [];
  const chats = Array.isArray(saved) ? saved.filter((chat) => !emptyChat(chat)) : [];
  state.chats = chats.length ? chats : [blankChat()];
  state.activeChatId = state.chats[0].id;
}

function blankChat() {
  return {
    id: `chat-${Date.now()}`,
    title: "New chat",
    html: "",
    messages: [],
    drafts: { supervisor: "", direct: "" },
    chatHistory: { supervisor: [], direct: [] },
    attachments: { supervisor: [], direct: [] },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function saveWorkspaceUi() {
  state.settings.projectRegistry = normalizeProjects(state.projects);
  state.settings.chatSessions = state.settings.chatSessions || {};
  const chats = serializableChats();
  const key = activeChatStorageKey();
  if (chats.length) {
    state.settings.chatSessions[key] = chats;
  } else {
    delete state.settings.chatSessions[key];
  }
  state.settings = await window.aidev.saveSettings(state.settings);
}

function activeChatStorageKey() {
  return isDetachedChatMode() ? DETACHED_CHAT_KEY : state.root;
}

function currentProject() {
  return state.projects.find((item) => item.root === state.root) || state.projects[0];
}

function currentChat() {
  let chat = state.chats.find((item) => item.id === state.activeChatId);
  if (!chat) {
    chat = state.chats[0];
    state.activeChatId = chat.id;
  }
  if (!chat.drafts) chat.drafts = { supervisor: "", direct: "" };
  if (!chat.chatHistory) chat.chatHistory = { supervisor: [], direct: [] };
  if (!chat.attachments) chat.attachments = { supervisor: [], direct: [] };
  if (!Array.isArray(chat.attachments.supervisor)) chat.attachments.supervisor = [];
  if (!Array.isArray(chat.attachments.direct)) chat.attachments.direct = [];
  normalizeChatMessages(chat);
  return chat;
}

function currentAttachments() {
  return [...(currentChat().attachments[state.mode] || [])];
}

function clearCurrentAttachments() {
  currentChat().attachments[state.mode] = [];
  renderAttachmentTray();
  updateContextMeter();
}

async function addAttachments() {
  const selected = await window.aidev.pickAttachments();
  if (!selected?.length) return;
  const chat = currentChat();
  const existing = chat.attachments[state.mode] || [];
  const seen = new Set(existing.map((item) => item.path));
  chat.attachments[state.mode] = [
    ...existing,
    ...selected.filter((item) => item?.path && !seen.has(item.path)),
  ].slice(0, 12);
  renderAttachmentTray();
  updateContextMeter();
  setSendStatus(`${selected.length} attachment${selected.length === 1 ? "" : "s"} added.`);
}

function removeAttachment(pathValue) {
  const chat = currentChat();
  chat.attachments[state.mode] = (chat.attachments[state.mode] || []).filter((item) => item.path !== pathValue);
  renderAttachmentTray();
  updateContextMeter();
}

function renderAttachmentTray() {
  const tray = $("attachmentTray");
  if (!tray) return;
  const attachments = currentAttachments();
  tray.innerHTML = "";
  for (const item of attachments) {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    chip.title = item.path || item.name || "";
    chip.innerHTML = `
      <span>${item.kind === "image" ? "IMG" : "FILE"}</span>
      <strong>${escapeHtml(item.name || shortPath(item.path || "file"))}</strong>
      <button type="button" title="Remove attachment" aria-label="Remove attachment">x</button>
    `;
    chip.querySelector("button").addEventListener("click", () => removeAttachment(item.path));
    tray.appendChild(chip);
  }
}

function userMessageWithAttachments(prompt, attachments) {
  if (!attachments?.length) return prompt;
  const names = attachments.map((item) => `- ${item.name || item.path}`).join("\n");
  return `${prompt}\n\nAttachments:\n${names}`;
}

function normalizeChatMessages(chat) {
  if (Array.isArray(chat.messages) && chat.messages.length) return chat.messages;
  const supervisor = Array.isArray(chat.chatHistory?.supervisor) ? chat.chatHistory.supervisor : [];
  const direct = Array.isArray(chat.chatHistory?.direct) ? chat.chatHistory.direct : [];
  const users = supervisor.filter((item) => item.role === "user");
  const supervisorAssistants = supervisor.filter((item) => item.role === "assistant");
  const directUsers = direct.filter((item) => item.role === "user");
  const directAssistants = direct.filter((item) => item.role === "assistant");
  const messages = [];
  let order = 0;
  const push = (item, mode) => {
    const content = String(item?.content || "").trim();
    if (!content) return;
    messages.push({
      role: item.role,
      content,
      mode,
      runId: item.runId || "",
      createdAt: item.createdAt || (chat.createdAt || Date.now()) + order++,
    });
  };
  if (users.length && directAssistants.length && users.length === directAssistants.length && !directUsers.length && !supervisorAssistants.length) {
    for (let index = 0; index < users.length; index += 1) {
      push(users[index], "supervisor");
      push(directAssistants[index], "direct");
    }
  } else {
    [...supervisor.map((item) => ({ item, mode: "supervisor" })), ...direct.map((item) => ({ item, mode: "direct" }))]
      .sort((a, b) => Number(a.item.createdAt || 0) - Number(b.item.createdAt || 0))
      .forEach(({ item, mode }) => push(item, mode));
  }
  chat.messages = messages;
  return messages;
}

function saveActiveChatDom() {
  const chat = currentChat();
  const container = $("supervisorMessages");
  if (chat && container) {
    chat.html = "";
  }
}

function restoreActiveChatDom() {
  const container = $("supervisorMessages");
  if (!container) return;
  const chat = currentChat();
  container.innerHTML = chatTimelineHtml(chat);
  attachTimelineActions(container);
  container.scrollTop = container.scrollHeight;
  $("promptInput").value = chat.drafts[state.mode] || "";
  renderAttachmentTray();
  updateContextMeter();
  syncChatTitleControls();
}

function chatTimelineHtml(chat) {
  const items = normalizeChatMessages(chat).filter((item) => item.role && String(item.content || "").trim());
  if (!items.length) return "";
  return items.map((item, index) => {
    const type = item.role === "user" ? "user" : "run-result";
    const label = item.mode === "direct" ? "Direct reply" : "Codex reply";
    const content = item.role === "assistant" ? `${label}:\n${item.content}` : item.content;
    const actions = item.role === "assistant" ? undoActionHtml(item.runId) : rewriteActionHtml(index, item.role);
    return `<div class="message ${type}" data-type="${type}" data-message-index="${index}">${escapeHtml(content)}${actions}</div>`;
  }).join("");
}

function undoActionHtml(runId) {
  return `<div class="run-result-actions"><button class="ghost timeline-undo" type="button" data-run-id="${escapeHtml(runId || "")}" ${runId ? "" : "disabled"}>Undo</button></div>`;
}

function rewriteActionHtml(index, role) {
  if (role !== "user") return "";
  return `<div class="message-actions"><button class="ghost timeline-rewrite" type="button" data-message-index="${index}">Rewrite</button></div>`;
}

function attachTimelineActions(container = $("supervisorMessages")) {
  if (!container) return;
  syncRewriteActions(container);
  container.querySelectorAll(".timeline-undo").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      const runId = button.dataset.runId;
      if (!runId) return;
      button.disabled = true;
      button.textContent = "Undoing...";
      const result = await window.aidev.undoRun(runId);
      button.textContent = result?.ok ? "Undone" : "Undo";
      appendMessage(container, result?.ok ? "system" : "error", result?.ok ? "Undo completed." : (result?.error || "Undo failed."));
    });
  });
  container.querySelectorAll(".timeline-rewrite").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => rewriteFromMessage(Number(button.dataset.messageIndex)));
  });
}

function syncRewriteActions(container = $("supervisorMessages")) {
  if (!container) return;
  const userIndexes = normalizeChatMessages(currentChat())
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.role === "user");
  container.querySelectorAll(".message.user").forEach((node, position) => {
    const index = userIndexes[position]?.index;
    if (index === undefined) return;
    node.dataset.messageIndex = String(index);
    let actions = node.querySelector(".message-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "message-actions";
      node.appendChild(actions);
    }
    let rewrite = actions.querySelector(".timeline-rewrite");
    if (!rewrite) {
      rewrite = document.createElement("button");
      rewrite.className = "ghost timeline-rewrite";
      rewrite.type = "button";
      rewrite.textContent = "Rewrite";
      actions.appendChild(rewrite);
    }
    rewrite.dataset.messageIndex = String(index);
    if (!rewrite.dataset.bound) {
      rewrite.dataset.bound = "true";
      rewrite.addEventListener("click", () => rewriteFromMessage(Number(rewrite.dataset.messageIndex)));
    }
  });
}

async function rewriteFromMessage(messageIndex) {
  const chat = currentChat();
  const messages = normalizeChatMessages(chat);
  const target = messages[messageIndex];
  if (!target || target.role !== "user") return;
  if (state.activeRun) {
    setSendStatus("Stop the active run before rewriting.", "warn");
    return;
  }

  const removed = messages.slice(messageIndex);
  const runIds = [...new Set(removed.map((item) => item.runId).filter(Boolean))].reverse();
  const undoFailures = [];
  if (runIds.length) {
    setSendStatus(`Reverting ${runIds.length} run${runIds.length === 1 ? "" : "s"} for rewrite...`, "warn");
    for (const runId of runIds) {
      const result = await window.aidev.undoRun(runId);
      if (!result?.ok) undoFailures.push(result?.error || `Undo failed for ${runId}`);
    }
  }

  chat.messages = messages.slice(0, messageIndex);
  rebuildChatHistory(chat);
  const mode = target.mode === "direct" ? "direct" : "supervisor";
  chat.drafts[mode] = promptTextForRewrite(target.content);
  chat.attachments[mode] = [];
  chat.updatedAt = Date.now();
  state.pendingPrompt = "";
  state.pendingAttachments = [];
  state.currentRunId = "";
  state.processLog = `Rewrite from message ${messageIndex + 1}\n`;
  setMode(mode);
  restoreActiveChatDom();
  resizePrompt();
  renderInspector();
  renderChatNavigation();
  renderProjectSidebar();
  scheduleUiSave();
  setSendStatus(undoFailures.length
    ? `Message restored, but ${undoFailures.length} run undo failed.`
    : "Message restored to composer. Edit it and send again.", undoFailures.length ? "warn" : "clarification");
}

function promptTextForRewrite(content) {
  return String(content || "").replace(/\n\nAttachments:\n[\s\S]*$/i, "").trim();
}

function rebuildChatHistory(chat) {
  chat.chatHistory = { supervisor: [], direct: [] };
  for (const item of normalizeChatMessages(chat)) {
    const mode = item.mode === "direct" ? "direct" : "supervisor";
    chat.chatHistory[mode].push(item);
  }
}

function newChat() {
  saveActiveChatDom();
  const chat = blankChat();
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  $("promptInput").value = "";
  restoreActiveChatDom();
  renderChatNavigation();
  updateContextMeter();
  renderProjectSidebar();
  setSendStatus("New chat ready.");
}

async function removeChat(chatId, projectRoot = activeChatStorageKey()) {
  const isActiveProject = projectRoot === activeChatStorageKey();
  const source = isActiveProject ? state.chats : (state.settings.chatSessions?.[projectRoot] || []);
  const chat = source.find((item) => item.id === chatId);
  if (!chat) return;
  if (!confirm(`Delete chat "${titleForChat(chat)}"?`)) return;
  if (isActiveProject) {
    state.chats = state.chats.filter((item) => item.id !== chatId);
    if (!state.chats.length) state.chats = [blankChat()];
    if (state.activeChatId === chatId) {
      state.activeChatId = state.chats[0].id;
      restoreActiveChatDom();
      resizePrompt();
      updateContextMeter();
    }
  } else if (state.settings.chatSessions?.[projectRoot]) {
    state.settings.chatSessions[projectRoot] = state.settings.chatSessions[projectRoot].filter((item) => item.id !== chatId);
    if (!state.settings.chatSessions[projectRoot].length) delete state.settings.chatSessions[projectRoot];
  }
  renderChatNavigation();
  renderProjectSidebar();
  await saveWorkspaceUi();
  setSendStatus("Chat deleted.");
}

function selectChat(chatId) {
  saveActiveChatDom();
  if (!state.chats.some((chat) => chat.id === chatId)) {
    const saved = (state.settings.chatSessions?.[activeChatStorageKey()] || []).find((chat) => chat.id === chatId);
    if (saved) state.chats.unshift(saved);
  }
  if (!state.chats.some((chat) => chat.id === chatId)) return;
  state.activeChatId = chatId;
  currentChat().updatedAt = Date.now();
  restoreActiveChatDom();
  renderChatNavigation();
  renderProjectSidebar();
  renderAttachmentTray();
  updateContextMeter();
  resizePrompt();
  scheduleUiSave();
}

function placeholderChatTitle(value) {
  const title = String(value || "").trim().toLowerCase();
  return !title || title === "new chat" || /^chat \d+$/.test(title);
}

function titleForChat(chat) {
  const text = (chat.title && !placeholderChatTitle(chat.title) ? chat.title : "")
    || (chat.chatHistory?.supervisor?.find((item) => item.role === "user")?.content)
    || (chat.chatHistory?.direct?.find((item) => item.role === "user")?.content)
    || "Chat";
  return text.length > 32 ? `${text.slice(0, 32)}...` : text;
}

function syncChatTitleControls() {
  const chat = currentChat();
  const fullTitle = placeholderChatTitle(chat.title) ? titleForChat(chat) : chat.title;
  if ($("chatTitleInput") && document.activeElement !== $("chatTitleInput")) {
    $("chatTitleInput").value = fullTitle;
  }
  if ($("chatTitle")) {
    $("chatTitle").textContent = titleForChat(chat);
  }
}

function renderChatNavigation() {
  const tabs = $("chatTabs");
  const list = $("chatList");
  syncChatTitleControls();
  if (!tabs || !list) return;
  tabs.innerHTML = "";
  list.innerHTML = "";
  for (const chat of state.chats) {
    const title = titleForChat(chat);
    const tab = document.createElement("button");
    tab.className = `chat-tab ${chat.id === state.activeChatId ? "active" : ""}`;
    tab.textContent = title;
    tab.title = title;
    tab.addEventListener("click", () => selectChat(chat.id));
    tab.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      removeChat(chat.id);
    });
    tabs.appendChild(tab);

    const item = document.createElement("button");
    item.className = `chat-list-item ${chat.id === state.activeChatId ? "active" : ""}`;
    item.textContent = title;
    item.title = title;
    item.addEventListener("click", () => selectChat(chat.id));
    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      removeChat(chat.id);
    });
    list.appendChild(item);
  }
}

async function switchDetachedChats() {
  if (isDetachedChatMode()) return;
  await saveWorkspaceUi();
  saveActiveChatDom();
  state.workspaceMode = "chat";
  loadChatsForKey(DETACHED_CHAT_KEY);
  if (state.activeFeature === "code" || state.activeFeature === "todolist") setFeature("discuss");
  $("promptInput").value = currentChat().drafts[state.mode] || "";
  $("projectName").textContent = "Chats";
  $("viewTitle").textContent = "Chats";
  restoreActiveChatDom();
  renderChatNavigation();
  renderProjectSidebar();
  renderAttachmentTray();
  syncModePanel();
  updateContextMeter();
  setSendStatus("Standalone chat mode. Use /discuss or /plan.");
}

function renderProjectSidebar() {
  const list = $("projectList");
  const detachedList = $("detachedChatList");
  if (!list) return;
  state.projects = normalizeProjects(state.projects);
  if (detachedList) {
    detachedList.innerHTML = "";
    const chats = (isDetachedChatMode() ? serializableChats() : (state.settings.chatSessions?.[DETACHED_CHAT_KEY] || []))
      .filter((chat) => !emptyChat(chat))
      .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
    const item = document.createElement("div");
    item.className = "project-item";
    item.innerHTML = `
      <button class="project-head ${isDetachedChatMode() ? "active" : ""}" type="button">
        <span>${isDetachedChatMode() ? "v" : ">"}</span>
        <div class="project-name">Chats</div>
        <span>${chats.length}</span>
        <div class="project-summary">Standalone AI conversations, not tied to a folder.</div>
      </button>
      <div class="project-chats" ${isDetachedChatMode() ? "" : "hidden"}></div>
    `;
    item.querySelector(".project-head").addEventListener("click", () => switchDetachedChats());
    const chatBox = item.querySelector(".project-chats");
    for (const chat of chats) {
      const row = document.createElement("button");
      row.className = `chat-row ${isDetachedChatMode() && chat.id === state.activeChatId ? "active" : ""}`;
      row.type = "button";
      row.innerHTML = `
        <div class="chat-row-title">${escapeHtml(titleForChat(chat))}</div>
        <div class="chat-row-summary">${escapeHtml(chatSummary(chat))}</div>
        <div class="chat-row-time">${escapeHtml(timeAgo(chat.updatedAt || chat.createdAt))}</div>
      `;
      row.addEventListener("click", async () => {
        await switchDetachedChats();
        selectChat(chat.id);
      });
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        removeChat(chat.id, DETACHED_CHAT_KEY);
      });
      chatBox.appendChild(row);
    }
    detachedList.appendChild(item);
  }
  list.innerHTML = "";
  for (const project of state.projects) {
    const item = document.createElement("div");
    item.className = "project-item";
    const isActive = project.root === state.root;
    const isActiveProjectMode = isActive && !isDetachedChatMode();
    const chats = (state.settings.chatSessions?.[project.root] || [])
      .filter((chat) => !emptyChat(chat))
      .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
    if (isActiveProjectMode) {
      const activeSaved = serializableChats();
      if (activeSaved.length) chats.splice(0, chats.length, ...activeSaved);
    }
    item.innerHTML = `
      <button class="project-head ${isActiveProjectMode ? "active" : ""}" type="button">
        <span>${project.open === false ? ">" : "v"}</span>
        <div class="project-name">${escapeHtml(project.name || shortPath(project.root))}</div>
        <span>${chats.length}</span>
        <div class="project-summary">${escapeHtml(project.summary || "No summary yet.")}</div>
      </button>
      <div class="project-chats" ${project.open === false ? "hidden" : ""}></div>
    `;
    const head = item.querySelector(".project-head");
    head.addEventListener("click", async (event) => {
      if (event.detail > 1) return;
      if (!isActiveProjectMode) {
        await switchProject(project.root);
      } else {
        project.open = project.open === false;
        renderProjectSidebar();
        scheduleUiSave();
      }
    });
    head.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      if (confirm(`Remove "${project.name}" from AI Dev?\nThe folder will not be deleted.`)) {
        await removeProject(project.root);
      }
    });
    const chatBox = item.querySelector(".project-chats");
    for (const chat of chats) {
      const row = document.createElement("button");
      row.className = `chat-row ${isActiveProjectMode && chat.id === state.activeChatId ? "active" : ""}`;
      row.type = "button";
      row.innerHTML = `
        <div class="chat-row-title">${escapeHtml(titleForChat(chat))}</div>
        <div class="chat-row-summary">${escapeHtml(chatSummary(chat))}</div>
        <div class="chat-row-time">${escapeHtml(timeAgo(chat.updatedAt || chat.createdAt))}</div>
      `;
      row.addEventListener("click", async () => {
        if (!isActiveProjectMode) await switchProject(project.root);
        selectChat(chat.id);
      });
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        removeChat(chat.id, project.root);
      });
      chatBox.appendChild(row);
    }
    list.appendChild(item);
  }
}

function chatSummary(chat) {
  const last = normalizeChatMessages(chat)
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-1)[0];
  const text = String(last?.content || titleForChat(chat) || "Empty chat").replace(/\s+/g, " ").trim();
  return text.length > 72 ? `${text.slice(0, 72)}...` : text;
}

function timeAgo(value) {
  const then = Number(value || Date.now());
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function modeSettings(mode) {
  if (mode === "direct") {
    return {
      ...state.settings,
      model: state.settings.directModel || state.settings.model || "gpt-5.4-mini",
      reasoning: state.settings.directReasoning || "medium",
    };
  }
  return {
    ...state.settings,
    model: state.settings.supervisorModel || "gpt-5.4-mini",
    reasoning: state.settings.supervisorReasoning || "low",
  };
}

function syncModePanel() {
  const current = state.mode === "direct"
    ? {
        model: state.settings.directModel || "gpt-5.4-mini",
        reasoning: state.settings.directReasoning || "medium",
      }
    : {
        model: state.settings.supervisorModel || "gpt-5.4-mini",
        reasoning: state.settings.supervisorReasoning || "low",
      };
  renderModelSelect($("modeModel"), state.mode, current.model);
  if ($("modeReasoning")) $("modeReasoning").value = current.reasoning;
  updateContextMeter();
}

function resizePrompt() {
  const input = $("promptInput");
  if (!input) return;
  input.style.height = "auto";
  const maxHeight = Math.max(120, Math.floor(window.innerHeight / 3));
  input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`;
  input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
}

function estimateTokens(text) {
  const value = String(text || "");
  if (!value) return 0;
  return Math.max(1, Math.floor(value.length / 4));
}

function modelContextLimit(model) {
  const lower = String(model || "").toLowerCase();
  if (lower.includes("gpt-4.1")) return 1047576;
  if (lower.includes("gpt-5") || lower.includes("gpt-4o")) return 128000;
  return 128000;
}

function estimateAttachmentTokens(attachments) {
  return (attachments || []).reduce((total, item) => {
    const size = Number(item.size || 0);
    if (item.kind === "image") return total + 1500;
    if (item.kind === "document" || item.kind === "archive") return total + Math.min(12000, Math.ceil(size / 8));
    return total + Math.min(9000, Math.ceil(size / 4));
  }, 0);
}

function contextSnapshot() {
  const parsed = parseFeatureDirective($("promptInput")?.value || currentChat().drafts[state.mode] || "");
  const prompt = parsed.prompt;
  const feature = parsed.feature;
  const settings = modeSettings(state.mode);
  const limit = modelContextLimit(settings.model);
  const history = state.mode === "direct" ? directHistoryForPrompt() : optimizedHistoryForMode("supervisor");
  const historyText = history.map((item) => `${item.role}: ${item.content}`).join("\n\n");
  const attachments = currentAttachments();
  const indexTokens = Math.min(2200, Math.max(0, Number(state.projectIndex?.file_count || 0) * 8));
  const used = estimateTokens(prompt) + estimateTokens(historyText) + estimateAttachmentTokens(attachments) + indexTokens;
  return {
    used,
    limit,
    percent: Math.min(100, (100 * used) / limit),
    attachments,
    historyCount: history.length,
    model: settings.model,
    estimatedCost: estimateRunCost(used, settings.reasoning),
    projectFiles: state.projectIndex?.file_count || 0,
    feature,
  };
}

function estimateRunCost(tokens, reasoning) {
  const table = state.budget.estimated_call_cost_usd || { low: 0.03, medium: 0.08, high: 0.25, xhigh: 0.6 };
  if (reasoning === "none") return 0;
  const base = Number(table[reasoning] || table.low || 0.03);
  return base * Math.max(1, tokens / 12000);
}

function updateContextMeter() {
  const percentNode = $("contextPercent");
  const bar = $("contextBar");
  const details = $("contextDetails");
  const cost = $("costEstimate");
  const chips = $("contextChips");
  if (!percentNode || !bar || !details || !chips) return;
  const snapshot = contextSnapshot();
  percentNode.textContent = `${snapshot.percent.toFixed(snapshot.percent < 1 ? 2 : 1)}%`;
  bar.style.width = `${Math.min(100, snapshot.percent)}%`;
  bar.style.background = snapshot.percent >= 90 ? "var(--danger)" : snapshot.percent >= 70 ? "var(--send)" : "var(--accent)";
  details.textContent = `${formatNumber(snapshot.used)} / ${formatNumber(snapshot.limit)} tokens`;
  if (cost) cost.textContent = `Estimated: ${formatUsd(snapshot.estimatedCost)} / ${formatNumber(snapshot.projectFiles)} indexed files`;
  const chipData = [
    `${featureLabel(snapshot.feature)}`,
    `${snapshot.model}`,
    `${snapshot.historyCount} history`,
    `${snapshot.attachments.length} files`,
  ];
  chips.innerHTML = chipData.map((value) => `<span class="context-chip">${escapeHtml(value)}</span>`).join("");
}

function shouldStickToBottom(container) {
  if (!container) return false;
  return container.scrollHeight - container.scrollTop - container.clientHeight <= 8;
}

function maybeScrollToBottom(container, stick) {
  if (stick) {
    container.scrollTop = container.scrollHeight;
  }
}

function appendMessage(container, type, text) {
  const stick = shouldStickToBottom(container);
  const last = container.lastElementChild;
  if (last && last.dataset.type === type && type !== "user") {
    last.textContent += text;
  } else {
    const node = document.createElement("div");
    node.className = `message ${type}`;
    node.dataset.type = type;
    node.textContent = text;
    container.appendChild(node);
  }
  maybeScrollToBottom(container, stick || type === "user");
  currentChat().updatedAt = Date.now();
  saveActiveChatDom();
  renderProjectSidebar();
  scheduleUiSave();
}

function appendPipelineStep(title, body = "") {
  const container = $("supervisorMessages");
  const stick = shouldStickToBottom(container);
  const node = document.createElement("div");
  node.className = "message step";
  node.dataset.type = "step";
  node.innerHTML = `<strong>${escapeHtml(title)}</strong>${body ? `\n\n${escapeHtml(body)}` : ""}`;
  container.appendChild(node);
  maybeScrollToBottom(container, stick);
  saveActiveChatDom();
}

function appendClarificationRequest(message) {
  const container = targetMessages(state.mode);
  const stick = shouldStickToBottom(container);
  const node = document.createElement("div");
  node.className = "message clarification";
  node.dataset.type = "clarification";
  node.innerHTML = `<strong>Clarification needed</strong>\n\n${escapeHtml(message)}`;
  container.appendChild(node);
  maybeScrollToBottom(container, stick);
  currentChat().updatedAt = Date.now();
  saveActiveChatDom();
  renderProjectSidebar();
  scheduleUiSave();
}

function buildPromptPreview(mode, prompt, history, attachments = [], feature = "auto") {
  const settings = modeSettings(mode);
  const lines = [
    "new prompt + settings",
    "",
    "prompt()",
    prompt,
    "",
    `Mode: ${mode === "direct" ? "Direct" : "Supervisor"}`,
    `Feature: ${featureLabel(feature)}`,
    `Reasoning: ${reasoningLabel(settings.reasoning)}`,
    `Model: ${settings.model}`,
  ];
  const instruction = featureInstruction(feature);
  if (instruction) lines.push(instruction);
  if (mode === "supervisor") {
    lines.push("Safety: scope guard, budget guard, prompt improvement");
  }
  if (history?.length) {
    lines.push(`Conversation context: ${history.length} messages`);
  }
  if (attachments?.length) {
    lines.push(`Attachments: ${attachments.length}`);
    lines.push(...attachments.map((item) => `- ${item.name || item.path}`));
  }
  return lines.join("\n");
}

function appendSupervisorAnalysis(run) {
  const contract = run?.contract || {};
  const classification = contract.classification || {};
  const promptText = String(run?.prompt || "").trim();
  const body = [
    "new prompt + settings",
    "",
    "prompt()",
    compactPromptForChat(promptText),
    "",
    `Mode: Supervisor`,
    `Reasoning: ${classification.reasoning || "unknown"}`,
    `Model: ${contract.model || "unknown"}`,
    `Task type: ${classification.task_type || "unknown"}`,
    `Needs plan: ${classification.needs_plan ? "yes" : "no"}`,
    `Estimated budget: ${contract.budget?.request_percent ?? "unknown"}%`,
  ].join("\n");
  appendPipelineStep("supervisor prompt:", body);
}

function compactPromptForChat(promptText) {
  if (!promptText) return "No prompt generated.";
  const limit = 3200;
  if (promptText.length <= limit) return promptText;
  return `${promptText.slice(0, limit)}\n\n...prompt shortened in chat; full prompt is in the Prompt panel/run folder.`;
}

function appendCodexStarted(payload) {
  const mode = String(payload.id || "").includes("direct") ? "direct" : "supervisor";
  const settings = modeSettings(mode);
  const contract = payload.run?.contract || {};
  const classification = contract.classification || {};
  const reasoning = classification.reasoning || settings.reasoning;
  const model = contract.model || settings.model;
  const body = [
    `Reasoning: ${reasoningLabel(reasoning)}`,
    `Model: ${model}`,
  ].join("\n");
  appendPipelineStep("codex started:", body);
}

function appendLiveOutput(payload) {
  const container = targetMessages(payload.id);
  const stick = shouldStickToBottom(container);
  const id = `live-${payload.id}`;
  let node = document.getElementById(id);
  if (!node) {
    node = document.createElement("div");
    node.id = id;
    node.className = "message live-output";
    node.dataset.type = "live-output";
    node.textContent = "Live output\n";
    container.appendChild(node);
  }

  const cleaned = cleanLiveOutput(payload.text, payload.stream);
  if (!cleaned) return;
  const current = state.liveOutput[payload.id] || "";
  const next = `${current}${cleaned}`;
  state.liveOutput[payload.id] = next.length > 12000 ? next.slice(-12000) : next;
  node.textContent = `Live output\n${state.liveOutput[payload.id]}`;
  maybeScrollToBottom(container, stick);
}

function cleanLiveOutput(text, stream) {
  const normalized = String(text || "")
    .replace(/\r/g, "\n")
    .split(/\n/)
    .map((line) => line.trimEnd())
    .filter((line) =>
      line.trim() &&
      !line.includes("Reading prompt from stdin") &&
      !line.includes("OpenAI Codex") &&
      !line.match(/^[-\\|/]+$/)
    )
    .join("\n");
  if (!normalized) return "";
  return `${stream === "stderr" ? "stderr: " : ""}${normalized}\n`;
}

async function handleFinish(payload) {
  if (payload.stopped) {
    appendMessage(targetMessages(payload.id), "system", "Stopped.");
    return;
  }
  if (payload.phase === "validate") {
    const ok = payload.code === 0;
    appendMessage($("supervisorMessages"), ok ? "system" : "error", `Validation ${ok ? "passed" : "failed"}${payload.logPath ? `.\nLog: ${payload.logPath}` : "."}`);
    const refreshed = await loadState();
    state.runs = refreshed.runs || state.runs;
    renderRuns();
    renderInspector();
    return;
  }
  if (String(payload.id || "").includes("direct")) {
    if (payload.code !== 0) {
      appendMessage($("supervisorMessages"), "error", humanErrorFromCode(payload.code, payload.stdout || "", payload.stderr || "", payload.logPath || ""));
    }
    resetRunOptions();
    return;
  }
  const latest = state.runs[0] ? await window.aidev.readRun(state.runs[0].id) : null;
  attachClientTiming(latest, payload);
  if (payload.code === 0) {
    appendRunSummary(latest, payload);
    resetRunOptions();
    return;
  }
  if (payload.code === 3 || payload.code === 4) {
    const gate = approvalGate(latest);
    appendApprovalCard(gate);
    return;
  }
  appendMessage(targetMessages(payload.id), "error", humanErrorFromCode(payload.code, payload.stdout || "", payload.stderr || "", payload.logPath || ""));
  resetRunOptions();
}

function appendRunSummary(run, payload) {
  const container = $("supervisorMessages");
  const stick = shouldStickToBottom(container);
  const result = document.createElement("div");
  result.className = "message run-result";
  const planOnly = isPlannedOnlyRun(run, payload);

  const header = document.createElement("div");
  header.className = "run-result-head";
  header.innerHTML = `
    <div>
      <div class="run-result-title">${planOnly ? "Supervisor plan" : "Codex answer"}</div>
      <div class="run-result-subtitle">${escapeHtml(run?.audit?.status || "done")}</div>
    </div>
    <button class="ghost run-result-toggle" type="button">Details</button>
  `;

  const details = document.createElement("div");
  details.className = "run-result-details";
  const summary = extractRunSummary(payload.stdout || "");
  const changedFiles = Array.isArray(run?.audit?.changed_files) ? run.audit.changed_files : [];
  const diffStats = summarizePatch(run?.diff || "");
  const lines = [];
  lines.push(usageDetailsText(run?.usage));
  if (summary.length) lines.push(summary.join("\n"));
  if (planOnly) {
    lines.push("No files were changed because this was a planning-only run.");
    lines.push(planDetailsText(run));
  } else {
    lines.push(`Changed files: ${changedFiles.length}${diffStats ? ` ${diffStats}` : ""}`);
    if (changedFiles.length) {
      lines.push(changedFiles.map((file) => `- ${file}`).join("\n"));
    } else {
      lines.push("Codex returned no file changes.");
    }
  }
  if (run?.lastMessage) {
    lines.push(`Codex reply:\n${run.lastMessage.trim()}`);
    rememberChat("supervisor", "assistant", run.lastMessage.trim(), { runId: run?.id || "" });
  } else if (planOnly) {
    rememberChat("supervisor", "assistant", planAnswerText(run), { runId: run?.id || "" });
  }
  details.textContent = lines.filter(Boolean).join("\n\n") || "No details available.";

  const answer = document.createElement("div");
  answer.className = "run-result-answer";
  answer.innerHTML = `
    <div class="run-result-answer-label">${planOnly ? "Plan" : "Answer"}</div>
    <div class="run-result-answer-body">${escapeHtml(planOnly ? planAnswerText(run) : codexAnswerText(run))}</div>
  `;

  const actions = document.createElement("div");
  actions.className = "run-result-actions";
  if (!planOnly) {
    const undo = document.createElement("button");
    undo.className = "ghost";
    undo.textContent = "Undo";
    undo.disabled = !changedFiles.length;
    undo.addEventListener("click", async () => {
      undo.disabled = true;
      undo.textContent = "Undoing...";
      const result = await window.aidev.undoRun(run.id);
      undo.textContent = result?.ok ? "Undone" : "Undo";
      appendMessage(container, result?.ok ? "system" : "error", result?.ok ? "Undo completed." : (result?.error || "Undo failed."));
    });
    actions.appendChild(undo);
    const validate = document.createElement("button");
    validate.className = "ghost";
    validate.textContent = "Validate";
    validate.disabled = !run?.id;
    validate.addEventListener("click", async () => {
      validate.disabled = true;
      validate.textContent = "Validating...";
      const result = await safeInvoke(() => window.aidev.validateRun(run.id));
      validate.textContent = result?.command ? "Validation started" : "Validate";
      if (result?.command) appendMessage(container, "system", `Validation started:\n${result.command}`);
    });
    actions.appendChild(validate);
  }

  header.querySelector(".run-result-toggle").addEventListener("click", () => {
    const open = result.classList.toggle("open");
    header.querySelector(".run-result-toggle").textContent = open ? "Hide" : "Details";
  });

  result.appendChild(header);
  const metrics = document.createElement("div");
  metrics.innerHTML = usageMetricHtml(run?.usage);
  result.appendChild(metrics);
  result.appendChild(answer);
  result.appendChild(details);
  if (actions.children.length) result.appendChild(actions);
  container.appendChild(result);
  maybeScrollToBottom(container, stick);
  saveActiveChatDom();
}

function attachClientTiming(run, payload = {}) {
  const seconds = Number(payload.clientDurationSeconds || 0);
  if (!run || !seconds) return run;
  run.usage = {
    ...(run.usage || {}),
    end_to_end_seconds: seconds,
    client_started_at: payload.clientStartedAt || null,
  };
  return run;
}

function isPlannedOnlyRun(run, payload = {}) {
  return run?.audit?.status === "planned_only" || payload.phase === "plan";
}

function planAnswerText(run) {
  const contract = run?.contract || {};
  const classification = contract.classification || {};
  const allowed = Array.isArray(contract.allowed_actions) ? contract.allowed_actions : [];
  const criteria = Array.isArray(contract.success_criteria) ? contract.success_criteria : [];
  const parts = [
    `Task type: ${classification.task_type || "unknown"}`,
    `Reasoning: ${reasoningLabel(classification.reasoning || "unknown")}`,
    `Model: ${contract.model || "unknown"}`,
  ];
  if (allowed.length) {
    parts.push(`Allowed work:\n${allowed.map((item) => `- ${item}`).join("\n")}`);
  }
  if (criteria.length) {
    parts.push(`Success criteria:\n${criteria.map((item) => `- ${item}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

function planDetailsText(run) {
  const contract = run?.contract || {};
  return String(contract.technical_prompt || contract.enhanced_prompt || "").trim();
}

function codexAnswerText(run) {
  const last = String(run?.lastMessage || "").trim();
  if (last) return last;
  const changedFiles = Array.isArray(run?.audit?.changed_files) ? run.audit.changed_files : [];
  if (changedFiles.length) {
    return "No final Codex answer was captured. Open Details for changed files and checks.";
  }
  return "No final Codex answer was captured.";
}

function appendDirectResult(payload, run) {
  const container = $("supervisorMessages");
  const stick = shouldStickToBottom(container);
  const result = document.createElement("div");
  result.className = "message run-result";
  const reply = String(payload.lastMessage || payload.stdout || "").trim();
  if (reply) rememberChat("direct", "assistant", reply, { runId: run?.id || "" });
  const elapsed = run?.usage?.end_to_end_seconds ?? run?.usage?.duration_seconds ?? run?.usage?.phase_seconds?.total;
  result.textContent = [
    `Codex reply${elapsed ? ` (${formatSeconds(elapsed)})` : ""}:`,
    reply || "No reply captured.",
  ].join("\n");
  if (run?.id) {
    const actions = document.createElement("div");
    actions.className = "run-result-actions";
    const undo = document.createElement("button");
    undo.className = "ghost";
    undo.textContent = "Undo";
    undo.addEventListener("click", async () => {
      undo.disabled = true;
      undo.textContent = "Undoing...";
      const result = await window.aidev.undoRun(run.id);
      undo.textContent = result?.ok ? "Undone" : "Undo";
      appendMessage(container, result?.ok ? "system" : "error", result?.ok ? "Undo completed." : (result?.error || "Undo failed."));
    });
    actions.appendChild(undo);
    const validate = document.createElement("button");
    validate.className = "ghost";
    validate.textContent = "Validate";
    validate.addEventListener("click", async () => {
      validate.disabled = true;
      validate.textContent = "Validating...";
      const result = await safeInvoke(() => window.aidev.validateRun(run.id));
      validate.textContent = result?.command ? "Validation started" : "Validate";
      if (result?.command) appendMessage(container, "system", `Validation started:\n${result.command}`);
    });
    actions.appendChild(validate);
    result.appendChild(actions);
  }
  container.appendChild(result);
  maybeScrollToBottom(container, stick);
  saveActiveChatDom();
}

function rememberChat(mode, role, content, meta = {}) {
  const chat = currentChat();
  if (!chat.chatHistory[mode]) chat.chatHistory[mode] = [];
  const text = String(content || "").trim();
  if (!text) return;
  const entry = { role, content: text, mode, runId: meta.runId || "", createdAt: Date.now() };
  chat.chatHistory[mode].push(entry);
  if (!Array.isArray(chat.messages)) chat.messages = [];
  chat.messages.push(entry);
  compactChatHistory(chat, mode);
  chat.updatedAt = Date.now();
  syncRewriteActions();
  renderChatNavigation();
  renderProjectSidebar();
  scheduleUiSave();
}

function directHistoryForPrompt() {
  return optimizedHistoryForMode("direct")
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-8);
}

function optimizedHistoryForMode(mode) {
  const chat = currentChat();
  compactChatHistory(chat, mode);
  const summary = chat.summary?.[mode];
  const items = normalizeChatMessages(chat).filter((item) => item.role === "user" || item.role === "assistant");
  return [
    summary ? { role: "system", content: `Chat summary: ${summary}` } : null,
    ...items.slice(-6),
  ].filter(Boolean);
}

function compactChatHistory(chat, mode) {
  if (!chat.summary) chat.summary = {};
  const items = (chat.chatHistory[mode] || []).filter((item) => item.role === "user" || item.role === "assistant");
  if (items.length <= 10) return;
  const older = items.slice(0, -6);
  const digest = older.map((item) => `${item.role}: ${item.content}`).join("\n").replace(/\s+/g, " ").slice(-900);
  chat.summary[mode] = digest.length > 700 ? `${digest.slice(0, 700)}...` : digest;
  chat.chatHistory[mode] = items.slice(-6);
}

function extractRunSummary(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const keep = lines.filter((line) =>
    line.startsWith("Run:") ||
    line.startsWith("Task type:") ||
    line.startsWith("Supervisor:") ||
    line.startsWith("Reasoning:") ||
    line.startsWith("Model:") ||
    line.startsWith("Estimated cost:") ||
    line.startsWith("Budget request usage:") ||
    line.startsWith("Codex ok:") ||
    line.startsWith("Audit status:") ||
    line.startsWith("Changed files:") ||
    line.startsWith("Run folder:")
  );
  return keep;
}

function summarizePatch(diffText) {
  const text = String(diffText || "");
  if (!text.trim()) return "";
  let added = 0;
  let removed = 0;
  let files = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      files += 1;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      added += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
    }
  }
  if (!files && !added && !removed) return "";
  const pieces = [];
  if (files) pieces.push(`${files} file${files === 1 ? "" : "s"}`);
  if (added || removed) pieces.push(`+${added} -${removed}`);
  return pieces.join(" ");
}

function approvalGate(run) {
  const contract = run?.contract || {};
  const classification = contract.classification || {};
  const budget = contract.budget || {};
  const needsHigh = Boolean(classification.requires_approval);
  const needsBudget = Boolean(budget.blocked || budget.request_percent >= 100);
  const lines = [];
  if (needsHigh) {
    lines.push(`This looks like a ${classification.reasoning || "high"} task.`);
  }
  if (needsBudget) {
    lines.push(`Estimated budget use: ${budget.request_percent || "unknown"}%.`);
  }
  return {
    needsApproval: needsHigh || needsBudget,
    approveHigh: needsHigh,
    forceBudget: needsBudget,
    run,
    text: lines.join("\n") || "Approval needed.",
  };
}

function appendApprovalCard(gate) {
  const container = $("supervisorMessages");
  const stick = shouldStickToBottom(container);
  const node = document.createElement("div");
  node.className = "message approval-card";
  const copy = document.createElement("div");
  copy.textContent = `${gate.text}\nApprove this run?`;
  const actions = document.createElement("div");
  actions.className = "approval-actions";
  const approve = document.createElement("button");
  approve.className = "run";
  approve.textContent = "Approve and send";
  approve.addEventListener("click", async () => {
    approve.textContent = "Approved";
    approve.classList.add("approved");
    approve.disabled = true;
    state.runOptions.approveHigh = state.runOptions.approveHigh || gate.approveHigh;
    state.runOptions.forceBudget = state.runOptions.forceBudget || gate.forceBudget;
    const pending = state.pendingRunRequest;
    if (pending?.kind === "direct") {
      await invokeDirectWithApproval({
        ...pending.payload,
        options: { ...(pending.payload.options || {}), ...state.runOptions },
        clientStartedAt: pending.payload.clientStartedAt || state.pendingClientStartedAt || Date.now(),
      });
      return;
    }
    if (pending?.kind === "supervisor") {
      await invokeSupervisorWithApproval({
        ...pending.payload,
        options: { ...(pending.payload.options || {}), ...state.runOptions },
        clientStartedAt: pending.payload.clientStartedAt || state.pendingClientStartedAt || Date.now(),
      });
      return;
    }
    await invokeSupervisorWithApproval({ prompt: state.pendingPrompt, attachments: state.pendingAttachments, execute: true, settings: state.settings, options: state.runOptions, expectedRun: gate.run, clientStartedAt: state.pendingClientStartedAt || Date.now() });
  });
  const cancel = document.createElement("button");
  cancel.className = "ghost";
  cancel.textContent = "Not now";
  cancel.addEventListener("click", () => {
    cancel.textContent = "Skipped";
    cancel.classList.add("approved");
    cancel.disabled = true;
    resetRunOptions();
  });
  actions.appendChild(approve);
  actions.appendChild(cancel);
  node.appendChild(copy);
  node.appendChild(actions);
  container.appendChild(node);
  maybeScrollToBottom(container, stick);
}

function humanErrorFromCode(code, stdout, stderr, logPath = "") {
  const text = `${stdout}\n${stderr}`;
  const visible = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("Reading prompt from stdin"))
    .slice(-12)
    .join("\n");
  if (code === 3 || text.includes("Blocked by budget guard")) {
    return "Budget guard blocked this run. Use the approval button or increase the request budget.";
  }
  if (code === 4 || text.includes("requires user approval")) {
    return "This task needs approval because it is high/extra high complexity.";
  }
  if (code === 5) {
    return `Codex failed while executing.${visible ? `\n\n${visible}` : ""}${logPath ? `\n\nLog: ${logPath}` : ""}`;
  }
  return `The run stopped with code ${code}.${visible ? `\n\n${visible}` : ""}${logPath ? `\n\nLog: ${logPath}` : ""}`;
}

function humanError(message) {
  if (String(message).includes("active")) return "Another task is already running.";
  return message;
}

function formatSeconds(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "0s";
  return number < 10 ? `${number.toFixed(1)}s` : `${Math.round(number)}s`;
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return new Intl.NumberFormat("en-US").format(Math.round(number));
}

function formatUsd(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "$0.0000";
  return `$${number.toFixed(4)}`;
}

function usageMetricHtml(usage) {
  if (!usage || !Object.keys(usage).length) return "";
  const phaseSeconds = usage.phase_seconds || {};
  const slowest = Object.entries(phaseSeconds)
    .filter(([name]) => name !== "total")
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0];
  const tokens = usage.tokens || {};
  const context = usage.context || {};
  const cost = usage.cost || {};
  const costSource = cost.source === "codex_cli_tokens_x_configured_price" ? "calc." : "est.";
  const items = [
    ["Time", formatSeconds(usage.end_to_end_seconds || usage.duration_seconds || phaseSeconds.total)],
    ["Slowest", slowest ? `${slowest[0]} ${formatSeconds(slowest[1])}` : "n/a"],
    ["Tokens", `${formatNumber(tokens.total)} ${tokens.source === "estimate" ? "est." : ""}`.trim()],
    ["Context", `${Number(context.used_percent || 0).toFixed(1)}%`],
    ["Cost", `${formatUsd(cost.actual_usd ?? cost.estimated_usd)} ${costSource}`.trim()],
  ];
  return `<div class="metric-grid">${items.map(([label, value]) => `
    <div class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("")}</div>`;
}

function usageDetailsText(usage) {
  if (!usage || !Object.keys(usage).length) return "Usage: not recorded for this run.";
  const phases = Object.entries(usage.phase_seconds || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .map(([name, seconds]) => `- ${name}: ${formatSeconds(seconds)}`)
    .join("\n");
  const tokens = usage.tokens || {};
  const context = usage.context || {};
  const cost = usage.cost || {};
  return [
    "Usage",
    `Duration: ${formatSeconds(usage.end_to_end_seconds || usage.duration_seconds)}`,
    usage.end_to_end_seconds ? `Codex/process time: ${formatSeconds(usage.duration_seconds)}` : "",
    `Tokens: ${formatNumber(tokens.total)} total (${formatNumber(tokens.input)} in, ${formatNumber(tokens.output)} out, ${tokens.source || "estimate"})`,
    `Context: ${formatNumber(context.used_tokens)} / ${formatNumber(context.limit_tokens)} (${Number(context.used_percent || 0).toFixed(2)}%)`,
    `Cost: ${formatUsd(cost.actual_usd ?? cost.estimated_usd)} (${cost.source || "estimated"})`,
    cost.pricing_source ? `Pricing: ${cost.pricing_source}` : "",
    cost.confidence ? `Cost confidence: ${cost.confidence}` : "",
    "",
    "Stages",
    phases || "- no phase data",
  ].filter((line) => line !== "").join("\n");
}

function renderRuns() {
  const list = $("runList");
  list.innerHTML = "";
  if (!state.runs.length) {
    list.innerHTML = `<div class="simple-copy">No runs yet. Plan a task to create the first one.</div>`;
    return;
  }
  state.runs.forEach((run) => {
    const button = document.createElement("button");
    button.className = "run-item";
    button.innerHTML = `
      <div>${escapeHtml(run.request || run.id)}</div>
      ${usageMetricHtml(run.usage)}
      <div class="run-meta">
        <span>${escapeHtml(run.status)}</span>
        <span>${escapeHtml(run.reasoning)}</span>
        <span>${escapeHtml(run.model)}</span>
      </div>
    `;
    button.addEventListener("click", () => selectRun(run.id));
    list.appendChild(button);
  });
  renderDashboard();
}

function renderDashboard() {
  const body = $("dashboardBody");
  if (!body) return;
  const runs = state.runs || [];
  const withUsage = runs.filter((run) => run.usage && Object.keys(run.usage).length);
  const totals = withUsage.reduce((acc, run) => {
    const usage = run.usage || {};
    acc.seconds += Number(usage.duration_seconds || 0);
    acc.tokens += Number(usage.tokens?.total || 0);
    acc.cost += Number(usage.cost?.actual_usd ?? usage.cost?.estimated_usd ?? 0);
    acc.contextMax = Math.max(acc.contextMax, Number(usage.context?.used_percent || 0));
    const route = usage.route?.route || run.usage?.route?.mode || "";
    if (route.includes("auto_direct")) acc.autoDirect += 1;
    if (route.includes("supervisor")) acc.supervisor += 1;
    return acc;
  }, { seconds: 0, tokens: 0, cost: 0, contextMax: 0, autoDirect: 0, supervisor: 0 });
  const slowest = withUsage
    .map((run) => ({ run, seconds: Number(run.usage?.duration_seconds || 0) }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5);
  const failures = runs.filter((run) => !["pass", "planned_only"].includes(String(run.status || ""))).length;
  body.innerHTML = `
    <div class="dashboard-grid">
      ${dashboardCard("Runs", formatNumber(runs.length), `${failures} need review`)}
      ${dashboardCard("Time", formatSeconds(totals.seconds), "recorded total")}
      ${dashboardCard("Tokens", formatNumber(totals.tokens), "estimated or CLI reported")}
      ${dashboardCard("Cost", formatUsd(totals.cost), "estimated where actual unavailable")}
      ${dashboardCard("Max Context", `${totals.contextMax.toFixed(1)}%`, "largest prompt fill")}
      ${dashboardCard("Auto Direct", formatNumber(totals.autoDirect), "supervisor calls skipped")}
    </div>
    <div class="dashboard-section">
      <div class="section-title inline">Slow Runs</div>
      <div class="dashboard-list">
        ${slowest.length ? slowest.map(({ run, seconds }) => `
          <button class="dashboard-run" data-run-id="${escapeHtml(run.id)}">
            <span>${escapeHtml(run.request || run.id)}</span>
            <strong>${formatSeconds(seconds)}</strong>
          </button>
        `).join("") : `<div class="simple-copy">No usage data yet.</div>`}
      </div>
    </div>
  `;
  body.querySelectorAll(".dashboard-run").forEach((button) => {
    button.addEventListener("click", () => selectRun(button.dataset.runId));
  });
}

function dashboardCard(label, value, detail) {
  return `
    <div class="dashboard-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  `;
}

async function selectRun(runId) {
  state.selectedRun = await window.aidev.readRun(runId);
  renderInspector();
}

function renderInspector() {
  const body = $("inspectorBody");
  if (state.processLog) {
    body.textContent = state.processLog;
    return;
  }
  const run = state.selectedRun;
  if (!run) {
    body.textContent = [
      `Mode: ${state.mode}`,
      `Status: ${state.activeRun ? "running" : "ready"}`,
      `Chats: ${state.chats.length}`,
      `Project index: ${state.projectIndex?.file_count || 0} files`,
    ].join("\n");
    return;
  }
  const details = [];
  details.push(`Status: ${run.audit?.status || "unknown"}`);
  details.push(`Request: ${String(run.contract?.user_request || run.request || "").trim().slice(0, 180) || "n/a"}`);
  if (run.contract?.classification) {
    details.push(`Task: ${run.contract.classification.task_type}`);
    details.push(`Reasoning: ${run.contract.classification.reasoning}`);
    details.push(`Model: ${run.contract.model || "unknown"}`);
  }
  const changed = Array.isArray(run.audit?.changed_files) ? run.audit.changed_files : [];
  details.push(`Changed files: ${changed.length}`);
  if (run.validation?.status) {
    details.push(`Validation: ${run.validation.status} (${run.validation.command || "command"})`);
  }
  details.push("");
  details.push(usageDetailsText(run.usage));
  body.textContent = details.join("\n");
}

function renderToggles() {
  const box = $("featureToggles");
  box.innerHTML = "";
  toggles.forEach(([key, label, detail]) => {
    const row = document.createElement("div");
    row.className = "toggle-row";
    row.innerHTML = `
      <div>
        <div>${label}</div>
        <span>${detail}</span>
      </div>
      <button class="switch ${state.settings[key] ? "on" : ""}" aria-label="${label}"></button>
    `;
    row.querySelector("button").addEventListener("click", async () => {
      state.settings[key] = !state.settings[key];
      await window.aidev.saveSettings(state.settings);
      renderToggles();
    });
    box.appendChild(row);
  });
}

function renderBudget(budget) {
  state.budget = budget || {};
  $("sessionBudget").value = numberValue(state.budget.session_budget_usd, 5);
  $("requestBudget").value = numberValue(state.budget.request_budget_usd, 0.5);
  $("retryBudget").value = numberValue(state.budget.retry_budget_usd, 0.15);
  $("maxCalls").value = numberValue(state.budget.max_codex_calls_per_request, 1);
  $("dailyCalls").value = numberValue(state.budget.daily_codex_call_limit, 20);
  $("dailyHighCalls").value = numberValue(state.budget.daily_high_call_limit, 3);
  $("dailyXhighCalls").value = numberValue(state.budget.daily_xhigh_call_limit, 1);
  $("warnPercent").value = numberValue(state.budget.warn_at_percent, 80);
  $("blockPercent").value = numberValue(state.budget.block_at_percent, 95);
  $("budgetBox").textContent = JSON.stringify(budget, null, 2);
}

function catalogList() {
  return Array.isArray(state.settings.modelCatalog) ? state.settings.modelCatalog : [];
}

function filteredModels(mode = "both") {
  const items = catalogList().filter((item) => item && item.enabled !== false);
  const want = String(mode).toLowerCase();
  const filtered = items.filter((item) => {
    const itemMode = String(item.mode || "both").toLowerCase();
    return itemMode === "both" || itemMode === want || want === "both";
  });
  return filtered.length ? filtered : items;
}

function modelOptionsForSelect(mode, selectedValue) {
  const options = [];
  const seen = new Set();
  const source = mode === "supervisor" ? filteredModels("supervisor") : filteredModels("direct");
  for (const item of source) {
    const value = String(item.model || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: `${item.label || value} (${value})` });
  }
  const current = String(selectedValue || "").trim();
  if (current && !seen.has(current)) {
    options.unshift({ value: current, label: current });
  }
  return options;
}

function renderModelSelect(select, mode, selectedValue) {
  if (!select) return;
  const options = modelOptionsForSelect(mode, selectedValue);
  const current = String(selectedValue || select.value || "").trim();
  select.innerHTML = options.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("");
  if (current) select.value = current;
}

function renderAuth() {
  $("useCodexLogin").classList.toggle("on", state.settings.useCodexLogin !== false);
  $("openaiApiKey").value = state.settings.auth?.openaiApiKey || "";
  $("anthropicApiKey").value = state.settings.auth?.anthropicApiKey || "";
  $("openaiBaseUrl").value = state.settings.auth?.openaiBaseUrl || "https://api.openai.com/v1";
  $("localModelUrl").value = state.settings.auth?.localModelUrl || "http://127.0.0.1:11434/v1";
  $("lmStudioUrl").value = state.settings.auth?.lmStudioUrl || "http://127.0.0.1:1234/v1";
  $("supervisorModelMode").value = state.settings.supervisorModelMode || "auto";
  renderModelSelect($("supervisorManualModel"), "both", state.settings.supervisorManualModel || state.settings.supervisorModel);
  renderModelSelect($("modeModel"), state.mode, state.mode === "direct" ? state.settings.directModel : state.settings.supervisorModel);
  renderModelCatalog();
}

async function loadLmStudioModels() {
  const url = $("lmStudioUrl").value.trim() || "http://127.0.0.1:1234/v1";
  $("loadLmStudioModels").disabled = true;
  $("loadLmStudioModels").textContent = "Loading...";
  try {
    const models = await window.aidev.lmStudioModels(url);
    const existing = new Set(state.settings.modelCatalog.map((item) => String(item.model || "")));
    let added = 0;
    for (const model of models) {
      if (existing.has(model)) continue;
      state.settings.modelCatalog.push({
        id: `lmstudio-${model.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`,
        label: `LM Studio ${model}`,
        model,
        provider: "lmstudio",
        reasoning: "none",
        mode: "both",
        taskTags: ["local", "lmstudio", "none"],
        enabled: true,
      });
      existing.add(model);
      added += 1;
    }
    state.settings.auth = { ...(state.settings.auth || {}), lmStudioUrl: url };
    await window.aidev.saveSettings(state.settings);
    renderAuth();
    syncModePanel();
    appendMessage($("supervisorMessages"), "system", `LM Studio: ${models.length} model(s) found, ${added} added.`);
  } catch (error) {
    appendMessage($("supervisorMessages"), "error", `LM Studio connection failed: ${humanError(error?.message || error)}`);
  } finally {
    $("loadLmStudioModels").disabled = false;
    $("loadLmStudioModels").textContent = "Load LM Studio";
  }
}

function renderModelCatalog() {
  const list = $("modelCatalogList");
  if (!list) return;
  const items = catalogList();
  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = `<div class="simple-copy">No models added yet.</div>`;
    return;
  }
  items.forEach((item, index) => {
    const node = document.createElement("div");
    node.className = "catalog-item";
    node.innerHTML = `
      <div class="catalog-item-head">
        <div>
          <div class="catalog-item-title">${escapeHtml(item.label || item.model || "Model")}</div>
          <div class="catalog-item-meta">${escapeHtml(item.model || "")} · ${escapeHtml(item.provider || "openai")} · ${escapeHtml(reasoningLabel(item.reasoning || "medium"))} · ${escapeHtml(item.mode || "both")}</div>
        </div>
        <button class="ghost" data-remove-model="${index}">Remove</button>
      </div>
      <div class="catalog-item-meta">Tags: ${escapeHtml((item.taskTags || []).join(", ") || "default")}</div>
    `;
    node.querySelector("button").addEventListener("click", async () => {
      state.settings.modelCatalog.splice(index, 1);
      await window.aidev.saveSettings(state.settings);
      renderAuth();
      syncModePanel();
    });
    list.appendChild(node);
  });
}

async function addModelFromForm() {
  const label = $("newModelLabel").value.trim();
  const model = $("newModelName").value.trim();
  if (!model) return;
  const entry = {
    id: `model-${Date.now()}`,
    label: label || model,
    model,
    provider: $("newModelProvider").value,
    reasoning: $("newModelReasoning").value || "medium",
    mode: $("newModelMode").value || "both",
    taskTags: $("newModelTags").value.split(",").map((value) => value.trim()).filter(Boolean),
    enabled: true,
  };
  state.settings.modelCatalog.push(entry);
  await window.aidev.saveSettings(state.settings);
  $("newModelLabel").value = "";
  $("newModelName").value = "";
  $("newModelTags").value = "";
  renderAuth();
  syncModePanel();
}

async function runDiagnostics() {
  const result = await window.aidev.diagnostics();
  $("diagnosticsBox").textContent = JSON.stringify(result, null, 2);
  const lines = [
    `Python: ${result.python.available ? "ok" : "missing"} (${result.python.command})`,
    `Codex: ${result.codex.available ? "ok" : "missing"} (${result.codex.command})`,
    `Supervisor model: ${result.supervisor.available ? "ok" : "missing"} (${result.supervisor.model})`,
    `Direct model: ${result.direct.available ? "ok" : "missing"} (${result.direct.model})`,
    `LM Studio: ${result.lmStudio?.catalogModels || 0} catalog model(s) (${result.lmStudio?.url || "not set"})`,
    `Catalog models: ${result.catalogCount}`,
  ];
  appendMessage($("supervisorMessages"), "system", `Diagnostics:\n${lines.join("\n")}`);
}

function fillSettings() {
  $("projectRoot").value = state.root || "";
  $("pythonPath").value = state.settings.pythonPath || "python";
  $("codexCommand").value = state.settings.codexCommand || "codex";
  $("sandboxMode").value = state.config.backend?.sandbox || "workspace-write";
  $("timeoutSeconds").value = numberValue(state.config.backend?.timeout_seconds, 1800);
  $("modeReasoning").value = state.mode === "direct" ? (state.settings.directReasoning || "medium") : (state.settings.supervisorReasoning || "low");
  $("executorDefault").value = state.config.models?.executor_default || "gpt-5.4-mini";
  $("executorComplex").value = state.config.models?.executor_complex || "gpt-5.4";
  $("executorMax").value = state.config.models?.executor_max || "gpt-5.5";
  $("skipGitRepoCheck").classList.toggle("on", Boolean(state.config.backend?.skip_git_repo_check));
  $("notifyOnFinish").classList.toggle("on", Boolean(state.settings.notifyOnFinish));
  $("notifyOnFinish").onclick = () => {
    state.settings.notifyOnFinish = !state.settings.notifyOnFinish;
    $("notifyOnFinish").classList.toggle("on", Boolean(state.settings.notifyOnFinish));
    scheduleSettingsSave();
  };
  $("skipGitRepoCheck").onclick = () => {
    state.config.backend.skip_git_repo_check = !state.config.backend.skip_git_repo_check;
    $("skipGitRepoCheck").classList.toggle("on", Boolean(state.config.backend.skip_git_repo_check));
    scheduleSettingsSave();
  };
}

async function saveSettings() {
  state.settings.pythonPath = $("pythonPath").value.trim() || "python";
  state.settings.codexCommand = $("codexCommand").value.trim() || "codex";
  const currentModel = $("modeModel").value.trim() || "gpt-5.4-mini";
  const currentReasoning = $("modeReasoning").value || (state.mode === "direct" ? "medium" : "low");
  if (state.mode === "direct") {
    state.settings.directModel = currentModel;
    state.settings.directReasoning = currentReasoning;
    state.settings.model = currentModel;
    state.settings.reasoning = currentReasoning;
  } else {
    state.settings.supervisorModel = currentModel;
    state.settings.supervisorReasoning = currentReasoning;
  }
  state.settings.supervisorModelMode = $("supervisorModelMode").value || "auto";
  state.settings.supervisorManualModel = $("supervisorManualModel").value || state.settings.supervisorManualModel || state.settings.supervisorModel || "gpt-5.4-mini";
  state.settings.auth = {
    openaiApiKey: $("openaiApiKey").value.trim(),
    anthropicApiKey: $("anthropicApiKey").value.trim(),
    openaiBaseUrl: $("openaiBaseUrl").value.trim() || "https://api.openai.com/v1",
    localModelUrl: $("localModelUrl").value.trim() || "http://127.0.0.1:11434/v1",
    lmStudioUrl: $("lmStudioUrl").value.trim() || "http://127.0.0.1:1234/v1",
  };
  state.settings.useCodexLogin = $("useCodexLogin").classList.contains("on");
  state.config.backend.sandbox = $("sandboxMode").value || "workspace-write";
  state.config.backend.timeout_seconds = parseNumber($("timeoutSeconds").value, 1800);
  state.config.backend.codex_cli_command = state.settings.codexCommand;
  state.config.supervisor.model = state.settings.supervisorModel || "gpt-5.4-mini";
  state.config.supervisor.reasoning = state.settings.supervisorReasoning || "low";
  state.config.models.supervisor = state.config.supervisor.model;
  state.config.models.router = state.config.supervisor.model;
  state.config.models.executor_default = $("executorDefault").value.trim() || "gpt-5.4-mini";
  state.config.models.executor_complex = $("executorComplex").value.trim() || "gpt-5.4";
  state.config.models.executor_max = $("executorMax").value.trim() || "gpt-5.5";
  state.config.models.catalog = state.settings.modelCatalog;
  state.settings = await window.aidev.saveSettings(state.settings);
  state.config = normalizeConfig(await window.aidev.saveConfig(state.config));
  renderAuth();
}

async function saveBudget() {
  const next = {
    ...state.budget,
    session_budget_usd: parseNumber($("sessionBudget").value, 5),
    request_budget_usd: parseNumber($("requestBudget").value, 0.5),
    retry_budget_usd: parseNumber($("retryBudget").value, 0.15),
    max_codex_calls_per_request: parseNumber($("maxCalls").value, 1),
    daily_codex_call_limit: parseNumber($("dailyCalls").value, 20),
    daily_high_call_limit: parseNumber($("dailyHighCalls").value, 3),
    daily_xhigh_call_limit: parseNumber($("dailyXhighCalls").value, 1),
    warn_at_percent: parseNumber($("warnPercent").value, 80),
    block_at_percent: parseNumber($("blockPercent").value, 95),
    estimated_call_cost_usd: state.budget.estimated_call_cost_usd || {
      low: 0.03,
      medium: 0.08,
      high: 0.25,
      none: 0.01,
      xhigh: 0.6,
    },
  };
  state.budget = await window.aidev.saveBudget(next);
  renderBudget(state.budget);
  $("budgetPill").textContent = budgetLabel(state.budget);
}

async function openProject() {
  await saveWorkspaceUi();
  const result = await window.aidev.openProject();
  if (result?.canceled) return;
  const refreshed = await loadState();
  renderAll(refreshed);
  await ensureWorkspaceReady();
  appendMessage($("supervisorMessages"), "system", `Project opened: ${state.root}`);
}

async function newProject() {
  await saveWorkspaceUi();
  const result = await window.aidev.newProject();
  if (result?.canceled) return;
  const refreshed = await loadState();
  renderAll(refreshed);
  await ensureWorkspaceReady();
  appendMessage($("supervisorMessages"), "system", `Project selected: ${state.root}`);
}

async function startScratchProject() {
  await saveWorkspaceUi();
  const result = await window.aidev.createScratchProject();
  if (result?.canceled) return;
  const refreshed = await loadState();
  renderAll(refreshed);
  await ensureWorkspaceReady();
  appendMessage($("supervisorMessages"), "system", `Project created: ${state.root}`);
}

async function switchProject(root) {
  await saveWorkspaceUi();
  const next = await window.aidev.switchProject(root);
  state.root = next.root;
  state.settings = next.settings;
  state.runs = next.runs || [];
  state.budget = next.budget || {};
  state.config = normalizeConfig(next.config || {});
  ensureSettingsShape();
  state.projects = normalizeProjects(state.settings.projectRegistry);
  loadProjectChats();
  renderAll(next);
  appendMessage($("supervisorMessages"), "system", `Project opened: ${state.root}`);
}

async function removeProject(root) {
  const nextSettings = await window.aidev.removeProject(root);
  state.settings = nextSettings;
  state.projects = normalizeProjects(nextSettings.projectRegistry);
  if (state.root !== nextSettings.projectRoot) {
    const refreshed = await loadState();
    renderAll(refreshed);
  } else {
    renderProjectSidebar();
  }
}

async function refreshActiveProjectSummary() {
  setSendStatus("Refreshing project summary...");
  await saveWorkspaceUi();
  state.settings = await window.aidev.refreshProjectSummary(state.root);
  state.projects = normalizeProjects(state.settings.projectRegistry);
  renderProjectSidebar();
  setSendStatus("Project summary refreshed.");
}

async function rebuildProjectIndex() {
  setSendStatus("Rebuilding project index...");
  state.projectIndex = await window.aidev.rebuildProjectIndex();
  updateContextMeter();
  renderInspector();
  setSendStatus(`Project index ready: ${state.projectIndex.file_count || 0} files.`);
}

async function ensureWorkspaceReady() {
  try {
    await window.aidev.init();
  } catch (error) {
    appendMessage($("supervisorMessages"), "error", error.message || String(error));
  }
}

async function openPath(target) {
  const ok = await window.aidev.openPath(target);
  if (!ok) {
    appendMessage($("supervisorMessages"), "error", `Could not open: ${target}`);
  }
}

function budgetLabel(budget) {
  if (!budget.request_budget_usd) return "Budget not set";
  return `$${budget.request_budget_usd} request cap`;
}

function titleCase(value) {
  if (value === "auth") return "Auth";
  if (value === "runs") return "History";
  if (value === "dashboard") return "Dashboard";
  if (value === "rules") return "Safety";
  if (value === "budget") return "Limits";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function shortPath(value) {
  if (!value) return "Project";
  const parts = value.split(/[\\/]/);
  return parts[parts.length - 1] || value;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberValue(value, fallback) {
  return String(value ?? fallback);
}

function normalizeConfig(config) {
  const next = {
    version: 1,
    backend: {},
    models: {},
    supervisor: {},
    reasoning: {},
    approval: {},
    execution: {},
    ...config,
  };
  next.backend = {
    default: "codex_cli",
    codex_cli_command: "codex",
    sandbox: "workspace-write",
    skip_git_repo_check: true,
    timeout_seconds: 1800,
    ...(config.backend || {}),
  };
  next.models = {
    supervisor: "gpt-5.4-mini",
    router: "gpt-5.4-mini",
    executor_default: "gpt-5.4-mini",
    executor_complex: "gpt-5.4",
    executor_max: "gpt-5.5",
    ...(config.models || {}),
  };
  next.supervisor = {
    model: next.models.supervisor || next.models.router || "gpt-5.4-mini",
    reasoning: "low",
    ...(config.supervisor || {}),
  };
  return next;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

boot().catch((error) => {
  document.body.innerHTML = `<pre>${escapeHtml(error.stack || error.message)}</pre>`;
});
