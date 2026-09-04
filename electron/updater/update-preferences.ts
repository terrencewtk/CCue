import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface UpdatePreferences {
  automaticallyDownload: boolean;
  skippedVersion?: string;
}

const defaults: UpdatePreferences = {
  automaticallyDownload: false
};

function preferencesPath(): string {
  return path.join(app.getPath("userData"), "update-preferences.json");
}

export function readUpdatePreferences(): UpdatePreferences {
  try {
    const stored = JSON.parse(fs.readFileSync(preferencesPath(), "utf8")) as Partial<UpdatePreferences>;
    return {
      automaticallyDownload: stored.automaticallyDownload === true,
      ...(typeof stored.skippedVersion === "string" ? { skippedVersion: stored.skippedVersion } : {})
    };
  } catch {
    return { ...defaults };
  }
}

export function writeUpdatePreferences(preferences: UpdatePreferences): void {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(preferencesPath(), JSON.stringify(preferences, null, 2));
}
