# Personal AI Development OS

## Goal

Build a local-first orchestration layer that sits above Codex and any local LLMs.

The system should:

- understand the user request
- choose the cheapest model and lowest reasoning level that can solve it
- ask for confirmation only when needed
- prevent scope creep
- record project knowledge in compact text form
- verify results after execution
- recover from failures with a bounded retry loop
- keep user interaction minimal

The user should usually type one request and then only answer when the system needs approval for a risky action.

## Core Hierarchy

1. User
2. Supervisor AI
3. Codex executor

The supervisor decides. Codex executes.

## Recommended Model Policy

Use the cheapest reliable option first.

- `gpt-5.4-mini` for routing, classification, short summaries, task contracts, and low-cost analysis
- `gpt-5.4` for normal execution and harder reasoning
- `gpt-5.5` only with explicit approval or when a task is clearly high stakes and the cheaper path failed
- local LLMs for cheap pre-processing, memory compression, log analysis, and vision fallback when possible

Default reasoning should be `none`, `low`, or `medium`.

`high` and extra high (`xhigh` internally) should be rare and require confirmation unless the task type has already been approved for that user and project pattern.

## Minimal User Flow

The target flow is:

1. User writes a request.
2. The system classifies the task.
3. The system loads relevant rules and compact project memory.
4. The system builds a task contract.
5. The system asks for confirmation only if the task is risky or requires `high` / extra high.
6. The system runs Codex or a local model.
7. The system audits the diff, logs, and output.
8. The system updates summaries and memory.
9. The system returns the result.

## Main Modules

### 1. Task Classifier

Decides:

- task type
- complexity
- risk
- required reasoning level
- whether a plan is needed
- whether user approval is needed

### 2. Prompt Builder

Turns the raw request into a strict task contract.

The contract should include:

- exact goal
- allowed actions
- forbidden actions
- success criteria
- files likely in scope
- retry limits
- budget limits

### 3. Scope Guard

Prevents unrequested changes.

It should compare:

- user request
- task contract
- actual diff
- Codex self-report

If the result includes unnecessary refactors, file changes, dependency changes, or naming changes, the system should mark the run as a scope violation.

### 4. Execution Adapter

This is the only module that talks to Codex directly.

It should support more than one backend:

- local Codex CLI if installed
- OpenAI Responses API if direct API calls are easier
- local shell actions where appropriate

The adapter should hide setup details from the user.

### 5. Result Auditor

Checks:

- did the change match the request
- did the diff stay inside scope
- did tests pass
- did the app build
- did UI checks pass when relevant

### 6. Failure Recovery

If a run fails, the system should:

- inspect logs
- inspect the diff
- inspect the current state
- produce a tight retry prompt
- retry only within a fixed limit

### 7. Memory Layer

Store memory in small files, not one giant blob.

Suggested layout:

- `rules/` for user and project rules
- `project/` for architecture and indexes
- `summaries/` for compact file summaries
- `runs/` for execution history
- `budget/` for spend controls

## Recommended Folder Structure

```text
.ai/
  README.md
  PLAN.md
  config/
    project.json
  rules/
    global.md
    project.md
    ui.md
    learned.md
  project/
    overview.md
    architecture.md
    commands.md
    file-index.json
  summaries/
    src__app.ts.md
    src__components__VideoCard.tsx.md
  runs/
    <run-id>/
      request.md
      contract.json
      prompt.md
      before-state.json
      after-diff.patch
      audit.json
      cost.json
  budget/
    budget.json
```

## Project Summaries

The summaries layer is the main solution for small context windows.

Instead of reading the whole repo every time, the system should first read:

- `project/overview.md`
- `project/file-index.json`
- the summaries of relevant files
- the current diff

Each summary should answer:

- what the file does
- what it exports
- what it depends on
- what can break if it changes
- which files are related

Keep summaries compact and refresh only the files that changed.

## Budget Controls

The system must never spend freely on a single mistaken request.

Use three controls:

- hard session cap
- per-request cap
- retry cap

Suggested budget data:

```json
{
  "session_budget_usd": 5.00,
  "request_budget_usd": 0.50,
  "retry_budget_usd": 0.15,
  "max_codex_calls_per_request": 2,
  "warn_at_percent": 80,
  "block_at_percent": 95
}
```

When the budget is close to the limit, the system should switch to safe mode:

- no new expensive model calls
- no unbounded retries
- only analysis and reporting

## Reasoning-Level Policy

Default behavior:

