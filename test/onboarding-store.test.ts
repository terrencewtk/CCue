import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

type CommonJsModule = typeof Module & {
  _load(request: string, parent: NodeModule | undefined, isMain: boolean): unknown;
};

const commonJsModule = Module as CommonJsModule;

function loadOnboardingStore(
  userDataPath: string
): typeof import("../electron/onboarding/onboarding-store") {
  const originalLoad = commonJsModule._load;
  commonJsModule._load = function load(request, parent, isMain) {
    if (request === "electron") return { app: { getPath: () => userDataPath } };
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const modulePath = require.resolve("../electron/onboarding/onboarding-store.js");
    delete require.cache[modulePath];
    return require(modulePath) as typeof import("../electron/onboarding/onboarding-store");
  } finally {
    commonJsModule._load = originalLoad;
  }
}

test("onboarding remains incomplete until the final completion is persisted", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-onboarding-"));
  try {
    const store = loadOnboardingStore(userDataPath);
    assert.equal(store.hasCompletedOnboarding(), false);

    store.markOnboardingCompleted();

    assert.equal(store.hasCompletedOnboarding(), true);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(userDataPath, "onboarding.json"), "utf8")),
      { completed: true }
    );
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("invalid onboarding data does not skip first-run setup", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-onboarding-"));
  try {
    fs.writeFileSync(path.join(userDataPath, "onboarding.json"), "not json");
    assert.equal(loadOnboardingStore(userDataPath).hasCompletedOnboarding(), false);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
