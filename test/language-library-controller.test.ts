import assert from "node:assert/strict";
import test from "node:test";
import {
  LanguageLibraryController,
  type LanguageLibraryDependencies
} from "../electron/settings/language-library-controller";
import type { SettingsSnapshot } from "../electron/shared/types";

const base: SettingsSnapshot = {
  settings: {
    language: "ja-JP", translationEnabled: true, translationLanguage: "en",
    overlayLineCount: 2, globalShortcut: "CommandOrControl+Shift+K"
  },
  library: {
    version: 2,
    enabledTranscriptionLanguages: ["ja-JP", "en-US"],
    enabledTranslationPairs: [{ sourceLanguage: "ja-JP", targetLanguage: "en" }]
  }
};

function harness(overrides: Partial<LanguageLibraryDependencies> = {}) {
  let snapshot = structuredClone(base);
  const events: string[] = [];
  const dependencies: LanguageLibraryDependencies = {
    read: () => snapshot,
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
    modelMutationCompleted: () => { events.push("notify"); },
    ...overrides
  };
  return { controller: new LanguageLibraryController(dependencies), events, snapshot: () => snapshot };
}

test("transcription changes are canonical, idempotent, and remove dependent pairs", async () => {
  const state = harness();
  await state.controller.run({ type: "enable-transcription", language: "fr-fr" });
  await state.controller.run({ type: "enable-transcription", language: "fr-FR" });
  await state.controller.run({
    type: "enable-translation-pair", sourceLanguage: "fr-FR", targetLanguage: "en"
  });
  await state.controller.run({ type: "disable-transcription", language: "fr-fr" });
  await state.controller.run({ type: "disable-transcription", language: "fr-FR" });
  assert.deepEqual(state.snapshot().library, base.library);
  assert.equal(state.events.filter((event) => event === "commit").length, 3);
});

test("refresh checks only enabled transcription languages and exact pairs", async () => {
  const state = harness();
  await state.controller.run();
  assert.deepEqual(state.events, ["check:t:ja-JP", "check:t:en-US", "check:x:ja-JP:en"]);
  assert.deepEqual(state.snapshot().settings, base.settings);
});

test("translation pairs retain distinct Chinese scripts", async () => {
  const state = harness();
  await state.controller.run({ type: "enable-transcription", language: "zh-CN" });
  await state.controller.run({
    type: "enable-translation-pair", sourceLanguage: "zh-CN", targetLanguage: "zh-Hant"
  });
  assert.deepEqual(state.snapshot().library.enabledTranslationPairs.at(-1), {
    sourceLanguage: "zh-CN", targetLanguage: "zh-Hant"
  });
  assert.equal(state.events.includes("check:x:zh-CN:zh-Hant"), true);
});

test("translation preparation uses the pair's stored source", async () => {
  const state = harness();
  await state.controller.run({
    type: "prepare-translation-pair", sourceLanguage: "ja-JP", targetLanguage: "en"
  });
  assert.equal(state.events.includes("prepare:x:ja-JP:en"), true);
  assert.equal(state.events.includes("notify"), true);
});

test("translation pairs require an enabled source and exact enabled pair", async () => {
  const state = harness();
  await assert.rejects(state.controller.run({
    type: "enable-translation-pair", sourceLanguage: "fr-FR", targetLanguage: "en"
  }), /spoken language/);
  await assert.rejects(state.controller.run({
    type: "prepare-translation-pair", sourceLanguage: "en-US", targetLanguage: "ja"
  }), /Enable this translation pair/);
});

test("model actions are serialized and library removal does not delete the Apple model", async () => {
  let active = 0;
  let overlap = false;
  let deletes = 0;
  const state = harness({
    prepareTranscription: async () => { active += 1; overlap ||= active > 1; await Promise.resolve(); active -= 1; },
    deleteTranscription: async () => {
      deletes += 1; active += 1; overlap ||= active > 1; await Promise.resolve(); active -= 1;
    }
  });
  await Promise.all([
    state.controller.run({ type: "prepare-transcription", language: "ja-JP" }),
    state.controller.run({ type: "delete-transcription", language: "ja-JP" })
  ]);
  await state.controller.run({ type: "disable-transcription", language: "ja-JP" });
  assert.equal(overlap, false);
  assert.equal(deletes, 1);
});

test("same-language translation pairs fail closed", async () => {
  const state = harness();
  await assert.rejects(state.controller.run({
    type: "enable-translation-pair", sourceLanguage: "ja-JP", targetLanguage: "ja"
  }), /must be different/);
});

test("a successful model change broadcasts even when a later availability check fails", async () => {
  const state = harness({
    transcriptionAvailability: async () => { throw new Error("status helper failed"); }
  });
  await assert.rejects(
    state.controller.run({ type: "prepare-transcription", language: "ja-JP" }),
    /status helper failed/
  );
  assert.equal(state.events[0], "prepare:t:ja-JP");
  assert.equal(state.events.at(-1), "notify");
});
