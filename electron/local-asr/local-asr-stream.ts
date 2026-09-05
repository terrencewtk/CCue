import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { applicationRoot } from "../shared/runtime-paths";
import type { AudioChunk, CaptionUtterance, LocalAsrEvent } from "../shared/types";
import { errorMessage } from "../audio/native-sidecar";

const ADAPTIVE_HINTS_ENABLED = process.env.CCUE_ENABLE_ADAPTIVE_HINTS === "1";

interface LocalAsrCallbacks {
  onStatus: (detail: string) => void;
  onPartial: (utterance: CaptionUtterance) => void;
  onFinal: (utterance: CaptionUtterance) => void;
  onFailure: (message: string) => void;
}

export interface ModelAvailability {
  installed: boolean;
  supported: boolean;
  deletable: boolean;
}

function helperPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "bin", "caption-local-asr");
  return path.join(applicationRoot(__dirname), "local-asr", ".build", "release", "caption-local-asr");
}

export class LocalAsrStream {
  private process?: ChildProcessWithoutNullStreams;
  private opening?: { resolve: () => void; reject: (error: Error) => void };
  private availability?: { resolve: (availability: ModelAvailability) => void; reject: (error: Error) => void };
  private languages?: { resolve: (languages: string[]) => void; reject: (error: Error) => void };
  private releasing?: { resolve: (released: boolean) => void; reject: (error: Error) => void };
  private stopping?: { resolve: () => void; timer: NodeJS.Timeout };

  constructor(private readonly callbacks: LocalAsrCallbacks) {}

  async supportedLanguages(): Promise<string[]> {
    this.close();
    const helper = this.launchHelper();
    const result = new Promise<string[]>((resolve, reject) => {
      this.languages = { resolve, reject };
    });
    helper.stdin.write(`${JSON.stringify({ command: "languages" })}\n`);
    return result.finally(() => {
      if (this.process === helper) this.close();
    });
  }

  async checkAvailability(language: string): Promise<ModelAvailability> {
    this.close();
    const helper = this.launchHelper();
    const result = new Promise<ModelAvailability>((resolve, reject) => {
      this.availability = { resolve, reject };
    });
    helper.stdin.write(`${JSON.stringify({ command: "availability", language })}\n`);
    return result.finally(() => {
      if (this.process === helper) this.close();
    });
  }

  async open(language: string): Promise<void> {
    this.close();
    const helper = this.launchHelper();

    const ready = new Promise<void>((resolve, reject) => { this.opening = { resolve, reject }; });
    helper.stdin.write(`${JSON.stringify({
      command: "start",
      language,
      adaptive_hints_enabled: ADAPTIVE_HINTS_ENABLED,
      debug_glossary: ADAPTIVE_HINTS_ENABLED && !app.isPackaged
    })}\n`);
    return ready;
  }

  async release(language: string): Promise<boolean> {
    this.close();
    const helper = this.launchHelper();
    const result = new Promise<boolean>((resolve, reject) => {
      this.releasing = { resolve, reject };
    });
    helper.stdin.write(`${JSON.stringify({ command: "release", language })}\n`);
    return result.finally(() => {
      if (this.process === helper) this.close();
    });
  }

  appendAudio(chunk: AudioChunk): void {
    this.process?.stdin.write(`${JSON.stringify({
      command: "audio",
      pcm16: chunk.data,
      start_ms: chunk.startMs,
      end_ms: chunk.endMs
    })}\n`);
  }

