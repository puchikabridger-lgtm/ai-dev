# AI Dev Orchestrator Usage

This project contains a small local supervisor for Codex.

It does not spend money by default. A normal request creates a task contract and a run record only. Add `--execute` when you want it to call Codex.

## Desktop App

The easiest way to use this project is the standalone desktop UI:

```powershell
cd path\to\your\clone\desktop
npm start
```

The app has:

- `Supervisor` mode for the safe Codex workflow with rules, budget, and audit.
- `Direct` mode for plain Codex.
- `Compare` mode for viewing both lanes without accidentally running two jobs.
- `Inspector` for summary, prompt, contract, audit, and logs.
- `Rules`, `Budget`, and `Settings` screens.
- project switching through `Settings`.

Recommended workflow:

1. Write the task in the input.
2. Click `Plan`.
3. Read the plan card/output and Inspector summary.
4. Click `Run` only when you want Codex to execute.

In `Direct` mode, `Plan` is disabled because there is no supervisor layer. Use `Run Direct` only when you intentionally want plain Codex.

For large tasks, use the one-run controls next to Run:

- `Approve high` allows high/extra high reasoning for this run only.
- `Bypass budget` bypasses the budget block for this run only.

These reset after the run finishes.

Feature toggles live in the `Rules` screen. Core settings live in the `Settings` screen.

Project controls live in `Settings`:

- `Open Project` selects an existing folder.
- `New Project` selects or creates a folder and initializes `.ai`.
- `Open Folder` opens the current project in Windows Explorer.
- `Open .ai` opens the current project's AI workspace folder.

Runtime controls live in `Settings`:

- Python path
- Codex command
- Direct model
- Codex sandbox
- Codex timeout seconds

Supervisor controls live in `Settings`:

- Supervisor model, normally `gpt-5.4-mini`
- Supervisor reasoning, normally `low`
- Supervisor model mode, normally `auto`

Executor model controls live in `Settings`:

- None/low executor, normally `gpt-5.4-mini`
- Medium/high executor, normally `gpt-5.4`
- Maximum executor, normally `gpt-5.5`
- `Force model in Supervisor`, usually off so Supervisor can choose executor models by task difficulty
- `Skip git repo check`, usually on for new local folders

Supervisor policy:

- Supervisor/router agent: `gpt-5.4-mini` with `low` reasoning.
- Executor model: selected by task difficulty unless `Force model in Supervisor` is enabled.
- Model selector policy: keep `auto` for normal routing, or choose `gpt-5.4-mini`, `gpt-5.4`, `gpt-5.5`, or another configured model manually.

Budget controls live in `Budget`:

- session budget
- request budget
- retry budget
- max Codex calls per request
- daily Codex call limit
- daily high call limit
- daily extra high call limit
- warn/block percentages

## First Run

```powershell
python .\aidev.py init
```

This creates and updates:

- `.ai/config/project.json`
- `.ai/config/discovered.json`
- `.ai/budget/budget.json`
- `.ai/rules/*.md`
- `.ai/project/*.md`

## Plan A Task Without Running Codex

```powershell
python .\aidev.py run "change x variable to 3"
```

Shortcut:

```powershell
python .\aidev.py "change x variable to 3"
```

This creates:

- `.ai/runs/<run-id>/request.md`
- `.ai/runs/<run-id>/contract.json`
- `.ai/runs/<run-id>/prompt.md`
- `.ai/runs/<run-id>/audit.json`

## Run Codex

```powershell
python .\aidev.py run "change x variable to 3" --execute
```

PowerShell wrapper:

```powershell
.\aidev.ps1 run "change x variable to 3" --execute
```

The program uses the local `codex exec` command if it is available in `PATH`.

Detected command on this machine:

```text
codex
```

## High And Extra High Tasks

`high` and extra high (`xhigh` internally) are blocked unless approved.

Reasoning routing is intentionally conservative with expensive modes:

- `none`: easy mechanical tasks, simple linter/syntax/format fixes, small variable/label/constant changes, typos, and one obvious edit.
- `low`: medium/simple tasks such as ordinary small bugfixes, small code changes, direct file creation, or brief local inspection.
- `medium`: complex normal work and easy important work, including narrow auth/OAuth/database/config fixes.
- `high`: complex important work or hyper-complex normal work, including migrations, auth architecture, security/payment/encryption work, large rewrites, or full projects from scratch.
- `xhigh`: only work that is both hyper-complex and important, such as fullstack plus persistence plus auth/security or production-critical systems with high blast radius.

For one run:

```powershell
python .\aidev.py run "rewrite the auth architecture" --execute --yes-high
```

If budget blocks the run too, you must explicitly override it:

```powershell
python .\aidev.py run "rewrite the auth architecture" --execute --yes-high --force-budget
```

Use that only when you intentionally accept the cost.

## Force Model Or Reasoning

```powershell
python .\aidev.py run "fix the failing tests" --execute --reasoning medium --model gpt-5.4-mini
```

Supported reasoning values:

- `none`
- `low`
- `medium`
- `high`
- `xhigh` (`extra high`)

## Budget

Budget settings live here:

```text
.ai/budget/budget.json
```

Default limits:

- session: `$5.00`
- request: `$0.50`
- retry: `$0.15`
- warning: `80%`
- block: `95%`

The current MVP uses estimated cost, not exact provider billing. It is designed to stop runaway loops before they start.

## Latest Run

```powershell
python .\aidev.py latest
```

This prints the latest run folder and audit result.

## How Codex Is Connected

The adapter calls:

```text
codex exec - --cd <project> -m <model> -s workspace-write --output-last-message <file>
```

The full prompt is passed through stdin and stored in:

```text
.ai/runs/<run-id>/prompt.md
```

Codex output is stored in:

```text
.ai/runs/<run-id>/codex-stdout.txt
.ai/runs/<run-id>/codex-stderr.txt
.ai/runs/<run-id>/codex-last-message.md
```

## Important Files

- `aidev.py` is the main program.
- `aidev.ps1` is a PowerShell wrapper.
- `desktop/` is the standalone Electron UI.
- `vscode-aidev/` is the VS Code sidebar extension.
- `.ai/PLAN.md` is the product and architecture plan.
- `.ai/config/project.json` controls models, backend, approval, and execution defaults.
- `.ai/rules/*.md` controls behavior.
- `.ai/budget/budget.json` controls spend limits.

## VS Code Sidebar

There is a local VS Code extension in:

```text
vscode-aidev/
```

Install it:

```powershell
code --install-extension .\vscode-aidev\aidev-codex-sidebar-0.1.0.vsix
```

Then open this folder in VS Code:

```powershell
code .
```

In the Activity Bar, open `AI Dev`.

Buttons:

- `Init` creates/updates the `.ai` workspace.
- `Plan` creates a task contract without running Codex.
- `Run Codex` runs the task through `aidev.py --execute`.
- `Latest` shows the latest run audit.
- `Runs` opens the `.ai/runs` folder.

The sidebar is just a GUI for the same commands:

```powershell
python .\aidev.py run "your prompt"
python .\aidev.py run "your prompt" --execute
```
