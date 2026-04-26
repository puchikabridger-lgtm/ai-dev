# AI Dev — Codex Supervisor

A local-first orchestration layer over the OpenAI `codex` CLI. It plans tasks before spending money, enforces budgets, audits diffs for scope creep, and exposes the same workflow through a CLI, an Electron desktop app, and a VS Code sidebar.

The idea: a single supervisor brain (`aidev.py`) classifies each request, picks the cheapest reliable model and lowest useful reasoning level, writes a strict task contract, runs Codex inside a budget guard, and audits the result — all against per-project state stored in `.ai/`.

## Highlights

- **Safe by default.** `python aidev.py "prompt"` produces a contract and prompt only. Add `--execute` to actually call Codex.
- **Budget guard.** Session, per-request, retry, and daily call caps; warn at 80%, block at 95%. All spend goes to `.ai/budget/ledger.jsonl`.
- **Reasoning router.** Tiers `none / low / medium / high / xhigh`. `high` and `xhigh` require explicit approval per run.
- **Scope guard.** Enforces a max-changed-files budget per reasoning tier and detects rollback requests in Codex output.
- **Three surfaces, one brain.** CLI, Electron desktop app, VS Code sidebar — all shell out to the same `aidev.py`.
- **Local-first state.** Per-project `.ai/` workspace holds plans, rules, runs, budget, and project memory. Secrets live separately under `~/.config/.../AI Dev/`.

## Repository Layout

```
aidev.py                    # supervisor (CLI entry point + all logic)
aidev.ps1                   # PowerShell wrapper
AI Dev.cmd                  # Windows launcher for the desktop app
desktop/                    # Electron desktop app
  src/main.js               # main process, IPC handlers, settings, secrets
  src/preload.js            # contextBridge surface
  src/renderer/             # UI (index.html, app.js, styles.css)
  test/smoke.js             # end-to-end smoke tests
vscode-aidev/               # VS Code sidebar extension (.vsix included)
scripts/                    # Windows install / icon / portable-build PowerShell
.ai/                        # per-project workspace (plans, rules, runs, budget)
USAGE.md                    # detailed user guide
```

## Quickstart

### Desktop app (recommended)

```powershell
cd desktop
npm install
npm start
```

Modes: **Supervisor** (plan + execute through `aidev.py`), **Direct** (raw `codex exec`), **Compare**. Use `Plan` to dry-run; `Run` to execute. Settings, budget, rules, and project switching live in their own tabs.

### CLI

```powershell
python aidev.py init                              # initialize .ai/ in this folder
python aidev.py "change x variable to 3"          # plan only, no spend
python aidev.py run "fix failing tests" --execute # run Codex
python aidev.py latest                            # last run + audit
```

Useful flags: `--yes-high` (approve high/xhigh once), `--force-budget` (bypass block), `--reasoning <tier>`, `--model <name>`, `--no-budget-guard`, `--no-scope-guard`.

### VS Code sidebar

```powershell
code --install-extension .\vscode-aidev\aidev-codex-sidebar-0.1.0.vsix
```

Opens an `AI Dev` activity bar view with `Init`, `Plan`, `Run Codex`, `Latest`, and `Runs` buttons.

## Requirements

- **Python 3** on `PATH` (configurable in desktop Settings).
- **OpenAI `codex` CLI** on `PATH`. The supervisor calls `codex exec - --cd <root> -m <model> -s workspace-write --output-last-message <file>`.
- **Node.js + npm** for the desktop app and VS Code extension.
- Windows is the primary target; the PowerShell scripts and `.cmd` launcher are Windows-only, but `aidev.py` itself is platform-agnostic.

## How a Run Works

```
prompt
  → classify_task         # complexity, risk, reasoning tier
  → choose_model          # mini / 5.4 / 5.5 by tier
  → estimate_cost
  → budget_check          # session/request/daily caps
  → build_contract        # strict allowed/forbidden actions
  → approval gate         # high/xhigh need --yes-high
  → snapshot_files        # SHA256 + before-files/ for undo
  → execute_codex         # codex exec, stdout/stderr/last-message captured
  → audit_run             # scope guard, rollback detection
  → ledger append
```

Every executed run writes to `.ai/runs/<runId>/`:
`request.md`, `contract.json`, `prompt.md`, `audit.json`, `usage.json`, `before-state.json`, `after-state.json`, `after-diff.patch`, `codex-stdout.txt`, `codex-stderr.txt`, `codex-last-message.md`, and a `before-files/` snapshot for undo.

## Configuration

Per-project files (tracked in git when safe):

- `.ai/PLAN.md` — architecture and design plan.
- `.ai/PRODUCT_PLAN.md` — product roadmap.
- `.ai/config/project.json` — backend, models, reasoning policy, approval, execution defaults.
- `.ai/budget/budget.json` — caps and per-model token prices.
- `.ai/rules/*.md` — global, project, UI, reasoning, and learned rules.
- `.ai/project/{overview,architecture,commands}.md` — discovered project facts.

Local-only files (gitignored):

- `.ai/runs/`, `.ai/summaries/`, `.ai/desktop/` — run artifacts, summaries, desktop settings.
- `.ai/budget/ledger.jsonl` — actual spend log.
- `.ai/config/discovered.json`, `.ai/project/index.json`, `.ai/project/file-index.json` — auto-discovered state.

API keys are stored in `~/.config/.../AI Dev/secrets.json`, never in the project.

## Default Budgets

| Cap | Default |
|---|---|
| Session | $5.00 |
| Per request | $0.50 |
| Per retry | $0.15 |
| Warn / block | 80% / 95% |
| Daily Codex calls | 20 |
| Daily `high` calls | 3 |
| Daily `xhigh` calls | 1 |

Costs are estimated, not billed — designed to stop runaway loops, not to be a billing system.

## Documentation

- [`USAGE.md`](USAGE.md) — full user guide (CLI flags, desktop modes, settings).
- [`.ai/PLAN.md`](.ai/PLAN.md) — architecture and module design.
- [`.ai/PRODUCT_PLAN.md`](.ai/PRODUCT_PLAN.md) — what's next.

## Development

```powershell
cd desktop
npm run check        # syntax-check main/preload/renderer
npm run smoke        # end-to-end smoke (also exercises aidev.py)
```

Build a portable Windows bundle:

```powershell
pwsh scripts/make-portable-windows.ps1
```

Install Start Menu / Desktop / Explorer-context shortcuts:

```powershell
pwsh scripts/install-windows-app.ps1
```
