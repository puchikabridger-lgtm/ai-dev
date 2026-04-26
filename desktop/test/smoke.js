const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const cp = require("node:child_process");

const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const mainJs = read("src/main.js");
const rendererJs = read("src/renderer/app.js");
const rendererHtml = read("src/renderer/index.html");

assert.match(mainJs, /function commandExists\(/, "commandExists helper is missing");
assert.match(mainJs, /function hasGitRepository\(/, "git repository helper is missing");
assert.doesNotMatch(mainJs, /shutil\b/, "main.js still references shutil");
assert.doesNotMatch(mainJs, /has_git\(/, "main.js still calls the Python-only has_git helper");
assert.match(mainJs, /ipcMain\.handle\("app:diagnostics"/, "diagnostics handler is missing");
assert.match(mainJs, /ipcMain\.handle\("run:supervisor-analyze"/, "supervisor analyze handler is missing");
assert.match(mainJs, /ipcMain\.handle\("attachments:pick"/, "attachment picker handler is missing");
assert.match(mainJs, /buildAttachmentsContext/, "attachment context builder is missing");
assert.match(mainJs, /ipcMain\.handle\("workspace:switchProject"/, "project switch handler is missing");
assert.match(mainJs, /ipcMain\.handle\("workspace:removeProject"/, "project remove handler is missing");
assert.match(mainJs, /workspace:refreshProjectSummary/, "model-backed project summary refresh is missing");
assert.match(mainJs, /AIDEV_GLOBAL_RULES_DIR/, "global user memory is not passed to supervisor");
assert.match(mainJs, /function buildProjectIndex\(/, "project index builder is missing");
assert.match(mainJs, /function buildSmartContext\(/, "smart context builder is missing");
assert.match(mainJs, /function secretsFile\(/, "auth secrets should be stored outside project settings");
assert.match(mainJs, /function sanitizedSettings\(/, "settings sanitizer is missing");
assert.match(mainJs, /delete next\.auth\.openaiApiKey/, "OpenAI key should not be persisted in project settings");
assert.match(mainJs, /backupFileOncePerMinute/, "settings saves should create safety backups");
assert.match(mainJs, /nonEmptyChatSessions/, "settings saves should preserve existing chat history");
assert.match(mainJs, /AIDEV_PROJECT_ROOT/, "project root should be passed explicitly to subprocesses");
assert.match(mainJs, /Feature \/discuss/, "backend feature instructions are missing");
assert.match(mainJs, /Feature \/todolist/, "backend todolist feature instruction is missing");
assert.match(mainJs, /ipcMain\.handle\("project:index"/, "project index IPC is missing");
assert.match(mainJs, /ipcMain\.handle\("run:validate"/, "run validation IPC is missing");
assert.match(mainJs, /Notification/, "desktop notifications should be available");
assert.match(mainJs, /maybeNotifyFinished/, "finished-run notification helper is missing");
assert.match(mainJs, /ipcMain\.handle\("models:lmstudio"/, "LM Studio model loader IPC is missing");
assert.match(mainJs, /providerBaseUrl/, "provider-specific base URL routing is missing");
assert.match(mainJs, /normalizeModelName/, "unsupported model aliases should be normalized");
assert.doesNotMatch(mainJs, /model:\s*"gpt-5\.4-pro"|executor_max:\s*"gpt-5\.4-pro"/, "gpt-5.4-pro should not be a built-in/default model");
assert.match(mainJs, /gpt-5\.5/, "gpt-5.5 should be available as the max model");
assert.match(mainJs, /getMilliseconds\(\)\)\.padStart\(3,\s*"0"\)/, "JS run IDs should use three millisecond digits without slicing the ISO decimal point");
assert.doesNotMatch(mainJs, /slice\(15,\s*18\)/, "JS run IDs should not derive milliseconds by slicing the ISO string");
assert.match(mainJs, /b\.sortKey - a\.sortKey \|\| b\.mtimeMs - a\.mtimeMs \|\| b\.id\.localeCompare\(a\.id\)/, "desktop run sorting should use mtime before ID tie-breaker");

assert.match(rendererJs, /runDiagnostics\(/, "renderer diagnostics action is missing");
assert.match(rendererJs, /analyzing prompt\.\.\./, "send flow is missing analyzing step");
assert.match(rendererJs, /Send clicked/, "send click diagnostic is missing");
assert.match(rendererJs, /Send handler started/, "send handler diagnostic is missing");
assert.match(rendererJs, /drafts:\s*{[\s\S]*supervisor:\s*""[\s\S]*direct:\s*""/, "chat drafts state is missing");
assert.match(rendererJs, /appendLiveOutput/, "live output rendering is missing");
assert.match(rendererJs, /cleanLiveOutput/, "live output cleanup is missing");
assert.match(rendererJs, /clientStartedAt/, "renderer should pass prompt-start time to runs");
assert.match(rendererJs, /end_to_end_seconds/, "renderer should display end-to-end prompt timing");
assert.match(rendererJs, /loadLmStudioModels/, "LM Studio model loader UI action is missing");
assert.match(rendererJs, /notifyOnFinish/, "notification setting is missing from renderer");
assert.match(rendererJs, /chatHistory/, "chat history state is missing");
assert.match(rendererJs, /directHistoryForPrompt/, "direct history prompt helper is missing");
assert.match(rendererJs, /appendPipelineStep/, "pipeline step rendering is missing");
assert.match(rendererJs, /appendSupervisorAnalysis/, "real supervisor analysis rendering is missing");
assert.match(rendererJs, /supervisorRouteDecision/, "supervisor auto router is missing");
assert.match(rendererJs, /как улучшить/, "project improvement questions should route to discussion");
assert.match(rendererJs, /what should improve/, "English improvement questions should route to discussion");
assert.match(rendererJs, /renderDashboard/, "dashboard rendering is missing");
assert.match(rendererJs, /function newChat\(/, "new chat action is missing");
assert.match(rendererJs, /function renderChatNavigation\(/, "chat navigation rendering is missing");
assert.match(rendererJs, /function renderAttachmentTray\(/, "attachment tray renderer is missing");
assert.match(rendererJs, /function updateContextMeter\(/, "context meter renderer is missing");
assert.match(rendererJs, /function renderProjectSidebar\(/, "project sidebar renderer is missing");
assert.match(rendererJs, /function attachResizers\(/, "resizable layout is missing");
assert.match(rendererJs, /function emptyChat\(/, "empty New Chat filtering is missing");
assert.match(rendererJs, /function removeChat\(/, "chat remove action is missing");
assert.match(rendererJs, /contextmenu/, "right-click chat/project actions are missing");
assert.match(rendererJs, /function chatTimelineHtml\(/, "chat timeline renderer is missing");
assert.match(rendererJs, /function normalizeChatMessages\(/, "chat timeline migration is missing");
assert.match(rendererJs, /timeline-undo/, "timeline undo button is missing");
assert.match(rendererJs, /function compactChatHistory\(/, "chat summary compaction is missing");
assert.match(rendererJs, /function promptQualityDecision\(/, "prompt quality router is missing");
assert.match(rendererJs, /if \(state\.mode !== "direct"\)/, "Direct mode should not require clarification gate");
assert.match(rendererJs, /function parseFeatureDirective\(/, "slash feature parser is missing");
assert.match(rendererJs, /todolist/, "todolist feature is missing from renderer");
assert.match(rendererJs, /function setFeature\(/, "feature chip state is missing");
assert.match(rendererJs, /Feature: \$\{featureLabel\(feature\)\}/, "feature mode is missing from prompt preview");
assert.match(rendererJs, /function rebuildProjectIndex\(/, "project index UI action is missing");
assert.match(rendererJs, /validateRun/, "validation UI action is missing");
assert.match(rendererJs, /querySelectorAll\("\.top-tab"\)/, "top navigation tabs are not wired");
assert.match(rendererJs, /codex started:/, "codex start step is missing");
assert.match(rendererJs, /expectedRun: analysis\.run/, "supervisor execute should reuse analyzed run contract");
assert.match(rendererJs, /payload\.run\?\.contract/, "codex start step should display actual analyzed contract");
assert.match(rendererJs, /Supervisor plan/, "planned-only runs should not be labeled as Codex answers");
assert.match(rendererJs, /No files were changed because this was a planning-only run/, "planned-only runs should explain why there are no file changes");
assert.match(mainJs, /Conversation context:/, "direct prompt does not include conversation context");
assert.match(mainJs, /before-files/, "run snapshots are missing");
assert.match(mainJs, /routeDecision/, "direct route decisions are not persisted");
assert.match(mainJs, /payload\.detached/, "standalone chat direct route is missing");
assert.match(mainJs, /payload\.supervisorMode/, "standalone chat supervisor toggle is missing");
assert.match(mainJs, /Supervisor mode is enabled/, "standalone supervisor prompt instruction is missing");
assert.match(mainJs, /directReasoning === "none"/, "none reasoning should omit direct reasoning preference");
assert.match(mainJs, /supervisor_reasoning/, "supervisor reasoning should be passed to supervisor runs");
assert.match(mainJs, /clientDurationSeconds/, "main process should report prompt-to-finish timing");
assert.match(mainJs, /clientElapsedSeconds/, "main process should heartbeat prompt elapsed time");
assert.match(mainJs, /modelTokenPrices/, "direct runs should estimate cost from model token prices");
assert.match(mainJs, /codex_cli_tokens_x_configured_price/, "direct cost should mark CLI-token-based calculations");
assert.match(mainJs, /payload\.expectedRun\?\.contract/, "supervisor run should accept analyzed contract");
assert.match(mainJs, /runOptions\.forceReasoning/, "supervisor run should force analyzed reasoning");
assert.match(mainJs, /runOptions\.forceModel/, "supervisor run should force analyzed model");
assert.match(mainJs, /standalone chat, not a project task/, "standalone chat prompt guard is missing");
assert.match(mainJs, /detached \? "read-only"/, "standalone chats should run in read-only sandbox");

assert.match(rendererHtml, /id="sendButton"/, "Send button is missing");
assert.match(rendererHtml, /id="dashboardTab"/, "Dashboard tab is missing");
assert.match(rendererHtml, /id="dashboardView"/, "Dashboard view is missing");
assert.match(rendererHtml, /id="newChatButton"/, "New Chat button is missing");
assert.doesNotMatch(rendererHtml, /id="chatTabs"/, "right chat tabs should be removed");
assert.doesNotMatch(rendererHtml, /id="chatList"/, "right chat list should be removed");
assert.match(rendererHtml, /class="top-tabs"/, "main navigation should be top tabs");
assert.match(rendererHtml, /id="sendStatus"/, "Send status is missing");
assert.match(rendererHtml, /id="authTab"/, "Auth tab is missing");
assert.match(rendererHtml, /id="notifyOnFinish"/, "notification toggle is missing");
assert.match(rendererHtml, /id="lmStudioUrl"/, "LM Studio URL setting is missing");
assert.match(rendererHtml, /id="loadLmStudioModels"/, "LM Studio load button is missing");
assert.match(rendererHtml, /<option value="lmstudio">lmstudio<\/option>/, "LM Studio provider option is missing");
assert.match(rendererHtml, /id="diagnosticsBox"/, "Diagnostics box is missing");
assert.match(rendererHtml, /id="attachButton"/, "composer attachment button is missing");
assert.match(rendererHtml, /id="contextPercent"/, "context usage meter is missing");
assert.match(rendererHtml, /id="projectList"/, "project sidebar list is missing");
assert.match(rendererHtml, /id="startScratchProject"/, "start from scratch button is missing");
assert.match(rendererHtml, /id="openDetachedChats"/, "standalone chats entry is missing");
assert.match(rendererHtml, /id="detachedChatList"/, "standalone chat list is missing");
assert.match(rendererHtml, /id="refreshProjectSummary"/, "refresh summary button is missing");
assert.match(rendererHtml, /id="rebuildProjectIndex"/, "rebuild project index button is missing");
assert.match(rendererHtml, /id="costEstimate"/, "smart cost estimate is missing");
assert.match(rendererHtml, /data-feature="code"/, "/code feature chip is missing");
assert.match(rendererHtml, /data-feature="plan"/, "/plan feature chip is missing");
assert.match(rendererHtml, /data-feature="todolist"/, "/todolist feature chip is missing");
assert.match(rendererHtml, /data-feature="discuss"/, "/discuss feature chip is missing");
assert.match(rendererHtml, /class="mode-strip composer-mode"/, "mode switch should live in the composer");
assert.match(rendererHtml, /<option value="none">none<\/option>/, "none reasoning option is missing");
assert.doesNotMatch(rendererHtml, /chat-control-body[\s\S]*<div class="mode-strip">/, "mode switch should not live in the right inspector");
assert.match(require("node:fs").readFileSync(path.resolve(root, "..", "aidev.py"), "utf8"), /TECHNICAL PROMPT/, "supervisor technical prompt section is missing");
assert.match(require("node:fs").readFileSync(path.resolve(root, "..", "aidev.py"), "utf8"), /ROLLBACK_REQUIRED/, "rollback trigger is missing");
assert.match(require("node:fs").readFileSync(path.resolve(root, "..", "aidev.py"), "utf8"), /model_token_prices_usd_per_1m/, "supervisor cost should use model token pricing");
assert.match(require("node:fs").readFileSync(path.resolve(root, "..", "aidev.py"), "utf8"), /token_price_estimate/, "supervisor cost should distinguish token estimates");
assert.match(require("node:fs").readFileSync(path.resolve(root, "..", "aidev.py"), "utf8"), /def initial_project_root\(/, "CLI should support explicit project root resolution");
assert.match(require("node:fs").readFileSync(path.resolve(root, "..", "aidev.py"), "utf8"), /\.ai\/desktop\/settings\.json/, "project-local settings should be excluded from snapshots");
assert.doesNotMatch(rendererHtml, /id="directMessages"/, "separate direct messages pane should be removed");
assert.doesNotMatch(rendererHtml, /class="rail"/, "main navigation rail should be removed");
assert.doesNotMatch(rendererJs, /directMessages/, "renderer should not write to a separate direct messages pane");
assert.match(rendererJs, /DETACHED_CHAT_KEY/, "standalone chat storage key is missing");
assert.match(rendererJs, /function switchDetachedChats\(/, "standalone chat switcher is missing");
assert.match(rendererJs, /supervisorMode: state\.mode === "supervisor"/, "standalone chats should pass supervisor mode");
assert.match(rendererJs, /standalone_\$\{state\.mode\}_\$\{effectiveFeature\}/, "standalone route decision is missing");

const planned = cp.execFileSync("python", [
  "aidev.py",
  "run",
  "change x to 3",
  "--ui-settings",
  "{}",
], {
  cwd: path.resolve(root, ".."),
  encoding: "utf8",
});

assert.match(planned, /Planned only\. Re-run with --execute to call Codex\./, "planned run did not complete");

const oauthPlan = cp.execFileSync("python", [
  "aidev.py",
  "run",
  "Access blocked Authorization Error OAuth client was not found Error 401 invalid_client Rewrite",
  "--ui-settings",
  "{}",
], {
  cwd: path.resolve(root, ".."),
  encoding: "utf8",
});

assert.match(oauthPlan, /Reasoning: medium/, "narrow OAuth/client config errors should use medium reasoning");
assert.doesNotMatch(oauthPlan, /Reasoning: high/, "narrow OAuth/client config errors should not require high approval");

const helloWorldPlan = cp.execFileSync("python", [
  "aidev.py",
  "run",
  "hello can you code hello world in python",
  "--ui-settings",
  "{}",
], {
  cwd: path.resolve(root, ".."),
  encoding: "utf8",
});

assert.match(helloWorldPlan, /Task type: small_create/, "hello world should be a small_create task");
assert.match(helloWorldPlan, /Reasoning: none/, "hello world should use none reasoning");
assert.match(helloWorldPlan, /Model: gpt-5\.4-mini/, "hello world should use the cheap mini model");

const runsDir = path.resolve(root, "..", ".ai", "runs");
const latestRun = fs.readdirSync(runsDir)
  .map((name) => ({ name, mtimeMs: fs.statSync(path.join(runsDir, name)).mtimeMs }))
  .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name))
  .pop().name;
assert.match(latestRun, /^\d{8}-\d{6}-\d{3}-/, "run IDs should include millisecond precision");
const latestPrompt = fs.readFileSync(path.resolve(runsDir, latestRun, "prompt.md"), "utf8");
const latestUsage = JSON.parse(fs.readFileSync(path.resolve(runsDir, latestRun, "usage.json"), "utf8"));
assert.ok(latestPrompt.length < 1900, "low task prompt should stay compact");
assert.doesNotMatch(latestPrompt, /# Task Contract/, "low task prompt should not include full contract dump");
assert.match(latestPrompt, /TASK/, "compact prompt should include task section");
assert.match(latestPrompt, /RULES/, "compact prompt should include rules digest");
assert.ok(latestUsage.duration_seconds >= 0, "usage should record run duration");
assert.ok(latestUsage.tokens.total > 0, "usage should record token estimate");
assert.ok(latestUsage.context.used_percent >= 0, "usage should record context fill");
assert.ok(latestUsage.cost.estimated_usd >= 0, "usage should record cost estimate");

cp.execFileSync(process.execPath, [path.resolve(__dirname, "spawn-async.test.js")], { stdio: "inherit" });

console.log("Smoke checks passed.");
