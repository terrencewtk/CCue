import assert from "node:assert/strict";
import test from "node:test";
import { runFullModelRefresh } from "../renderer/full-model-refresh";
import { createRefreshTracker } from "../renderer/refresh-tracker";
import { prepareTranslationRefresh } from "../renderer/translation-refresh";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

test("prepareTranslationRefresh persists the resolved fallback before the caller can scan", async () => {
  const events: string[] = [];
  const plan = await prepareTranslationRefresh(
    "ja-JP",
    "ja-JP",
    async (sourceLanguage) => {
      events.push(`catalog:${sourceLanguage}`);
      return ["en", "zh-Hans", "zh-Hant"];
    },
    async (selectedTranslationLanguage) => {
      events.push(`persist:${selectedTranslationLanguage}`);
    },
    () => true
  );

  assert.ok(plan);
  if (!plan) return;
  events.push(`scan:${plan.selectedTranslationLanguage}`);

  assert.deepEqual(events, ["catalog:ja-JP", "persist:en", "scan:en"]);
});

test("prepareTranslationRefresh aborts stale work before persisting", async () => {
  const events: string[] = [];
  let current = true;
  const plan = await prepareTranslationRefresh(
    "ja-JP",
    "ja-JP",
    async (sourceLanguage) => {
      events.push(`catalog:${sourceLanguage}`);
      current = false;
      return ["en", "zh-Hans", "zh-Hant"];
    },
    async (selectedTranslationLanguage) => {
      events.push(`persist:${selectedTranslationLanguage}`);
    },
    () => current
  );

  assert.equal(plan, null);
  assert.deepEqual(events, ["catalog:ja-JP"]);
});

test("refresh trackers invalidate stale refresh generations", () => {
  const tracker = createRefreshTracker();
  const first = tracker.next();
  assert.equal(tracker.isCurrent(first), true);

  const second = tracker.next();
  assert.equal(tracker.isCurrent(first), false);
  assert.equal(tracker.isCurrent(second), true);
});

test("a replacement refresh completes every transcription row before starting translation", async () => {
  const tracker = createRefreshTracker();
  const staleCheck = deferred<string>();
  const events: string[] = [];
  const states = new Map<string, string>();
  const activeRefreshes = new Set<number>();

  function runRefresh(source: string, generation: number, firstCheck?: Promise<string>) {
    return runFullModelRefresh<string>({
      transcriptionLanguages: ["en-US", "ja-JP"],
      isCurrent: () => tracker.isCurrent(generation),
      setBusy: (busy) => {
        if (busy) activeRefreshes.add(generation);
        else activeRefreshes.delete(generation);
      },
      setPhase: (phase) => events.push(`${source}:phase:${phase}`),
      setChecking: (kind, language) => {
        events.push(`${source}:checking:${kind}:${language}`);
        if (source === "new" && kind === "transcription") states.set(language, "checking");
      },
      checkTranscription: async (language) => {
        events.push(`${source}:check:transcription:${language}`);
        return firstCheck && language === "en-US" ? firstCheck : `${source}:${language}`;
      },
      applyTranscription: (language) => {
        events.push(`${source}:ready:transcription:${language}`);
        if (source === "new") states.set(language, "ready");
      },
      failTranscription: () => assert.fail("transcription check should not fail"),
      prepareTranslation: async () => {
        events.push(`${source}:catalog`);
        return ["fr-FR"];
      },
      setTranslationLanguages: () => events.push(`${source}:translation-rows`),
      checkTranslation: async (language) => {
        events.push(`${source}:check:translation:${language}`);
        return `${source}:${language}`;
      },
      applyTranslation: (language) => events.push(`${source}:ready:translation:${language}`),
      failTranslation: () => assert.fail("translation check should not fail")
    });
  }

  const staleGeneration = tracker.next();
  const staleRefresh = runRefresh("old", staleGeneration, staleCheck.promise);
  await Promise.resolve();

  const replacementGeneration = tracker.next();
  const replacementRefresh = runRefresh("new", replacementGeneration);
  assert.equal(await replacementRefresh, "completed");
  staleCheck.resolve("old:en-US");
  assert.equal(await staleRefresh, "stale");

  const replacementEvents = events.filter((event) => event.startsWith("new:"));
  assert.deepEqual(replacementEvents, [
    "new:phase:transcription",
    "new:checking:transcription:en-US",
    "new:check:transcription:en-US",
    "new:ready:transcription:en-US",
    "new:checking:transcription:ja-JP",
    "new:check:transcription:ja-JP",
    "new:ready:transcription:ja-JP",
    "new:phase:translation",
    "new:catalog",
    "new:translation-rows",
    "new:checking:translation:fr-FR",
    "new:check:translation:fr-FR",
    "new:ready:translation:fr-FR"
  ]);
  assert.deepEqual([...states], [["en-US", "ready"], ["ja-JP", "ready"]]);
  assert.equal(events.includes("old:ready:transcription:en-US"), false);
  assert.equal(activeRefreshes.size, 0);
});

test("full refresh releases its busy scope when orchestration throws", async () => {
  const busyStates: boolean[] = [];
  await assert.rejects(() => runFullModelRefresh<string>({
    transcriptionLanguages: [],
    isCurrent: () => true,
    setBusy: (busy) => busyStates.push(busy),
    setPhase: () => {},
    setChecking: () => {},
    checkTranscription: async () => "ready",
    applyTranscription: () => {},
    failTranscription: () => {},
    prepareTranslation: async () => { throw new Error("catalog failed"); },
    setTranslationLanguages: () => {},
    checkTranslation: async () => "ready",
    applyTranslation: () => {},
    failTranslation: () => {}
  }), /catalog failed/);
  assert.deepEqual(busyStates, [true, false]);
});
