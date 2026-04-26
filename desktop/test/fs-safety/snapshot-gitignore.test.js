// Skipped placeholder tests for gitignore-aware snapshot enumeration.
//
// When the project is a git repository, snapshot_files() should skip files
// excluded by `.gitignore` (in addition to the hard-coded ignored paths
// already covered by `isSnapshotIgnored`). This behavior is part of the
// snapshot-perf rework on issue #4 / #4b, which is not in the PR #21 stack
// this branch is built on. Pre-written placeholders below lock in the
// contract for un-skipping once those PRs land.
//
// TODO(#4, #4b): un-skip once `snapshot_files` consults `.gitignore` (or
// `git ls-files --others --exclude-standard --cached`) for git projects,
// then assert:
//
//   1. node_modules/ entries listed in .gitignore are NOT in the snapshot.
//   2. dist/ build output listed in .gitignore is NOT in the snapshot.
//   3. A file NOT in .gitignore IS in the snapshot.
//   4. Non-git projects fall back to the existing static ignore set
//      (already covered by main-process tests for `isSnapshotIgnored`).

"use strict";

const test = require("node:test");


test.skip("snapshot_files excludes node_modules entries listed in .gitignore (#4 / #4b)");

test.skip("snapshot_files excludes dist/ build output listed in .gitignore (#4 / #4b)");

test.skip("snapshot_files includes files NOT excluded by .gitignore (#4 / #4b)");

test.skip("snapshot_files keeps the static ignore behavior for non-git projects (#4 / #4b)");
