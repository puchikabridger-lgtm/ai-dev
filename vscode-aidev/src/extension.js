const vscode = require("vscode");
const cp = require("child_process");
const path = require("path");
const fs = require("fs");

function activate(context) {
  const provider = new AidevViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("aidev.chatView", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aidev.openPanel", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.aidev");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aidev.init", async () => {
      provider.runAidev(["init"], { reveal: true });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("aidev.latest", async () => {
      provider.runAidev(["latest"], { reveal: true });
    })
  );
}

class AidevViewProvider {
  constructor(context) {
    this.context = context;
    this.view = null;
    this.output = vscode.window.createOutputChannel("AI Dev");
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.html(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message.type === "init") {
        this.runAidev(["init"], { reveal: true });
      }
      if (message.type === "latest") {
        this.runAidev(["latest"], { reveal: true });
      }
      if (message.type === "plan") {
        this.runPrompt(message.prompt, false);
      }
      if (message.type === "execute") {
        this.runPrompt(message.prompt, true);
      }
      if (message.type === "openRuns") {
        this.openPath(path.join(this.workspaceRoot(), ".ai", "runs"));
      }
    });
  }

  workspaceRoot() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? folder.uri.fsPath : process.cwd();
  }

  aidevPath() {
    return path.join(this.workspaceRoot(), "aidev.py");
  }

  pythonPath() {
    return vscode.workspace.getConfiguration("aidev").get("pythonPath") || "python";
  }

  runPrompt(prompt, execute) {
    const value = (prompt || "").trim();
    if (!value) {
      this.post({ type: "error", text: "Write a prompt first." });
      return;
    }
    const args = ["run", value];
    if (execute) args.push("--execute");
    this.runAidev(args, { reveal: true });
  }

  runAidev(args, options = {}) {
    const script = this.aidevPath();
    if (!fs.existsSync(script)) {
      this.post({ type: "error", text: `aidev.py was not found at ${script}` });
      return;
    }

    const child = cp.spawn(this.pythonPath(), [script, ...args], {
      cwd: this.workspaceRoot(),
      shell: false,
      windowsHide: true,
    });

    const command = `${this.pythonPath()} ${[script, ...args].map(quote).join(" ")}`;
    this.output.appendLine(`> ${command}`);
    this.post({ type: "status", text: `Running: ${args.join(" ")}` });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      this.output.append(text);
      this.post({ type: "stream", stream: "stdout", text });
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      this.output.append(text);
      this.post({ type: "stream", stream: "stderr", text });
    });

    child.on("error", (error) => {
      this.post({ type: "error", text: error.message });
    });

    child.on("close", (code) => {
      const text = stdout || stderr || `Exited with code ${code}`;
      this.post({ type: "done", code, text });
      if (options.reveal) this.output.show(true);
    });
  }

  async openPath(target) {
    if (!fs.existsSync(target)) {
      this.post({ type: "error", text: `${target} does not exist yet.` });
      return;
    }
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(target));
  }

  post(message) {
    this.view?.webview.postMessage(message);
  }

  html(webview) {
    const nonce = String(Date.now());
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <title>AI Dev</title>
  <style>
    :root {
      --bg: #0f1117;
      --panel: #171a22;
      --panel-2: #20242e;
      --line: #2c3340;
      --text: #e7edf5;
      --muted: #9aa7b8;
      --accent: #5eead4;
      --accent-2: #facc15;
      --danger: #fb7185;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background: radial-gradient(circle at top left, #17313a 0, #0f1117 36%, #0f1117 100%);
      color: var(--text);
      font-family: ui-sans-serif, "Segoe UI", sans-serif;
    }
    .wrap { min-height: 100vh; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
    .title { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .brand { font-size: 16px; font-weight: 700; letter-spacing: 0; }
    .tag { color: #0b1016; background: var(--accent); padding: 3px 7px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    textarea {
      width: 100%;
      min-height: 132px;
      resize: vertical;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: rgba(23, 26, 34, .94);
      color: var(--text);
      outline: none;
      line-height: 1.45;
    }
    textarea:focus { border-color: var(--accent); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    button {
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      color: var(--text);
      cursor: pointer;
      font-weight: 650;
    }
    button:hover { border-color: var(--accent); }
    button.primary { background: var(--accent); color: #091012; border-color: transparent; }
    button.warn { background: #3a3113; border-color: #5f4d16; color: #ffe58a; }
    .tools { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .log {
      flex: 1;
      min-height: 180px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(12, 14, 19, .92);
      padding: 10px;
      overflow: auto;
      white-space: pre-wrap;
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 12px;
      line-height: 1.45;
    }
    .hint { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .stderr { color: var(--danger); }
    .stdout { color: var(--text); }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="title">
      <div class="brand">AI Dev</div>
      <div class="tag">Codex</div>
    </div>
    <textarea id="prompt" placeholder="Write a task for Codex Supervisor..."></textarea>
    <div class="row">
      <button class="primary" id="plan">Plan</button>
      <button class="warn" id="execute">Run Codex</button>
    </div>
    <div class="tools">
      <button id="init">Init</button>
      <button id="latest">Latest</button>
      <button id="runs">Runs</button>
    </div>
    <div class="hint">Plan creates a contract without executing Codex. Run Codex calls <code>aidev.py --execute</code>.</div>
    <div class="log" id="log"></div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const prompt = document.getElementById("prompt");
    const log = document.getElementById("log");
    function send(type) {
      vscode.postMessage({ type, prompt: prompt.value });
    }
    function append(text, cls) {
      const span = document.createElement("span");
      if (cls) span.className = cls;
      span.textContent = text;
      log.appendChild(span);
      log.scrollTop = log.scrollHeight;
    }
    document.getElementById("plan").addEventListener("click", () => send("plan"));
    document.getElementById("execute").addEventListener("click", () => send("execute"));
    document.getElementById("init").addEventListener("click", () => send("init"));
    document.getElementById("latest").addEventListener("click", () => send("latest"));
    document.getElementById("runs").addEventListener("click", () => send("openRuns"));
    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "status") append("\\n> " + msg.text + "\\n");
      if (msg.type === "stream") append(msg.text, msg.stream);
      if (msg.type === "done") append("\\n(exit " + msg.code + ")\\n");
      if (msg.type === "error") append("\\nERROR: " + msg.text + "\\n", "stderr");
    });
  </script>
</body>
</html>`;
  }
}

function quote(value) {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function deactivate() {}

module.exports = { activate, deactivate };
