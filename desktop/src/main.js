const { app, BrowserWindow, ipcMain, shell, dialog, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const cp = require("child_process");
const crypto = require("crypto");
const { spawnAsync } = require("./spawn-async");
const { restoreRunFromDir } = require("./restore-run");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const APP_AI_DIR = path.join(APP_ROOT, ".ai");
const APP_DESKTOP_DATA_DIR = path.join(APP_AI_DIR, "desktop");
const SETTINGS_FILE = path.join(APP_DESKTOP_DATA_DIR, "settings.json");

const DEFAULT_SETTINGS = {
  mode: "supervisor",
  pythonPath: "python",
  codexCommand: "codex",
  projectRoot: APP_ROOT,
  model: "gpt-5.4-mini",
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
  defaultProjectsDir: "",
  layout: {
    sidebarWidth: 292,
    inspectorWidth: 340,
  },
  projectRegistry: [],
  chatSessions: {},
  auth: {
    openaiApiKey: "",
    anthropicApiKey: "",
    openaiBaseUrl: "https://api.openai.com/v1",
    localModelUrl: "http://127.0.0.1:11434/v1",
    lmStudioUrl: "http://127.0.0.1:1234/v1",
  },
  modelCatalog: [
    {
      id: "builtin-mini",
      label: "gpt-5.4 mini",
      model: "gpt-5.4-mini",
      provider: "openai",
      reasoning: "low",
      mode: "both",
      taskTags: ["default", "none", "low"],
      enabled: true,
    },
    {
      id: "builtin-main",
      label: "gpt-5.4",
      model: "gpt-5.4",
      provider: "openai",
      reasoning: "medium",
      mode: "both",
      taskTags: ["bugfix", "ui", "feature", "medium"],
      enabled: true,
    },
    {
      id: "builtin-max",
      label: "gpt-5.5",
      model: "gpt-5.5",
      provider: "openai",
      reasoning: "high",
      mode: "supervisor",
      taskTags: ["high", "xhigh", "architecture", "auth"],
      enabled: true,
    },
  ],
};

let mainWindow;
let activeProcess = null;
let terminalProcess = null;

function startupProjectRoot() {
  const args = process.argv.slice(1);
  const projectFlag = args.findIndex((arg) => arg === "--project");
  const candidate = projectFlag >= 0 ? args[projectFlag + 1] : "";
  if (!candidate) return "";
  const resolved = path.resolve(candidate);
  return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() ? resolved : "";
}

function createWindow() {
  const startupRoot = startupProjectRoot();
  if (startupRoot) {
    const next = touchProject(startupRoot);
    ensureWorkspace(startupRoot);
  }
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 700,
    title: "AI Dev",
    icon: path.join(__dirname, "..", "assets", "app-icon.ico"),
    backgroundColor: "#111111",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#111111",
      symbolColor: "#e8e1d8",
      height: 40,
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureWorkspace(root = projectRoot()) {
  const aiDir = path.join(root, ".ai");
  ensureDir(aiDir);
  ensureDir(path.join(aiDir, "config"));
  ensureDir(path.join(aiDir, "budget"));
  ensureDir(path.join(aiDir, "runs"));
  ensureDir(path.join(aiDir, "desktop"));
  ensureDir(path.join(aiDir, "rules"));
}

function globalMemoryDir() {
  return path.join(app.getPath("userData"), "global-memory");
}

function ensureGlobalMemory() {
  const dir = globalMemoryDir();
  ensureDir(dir);
  const globalRules = path.join(dir, "global.md");
  const learnedRules = path.join(dir, "learned.md");
  if (!fs.existsSync(globalRules)) {
    fs.writeFileSync(globalRules, "# Global User Memory\n\nShared user preferences and rules across all projects.\n", "utf8");
  }
  if (!fs.existsSync(learnedRules)) {
    fs.writeFileSync(learnedRules, "# Learned User Rules\n\n", "utf8");
  }
  return dir;
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

function secretsFile() {
  return path.join(app.getPath("userData"), "secrets.json");
}

function authSecrets() {
  const secrets = readJson(secretsFile(), {});
  return secrets && typeof secrets === "object" ? secrets : {};
}

function sanitizedSettings(value) {
  const next = { ...(value || {}) };
  next.auth = { ...(next.auth || {}) };
  delete next.auth.openaiApiKey;
  delete next.auth.anthropicApiKey;
  return next;
}

function persistAuthSecrets(value) {
  const auth = value?.auth || {};
  const current = authSecrets();
  const next = { ...current };
  if (Object.prototype.hasOwnProperty.call(auth, "openaiApiKey")) {
    next.openaiApiKey = String(auth.openaiApiKey || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(auth, "anthropicApiKey")) {
    next.anthropicApiKey = String(auth.anthropicApiKey || "").trim();
  }
  writeJson(secretsFile(), next);
  return next;
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function settings() {
  const stored = readJson(SETTINGS_FILE, {});
  if (stored?.auth?.openaiApiKey || stored?.auth?.anthropicApiKey) {
    persistAuthSecrets(stored);
  }
  const current = { ...DEFAULT_SETTINGS, ...stored };
  current.auth = { ...DEFAULT_SETTINGS.auth, ...(current.auth || {}), ...authSecrets() };
  current.layout = { ...DEFAULT_SETTINGS.layout, ...(current.layout || {}) };
  if (!current.defaultProjectsDir) {
    current.defaultProjectsDir = path.join(app.getPath("documents"), "AI Dev Projects");
  }
  current.modelCatalog = Array.isArray(current.modelCatalog) && current.modelCatalog.length ? current.modelCatalog : DEFAULT_SETTINGS.modelCatalog;
  current.projectRegistry = Array.isArray(current.projectRegistry) ? current.projectRegistry : [];
  current.chatSessions = current.chatSessions && typeof current.chatSessions === "object" ? current.chatSessions : {};
  ensureDir(APP_DESKTOP_DATA_DIR);
  writeJson(SETTINGS_FILE, sanitizedSettings(current));
  return current;
}

function projectSummary(root) {
  const candidates = [
    path.join(root, ".ai", "summaries", "project.md"),
    path.join(root, ".ai", "summaries", "summary.md"),
    path.join(root, ".ai", "project", "overview.md"),
    path.join(root, "README.md"),
  ];
  for (const file of candidates) {
    const text = readText(file).replace(/^#+\s*/gm, "").trim();
    if (text) {
      return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" ").slice(0, 120);
    }
  }
  return "No summary yet.";
}

async function refreshProjectSummary(root) {
  const current = settings();
  const selected = path.resolve(root || projectRoot());
  const fallback = projectSummary(selected);
  const codex = resolveCommand(current.codexCommand);
  let summary = fallback;
  if (codex) {
    const source = [
      readText(path.join(selected, ".ai", "summaries", "project.md")),
      readText(path.join(selected, ".ai", "project", "overview.md")),
      readText(path.join(selected, "README.md")),
    ].join("\n\n").trim().slice(0, 12000);
    if (source) {
      const result = await spawnAsync(codex, [
        "exec",
        "-",
        "--cd",
        selected,
        "-m",
        current.directModel || current.model || "gpt-5.4-mini",
        "-s",
        "read-only",
      ], {
        input: `Write one short project summary for a sidebar. Max 12 words. No markdown.\n\n${source}`,
        cwd: selected,
        shell: needsShell(codex),
        encoding: "utf8",
        env: processEnvForSettings(current),
        timeout: 120000,
      });
      const text = String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-1)[0];
      if (result.status === 0 && text) summary = text.replace(/^["']|["']$/g, "").slice(0, 120);
    }
  }
  return touchProject(selected, { summary });
}

function projectNameFromRoot(root) {
  return path.basename(path.resolve(root)) || root;
}

function touchProject(root, extra = {}) {
  const current = settings();
  const resolved = path.resolve(root);
  const registry = Array.isArray(current.projectRegistry) ? current.projectRegistry : [];
  const existing = registry.find((item) => path.resolve(item.root) === resolved);
  const next = {
    id: existing?.id || crypto.createHash("sha1").update(resolved).digest("hex").slice(0, 12),
    root: resolved,
    name: extra.name || existing?.name || projectNameFromRoot(resolved),
    summary: extra.summary || existing?.summary || projectSummary(resolved),
    open: extra.open ?? existing?.open ?? true,
    lastUsed: Date.now(),
  };
  const merged = [next, ...registry.filter((item) => path.resolve(item.root) !== resolved)]
    .sort((a, b) => Number(b.lastUsed || 0) - Number(a.lastUsed || 0));
  current.projectRegistry = merged;
  current.projectRoot = resolved;
  writeJson(SETTINGS_FILE, current);
  return current;
}

function projectRoot() {
  const root = settings().projectRoot || APP_ROOT;
  return path.resolve(root);
}

function projectAiDir() {
  return path.join(projectRoot(), ".ai");
}

function projectRunsDir() {
  return path.join(projectAiDir(), "runs");
}

function projectDesktopDir() {
  return path.join(projectAiDir(), "desktop");
}

function aidevScript() {
  return path.join(APP_ROOT, "aidev.py");
}

function projectConfig() {
  ensureWorkspace();
  return readJson(path.join(projectAiDir(), "config", "project.json"), {});
}

function projectIndexFile() {
  return path.join(projectAiDir(), "project", "index.json");
}

function terminalHistoryFile() {
  return path.join(projectDesktopDir(), "terminal-history.json");
}

function sourceKind(rel) {
  const ext = path.extname(rel).toLowerCase();
  if ([".js", ".jsx", ".ts", ".tsx"].includes(ext)) return "javascript";
  if (ext === ".py") return "python";
  if ([".css", ".scss"].includes(ext)) return "style";
  if ([".html", ".md", ".json", ".yml", ".yaml"].includes(ext)) return ext.slice(1);
  return "file";
}

function extractSymbols(text, rel) {
  const kind = sourceKind(rel);
  const symbols = [];
  const patterns = [
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\bclass\s+([A-Za-z_$][\w$]*)\b/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    /\bdef\s+([A-Za-z_]\w*)\s*\(/g,
    /\bclass\s+([A-Za-z_]\w*)\s*[:\(]/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1] && !symbols.includes(match[1])) symbols.push(match[1]);
      if (symbols.length >= 24) return symbols;
    }
  }
  if (kind === "html") {
    for (const match of text.matchAll(/\bid=["']([^"']+)["']/g)) {
      symbols.push(`#${match[1]}`);
      if (symbols.length >= 24) break;
    }
  }
  return symbols;
}

function packageCommands(root) {
  const commands = [];
  const packageJson = readJson(path.join(root, "package.json"), {});
  for (const [name, command] of Object.entries(packageJson.scripts || {})) {
    commands.push({ name, command: `npm run ${name}` });
  }
  if (fs.existsSync(path.join(root, "pytest.ini")) || fs.existsSync(path.join(root, "pyproject.toml"))) {
    commands.push({ name: "pytest", command: "pytest" });
  }
  return commands;
}

function buildProjectIndex(root = projectRoot()) {
  ensureWorkspace(root);
  const files = [];
  const allFiles = walkFiles(root)
    .map((file) => normalizeRel(path.relative(root, file)))
    .filter((rel) => !isSnapshotIgnored(rel))
    .filter((rel) => {
      const ext = path.extname(rel).toLowerCase();
      return [".js", ".jsx", ".ts", ".tsx", ".py", ".css", ".scss", ".html", ".md", ".json", ".yml", ".yaml", ".ps1", ".cmd", ".sh"].includes(ext);
    })
    .slice(0, 900);
  for (const rel of allFiles) {
    const abs = path.join(root, rel);
    const stat = fs.statSync(abs);
    const text = stat.size <= 220000 ? readText(abs) : "";
    files.push({
      path: rel,
      kind: sourceKind(rel),
      bytes: stat.size,
      symbols: text ? extractSymbols(text, rel) : [],
      lines: text ? text.split(/\r?\n/).length : 0,
    });
  }
  const index = {
    root,
    generated_at: new Date().toISOString(),
    file_count: files.length,
    commands: packageCommands(root),
    files,
  };
  writeJson(projectIndexFile(), index);
  return index;
}

function readProjectIndex() {
  const index = readJson(projectIndexFile(), null);
  if (index?.files?.length) return index;
  try {
    return buildProjectIndex();
  } catch {
    return { root: projectRoot(), generated_at: "", file_count: 0, commands: [], files: [] };
  }
}

function relevantIndexFiles(prompt, limit = 8) {
  const index = readProjectIndex();
  const terms = String(prompt || "").toLowerCase().split(/[^a-zа-яё0-9_$#.-]+/i).filter((term) => term.length >= 3);
  const scored = (index.files || []).map((file) => {
    const haystack = `${file.path} ${(file.symbols || []).join(" ")}`.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 4 : 0), 0)
      + (/\b(ui|interface|button|style|css|html|frontend|интерфейс|кнопк|стил)/i.test(prompt) && ["style", "html", "javascript"].includes(file.kind) ? 2 : 0)
      + (/\b(test|spec|pytest|jest|тест)/i.test(prompt) && /test|spec/i.test(file.path) ? 5 : 0);
    return { file, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  return scored.map((item) => item.file);
}

function buildSmartContext(prompt) {
  const index = readProjectIndex();
  const relevant = relevantIndexFiles(prompt, 8);
  const sections = [];
  sections.push(`Project index: ${index.file_count || 0} source files. Commands: ${(index.commands || []).map((item) => item.command).slice(0, 8).join(", ") || "none detected"}.`);
  if (relevant.length) {
    sections.push("Relevant files from semantic map:");
    for (const file of relevant) {
      sections.push(`- ${file.path} (${file.kind}, ${file.lines || 0} lines)${file.symbols?.length ? ` symbols: ${file.symbols.slice(0, 12).join(", ")}` : ""}`);
    }
  }
  return { index, relevant, text: sections.join("\n") };
}

function readTerminalHistory() {
  const items = readJson(terminalHistoryFile(), []);
  return Array.isArray(items) ? items.filter((item) => typeof item === "string" && item.trim()).slice(-500) : [];
}

function rememberTerminalCommand(command) {
  const text = String(command || "").trim();
  if (!text) return readTerminalHistory();
  const history = readTerminalHistory();
  history.push(text);
  const next = history.slice(-500);
  writeJson(terminalHistoryFile(), next);
  return next;
}

function terminalShellCommand(command) {
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      display: command,
    };
  }
  return {
    command: process.env.SHELL || "/bin/sh",
    args: ["-lc", command],
    display: command,
  };
}

function terminalCdTarget(command, cwd) {
  const match = String(command || "").trim().match(/^(?:cd|chdir)(?:\s+(.+))?$/i);
  if (!match) return "";
  let target = String(match[1] || app.getPath("home")).trim();
  target = target.replace(/^["']|["']$/g, "");
  if (!target) target = app.getPath("home");
  return path.resolve(cwd, target);
}

function runTerminalCommand(payload = {}) {
  if (terminalProcess) {
    throw new Error("Terminal command is already running.");
  }
  const commandText = String(payload.command || "").trim();
  if (!commandText) throw new Error("Terminal command is empty.");
  const cwd = path.resolve(String(payload.cwd || projectRoot()));
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`Terminal folder does not exist: ${cwd}`);
  }

  const shellCommand = terminalShellCommand(commandText);
  const id = `terminal-${Date.now()}`;
  rememberTerminalCommand(commandText);
  mainWindow.webContents.send("terminal-start", { id, command: commandText, cwd });

  const cdTarget = terminalCdTarget(commandText, cwd);
  if (cdTarget) {
    if (!fs.existsSync(cdTarget) || !fs.statSync(cdTarget).isDirectory()) {
      mainWindow.webContents.send("terminal-output", { id, stream: "stderr", text: `cd: folder not found: ${cdTarget}\n` });
      mainWindow.webContents.send("terminal-finish", { id, code: 1, signal: "" });
      return { ok: false, id, cwd, history: readTerminalHistory() };
    }
    mainWindow.webContents.send("terminal-output", { id, stream: "stdout", text: `${cdTarget}\n` });
    mainWindow.webContents.send("terminal-finish", { id, code: 0, signal: "" });
    return { ok: true, id, cwd: cdTarget, history: readTerminalHistory() };
  }

  const child = cp.spawn(shellCommand.command, shellCommand.args, {
    cwd,
    shell: needsShell(shellCommand.command),
    windowsHide: true,
    env: processEnvForSettings(settings()),
  });
  terminalProcess = child;

  child.stdout.on("data", (data) => {
    mainWindow.webContents.send("terminal-output", { id, stream: "stdout", text: data.toString() });
  });
  child.stderr.on("data", (data) => {
    mainWindow.webContents.send("terminal-output", { id, stream: "stderr", text: data.toString() });
  });
  child.on("error", (error) => {
    terminalProcess = null;
    mainWindow.webContents.send("terminal-error", { id, message: error.message });
  });
  child.on("close", (code, signal) => {
    terminalProcess = null;
    mainWindow.webContents.send("terminal-finish", { id, code, signal: signal || "" });
  });
  return { ok: true, id, history: readTerminalHistory() };
}

function featureInstruction(feature) {
  if (feature === "code") return "Feature /code: write or modify code as needed. Prefer complete implementation over discussion.";
  if (feature === "plan") return "Feature /plan: produce a concrete implementation plan only. Do not edit files or execute code.";
  if (feature === "todolist") return "Feature /todolist: execute the work as a staged todo list. Complete one stage, verify it, then continue to the next stage. Stop and report if a stage fails.";
  if (feature === "discuss") return "Feature /discuss: discuss the project conversationally. Do not write code, do not propose a step-by-step execution plan, and do not edit files.";
  return "";
}

function resolveCommand(command) {
  const value = String(command || "").trim();
  if (!value) return null;
  if (value.includes("\\") || value.includes("/") || path.isAbsolute(value)) {
    return resolveWindowsExecutable(value);
  }
  const tool = process.platform === "win32" ? "where.exe" : "which";
  const result = cp.spawnSync(tool, [value], {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const found = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0] || null;
  return resolveWindowsExecutable(found);
}

function commandExists(command) {
  return Boolean(resolveCommand(command));
}

function hasGitRepository() {
  const git = resolveCommand("git");
  if (!git) return false;
  const result = cp.spawnSync(git, ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectRoot(),
    shell: needsShell(git),
    windowsHide: true,
    encoding: "utf8",
  });
  return result.status === 0 && String(result.stdout || "").trim() === "true";
}

function nowRunId(prefix = "") {
  const now = new Date();
  const iso = now.toISOString().replace(/[-:]/g, "").replace("T", "-");
  const stamp = iso.slice(0, 15);
  const millis = String(now.getMilliseconds()).padStart(3, "0");
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${stamp}-${millis}-${prefix ? `${prefix}-` : ""}${suffix}`;
}

const SNAPSHOT_IGNORED_DIRS = new Set([".git", ".hg", ".svn", "node_modules", ".venv", "venv", "__pycache__", "dist", "build"]);
const SNAPSHOT_IGNORED_PATHS = new Set([
  ".ai/runs",
  ".ai/desktop/settings.json",
  ".ai/desktop/secrets.json",
  ".ai/desktop/terminal-history.json",
  ".ai/budget/ledger.jsonl",
]);
const SNAPSHOT_IGNORED_EXTENSIONS = new Set([".log", ".tmp", ".bak"]);

function normalizeRel(file) {
  return file.split(path.sep).join("/");
}

function isSnapshotIgnored(rel) {
  const normalized = normalizeRel(rel).replace(/^\/+|\/+$/g, "");
  if (!normalized) return false;
  if (SNAPSHOT_IGNORED_PATHS.has(normalized)) return true;
  for (const ignored of SNAPSHOT_IGNORED_PATHS) {
    if (normalized.startsWith(`${ignored}/`)) return true;
  }
  if (SNAPSHOT_IGNORED_EXTENSIONS.has(path.extname(normalized).toLowerCase())) return true;
  return normalized.split("/").some((part) => SNAPSHOT_IGNORED_DIRS.has(part));
}

function fileHash(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function walkFiles(dir, base = dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = normalizeRel(path.relative(base, full));
    if (isSnapshotIgnored(rel)) continue;
    if (entry.isDirectory()) {
      walkFiles(full, base, result);
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}

function snapshot_files() {
  const root = projectRoot();
  const result = {};
  if (!fs.existsSync(root)) return result;
  for (const file of walkFiles(root)) {
    const rel = normalizeRel(path.relative(root, file));
    result[rel] = fileHash(file);
  }
  return result;
}

function backupBeforeFiles(runDir, beforeSnapshot) {
  const root = projectRoot();
  const backupDir = path.join(runDir, "before-files");
  for (const rel of Object.keys(beforeSnapshot || {})) {
    if (isSnapshotIgnored(rel)) continue;
    const source = path.join(root, rel);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
    const target = path.join(backupDir, rel);
    ensureDir(path.dirname(target));
    fs.copyFileSync(source, target);
  }
}

function changedFiles(beforeSnapshot, afterSnapshot = snapshot_files_safe()) {
  const names = new Set([...Object.keys(beforeSnapshot || {}), ...Object.keys(afterSnapshot || {})]);
  return Array.from(names).filter((name) => beforeSnapshot?.[name] !== afterSnapshot?.[name]).sort();
}

function resolveWindowsExecutable(file) {
  if (!file) return null;
  if (process.platform !== "win32") {
    return fs.existsSync(file) ? file : null;
  }
  const parsed = path.parse(file);
  if (parsed.ext) {
    return fs.existsSync(file) ? file : null;
  }
  const candidates = [".cmd", ".bat", ".exe", ""].map((ext) => `${file}${ext}`);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function needsShell(command) {
  return process.platform === "win32" && /\.(cmd|bat)$/i.test(String(command || ""));
}

function processEnvForSettings(merged) {
  const selectedModel = String(merged.selectedModel || "").trim();
  const env = { ...process.env };
  const auth = merged.auth || {};
  const apiKey = String(auth.openaiApiKey || "").trim();
  const provider = selectedModel ? providerForModel(merged, selectedModel) : "";
  const providerUrl = providerBaseUrl(merged, provider);
  if (providerUrl) {
    env.OPENAI_BASE_URL = providerUrl;
    env.OPENAI_API_KEY = apiKey || "lm-studio";
    env.LOCAL_MODEL_URL = providerUrl;
    env.AIDEV_MODEL_PROVIDER = provider;
    env.AIDEV_SELECTED_MODEL = selectedModel;
  } else
  if (apiKey) {
    env.OPENAI_API_KEY = apiKey;
  } else if (merged.useCodexLogin !== false) {
    delete env.OPENAI_API_KEY;
    delete env.OPENAI_BASE_URL;
  }
  if (auth.anthropicApiKey) env.ANTHROPIC_API_KEY = auth.anthropicApiKey;
  if (!providerUrl && apiKey && auth.openaiBaseUrl) env.OPENAI_BASE_URL = auth.openaiBaseUrl;
  if (!providerUrl && auth.localModelUrl) env.LOCAL_MODEL_URL = auth.localModelUrl;
  env.AIDEV_GLOBAL_RULES_DIR = ensureGlobalMemory();
  env.AIDEV_PROJECT_ROOT = projectRoot();
  return env;
}

function providerForModel(merged, model) {
  const catalog = Array.isArray(merged.modelCatalog) ? merged.modelCatalog : [];
  const item = catalog.find((entry) => String(entry?.model || "").trim() === model);
  return String(item?.provider || "").toLowerCase();
}

function providerBaseUrl(merged, provider) {
  const auth = merged.auth || {};
  if (provider === "lmstudio" || provider === "lm-studio") return String(auth.lmStudioUrl || "http://127.0.0.1:1234/v1").trim();
  if (provider === "local") return String(auth.localModelUrl || "").trim();
  return "";
}

function maybeNotifyFinished(payload) {
  const current = settings();
  if (!current.notifyOnFinish || !Notification.isSupported()) return;
  if (payload.phase === "validate") return;
  const ok = Number(payload.code) === 0 && !payload.stopped;
  const elapsed = payload.clientDurationSeconds ? ` in ${payload.clientDurationSeconds}s` : "";
  new Notification({
    title: ok ? "AI Dev finished" : "AI Dev stopped",
    body: `${payload.title || "Run"} finished${elapsed} with code ${payload.code}.`,
  }).show();
}

function estimateTokens(text) {
  const value = String(text || "");
  if (!value) return 0;
  return Math.max(1, Math.floor(value.length / 4));
}

function attachmentKind(file) {
  const ext = path.extname(file).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico"].includes(ext)) return "image";
  if ([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"].includes(ext)) return "document";
  if ([".zip", ".7z", ".rar", ".tar", ".gz"].includes(ext)) return "archive";
  return "file";
}

function attachmentMeta(file) {
  const stat = fs.statSync(file);
  return {
    path: file,
    name: path.basename(file),
    ext: path.extname(file).toLowerCase(),
    size: stat.size,
    kind: attachmentKind(file),
  };
}

function normalizeAttachments(items) {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const file = path.resolve(String(item?.path || item || ""));
    if (!file || seen.has(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    seen.add(file);
    result.push(attachmentMeta(file));
  }
  return result;
}

function isReadableTextAttachment(file) {
  const ext = path.extname(file).toLowerCase();
  return [
    ".txt", ".md", ".markdown", ".json", ".jsonl", ".js", ".jsx", ".ts", ".tsx", ".css", ".scss",
    ".html", ".xml", ".yml", ".yaml", ".py", ".ps1", ".cmd", ".bat", ".sh", ".rs", ".go", ".java",
    ".cs", ".cpp", ".c", ".h", ".hpp", ".sql", ".toml", ".ini", ".env", ".gitignore",
  ].includes(ext);
}

function buildAttachmentsContext(items) {
  const attachments = normalizeAttachments(items);
  if (!attachments.length) return { attachments, text: "" };
  const sections = ["Attachments provided by user:"];
  for (const item of attachments) {
    sections.push(`- ${item.name} (${item.kind}, ${item.size} bytes): ${item.path}`);
    if (item.kind === "image") {
      sections.push("  Image attachment: inspect the file path if visual details are needed.");
      continue;
    }
    if (isReadableTextAttachment(item.path)) {
      const content = readText(item.path);
      const clipped = content.length > 18000 ? `${content.slice(0, 18000)}\n\n[truncated]` : content;
      sections.push(`  Content preview:\n${clipped}`);
    } else {
      sections.push("  Binary/document attachment: use an appropriate local tool if content inspection is needed.");
    }
  }
  return { attachments, text: sections.join("\n\n") };
}

function globalMemoryText() {
  const dir = ensureGlobalMemory();
  return [
    readText(path.join(dir, "global.md")),
    readText(path.join(dir, "learned.md")),
  ].map((text) => text.trim()).filter(Boolean).join("\n\n");
}

function modelContextLimit(model) {
  const lower = String(model || "").toLowerCase();
  if (lower.includes("gpt-4.1")) return 1047576;
  if (lower.includes("gpt-5") || lower.includes("gpt-4o")) return 128000;
  return 128000;
}

function extractCliTokenUsage(stdout, stderr) {
  const text = `${stdout || ""}\n${stderr || ""}`;
  const usage = { source: "estimate" };
  const patterns = {
    input: /(?:input|prompt)\s+tokens?\D+([0-9][0-9,]*)/i,
    output: /(?:output|completion)\s+tokens?\D+([0-9][0-9,]*)/i,
    total: /total\s+tokens?\D+([0-9][0-9,]*)/i,
  };
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = text.match(pattern);
    if (match) {
      usage[key] = Number(match[1].replace(/,/g, ""));
      usage.source = "codex_cli";
    }
  }
  return usage;
}

function modelTokenPrices(model) {
  const table = {
    "gpt-5.4-mini": { input: 0.75, cached_input: 0.075, output: 4.5, source: "OpenAI model docs, checked 2026-04-26" },
    "gpt-5.5": { input: 2.5, cached_input: 0.25, output: 15, source: "temporary GPT-5.4-compatible estimate until verified pricing is configured" },
    "gpt-5.4": { input: 2.5, cached_input: 0.25, output: 15, source: "OpenAI model docs, checked 2026-04-26" },
    "gpt-5.4-nano": { input: 0.2, cached_input: 0.02, output: 1.25, source: "OpenAI model docs, checked 2026-04-26" },
  };
  const lower = String(model || "").toLowerCase();
  const key = Object.keys(table).sort((a, b) => b.length - a.length).find((item) => lower.includes(item));
  return key ? table[key] : null;
}

function tokenCost(model, input, output, source) {
  const price = modelTokenPrices(model);
  if (!price) return { estimated_usd: 0, actual_usd: null, source: "no_model_price", confidence: "unknown" };
  const longContext = String(model || "").toLowerCase().includes("gpt-5.4") && Number(input || 0) > 272000;
  const inputMultiplier = longContext ? 2 : 1;
  const outputMultiplier = longContext ? 1.5 : 1;
  const estimated = ((Number(input || 0) * price.input * inputMultiplier) + (Number(output || 0) * price.output * outputMultiplier)) / 1_000_000;
  return {
    estimated_usd: Number(estimated.toFixed(6)),
    actual_usd: source === "codex_cli" ? Number(estimated.toFixed(6)) : null,
    source: source === "codex_cli" ? "codex_cli_tokens_x_configured_price" : "token_price_estimate",
    confidence: source === "codex_cli" ? "high" : "medium",
    rates_per_1m: price,
    pricing_source: price.source,
    long_context_multiplier: { input: inputMultiplier, output: outputMultiplier },
  };
}

function buildUsageReport({ model, reasoning, prompt, stdout, stderr, lastMessage, startedAt, routeDecision }) {
  const parsed = extractCliTokenUsage(stdout, stderr);
  const input = parsed.input || estimateTokens(prompt);
  const output = parsed.output || estimateTokens(`${stdout || ""}\n${stderr || ""}\n${lastMessage || ""}`);
  const total = parsed.total || input + output;
  const limit = modelContextLimit(model);
  const duration = Math.max(0, (Date.now() - Number(startedAt || Date.now())) / 1000);
  return {
    model,
    reasoning,
    route: routeDecision || {},
    phase_seconds: { direct_exec: Number(duration.toFixed(3)), total: Number(duration.toFixed(3)) },
    duration_seconds: Number(duration.toFixed(3)),
    tokens: { input, output, total, source: parsed.source || "estimate" },
    context: {
      limit_tokens: limit,
      used_tokens: input,
      used_percent: Number(((100 * input) / limit).toFixed(2)),
    },
    cost: tokenCost(model, input, output, parsed.source),
    io: {
      prompt_chars: String(prompt || "").length,
      stdout_chars: String(stdout || "").length,
      stderr_chars: String(stderr || "").length,
      last_message_chars: String(lastMessage || "").length,
    },
  };
}

function allowedModelSet(merged) {
  const catalog = Array.isArray(merged.modelCatalog) && merged.modelCatalog.length ? merged.modelCatalog : DEFAULT_SETTINGS.modelCatalog;
  const builtins = new Set([
    "gpt-5.4-mini",
    "gpt-5.4",
    "gpt-5.5",
  ]);
  for (const item of catalog) {
    if (!item || item.enabled === false) continue;
    const model = String(item.model || "").trim();
    if (model) builtins.add(model);
  }
  return builtins;
}

function normalizeModelName(model) {
  const value = String(model || "").trim();
  return value === "gpt-5.4-pro" ? "gpt-5.5" : value;
}

function ensureModelAvailable(merged, model, label) {
  const value = normalizeModelName(model);
  if (!value) {
    throw new Error(`${label} model is empty.`);
  }
  if (!allowedModelSet(merged).has(value)) {
    throw new Error(`${label} model "${value}" is not available. Add it in Auth or choose another model.`);
  }
  return value;
}

function diagnosticsForSettings(merged) {
  const current = merged || settings();
  const pythonPath = resolveCommand(current.pythonPath || "python");
  const codexPath = resolveCommand(current.codexCommand || "codex");
  const directModel = String(current.directModel || current.model || "gpt-5.4-mini");
  const supervisorModel = String(current.supervisorManualModel || current.supervisorModel || "gpt-5.4-mini");
  return {
    projectRoot: projectRoot(),
    python: { command: current.pythonPath || "python", resolved: pythonPath || "", available: Boolean(pythonPath) },
    codex: { command: current.codexCommand || "codex", resolved: codexPath || "", available: Boolean(codexPath) },
    supervisor: {
      mode: current.supervisorModelMode || "auto",
      model: supervisorModel,
      available: allowedModelSet(current).has(supervisorModel),
    },
    direct: {
      model: directModel,
      available: allowedModelSet(current).has(directModel),
    },
    auth: {
      hasOpenAIKey: Boolean(current.auth?.openaiApiKey),
      usesCodexLogin: current.useCodexLogin !== false && !current.auth?.openaiApiKey,
      inheritedOpenAIKeyIgnored: Boolean(process.env.OPENAI_API_KEY) && current.useCodexLogin !== false && !current.auth?.openaiApiKey,
      hasAnthropicKey: Boolean(current.auth?.anthropicApiKey),
      openaiBaseUrl: current.auth?.openaiBaseUrl || "",
      localModelUrl: current.auth?.localModelUrl || "",
      lmStudioUrl: current.auth?.lmStudioUrl || "http://127.0.0.1:1234/v1",
    },
    catalogCount: Array.isArray(current.modelCatalog) ? current.modelCatalog.length : 0,
    lmStudio: {
      url: current.auth?.lmStudioUrl || "http://127.0.0.1:1234/v1",
      catalogModels: (current.modelCatalog || []).filter((item) => String(item?.provider || "").toLowerCase() === "lmstudio").length,
    },
  };
}

function runSortKeys(dir, contract) {
  const created = Date.parse(contract?.created_at || "");
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(dir).mtimeMs;
  } catch {}
  if (Number.isFinite(created)) return created;
  return mtimeMs;
}

function runMtime(dir) {
  try {
    return fs.statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
}

function listRuns() {
  const runsDir = projectRunsDir();
  if (!fs.existsSync(runsDir)) return [];
  return fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const runId = entry.name;
      const dir = path.join(runsDir, runId);
      const audit = readJson(path.join(dir, "audit.json"), {});
      const contract = readJson(path.join(dir, "contract.json"), {});
      const usage = readJson(path.join(dir, "usage.json"), {});
      return {
        id: runId,
        path: dir,
        status: audit.status || "unknown",
        taskType: contract.classification?.task_type || "unknown",
        reasoning: contract.classification?.reasoning || "unknown",
        model: contract.model || "",
        usage,
        request: readText(path.join(dir, "request.md")).trim(),
        sortKey: runSortKeys(dir, contract),
        mtimeMs: runMtime(dir),
      };
    })
    .sort((a, b) => b.sortKey - a.sortKey || b.mtimeMs - a.mtimeMs || b.id.localeCompare(a.id))
    .map(({ sortKey, mtimeMs, ...rest }) => rest);
}

function readRun(runId) {
  const dir = path.join(projectRunsDir(), runId);
  if (!fs.existsSync(dir)) return null;
  return {
    id: runId,
    path: dir,
    request: readText(path.join(dir, "request.md")),
    contract: readJson(path.join(dir, "contract.json"), {}),
    audit: readJson(path.join(dir, "audit.json"), {}),
    usage: readJson(path.join(dir, "usage.json"), {}),
    attachments: readJson(path.join(dir, "attachments.json"), []),
    prompt: readText(path.join(dir, "prompt.md")),
    stdout: readText(path.join(dir, "codex-stdout.txt")),
    stderr: readText(path.join(dir, "codex-stderr.txt")),
    lastMessage: readText(path.join(dir, "codex-last-message.md")),
    diff: readText(path.join(dir, "after-diff.patch")),
    validation: readJson(path.join(dir, "validation.json"), {}),
  };
}

function npmArgv(...scriptArgs) {
  const npm = resolveCommand("npm") || "npm";
  return [npm, ...scriptArgs];
}

function pythonArgv(...args) {
  const py = resolveCommand("python") || resolveCommand("python3") || "python";
  return [py, ...args];
}

function validationCommandForRun(run) {
  const config = projectConfig();
  const commands = packageCommands(projectRoot());
  const changed = Array.isArray(run?.audit?.changed_files) ? run.audit.changed_files : [];
  const named = commands.map((item) => item.name);
  const cfg = config.validation || {};
  if (Array.isArray(cfg.argv) && cfg.argv.length) {
    const argv = cfg.argv.map((value) => String(value));
    return { argv, display: argv.map(formatArg).join(" "), shellString: null };
  }
  if (typeof cfg.command === "string" && cfg.command.trim()) {
    return { argv: null, display: cfg.command, shellString: cfg.command };
  }
  if (changed.some((file) => /\.(js|jsx|ts|tsx|css|html)$/i.test(file))) {
    if (named.includes("check")) {
      const argv = npmArgv("run", "check");
      return { argv, display: "npm run check", shellString: null };
    }
    if (named.includes("test")) {
      const argv = npmArgv("test");
      return { argv, display: "npm test", shellString: null };
    }
    if (named.includes("lint")) {
      const argv = npmArgv("run", "lint");
      return { argv, display: "npm run lint", shellString: null };
    }
  }
  if (changed.some((file) => /\.py$/i.test(file))) {
    const pyFiles = changed.filter((file) => /\.py$/i.test(file));
    const argv = pythonArgv("-m", "py_compile", ...pyFiles);
    const display = ["python", "-m", "py_compile", ...pyFiles].map(formatArg).join(" ");
    return { argv, display, shellString: null };
  }
  if (named.includes("test")) {
    const argv = npmArgv("test");
    return { argv, display: "npm test", shellString: null };
  }
  if (named.includes("check")) {
    const argv = npmArgv("run", "check");
    return { argv, display: "npm run check", shellString: null };
  }
  return null;
}

function runValidation(runId) {
  const run = readRun(runId);
  if (!run) throw new Error("Run not found.");
  const detected = validationCommandForRun(run);
  if (!detected) throw new Error("No validation command detected for this project.");
  const logFile = path.join(run.path, "validation-log.txt");
  const validationFile = path.join(run.path, "validation.json");
  let spawnCommand;
  let spawnArgs;
  if (detected.argv) {
    spawnCommand = detected.argv[0];
    spawnArgs = detected.argv.slice(1);
  } else {
    spawnCommand = process.platform === "win32" ? "powershell.exe" : "sh";
    spawnArgs = process.platform === "win32"
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", detected.shellString]
      : ["-lc", detected.shellString];
  }
  spawnProcess(spawnCommand, spawnArgs, {
    id: `validate-${runId}`,
    title: "Validate Run",
    phase: "validate",
    logPath: logFile,
    onClose: ({ code, signal, stdout, stderr, startedAt }) => {
      writeJson(validationFile, {
        command: detected.display,
        status: code === 0 ? "passed" : "failed",
        code,
        signal,
        duration_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
        stdout_tail: String(stdout || "").slice(-4000),
        stderr_tail: String(stderr || "").slice(-4000),
        created_at: new Date().toISOString(),
      });
    },
  });
  return { ok: true, command: detected.display };
}

function restoreRun(runId) {
  const runDir = path.join(projectRunsDir(), String(runId));
  return restoreRunFromDir(runDir, projectRoot(), {
    resolveGit: () => resolveCommand("git"),
    hasGitRepository: () => hasGitRepository(),
  });
}

function snapshot_files_safe() {
  try {
    return snapshot_files();
  } catch {
    return {};
  }
}

function spawnProcess(command, args, options = {}) {
  if (activeProcess) {
    throw new Error("A run is already active.");
  }

  const child = cp.spawn(command, args, {
    cwd: options.cwd || projectRoot(),
    shell: needsShell(command),
    windowsHide: true,
    ...options.spawnOptions,
  });
  activeProcess = child;

  const id = options.id || String(Date.now());
  let stdout = "";
  let stderr = "";
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    mainWindow.webContents.send("process-heartbeat", {
      id,
      elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
      clientElapsedSeconds: Math.floor((Date.now() - Number(options.clientStartedAt || startedAt)) / 1000),
    });
  }, 15000);

  mainWindow.webContents.send("process-start", {
    id,
    title: options.title || command,
    command: [command, ...args].map(formatArg).join(" "),
    phase: options.phase || "run",
    run: options.run || null,
    clientStartedAt: options.clientStartedAt || startedAt,
  });

  if (options.input) {
    child.stdin.write(options.input);
    child.stdin.end();
  }

  child.stdout.on("data", (data) => {
    const text = data.toString();
    stdout += text;
    mainWindow.webContents.send("process-output", { id, stream: "stdout", text });
  });

  child.stderr.on("data", (data) => {
    const text = data.toString();
    stderr += text;
    mainWindow.webContents.send("process-output", { id, stream: "stderr", text });
  });

  child.on("error", (error) => {
    clearInterval(heartbeat);
    activeProcess = null;
    mainWindow.webContents.send("process-error", { id, message: error.message });
  });

  child.on("close", (code, signal) => {
    clearInterval(heartbeat);
    activeProcess = null;
    let lastMessage = "";
    if (options.lastMessagePath && fs.existsSync(options.lastMessagePath)) {
      lastMessage = readText(options.lastMessagePath);
    }
    if (options.logPath) {
      fs.writeFileSync(
        options.logPath,
        [
          `Command: ${[command, ...args].map(formatArg).join(" ")}`,
          `Exit code: ${code}`,
          signal ? `Signal: ${signal}` : "",
          "",
          "STDOUT:",
          stdout,
          "",
          "STDERR:",
          stderr,
          "",
          "LAST MESSAGE:",
          lastMessage,
        ].filter((line) => line !== "").join("\n"),
        "utf8",
      );
    }
    if (typeof options.onClose === "function") {
      try {
        options.onClose({ code, signal, stdout, stderr, lastMessage, startedAt });
      } catch (error) {
        console.error(error);
      }
    }
    mainWindow.webContents.send("process-finish", {
      id,
      title: options.title || command,
      code,
      signal,
      stopped: Boolean(child.aidevStopped),
      stdout,
      stderr,
      lastMessage,
      logPath: options.logPath || "",
      runs: listRuns(),
      phase: options.phase || "run",
      clientStartedAt: options.clientStartedAt || startedAt,
      clientDurationSeconds: Number(((Date.now() - Number(options.clientStartedAt || startedAt)) / 1000).toFixed(3)),
    });
    maybeNotifyFinished({
      id,
      title: options.title || command,
      code,
      stopped: Boolean(child.aidevStopped),
      phase: options.phase || "run",
      clientDurationSeconds: Number(((Date.now() - Number(options.clientStartedAt || startedAt)) / 1000).toFixed(3)),
    });
  });
}

function supervisorArgs(prompt, execute, userSettings, runOptions = {}) {
  const merged = { ...settings(), ...(userSettings || {}) };
  const args = [aidevScript(), "run", prompt];
  if (execute) args.push("--execute");
  if (!merged.budgetGuard) args.push("--no-budget-guard", "--force-budget");
  if (runOptions.forceBudget) args.push("--force-budget");
  if (!merged.scopeGuard) args.push("--no-scope-guard");
  if (!merged.askHigh || runOptions.approveHigh) args.push("--yes-high");
  if (runOptions.forceReasoning) {
    args.push("--reasoning", runOptions.forceReasoning);
  }
  if (runOptions.forceModel) {
    args.push("--model", runOptions.forceModel);
  }
  if (!runOptions.forceModel && (merged.supervisorModelMode || "auto") === "manual" && (merged.supervisorManualModel || merged.supervisorModel)) {
    args.push("--model", merged.supervisorManualModel || merged.supervisorModel);
  }
  args.push("--ui-settings", JSON.stringify({
    scope_guard: Boolean(merged.scopeGuard),
    budget_guard: Boolean(merged.budgetGuard),
    ask_high: Boolean(merged.askHigh),
    prompt_improve: Boolean(merged.promptImprove),
    project_summaries: Boolean(merged.projectSummaries),
    auto_fix: Boolean(merged.autoFix),
    visual_qa: Boolean(merged.visualQa),
    local_first: Boolean(merged.localFirst),
    request_feature: merged.requestFeature || "auto",
    supervisor_model_mode: merged.supervisorModelMode || "auto",
    supervisor_reasoning: merged.supervisorReasoning || "low",
    supervisor_manual_model: merged.supervisorManualModel || merged.supervisorModel || "gpt-5.4-mini",
    supervisor_model: merged.supervisorModel || "gpt-5.4-mini",
    model_catalog: merged.modelCatalog || [],
  }));
  return args;
}

ipcMain.handle("app:getState", () => {
  ensureWorkspace();
  ensureGlobalMemory();
  const current = touchProject(projectRoot());
  return {
    appRoot: APP_ROOT,
    root: projectRoot(),
    settings: current,
    runs: listRuns(),
    budget: readJson(path.join(projectAiDir(), "budget", "budget.json"), {}),
    config: readJson(path.join(projectAiDir(), "config", "project.json"), {}),
    projectIndex: readProjectIndex(),
    discovered: readJson(path.join(projectAiDir(), "config", "discovered.json"), {}),
    memory: {
      dir: globalMemoryDir(),
      global: readText(path.join(globalMemoryDir(), "global.md")),
      learned: readText(path.join(globalMemoryDir(), "learned.md")),
    },
  };
});

ipcMain.handle("settings:save", (_event, value) => {
  const previous = readJson(SETTINGS_FILE, {});
  const secrets = persistAuthSecrets(value || {});
  const merged = { ...settings(), ...(value || {}) };
  merged.auth = { ...DEFAULT_SETTINGS.auth, ...(merged.auth || {}), ...secrets };
  merged.layout = { ...DEFAULT_SETTINGS.layout, ...(merged.layout || {}) };
  merged.projectRegistry = Array.isArray(merged.projectRegistry) ? merged.projectRegistry : [];
  merged.chatSessions = merged.chatSessions && typeof merged.chatSessions === "object" ? merged.chatSessions : {};
  if (!nonEmptyChatSessions(value) && nonEmptyChatSessions(previous)) {
    merged.chatSessions = previous.chatSessions;
  }
  backupFileOncePerMinute(SETTINGS_FILE, "autosave-backup");
  writeJson(SETTINGS_FILE, sanitizedSettings(merged));
  return merged;
});

ipcMain.handle("config:save", (_event, value) => {
  ensureWorkspace();
  const file = path.join(projectAiDir(), "config", "project.json");
  writeJson(file, value || {});
  return readJson(file, {});
});

ipcMain.handle("run:supervisor", (_event, payload) => {
  const current = settings();
  const merged = { ...current, ...(payload.settings || {}) };
  const prompt = String(payload.prompt || "").trim();
  if (!prompt) throw new Error("Prompt is empty.");
  const feature = String(payload.feature || "auto");
  const attachmentContext = buildAttachmentsContext(payload.attachments);
  const smartContext = buildSmartContext(prompt);
  const promptWithAttachments = [featureInstruction(feature), prompt, smartContext.text ? `Smart project context:\n${smartContext.text}` : "", attachmentContext.text].filter(Boolean).join("\n\n");
  const pythonCommand = resolveCommand(current.pythonPath);
  if (!pythonCommand) {
    throw new Error(`Python command "${current.pythonPath}" was not found in PATH.`);
  }
  if ((merged.supervisorModelMode || "auto") === "manual") {
    ensureModelAvailable(merged, merged.supervisorManualModel || merged.supervisorModel, "Supervisor");
  }
  const expectedContract = payload.expectedRun?.contract || {};
  const expectedClassification = expectedContract.classification || {};
  const runOptions = { ...(payload.options || {}) };
  if (expectedClassification.reasoning) runOptions.forceReasoning = expectedClassification.reasoning;
  if (expectedContract.model) runOptions.forceModel = expectedContract.model;
  spawnProcess(pythonCommand, supervisorArgs(promptWithAttachments, Boolean(payload.execute), { ...(payload.settings || {}), requestFeature: feature }, runOptions), {
    id: `supervisor-${Date.now()}`,
    title: payload.execute ? "Supervisor Run" : "Supervisor Plan",
    phase: payload.execute ? "run" : "plan",
    run: payload.expectedRun || null,
    clientStartedAt: payload.clientStartedAt,
    spawnOptions: { env: processEnvForSettings({ ...merged, selectedModel: runOptions.forceModel || merged.supervisorManualModel || merged.supervisorModel }) },
  });
  return true;
});

ipcMain.handle("run:supervisor-analyze", async (_event, payload) => {
  const current = settings();
  const merged = { ...current, ...(payload.settings || {}) };
  const prompt = String(payload.prompt || "").trim();
  if (!prompt) throw new Error("Prompt is empty.");
  const feature = String(payload.feature || "auto");
  const attachmentContext = buildAttachmentsContext(payload.attachments);
  const smartContext = buildSmartContext(prompt);
  const promptWithAttachments = [featureInstruction(feature), prompt, smartContext.text ? `Smart project context:\n${smartContext.text}` : "", attachmentContext.text].filter(Boolean).join("\n\n");
  const pythonCommand = resolveCommand(current.pythonPath);
  if (!pythonCommand) {
    throw new Error(`Python command "${current.pythonPath}" was not found in PATH.`);
  }

  const result = await spawnAsync(
    pythonCommand,
    supervisorArgs(promptWithAttachments, false, { ...(payload.settings || {}), requestFeature: feature }, payload.options),
    {
      cwd: projectRoot(),
      shell: needsShell(pythonCommand),
      encoding: "utf8",
      env: processEnvForSettings({ ...merged, selectedModel: merged.supervisorManualModel || merged.supervisorModel }),
      timeout: 120000,
    },
  );
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `Supervisor analyze failed with code ${result.status}`).trim());
  }

  const match = String(result.stdout || "").match(/^Run:\s*(.+)$/m);
  const runId = match ? match[1].trim() : listRuns()[0]?.id;
  const run = runId ? readRun(runId) : null;
  if (!run) {
    throw new Error("Supervisor analyze finished but no run folder was created.");
  }
  return {
    ok: true,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    run,
  };
});

ipcMain.handle("run:direct", (_event, payload) => {
  const current = settings();
  const merged = { ...current, ...(payload.settings || {}) };
  const project = projectConfig();
  const prompt = String(payload.prompt || "").trim();
  if (!prompt) throw new Error("Prompt is empty.");
  const feature = String(payload.feature || "auto");
  const detached = Boolean(payload.detached);
  const detachedSupervisor = detached && Boolean(payload.supervisorMode);
  const history = Array.isArray(payload.history) ? payload.history : [];
  const attachmentContext = buildAttachmentsContext(payload.attachments);
  const smartContext = detached ? { text: "", relevant: [] } : buildSmartContext(prompt);
  const codexCommand = resolveCommand(current.codexCommand);
  if (!codexCommand) {
    throw new Error(`Codex command "${current.codexCommand}" was not found in PATH.`);
  }
  const directRunId = nowRunId("direct");
  const runDir = detached ? path.join(APP_AI_DIR, "runs", directRunId) : path.join(projectRunsDir(), directRunId);
  ensureDir(runDir);
  const outputFile = path.join(runDir, "codex-last-message.md");
  const logFile = path.join(runDir, "codex-log.txt");
  const directReasoning = detachedSupervisor
    ? (merged.supervisorReasoning || "low")
    : (merged.directReasoning || "medium");
  const directModel = ensureModelAvailable(
    merged,
    detachedSupervisor
      ? (merged.supervisorManualModel || merged.supervisorModel || merged.model)
      : (merged.directModel || merged.model),
    detachedSupervisor ? "Supervisor" : "Direct",
  );
  const promptPrefix = [
    directReasoning === "none" ? "" : `Reasoning preference: ${directReasoning}.`,
    featureInstruction(feature),
    detachedSupervisor ? "Supervisor mode is enabled: give a more structured, careful answer, surface assumptions, and keep the discussion bounded." : "",
    "Be concise and stay within the user's request.",
    "Use the conversation context below to understand follow-up messages.",
    detached
      ? "This is a standalone chat, not a project task. Do not create, edit, delete, or inspect local project files unless the user explicitly asks to attach or discuss a provided file."
      : "If the user asks you to code or create something, create or modify files in the project unless they explicitly ask only for explanation.",
    "If the user asks for a run command, server command, usage command, or next command, include the exact command in your final answer.",
  ].filter(Boolean).join("\n");
  const historyText = history.slice(-8).map((item) => {
    const role = String(item?.role || "user").toUpperCase();
    const content = String(item?.content || "").trim();
    return content ? `${role}:\n${content}` : "";
  }).filter(Boolean).join("\n\n");
  const fullPrompt = [
    promptPrefix,
    globalMemoryText() ? `Global user memory:\n${globalMemoryText()}` : "",
    smartContext.text ? `Smart project context:\n${smartContext.text}` : "",
    historyText ? `Conversation context:\n${historyText}` : "",
    attachmentContext.text ? `Attachment context:\n${attachmentContext.text}` : "",
    `Current user message:\n${prompt}`,
  ].filter(Boolean).join("\n\n");
  fs.writeFileSync(path.join(runDir, "request.md"), `${prompt}\n`, "utf8");
  fs.writeFileSync(path.join(runDir, "prompt.md"), `${fullPrompt}\n`, "utf8");
  writeJson(path.join(runDir, "attachments.json"), attachmentContext.attachments);
  writeJson(path.join(runDir, "smart-context.json"), { relevant: smartContext.relevant, generated_at: new Date().toISOString() });
  writeJson(path.join(runDir, "contract.json"), {
    user_request: prompt,
    mode: "direct",
    detached,
    classification: { task_type: "direct", reasoning: directReasoning },
    model: directModel,
    route: payload.routeDecision || { route: "manual_direct" },
    created_at: new Date().toISOString(),
  });
  const beforeSnapshot = detached ? {} : snapshot_files_safe();
  writeJson(path.join(runDir, "before-state.json"), { git: { has_git: detached ? false : hasGitRepository() }, files: beforeSnapshot });
  if (!detached) backupBeforeFiles(runDir, beforeSnapshot);
  const args = [
    "exec",
    "-",
    "--cd",
    detached ? APP_ROOT : projectRoot(),
    "-m",
    directModel,
    "-s",
    detached ? "read-only" : (project.backend?.sandbox || "workspace-write"),
    ...(project.backend?.skip_git_repo_check === false ? [] : ["--skip-git-repo-check"]),
    "--output-last-message",
    outputFile,
  ];
  spawnProcess(codexCommand, args, {
    id: `direct-${directRunId}`,
    title: "Direct Codex",
    phase: "direct",
    cwd: detached ? APP_ROOT : projectRoot(),
    input: fullPrompt,
    lastMessagePath: outputFile,
    logPath: logFile,
    clientStartedAt: payload.clientStartedAt,
    spawnOptions: { env: processEnvForSettings({ ...merged, selectedModel: directModel }) },
    onClose: ({ code, stdout, stderr, lastMessage, startedAt }) => {
      fs.writeFileSync(path.join(runDir, "codex-stdout.txt"), stdout || "", "utf8");
      fs.writeFileSync(path.join(runDir, "codex-stderr.txt"), stderr || "", "utf8");
      const afterSnapshot = detached ? {} : snapshot_files_safe();
      writeJson(path.join(runDir, "after-state.json"), { git: { has_git: detached ? false : hasGitRepository() }, files: afterSnapshot });
      const files = changedFiles(beforeSnapshot, afterSnapshot);
      writeJson(path.join(runDir, "audit.json"), {
        status: code === 0 ? "pass" : "needs_review",
        changed_files: files,
        scope_warnings: [],
        codex_ok: code === 0,
        codex_returncode: code,
        created_at: new Date().toISOString(),
      });
      writeJson(path.join(runDir, "usage.json"), buildUsageReport({
        model: directModel,
        reasoning: directReasoning,
        prompt: fullPrompt,
        stdout,
        stderr,
        lastMessage,
        startedAt,
        routeDecision: payload.routeDecision || { route: "manual_direct" },
      }));
    },
  });
  return true;
});

ipcMain.handle("run:stop", () => {
  if (activeProcess) {
    activeProcess.aidevStopped = true;
    activeProcess.kill();
    activeProcess = null;
  }
  return true;
});

function formatArg(value) {
  const text = String(value);
  return /\s|[{}":,]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

ipcMain.handle("run:read", (_event, runId) => readRun(String(runId)));

ipcMain.handle("run:undo", (_event, runId) => restoreRun(String(runId)));

ipcMain.handle("run:validate", (_event, runId) => runValidation(String(runId)));

ipcMain.handle("runs:list", () => listRuns());

ipcMain.handle("project:index", () => buildProjectIndex());

ipcMain.handle("path:open", (_event, target) => {
  if (typeof target !== "string") return false;
  if (!fs.existsSync(target)) return false;
  shell.openPath(target);
  return true;
});

ipcMain.handle("attachments:pick", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Add files",
    defaultPath: projectRoot(),
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "All supported", extensions: ["png", "jpg", "jpeg", "webp", "gif", "txt", "md", "json", "js", "ts", "tsx", "jsx", "css", "html", "py", "pdf"] },
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico"] },
      { name: "Text and code", extensions: ["txt", "md", "json", "js", "ts", "tsx", "jsx", "css", "html", "py", "yml", "yaml", "xml", "sql"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return [];
  return normalizeAttachments(result.filePaths);
});

ipcMain.handle("terminal:history", () => readTerminalHistory());

ipcMain.handle("terminal:run", (_event, payload) => runTerminalCommand(payload));

ipcMain.handle("terminal:stop", () => {
  if (!terminalProcess) return false;
  terminalProcess.kill();
  terminalProcess = null;
  return true;
});

ipcMain.handle("terminal:pickCwd", async (_event, currentPath) => {
  const start = String(currentPath || "").trim();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose terminal folder",
    defaultPath: start && fs.existsSync(start) ? start : projectRoot(),
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  return { canceled: false, path: result.filePaths[0] };
});

ipcMain.handle("workspace:init", () => {
  const current = settings();
  ensureWorkspace();
  spawnProcess(current.pythonPath, [aidevScript(), "init"], {
    id: `init-${Date.now()}`,
    title: "Init Workspace",
    spawnOptions: { env: processEnvForSettings(current) },
  });
  return true;
});

ipcMain.handle("workspace:openProject", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open Project",
    defaultPath: projectRoot(),
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const next = touchProject(result.filePaths[0]);
  ensureWorkspace(next.projectRoot);
  spawnProcess(next.pythonPath, [aidevScript(), "init"], {
    id: `open-project-${Date.now()}`,
    title: "Auto Init Workspace",
    cwd: next.projectRoot,
    spawnOptions: { env: processEnvForSettings(next) },
  });
  return {
    canceled: false,
    settings: next,
    state: {
      appRoot: APP_ROOT,
      root: projectRoot(),
      settings: next,
      runs: listRuns(),
      budget: readJson(path.join(projectAiDir(), "budget", "budget.json"), {}),
      config: readJson(path.join(projectAiDir(), "config", "project.json"), {}),
      discovered: readJson(path.join(projectAiDir(), "config", "discovered.json"), {}),
    },
  };
});

ipcMain.handle("workspace:newProject", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Create Or Select Project Folder",
    defaultPath: settings().defaultProjectsDir || path.dirname(projectRoot()),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const selected = result.filePaths[0];
  ensureDir(selected);
  const next = touchProject(selected);
  ensureWorkspace(selected);
  spawnProcess(next.pythonPath, [aidevScript(), "init"], {
    id: `new-project-${Date.now()}`,
    title: "Auto Init New Project",
    cwd: selected,
    spawnOptions: { env: processEnvForSettings(next) },
  });
  return { canceled: false, settings: next, root: selected };
});

ipcMain.handle("workspace:createScratchProject", async () => {
  const current = settings();
  ensureDir(current.defaultProjectsDir);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Start From Scratch",
    defaultPath: path.join(current.defaultProjectsDir, "New AI Dev Project"),
    buttonLabel: "Create Project",
    properties: ["createDirectory"],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const selected = result.filePath;
  ensureDir(selected);
  const next = touchProject(selected);
  ensureWorkspace(selected);
  spawnProcess(next.pythonPath, [aidevScript(), "init"], {
    id: `scratch-project-${Date.now()}`,
    title: "Create Project",
    cwd: selected,
    spawnOptions: { env: processEnvForSettings(next) },
  });
  return { canceled: false, settings: next, root: selected };
});

ipcMain.handle("workspace:switchProject", (_event, root) => {
  const selected = path.resolve(String(root || ""));
  if (!fs.existsSync(selected) || !fs.statSync(selected).isDirectory()) {
    throw new Error("Project folder does not exist.");
  }
  const next = touchProject(selected);
  ensureWorkspace(selected);
  return {
    root: selected,
    settings: next,
    runs: listRuns(),
    budget: readJson(path.join(projectAiDir(), "budget", "budget.json"), {}),
    config: readJson(path.join(projectAiDir(), "config", "project.json"), {}),
    discovered: readJson(path.join(projectAiDir(), "config", "discovered.json"), {}),
  };
});

ipcMain.handle("workspace:removeProject", (_event, root) => {
  const selected = path.resolve(String(root || ""));
  const current = settings();
  current.projectRegistry = (current.projectRegistry || []).filter((item) => path.resolve(item.root) !== selected);
  delete current.chatSessions[selected];
  if (path.resolve(current.projectRoot || "") === selected) {
    current.projectRoot = current.projectRegistry[0]?.root || APP_ROOT;
  }
  writeJson(SETTINGS_FILE, current);
  return current;
});

ipcMain.handle("workspace:refreshProjectSummary", async (_event, root) => refreshProjectSummary(root));

ipcMain.handle("budget:save", (_event, value) => {
  const file = path.join(projectAiDir(), "budget", "budget.json");
  writeJson(file, value || {});
  return readJson(file, {});
});

ipcMain.handle("app:diagnostics", () => diagnosticsForSettings(settings()));

ipcMain.handle("models:lmstudio", async (_event, rawUrl) => {
  const current = settings();
  const base = String(rawUrl || current.auth?.lmStudioUrl || "http://127.0.0.1:1234/v1").replace(/\/+$/, "");
  const response = await fetch(`${base}/models`, {
    headers: { Authorization: "Bearer lm-studio" },
  });
  if (!response.ok) {
    throw new Error(`LM Studio returned ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  const models = Array.isArray(payload.data) ? payload.data : [];
  return models
    .map((item) => String(item?.id || item?.model || "").trim())
    .filter(Boolean);
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
