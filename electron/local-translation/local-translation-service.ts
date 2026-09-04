import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { errorMessage } from "../audio/native-sidecar";
import { applicationRoot } from "../shared/runtime-paths";
import type { LocalTranslationEvent } from "../shared/types";
import type { ModelAvailability } from "../local-asr/local-asr-stream";

interface LocalTranslationCallbacks {
  onStatus: (detail: string) => void;
  onFailure: (message: string) => void;
}

interface PendingTranslation {
  resolve: (translation: string) => void;
  reject: (error: Error) => void;
  writeToDebugTrace: boolean;
}

function helperPath(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      "CCueTranslationHelper.app",
      "Contents",
      "MacOS",
      "caption-local-translation"
    );
  }
  return path.join(
    applicationRoot(__dirname),
    "local-translation",
    "CCueTranslationHelper.app",
    "Contents",
    "MacOS",
    "caption-local-translation"
  );
}

export class LocalTranslationService {
  private process?: ChildProcessWithoutNullStreams;
  private opening?: { resolve: () => void; reject: (error: Error) => void };
  private availability?: { resolve: (availability: ModelAvailability) => void; reject: (error: Error) => void };
  private readonly pending = new Map<number, PendingTranslation>();
  private requestSequence = 0;
  private debugTracePath?: string;

  constructor(private readonly callbacks: LocalTranslationCallbacks) {}

  async checkAvailability(sourceLanguage: string, targetLanguage: string): Promise<ModelAvailability> {
    this.close();
    const helper = this.launchHelper();
    const result = new Promise<ModelAvailability>((resolve, reject) => {
      this.availability = { resolve, reject };
    });
    helper.stdin.write(`${JSON.stringify({
      command: "availability",
      source_language: sourceLanguage,
      target_language: targetLanguage
    })}\n`);
    return result.finally(() => {
      if (this.process === helper) this.close();
    });
  }

  async open(sourceLanguage: string, targetLanguage: string): Promise<void> {
    this.close();
    this.beginDebugTrace();
    const helper = this.launchHelper();

    const ready = new Promise<void>((resolve, reject) => { this.opening = { resolve, reject }; });
    helper.stdin.write(`${JSON.stringify({
      command: "start",
      source_language: sourceLanguage,
      target_language: targetLanguage
    })}\n`);
    return ready;
  }

  translate(text: string, writeToDebugTrace = false): Promise<string> {
    const helper = this.process;
    const sourceText = text.trim();
    if (!helper || helper.killed) return Promise.reject(new Error("Local translation is not running"));
    if (!sourceText) return Promise.resolve("");

    const requestId = ++this.requestSequence;
    const result = new Promise<string>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, writeToDebugTrace });
    });
    helper.stdin.write(`${JSON.stringify({
      command: "translate",
      request_id: requestId,
      text: sourceText
    })}\n`);
    return result;
  }

  close(): void {
    const helper = this.process;
    this.process = undefined;
    if (helper && !helper.killed) {
      helper.stdin.write(`${JSON.stringify({ command: "quit" })}\n`);
      helper.kill();
    }
    const error = new Error("Local translation was stopped");
    this.opening?.reject(error);
    this.opening = undefined;
    this.availability?.reject(error);
    this.availability = undefined;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.debugTracePath = undefined;
  }

  private handleLine(line: string): void {
    let event: LocalTranslationEvent;
    try {
      event = JSON.parse(line) as LocalTranslationEvent;
    } catch (error) {
      this.fail(`Invalid local translation message: ${errorMessage(error)}`);
      return;
    }

    if (event.type === "ready") {
      console.info("[local-translation] Model ready");
      this.opening?.resolve();
      this.opening = undefined;
      return;
    }
    if (event.type === "availability") {
      this.availability?.resolve({
        installed: event.installed === true,
        supported: event.supported !== false,
        deletable: false
      });
      this.availability = undefined;
      return;
    }
    if (event.type === "status" && event.detail) {
      console.info(`[local-translation] ${event.detail}`);
      this.callbacks.onStatus(event.detail);
      return;
    }
    if (event.request_id !== undefined) {
      const pending = this.pending.get(event.request_id);
      if (!pending) return;
      this.pending.delete(event.request_id);
      if (event.type === "translation") {
        const translation = event.translation || "";
        if (pending.writeToDebugTrace) this.writeDebugTranslation(translation);
        pending.resolve(translation);
      } else {
        const message = event.message || "Local translation failed";
        pending.reject(new Error(message));
      }
      return;
    }
    if (event.type === "error") this.fail(event.message || "Local translation failed");
  }

  private fail(message: string): void {
    const error = new Error(message);
    const wasOpening = this.opening !== undefined;
    const wasCheckingAvailability = this.availability !== undefined;
    if (this.opening) {
      this.opening.reject(error);
      this.opening = undefined;
    }
    if (this.availability) {
      this.availability.reject(error);
      this.availability = undefined;
    }
    if (!wasOpening && !wasCheckingAvailability) {
      this.callbacks.onFailure(message);
    }
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private launchHelper(): ChildProcessWithoutNullStreams {
    const helper = spawn(helperPath(), [], { stdio: ["pipe", "pipe", "pipe"] });
    this.process = helper;
    readline.createInterface({ input: helper.stdout }).on("line", (line) => {
      if (this.process === helper) this.handleLine(line);
    });
    helper.stderr.on("data", (data: Buffer) => console.error(`[local-translation] ${data.toString().trim()}`));
    helper.on("error", (error) => {
      if (this.process === helper) this.fail(`Local translation helper failed: ${error.message}`);
    });
    helper.on("exit", (code) => {
      const wasCurrentHelper = this.process === helper;
      if (wasCurrentHelper) this.process = undefined;
      if (wasCurrentHelper && (this.opening || this.availability || this.pending.size)) {
        this.fail(`Local translation helper exited (${code ?? "signal"})`);
      }
    });
    return helper;
  }

  private beginDebugTrace(): void {
    if (app.isPackaged || process.env.CCUE_DEBUG_TRANSLATIONS !== "1") return;
    const directory = path.join(applicationRoot(__dirname), "debug-output");
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    try {
      fs.mkdirSync(directory, { recursive: true });
      this.debugTracePath = path.join(directory, `translation-stream-${timestamp}.txt`);
      fs.writeFileSync(this.debugTracePath, "", "utf8");
      console.info(`[local-translation] Debug stream: ${this.debugTracePath}`);
    } catch (error) {
      this.debugTracePath = undefined;
      console.warn(`[local-translation] Could not create debug stream: ${errorMessage(error)}`);
    }
  }

  private writeDebugTranslation(translation: string): void {
    if (!this.debugTracePath || !translation) return;
    try {
      fs.appendFileSync(this.debugTracePath, `${translation}\n`, "utf8");
    } catch (error) {
      console.warn(`[local-translation] Could not write debug stream: ${errorMessage(error)}`);
      this.debugTracePath = undefined;
    }
  }
}
