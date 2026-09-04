const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const Module = require("node:module");
const test = require("node:test");

function loadPreferences(userDataPath) {
  const modulePath = require.resolve("../build/electron/updater/update-preferences.js");
  const originalLoad = Module._load;
  Module._load = function mockElectron(request) {
    if (request === "electron") return { app: { getPath: () => userDataPath } };
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[modulePath];
  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("update preferences default to prompting before downloads", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-updates-"));
  try {
    const { readUpdatePreferences } = loadPreferences(userDataPath);
    assert.deepEqual(readUpdatePreferences(), { automaticallyDownload: false });
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("update preferences remember automatic downloads and a skipped version", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-updates-"));
  try {
    const { readUpdatePreferences, writeUpdatePreferences } = loadPreferences(userDataPath);
    writeUpdatePreferences({ automaticallyDownload: true, skippedVersion: "2.13.0" });
    assert.deepEqual(readUpdatePreferences(), {
      automaticallyDownload: true,
      skippedVersion: "2.13.0"
    });
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
