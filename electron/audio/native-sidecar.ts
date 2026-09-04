import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { developmentSidecarPath } from "../shared/runtime-paths";
import type { SidecarEvent } from "../shared/types";

interface NativeSidecarCallbacks {
  onEvent: (event: SidecarEvent) => void;
  onError: (message: string) => void;
  onExit: (code: number | null) => void;
}

function binaryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "bin", "caption-audio-sidecar");
  }
  return developmentSidecarPath(__dirname);
}

export class NativeSidecar {
  private process?: ChildProcessWithoutNullStreams;

  constructor(private readonly callbacks: NativeSidecarCallbacks) {}

  ensureRunning(): void {
    if (this.process && !this.process.killed) return;

    const sidecarProcess = spawn(binaryPath(), [], { stdio: ["pipe", "pipe", "pipe"] });
    this.process = sidecarProcess;
    const outputLines = readline.createInterface({ input: sidecarProcess.stdout });
    outputLines.on("line", (line) => {
      try {
        this.callbacks.onEvent(JSON.parse(line) as SidecarEvent);
      } catch (error) {
        this.callbacks.onError(`Invalid native message: ${errorMessage(error)}`);
      }
    });
    sidecarProcess.stderr.on("data", (data: Buffer) => {
      console.error(`[audio] ${data.toString().trim()}`);
    });
    sidecarProcess.on("error", (error) => {
      this.callbacks.onError(`Native sidecar failed: ${error.message}`);
    });
    sidecarProcess.on("exit", (code) => {
      if (this.process === sidecarProcess) this.process = undefined;
      this.callbacks.onExit(code);
    });
  }

  send(command: "start" | "stop"): void {
    this.ensureRunning();
    this.process?.stdin.write(`${JSON.stringify({ command })}\n`);
  }

  quit(): void {
    if (!this.process || this.process.killed) return;
    this.process.stdin.write(`${JSON.stringify({ command: "quit" })}\n`);
    this.process.kill();
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
