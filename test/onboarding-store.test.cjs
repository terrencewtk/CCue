const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function loadOnboardingStore(userDataPath) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "electron") return { app: { getPath: () => userDataPath } };
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const modulePath = require.resolve("../build/electron/onboarding/onboarding-store.js");
    delete require.cache[modulePath];
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
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