- prefer `none` when the task is purely mechanical and obvious
- prefer `low` when the task is narrow and needs only light judgment
- prefer `medium` for ordinary engineering tasks
- avoid `high` unless the task is genuinely hard
- avoid extra high (`xhigh` internally) unless the task is clearly complex and the user approved it

For `high` and extra high, ask the user and remember the answer for that task type and difficulty pattern.

## UI and Visual Work

Do not use images as the primary representation for most tasks.

Prefer text-first artifacts:

- diffs
- DOM snapshots
- logs
- screenshots only for final visual QA
- structured reports

For UI tasks, use a special verification loop:

1. build the interface
2. generate screenshots only as validation
3. inspect DOM and console output
4. run interaction checks
5. retry only if the checks fail

If vision is used, it should be a fallback or a final check, not the main control channel.

## Built-In OpenAI Tools To Prefer

When available in the chosen OpenAI runtime, prefer built-in tools instead of custom reimplementation.

Useful built-ins for this project:

- `apply_patch` for file edits in controlled runs
- `hosted_shell` for sandboxed command execution when the model can use it directly
- `file_search` for retrieval over stored project context
- `code_interpreter` for analysis, summaries, and structured inspection
- `computer_use` only for browser/UI checks when text and DOM checks are not enough

Use structured outputs for:

- task contracts
- budget checks
- audit reports
- retry decisions
- memory updates
- approval records

Use local text artifacts and local repo state as the default source of truth. Use hosted tools when they reduce setup friction or complexity.

## Rules System

Rules should be versioned and layered.

Recommended precedence:

1. user
2. project
3. current task contract
4. learned rules
5. default system policy

When the user complains about unrequested work, the system should learn a new scope rule and add it to the rules folder.

Example scope rule:

- do not refactor architecture during a narrow edit request
- do not rename unrelated symbols
- do not add dependencies unless requested
- do not touch files outside the directly relevant area

## Codex Connection Strategy

The easiest way to connect is to hide Codex behind one adapter.

The adapter should:

- detect whether local Codex CLI is installed
- detect whether OpenAI API access is available
- choose the lowest-friction backend automatically
- keep the same task contract interface regardless of backend

Recommended request path:

```text
UI / CLI
  -> Supervisor
  -> Task Contract
  -> Budget Guard
  -> Codex Adapter
  -> Audit
  -> Memory Update
```

That keeps the user interface simple and the implementation replaceable.

## Project Manifest

Keep the default behavior in one small machine-readable file.

`config/project.json` should hold:

- default backend preference
- allowed model list
- reasoning policy
- budget policy
- approval policy
- discovery hints
- command overrides

This avoids scattering core defaults across many markdown files.

## Bootstrap And Auto-Discovery

The first run should try to discover everything it can without asking the user.

Auto-detect:

- repository root
- git status
- package manager
- build and test commands
- dev server command
- main app entrypoints
- likely UI framework
- relevant environment files

Only ask the user when the system finds multiple conflicting options or cannot infer the answer safely.

Cache the result in project memory so later runs do not repeat the scan.

## Implementation Phases

### Phase 1: Foundation

- create the `.ai/` layout
- add budget config
- add rules config
- add project index and overview files
- build task contract generation

### Phase 2: Router

- classify task type and complexity
- choose model and reasoning level
- ask approval for `high` and extra high
- write the decision to the run record

### Phase 3: Execution

- implement the Codex adapter
- run edits through a checkpoint
- capture diff and logs
- enforce scope guard

### Phase 4: Memory

- summarize changed files
- refresh project index
- store learned rules
- store user preferences by task type

### Phase 5: Recovery

- analyze failures
- generate retry prompts
- retry only within budget
- stop and ask the user when the system is uncertain

### Phase 6: UI Quality

- add DOM and screenshot checks
- add accessibility and overflow checks
- add a structured visual QA report

### Phase 7: Evaluation Harness

- add regression tests for task classification
- add regression tests for budget guards
- add regression tests for scope guard
- add regression tests for project summaries
- add regression tests for backend routing
- add regression tests for approval prompts

The orchestrator itself should be testable with fixed fixtures before it is trusted on real tasks.

## What To Avoid

- one giant prompt file
- one giant memory file
- free-form agent sprawl without a contract
- using vision as the default transport
- `high` / extra high as the default
- unbounded retries
- expensive model calls before cheap classification

## Short Version

The system should behave like this:

```text
User intent
  -> cheap classification
  -> strict contract
  -> budget check
  -> Codex execution
  -> diff audit
  -> memory update
```

That is the simplest structure that still gives control, memory, cost limits, and reliable recovery.
