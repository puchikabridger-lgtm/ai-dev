# Reasoning Routing Rules

- Use `none` for easy mechanical tasks: fix a simple linter/syntax/formatting error, change or rename a variable, change a constant or label, fix a typo, add/remove a bracket, paste a small snippet, answer from visible context, or make a one-line/single-obvious edit.
- Use `low` for medium/simple engineering tasks with local judgment: ordinary small bugfixes, small text/code changes, single-file examples, hello-world/simple scripts when they need minor choices, direct file creation, and questions that need brief inspection but no deep project analysis.
- Use `medium` for complex normal work and easy important work: small-to-moderate features, UI builds/tweaks, modest multi-file changes, non-risky architecture cleanup, small projects, and direct auth/OAuth/database/config fixes where the likely edit is narrow.
- Use `high` for complex important work or hyper-complex normal work: database schema/migrations, auth architecture, security/payment/encryption work, full projects from scratch, broad behavior changes, large rewrites, or ambiguous work where mistakes are likely.
- Use `extra high` (`xhigh` internally) only when work is both hyper-complex and important: fullstack plus persistence plus auth/security, production-critical systems, very broad tasks with high blast radius, or work that combines extreme complexity with database/auth/security risk.
- Never choose `high` or `extra high` just because the task mentions auth, OAuth, database, or "rewrite". First decide whether the likely change is narrow (`medium`) or broad/risky (`high`/`xhigh`).
