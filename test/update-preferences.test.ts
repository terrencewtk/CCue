import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Module from "node:module";
import test from "node:test";

type CommonJsModule = typeof Module & {
  _load(request: string, parent: NodeModule | undefined, isMain: boolean): unknown;
};

const commonJsModule = Module as CommonJsModule;

function loadPreferences(
  userDataPath: string
): typeof import("../electron/updater/update-preferences") {
  const modulePath = require.resolve("../electron/updater/update-preferences.js");
  const originalLoad = commonJsModule._load;
  commonJsModule._load = function mockElectron(request, parent, isMain) {
    if (request === "electron") return { app: { getPath: () => userDataPath } };
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[modulePath];
  try {
    return require(modulePath) as typeof import("../electron/updater/update-preferences");
  } finally {
    commonJsModule._load = originalLoad;
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
