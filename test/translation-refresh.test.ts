import assert from "node:assert/strict";
import test from "node:test";
import { createRefreshTracker } from "../renderer/refresh-tracker";
import { prepareTranslationRefresh } from "../renderer/translation-refresh";

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
