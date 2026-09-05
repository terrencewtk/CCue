import assert from "node:assert/strict";
import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveTranslationLanguageSelection } from "../renderer/language-catalog";

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

test("persists a resolved fallback translation target after the spoken language changes", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "ccue-settings-"));
  try {
    const { normalizeCaptureSettings, readSettings, writeSettings } = loadSettingsStore(userDataPath);
    writeSettings({
      language: "en-US",
      translationEnabled: true,
      translationLanguage: "ja-JP",
      overlayLineCount: 3
    });

    const runtimeTargets = ["en", "zh-Hans", "zh-Hant"];
    const resolvedTranslationLanguage = resolveTranslationLanguageSelection(
      readSettings().translationLanguage,
      "ja-JP",
      runtimeTargets,
      "en-US"
    );
    writeSettings(normalizeCaptureSettings({
      ...readSettings(),
      language: "ja-JP",
      translationLanguage: resolvedTranslationLanguage
    }));

    assert.equal(readSettings().language, "ja-JP");
    assert.equal(readSettings().translationLanguage, "en");
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});
