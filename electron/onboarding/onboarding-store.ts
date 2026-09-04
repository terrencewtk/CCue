import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

interface OnboardingRecord {
  completed?: boolean;
}

function onboardingPath(): string {
  return path.join(app.getPath("userData"), "onboarding.json");
}

export function hasCompletedOnboarding(): boolean {
  try {
    const record = JSON.parse(fs.readFileSync(onboardingPath(), "utf8")) as OnboardingRecord;
    return record.completed === true;
  } catch {
    return false;
  }
}

export function markOnboardingCompleted(): void {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(onboardingPath(), JSON.stringify({ completed: true }, null, 2));
}
