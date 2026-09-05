import assert from "node:assert/strict";
import test from "node:test";
import {
  SelectedModelReadinessController,
  type ModelChecker,
  type SelectedModelSnapshot
} from "../renderer/model-availability";

function snapshot(language: string, translationEnabled = true): SelectedModelSnapshot {
  return {
    settings: {
      language, translationEnabled, translationLanguage: "en-US",
      overlayLineCount: 3, globalShortcut: null
    },
    library: {
      version: 1,
      enabledTranscriptionLanguages: ["ja-JP", "ko-KR"],
      enabledTranslationLanguages: ["en-US"]
    }
  };
}

test("checks only the current source and enabled target pair", async () => {
  const events: string[] = [];
  const checker: ModelChecker = {
    run: (operation) => operation(),
    transcription: async (language) => { events.push(`t:${language}`); return { installed: true, supported: true }; },
    translation: async (source, target) => { events.push(`x:${source}:${target}`); return { installed: true, supported: true }; }
  };
  const result = await new Promise<boolean>((resolve) => {
    new SelectedModelReadinessController(checker, () => {}, (_state, readiness) => resolve(readiness.ready))
      .request(snapshot("ja-JP"));
  });
  assert.equal(result, true);
  assert.deepEqual(events, ["t:ja-JP", "x:ja-JP:en-US"]);
});

test("translation disabled skips target readiness", async () => {
  const events: string[] = [];
  const checker: ModelChecker = {
    run: (operation) => operation(),
    transcription: async (language) => { events.push(language); return { installed: true, supported: true }; },
    translation: async () => { throw new Error("must not run"); }
  };
  await new Promise<void>((resolve) => {
    new SelectedModelReadinessController(checker, () => {}, () => resolve()).request(snapshot("ja-JP", false));
  });
  assert.deepEqual(events, ["ja-JP"]);
});

test("rapid and external updates coalesce to the latest pending snapshot", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const checked: string[] = [];
  const results: string[] = [];
  const checker: ModelChecker = {
    run: (operation) => operation(),
    transcription: async (language) => {
      checked.push(language);
      if (language === "ja-JP") await gate;
      return { installed: true, supported: true };
    },
    translation: async () => ({ installed: true, supported: true })
  };
  const done = new Promise<void>((resolve) => {
    const controller = new SelectedModelReadinessController(
      checker,
      () => {},
      (state) => { results.push(state.settings.language); resolve(); }
    );
    controller.request(snapshot("ja-JP", false));
    controller.request(snapshot("ja-JP", true));
    controller.request(snapshot("ko-KR", false));
    release();
  });
  await done;
  assert.deepEqual(checked, ["ja-JP", "ko-KR"]);
  assert.deepEqual(results, ["ko-KR"]);
});

test("missing or unsupported selections fail closed", async () => {
  const missing = snapshot("fr-FR");
  const result = await new Promise<boolean>((resolve) => {
    const checker: ModelChecker = {
      run: (operation) => operation(),
      transcription: async () => { throw new Error("must not run"); },
      translation: async () => { throw new Error("must not run"); }
    };
    new SelectedModelReadinessController(checker, () => {}, (_state, readiness) => resolve(readiness.ready)).request(missing);
  });
  assert.equal(result, false);
});
