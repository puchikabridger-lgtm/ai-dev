// Skipped placeholder tests for the 2 MB snapshot/backup file-size cap.
//
// The cap is introduced by PRs targeting issues #4 and #4b ("Every run
// snapshots and copies the whole repo"). Those PRs are not part of the
// PR #21 stack this branch is built on, so the snapshot helpers that
// implement the cap are not present yet. These tests are pre-written as
// `test.skip` placeholders to lock in the contract once those PRs merge:
//
//   - Files larger than 2 MB are not enumerated by snapshot_files().
//   - The skipped-file manifest records the rel path + size.
//   - Backup with the cap also skips the same files; the undo path then
//     falls through to the git-restore fallback (already covered for the
//     single-file case in restore-run-extras.test.js).
//
// TODO(#4, #4b): un-skip these once `desktop/src/main.js`'s snapshot
// helpers (or their extracted module) gain the cap + manifest behavior on
// origin/main, and replace the helper imports below with the real ones.

"use strict";

const test = require("node:test");


test.skip("snapshot_files skips files over the 2 MB cap (#4 / #4b)");

test.skip("snapshot_files records skipped large files in a manifest with rel path and size (#4 / #4b)");

test.skip("backupBeforeFiles skips files over the 2 MB cap (#4 / #4b)");

test.skip("undo of a run that skipped a >2 MB file falls back to git restore for that file (#4 / #4b)");
