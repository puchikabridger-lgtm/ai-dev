const assert = require("node:assert/strict");
const { spawnAsync } = require("../src/spawn-async");

let failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ok  ${name}`))
    .catch((err) => {
      failed += 1;
      console.error(`  FAIL  ${name}`);
      console.error(err);
    });
}

console.log("spawnAsync:");

(async () => {
  await test("captures stdout/stderr and exit status from a short command", async () => {
    const result = await spawnAsync(process.execPath, ["-e", "process.stdout.write('hi'); process.stderr.write('err'); process.exit(0)"]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "hi");
    assert.equal(result.stderr, "err");
  });

  await test("propagates non-zero exit codes without throwing", async () => {
    const result = await spawnAsync(process.execPath, ["-e", "process.exit(7)"]);
    assert.equal(result.status, 7);
    assert.equal(result.error, null);
  });

  await test("times out and reports timedOut=true", async () => {
    const t0 = Date.now();
    const result = await spawnAsync(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], { timeout: 200 });
    const elapsed = Date.now() - t0;
    assert.equal(result.timedOut, true);
    assert.ok(elapsed < 2000, `should kill quickly after timeout, took ${elapsed}ms`);
  });

  await test("two long calls run in parallel, not serially (proves non-blocking)", async () => {
    const sleepScript = "setTimeout(() => process.exit(0), 600)";
    const t0 = Date.now();
    const [a, b] = await Promise.all([
      spawnAsync(process.execPath, ["-e", sleepScript]),
      spawnAsync(process.execPath, ["-e", sleepScript]),
    ]);
    const elapsed = Date.now() - t0;
    assert.equal(a.status, 0);
    assert.equal(b.status, 0);
    assert.ok(
      elapsed < 1100,
      `two 600ms calls in parallel should finish under ~1100ms, took ${elapsed}ms (serial would be ~1200ms+)`,
    );
  });

  await test("forwards stdin input to the child", async () => {
    const result = await spawnAsync(
      process.execPath,
      ["-e", "let buf=''; process.stdin.on('data', c => buf += c); process.stdin.on('end', () => { process.stdout.write(buf.toUpperCase()); process.exit(0); })"],
      { input: "hello world" },
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "HELLO WORLD");
  });

  await test("returns error when the command does not exist", async () => {
    const result = await spawnAsync("definitely-not-a-real-command-xyz-12345", []);
    assert.ok(result.error, "should populate error field");
    assert.equal(result.status, null);
  });

  if (failed) {
    console.error(`\n${failed} test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll spawn-async tests passed.");
})();
