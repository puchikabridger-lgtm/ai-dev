const cp = require("child_process");

function spawnAsync(command, args, options = {}) {
  const { input, timeout, encoding = "utf8", ...rest } = options;
  return new Promise((resolve) => {
    let child;
    try {
      child = cp.spawn(command, args, { ...rest, windowsHide: true });
    } catch (error) {
      resolve({ status: null, signal: null, stdout: "", stderr: "", error });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timer = null;
    let timedOut = false;
    let settled = false;

    const decode = (chunk) => (Buffer.isBuffer(chunk) && encoding ? chunk.toString(encoding) : String(chunk));
    if (child.stdout) child.stdout.on("data", (chunk) => { stdout += decode(chunk); });
    if (child.stderr) child.stderr.on("data", (chunk) => { stderr += decode(chunk); });

    const finish = (status, signal, error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ status, signal, stdout, stderr, error: error || null, timedOut });
    };

    child.on("error", (error) => finish(null, null, error));
    child.on("close", (status, signal) => finish(status, signal || null, null));

    if (typeof input === "string" && child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.write(input);
      child.stdin.end();
    }

    if (timeout && Number.isFinite(timeout) && timeout > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill(); } catch {}
      }, timeout);
    }
  });
}

module.exports = { spawnAsync };
