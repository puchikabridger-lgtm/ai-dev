"use strict";

const path = require("path");

function createProjectPaths({ getSettings, appRoot }) {
  function projectRoot() {
    return path.resolve(getSettings().projectRoot || appRoot);
  }

  function projectAiDir() {
    return path.join(projectRoot(), ".ai");
  }

  function projectRunsDir() {
    return path.join(projectAiDir(), "runs");
  }

  function projectDesktopDir() {
    return path.join(projectAiDir(), "desktop");
  }

  function projectIndexFile() {
    return path.join(projectAiDir(), "project", "index.json");
  }

  function terminalHistoryFile() {
    return path.join(projectDesktopDir(), "terminal-history.json");
  }

  function aidevScript() {
    return path.join(appRoot, "aidev.py");
  }

  return {
    projectRoot,
    projectAiDir,
    projectRunsDir,
    projectDesktopDir,
    projectIndexFile,
    terminalHistoryFile,
    aidevScript,
  };
}

module.exports = { createProjectPaths };
