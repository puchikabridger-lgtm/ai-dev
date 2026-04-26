const cp = require("child_process");
const process = require("process");

function commandExists(command) {
  const tool = process.platform === "win32" ? "where" : "which";
  const result = cp.spawnSync(tool, [command], {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
  });
  return result.status === 0;
}

function allowedModelSet(merged, defaults = []) {
  const catalog = Array.isArray(merged?.modelCatalog) && merged.modelCatalog.length ? merged.modelCatalog : defaults;
  const builtins = new Set(["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"]);
  for (const item of catalog) {
    if (!item || item.enabled === false) continue;
    const model = String(item.model || "").trim();
    if (model) builtins.add(model);
  }
  return builtins;
}

function ensureModelAvailable(merged, model, label, defaults = []) {
  const value = String(model || "").trim();
  if (!value) {
    throw new Error(`${label} model is empty.`);
  }
  if (!allowedModelSet(merged, defaults).has(value)) {
    throw new Error(`${label} model "${value}" is not available. Add it in Auth or choose another model.`);
  }
  return value;
}

function diagnosticsForSettings(merged, root, defaults = []) {
  const current = merged || {};
  const pythonOk = commandExists(current.pythonPath || "python");
  const codexOk = commandExists(current.codexCommand || "codex");
  const directModel = String(current.directModel || current.model || "gpt-5.4-mini");
  const supervisorModel = String(current.supervisorManualModel || current.supervisorModel || "gpt-5.4-mini");
  return {
    projectRoot: root || process.cwd(),
    python: { command: current.pythonPath || "python", available: pythonOk },
    codex: { command: current.codexCommand || "codex", available: codexOk },
    supervisor: {
      mode: current.supervisorModelMode || "auto",
      model: supervisorModel,
      available: allowedModelSet(current, defaults).has(supervisorModel),
    },
    direct: {
      model: directModel,
      available: allowedModelSet(current, defaults).has(directModel),
    },
    auth: {
      hasOpenAIKey: Boolean(current.auth?.openaiApiKey),
      hasAnthropicKey: Boolean(current.auth?.anthropicApiKey),
      openaiBaseUrl: current.auth?.openaiBaseUrl || "",
      localModelUrl: current.auth?.localModelUrl || "",
    },
    catalogCount: Array.isArray(current.modelCatalog) ? current.modelCatalog.length : 0,
  };
}

module.exports = {
  commandExists,
  allowedModelSet,
  ensureModelAvailable,
  diagnosticsForSettings,
};
