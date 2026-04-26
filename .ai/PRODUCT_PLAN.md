# AI Dev Product Plan

## Goal

Make AI Dev feel like a serious local-first competitor to Codex, Cursor, and Antigravity:

- faster first useful answer
- lower wasted tokens
- visible cost/time/context telemetry
- reliable undo without user setup
- stronger project memory
- fewer settings needed before value

## Keep

- Local project ownership and `.ai` workspace.
- Supervisor vs Direct modes, but make the difference clearer.
- Budget guard, scope guard, and autonomous undo.
- Model catalog, because local/provider flexibility is a core advantage.

## Remove Or Hide

- Hide advanced auth/provider fields until the user opens advanced settings.
- Hide raw prompt/contracts by default; show them only in a details/debug view.
- Remove duplicate status text once telemetry cards show the same information.
- Stop making users think about Git for safety; Git should be a fallback only.

## Improve Now

1. Run telemetry
   - Record seconds per stage.
   - Record estimated or real token counts.
   - Record context fill percentage.
   - Record estimated and later actual cost.
   - Show slowest stage and total duration in History and run results.

2. Token efficiency
   - Keep compact prompts for low-risk tasks.
   - Route tiny tasks directly to Codex instead of always creating a supervisor plan.
   - Add project summary cache and only include relevant slices.
   - Add diff-aware follow-up prompts instead of resending full context.
   - Track prompt chars and output chars per run to catch prompt bloat.

3. Speed
   - Start with a cheap classifier.
   - Use a local supervisor-needed router before any model call.
   - Avoid full project scans for tiny tasks.
   - Cache discovered project facts.
   - Run checks only when relevant to changed files.

4. UX
   - Add a dashboard tab with recent runs, costs, failures, and slow stages.
   - Add visible run phases: classify, prompt, execute, audit.
   - Make Undo, Open changed file, and Re-run first-class actions.
   - Add a compact diff preview for every run.

5. Reliability
   - Keep local file snapshots for every executed run.
   - Add a restore preview before undo when many files changed.
   - Mark runs as incomplete if Codex crashes before audit.
   - Store enough metadata to diagnose failures without reading raw logs.

## Next Big Features

1. Smart context packer
   - Build a per-project index of files, symbols, commands, and summaries.
   - Select context by task type and mentioned files.
   - Track context budget and refuse wasteful prompt growth.

2. Agent workbench
   - Add task queue.
   - Add background checks.
   - Add "continue from failed run".
   - Add branchless local snapshots for all edits.

3. Review mode
   - Show changed files, diff summary, tests, risk, and suggested next step.
   - Let the user approve/apply/revert individual file changes.

4. Benchmark mode
   - Run the same task against multiple models.
   - Compare time, estimated cost, changed files, and success.
   - Save the best model choice per task category.

5. Autopilot with limits
   - Let the app run small safe fixes automatically.
   - Stop for high-risk edits, dependency changes, secrets, or destructive operations.
   - Make every autonomous action reversible.

## Supervisor Router

Before spending tokens on supervisor analysis, classify the request locally:

- Direct route: small edits, obvious file creation, copy/text changes, tiny UI tweaks, simple scripts.
- Supervisor route: architecture, auth/security, database, deployment, broad refactors, large prompts, multi-file ambiguity, review/audit work.
- Future improvement: store routing confidence and outcome quality so the router learns which project tasks need supervisor help.
- Future improvement: add a "force supervisor for this project path" rule for risky folders.
- Future improvement: show the route decision in telemetry and measure saved time/tokens.

## Product Standard

Every completed run should answer:

- What changed?
- How long did each stage take?
- How many tokens were used?
- How much context was filled?
- How much money was estimated or actually spent?
- What was the slowest/wasteful part?
- Can I undo it safely?
