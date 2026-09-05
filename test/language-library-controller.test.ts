import assert from "node:assert/strict";
import test from "node:test";
import {
  LanguageLibraryController,
  type LanguageLibraryDependencies
} from "../electron/settings/language-library-controller";
import type { SettingsSnapshot } from "../electron/shared/types";

const base: SettingsSnapshot = {
  settings: {
    language: "ja-JP", translationEnabled: true, translationLanguage: "en-US",
    overlayLineCount: 2, globalShortcut: "CommandOrControl+Shift+K"
  },
  library: {
    version: 1,
    enabledTranscriptionLanguages: ["ja-JP", "en-US"],
    enabledTranslationLanguages: ["en-US"]
  }
};

function harness(overrides: Partial<LanguageLibraryDependencies> = {}) {
  let snapshot = structuredClone(base);
  const events: string[] = [];
  const dependencies: LanguageLibraryDependencies = {
    read: () => snapshot,
    sourceLanguage: () => snapshot.settings.language,
    commit: (value) => { snapshot = value; events.push("commit"); },
    transcriptionAvailability: async (language) => {
      events.push(`check:t:${language}`); return { installed: true, supported: true };
    },
    translationAvailability: async (source, target) => {
      events.push(`check:x:${source}:${target}`); return { installed: true, supported: true };
    },
    prepareTranscription: async (language) => { events.push(`prepare:t:${language}`); },
    deleteTranscription: async (language) => { events.push(`delete:t:${language}`); },
    prepareTranslation: async (source, target) => { events.push(`prepare:x:${source}:${target}`); },
    ...overrides
  };
  return { controller: new LanguageLibraryController(dependencies), events, snapshot: () => snapshot };
}

test("enable and disable are canonical, deduplicated, and idempotent", async () => {
  const state = harness();
  await state.controller.run({ type: "enable", kind: "transcription", language: "en-us" });
  await state.controller.run({ type: "enable", kind: "transcription", language: "fr-fr" });
  await state.controller.run({ type: "enable", kind: "transcription", language: "fr-FR" });
  await state.controller.run({ type: "disable", kind: "transcription", language: "fr-fr" });
  await state.controller.run({ type: "disable", kind: "transcription", language: "fr-FR" });
  assert.deepEqual(state.snapshot().library.enabledTranscriptionLanguages, ["ja-JP", "en-US"]);
  assert.equal(state.events.filter((event) => event === "commit").length, 2);
});

test("refresh checks only enabled languages and does not mutate active selection", async () => {
  const state = harness();
  await state.controller.run();
  assert.deepEqual(state.events, ["check:t:ja-JP", "check:t:en-US", "check:x:ja-JP:en-US"]);
  assert.deepEqual(state.snapshot().settings, base.settings);
});

test("same-language targets, including equivalent Chinese, are not checked", async () => {
  const state = harness({
    sourceLanguage: () => "zh-CN",
    read: () => ({
      ...base,
      settings: { ...base.settings, language: "zh-CN" },
      library: { ...base.library, enabledTranslationLanguages: ["zh-Hans", "zh-Hant"] }
    })
  });
  const result = await state.controller.run();
  assert.equal(result.translation[0]?.availability.supported, false);
  assert.equal(result.translation[1]?.availability.supported, true);
  assert.deepEqual(state.events.filter((event) => event.startsWith("check:x")), ["check:x:zh-CN:zh-Hant"]);
});

test("model actions are serialized and disabling never deletes the Apple model", async () => {
  let active = 0;
  let overlap = false;
  const state = harness({
    prepareTranscription: async () => { active += 1; overlap ||= active > 1; await Promise.resolve(); active -= 1; },
    deleteTranscription: async () => { active += 1; overlap ||= active > 1; await Promise.resolve(); active -= 1; }
  });
  await Promise.all([
    state.controller.run({ type: "prepare-transcription", language: "ja-JP" }),
    state.controller.run({ type: "delete-transcription", language: "ja-JP" })
  ]);
  await state.controller.run({ type: "disable", kind: "transcription", language: "ja-JP" });
  assert.equal(overlap, false);
  assert.equal(state.events.some((event) => event === "delete:t:ja-JP"), false);
});

test("translation preparation rejects a same source and target", async () => {
  const state = harness();
  await assert.rejects(
    state.controller.run({ type: "prepare-translation", language: "ja" }),
    /must be different/
  );
});
