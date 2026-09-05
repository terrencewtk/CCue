import assert from "node:assert/strict";
import test from "node:test";
import { ModelSettingsController, type ModelSettingsDependencies } from "../electron/settings/model-settings-controller";
import type { CaptureSettings, CaptureSettingsInput, ModelAvailability } from "../electron/shared/types";

const base: CaptureSettings = {
  language: "ja-JP",
  translationEnabled: true,
  translationLanguage: "en-US",
  overlayLineCount: 2,
  globalShortcut: "CommandOrControl+Shift+K"
};
const available: ModelAvailability = { installed: true, supported: true, deletable: false };

function normalized(input: CaptureSettingsInput): CaptureSettings {
  return { ...base, ...input };
}

function harness(overrides: Partial<ModelSettingsDependencies> = {}) {
  let committed: CaptureSettings = { ...base };
  const events: string[] = [];
  const dependencies: ModelSettingsDependencies = {
    normalize: normalized,
    read: () => committed,
    commit: (settings) => { events.push(`commit:${settings.language}:${settings.translationLanguage}`); committed = settings; },
    transcriptionLanguages: async () => ["en-US", "ja-JP", "zh-Hans"],
    translationLanguages: async () => ["en", "ja", "zh-Hant"],
    transcriptionAvailability: async (language) => { events.push(`check:t:${language}`); return available; },
    translationAvailability: async (_source, language) => { events.push(`check:x:${language}`); return available; },
    prepareTranscription: async (language) => { events.push(`prepare:t:${language}`); },
    deleteTranscription: async (language) => { events.push(`delete:t:${language}`); },
    prepareTranslation: async (_source, language) => { events.push(`prepare:x:${language}`); },
    ...overrides
  };
  return { controller: new ModelSettingsController(dependencies), events, committed: () => committed };
}

test("reconciles missing source and target before atomically syncing the complete snapshot", async () => {
  const state = harness();
  const result = await state.controller.run({
    ...base, language: "xx", translationLanguage: "xx", overlayLineCount: 1,
    globalShortcut: null
  });
  assert.deepEqual(result.settings, {
    language: "en-US", translationEnabled: true, translationLanguage: "ja",
    overlayLineCount: 1, globalShortcut: null
  });
  assert.deepEqual(state.committed(), result.settings);
  assert.equal(state.events[0], "commit:en-US:ja");
});

test("source-equivalent targets are excluded, including equivalent Chinese scripts", async () => {
  const state = harness({
    transcriptionLanguages: async () => ["zh-CN"],
    translationLanguages: async () => ["zh-Hans", "zh-Hant", "en"]
  });
  const result = await state.controller.run({ ...base, language: "zh-Hans", translationLanguage: "zh-CN" });
  assert.equal(result.settings.language, "zh-CN");
  assert.equal(result.settings.translationLanguage, "en");
  assert.deepEqual(result.translation.map((item) => item.language), ["zh-Hant", "en"]);
});

test("an empty target catalog disables translation without inventing an active target", async () => {
  const state = harness({ translationLanguages: async () => [] });
  const result = await state.controller.run(base);
  assert.equal(result.selectedTranslationLanguage, null);
  assert.equal(result.settings.translationEnabled, false);
  assert.equal(result.settings.translationLanguage, base.translationLanguage);
  assert.deepEqual(result.translation, []);
});

test("a single valid target is selected while an explicit disabled preference stays disabled", async () => {
  const state = harness({ translationLanguages: async () => ["fr"] });
  const result = await state.controller.run({ ...base, translationEnabled: false });
  assert.equal(result.selectedTranslationLanguage, "fr");
  assert.equal(result.settings.translationEnabled, false);
  assert.equal(result.settings.translationLanguage, "fr");
});

test("catalog failure does not commit transient fallback settings", async () => {
  const state = harness({ translationLanguages: async () => { throw new Error("catalog failed"); } });
  await assert.rejects(state.controller.run({ ...base, language: "en-US" }), /catalog failed/);
  assert.deepEqual(state.committed(), base);
  assert.deepEqual(state.events, []);
});

test("an empty transcription catalog fails closed", async () => {
  const state = harness({ transcriptionLanguages: async () => [] });
  await assert.rejects(state.controller.run(base), /no transcription languages/i);
  assert.deepEqual(state.committed(), base);
});

test("persistence failure stops before availability checks", async () => {
  const state = harness({ commit: () => { throw new Error("disk full"); } });
  await assert.rejects(state.controller.run(base), /disk full/);
  assert.equal(state.events.some((event) => event.startsWith("check:")), false);
});

test("availability failure returns an error after the reconciled settings are committed", async () => {
  const state = harness({ transcriptionAvailability: async () => { throw new Error("check failed"); } });
  await assert.rejects(state.controller.run(base), /check failed/);
  assert.equal(state.committed().overlayLineCount, 2);
  assert.equal(state.committed().globalShortcut, "CommandOrControl+Shift+K");
});

test("model mutations are serialized and followed by the same complete refresh", async () => {
  let active = 0;
  let overlap = false;
  const state = harness({
    prepareTranscription: async (language) => {
      active += 1;
      overlap ||= active > 1;
      state.events.push(`prepare:t:${language}`);
      await Promise.resolve();
      active -= 1;
    },
    deleteTranscription: async (language) => {
      active += 1;
      overlap ||= active > 1;
      state.events.push(`delete:t:${language}`);
      await Promise.resolve();
      active -= 1;
    }
  });
  const first = state.controller.run(base, { type: "prepare-transcription", language: "ja-JP" });
  const second = state.controller.run(base, { type: "delete-transcription", language: "ja-JP" });
  await Promise.all([first, second]);
  assert.equal(overlap, false);
  assert.deepEqual(state.events.filter((event) => event.startsWith("prepare:") || event.startsWith("delete:")), [
    "prepare:t:ja-JP", "delete:t:ja-JP"
  ]);
  assert.equal(state.events.filter((event) => event === "check:t:en-US").length, 2);
});

test("general saves preserve the committed model pair and synchronize all general fields", async () => {
  const state = harness();
  await state.controller.run({ ...base, language: "en-US", translationLanguage: "ja" });
  const saved = await state.controller.saveGeneral({
    language: "unsupported",
    translationEnabled: false,
    translationLanguage: "unsupported",
    overlayLineCount: 3,
    globalShortcut: null
  });
  assert.equal(saved.language, "en-US");
  assert.equal(saved.translationEnabled, true);
  assert.equal(saved.translationLanguage, "ja");
  assert.equal(saved.overlayLineCount, 3);
  assert.equal(saved.globalShortcut, null);
  assert.deepEqual(state.committed(), saved);
});
