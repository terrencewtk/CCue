import assert from "node:assert/strict";
import test from "node:test";
import { validateSelectedModels } from "../electron/capture/selected-model-validator";
import type { CaptureSettings, LanguageLibrary } from "../electron/shared/types";

const settings: CaptureSettings = {
  language: "ja-JP", translationEnabled: true, translationLanguage: "en-US",
  overlayLineCount: 3, globalShortcut: null
};
const library: LanguageLibrary = {
  version: 2,
  enabledTranscriptionLanguages: ["ja-JP"],
  enabledTranslationPairs: [{ sourceLanguage: "ja-JP", targetLanguage: "en-US" }]
};

test("final capture validation checks exactly the selected models", async () => {
  const calls: string[] = [];
  await validateSelectedModels(settings, library, {
    transcription: async (language) => { calls.push(`t:${language}`); return { installed: true, supported: true }; },
    translation: async (source, target) => { calls.push(`x:${source}:${target}`); return { installed: true, supported: true }; }
  });
  assert.deepEqual(calls, ["t:ja-JP", "x:ja-JP:en-US"]);
});

test("final capture validation fails before capture for missing readiness", async () => {
  await assert.rejects(validateSelectedModels(settings, library, {
    transcription: async () => ({ installed: false, supported: true }),
    translation: async () => ({ installed: true, supported: true })
  }), /transcription model is not ready/);
});

test("translation-disabled validation never checks a target", async () => {
  let translated = false;
  await validateSelectedModels({ ...settings, translationEnabled: false }, library, {
    transcription: async () => ({ installed: true, supported: true }),
    translation: async () => { translated = true; return { installed: true, supported: true }; }
  });
  assert.equal(translated, false);
});

test("unsupported or non-enabled active pairs fail without inventing replacements", async () => {
  await assert.rejects(validateSelectedModels(
    { ...settings, translationLanguage: "fr-FR" }, library,
    {
      transcription: async () => ({ installed: true, supported: true }),
      translation: async () => ({ installed: true, supported: true })
    }
  ), /not enabled/);
});

test("same-language pairs, including equivalent regional identifiers, fail closed", async () => {
  await assert.rejects(validateSelectedModels(
    { ...settings, language: "en-GB", translationLanguage: "en-US" },
    {
      ...library,
      enabledTranscriptionLanguages: ["en-GB"],
      enabledTranslationPairs: [{ sourceLanguage: "en-GB", targetLanguage: "en-US" }]
    },
    {
      transcription: async () => ({ installed: true, supported: true }),
      translation: async () => ({ installed: true, supported: true })
    }
  ), /must be different/);
});
