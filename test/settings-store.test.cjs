const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function loadSettingsStore(userDataPath) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") {
      return { app: { getPath: () => userDataPath } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const modulePath = require.resolve("../build/electron/settings/settings-store.js");
    delete require.cache[modulePath];
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("persists the configured overlay line count", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-settings-"));
  try {
    const { readSettings, writeSettings } = loadSettingsStore(userDataPath);
    writeSettings({
      language: "ja-JP",
      translationEnabled: true,
      translationLanguage: "en-US",
      overlayLineCount: 7
    });

    assert.equal(readSettings().overlayLineCount, 7);
    assert.equal(JSON.parse(
      fs.readFileSync(path.join(userDataPath, "settings.json"), "utf8")
    ).overlayLineCount, 7);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("defaults the overlay line count to three", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-settings-"));
  try {
    const { readSettings } = loadSettingsStore(userDataPath);
    assert.equal(readSettings().overlayLineCount, 3);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("persists a custom global shortcut or disables it", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-settings-"));
  try {
    const { readSettings, writeSettings } = loadSettingsStore(userDataPath);
    writeSettings({ globalShortcut: "Command+Alt+C" });
    assert.equal(readSettings().globalShortcut, "Command+Alt+C");

    writeSettings({ globalShortcut: null });
    assert.equal(readSettings().globalShortcut, null);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("defaults invalid global shortcuts to Command-Shift-L", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-settings-"));
  try {
    const { normalizeCaptureSettings } = loadSettingsStore(userDataPath);
    assert.equal(normalizeCaptureSettings({}).globalShortcut, "CommandOrControl+Shift+L");
    assert.equal(normalizeCaptureSettings({ globalShortcut: "L" }).globalShortcut, "CommandOrControl+Shift+L");
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
