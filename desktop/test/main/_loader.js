// Test loader for desktop/src/main.js.
//
// main.js requires `electron` at module load and then registers ~100
// `ipcMain.handle(...)` listeners plus `app.whenReady().then(createWindow)`.
// To unit-test the helpers exported at the bottom of main.js without spinning
// up a real Electron environment, we pre-populate the Node module cache with a
// no-op stub of the `electron` module. main.js then sees the stub when it
// calls `require("electron")`, and the side-effect calls (ipcMain.handle, app
// listeners, dialog/shell/Notification access) all hit safe noop methods.
//
// `app.whenReady` returns a never-resolving Promise so the trailing
// `.then(createWindow)` never fires. That keeps BrowserWindow construction
// from running in the test process.
//
// Tests should `require("./_loader.js")` instead of touching main.js directly.

"use strict";

const path = require("path");
const Module = require("module");

const electronPath = path.join(__dirname, "__electron_stub__.js");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveElectronStub(request, parent, isMain, options) {
  if (request === "electron") return electronPath;
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const stubApp = {
  whenReady: () => new Promise(() => {}),
  on: () => stubApp,
  quit: () => {},
  getPath: (name) => {
    if (name === "userData") return path.join(__dirname, "_userData");
    if (name === "documents") return path.join(__dirname, "_documents");
    return path.join(__dirname, `_${name}`);
  },
};

const stubBrowserWindow = function () {
  return { loadFile: () => {}, on: () => {}, webContents: { on: () => {}, send: () => {} } };
};
stubBrowserWindow.getAllWindows = () => [];

const stubIpcMain = { handle: () => {}, on: () => {}, removeHandler: () => {} };
const stubShell = { openPath: () => Promise.resolve("") };
const stubDialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  showSaveDialog: async () => ({ canceled: true, filePath: "" }),
};
function StubNotification() {
  return { show: () => {} };
}
StubNotification.isSupported = () => false;

const stubModule = new Module(electronPath);
stubModule.id = electronPath;
stubModule.filename = electronPath;
stubModule.loaded = true;
stubModule.exports = {
  app: stubApp,
  BrowserWindow: stubBrowserWindow,
  ipcMain: stubIpcMain,
  shell: stubShell,
  dialog: stubDialog,
  Notification: StubNotification,
};
require.cache[electronPath] = stubModule;

const mainPath = path.resolve(__dirname, "..", "..", "src", "main.js");

// Drop any prior load so re-requiring picks up the stub.
delete require.cache[mainPath];

module.exports = require(mainPath);
