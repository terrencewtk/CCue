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

function loadSettingsStore(
  userDataPath: string
): typeof import("../electron/settings/settings-store") {
  const originalLoad = commonJsModule._load;
  commonJsModule._load = function load(request, parent, isMain) {
    if (request === "electron") {
      return { app: { getPath: () => userDataPath } };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const modulePath = require.resolve("../electron/settings/settings-store.js");
    delete require.cache[modulePath];
    return require(modulePath) as typeof import("../electron/settings/settings-store");
  } finally {
    commonJsModule._load = originalLoad;
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
      overlayLineCount: 2
    });

    assert.equal(readSettings().overlayLineCount, 2);
    assert.equal(JSON.parse(
      fs.readFileSync(path.join(userDataPath, "settings.json"), "utf8")
    ).overlayLineCount, 2);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("clamps the overlay line count to three", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-settings-"));
  try {
    const { normalizeCaptureSettings } = loadSettingsStore(userDataPath);
    assert.equal(normalizeCaptureSettings({ overlayLineCount: 10 }).overlayLineCount, 3);
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

test("preserves newly discovered canonical language selections", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-settings-"));
  try {
    const { normalizeCaptureSettings } = loadSettingsStore(userDataPath);
    const settings = normalizeCaptureSettings({
      language: "fr-fr",
      translationLanguage: "ar"
    });
    assert.equal(settings.language, "fr-FR");
    assert.equal(settings.translationLanguage, "ar");
    assert.equal(normalizeCaptureSettings({ language: "not_a_locale" }).language, "ja-JP");
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("migrates legacy settings once with built-ins plus canonical active selections", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-settings-"));
  try {
    fs.writeFileSync(path.join(userDataPath, "settings.json"), JSON.stringify({
      language: "fr-fr", translationLanguage: "ar", overlayLineCount: 2,
      globalShortcut: null
    }));
    const store = loadSettingsStore(userDataPath);
    const migrated = store.readSettingsSnapshot();
    assert.deepEqual(migrated.library.enabledTranscriptionLanguages, [
      "zh-CN", "en-US", "ja-JP", "ko-KR", "fr-FR"
    ]);
    assert.deepEqual(migrated.library.enabledTranslationPairs, [
      "zh-Hans", "zh-Hant", "en", "ja", "ko", "ar"
    ].map((targetLanguage) => ({ sourceLanguage: "fr-FR", targetLanguage })));
    store.writeSettingsSnapshot(migrated);
    const record = JSON.parse(fs.readFileSync(path.join(userDataPath, "settings.json"), "utf8"));
    assert.equal(record.languageLibrary.version, 2);
    assert.equal("readiness" in record, false);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("maps the active legacy translation selection to Apple's identifier once", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-settings-"));
  try {
    fs.writeFileSync(path.join(userDataPath, "settings.json"), JSON.stringify({
      language: "ja-JP", translationLanguage: "en-US"
    }));
    const migrated = loadSettingsStore(userDataPath).readSettingsSnapshot();
    assert.equal(migrated.settings.translationLanguage, "en");
    assert.deepEqual(migrated.library.enabledTranslationPairs, [
      "zh-Hans", "zh-Hant", "en", "ko"
    ].map((targetLanguage) => ({ sourceLanguage: "ja-JP", targetLanguage })));
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("migrates a version-one target list into pairs for its persisted source", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-settings-"));
  try {
    fs.writeFileSync(path.join(userDataPath, "settings.json"), JSON.stringify({
      language: "fr-FR", translationLanguage: "en-US",
      languageLibrary: {
        version: 1,
        enabledTranscriptionLanguages: ["fr-fr", "en-US", "bad_locale"],
        enabledTranslationLanguages: ["en-US"]
      }
    }));
    const snapshot = loadSettingsStore(userDataPath).readSettingsSnapshot();
    assert.deepEqual(snapshot.library.enabledTranscriptionLanguages, ["fr-FR", "en-US"]);
    assert.deepEqual(snapshot.library.enabledTranslationPairs, [
      { sourceLanguage: "fr-FR", targetLanguage: "en" }
    ]);
    assert.equal(snapshot.settings.translationLanguage, "en");
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("preserves exact identifiers in an existing pair library", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-settings-"));
  try {
    fs.writeFileSync(path.join(userDataPath, "settings.json"), JSON.stringify({
      language: "en-US", translationLanguage: "fr-FR",
      languageLibrary: {
        version: 2,
        enabledTranscriptionLanguages: ["en-US"],
        enabledTranslationPairs: [{ sourceLanguage: "en-US", targetLanguage: "fr-FR" }]
      }
    }));
    const snapshot = loadSettingsStore(userDataPath).readSettingsSnapshot();
    assert.deepEqual(snapshot.library.enabledTranslationPairs, [
      { sourceLanguage: "en-US", targetLanguage: "fr-FR" }
    ]);
    assert.equal(snapshot.settings.translationLanguage, "fr-FR");
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("writes complete capture fields and library atomically", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-settings-"));
  try {
    const store = loadSettingsStore(userDataPath);
    store.writeSettingsSnapshot({
      settings: {
        language: "ko-KR", translationEnabled: false, translationLanguage: "en-US",
        overlayLineCount: 1, globalShortcut: "Command+Alt+C"
      },
      library: {
        version: 2,
        enabledTranscriptionLanguages: ["ko-KR"],
        enabledTranslationPairs: []
      }
    });
    const record = JSON.parse(fs.readFileSync(path.join(userDataPath, "settings.json"), "utf8"));
    assert.deepEqual(Object.keys(record).sort(), [
      "globalShortcut", "language", "languageLibrary", "overlayLineCount",
      "translationEnabled", "translationLanguage"
    ]);
    assert.equal(fs.existsSync(path.join(userDataPath, "settings.json.tmp")), false);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("onboarding seeds active choices atomically and supports transcription only", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-settings-"));
  try {
    const { createOnboardingSnapshot } = loadSettingsStore(userDataPath);
    const translated = createOnboardingSnapshot({
      language: "fr-fr", translationEnabled: true, translationLanguage: "ar"
    });
    assert.deepEqual(translated.library.enabledTranscriptionLanguages, ["fr-FR"]);
    assert.deepEqual(translated.library.enabledTranslationPairs, [
      { sourceLanguage: "fr-FR", targetLanguage: "ar" }
    ]);
    assert.deepEqual(createOnboardingSnapshot(translated.settings), translated);
    const captionsOnly = createOnboardingSnapshot({
      language: "ko-kr", translationEnabled: false, translationLanguage: "en-us"
    });
    assert.deepEqual(captionsOnly.library.enabledTranscriptionLanguages, ["ko-KR"]);
    assert.deepEqual(captionsOnly.library.enabledTranslationPairs, []);
    assert.equal(captionsOnly.settings.translationEnabled, false);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
