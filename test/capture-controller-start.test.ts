import assert from "node:assert/strict";
import test from "node:test";
import { CaptureController } from "../electron/capture/capture-controller";
import type { WindowManager } from "../electron/ui/window-manager";

const windows = {} as WindowManager;

test("concurrent capture starts share one validation and outcome", async () => {
  let validationCalls = 0;
  let rejectValidation!: (error: Error) => void;
  const validation = new Promise<void>((_resolve, reject) => { rejectValidation = reject; });
  const controller = new CaptureController(windows, async () => {
    validationCalls += 1;
    await validation;
  });

  const first = controller.start({});
  const second = controller.start({ language: "ja-JP" });
  assert.strictEqual(second, first);
  assert.equal(validationCalls, 1);

  const firstFailure = assert.rejects(first, /model validation failed/);
  const secondFailure = assert.rejects(second, /model validation failed/);
  rejectValidation(new Error("model validation failed"));
  await Promise.all([firstFailure, secondFailure]);
});

test("capture can be retried after an in-flight start fails", async () => {
  let validationCalls = 0;
  const controller = new CaptureController(windows, async () => {
    validationCalls += 1;
    throw new Error("model unavailable");
  });

  await assert.rejects(controller.start({}), /model unavailable/);
  await assert.rejects(controller.start({}), /model unavailable/);
  assert.equal(validationCalls, 2);
});
