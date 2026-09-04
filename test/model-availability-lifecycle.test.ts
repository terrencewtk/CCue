import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import Module from "node:module";
import { PassThrough } from "node:stream";
import test from "node:test";

type CommonJsModule = typeof Module & {
  _load(request: string, parent: NodeModule | undefined, isMain: boolean): unknown;
};

interface FakeHelper extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  killed: boolean;
  stdin: { write(payload: string | Uint8Array): boolean };
  kill(): boolean;
}

const commonJsModule = Module as CommonJsModule;

function loadService(modulePath: string, exportName: string): unknown {
  const originalLoad = commonJsModule._load;
  let helperSequence = 0;

  commonJsModule._load = function load(request, parent, isMain) {
    if (request === "electron") return { app: { isPackaged: false } };
    if (request === "node:child_process") {
      return {
        spawn() {
          const helper = new EventEmitter() as FakeHelper;
          const sequence = ++helperSequence;
          helper.stdout = new PassThrough();
          helper.stderr = new PassThrough();
          helper.killed = false;
          helper.stdin = {
            write(payload) {
              const command = JSON.parse(String(payload)) as { command?: string };
              if (command.command === "release") {
                setTimeout(() => {
                  if (!helper.killed) helper.stdout.write('{"type":"released","released":true}\n');
                }, 0);
                return true;
              }
              if (command.command !== "availability") return true;
              setTimeout(() => {
                if (!helper.killed) {
                  helper.stdout.write(`${JSON.stringify({
                    type: "availability",
                    installed: sequence === 1,
                    supported: true,
                    deletable: sequence === 1
                  })}\n`);
                }
              }, sequence === 1 ? 0 : 20);
              return true;
            }
          };
          helper.kill = () => {
            helper.killed = true;
            setTimeout(() => helper.emit("exit", null), 5);
            return true;
          };
          return helper;
        }
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
    return require(resolved)[exportName];
  } finally {
    commonJsModule._load = originalLoad;
  }
}

test("a retired transcription helper cannot reject the next availability check", async () => {
  const LocalAsrStream = loadService(
    "../electron/local-asr/local-asr-stream.js",
    "LocalAsrStream"
  ) as typeof import("../electron/local-asr/local-asr-stream").LocalAsrStream;
  const service = new LocalAsrStream({
    onStatus() {},
    onPartial() {},
    onFinal() {},
    onFailure() {}
  });

  assert.deepEqual(await service.checkAvailability("ja-JP"), {
    installed: true,
    supported: true,
    deletable: true
  });
  assert.deepEqual(await service.checkAvailability("en-US"), {
    installed: false,
    supported: true,
    deletable: false
  });
  assert.equal(await service.release("ja-JP"), true);
  service.close();
});

test("a retired translation helper cannot reject the next availability check", async () => {
  const LocalTranslationService = loadService(
    "../electron/local-translation/local-translation-service.js",
    "LocalTranslationService"
  ) as typeof import("../electron/local-translation/local-translation-service").LocalTranslationService;
  const service = new LocalTranslationService({ onStatus() {}, onFailure() {} });

  assert.deepEqual(await service.checkAvailability("ja-JP", "zh-TW"), {
    installed: true,
    supported: true,
    deletable: false
  });
  assert.deepEqual(await service.checkAvailability("ja-JP", "ko-KR"), {
    installed: false,
    supported: true,
    deletable: false
  });
  service.close();
});
