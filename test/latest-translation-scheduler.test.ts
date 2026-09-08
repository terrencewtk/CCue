import test from "node:test";
import assert from "node:assert/strict";
import { LatestTranslationScheduler } from "../electron/local-translation/latest-translation-scheduler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("coalesces waiting partial translations to the latest value", async () => {
  const first = deferred<string>();
  const requested: string[] = [];
  const completed: string[] = [];
  const scheduler = new LatestTranslationScheduler((text) => {
    requested.push(text);
    return requested.length === 1 ? first.promise : Promise.resolve(`translated:${text}`);
  }, (error) => assert.fail(String(error)));

  scheduler.submitPartial({
    segments: ["first"], isCurrent: () => true,
    complete: () => completed.push("first")
  });
  scheduler.submitPartial({
    segments: ["obsolete"], isCurrent: () => true,
    complete: () => completed.push("obsolete")
  });
  scheduler.submitPartial({
    segments: ["latest"], isCurrent: () => true,
    complete: () => completed.push("latest")
  });

  assert.deepEqual(requested, ["first"]);
  first.resolve("translated:first");
  await settle();

  assert.deepEqual(requested, ["first", "latest"]);
  assert.deepEqual(completed, ["first", "latest"]);
});

test("invalidated active partial yields to a durable final", async () => {
  const active = deferred<string>();
  const requested: string[] = [];
  const completed: string[] = [];
  let partialCurrent = true;
  const scheduler = new LatestTranslationScheduler((text) => {
    requested.push(text);
    return text === "partial" ? active.promise : Promise.resolve(`translated:${text}`);
  }, (error) => assert.fail(String(error)));

  scheduler.submitPartial({
    segments: ["partial", "stale second segment"],
    isCurrent: () => partialCurrent,
    complete: () => completed.push("partial")
  });
  partialCurrent = false;
  scheduler.submitFinal({
    segments: ["final"], isCurrent: () => true,
    complete: () => completed.push("final")
  });

  active.resolve("translated:partial");
  await settle();

  assert.deepEqual(requested, ["partial", "final"]);
  assert.deepEqual(completed, ["final"]);
});

test("preserves the order of final translations ahead of a waiting partial", async () => {
  const active = deferred<string>();
  const requested: string[] = [];
  const completed: string[] = [];
  const scheduler = new LatestTranslationScheduler((text) => {
    requested.push(text);
    return text === "active" ? active.promise : Promise.resolve(`translated:${text}`);
  }, (error) => assert.fail(String(error)));

  scheduler.submitPartial({
    segments: ["active"], isCurrent: () => true,
    complete: () => completed.push("active")
  });
  scheduler.submitPartial({
    segments: ["waiting partial"], isCurrent: () => true,
    complete: () => completed.push("waiting partial")
  });
  scheduler.submitFinal({
    segments: ["final one"], isCurrent: () => true,
    complete: () => completed.push("final one")
  });
  scheduler.submitFinal({
    segments: ["final two"], isCurrent: () => true,
    complete: () => completed.push("final two")
  });

  active.resolve("translated:active");
  await settle();

  assert.deepEqual(requested, ["active", "final one", "final two", "waiting partial"]);
  assert.deepEqual(completed, ["active", "final one", "final two", "waiting partial"]);
});

test("reset invalidates active work and prevents cross-session cache reuse", async () => {
  const oldRequest = deferred<string>();
  const requested: string[] = [];
  const completed: string[] = [];
  const scheduler = new LatestTranslationScheduler((text) => {
    requested.push(text);
    return requested.length === 1 ? oldRequest.promise : Promise.resolve("new translation");
  }, (error) => assert.fail(String(error)));

  scheduler.submitPartial({
    segments: ["same text"], isCurrent: () => true,
    complete: () => completed.push("old session")
  });
  scheduler.reset();
  scheduler.submitFinal({
    segments: ["same text"], isCurrent: () => true,
    complete: (translations) => completed.push(translations[0]!)
  });

  oldRequest.resolve("old translation");
  await settle();

  assert.deepEqual(requested, ["same text", "same text"]);
  assert.deepEqual(completed, ["new translation"]);
});