  async stop(): Promise<void> {
    const helper = this.process;
    if (!helper || helper.killed) return;
    const stopped = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2_500);
      this.stopping = { resolve, timer };
    });
    helper.stdin.write(`${JSON.stringify({ command: "stop" })}\n`);
    await stopped;
    this.close();
  }

  close(): void {
    const helper = this.process;
    this.process = undefined;
    if (helper && !helper.killed) {
      helper.stdin.write(`${JSON.stringify({ command: "quit" })}\n`);
      helper.kill();
    }
    if (this.opening) {
      this.opening.reject(new Error("Local transcription startup was cancelled"));
      this.opening = undefined;
    }
    if (this.availability) {
      this.availability.reject(new Error("Local transcription availability check was cancelled"));
      this.availability = undefined;
    }
    if (this.languages) {
      this.languages.reject(new Error("Local transcription language discovery was cancelled"));
      this.languages = undefined;
    }
    if (this.releasing) {
      this.releasing.reject(new Error("Local transcription model deletion was cancelled"));
      this.releasing = undefined;
    }
    if (this.stopping) {
      clearTimeout(this.stopping.timer);
      this.stopping.resolve();
      this.stopping = undefined;
    }
  }

  private handleLine(line: string): void {
    let event: LocalAsrEvent;
    try {
      event = JSON.parse(line) as LocalAsrEvent;
    } catch (error) {
      this.fail(`Invalid local transcription message: ${errorMessage(error)}`);
      return;
    }
    if (event.type === "ready") {
      console.info("[local-asr] Model ready");
      this.opening?.resolve();
      this.opening = undefined;
    } else if (event.type === "languages") {
      this.languages?.resolve(event.languages ?? []);
      this.languages = undefined;
    } else if (event.type === "availability") {
      this.availability?.resolve({
        installed: event.installed === true,
        supported: event.supported !== false,
        deletable: event.deletable === true
      });
      this.availability = undefined;
    } else if (event.type === "released") {
      this.releasing?.resolve(event.released === true);
      this.releasing = undefined;
    } else if (event.type === "status" && event.detail) {
      console.info(`[local-asr] ${event.detail}`);
      this.callbacks.onStatus(event.detail);
    } else if ((event.type === "partial" || event.type === "final") && event.text?.trim()) {
      const utterance = {
        text: event.text,
        translation: "",
        startMs: event.start_ms || 0,
        endMs: event.end_ms || 0
      };
      if (event.type === "partial") this.callbacks.onPartial(utterance);
      else this.callbacks.onFinal(utterance);
    } else if (event.type === "stopped") {
      if (this.stopping) {
        clearTimeout(this.stopping.timer);
        this.stopping.resolve();
        this.stopping = undefined;
      }
    } else if (event.type === "error") {
      console.error(`[local-asr] ${event.message || "Local transcription failed"}`);
      this.fail(event.message || "Local transcription failed");
    }
  }

  private fail(message: string): void {
    const wasOpening = this.opening !== undefined;
    const wasCheckingAvailability = this.availability !== undefined;
    const wasDiscoveringLanguages = this.languages !== undefined;
    const wasReleasing = this.releasing !== undefined;
    if (this.opening) {
      this.opening.reject(new Error(message));
      this.opening = undefined;
    }
    if (this.availability) {
      this.availability.reject(new Error(message));
      this.availability = undefined;
    }
    if (this.languages) {
      this.languages.reject(new Error(message));
      this.languages = undefined;
    }
    if (this.releasing) {
      this.releasing.reject(new Error(message));
      this.releasing = undefined;
    }
    if (!wasOpening && !wasCheckingAvailability && !wasDiscoveringLanguages && !wasReleasing) {
      this.callbacks.onFailure(message);
    }
  }

  private launchHelper(): ChildProcessWithoutNullStreams {
    const helper = spawn(helperPath(), [], { stdio: ["pipe", "pipe", "pipe"] });
    this.process = helper;
    readline.createInterface({ input: helper.stdout }).on("line", (line) => {
      if (this.process === helper) this.handleLine(line);
    });
    helper.stderr.on("data", (data: Buffer) => console.error(`[local-asr] ${data.toString().trim()}`));
    helper.on("error", (error) => {
      if (this.process === helper) this.fail(`Local transcription helper failed: ${error.message}`);
    });
    helper.on("exit", (code) => {
      const wasCurrentHelper = this.process === helper;
      if (wasCurrentHelper) this.process = undefined;
      if (wasCurrentHelper && (this.opening || this.languages || this.availability || this.releasing)) {
        this.fail(`Local transcription helper exited (${code ?? "signal"})`);
      }
    });
    return helper;
  }
}
